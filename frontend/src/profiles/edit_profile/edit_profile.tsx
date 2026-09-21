import type { Profile,Action,SELECTOR } from "../../../../global_types/profile";
import { gql } from "@apollo/client";
import { useMutation } from "@apollo/client/react";

interface params{
  profile? : Profile;
  is_editing : boolean;
  unset_edited_profile : ()=>void;
};

const EditProfile = ( {profile, is_editing, unset_edited_profile} : params )=>{

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

  const [create] = useMutation(create_new_profile_q);
  const [edit] = useMutation(edit_existing_profile_q);

  const default_profile : Profile = 
    {
    name : '',
    crawling_start_url : '',
    where_to_look_and_how : {},
    found_positions_url : [] as string[],
    what_to_do_before_checking : [] as {action : Action, selector: SELECTOR}[] ,
    platform_name : ''
  } as Profile;

  let obj_to_send : Profile = profile ? profile : default_profile;

  return (
    <div className="borderable">

    <label>profile name</label><br/>
    <input type="text" id="name" placeholder={obj_to_send.name} onChange={ (e)=>{ obj_to_send.name = e.target.value } }/><br/>

    <label>platform name</label><br/>
    <input type="text" id="platform" placeholder={obj_to_send.platform_name} onChange={ (e)=>{ obj_to_send.platform_name = e.target.value } }/><br/>

    <label>begin url</label><br/>
    <input type="url" id="begin_url" placeholder={obj_to_send.crawling_start_url} onChange={ (e)=>{ obj_to_send.crawling_start_url = e.target.value } }/><br/>

    <label>crawl process</label><br/>
    <button onClick={()=>{alert('implement this')}}>how to crawl</button><br/>

    <label>keywords</label><br/>
    <textarea /><br/>

    <label>fields</label><br/>
    <textarea /><br/>

    <button onClick={ async()=>{

      const {__typename, ...w2lah} = obj_to_send.where_to_look_and_how;
      obj_to_send.where_to_look_and_how = w2lah[0];

      if(is_editing){
        await edit({ variables : { profile : obj_to_send } });
      }
      else{
        await create({variables : {profile : obj_to_send}})
      }

    } }>Save</button>


    <button onClick={ async()=>{
      unset_edited_profile()
    } }>Cancel</button>

    </div>
  )

};

export default EditProfile;
