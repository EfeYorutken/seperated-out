import { DEFAULT_INTERVAL_MS, MAX_BUCKETS, bucket_window, effective_bucket_ms } from './interval.ts';

const seconds = ( n : number ) => n * 1000;
const minutes = ( n : number ) => n * 60 * 1000;
const hours = ( n : number ) => n * 60 * 60 * 1000;
const days = ( n : number ) => n * 24 * 60 * 60 * 1000;

Deno.test('a span that fits keeps the interval as the bucket width', () => {
  //five crawls at the default interval, so five buckets
  const got = effective_bucket_ms(5 * minutes(10), minutes(10));
  if(got !== minutes(10)){ throw new Error(`width was ${got}`); }
});

Deno.test('a sub minute interval is bucketable at all', () => {
  //20s is not a whole second, minute, hour or day, it is only reachable
  //because the bucket width is plain milliseconds
  const got = effective_bucket_ms(60 * seconds(20), seconds(20));
  if(got !== seconds(20)){ throw new Error(`width was ${got}`); }
});

Deno.test('a wide span widens to a whole multiple of the interval', () => {
  const interval = seconds(20);
  //two days at a 20s interval is 8640 buckets, way past the cap
  const got = effective_bucket_ms(2 * days(1), interval);

  if(got % interval !== 0){
    throw new Error(`width ${got} is not a multiple of the interval ${interval}`);
  }
  if(got <= interval){ throw new Error('a two day span should have widened'); }
});

Deno.test('the bucket count never exceeds the cap', () => {
  const spans = [
    2 * days(1), 30 * days(1), 365 * days(1), 10 * hours(3)
  ];

  for(const span of spans){
    const width = effective_bucket_ms(span, seconds(20));
    const count = Math.ceil(span / width);
    if(count > MAX_BUCKETS){
      throw new Error(`${span}ms produced ${count} buckets at width ${width}`);
    }
  }
});

Deno.test('bucket_window count matches the width it reports', () => {
  const span = 3 * days(1);
  const window = bucket_window(span, minutes(10));

  if(window.bucket_ms % minutes(10) !== 0){
    throw new Error('window width drifted off the interval multiple');
  }
  if(window.count > MAX_BUCKETS){
    throw new Error(`window produced ${window.count} buckets`);
  }
  if(window.count * window.bucket_ms < span){
    throw new Error('the window does not cover the whole span');
  }
});

Deno.test('a zero or negative span still yields one usable bucket', () => {
  for(const span of [ 0, -1, -100000 ]){
    const window = bucket_window(span, minutes(10));
    if(window.count < 1){ throw new Error(`span ${span} gave ${window.count} buckets`); }
    if(window.bucket_ms !== minutes(10)){ throw new Error('width should be the interval'); }
  }
});

Deno.test('the window starts in the past and ends now', () => {
  const before = Date.now();
  const window = bucket_window(4 * hours(6), minutes(10));
  const after = Date.now();

  if(window.since > before){ throw new Error('the window starts in the future'); }
  if(window.since + window.count * window.bucket_ms < after - 1){
    throw new Error('the window ends before now');
  }
});

Deno.test('the last point is the bucket the clock is inside', () => {
  //this is the regression guard for the newest bucket being dropped, anything
  //the last crawl just found lands in it and it has to actually be plotted
  for(const interval of [ minutes(10), seconds(20), hours(1) ]){
    for(const span of [ interval, 3 * hours(2), 2 * days(1) ]){

      const window = bucket_window(span, interval);
      const last = window.since + (window.count - 1) * window.bucket_ms;
      const current = Math.floor(Date.now() / window.bucket_ms) * window.bucket_ms;

      if(last !== current){
        throw new Error(
          `interval ${interval} span ${span}: last point ${last} is not the ` +
          `current bucket ${current}`
        );
      }
    }
  }
});

Deno.test('the last point is on an epoch aligned boundary', () => {
  for(const interval of [ seconds(20), minutes(10), hours(3) ]){
    const window = bucket_window(5 * days(2), interval);
    if(window.since % window.bucket_ms !== 0){
      throw new Error(`window start ${window.since} is not bucket aligned`);
    }
  }
});

Deno.test('the default interval is three minutes', () => {
  if(DEFAULT_INTERVAL_MS !== minutes(3)){
    throw new Error(`default was ${DEFAULT_INTERVAL_MS}`);
  }
});
