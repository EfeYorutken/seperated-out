import { gql } from "@apollo/client";
import { useApolloClient, useMutation } from "@apollo/client/react";
import { useEffect, useRef, useState } from "react";

import Notification from "../../notification/notification";

import type { Profile } from "../../../../global_types/profile";

interface params {
  profile? : Profile;
  is_editing : boolean;
  unset_edited_profile : () => void;
};

type CrawlingSession = {
  session_id : string;
  status : 'PENDING' | 'RECORDING' | 'DONE' | 'FAILED';
  error : string | null;
  result : {
    post_selector : string[];
    description_selector : string[];
  };
  //the page the dork picked, comes in once the search got a page through
  page_url : string | null;
  //set while the search is parked behind an anti-bot wall
  held_session_id : string | null;
};

type Notice = { kind : 'error' | 'info' | 'success'; message : string };

const POLL_INTERVAL_MS = 1500;

const GESTURES =
  'middle click a posting so the crawler knows what to read, right click the ' +
  'parts every posting has. left clicks and typing are not recorded at all';

const lines_of = ( raw : string ) : string[] => {
  return raw.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
};

const clone_profile = ( source : Profile | undefined ) : Profile => {
  return {
    id : source?.id ?? -1,
    name : source?.name ?? '',
    platform_domain : source?.platform_domain ?? '',
    url_section : source?.url_section ?? '',
    publish_after : source?.publish_after ?? null,
    post_selector : [ ...(source?.post_selector ?? []) ],
    description_selector : [ ...(source?.description_selector ?? []) ],
    keywords : [ ...(source?.keywords ?? []) ],
    anti_keywords : [ ...(source?.anti_keywords ?? []) ]
  };
};

/*
 * the search cannot be built from a domain and a url section that are not
 * there. there is no page to concatenate either: the backend runs the dork
 * built from these two fields and opens on whatever it answers with
 */
const recording_problem = ( domain : string, section : string ) : string | null => {

  if(!domain.trim()){
    return 'specify the platform domain before recording';
  }

  if(!section.trim()){
    return 'specify the url section before recording';
  }

  return null;
};

const EditProfile = ( {profile, is_editing, unset_edited_profile} : params ) =>{

  const create_new_profile_q = gql`

  mutation create_new_profile( $profile : ProfileInput ){
    new_profile(profile : $profile)
  }

  `;

  const edit_existing_profile_q = gql`
  mutation edit_profile( $profile : ProfileInput ){
    edit_profile(profile : $profile)
  }
  `;

  //the backend runs the dork built from these fields and picks the first page
  //it answers with, no url is composed here
  const start_crawling_q = gql`
  mutation start_crawling_session( $start : CrawlStartInput! ){
    start_crawling_session(start : $start){
      session_id
      status
      page_url
      held_session_id
    }
  }
  `;

  const abort_crawling_q = gql`
  mutation abort_crawling_session( $session_id : ID! ){
    abort_crawling_session(session_id : $session_id)
  }
  `;

  const crawling_session_q = gql`
  query crawling_session( $session_id : ID! ){
    crawling_session(session_id : $session_id){
      session_id
      status
      error
      page_url
      held_session_id
      result{
        post_selector
        description_selector
      }
    }
  }
  `;

  const client = useApolloClient();

  //both are typed so the boolean answer can actually be read back off data
  const [create] = useMutation<{ new_profile : boolean }, { profile : Profile }>(
    create_new_profile_q
  );
  const [edit] = useMutation<{ edit_profile : boolean }, { profile : Profile }>(
    edit_existing_profile_q
  );
  const [start_crawling] = useMutation(start_crawling_q);
  const [abort_crawling] = useMutation(abort_crawling_q);

  const [ draft, set_draft ] = useState<Profile>(() => clone_profile(profile));
  const [ keywords, set_keywords ] = useState<string>('');
  const [ anti, set_anti ] = useState<string>('');
  const [ posts, set_posts ] = useState<string>('');
  const [ sections, set_sections ] = useState<string>('');
  const [ notice, set_notice ] = useState<Notice | null>(null);
  const [ recording, set_recording ] = useState<boolean>(false);

  const running_session = useRef<string>('');
  const cancelled = useRef<boolean>(false);
  const seen_profile_id = useRef<number | null>(null);

  useEffect(() => {

    const incoming_id = profile?.id ?? null;
    if(seen_profile_id.current === incoming_id){ return; }

    seen_profile_id.current = incoming_id;

    const fresh = clone_profile(profile);
    set_draft(fresh);
    set_keywords(fresh.keywords.join('\n'));
    set_anti(fresh.anti_keywords.join('\n'));
    set_posts(fresh.post_selector.join('\n'));
    set_sections(fresh.description_selector.join('\n'));
    set_notice(null);

  }, [profile]);

  const apply_result = ( session : CrawlingSession ) => {

    const recorded_posts = session.result.post_selector ?? [];
    const recorded_sections = session.result.description_selector ?? [];

    set_draft((previous) => ({
      ...previous,
      post_selector : [ ...recorded_posts ],
      description_selector : [ ...recorded_sections ]
    }));

    set_posts([ ...recorded_posts ].join('\n'));
    set_sections([ ...recorded_sections ].join('\n'));

    set_notice({
      kind : recorded_posts.length ? 'success' : 'info',
      message : recorded_posts.length
        ? `recorded on ${session.page_url ?? 'the found page'}: ` +
          `${recorded_posts.length} post selector(s) and ` +
          `${recorded_sections.length} description section(s), add the keywords and save`
        : `nothing was middle clicked, so the crawler has no post selector to ` +
          `read. middle click a posting in the window and record again`
    });
  };

  const wait_for_session = async ( session_id : string ) : Promise<CrawlingSession | null> => {

    let told_about_hold = false;
    let told_about_window = false;

    while(!cancelled.current){

      const polled = await client.query({
        query : crawling_session_q,
        variables : { session_id },
        fetchPolicy : 'network-only'
      });

      const session = (polled.data as { crawling_session : CrawlingSession | null }).crawling_session;

      if(!session){ return null; }
      if(session.status === 'DONE' || session.status === 'FAILED'){ return session; }

      //the dork hit a captcha or a consent wall: the session waits while the
      //user solves that hold in the anti-bot panel
      if(session.held_session_id && !told_about_hold){
        told_about_hold = true;
        set_notice({
          kind : 'error',
          message : 'google wants a solve for this search. open the dork sessions ' +
            'panel below, solve the hold there, and this recording continues'
        });
      }

      //the dork answered with a page and the recorder window is up
      if(session.page_url && !session.held_session_id && !told_about_window){
        told_about_window = true;
        set_notice({
          kind : 'info',
          message : `a browser window is open on ${session.page_url}: ${GESTURES}, ` +
            'then close the window'
        });
      }

      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }

    return null;
  };

  const begin_crawl_process = async () => {

    const problem = recording_problem(draft.platform_domain, draft.url_section);

    if(problem){
      set_notice({ kind : 'error', message : problem });
      return;
    }

    set_notice({ kind : 'info', message : 'running the dork, then opening a browser window...' });
    cancelled.current = false;
    set_recording(true);

    const started = await start_crawling({
      variables : {
        start : {
          platform_domain : draft.platform_domain.trim(),
          url_section : draft.url_section.trim(),
          keywords : lines_of(keywords),
          anti_keywords : lines_of(anti),
          publish_after : draft.publish_after
        }
      }
    });

    const session = (started.data as {
      start_crawling_session : {
        session_id : string;
        page_url : string | null;
        held_session_id : string | null;
      } | null;
    } | null)?.start_crawling_session;

    if(!session){
      set_recording(false);
      set_notice({ kind : 'error', message : 'the backend refused to start the crawl session' });
      return;
    }

    running_session.current = session.session_id;

    //a block before anything even opened says so right away
    if(session.held_session_id){
      set_notice({
        kind : 'error',
        message : 'google wants a solve for this search. open the dork sessions ' +
          'panel below, solve the hold there, and this recording continues'
      });
    }
    else{
      set_notice({
        kind : 'info',
        message : 'the dork is running, a browser window opens on the first page ' +
          'it finds'
      });
    }

    const finished = await wait_for_session(session.session_id);

    running_session.current = '';
    set_recording(false);

    if(!finished){
      if(cancelled.current){ set_notice({ kind : 'error', message : 'crawl process aborted' }); }
      return;
    }

    if(finished.status === 'FAILED'){
      set_notice({ kind : 'error', message : finished.error ?? 'the crawl session failed' });
      return;
    }

    apply_result(finished);

  };

  const end_crawl_process = async () => {

    cancelled.current = true;

    const session_id = running_session.current;
    if(session_id){ await abort_crawling({ variables : { session_id } }); }

  };

  const save = async () => {

    const to_send : Profile = {
      ...draft,
      keywords : lines_of(keywords),
      anti_keywords : lines_of(anti),
      post_selector : lines_of(posts),
      description_selector : lines_of(sections)
    };

    //both mutations answer with a boolean, and false is how the backend says it
    //refused the write. announcing success anyway is what made a lost profile
    //look like it had been saved
    try{

      if(is_editing){

        const edited = await edit({
          variables : { profile : to_send },
          refetchQueries : [ 'get_profiles' ]
        });

        if(edited.data?.edit_profile !== true){
          throw new Error('the backend refused the edit, nothing was changed');
        }

        set_notice({ kind : 'success', message : 'profile saved' });
        return;

      }

      const created = await create({
        variables : { profile : to_send },
        refetchQueries : [ 'get_profiles' ]
      });

      if(created.data?.new_profile !== true){
        throw new Error('the backend refused the new profile, nothing was stored');
      }

      //the saved profile is now in the list, so empty the form rather than
      //leaving it primed to create a second copy
      set_draft( clone_profile(undefined) );
      set_keywords('');
      set_anti('');
      set_posts('');
      set_sections('');
      set_notice({ kind : 'success', message : 'profile created' });

    }
    catch(err){
      console.error(`[SAVE PROFILE ERROR] ${err}`);
      set_notice({
        kind : 'error',
        message : err instanceof Error ? err.message : 'could not save the profile'
      });
    }

  };

  return (
    <div className="borderable">

    { notice && <Notification kind={notice.kind} message={notice.message} /> }

    <label>profile name</label><br/>
    <input type="text" id="name" placeholder={draft.name}
      onChange={ (e)=>{ set_draft({ ...draft, name : e.target.value }); } }/><br/>

    <label>platform domain</label><br/>
    <input type="text" id="platform" placeholder="www.myjobpage.com"
      onChange={ (e)=>{ set_draft({ ...draft, platform_domain : e.target.value }); } }/><br/>

    <label>url section</label><br/>
    <input type="text" id="section" placeholder="/open-positions/"
      onChange={ (e)=>{ set_draft({ ...draft, url_section : e.target.value }); } }/><br/>

    <label>find jobs published after</label><br/>
    <input type="date" id="publish_after" value={draft.publish_after ?? ''}
      onChange={ (e)=>{ set_draft({ ...draft, publish_after : e.target.value || null }); } }/><br/>

    <div className="crawl_process">

      <div className="crawl_buttons">
        <button onClick={begin_crawl_process} disabled={recording}>record selectors</button>
        { recording && <button onClick={end_crawl_process}>abort</button> }
        { recording && <span>recording...</span> }
      </div>

      <label>keywords the dork searches for</label><br/>
      <textarea value={keywords} placeholder="one keyword per line, for example typescript"
        onChange={ (e)=>{ set_keywords(e.target.value); } }/><br/>

      <label>anti keywords, excluded by the dork</label><br/>
      <textarea value={anti}
        placeholder="one per line, a hit on any of these discards the posting even if a keyword matched"
        onChange={ (e)=>{ set_anti(e.target.value); } }/><br/>

      <label>post selectors, what a posting looks like</label><br/>
      <textarea value={posts} placeholder="one selector per line, from the middle clicks"
        onChange={ (e)=>{ set_posts(e.target.value); }} /><br/>

      <label>description sections every posting must have</label><br/>
      <textarea value={sections} placeholder="one selector per line, from the right clicks"
        onChange={ (e)=>{ set_sections(e.target.value); }} /><br/>
      <p className="crawl_process_help">{ GESTURES }</p>

    </div>

    <button onClick={save}>Save</button>

    <button onClick={ () => { unset_edited_profile(); } }>Cancel</button>

    </div>
  )

};

export default EditProfile;