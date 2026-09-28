import { gql } from "@apollo/client";
import { useQuery } from "@apollo/client/react";

import { Action } from "../../../../../global_types/profile"

interface params {

  where_to_look_and_how : { keywords : string[], selectors : string[] };
  start_url : string,
  acts2arrive_at_the_job : {action : Action, selector : string}[];

};

const CrawlerProgrammer = ( { where_to_look_and_how, start_url, acts2arrive_at_the_job } : params )=>{

  const get_page_doc_q = gql`

  query get_page_doc( $url : String ){

    get_page_doc(page_url : $url)

  }

  `;

  const { loading, error, data } = useQuery(get_page_doc_q, {
    variables : { url : start_url }
  });

  if( loading ){
    return(<>fucking loading</>)
  }

  if( error ){
    console.error(`[FUCKING CRAWLER ERROR] ${error}`);
    return(<>fucking error &gt:(</>)
  }

  console.log(JSON.stringify(data));

  return (
    <>

    <iframe srcDoc={JSON.stringify(data.get_page_doc as string)} style={
      {
        width : '100%', height : '100%'
      }
    }/>

    </>
  );
};

export default CrawlerProgrammer;
