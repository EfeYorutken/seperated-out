//drives clone/delete/anti_keywords through the real graphql stack against the
//TEST database. init_test_db runs first, and init_db() inside resolvers.ts is a
//no-op once a client is open, so the resolvers inherit the test handle and
//seperated_out_db is never touched.
//
//  deno run --allow-net --allow-env --allow-sys --allow-read --allow-write smoke_graphql.ts
import { ApolloServer } from '@apollo/server';

import * as db_manager from './db_stuff.ts';
import { content_hash } from './matching.ts';

const failures : string[] = [];
const check = ( ok : boolean, what : string ) => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}`);
  if(!ok){ failures.push(what); }
};

await db_manager.init_test_db();

const sdl = await Deno.readTextFile(new URL('./typedefs.graphql', import.meta.url));

//imported after init_test_db on purpose, see the note at the top
const { resolvers } = await import('./resolvers.ts');

const server = new ApolloServer({ typeDefs : sdl, resolvers });
await server.start();

const run = async( query : string, variables? : Record<string, unknown> ) => {

  const res = await server.executeOperation({ query, variables });

  if(res.body.kind !== 'single'){
    throw new Error(`unexpected response ${res.body.kind}`);
  }

  if(res.body.singleResult.errors?.length){
    throw new Error(res.body.singleResult.errors[0].message);
  }

  return res.body.singleResult.data as Record<string, any>;
};

const seeded = {
  id : -1,
  name : 'graphql finder',
  platform_domain : 'www.linkedin.com',
  url_section : '/jobs/',
  publish_after : '2026-01-01',
  post_selector : [ '.card' ],
  description_selector : [ '.description' ],
  keywords : [ 'rust' ],
  anti_keywords : [ 'embedded' ]
};

try{

  await db_manager.clear_profiles();
  await db_manager.clear_positions();
  await db_manager.clear_hashes();

  console.log('\ncreating a profile through the mutation\n');

  const created = await run(
    `mutation new_profile( $profile : ProfileInput ){ new_profile(profile : $profile) }`,
    { profile : seeded }
  );
  check(created.new_profile === true, 'new_profile returned true');

  const listed = await run(
    `{ get_profiles{ id name platform_domain url_section publish_after
       keywords anti_keywords post_selector description_selector } }`
  );
  check(listed.get_profiles.length === 1, 'the profile came back from get_profiles');
  check(
    JSON.stringify(listed.get_profiles[0].anti_keywords) === JSON.stringify([ 'embedded' ]),
    'anti_keywords survived the round trip'
  );
  check(
    JSON.stringify(listed.get_profiles[0].post_selector) === JSON.stringify([ '.card' ]),
    'post_selector survived the round trip'
  );
  check(
    listed.get_profiles[0].platform_domain === 'www.linkedin.com',
    'platform_domain survived the round trip'
  );

  const id = listed.get_profiles[0].id;

  console.log('\nclone through graphql\n');

  const cloned = await run(
    `mutation clone_profile( $id : ID! ){ clone_profile(id : $id) }`,
    { id }
  );
  check(cloned.clone_profile === true, 'clone_profile returned true');

  const after = await run(`{ get_profiles{ id name anti_keywords } }`);
  check(after.get_profiles.length === 2, 'a second profile now exists');
  check(after.get_profiles[1].name === 'graphql finder 2', 'the clone is named with a space');
  check(after.get_profiles[1].anti_keywords.length === 1, 'the clone kept its anti keywords');
  check(after.get_profiles[0].id !== after.get_profiles[1].id, 'the ids differ');

  //an id sent as a string, which is how graphql always serializes ID
  const cloned_again = await run(
    `mutation clone_profile( $id : ID! ){ clone_profile(id : $id) }`,
    { id : String(id) }
  );
  check(cloned_again.clone_profile === true, 'clone works with a stringified id');
  const three = await run(`{ get_profiles{ name } }`);
  check(
    three.get_profiles[2].name === 'graphql finder 3',
    'the third name stepped around the taken ones'
  );

  console.log('\ndelete through graphql\n');

  await db_manager.add_position({
    generic_information : {
      job_title : 'rust dev',
      date_of_publish : null,
      description : 'rust dev',
      which_platform_was_it_found_on : 'linkedin',
      company : null,
      location : null
    },
    found_by : 'graphql finder',
    application_link : 'https://example.test/apply'
  });

  //a hash the position can be recognised by, put there the way the scheduler
  //would have done: it is derived from the application url, never from the
  //position itself
  const posting_hash = await content_hash('https://example.test/apply');
  await db_manager.remember_hash({
    hash : posting_hash,
    profile_id : id,
    profile_name : 'graphql finder',
    url : 'https://example.test/apply',
    recorded_at : new Date()
  });

  console.log('\nforget and remove\n');

  const stored = await run(`{ get_positions{ id application_link } }`);
  const the_position_id = stored.get_positions[0].id;
  check(typeof the_position_id === 'string' && the_position_id.length > 0,
    'the position carries an id the remove button can address it by');

  //forget drops the dedupe record and has to leave the position alone
  const forgot = await run(
    `mutation forget_position_hash( $url : String! ){ forget_position_hash(url : $url) }`,
    { url : 'https://example.test/apply' }
  );
  check(forgot.forget_position_hash === true, 'forget_position_hash returned true');
  check(!(await db_manager.hash_known(posting_hash)), 'the hash is really gone');
  check(
    (await db_manager.get_positions()).some((p) => p.id === the_position_id),
    'forgetting the hash left the position in place'
  );

  //remove drops the position and has to leave the hash alone
  const kept_hash = await content_hash('kept dev');
  await db_manager.remember_hash({
    hash : kept_hash,
    profile_id : id,
    profile_name : 'graphql finder',
    url : 'https://example.test',
    recorded_at : new Date()
  });

  const removed = await run(
    `mutation remove_position( $id : ID! ){ remove_position(id : $id) }`,
    { id : the_position_id }
  );
  check(removed.remove_position === true, 'remove_position returned true');
  check(
    !(await db_manager.get_positions()).some((p) => p.id === the_position_id),
    'the position is gone'
  );
  check(await db_manager.hash_known(kept_hash),
    'removing a position kept an unrelated hash');

  const removed_twice = await run(
    `mutation remove_position( $id : ID! ){ remove_position(id : $id) }`,
    { id : the_position_id }
  );
  check(removed_twice.remove_position === false, 'removing it again answers false');

  const bad_id = await run(
    `mutation remove_position( $id : ID! ){ remove_position(id : $id) }`,
    { id : 'not-an-object-id' }
  );
  check(bad_id.remove_position === false, 'a malformed id is refused, not thrown on');

  //put one back so the delete_profile checks below have something to find
  await db_manager.add_position({
    generic_information : {
      job_title : 'rust dev',
      date_of_publish : null,
      description : 'rust dev',
      which_platform_was_it_found_on : 'linkedin',
      company : null,
      location : null
    },
    found_by : 'graphql finder',
    application_link : 'https://example.test/apply'
  });

  const deleted = await run(
    `mutation delete_profile( $id : ID! ){ delete_profile(id : $id) }`,
    { id : String(id) }
  );
  check(deleted.delete_profile === true, 'delete_profile returned true');

  const left = await run(`{ get_profiles{ name } get_positions{ application_link } }`);
  check(left.get_profiles.length === 2, 'only the requested profile went');
  check(
    left.get_profiles.every((p : { name : string }) => p.name !== 'graphql finder'),
    'the deleted profile is gone'
  );
  check(left.get_positions.length === 1, 'the position it found is still there');
  check(
    left.get_positions[0].application_link === 'https://example.test/apply',
    'the apply link is readable, so the button has something to open'
  );

  console.log('\nanti-bot holds through graphql\n');

  await db_manager.clear_dork_holds();

  const held = await db_manager.hold_dork(
    { ...seeded, id : 7, name : 'held profile' },
    'site:www.linkedin.com inurl:/jobs/ rust',
    'captcha',
    'tick'
  );
  check(held !== null, 'a blocked dork went on the shelf');

  const holds_q = await run(
    `{ dork_holds{ id profile_id profile_name dork cause state created_at solved_at } }`
  );
  check(holds_q.dork_holds.length === 1, 'the hold came back from dork_holds');
  check(
    holds_q.dork_holds[0].cause === 'CAPTCHA',
    'graphql enums are case sensitive, the lowercase db cause went out as CAPTCHA'
  );
  check(holds_q.dork_holds[0].state === 'HOLDING', 'the hold waits to be solved');
  check(holds_q.dork_holds[0].dork === 'site:www.linkedin.com inurl:/jobs/ rust',
    'the exact blocked query rides along, so the panel shows the real wall');
  check(holds_q.dork_holds[0].profile_name === 'held profile',
    'the hold is tied to the profile behind it');

  const dismissed = await run(
    `mutation dismiss_dork_hold( $hold_id : ID! ){ dismiss_dork_hold(hold_id : $hold_id) }`,
    { hold_id : held ? held.id : '' }
  );
  check(dismissed.dismiss_dork_hold === true, 'dismiss_dork_hold returned true');

  const after_dismiss = await run(`{ dork_holds{ state } }`);
  check(
    after_dismiss.dork_holds.every((h : { state : string }) => h.state !== 'HOLDING'),
    'nothing is waiting to be solved anymore'
  );

  const no_such_hold = await run(
    `mutation dismiss_dork_hold( $hold_id : ID! ){ dismiss_dork_hold(hold_id : $hold_id) }`,
    { hold_id : 'not-a-hold' }
  );
  check(no_such_hold.dismiss_dork_hold === false,
    'dismissing a hold that is not there answers false, not an error');

  console.log('\nthe recording start refuses a search it cannot build\n');

  const refused = await run(
    `mutation start_crawling_session( $start : CrawlStartInput! ){
       start_crawling_session(start : $start){ session_id status page_url held_session_id }
     }`,
    { start : { platform_domain : '', url_section : '/jobs/' } }
  );
  check(refused.start_crawling_session === null,
    'no platform domain means no search, so no session is handed out');

  console.log('\nrefused writes\n');

  const gone = await run(
    `mutation delete_profile( $id : ID! ){ delete_profile(id : $id) }`,
    { id : String(id) }
  );
  check(gone.delete_profile === false, 'deleting it again answers false, not an error');

}
catch(err){
  console.error(`\n[SMOKE GRAPHQL ERROR] ${err}`);
  failures.push(`threw : ${err}`);
}
finally{
  await db_manager.clear_profiles();
  await db_manager.clear_positions();
  await db_manager.clear_hashes();
  await db_manager.clear_dork_holds();
  //an open client keeps the process alive, without this the script hangs
  await db_manager.close_db();
}

console.log('');

if(failures.length){
  console.error(`${failures.length} check(s) failed:`);
  failures.forEach((f) => console.error(`  - ${f}`));
  Deno.exit(1);
}

console.log('all good');
