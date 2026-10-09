import type { Browser, Page } from 'puppeteer';

import type { Profile } from '../global_types/profile.ts';

import { PAGE_SCRIPT } from './page_script.ts';
import { launch_crawler_browser, CRAWLER_CHROME_DIR, RECORDER_CHROME_DIR } from './replay.ts';
import * as db_manager from './db_stuff.ts';
import { acquire_crawler_dir } from './chrome_lock.ts';
import { DorkBlocked, build_dork, is_dork_blocked, run_dork_first } from './dork.ts';

export type CrawlingSessionStatus = 'PENDING' | 'RECORDING' | 'DONE' | 'FAILED';

/*
 * what one gesture recorded: a MARK is a middle click on an element worth
 * reading, a SELECT is a right click on a section every posting holds. left
 * clicks and typing are not recorded at all, the dork does the navigation
 */
export type CrawlingEvent = {
  seq : number;
  kind : 'MARK' | 'SELECT';
  selector? : string;
};

//what one recording session hands back: the two selector sets of a profile
export type SelectorCapture = {
  post_selector : string[];
  description_selector : string[];
};

export type CrawlingSession = {
  session_id : string;
  status : CrawlingSessionStatus;
  error : string | null;
  result : SelectorCapture;
  //the page the recorder opened, the dork's first answer, comes in only once
  //the dork got a page through
  page_url : string | null;
  //set while the dork is parked behind an anti-bot wall, the panel can point
  //the user at the exact hold that is holding this session up
  held_session_id : string | null;
};

type StoredSession = {
  view : CrawlingSession;
  profile : Profile;
  created_at : number;
  finished : boolean;
  last_seq : number;
  collected : CrawlingEvent[];
  teardown : (() => void) | null;
};

const MAX_SESSIONS = 20;
const TERMINAL_TTL_MS = 10 * 60 * 1000;
const DRAIN_INTERVAL_MS = 150;

const is_terminal = ( status : CrawlingSessionStatus ) => {
  return status === 'DONE' || status === 'FAILED';
};

const sessions = new Map<string, StoredSession>();

/*
 * the whole recorded sequence collapsed into the two selector sets a profile
 * holds. both keep first occurrence order, so the selectors come back in the
 * order the user pointed at them, and a repeat of the same shape is one
 * selector rather than two
 */
export const build_result = ( events : CrawlingEvent[] ) : SelectorCapture => {

  const post_selector : string[] = [];
  const description_selector : string[] = [];

  for(const event of events){

    if(!event.selector){ continue; }

    if(event.kind === 'MARK'){
      if(!post_selector.includes(event.selector)){ post_selector.push(event.selector); }
      continue;
    }

    if(event.kind === 'SELECT'){
      if(!description_selector.includes(event.selector)){
        description_selector.push(event.selector);
      }
    }

  }

  return { post_selector, description_selector };
};

const evict_sessions = () => {

  const now = Date.now();

  for(const [ id , session ] of sessions){
    if(is_terminal(session.view.status) && now - session.created_at > TERMINAL_TTL_MS){
      sessions.delete(id);
    }
  }

  if(sessions.size <= MAX_SESSIONS){ return; }

  const by_age = [...sessions.entries()]
    .filter(([ , session ]) => is_terminal(session.view.status))
    .sort(([ , a ] , [ , b ]) => a.created_at - b.created_at);

  for(const [ id ] of by_age){
    if(sessions.size <= MAX_SESSIONS){ break; }
    sessions.delete(id);
  }
};

/*
 * the recorder keeps a chrome profile of its own, and the scheduler has none at
 * all. a userDataDir can only be held by one process at a time, so sharing one
 * would mean a recording session fails to launch whenever a tick is in flight
 *
 * keeping it is what lets the user sign in by hand once, walk to the page they
 * want and point at the selectors from there without signing in again on the
 * next recording. nothing about the sign in is recorded: the gestures only
 * capture the selectors, and the dork is what gets the crawl back to a page
 */
const launch_browser = async () : Promise<Browser> => {
  return await launch_crawler_browser({
    headless : false,
    user_data_dir : RECORDER_CHROME_DIR
  });
};

const install_recorder = async ( target : Page ) => {
  await target.evaluateOnNewDocument(PAGE_SCRIPT);
  await target.evaluate(PAGE_SCRIPT);
};

const run_session = async ( session_id : string, profile : Profile ) => {

  const session = sessions.get(session_id);
  if(!session){ return; }

  let browser : Browser | null = null;
  let page : Page | null = null;
  let timer : ReturnType<typeof setInterval> | null = null;
  let draining = false;

  const close_browser = () => {
    const dying = browser;
    browser = null;
    if(dying){ dying.close().catch(() => {}); }
  };

  const stop_timer = () => {
    if(timer !== null){ clearInterval(timer); timer = null; }
  };

  const finalize = ( status : CrawlingSessionStatus, error_message : string | null ) => {
    if(session.finished){ return; }
    session.finished = true;
    stop_timer();
    if(status === 'DONE'){ session.view.result = build_result(session.collected); }
    session.view.status = status;
    session.view.error = error_message;
    session.teardown = null;
    const suffix = error_message ? ` : ${error_message}` : '';
    console.log(`[CRAWLING SESSION ${session_id}] ${status}${suffix}`);
  };

  const drain_once = async () => {

    if(draining || !page || session.finished){ return; }

    draining = true;
    try{
      const chunk = await page.evaluate(( after_seq : number ) => {
        const drain = (window as any).__seperated_out_drain__;
        if(!drain){ return null; }
        return drain(after_seq);
      }, session.last_seq);

      if(chunk && Array.isArray(chunk.events)){
        session.last_seq = chunk.last_seq;
        session.collected.push(...chunk.events);
      }
    }
    catch{
      //a navigation tears down the execution context down, the next tick picks it back up
    }
    finally{
      draining = false;
    }
  };

  const on_page_close = () => {
    if(session.finished){ return; }
    drain_once().then(() => {
      finalize('DONE', null);
      close_browser();
    });
  };

  //a blocked dork parks the recording on a hold, then watches the anti-bot
  //panel until the user has solved the wall or thrown the hold away
  const wait_for_hold = async ( hold_id : string ) : Promise<'SOLVED' | 'DISCARDED' | 'CANCELLED'> => {

    while(!session.finished){

      const hold = await db_manager.find_dork_hold(hold_id);
      if(!hold){ return 'CANCELLED'; }

      if(hold.state === 'SOLVED' || hold.state === 'DISCARDED'){
        session.view.held_session_id = null;
        return hold.state;
      }

      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    return 'CANCELLED';
  };

  /*
   * the dork that picks the page the recorder opens on. one answer is all the
   * recording needs, and it is found in the same crawler chrome profile the
   * ticks use, so cookies a solve window plants carry straight into it. the
   * recorder window that follows lives in the recorder profile, two different
   * directories precisely because they are open at the same time
   */
  const find_first_page = async () : Promise<{ first : string } | { failed : string }> => {

    while(!session.finished){

      const release_dir = await acquire_crawler_dir(60_000);
      if(!release_dir){
        return { failed : 'the crawler chrome directory stayed busy, try again in a moment' };
      }

      let browser : Browser | null = null;
      let held : Awaited<ReturnType<typeof db_manager.hold_dork>> = null;

      try{

        browser = await launch_crawler_browser({
          headless : true,
          user_data_dir : CRAWLER_CHROME_DIR
        });

        let first : string | null = null;
        let blocked : DorkBlocked | null = null;

        try{
          first = await run_dork_first(browser, profile);
        }
        catch(err){
          if(is_dork_blocked(err)){ blocked = err; }
          else{ throw err; }
        }

        if(!blocked){
          release_dir();
          if(browser){ await browser.close().catch(() => {}); browser = null; }

          if(!first){
            const dork = build_dork(profile);
            console.error(`[CRAWLING] no results for dork: ${dork}`);
            return { failed : 'the dork found no page, adjust the url section or the keywords (dork: ' + dork + ')' };
          }

          session.view.page_url = first;
          return { first };
        }

        held = await db_manager.hold_dork(profile, blocked.dork, blocked.kind, 'recording');
        if(!held){
          return { failed : 'could not record the blocked dork for solving' };
        }

        session.view.held_session_id = held.id;
        console.log(`[CRAWLING SESSION ${session_id}] dork held (${blocked.kind}) for solving`);

      }
      finally{
        //the lock has to go before the wait, the solve window needs this dir
        release_dir();
        if(browser){ await browser.close().catch(() => {}); }
      }

      if(!held){ return { failed : 'the blocked dork could not be kept for solving' }; }

      const verdict = await wait_for_hold(held.id);
      if(verdict !== 'SOLVED'){
        return { failed : verdict === 'CANCELLED'
          ? 'the recording was aborted'
          : 'the blocked dork was dismissed, recording aborted' };
      }

      //solved: loop and run the dork again on the cookies just planted
    }

    return { failed : 'the recording was aborted' };
  };

  try{

    //the recorder only opens on a real page, so first find one
    const first = await find_first_page();

    if('failed' in first){
      finalize('FAILED', first.failed);
      return;
    }

    session.view.status = 'RECORDING';

    browser = await launch_browser();
    page = await browser.newPage();
    page.on('close', on_page_close);

    page.on('popup', ( spawned : Page | null ) => {
      if(session.finished || !spawned){ return; }
      const previous = page;
      install_recorder(spawned).catch((err) => {
        console.error(`[CRAWLING POPUP ERROR] ${err}`);
      });
      spawned.on('close', on_page_close);
      page = spawned;
      previous?.off('close', on_page_close);
      previous?.close().catch(() => {});
    });

    await install_recorder(page);
    await page.goto(first.first, { waitUntil : 'networkidle2' });

    timer = setInterval(() => { drain_once(); }, DRAIN_INTERVAL_MS);

    session.teardown = () => {
      stop_timer();
      close_browser();
    };

    browser.on('disconnected', () => {
      if(session.finished){ return; }
      drain_once().then(() => finalize('DONE', null));
    });

  }
  catch(err){
    finalize('FAILED', `${err}`);
    close_browser();
  }
};

export const start_session = ( profile : Profile )
: { session : CrawlingSession } | { error : string } => {

  //the dork cannot be built without either half, and there is no page to
  //point the recorder at without the dork
  if(!profile.platform_domain.trim()){
    return { error : 'the platform domain is required to build the search' };
  }
  if(!profile.url_section.trim()){
    return { error : 'the url section is required to build the search' };
  }

  evict_sessions();

  const session_id = crypto.randomUUID();

  const session : StoredSession = {
    view : {
      session_id,
      status : 'PENDING',
      error : null,
      result : { post_selector : [], description_selector : [] },
      page_url : null,
      held_session_id : null
    },
    profile,
    created_at : Date.now(),
    finished : false,
    last_seq : 0,
    collected : [],
    teardown : null
  };

  sessions.set(session_id, session);

  run_session(session_id, profile).catch((err) => {
    console.error(`[CRAWLING SESSION ${session_id} ERROR] ${err}`);
  });

  return { session : session.view };
};

export const get_session = ( session_id : string ) : CrawlingSession | null => {
  const session = sessions.get(session_id);
  return session ? session.view : null;
};

export const abort_session = ( session_id : string ) : boolean => {

  const session = sessions.get(session_id);
  if(!session || session.finished){ return false; }

  session.finished = true;
  session.view.status = 'FAILED';
  session.view.error = 'aborted by the user';
  session.teardown?.();

  console.log(`[CRAWLING SESSION ${session_id}] FAILED : aborted by the user`);

  return true;
};
