import { abort_session } from './crawling.ts';

const ENDPOINT = 'http://localhost:3141/';

const graph = async ( query : string, variables : Record<string, unknown> = {} ) => {

  const response = await fetch(ENDPOINT, {
    method : 'POST',
    headers : { 'Content-Type' : 'application/json' },
    body : JSON.stringify({ query, variables })
  });

  const body = await response.json();
  if(body.errors){
    throw new Error(JSON.stringify(body.errors));
  }
  return body.data;
};

const domain = Deno.args[0] ?? '127.0.0.1';
const section = Deno.args[1] ?? '/open-positions/';

console.log(`[SMOKE] domain: ${domain}, url section: ${section}`);

console.log('[SMOKE] refusing an incomplete dork profile');
const blanks = [
  { platform_domain : '', url_section : section },
  { platform_domain : domain, url_section : '' },
  { platform_domain : '', url_section : '' }
];

for(const start of blanks){
  const bad_data = await graph(
    `mutation( $start : CrawlStartInput! ){
       start_crawling_session( start : $start ){ session_id }
     }`,
    { start }
  );
  const refused = bad_data.start_crawling_session === null;
  console.log(`[SMOKE]   ${JSON.stringify(start)} -> ${refused ? 'refused' : 'ACCEPTED (BUG)'}`);
  if(!refused){ Deno.exit(1); }
}

console.log('[SMOKE] starting a session');
const start_data = await graph(
  `mutation( $start : CrawlStartInput! ){
     start_crawling_session( start : $start ){ session_id }
   }`,
  { start : { platform_domain : domain, url_section : section } }
);

const session_id = start_data.start_crawling_session?.session_id;
if(!session_id){
  console.error('[SMOKE] no session came back, is the server running on 3141?');
  Deno.exit(1);
}
console.log(`[SMOKE] session_id=${session_id}`);

const session_query =
  `query( $id : ID! ){ crawling_session( session_id : $id ){
     session_id status error page_url held_session_id
     result { post_selector description_selector }
  } }`;

let last_capture = -1;
let last_state = '';

const poll = async () => {

  const data = await graph(session_query, { id : session_id });
  const session = data.crawling_session;

  const capture_count = (session.result?.post_selector?.length ?? 0) +
    (session.result?.description_selector?.length ?? 0);
  if(capture_count !== last_capture){
    last_capture = capture_count;
    console.log(`[SMOKE] recorded ${last_capture} selector(s) so far`);
  }

  const state = session.held_session_id
    ? `HELD ${session.held_session_id}`
    : (session.page_url ? `page ${session.page_url}` : session.status);
  if(state !== last_state){
    last_state = state;
    console.log(`[SMOKE] state: ${state}`);
  }

  return session;
};

console.log('[SMOKE] the dork runs headlessly, then a chromium window opens');
console.log('[SMOKE] middle and right click in it, close it when you are done');

const timeout_at = Date.now() + 5 * 60 * 1000;

while(Date.now() < timeout_at){

  const session = await poll();

  if(session.status === 'FAILED'){
    console.error(`[SMOKE] session failed: ${session.error}`);
    Deno.exit(1);
  }

  if(session.status === 'DONE'){
    console.log('\n[SMOKE] session finished, here is what the profile would receive:');
    console.log(JSON.stringify(session.result, null, 2));
    Deno.exit(0);
  }

  await new Promise((r) => setTimeout(r, 2000));
}

console.error('[SMOKE] timed out, aborting the session');
abort_session(session_id);
Deno.exit(1);