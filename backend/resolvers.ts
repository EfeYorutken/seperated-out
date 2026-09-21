import type { Profile} from '../global_types/profile.ts';
import type {Action} from '../global_types/profile.ts';
import type { Position } from '../global_types/position.ts';

import raw_positions from "./positions_mock.json" with {type: "json"};
import raw_profiles from "./profiles_mock.json" with {type: "json"};

import { db_manager } from "./db_stuff.ts";

let positions = raw_positions as Position[];
let profiles = raw_profiles as Profile[];


export const resolvers = {

  Query : {

    get_profiles : ()=>{ return db_manager.get_profiles() },//db.doc.find
    get_positions : ()=>{ return positions },
      get_profile_named : ()=>{ return null },

  },

    Mutation : {

      new_profile : (
        _parent : unknown, args : ProfileInput
      ) : boolean  => {

        return db_manager.add_profile( args );

      },

      edit_profile : ( 
                      _parent : unknown, args : ProfileEditInput 
                     ) : boolean => {
                       return db_manager.edit_profile();
                     }

    }

};
