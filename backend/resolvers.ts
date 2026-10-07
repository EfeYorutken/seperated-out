import type { Profile} from '../global_types/profile.ts';

import * as db_manager from './db_stuff.ts';
import * as crawling from './crawling.ts';
import * as scheduler from './scheduler.ts';
import * as solves from './solves.ts';
import { content_hash } from './matching.ts';

//graphql serializes an ID as a string
type IdArgs = { id : string };

//the anti-bot panel addresses its rows by the hold's id, not by a profile id
type HoldArgs = { hold_id : string };

//graphql hands the whole { profile : ProfileInput } bag to a mutation
type ProfileArgs = { profile : Profile };

//the recording dork needs nothing but the search ingredients, the full profile
//only exists once it is saved
type CrawlStartArgs = {
  start : {
    platform_domain : string;
    url_section : string;
    keywords? : string[] | null;
    anti_keywords? : string[] | null;
    publish_after? : string | null;
  };
};

if(!(await db_manager.init_db())){
  console.error(`[RESOLVER ERROR] failed to initilize mongodb connection`);
}
else{
  console.log('[DATABASE INITILIZED]');
}

const api_call_to = (endpoint_name : string) => {
  console.log(`[API CALL TO ${endpoint_name}]`);
};

export const resolvers = {

  Query : {

    get_profiles : async ()=>{
      api_call_to('get_profiles');
      const res = await db_manager.get_profiles();
      return res;
    },

    get_positions : async ()=>{
      api_call_to('get_positions');
      return await db_manager.get_positions() 
    },

    crawling_session : async(_parent : unknown, args : { session_id : string })=>{
      return crawling.get_session(args.session_id);
    },

    positions_over_time : async()=>{
      api_call_to('positions_over_time');
      return await db_manager.positions_over_time();
    },

    dork_holds : async()=>{
      api_call_to('dork_holds');
      const holds = await db_manager.list_dork_holds();

      //the db keeps the cause lowercase, graphql enums are case sensitive
      return holds.map((hold) => ({
        ...hold,
        cause : hold.cause.toUpperCase()
      }));
    }

  },

  Mutation : {

    new_profile : async(
      _parent : unknown, args : ProfileArgs
    ) : Promise<boolean>  => {

      api_call_to('new_profile');
      return await db_manager.add_profile( args.profile );

    },

    edit_profile : async( 
                         _parent : unknown, args : ProfileArgs 
                        ) : Promise<boolean> => {

                          api_call_to('edit_profile');

      return await db_manager.edit_profile(args.profile.id, args.profile);
    },

    clone_profile : async(
      _parent : unknown, args : IdArgs
    ) : Promise<boolean> => {

      api_call_to('clone_profile');
      return await db_manager.clone_profile( args.id );

    },

    delete_profile : async(
      _parent : unknown, args : IdArgs
    ) : Promise<boolean> => {

      api_call_to('delete_profile');
      return await db_manager.delete_profile( args.id );

    },

    forget_position_hash : async(
      _parent : unknown, args : { url : string }
    ) : Promise<boolean> => {

      api_call_to('forget_position_hash');

      /*
       * a stored position keeps no hash of its own, but the hash was taken
       * from exactly this url, so putting it back together here spares the
       * schema a redundant field and works on positions stored long ago
       */
      const hash = await content_hash( args.url );

      return await db_manager.forget_hash( hash );

    },

    remove_position : async(
      _parent : unknown, args : IdArgs
    ) : Promise<boolean> => {

      api_call_to('remove_position');
      return await db_manager.remove_position( args.id );

    },

    start_crawling_session : async(_parent : unknown, args : CrawlStartArgs)=>{

      //a recording dork is a draft profile: it can never be saved, it only
      //needs to point the recorder at the first page the dork answers with
      const profile : Profile = {
        id : -1,
        name : 'recording',
        platform_domain : args.start.platform_domain,
        url_section : args.start.url_section,
        publish_after : args.start.publish_after ?? null,
        post_selector : [],
        description_selector : [],
        keywords : [ ...(args.start.keywords ?? []) ],
        anti_keywords : [ ...(args.start.anti_keywords ?? []) ]
      };

      const started = crawling.start_session(profile);

      if('error' in started){
        console.error(`[CRAWLING SESSION ERROR] ${started.error}`);
        return null;
      }

      return started.session;
    },

    abort_crawling_session : async(_parent : unknown, args : { session_id : string })=>{
      return crawling.abort_session(args.session_id);
    },

    start_solve_session : async(_parent : unknown, args : HoldArgs)=>{
      return await solves.start_solve(args.hold_id);
    },

    abort_solve_session : async(_parent : unknown, args : HoldArgs)=>{
      return await solves.abort_solve(args.hold_id);
    },

    dismiss_dork_hold : async(_parent : unknown, args : HoldArgs)=>{

      //closing a solve window that may be on it, then marking it discarded
      await solves.abort_solve(args.hold_id);
      return await db_manager.dismiss_dork_hold(args.hold_id);

    },

    retry_dork_hold : async(_parent : unknown, args : HoldArgs)=>{
      return await scheduler.retry_dork_hold(args.hold_id);
    }

  }


}
