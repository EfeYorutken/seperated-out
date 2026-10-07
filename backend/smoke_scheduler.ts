//spins up a throwaway job board and runs the scheduler against it. the google
//search is replaced with a test searcher that hands back fixture urls, so the
//whole chain is proven: dork result -> url hash -> read the page -> first
//eligible posting -> stored, deduped and retried
//
//   deno run --allow-net --allow-env --allow-read --allow-write --allow-sys \
//     --allow-run smoke_scheduler.ts
import type { Profile } from '../global_types/profile.ts';

import * as db_manager from './db_stuff.ts';
import { DorkBlocked, set_searcher_for_tests } from './dork.ts';
import { run_scheduler_now, last_tick_report, store_position } from './scheduler.ts';
import {
  launch_crawler_browser, CRAWLER_CHROME_DIR, RECORDER_CHROME_DIR
} from './replay.ts';

const repo_root = new URL('../', import.meta.url).pathname;

const PORT = 8899;

/*
 * the job board. every url the test searcher hands back has its own page, and
 * every page carries a heading and at least one .detail section
 */
const job_page = ( id : string, extra = '' ) : string => `<!doctype html>
<html>
  <body>
    <h1>job ${id}</h1>
    <div class="detail">apply for job ${id} here</div>
    ${extra}
  </body>
</html>`;

const NO_DETAIL = `<!doctype html>
<html>
  <body>
    <h1>a posting with no readable section</h1>
    no .detail anywhere on this page
  </body>
</html>`;

//two eligible sections on one url, so the crawler has to pick the first
const TWO_DETAILS = `<!doctype html>
<html>
  <body>
    <h1>job dual</h1>
    <div class="detail">apply for job dual here</div>
    <div class="detail">a quieter sibling posting</div>
  </body>
</html>`;

const the_profile = ( overrides : Partial<Profile> = {} ) : Profile => {
  return {
    id : 0,
    name : 'smoke finder',
    platform_domain : 'smokeplatform.test',
    url_section : '/job/',
    publish_after : null,
    post_selector : [ '.detail' ],
    description_selector : [ '.detail' ],
    keywords : [ 'apply' ],
    anti_keywords : [],
    ...overrides
  };
};

const failures : string[] = [];

const check = ( label : string , ok : boolean ) : void => {
  if(!ok){ failures.push(label); }
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
};

const tally_of = ( label : string ) : void => {
  const report = last_tick_report();
  if(!report){
    console.log(`  ${label}: no tick ever ran`);
    return;
  }
  console.log(`  ${label}: marked=${report.marked} postings=${report.eligible} ` +
    `matched=${report.matched} new=${report.stored} ` +
    `disregarded=${report.disregarded} errors=${report.errors} held=${report.held}`);
};

const was_found_on = (link : string) : string => `http://127.0.0.1:${PORT}${link}`;

const main = async() : Promise<void> => {

  const server = Deno.serve({ port : PORT, onListen : () => {} }, ( request ) => {
    const { pathname } = new URL( request.url );

    if( pathname === '/job/nodetail' ){
      return new Response(NO_DETAIL, { headers : { 'content-type' : 'text/html' } });
    }

    if( pathname === '/job/dual' ){
      return new Response(TWO_DETAILS, { headers : { 'content-type' : 'text/html' } });
    }

    const job = pathname.match(/^\/job\/(\d+)$/);
    if(job){
      return new Response(job_page(job[1]), {
        headers : { 'content-type' : 'text/html' }
      });
    }

    return new Response('<h1>not a job page</h1>', { headers : { 'content-type' : 'text/html' } });
  });

  //the google search is replaced wholesale, and swapped per scenario
  let searcher_urls : string[] = [];
  set_searcher_for_tests(async (_browser, _profile) => searcher_urls);

  try{

    const connected = await db_manager.init_test_db();
    check('mongo is reachable', connected);
    if(!connected){ return; }

    await db_manager.clear_profiles();
    await db_manager.clear_positions();
    await db_manager.clear_hashes();

    /*
     * a run killed partway through never reaches the cleanup at the end, and
     * the validator below is what makes an insert fail on purpose. if it is
     * still fitted from a previous run every insert in this one fails for the
     * wrong reason, so it is lifted before anything else happens
     */
    await db_manager.stop_expiring_positions();

    console.log('\nhappy path\n');

    await db_manager.add_profile(the_profile());
    searcher_urls = [ was_found_on('/job/1') ];

    await run_scheduler_now();
    const first = last_tick_report();
    tally_of('first tick');
    check('the first tick found the one url', first?.matched === 1);
    check('the first tick stored exactly one position', first?.stored === 1);
    check('the first tick disregarded nothing', first?.disregarded === 0);
    check('the first tick reported no errors', first?.errors === 0);

    await run_scheduler_now();
    const second = last_tick_report();
    tally_of('second tick');
    check('the second tick stored nothing new', second?.stored === 0);
    check('the second tick disregarded the url as already seen', second?.disregarded === 1);
    check('the second tick reported no errors', second?.errors === 0);

    const positions = await db_manager.get_positions();

    check('exactly one position is in the database', positions.length === 1);
    check('exactly one hash is in the database', await db_manager.count_hashes() === 1);
    check('the posting text came off the page', positions[0]?.generic_information
      .description.includes('apply for job 1 here') === true);
    check('no heading inside the element, so the first line became the title',
      positions[0]?.generic_information.job_title === 'apply for job 1 here');
    check('every position is attributed to the profile', positions.every(
      (position) => position.found_by === 'smoke finder' &&
        position.generic_information.which_platform_was_it_found_on === 'smokeplatform.test'
    ));
    check('the application link is the url the dork found, not the page calling it something',
      positions[0]?.application_link === was_found_on('/job/1'));
    check('unknown fields were left null', positions.every(
      (position) => position.generic_information.company === null &&
        position.generic_information.location === null &&
        position.generic_information.date_of_publish === null
    ));

    console.log('\none position per found url\n');

    /*
     * one page with two readable sections still gives one position, and the
     * one stored is the first that passed the gate
     */
    await db_manager.clear_profiles();
    await db_manager.clear_positions();
    await db_manager.clear_hashes();
    await db_manager.add_profile(the_profile());
    searcher_urls = [ was_found_on('/job/dual') ];

    await run_scheduler_now();
    const dual = last_tick_report();
    tally_of('two eligible sections tick');
    check('the post selector matched both sections', dual?.marked === 2);
    check('both passed the gate', dual?.eligible === 2);
    check('only the first was stored', dual?.matched === 1 && dual?.stored === 1);
    check('the stored one is the first eligible candidate',
      (await db_manager.get_positions())[0]?.generic_information
        .description.includes('apply for job dual here') === true);

    console.log('\na page that keeps nothing is retried, never burned\n');

    /*
     * nothing on this page holds the description selector, so it yields no
     * position and no hash. the same url on the next tick is read again rather
     * than disregarded, because a page can simply not have rendered yet
     */
    await db_manager.clear_profiles();
    await db_manager.clear_positions();
    await db_manager.clear_hashes();
    await db_manager.add_profile(the_profile());
    searcher_urls = [ was_found_on('/job/nodetail') ];

    await run_scheduler_now();
    const empty = last_tick_report();
    tally_of('empty page tick');
    check('the empty page stored nothing', empty?.stored === 0);
    check('the empty page was not burned as disregarded', empty?.disregarded === 0);
    check('the empty page reported no errors', empty?.errors === 0);

    await run_scheduler_now();
    const empty_again = last_tick_report();
    check('the second tick read the url again instead of skipping it',
      empty_again?.disregarded === 0 && empty_again?.stored === 0);
    check('no position and no hash were left behind',
      (await db_manager.get_positions()).length === 0 &&
        await db_manager.count_hashes() === 0);

    console.log('\nthe same url under two profiles is one position\n');

    /*
     * dedupe is by found url, not by profile, so the second profile to dork
     * the same posting recognises it
     */
    await db_manager.clear_profiles();
    await db_manager.clear_positions();
    await db_manager.clear_hashes();
    await db_manager.add_profile(the_profile({ name : 'smoke finder alpha' }));
    await db_manager.add_profile(the_profile({ name : 'smoke finder beta' }));
    searcher_urls = [ was_found_on('/job/4') ];

    await run_scheduler_now();
    const shared = last_tick_report();
    tally_of('shared url tick');
    check('one profile stored the posting', shared?.stored === 1);
    check('the other profile disregarded the same url', shared?.disregarded === 1);
    check('exactly one position and one hash remain',
      (await db_manager.get_positions()).length === 1 &&
        await db_manager.count_hashes() === 1);
    check('the stored position belongs to the first profile',
      (await db_manager.get_positions())[0]?.found_by === 'smoke finder alpha');

    console.log('\ntwo found urls mean two positions\n');

    await db_manager.clear_profiles();
    await db_manager.clear_positions();
    await db_manager.clear_hashes();
    await db_manager.add_profile(the_profile());
    searcher_urls = [ was_found_on('/job/1'), was_found_on('/job/2') ];

    await run_scheduler_now();
    const two = last_tick_report();
    tally_of('two urls tick');
    check('both urls were read and stored', two?.matched === 2 && two?.stored === 2);
    check('each url stored its own posting', new Set(
      (await db_manager.get_positions()).map((position) => position.application_link)
    ).size === 2);

    console.log('\na dork failure skips the profile for the tick\n');

    /*
     * a searcher that throws a plain error is a dead network or a broken page:
     * the profile is counted as an error and the tick goes on
     */
    await db_manager.clear_profiles();
    await db_manager.clear_positions();
    await db_manager.clear_hashes();
    await db_manager.add_profile(the_profile());
    set_searcher_for_tests(async () => { throw new Error('robot check'); });

    await run_scheduler_now();
    const blocked = last_tick_report();
    tally_of('blocked tick');
    check('the broken dork became one error', blocked?.errors === 1);
    check('nothing was stored', blocked?.stored === 0);
    check('nothing was disregarded', blocked?.disregarded === 0);
    check('no anti-bot hold was created for a plain failure',
      (await db_manager.list_dork_holds()).length === 0);

    console.log('\nseries a real anti-bot wall holds the dork\n');

    /*
     * a DorkBlocked is not an error: it is a wall the user has to solve once in
     * a headful window. the profile is parked in a hold the frontend lists,
     * and the same profile blocked again while the hold is open does not stack
     * a second copy of the same wall
     */
    await db_manager.clear_profiles();
    await db_manager.clear_positions();
    await db_manager.clear_hashes();
    await db_manager.clear_dork_holds();
    await db_manager.add_profile(the_profile());
    set_searcher_for_tests(async () => {
      throw new DorkBlocked('captcha', 'site:smokeplatform.test inurl:/job/', 'google said no');
    });

    await run_scheduler_now();
    const walled = last_tick_report();
    tally_of('walled tick');
    check('the wall became a hold, not an error', walled?.held === 1 && walled?.errors === 0);
    check('the walled profile stored nothing', walled?.stored === 0);

    let holds = await db_manager.list_dork_holds();
    check('one hold is on the shelf', holds.length === 1);
    check('the hold waits to be solved', holds[0]?.state === 'HOLDING');
    check('the hold is a captcha', holds[0]?.cause === 'captcha');
    check('the hold carries the exact blocked query', holds[0]?.dork ===
      'site:smokeplatform.test inurl:/job/');

    await run_scheduler_now();
    check('a second tick did not stack another hold of the same wall',
      (await db_manager.list_dork_holds()).length === 1);

    const held_id = holds[0]?.id ?? '';
    check('the hold can be dismissed', await db_manager.dismiss_dork_hold(held_id));
    holds = await db_manager.list_dork_holds();
    const rested = holds.find((hold) => hold.id === held_id);
    check('a dismissed hold is at rest, not re-held', rested?.state === 'DISCARDED');

    //the shelf is clean again for the scenarios after this one
    await db_manager.clear_dork_holds();

    //back to the fixture searcher for everything after this
    set_searcher_for_tests(async (_browser, _profile) => searcher_urls);

    console.log('\nselectors pointing at the same element\n');

    /*
     * several post selectors landing on one element still read one posting,
     * and a calling profile with the general recording shape behaves the same
     */
    await db_manager.clear_profiles();
    await db_manager.clear_positions();
    await db_manager.clear_hashes();
    await db_manager.add_profile(the_profile({
      post_selector : [ '.detail', 'div.detail' ]
    }));
    searcher_urls = [ was_found_on('/job/3') ];

    await run_scheduler_now();
    const overlap = last_tick_report();
    tally_of('overlapping selectors tick');
    check('the overlapping selectors gave one position, not two',
      (await db_manager.get_positions()).length === 1);
    check('still one hash', await db_manager.count_hashes() === 1);
    check('the overlapping tick reported no errors', overlap?.errors === 0);

    /*
     * the chrome profile dirs. this only checks the two constants and that a
     * launch with one of them puts a real profile on disk, never that a session
     * is in it: a signed in profile is the user's and nothing here may depend
     * on one
     */
    console.log('\nthe chrome profile dirs\n');

    check('the crawler and the recorder do not share a profile dir',
      CRAWLER_CHROME_DIR !== RECORDER_CHROME_DIR);
    check('neither dir points at the repo root itself',
      CRAWLER_CHROME_DIR !== repo_root && RECORDER_CHROME_DIR !== repo_root);
    /*
     * the dirs sit inside the repo, so the only thing standing between a live
     * session cookie and a commit is the name. it has to be the exact basename
     * the gitignore lists, trailing slash and all
     */
    const basename = ( path : string ) => path.split('/').pop() ?? '';
    check('the crawler dir is named the way the gitignore names it',
      basename(CRAWLER_CHROME_DIR) === '.crawler_chrome');
    check('the recorder dir is named the way the gitignore names it',
      basename(RECORDER_CHROME_DIR) === '.recorder_chrome');

    //and the ignore file has to actually list them, a name nobody wrote down
    //protects nothing
    const ignore = await Deno.readTextFile(`${repo_root}.gitignore`)
      .catch(() => '');
    const ignored = ( path : string ) =>
      ignore.split('\n').some((line) => line.trim() === `${basename(path)}/`);

    check('the gitignore covers the crawler dir', ignored(CRAWLER_CHROME_DIR));
    check('the gitignore covers the recorder dir', ignored(RECORDER_CHROME_DIR));

    const dir_check = await Deno.makeTempDir();
    try{
      const probe_dir = `${dir_check}/probe_profile`;
      const probe = await launch_crawler_browser({
        headless : true,
        user_data_dir : probe_dir
      });
      await probe.close().catch(() => {});

      //puppeteer only creates the dir once it writes into it, so an empty
      //listing here would mean the launch quietly fell back to a throwaway
      const created = [];
      for await(const entry of Deno.readDir(probe_dir)){ created.push(entry.name); }
      check('a launch with a user_data_dir writes that profile to disk',
        created.length > 0);
    }
    finally{
      await Deno.remove(dir_check, { recursive : true }).catch(() => {});
    }

    console.log('\nposition first, hash second\n');

    /*
     * the order of the two writes is the whole point. a hash with no position
     * behind it reads as "already seen" and suppresses that posting on every
     * later tick, while a position with no hash only ever repeats itself once,
     * so the position has to land first.
     *
     * the hash is taken from the found url, so every url used here has to be
     * its own: two texts under the same url are the same posting by definition
     */
    await db_manager.clear_profiles();
    await db_manager.clear_positions();
    await db_manager.clear_hashes();

    const store_profile = the_profile();
    const good_text = 'Senior Rust Engineer, tokio and yew';

    const s1 = await store_position(store_profile, was_found_on('/job/1'), good_text);
    check('a url nobody has seen is stored', s1.stored === true);
    check('the first pass did not disregard it', s1.disregarded === false);
    check('the first pass did not fail', s1.failed === false);
    check('it did not lose a race it was the only one in', s1.lost_race === false);
    check('one position and one hash together', (await db_manager.get_positions()).length === 1 &&
      await db_manager.count_hashes() === 1);

    const s2 = await store_position(store_profile, was_found_on('/job/1'), good_text);
    check('the same url again is disregarded', s2.disregarded === true);
    check('the second pass stored nothing', s2.stored === false);
    check('the second pass did not fail', s2.failed === false);
    check('still one position and one hash', (await db_manager.get_positions()).length === 1 &&
      await db_manager.count_hashes() === 1);

    /*
     * a position insert that cannot land must leave no hash behind. a validator
     * on the collection makes add_position fail for certain, without touching
     * the shape of the document or the hash write that would have followed
     */
    await db_manager.expire_every_position();

    const doomed = await store_position(
      store_profile,
      was_found_on('/job/9'),
      'a posting that cannot be stored'
    );
    check('the doomed insert reported a failure', doomed.failed === true);
    check('the doomed insert stored nothing', doomed.stored === false);
    check('the doomed insert was not a duplicate', doomed.disregarded === false);
    check('no hash was left behind by the failed insert', await db_manager.count_hashes() === 1);
    check('still just the one good position', (await db_manager.get_positions()).length === 1);

    /*
     * the validator is still in place, so the retry fails again, and that is the
     * point: it is retried rather than suppressed. what matters is that the
     * second attempt reached the store at all
     */
    const retried = await store_position(
      store_profile,
      was_found_on('/job/9'),
      'a posting that cannot be stored'
    );
    check('the posting that failed is not suppressed for ever',
      retried.disregarded === false);
    check('it reached the store again and failed again on its own terms',
      retried.failed === true);

    check('the validator is lifted', await db_manager.stop_expiring_positions());
    const recovered = await store_position(
      store_profile,
      was_found_on('/job/9'),
      'a posting that cannot be stored'
    );
    check('the retried posting stores once the store is healthy', recovered.stored === true);
    check('its hash is there with it', await db_manager.count_hashes() === 2);

    /*
     * a lost race on the hash must not undo a position that is already down.
     * the unique index is the race guard, so a hash that is already there makes
     * remember_hash fail while the position insert has already succeeded
     */
    await db_manager.clear_profiles();
    await db_manager.clear_positions();
    await db_manager.clear_hashes();

    const racer = await store_position(store_profile, was_found_on('/job/1'), good_text);
    check('the racer stored its position', racer.stored === true);
    check('the racer kept its hash', racer.lost_race === false);

    const repeat_guard = await store_position(store_profile, was_found_on('/job/1'), good_text);
    check('a repeat is caught by the hash before it writes anything',
      repeat_guard.disregarded === true && repeat_guard.stored === false);

  }
  finally{
    //the validator outlives the data it rejected, so it goes first or the next
    //run starts with a collection that refuses every insert
    await db_manager.stop_expiring_positions();
    set_searcher_for_tests(null);
    await db_manager.clear_profiles();
    await db_manager.clear_positions();
    await db_manager.clear_hashes();
    await db_manager.clear_dork_holds();
    //an open client keeps the process alive, without this the script hangs
    await db_manager.close_db();
    await server.shutdown();
  }

};

await main();

console.log('');

if(failures.length){
  console.log(`${failures.length} FAILED`);
  for(const failure of failures){ console.log(`  - ${failure}`); }
  Deno.exit(1);
}

console.log('all good');