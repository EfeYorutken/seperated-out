//seeds hashes at known times and asserts the aggregation's bucket boundaries
//and running totals, the smoke_scheduler test can only prove the happy path
//because the hashes it makes are all "now"
import * as db_manager from './db_stuff.ts';
import { crawl_interval_ms } from './interval.ts';

const failures : string[] = [];

const check = ( label : string, ok : boolean ) : void => {
  if(!ok){ failures.push(label); }
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
};

const equal = ( label : string, got : unknown, want : unknown ) : {
  ok : boolean; shown : string;
} => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  check(`${label} (got ${g})`, g === w);
  return { ok : g === w, shown : g };
};

const HOUR = 60 * 60 * 1000;

const seed = async() : Promise<number> => {

  const now = Date.now();

  //profile 0 finds 1, then 2 more in a later bucket
  const mine = ( profile_id : number, at : number, n : number ) => {
    return Array.from({ length : n }, (_ignored, i) => ({
      hash : `seed-${profile_id}-${at}-${i}`,
      profile_id,
      profile_name : profile_id === 0 ? 'alpha' : 'beta',
      url : 'https://example.test/job',
      recorded_at : new Date(at)
    }));
  };

  const three_hours_ago = now - 3 * HOUR;

  //all inside the first bucket, then all inside the last
  const docs = [
    ...mine(0, three_hours_ago + 1000, 1),
    ...mine(0, now - 1000, 2),
    ...mine(1, now - 2000, 3)
  ];

  await db_manager.seed_hashes(docs);

  return three_hours_ago;

};

const main = async() : Promise<void> => {

  const connected = await db_manager.init_test_db();
  check('mongo is reachable', connected);
  if(!connected){ return; }

  await db_manager.clear_profiles();
  await db_manager.clear_positions();
  await db_manager.clear_hashes();

  await db_manager.add_profile({
    id : 0, name : 'alpha', platform_domain : 'example.test',
    url_section : '/job/', publish_after : null,
    post_selector : [], description_selector : [],
    keywords : [], anti_keywords : []
  });

  await db_manager.add_profile({
    id : 1, name : 'beta', platform_domain : 'example.test',
    url_section : '/job/', publish_after : null,
    post_selector : [], description_selector : [],
    keywords : [], anti_keywords : []
  });

  await seed();

  const interval = crawl_interval_ms();
  const graph = await db_manager.positions_over_time();

  check('the aggregation returned something', graph != null);
  if(!graph){ return; }

  check('the bucket width is a whole multiple of the crawl interval',
    graph.bucket_ms % interval === 0);
  check('the reported crawl interval is the one in use',
    graph.crawl_interval_ms === interval);

  console.log(`  interval=${interval}ms bucket=${graph.bucket_ms}ms ` +
    `buckets=${graph.series[0]?.points.length}`);

  check('one series per profile', graph.series.length === 2);
  check('series are ordered by profile id', graph.series.map((s) => s.profile_id).join() === '0,1');

  const alpha = graph.series.find((s) => s.profile_id === 0);
  const beta = graph.series.find((s) => s.profile_id === 1);

  if(!alpha || !beta){
    check('both series are present', false);
    return;
  }

  check('both series cover the same number of buckets',
    alpha.points.length === beta.points.length);
  check('both series share the same x axis',
    alpha.points.map((p) => p.at).join() === beta.points.map((p) => p.at).join());

  //cumulative, so the last point is the total number seeded for that profile
  equal('alpha ends at 3', alpha.points[alpha.points.length - 1].total, 3);
  equal('beta ends at 3', beta.points[beta.points.length - 1].total, 3);

  //a running total must never go backwards
  for(const series of graph.series){
    let previous = 0;
    let monotonic = true;
    for(const point of series.points){
      if(point.total < previous){ monotonic = false; }
      previous = point.total;
    }
    check(`${series.profile_name} totals never decrease`, monotonic);
  }

  //alpha had one finding three hours ago and two just now, so at least one
  //interior bucket has to be strictly between 0 and the final total
  const interior = alpha.points.slice(0, -1);
  check('alpha has an interior bucket between 0 and its final total',
    interior.some((p) => p.total > 0 && p.total < 3));
  check('alpha starts from zero or its earliest finding',
    interior.every((p) => p.total === 0 || p.total === 1));
  check('beta only ever finds postings in the newest bucket',
    beta.points.slice(0, -1).every((p) => p.total === 0));

  //the x axis must be a real, ascending, millisecond-aligned set of dates
  const stamps = alpha.points.map((p) => Date.parse(p.at));
  const ascending = stamps.every((value, i) => i === 0 || value > stamps[i - 1]);
  check('the x axis ascends', ascending);
  check('every x value is a valid date',
    stamps.every((value) => Number.isFinite(value)));

};

try{
  await main();
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
  console.log(`${failures.length} FAILED`);
  for(const failure of failures){ console.log(`  - ${failure}`); }
  Deno.exit(1);
}

console.log('all good');
