//exercises clone and delete against the TEST database only, never the app one.
//the driver needs these permissions or the handshake is rejected, so do not
//trim them:
//  deno run --allow-net --allow-env --allow-sys --allow-read --allow-write smoke_profiles.ts
import type { Profile } from '../global_types/profile.ts';

import * as db_manager from './db_stuff.ts';
import { content_hash } from './matching.ts';

const failures : string[] = [];

const check = ( ok : boolean, what : string ) => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}`);
  if(!ok){ failures.push(what); }
};

const a_profile = ( name : string, anti : string[] = [] ) : Profile => {
  return {
    id : -1,
    name,
    platform_domain : 'www.linkedin.com',
    url_section : '/jobs/',
    publish_after : '2026-01-01',
    post_selector : [ '.card', '.listing' ],
    description_selector : [ '.description' ],
    keywords : [ 'rust', 'go' ],
    anti_keywords : anti
  };
};

const by_name = async( name : string ) => {
  const all = await db_manager.get_profiles();
  return all.find((p) => p.name === name);
};

await db_manager.init_test_db();

try{

  await db_manager.clear_profiles();
  await db_manager.clear_positions();
  await db_manager.clear_hashes();

  console.log('\nclone\n');

  await db_manager.add_profile(a_profile('rust backend', ['embedded']));
  const original = await by_name('rust backend');
  check(!!original, 'the original profile was stored');

  const cloned = await db_manager.clone_profile(original!.id);
  check(cloned, 'clone_profile reported success');

  const copy = await by_name('rust backend 2');
  check(!!copy, 'the clone is named with a space and a number');

  check(copy!.id !== original!.id, 'the clone got its own id');
  check(await db_manager.clone_profile(original!.id), 'a second clone of the same id works');
  check(!!(await by_name('rust backend 3')), 'cloning twice never reuses a name');

  //every attribute except the name has to have come across untouched
  check(
    JSON.stringify(copy!.post_selector) === JSON.stringify(original!.post_selector),
    'the post selectors came across'
  );
  check(
    JSON.stringify(copy!.description_selector) ===
      JSON.stringify(original!.description_selector),
    'the description selectors came across'
  );
  check(
    JSON.stringify(copy!.keywords) === JSON.stringify(original!.keywords),
    'the keywords came across'
  );
  check(
    JSON.stringify(copy!.anti_keywords) === JSON.stringify(original!.anti_keywords),
    'anti keywords came across'
  );
  check(copy!.url_section === original!.url_section, 'the url section came across');
  check(copy!.publish_after === original!.publish_after, 'the publish date came across');
  check(
    copy!.platform_domain === original!.platform_domain,
    'the platform domain came across'
  );

  //the lists must not be shared, editing one clone may not touch another
  check(
    copy!.post_selector !== original!.post_selector,
    'the selector lists are copies, not shared references'
  );

  console.log('\nnames\n');

  //a name that is already taken must not be handed out again
  await db_manager.add_profile(a_profile('taken'));
  const again = await db_manager.clone_profile((await by_name('taken'))!.id);
  check(again, 'cloning a profile whose name is taken still succeeds');
  check(!!(await by_name('taken 2')), 'the taken name was stepped around, not reused');

  const names = (await db_manager.get_profiles()).map((p) => p.name);
  check(new Set(names).size === names.length, `no duplicated names in ${names.length} profiles`);

  console.log('\ndelete\n');

  //a position and a hash that belong to the profile being removed
  await db_manager.add_position({
    generic_information : {
      job_title : 'rust dev',
      date_of_publish : null,
      description : 'rust dev',
      which_platform_was_it_found_on : 'linkedin',
      company : null,
      location : null
    },
    found_by : 'rust backend',
    application_link : 'https://example.test/apply'
  });
  await db_manager.remember_hash({
    hash : 'abc123',
    profile_id : original!.id,
    profile_name : 'rust backend',
    url : 'https://example.test/jobs',
    recorded_at : new Date()
  });

  const positions_before = (await db_manager.get_positions()).length;

  check(await db_manager.delete_profile(original!.id), 'delete_profile reported success');
  check(!(await by_name('rust backend')), 'the profile is gone');
  check(!!(await by_name('rust backend 2')), 'the clones were not touched');

  const positions_after = await db_manager.get_positions();
  check(
    positions_after.length === positions_before,
    `the ${positions_before} found position(s) stayed in the database`
  );
  check(
    positions_after.some((p) => p.found_by === 'rust backend'),
    'a position still points at a profile that no longer exists'
  );
  check(await db_manager.hash_known('abc123'), 'the hash history was left alone');

  console.log('\npositions\n');

  //both buttons are asked for the same posting, one forgets its hash and the
  //other removes the position, and neither may touch the other's work
  const stored = await db_manager.add_position({
    generic_information : {
      job_title : 'go developer',
      date_of_publish : null,
      description : 'go developer wanted',
      which_platform_was_it_found_on : 'linkedin',
      company : null,
      location : null
    },
    found_by : 'taken',
    application_link : 'https://example.test/apply-go'
  });
  check(stored, 'a position was stored');

  //picked by description rather than index, the delete section already left a
  //position in the collection and find() order is not something to rely on
  const the_position = (await db_manager.get_positions())
    .find((p) => p.generic_information.description === 'go developer wanted');

  //a stored position always comes back with its mongo id, the check below is
  //what says so, this just satisfies the type
  const position_id = the_position?.id ?? '';
  check(position_id.length > 0, 'the position came back with an id to address it by');

  //the hash is never stored on the position, it is put back together from the
  //application url, exactly the way the resolver does it
  const derived = await content_hash('https://example.test/apply-go');
  await db_manager.remember_hash({
    hash : derived,
    profile_id : -1,
    profile_name : 'taken',
    url : 'https://example.test/apply-go',
    recorded_at : new Date()
  });
  check(await db_manager.hash_known(derived), 'the position is hashed in the hashes database');

  const forgot = await db_manager.forget_hash(derived);
  check(forgot, 'the hash was forgotten');
  check(!(await db_manager.hash_known(derived)), 'the hash is gone');
  check(
    (await db_manager.get_positions()).some((p) => p.id === position_id),
    'forgetting the hash left the position in place'
  );

  const removed = await db_manager.remove_position(position_id);
  check(removed, 'the position was removed');
  check(
    !(await db_manager.get_positions()).some((p) => p.id === position_id),
    'the position is gone'
  );

  //a fresh position whose hash was never forgotten, so removing it has to keep
  //that hash and stop the crawler from putting it back
  await db_manager.add_position({
    generic_information : {
      job_title : 'python developer',
      date_of_publish : null,
      description : 'python developer wanted',
      which_platform_was_it_found_on : 'linkedin',
      company : null,
      location : null
    },
    found_by : 'taken',
    application_link : 'https://example.test/apply-python'
  });
  const kept_hash = await content_hash('https://example.test/apply-python');
  await db_manager.remember_hash({
    hash : kept_hash,
    profile_id : -1,
    profile_name : 'taken',
    url : 'https://example.test/apply-python',
    recorded_at : new Date()
  });

  //picking by title, 'taken' would match the first position stored for the
  //forget case as well
  const second_id = (await db_manager.get_positions())
    .find((p) => p.generic_information.description === 'python developer wanted')?.id ?? '';

  check(
    await db_manager.remove_position(second_id),
    'the second position was removed'
  );
  //the one seeded for the delete_profile section is still there, it is the
  //proof that deleting a profile leaves found positions alone
  check(
    !(await db_manager.get_positions()).some((p) => p.id === second_id),
    'the second position is gone'
  );
  check(
    (await db_manager.get_positions()).some((p) => p.found_by === 'rust backend'),
    'the earlier position outlived the profile that found it'
  );
  check(
    await db_manager.hash_known(kept_hash),
    'removing the position kept its hash, so it will not come back'
  );

  console.log('\nbad position input\n');

  check(!(await db_manager.remove_position(9999)), 'removing a position that is not there fails');
  check(!(await db_manager.remove_position('not-an-object-id')), 'a malformed id is refused');
  check(
    !(await db_manager.remove_position('nonsense')),
    'a non hex id is refused rather than throwing'
  );

  console.log('\nbad input\n');

  check(!(await db_manager.delete_profile(9999)), 'deleting a profile that is not there fails');
  check(!(await db_manager.clone_profile(9999)), 'cloning a profile that is not there fails');
  check(
    !(await db_manager.clone_profile('not-a-number')),
    'a non numeric id is rejected instead of matching something'
  );
  check(!!(await by_name('rust backend 2')), 'the failed calls deleted nothing');

}
catch(err){
  console.error(`\n[SMOKE PROFILES ERROR] ${err}`);
  failures.push(`threw : ${err}`);
}
finally{
  await db_manager.clear_profiles();
  await db_manager.clear_positions();
  await db_manager.clear_hashes();
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
