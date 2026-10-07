import { gql } from "@apollo/client";
import { useMutation, useQuery } from "@apollo/client/react";
import { useState } from "react";

import ProfileElement from "./profile_element";
import EditProfile from "./edit_profile";
import Notification from "../../notification/notification";
import type { Profile } from "../../../../global_types/profile";

type ProfilesQuery = { get_profiles : Profile[] };

type Notice = { kind : 'error' | 'info' | 'success'; message : string };

const EditProfiles = ()=>{
  const profile_q = gql`

  query get_profiles{

    get_profiles{
      id
      name
      platform_domain
      url_section
      publish_after
      post_selector
      description_selector
      keywords
      anti_keywords
    }

  }

  `;

  const clone_profile_q = gql`
  mutation clone_profile( $id : ID! ){
    clone_profile( id : $id )
  }
  `;

  const delete_profile_q = gql`
  mutation delete_profile( $id : ID! ){
    delete_profile( id : $id )
  }
  `;

  const [edited_profile, mut_edited_profile] = useState<Profile | undefined>(undefined);
  const [is_editing, mut_is_editing] = useState(false);
  const [notice, mut_notice] = useState<Notice | null>(null);
  const [busy, mut_busy] = useState(false);

  const unset_profile_edit = ()=>{
    mut_edited_profile(undefined);
    mut_is_editing(false);
  };

  const {loading, error, data} = useQuery<ProfilesQuery>(profile_q);

  const [run_clone] = useMutation<{ clone_profile : boolean }, { id : number }>(clone_profile_q);
  const [run_delete] = useMutation<{ delete_profile : boolean }, { id : number }>(delete_profile_q);

  //both of these answer with a boolean, and false is the backend refusing the
  //write, so it has to be checked instead of assumed
  const clone_it = async ( id : number ) => {

    mut_busy(true);
    mut_notice(null);

    try{

      const done = await run_clone({
        variables : { id },
        refetchQueries : [ 'get_profiles' ]
      });

      if(done.data?.clone_profile !== true){
        throw new Error('the backend refused to clone the profile');
      }

      mut_notice({ kind : 'success', message : 'cloned, the copy has a number added to its name' });

    }
    catch(err){
      console.error(`[CLONE PROFILE ERROR] ${err}`);
      mut_notice({
        kind : 'error',
        message : err instanceof Error ? err.message : 'could not clone the profile'
      });
    }
    finally{
      mut_busy(false);
    }

  };

  const delete_it = async ( id : number, name : string ) => {

    //the positions are kept, but the profile itself is gone for good, so this
    //is the one action here that has to be agreed to
    if(!window.confirm(`delete '${name}'? the positions it found are kept.`)){ return; }

    mut_busy(true);
    mut_notice(null);

    try{

      const done = await run_delete({
        variables : { id },
        refetchQueries : [ 'get_profiles' ]
      });

      if(done.data?.delete_profile !== true){
        throw new Error('the backend refused to delete the profile');
      }

      //a form left open on the deleted profile would save over nothing
      if(edited_profile?.id === id){ unset_profile_edit(); }

      mut_notice({ kind : 'success', message : `deleted '${name}', its positions were kept` });

    }
    catch(err){
      console.error(`[DELETE PROFILE ERROR] ${err}`);
      mut_notice({
        kind : 'error',
        message : err instanceof Error ? err.message : 'could not delete the profile'
      });
    }
    finally{
      mut_busy(false);
    }

  };

  if(loading){ return (<>loading...</>) }
  if(error){
    console.error(`[EDIT PROFILES ERROR] ${error}`);
    return (<>upss... something went wrong:(</>);
  }

  //apollo hands the result back masked, this cast is the one place the shape is
  //pinned down. building each row field by field also drops __typename, which
  //has no business travelling into the edit form
  const clean_data : Profile[] = (data as ProfilesQuery).get_profiles.map((profile) => ({

    id : Number(profile.id),
    name : profile.name,
    platform_domain : profile.platform_domain,
    url_section : profile.url_section,
    publish_after : profile.publish_after ?? null,
    post_selector : [ ...(profile.post_selector ?? []) ],
    description_selector : [ ...(profile.description_selector ?? []) ],
    keywords : [ ...(profile.keywords ?? []) ],
    anti_keywords : [ ...(profile.anti_keywords ?? []) ]

  }));

  return (

    <div className="edit_profiles">

    { notice && <Notification kind={notice.kind} message={notice.message} /> }

    <EditProfile profile={edited_profile}
    unset_edited_profile={unset_profile_edit}
    is_editing = {is_editing}
    />

    {

      clean_data.map(d => {

        return ( <ProfileElement
                key={d.id}
                id={d.id}
                name={d.name}
                platform={d.platform_domain} section={d.url_section}
                words={d.keywords} published_after={d.publish_after}
                anti_words={d.anti_keywords}
                busy={busy}
                clone_it={clone_it}
                delete_it={delete_it}
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
