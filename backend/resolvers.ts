import type { Profile} from '../global_types/profile.ts';

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
        return await db_manager.get_profiles() 
      },
      get_positions : async ()=>{
        api_call_to('get_positions');
        return await db_manager.get_positions() 
      },

  },

    Mutation : {

      new_profile : async(
        _parent : unknown, args : ProfileInput
      ) : Promise<boolean>  => {

        api_call_to('new_profile');
        return await db_manager.add_profile( args );

      },

      edit_profile : async( 
                           _parent : unknown, args : ProfileEditInput 
                          ) : Promise<boolean> => {

                            api_call_to('edit_profile');
                            const {id, ...args_wo_id} = args;

                            return await db_manager.edit_profile(id, args_wo_id);
                          }

    }

};
