import type { Browser } from 'puppeteer';

import type { Profile } from '../global_types/profile.ts';

import * as db_manager from './db_stuff.ts';
import { is_dork_blocked, run_dork } from './dork.ts';
import { acquire_crawler_dir } from './chrome_lock.ts';
import { crawl_interval_ms } from './interval.ts';
import * as matching from './matching.ts';
import { launch_crawler_browser, read_post, CRAWLER_CHROME_DIR } from './replay.ts';
import { is_solve_active } from './solves.ts';

export type TickReport = {
  profiles : number;
  //elements the post selectors matched, and how many of them held every
  //description selector. the funnel, so a selector that kept nothing is
  //visible without a debugger
  marked : number;
  eligible : number;
  //found urls that produced something to store
  matched : number;
  stored : number;
  //found urls whose hash was already known, so they were not read again
  disregarded : number;
  errors : number;
  //dorks google blocked, held for the user to solve
  held : number;
};

const report = ( tally : TickReport, ms : number ) : void => {
  const secs = (ms / 1000).toFixed(1);
  last_report = { ...tally, tick : tick_number, ms };
  console.log(
    `[SCHEDULER] tick ${tick_number} | ${secs}s profiles=${tally.profiles} ` +
    `marked=${tally.marked} postings=${tally.eligible} matched=${tally.matched} ` +
    `new=${tally.stored} disregarded=${tally.disregarded} ` +
    `errors=${tally.errors} held=${tally.held}`
  );
};

/*
 * what came of one chunk of text. kept apart from the tally so the sequence
 * can be tested against the test database without a browser or a scheduler
 */
export type StoreOutcome = {
  //the text had been seen before, the hash was already there
  disregarded : boolean;
  //a position was written
  stored : boolean;
  //the position insert itself failed, nothing was written anywhere
  failed : boolean;
  //another crawl took the same posting between the check and the write
  lost_race : boolean;
};

/*
 * one posting, one position, one hash, and the ORDER matters more than it
 * looks: the position is written first and the hash second.
 *
 * the hash is taken from the found url, not from the text: the dork is what
 * decided this page is worth reading, so the url is the posting's identity and
 * the same url is never read twice. writing the hash first needs an unwind, and
 * an unwind that fails leaves a hash with no position behind it. consider_text
 * then reads hash_known, says the posting was seen, and never retries it, so a
 * single transient insert failure costs that posting forever. the reverse order
 * cannot produce an orphan: the worst a crash between the two writes can do is
 * repeat one position on a later tick, which the reader can live with
 */
export const store_position = async(
  profile : Profile,
  page_url : string,
  text : string,
  title? : string
) : Promise<StoreOutcome> => {

  const hash = await matching.content_hash(page_url);

  //the cheap fast path in front of the two writes
  if(await db_manager.hash_known(hash)){
    return { disregarded : true, stored : false, failed : false, lost_race : false };
  }

  const stored = await db_manager.add_position(
    matching.build_position(profile, page_url, text, title)
  );

  //nothing has been written to the hashes collection yet, so there is nothing
  //to undo and the next tick is free to try this posting again
  if(!stored){
    return { disregarded : false, stored : false, failed : true, lost_race : false };
  }

  /*
   * the position is already in, so a failure here is cosmetic. a duplicate
   * key means another crawl stored the same posting moments ago and a read
   * failure means the dedupe record is delayed by a tick. neither is a reason
   * to remove a position that is already stored
   */
  const remembered = await db_manager.remember_hash({
    hash,
    profile_id : profile.id,
    profile_name : profile.name,
    url : page_url,
    recorded_at : new Date()
  });

  return {
    disregarded : false,
    stored : true,
    failed : false,
    lost_race : !remembered
  };

};

const consider_text = async(
  profile : Profile,
  page_url : string,
  text : string,
  title : string | undefined,
  tally : TickReport
) : Promise<void> => {

  const result = await store_position(profile, page_url, text, title);

  if(result.disregarded){
    tally.disregarded += 1;
    return;
  }

  if(result.failed){
    //no hash was written, so this posting is not lost, the next tick retries it
    tally.errors += 1;
    console.error(`[SCHEDULER] could not store a position from ${page_url}`);
    return;
  }

  if(result.lost_race){
    console.warn(
      `[SCHEDULER] stored a position for ${page_url} but could not record its ` +
      `hash, another crawl may store it again`
    );
  }

  tally.stored += 1;

};

const consider_profile = async(
  browser : Browser,
  profile : Profile,
  tally : TickReport
) : Promise<void> => {

  let urls : string[];

  try{
    urls = await run_dork(browser, profile);
  }
  catch(err){
    /*
     * a consent wall google would not dismiss or a captcha: this profile has
     * nothing more to give this tick, and the wall is put on hold so the user
     * can solve it once in a headful window on this same chrome profile
     */
    if(is_dork_blocked(err)){
      tally.held += 1;
      await db_manager.hold_dork(profile, err.dork, err.kind, 'tick');
      console.error(`[SCHEDULER] dork for '${profile.name}' blocked (${err.kind}), held for solving`);
      return;
    }
    //anything else is a dead network or a broken page, free to try again next tick
    tally.errors += 1;
    console.error(`[SCHEDULER] dork failed for '${profile.name}': ${err}`);
    return;
  }

  for(const url of urls){

    try{

      //the found url IS the posting's identity, so a url that was already
      //stored is skipped before the page is even opened
      const hash = await matching.content_hash(url);

      if(await db_manager.hash_known(hash)){
        tally.disregarded += 1;
        continue;
      }

      const found = await read_post(browser, url, profile);

      tally.marked += found.marked;
      tally.eligible += found.eligible;

      /*
       * the page held nothing that satisfied every description selector. no
       * hash is written, so a page that simply had not finished rendering yet
       * is read again on the next tick instead of being lost forever
       */
      if(!found.items.length){ continue; }

      tally.matched += 1;

      //one position per found url, the first candidate that passed the gate.
      //the url stays the dork's own, a redirect on the way in does not make
      //the posting a different posting
      await consider_text(profile, url, found.items[0].text, found.items[0].title, tally);

    }
    catch(err){
      //one dead page must not cost the profile the rest of its results
      tally.errors += 1;
      console.error(`[SCHEDULER] '${profile.name}' could not read ${url}: ${err}`);
    }

  }

};

let tick_number = 0;
let running = false;
let timer : ReturnType<typeof setInterval> | undefined = undefined;
let last_report : (TickReport & { tick : number; ms : number }) | null = null;

const tick = async() : Promise<void> => {

  const started = Date.now();
  const tally : TickReport = {
    profiles : 0, marked : 0, eligible : 0, matched : 0, stored : 0,
    disregarded : 0, errors : 0, held : 0
  };

  const profiles = await db_manager.get_profiles();
  tally.profiles = profiles.length;

  if(!profiles.length){
    console.log('[SCHEDULER] no profiles to check');
    return;
  }

  //the crawler chrome dir can only serve one browser process at a time. a
  //solve window parked on it means this tick has nothing to do, and grabbing
  //it anyway is how a chrome launch fails
  const release_dir = await acquire_crawler_dir(0);
  if(!release_dir){
    console.log('[SCHEDULER] the crawler chrome dir is busy, skipping this tick');
    report(tally, Date.now() - started);
    tick_number += 1;
    return;
  }

  let browser : Browser | null = null;

  try{

    /*
     * the crawler dir, so a session the recording signed into by hand is still
     * there on the next tick. nothing here signs in on its own: cookies and
     * consent choices made by hand in the recorder's window outlive one tick
     * when both windows point at the same chrome profile, and the dork and
     * every page it finds are read in the same browser every time
     */
    browser = await launch_crawler_browser({
      headless : true,
      user_data_dir : CRAWLER_CHROME_DIR
    });

    for(const profile of profiles){
      await consider_profile(browser, profile, tally);
    }

  }
  catch(err){
    tally.errors += 1;
    console.error(`[SCHEDULER] browser failure: ${err}`);
  }
  finally{
    if(browser){ await browser.close().catch(() => {}); }
    release_dir();
  }

  report(tally, Date.now() - started);
  tick_number += 1;

};

const guarded_tick = async() : Promise<void> => {
  //a slow site must not stack overlapping crawls of the same profiles
  if(running){
    console.log('[SCHEDULER] previous tick is still going, skipping this one');
    return;
  }

  //a solve window is using the crawler chrome profile right now, the tick
  //must not fight it for the directory
  if(is_solve_active()){
    console.log('[SCHEDULER] an anti-bot solve window is open, skipping this tick');
    return;
  }

  running = true;

  try{
    await tick();
  }
  catch(err){
    console.error(`[SCHEDULER] tick error: ${err}`);
  }
  finally{
    running = false;
  }

};

export const start_scheduler = () : void => {

  if(timer !== undefined){ return; }

  const every = crawl_interval_ms();
  timer = setInterval(guarded_tick, every);

  //no immediate tick, a deno --watch reload should not hammer every platform
  console.log(`[SCHEDULER] started, checking every ${Math.round(every / 1000)}s`);

};

export const stop_scheduler = () : void => {

  if(timer === undefined){ return; }

  clearInterval(timer);
  timer = undefined;
  console.log('[SCHEDULER] stopped');

};

//exposed for the smoke test, production only ever goes through start_scheduler
export const run_scheduler_now = async() : Promise<void> => {
  await guarded_tick();
};

export const last_tick_report = () => last_report;

//how long a retry-now will wait for a tick that is still holding the chrome dir
const RETRY_DIR_TIMEOUT_MS = 60_000;

/*
 * the "retry now" behind a solved hold: run one profile's dork again, in the
 * same headless browser and chrome profile the ticks use, so cookies a solve
 * window just planted are exactly what the dork reads. a fresh wall produces a
 * fresh hold, which is honest rather than looping silently
 */
export const retry_dork_hold = async ( hold_id : string ) : Promise<boolean> => {

  const hold = await db_manager.find_dork_hold(hold_id);
  if(!hold || hold.state !== 'SOLVED'){ return false; }

  const profiles = await db_manager.get_profiles();
  const profile = profiles.find((candidate) => candidate.id === hold.profile_id);
  if(!profile){
    console.error(`[SCHEDULER] no profile ${hold.profile_id} to retry`);
    return false;
  }

  const tally : TickReport = {
    profiles : 1, marked : 0, eligible : 0, matched : 0, stored : 0,
    disregarded : 0, errors : 0, held : 0
  };

  let browser : Browser | null = null;

  const release_dir = await acquire_crawler_dir(RETRY_DIR_TIMEOUT_MS);
  if(!release_dir){
    console.error('[SCHEDULER] the crawler chrome dir stayed busy, retry later');
    return false;
  }

  try{
    browser = await launch_crawler_browser({
      headless : true,
      user_data_dir : CRAWLER_CHROME_DIR
    });
    await consider_profile(browser, profile, tally);
    return true;
  }
  catch(err){
    console.error(`[SCHEDULER] retry error for '${profile.name}': ${err}`);
    return false;
  }
  finally{
    if(browser){ await browser.close().catch(() => {}); }
    release_dir();
  }

};
