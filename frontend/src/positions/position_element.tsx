import { gql } from "@apollo/client";
import { useMutation } from "@apollo/client/react";
import { useState } from "react";

import type { Position } from "../../../global_types/position";
import Notification from "../notification/notification";

type Notice = { kind : 'error' | 'info' | 'success'; message : string };

//a posting is scraped text, so the link is not to be trusted blindly. only
//http(s) is handed to the browser, a javascript: url here would run with this
//page's privileges
const open_application = ( raw : string ) => {

  const link = (raw ?? '').trim();

  if(!link){ return; }

  let parsed : URL;
  try{
    parsed = new URL(link);
  }
  catch{
    console.error(`[APPLY LINK ERROR] '${link}' is not a url`);
    return;
  }

  if(parsed.protocol !== 'http:' && parsed.protocol !== 'https:'){
    console.error(`[APPLY LINK ERROR] refusing to open a ${parsed.protocol} url`);
    return;
  }

  //noopener so the posting's page cannot reach back through window.opener
  window.open(parsed.href, '_blank', 'noopener,noreferrer');

};

const PositionElement = ( { pos } : {pos : Position} )=> {

  const forget_q = gql`
  mutation forget_position_hash( $url : String! ){
    forget_position_hash( url : $url )
  }
  `;

  const remove_q = gql`
  mutation remove_position( $id : ID! ){
    remove_position( id : $id )
  }
  `;

  const [forget, forget_state] = useMutation<{ forget_position_hash : boolean },
                                              { url : string }>(forget_q);

  const [remove, remove_state] = useMutation<{ remove_position : boolean },
                                              { id : string }>(remove_q);

  const [notice, set_notice] = useState<Notice | null>(null);

  const busy = forget_state.loading || remove_state.loading;
  const has_link = (pos.application_link ?? '').trim().length > 0;
  const title = pos.generic_information.job_title;

  /*
   * the two buttons are deliberate opposites. forgetting drops the dedupe
   * record and keeps the posting, so the next crawl stores it again. removing
   * drops the posting and keeps the dedupe record, so it stays gone. either
   * one answers with a boolean and false is the backend refusing
   */
  const act = async(
    which : 'forget' | 'remove',
    run : () => Promise<{ data? : { [k : string] : boolean | undefined } | null }>,
    key : string,
    what : string
  ) => {

    set_notice(null);

    try{

      const done = await run();

      if(done.data?.[key] !== true){
        throw new Error(`the backend refused to ${what}`);
      }

      set_notice({ kind : 'success', message : `${what}` });

    }
    catch(err){
      console.error(`[${which.toUpperCase()} POSITION ERROR] ${err}`);
      set_notice({
        kind : 'error',
        message : err instanceof Error ? err.message : `could not ${what}`
      });
    }

  };

  const forget_it = () => act(
    'forget',
    //refetched so the list re-renders, and the refetch is what proves it stuck.
    //the hash is taken from the application url, so that is what has to be sent
    () => forget({
      variables : { url : pos.application_link },
      refetchQueries : [ 'get_positions' ]
    }),
    'forget_position_hash',
    'hash forgotten, the next crawl will find this posting again'
  );

  const remove_it = () => {

    //this one drops the posting itself, so it gets a yes first
    if(!window.confirm(`remove '${title}' from the positions list? ` +
        `its hash is kept, so the crawler will not bring it back.`)){ return; }

    act(
      'remove',
      () => remove({
        variables : { id : pos.id ?? '' },
        refetchQueries : [ 'get_positions' ]
      }),
      'remove_position',
      'position removed'
    );

  };

  return (

    <div className="position borderable">
    <span className="basics" >

    <h3>{ title }</h3>

    { pos.generic_information.company } { pos.generic_information.location }

    </span>
    <span className="specific">

    { pos.found_by }<br/>
    { pos.generic_information.date_of_publish }

    </span>

    { notice && <Notification kind={notice.kind} message={notice.message} /> }

    <span className="position_buttons">

    <button disabled={!has_link} onClick={ ()=>{ open_application(pos.application_link) } }>
      Apply
    </button>

    <button disabled={busy || !has_link} title="drop the dedupe record, the posting stays"
      onClick={ ()=>{ forget_it() } }>
      forget
    </button>

    <button className="danger" disabled={busy}
      title="remove the posting, its hash is kept"
      onClick={ ()=>{ remove_it() } }>
      remove
    </button>

    </span>

    </div>

  );

};

export default PositionElement;
