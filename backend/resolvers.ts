import type { Profile} from '../global_types/profile.ts';
import { Action } from "../global_types/profile.ts";

import * as db_manager from './db_stuff.ts';

type ProfileInput = Profile;
type ProfileEditInput = Profile;

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

    get_page_doc: async (_parent: unknown, args: { page_url: string }): Promise<string> => {
      try {
        const response = await fetch(args.page_url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        let html = await response.text();

        // Parse the origin (e.g., "https://example.com") to set as base URL
        const urlObj = new URL(args.page_url);
        const baseUrl = `${urlObj.origin}/`;

        // Inject <base> tag into <head> so relative assets resolve against the target site
        const baseTag = `<base href="${baseUrl}">`;
        if (html.includes('<head>')) {
          html = html.replace('<head>', `<head>${baseTag}`);
        } else {
          html = `${baseTag}${html}`;
        }

        return html;
      } catch (err) {
        console.error(`[PAGE DOC ERROR] ${err}`);
        throw err; // Let GraphQL handle error formatting instead of returning string error
      }
    }
  },

  Mutation : {

    new_profile : async(
      _parent : unknown, args : ProfileInput
    ) : Promise<boolean>  => {

      api_call_to('new_profile');
      return await db_manager.add_profile( args.profile );

    },

    edit_profile : async( 
                         _parent : unknown, args : ProfileEditInput 
                        ) : Promise<boolean> => {

                          api_call_to('edit_profile');

                          return await db_manager.edit_profile(args.profile.id, args.profile);
                        }

  }

}
