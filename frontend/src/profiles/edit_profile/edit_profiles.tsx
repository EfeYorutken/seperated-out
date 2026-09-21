import { gql } from "@apollo/client";
import { useQuery } from "@apollo/client/react";
import { useState } from "react";

import ProfileElement from "./profile_element";
import EditProfile from "./edit_profile";
import type { Profile } from "../../../../global_types/profile";

const EditProfiles = ()=>{
  const profile_q = gql`

  query get_profiles{

    get_profiles{
      id
      name
      where_to_look_and_how{ keywords selector }
      platform_name
    }

  }

  `;

  let [edited_profile, mut_edited_profile] = useState<Profile>(undefined);
  let [is_editing, mut_is_editing] = useState(false);

  const unset_profile_edit = ()=>{
    mut_edited_profile(undefined);
    mut_is_editing(false);
  };

  const {loading, error, data} = useQuery(profile_q);

  if(loading){ return (<>loading...</>) }
  if(error){
    console.error(`[EDIT PROFILES ERROR] ${error}`);
    return (<>upss... something went wrong:(</>);
  }

  const clean_data = data.get_profiles.map( dp => {

    return {
      id : dp.id,
      name : dp.name,
      where_to_look_and_how : dp.where_to_look_and_how.map(wtl => {
        return {
          keywords : wtl.keywords,
          selector : wtl.selector
        }
      }),
      platform_name : dp.platform_name
    };

  } );

  return (

    <div className="edit_profiles">

    <EditProfile profile={edited_profile}
    unset_edited_profile={unset_profile_edit}
    is_editing = {is_editing}
    />

    {

      clean_data.map(d => {

        const name : string = d.name;
        const keywords : string[] = Array.from(d.where_to_look_and_how.keys());
        const platform : string = d.platform_name;

        return ( <ProfileElement 
                name={name} 
                platform={platform} words={keywords} 
                set_2b_edited={ ()=>{
                  const found_element =  clean_data.find( elem =>{
                    return elem.id == d.id 
                  } );
                  mut_edited_profile(found_element);
                  mut_is_editing(true);
                } }/> )
      })

    }
    </div>

  );

};

export default EditProfiles;
