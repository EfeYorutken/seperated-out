import type { Browser, Page } from 'puppeteer';

import type { Profile } from '../global_types/profile.ts';

const NAV_TIMEOUT_MS = 30_000;
//politeness between result pages, google answers a burst of pagers badly
const PAGE_PAUSE_MS = 1000;
//how far down the result list one tick is willing to walk
const MAX_RESULTS = 100;

//the entry a serp is reached by: 'typed' warms up google.com and types into the
//search box like a person would, 'direct' is the cold GET /search the paging
//steps and the test searchers fall back to
type SerpEntry = 'typed' | 'direct';

const HOMEPAGE_URL = 'https://www.google.com/';
const SEARCH_BOX_SELECTOR = 'textarea[name="q"], input[name="q"]';

//how fast the dork is typed into the box, a real keystroke stream rather than a
//paste, which is itself a tell
const TYPING_DELAY_MS = (() => {
  const raw = Deno.env.get('DORK_TYPING_DELAY_MS');
  if(!raw){ return 40; }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 40;
})();

//the human entry can be switched off, the paging fallback and a plain request
//from a hostile network still want the old cold path
const human_entry_enabled = () : boolean => {
  const raw = (Deno.env.get('DORK_HUMAN_ENTRY') ?? '').trim().toLowerCase();
  return !(raw === '0' || raw === 'false' || raw === 'off' || raw === 'no');
};

//the deno lib used here has no dom, so the bits evaluate() needs are spelled
//out instead of taken from the compiler
type AnchorNode = {
  href? : string;
  textContent? : string | null;
  value? : string;
  closest? : ( selector : string ) => AnchorNode | null;
  click? : () => void;
};
type MinimalDocument = {
  querySelectorAll : ( selector : string ) => Iterable<AnchorNode>;
  querySelector? : ( selector : string ) => AnchorNode | null;
};

const pause = ( ms : number ) : Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

//a keyword can be a phrase, and a phrase in a google query has to be quoted
const phrase = ( term : string ) : string => {
  return /\s/.test(term) ? `"${term.replace(/"/g, '')}"` : term;
};

const clean_domain = ( raw : string ) : string => {
  return raw.trim()
    .replace(/^https?:\/\//i, '')
    .split('/')[0]
    .toLowerCase();
};

/*
 * thrown where google stood between a dork and its results. unlike a dead
 * network or a malformed page this is not something the crawler can shrug off:
 * the user has to solve the wall once, in a headful window on the same chrome
 * profile the headless dork uses, so the cookies carry over
 */
export type DorkBlockKind = 'captcha' | 'consent';

export class DorkBlocked extends Error {
  readonly kind : DorkBlockKind;
  //the exact query that was blocked, the solve window opens this on google
  readonly dork : string;

  constructor(kind : DorkBlockKind, dork : string, message : string){
    super(message);
    this.kind = kind;
    this.dork = dork;
  }
}

export const is_dork_blocked = ( err : unknown ) : err is DorkBlocked => {
  return err instanceof DorkBlocked;
};

//the search url a dork maps to, shared by the crawl and the solve window so a
//user solves the very same page the headless browser was pushed off
const serp_url = ( dork : string, start : number ) : string => {
  return `https://www.google.com/search?q=${encodeURIComponent(dork)}&num=100&start=${start}`;
};

/*
 * the whole search, in one query: site: picks the platform, inurl: picks the
 * url section that separates a posting from anything else, the keywords become
 * an or-group, every anti keyword becomes an exclusion and the publish date
 * becomes after:. gathering and judgement are the same string, so nothing has
 * to be filtered again after google answered
 */
export const build_dork = ( profile : Profile ) : string => {

  const parts : string[] = [];

  const domain = clean_domain(profile.platform_domain ?? '');
  if(domain){ parts.push(`site:${domain}`); }

  const section = (profile.url_section ?? '').trim();
  if(section){ parts.push(`inurl:${phrase(section)}`); }

  const words = (profile.keywords ?? [])
    .map((keyword) => keyword.trim())
    .filter((keyword) => keyword.length > 0);

  if(words.length === 1){
    parts.push(phrase(words[0]));
  }
  else if(words.length > 1){
    parts.push(`(${words.map(phrase).join(' OR ')})`);
  }

  for(const anti of (profile.anti_keywords ?? [])){
    const trimmed = anti.trim();
    if(trimmed){ parts.push(`-${phrase(trimmed)}`); }
  }

  const after = (profile.publish_after ?? '').trim();
  if(after){ parts.push(`after:${after}`); }

  return parts.join(' ');

};

//every h3 google puts inside an anchor is a result title, and walking up from
//it is sturdier than memorising which container id the current SERP uses
const collect_result_links = async ( page : Page ) : Promise<string[]> => {

  return await page.evaluate(() => {

    const doc = (globalThis as unknown as { document : MinimalDocument }).document;
    const links : string[] = [];

    for(const heading of doc.querySelectorAll('h3')){

      const anchor = heading.closest ? heading.closest('a[href]') : null;
      const href = anchor && anchor.href ? anchor.href : null;
      if(!href){ continue; }

      let host = '';
      try{
        host = new URL(href).hostname;
      }
      catch{
        continue;
      }

      //the anchor google wraps its own links in, never a found page
      if(/(^|\.)google\./i.test(host)){ continue; }
      if(!/^https?:/i.test(href)){ continue; }

      if(!links.includes(href)){ links.push(href); }

    }

    return links;

  }) as unknown as Promise<string[]>;

};

const captcha_present = async ( page : Page ) : Promise<boolean> => {

  const url = page.url();
  if(url.includes('/sorry/') || url.includes('accounts.google.com')){ return true; }

  return await page.evaluate(() => {
    const doc = (globalThis as unknown as { document : MinimalDocument }).document;
    if(!doc.querySelector){ return false; }
    return Boolean(
      doc.querySelector('#captcha-form') ||
      doc.querySelector('iframe[src*="recaptcha"]')
    );
  }) as unknown as Promise<boolean>;

};

//the consent wall stands between the query and its results. any of the buttons
//that dismisses it counts, cookies are not what this crawler is here for
const pass_consent = async ( page : Page ) : Promise<boolean> => {

  const clicked = await page.evaluate(() => {

    const doc = (globalThis as unknown as { document : MinimalDocument }).document;
    const wanted = [ 'accept all', 'i agree', 'reject all' ];

    for(const node of doc.querySelectorAll('button, [role="button"], a, input[type="submit"]')){

      const text = ((node.textContent ?? node.value ?? '')).trim().toLowerCase();
      if(!text){ continue; }

      if(wanted.some((label) => text === label || text.startsWith(label))){
        if(node.click){ node.click(); return true; }
      }

    }

    return false;

  }) as unknown as Promise<boolean>;

  if(!clicked){ return false; }

  await page.waitForNavigation({
    waitUntil : 'domcontentloaded',
    timeout : 10_000
  }).catch(() => {});

  return !page.url().includes('consent.google.com');

};

/*
 * the human entry: open google, clear the consent wall, type the dork into the
 * search box and submit it.
 *
 * this is the whole point of the exercise. a cold GET /search?q= arrives with
 * no session, no referer and a history that says bot; a typed query arrives on
 * the back of a homepage visit, the cookies that visit plants and the suggest
 * traffic the box itself makes, so the same words are a far less interesting
 * request to challenge
 */
const enter_dork = async ( page : Page, dork : string ) : Promise<boolean> => {

  await page.goto(HOMEPAGE_URL, {
    waitUntil : 'domcontentloaded',
    timeout : NAV_TIMEOUT_MS
  });

  if(page.url().includes('consent.google.com')){
    if(!await pass_consent(page)){
      throw new DorkBlocked(
        'consent',
        dork,
        'google asked for a consent choice and no button dismissed it'
      );
    }
    await page.goto(HOMEPAGE_URL, {
      waitUntil : 'domcontentloaded',
      timeout : NAV_TIMEOUT_MS
    });
  }

  await page.waitForSelector(SEARCH_BOX_SELECTOR, { timeout : 10_000 }).catch(() => {});

  const box = await page.$(SEARCH_BOX_SELECTOR);

  if(!box){
    //no box means google put something in front of the homepage itself
    if(await captcha_present(page)){
      throw new DorkBlocked(
        'captcha',
        dork,
        'google served a captcha before the search box appeared'
      );
    }
    throw new DorkBlocked(
      'consent',
      dork,
      'google served no search box on the homepage'
    );
  }

  //a triple click clears whatever a previous profile left in the box
  await box.click({ count : 3 }).catch(() => {});
  await box.type(dork, { delay : TYPING_DELAY_MS });

  await Promise.all([
    page.waitForNavigation({
      waitUntil : 'domcontentloaded',
      timeout : NAV_TIMEOUT_MS
    }).catch(() => {}),
    page.keyboard.press('Enter')
  ]);

  //the submit is client side and does not always fire waitForNavigation, so the
  //result url is waited for directly as the sturdier of the two signals
  await page.waitForFunction(
    'window.location.pathname.indexOf("/search") === 0',
    { timeout : 10_000 }
  ).catch(() => {});

  //false means the typing never turned into a search, the caller falls back to
  //the plain request rather than reading whatever page it is sitting on
  return page.url().includes('/search');

};

/*
 * one visit to the search result page. returns the result links, null when
 * google had nothing for the query, and throws a DorkBlocked when google put a
 * wall (a consent choice or a captcha) between the query and its answers.
 *
 * entry says how the page is reached: a typed first page goes through the
 * homepage and the search box, a direct page is the plain GET the paging walk
 * uses
 */
const read_serp = async (
  page : Page,
  dork : string,
  url : string,
  entry : SerpEntry = 'direct'
) : Promise<string[] | null> => {

  if(entry === 'typed' && human_entry_enabled()){
    const reached = await enter_dork(page, dork);
    //a typed entry that did not land on a result page is not fatal, the plain
    //request is the safety net it has always been
    if(!reached){
      await page.goto(url, {
        waitUntil : 'domcontentloaded',
        timeout : NAV_TIMEOUT_MS
      });
    }
  }
  else{
    await page.goto(url, {
      waitUntil : 'domcontentloaded',
      timeout : NAV_TIMEOUT_MS
    });
  }

  if(page.url().includes('consent.google.com')){

    if(!await pass_consent(page)){
      throw new DorkBlocked(
        'consent',
        dork,
        'google asked for a consent choice and no button dismissed it'
      );
    }

    //the consent page does not always send the browser back to the query
    await page.goto(url, {
      waitUntil : 'domcontentloaded',
      timeout : NAV_TIMEOUT_MS
    });

    if(page.url().includes('consent.google.com')){
      throw new DorkBlocked('consent', dork, 'google kept asking for consent');
    }

  }

  if(await captcha_present(page)){
    throw new DorkBlocked(
      'captcha',
      dork,
      'google served a captcha or an unusual traffic page, ' +
      'it was held for the user to solve'
    );
  }

  //results render after domcontentloaded, and a page with nothing to wait
  //for is allowed to time out here rather than fail a profile
  await page.waitForSelector('h3', { timeout : 5000 }).catch(() => {});

  const links = await collect_result_links(page);

  //an empty page means the dork matched nothing
  if(!links.length){ return null; }

  return links;
};

const google_search = async ( browser : Browser, profile : Profile ) : Promise<string[]> => {

  const dork = build_dork(profile);
  console.log(`[DORK] '${profile.name}' google query: ${dork}`);

  const page = await browser.newPage();

  try{

    const found : string[] = [];
    const seen = new Set<string>();
    let start = 0;
    let first_page = true;

    while(found.length < MAX_RESULTS){

      //num asks for a wide page, start walks it. start advances by what google
      //actually sent rather than by what was asked for, so a google that
      //silently answers with ten results cannot skip the ten after them
      //
      //only the first page is typed into the box, the pages after it are the
      //plain start walk: there is no search box to use on a result list
      const entry : SerpEntry = first_page ? 'typed' : 'direct';
      first_page = false;

      const links = await read_serp(page, dork, serp_url(dork, start), entry);

      //a page of nothing but repeats means google has no more of them to give
      if(!links){ break; }

      let fresh = 0;
      for(const link of links){
        if(seen.has(link)){ continue; }
        seen.add(link);
        found.push(link);
        fresh += 1;
        if(found.length >= MAX_RESULTS){ break; }
      }

      if(!fresh){ break; }

      start += links.length;
      await pause(PAGE_PAUSE_MS);

    }

    console.log(`[DORK] '${profile.name}' found ${found.length} result url(s)`);
    return found;

  }
  finally{
    await page.close().catch(() => {});
  }

};

export type DorkSearcher = ( browser : Browser, profile : Profile ) => Promise<string[]>;

let active_search : DorkSearcher = google_search;

/*
 * the smoke tests must not ask google anything, they hand in a searcher that
 * returns the urls of a site served locally. passing null puts google back
 */
export const set_searcher_for_tests = ( searcher : DorkSearcher | null ) : void => {
  active_search = searcher ?? google_search;
};

export const run_dork = ( browser : Browser, profile : Profile ) : Promise<string[]> => {
  return active_search(browser, profile);
};

/*
 * the one result the recording flow wants. the dork that produces a postings
 * page is usually narrow enough that the first answer is the page to point
 * the user at, and opening a results window on every url of a multi-page
 * crawl would waste the recorder turn
 */
const google_first_result = async ( browser : Browser, profile : Profile ) : Promise<string | null> => {

  const dork = build_dork(profile);
  console.log(`[DORK] '${profile.name}' first-result query: ${dork}`);

  const page = await browser.newPage();

  try{
    const links = await read_serp(page, dork, serp_url(dork, 0), 'typed');
    return links?.[0] ?? null;
  }
  finally{
    await page.close().catch(() => {});
  }

};

export type DorkFirstSearcher = ( browser : Browser, profile : Profile ) => Promise<string | null>;

let active_first : DorkFirstSearcher = google_first_result;

//the smoke tests do not want a solve window to open on a real google serp,
//they hand in a first-result searcher that answers from a local page instead
export const set_first_searcher_for_tests = ( searcher : DorkFirstSearcher | null ) : void => {
  active_first = searcher ?? google_first_result;
};

export const run_dork_first = ( browser : Browser, profile : Profile ) : Promise<string | null> => {
  return active_first(browser, profile);
};
