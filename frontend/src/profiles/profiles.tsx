import { useQuery } from "@apollo/client/react";
import { gql } from "@apollo/client";
import { useState } from "react";

import ProfileElement from "./profile_element";
import EditProfiles from "./edit_profile/edit_profiles";
import Modal from "../modal/modal";

const Profiles = ()=>{

  const [ open, mut_open ] = useState(false);

  const profile_q = gql`

  query get_profiles{

    get_profiles{
      name
    }

  }
  `;

  const {loading, error, data} = useQuery(profile_q);

  if(loading){ return ( <div>loading..</div> ); }
  else if(error){

    console.error(`[PROFILE ERROR] ${error}`);

    return ( <div>ups... something went wrong:(</div> ); 
  }

  return (

    <div className="positions borderable">
    <h1> this is where the profiles goes </h1>

    <Modal is_open={open} closer={()=>{mut_open(false);}}> <EditProfiles /> </Modal>
    <button onClick={()=>{mut_open(true);}}>edit profiles</button>

    {
      data.get_profiles.map((prof )=>{
        return (<ProfileElement name={prof.name}/>)
      })
    }
    
    </div>

  )
};

export default Profiles;
