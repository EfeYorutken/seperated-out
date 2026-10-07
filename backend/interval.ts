//the scheduler and the graph both need to agree on how often a crawl happens,
//so the interval lives here and nowhere else, importing it from the scheduler
//would make a cycle because the scheduler already imports db_stuff

export const DEFAULT_INTERVAL_MS = 3 * 60 * 1000;

//recharts gets unusable somewhere past a couple hundred points, and at a 20
//second interval two days of history is already over eight thousand buckets
export const MAX_BUCKETS = 200;

export const crawl_interval_ms = () : number => {

  const raw = Deno.env.get('CRAWL_INTERVAL_MS');
  if(!raw){ return DEFAULT_INTERVAL_MS; }

  const parsed = Number(raw);
  if(!Number.isFinite(parsed) || parsed <= 0){
    console.warn(`[INTERVAL] ignoring bogus CRAWL_INTERVAL_MS '${raw}'`);
    return DEFAULT_INTERVAL_MS;
  }

  return parsed;

};

//the graph buckets by the crawl frequency, so the width it actually ends up
//using is always a whole multiple of that frequency rather than a fixed unit
export const effective_bucket_ms = (
  span_ms : number,
  interval_ms : number,
  cap : number = MAX_BUCKETS
) : number => {

  const wanted = Math.max(1, Math.ceil(span_ms / interval_ms));

  if(wanted <= cap){ return interval_ms; }

  return interval_ms * Math.ceil(wanted / cap);

};

//how many buckets a span breaks into, and where the first one starts
//
//the window is aligned to the unix epoch like the aggregation is, and it always
//runs up to and including the bucket that is currently filling, because that is
//where anything the last crawl just found has landed
export const bucket_window = (
  span_ms : number,
  interval_ms : number,
  cap : number = MAX_BUCKETS
) : { bucket_ms : number; count : number; since : number } => {

  const bucket = effective_bucket_ms(span_ms, interval_ms, cap);

  //the bucket the clock is currently inside, its start is the newest point
  const current = Math.floor(Date.now() / bucket) * bucket;

  //plus the partial bucket the crawl is writing into right now
  const count = Math.max(1, Math.ceil(span_ms / bucket) + 1);

  return { bucket_ms : bucket, count, since : current - (count - 1) * bucket };

};
