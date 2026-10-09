import puppeteer, { type Browser, type Page } from 'puppeteer';

import type { Profile } from '../global_types/profile.ts';

export const CHROMIUM_PATH = '/usr/bin/chromium';

const NAV_TIMEOUT_MS = 30_000;
const IDLE_TIMEOUT_MS = 5_000;
const IDLE_TIME_MS = 500;

/*
 * a saved selector is deliberately broad (see general_path in
 * page_script.ts), so it can match nodes the page has not finished rendering
 * when the query lands. pausing before the content check gives the late ones a
 * chance to show up, and a node that only exists now would otherwise be
 * reported as a selector that matches nothing
 */
const CONTENT_WAIT_MS = 1500;

/*
 * how patient the section lookup is before it gives up. a live page renders on
 * its own schedule and a single scan is a single snapshot, so a selector that
 * matched on the first pass can be a second away from rendering. the observed
 * symptom was a post_selector reporting that it found no element for a selector
 * that had just appeared, so the scan is retried rather than trusted
 */
export const STEP_ATTEMPTS = 3;
const STEP_RETRY_MS = 1_000;

/*
 * where the chrome profiles live.
 *
 * nothing here knows which site is being crawled. a sign in is not a special
 * case, it is something the user did by hand in a window of their own
 *
 * the two are separate because only one process can hold a userDataDir at a
 * time, and a recording session must not collide with a live tick. the
 * recorder's exists so the user can sign in by hand and point at selectors
 * whenever they need to. the crawler's exists so a session like that survives
 * to the next tick, which is why the dork and every page it finds are read in
 * the same browser profile every time
 */
const repo_root = new URL('../', import.meta.url).pathname;

export const CRAWLER_CHROME_DIR = Deno.env.get('CRAWLER_CHROME_DIR')
  ?? `${repo_root}.crawler_chrome`;

export const RECORDER_CHROME_DIR = Deno.env.get('RECORDER_CHROME_DIR')
  ?? `${repo_root}.recorder_chrome`;

export const launch_crawler_browser = async (
  options : { headless : boolean; user_data_dir? : string }
) : Promise<Browser> => {

  const settings = {
    headless : options.headless,
    executablePath : CHROMIUM_PATH,
    //one viewport for both modes: a headless that renders at one size and a
    //headful window at another is itself a tell, especially when a solve in
    //the headful profile is meant to carry into a headless dork
    defaultViewport : { width : 1366, height : 900 },
    //left out entirely when not asked for, so a caller that wants a throwaway
    //browser still gets one
    ...(options.user_data_dir ? { userDataDir : options.user_data_dir } : {}),
    args : [
      '--disable-dev-shm-usage',
      //the flag that unsets navigator.webdriver, the loudest automation tell
      //there is. the dork, the solve window and the recorder all share it
      '--disable-blink-features=AutomationControlled'
    ]
  };

  try{
    return await puppeteer.launch(settings);
  }
  catch(err){
    console.warn(`[CRAWLING LAUNCH ERROR] ${err}, retrying with --no-sandbox`);
    return await puppeteer.launch({ ...settings, args : [ ...settings.args, '--no-sandbox' ] });
  }

};

//covers both navigating and in page clicks, and a page that never goes idle
//must not stall the whole crawl for IDLE_TIMEOUT_MS on every single step
const settle = async ( target : Page ) : Promise<void> => {
  await target.waitForNetworkIdle({
    idleTime : IDLE_TIME_MS,
    timeout : IDLE_TIMEOUT_MS
  }).catch(() => {});
};

//the deno lib used here has no dom, so the bits of it evaluate() needs are
//spelled out instead of taken from the compiler
type ReadableNode = { innerText? : string; textContent : string | null };
type MinimalDocument = { querySelectorAll : ( selector : string ) => Iterable<ReadableNode> };

/*
 * one page the dork handed back, and whatever was read off it.
 *
 * overlaps are gone with the unmarked path: a post is only ever read through
 * post_selector, and the candidates of one selector never land on one element
 * twice
 */
export type PostOutcome = {
  items : FoundContent[];
  page_url : string;
  //how many elements the post_selector matched, and how many held every
  //description section. the funnel, so a selector that kept nothing says why
  marked : number;
  eligible : number;
};

/*
 * one thing worth reading. the text is what gets stored as the posting, the
 * title is what a frontend row shows, both read off the same element in one
 * pass. application_link is the url the dork found, never something off the
 * page itself, so it lives with the caller
 */
export type FoundContent = {
  text : string;
  title : string;
};

const pause = ( ms : number ) : Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

/*
 * a tag on its own, with no id, no class and no attribute behind it. recording
 * falls this far through only when the element had nothing else to offer, and
 * such a selector is the one shape that cannot tell two elements of the same
 * kind apart, so it needs saying out loud when it fans out
 */
export const is_bare_tag = ( selector : string ) : boolean => {
  //a tag, then letters, digits and the hyphens a custom element needs
  return /^[a-z][a-z0-9-]*$/i.test(selector.trim());
};

/*
 * what one element the post selector matched turned out to be. the page is
 * only asked for facts, the decision of which ones to read is kept in Node so
 * the rule can be tested without a browser
 */
export type CandidateFacts = {
  //where it sat in the post selector's matches. `contains` speaks in these
  //numbers, so a candidate has to be able to point at another one
  index : number;
  //which of the saved sections this one matches or holds inside it
  sections : string[];
  //indices of the other candidates this one holds. a node holding an eligible
  //node is the box the postings came in, not one of the postings
  contains : number[];
  text : string;
  //its heading, or its first link's text, or empty
  title : string;
};

export type CandidateGate = {
  eligible : CandidateFacts[];
  //each saved selector against how many candidates failed to hold it
  missing : Map<string, number>;
};

/*
 * the check the whole middle click exists for. a candidate is only read when it
 * holds EVERY saved section, and a candidate holding another eligible candidate
 * is dropped in favour of the one inside it.
 *
 * ALL, not ANY, and that has a cost worth naming: a user who right clicked both
 * a container and a posting inside it has saved a pair nothing can satisfy,
 * because the posting cannot contain its own container. keep_candidates says so
 * by name through `missing`, which is what the log line is built from
 */
export const keep_candidates = (
  facts : CandidateFacts[],
  every_section : string[]
) : CandidateGate => {

  const missing = new Map<string, number>();
  for(const section of every_section){ missing.set(section, 0); }

  const complete = facts.filter((fact) => {

    const absent = every_section.filter((section) => !fact.sections.includes(section));

    for(const section of absent){
      missing.set(section, (missing.get(section) ?? 0) + 1);
    }

    return absent.length === 0;

  });

  const eligible = complete.filter(
    (fact) => !complete.some((other) => fact.contains.includes(other.index))
  );

  return { eligible, missing };

};

/*
 * one round trip for every match, because a mark is meant to be general and
 * 'div.card' on a listing of two hundred is two hundred candidates. this only
 * reports; nothing here decides anything
 *
 * presence comes back in the same round trip for the same reason. it counts how
 * many of each saved section the page holds anywhere, and that number is what
 * separates a page that has not rendered its innards yet from one that never
 * has them: without it both look exactly alike, a mark that kept nothing
 */
type MarkedPresence = { [ section : string ] : number };

const scan_mark_candidates = async(
  page : Page,
  selector : string,
  sections : string[]
) : Promise<{ facts : CandidateFacts[]; presence : MarkedPresence }> => {

  return await page.evaluate(( wanted : string, saved : string[] ) => {

    const doc = (globalThis as unknown as { document : MinimalDocument }).document;

    type DatedNode = ReadableNode & {
      contains?: ( other : unknown ) => boolean;
      matches?: ( s : string ) => boolean;
      querySelector?: ( s : string ) => DatedNode | null;
      querySelectorAll?: ( s : string ) => Iterable<DatedNode>;
    };

    const nodes = [...doc.querySelectorAll(wanted)] as unknown as DatedNode[];

    /*
     * a card's heading says what the job is, and 'first line of the text' is
     * the fallback for a card that has no heading at all. nothing here tries to
     * guess a company or a location, those stay null until a profile extracts
     * them by name
     */
    const title_of = ( node : DatedNode ) : string => {
      try{
        const heading = node.querySelector?.('h1,h2,h3,h4,h5,h6');
        if(heading && heading.textContent){ return heading.textContent.trim(); }
        const link = node.querySelector?.('a');
        if(link && link.textContent){ return link.textContent.trim(); }
      }
      catch{
        return '';
      }
      return '';
    };

    const facts = nodes.map((node, index) => {

      const found : string[] = [];

      for(const section of saved){
        try{
          //both directions: the candidate may BE the section, and a section the
          //user right clicked on the card itself comes back as a match
          const inside = Boolean(
            (node.matches && node.matches(section)) ||
            (node.querySelector && node.querySelector(section))
          );
          if(inside){ found.push(section); }
        }
        catch{
          //a hand written or stale selector is a section nothing holds, and one
          //of those must not take the others down with it
          continue;
        }
      }

      const contains : number[] = [];
      for(const [ other_at , other ] of nodes.entries()){
        if(other === node){ continue; }
        if(node.contains && node.contains(other)){ contains.push(other_at); }
      }

      return {
        index,
        sections : found,
        contains,
        text : (node.innerText || node.textContent || '').trim(),
        title : title_of(node)
      };

    });

    /*
     * how many of each saved section this page holds at all. the per candidate
     * loop above can only say that a candidate lacks a section; this says whether
     * the section exists, which is the difference between a page still rendering
     * and a selector that is simply not this page's
     */
    const presence : MarkedPresence = {};
    for(const section of saved){
      try{ presence[section] = [...doc.querySelectorAll(section)].length; }
      catch{ presence[section] = 0; }
    }

    return { facts : facts as unknown as CandidateFacts[], presence };

  }, selector, sections) as unknown as { facts : CandidateFacts[]; presence : MarkedPresence };

};

/*
 * marked elements are read where they stand, so this never navigates and never
 * costs a branch slot. it does wait though, and on the sections rather than on
 * the mark.
 *
 * the old code returned as soon as the mark matched something, which is exactly
 * too early. a job card is in the dom long before the company, location and
 * description inside it are, so one round trip after the last step the mark is
 * there and its innards are not. every candidate then fails the gate for want of
 * a section that was a second away from rendering
 *
 * so the retry is keyed on the gate rather than on the mark, and what it waits
 * for depends on which of the two came up empty
 */
const scan_marked = async(
  page : Page,
  selector : string,
  sections : string[]
) : Promise<{
  facts : CandidateFacts[];
  gate : CandidateGate;
  presence : MarkedPresence;
}> => {

  let facts : CandidateFacts[] = [];
  let presence : MarkedPresence = {};
  let gate : CandidateGate = { eligible : [], missing : new Map<string, number>() };

  for(let attempt = 1; ; attempt++){

    const read = await scan_mark_candidates(page, selector, sections);
    facts = read.facts;
    presence = read.presence;

    if(facts.length){
      const gated = keep_candidates(facts, sections);
      //something survived the gate, so the page has what it needs and waiting
      //further would only be slower
      if(gated.eligible.length){
        return { facts, gate : gated, presence };
      }
      gate = gated;
    }

    if(attempt >= STEP_ATTEMPTS){ break; }

    /*
     * a mark that matched nothing wants the mark. a mark that matched and kept
     * nothing wants its innards, and any one of the sections appearing is the
     * page saying it is ready. the comma joined list waits for the first of them
     * and cannot wait forever for a section this page will never render, which
     * is the whole reason the wait is not on all of them
     */
    await page.waitForSelector(facts.length ? sections.join(',') : selector, {
      visible : true,
      timeout : STEP_RETRY_MS
    }).catch(() => {});

    await pause(CONTENT_WAIT_MS);

  }

  return { facts, gate, presence };

};

const report_mark = (
  profile_name : string,
  selector : string,
  gate : CandidateGate,
  total : number,
  presence : MarkedPresence
) : void => {

  if(gate.eligible.length){
    console.log(
      `[REPLAY] '${profile_name}' kept ${gate.eligible.length} of ${total} marked ` +
      `element(s) for '${selector}'`
    );
    return;
  }

  /*
   * this line is the whole reason keep_candidates counts its misses. a mark
   * that kept nothing used to be indistinguishable from a page with no postings
   * on it, and both showed up as matched=0 on the scheduler's tally
   */
  const reasons = [...gate.missing.entries()]
    .filter(([ , count ]) => count > 0)
    .map(([ section , count ]) => `'${section}' missing on ${count}`)
    .join(', ');

  /*
   * the verdict is the part worth reading, and it is what this pass was missing.
   * a section the page does not hold at all and a section the page does hold but
   * no marked element wrapped are different problems with different fixes, and
   * both used to end in the same sentence, which left the user guessing whether
   * to wait longer or re-record
   */
  const on_page = Object.entries(presence)
    .filter(([ , count ]) => count > 0)
    .map(([ section , count ]) => `${count} of '${section}'`)
    .join(', ');

  const verdict = on_page
    ? `the page does hold ${on_page}, so waiting was not the problem: the ` +
      `marked elements are not the ones those sections were recorded on`
    : `the page holds none of them, so they are not on this page at all and no ` +
      `amount of waiting will bring them. they were most likely recorded on ` +
      `another page, or the site has renamed them since`;

  console.log(
    `[REPLAY] '${profile_name}' marked ${total} element(s) with '${selector}' and ` +
    `none of them held every saved section${reasons ? ` (${reasons})` : ''}. ` +
    `the marked elements have to CONTAIN each right clicked selector, so a ` +
    `selector for a container around them can never be satisfied. ${verdict}`
  );

};

/*
 * every candidate one post selector matched, read in place. nothing is clicked
 * here: a posting is inspected where the dork sent the crawl, which is why one
 * selector costs no extra page load of its own
 */
const read_marked = async(
  page : Page,
  profile_name : string,
  selector : string,
  sections : string[]
) : Promise<{ items : FoundContent[]; matched : number }> => {

  const { facts, gate, presence } = await scan_marked(page, selector, sections);

  if(is_bare_tag(selector)){
    console.warn(
      `[REPLAY] post selector '${selector}' is a bare tag, ` +
      `so it matched ${facts.length} elements of every kind on the page. the ` +
      `saved sections decide which of them are postings, but middle click ` +
      `something with a class if the page gives it one`
    );
  }

  report_mark(profile_name, selector, gate, facts.length, presence);

  const items : FoundContent[] = [];
  const seen = new Set<string>();

  for(const fact of gate.eligible){
    if(!fact.text){ continue; }
    //two candidates can hold the same posting text, and one posting read
    //twice is one posting counted twice
    if(seen.has(fact.text)){ continue; }
    seen.add(fact.text);
    items.push({ text : fact.text, title : fact.title });
  }

  return { items, matched : facts.length };

};

/*
 * one page the dork handed back, opened and read through the profile's own
 * selectors: every post_selector is tried in turn and its candidates only
 * count when they hold every description_selector
 */
export const read_post = async(
  browser : Browser,
  page_url : string,
  profile : Profile
) : Promise<PostOutcome> => {

  const sections = [ ...(profile.description_selector ?? []) ];
  const marks = [ ...(profile.post_selector ?? []) ];

  if(!marks.length){
    throw new Error(`profile '${profile.name}' has no post_selector`);
  }

  const page = await browser.newPage();

  try{

    /*
     * domcontentloaded, not networkidle2.
     *
     * networkidle2 wants at most two requests in flight for half a second, and
     * a client rendered posting page never gets there: trackers, beacons and
     * long lived connections keep the count above two indefinitely, so the goto
     * sat out its whole 30s budget and threw on a page that had in fact loaded.
     * a heavy page made every tick cost that full timeout
     *
     * nothing is lost by asking for less here. settle() below already waits for
     * the network to quiet down on a best effort basis and it cannot throw, and
     * scan_marked retries a selector that has not rendered yet, so a section
     * that needs a moment to appear is already waited for where it matters
     */
    await page.goto(page_url, {
      waitUntil : 'domcontentloaded',
      timeout : NAV_TIMEOUT_MS
    });

    await settle(page);

    const items : FoundContent[] = [];
    const seen = new Set<string>();
    let marked = 0;

    for(const selector of marks){

      const read = await read_marked(page, profile.name, selector, sections);
      marked += read.matched;

      //the same text under two selectors is one posting, not two
      for(const item of read.items){
        if(seen.has(item.text)){ continue; }
        seen.add(item.text);
        items.push(item);
      }

    }

    return { items, page_url : page.url(), marked, eligible : items.length };

  }
  finally{
    await page.close().catch(() => {});
  }

};

