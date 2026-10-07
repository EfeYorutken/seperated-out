import { gql } from "@apollo/client";
import { useMutation, useQuery } from "@apollo/client/react";
import { useEffect, useState } from "react";

import Notification from "../notification/notification";

import type { DorkHold } from "../../../global_types/dork_hold";

type Notice = { kind : 'error' | 'info' | 'success'; message : string };

const POLL_MS = 3000;

//the window a solve opens has to come up on its own, so a click that did not
//get there is a refusal and is told as one
const act_notice = ( refused : boolean, done : string, refused_message : string ) : Notice => {
  return { kind : refused ? 'error' : 'success', message : refused ? refused_message : done };
};

const DorkSessions = () => {

  const holds_q = gql`
  query dork_holds{
    dork_holds{
      id
      profile_id
      profile_name
      dork
      cause
      state
      created_at
      solved_at
    }
  }
  `;

  const solve_q = gql`
  mutation start_solve_session( $hold_id : ID! ){
    start_solve_session( hold_id : $hold_id )
  }
  `;

  const abort_q = gql`
  mutation abort_solve_session( $hold_id : ID! ){
    abort_solve_session( hold_id : $hold_id )
  }
  `;

  const dismiss_q = gql`
  mutation dismiss_dork_hold( $hold_id : ID! ){
    dismiss_dork_hold( hold_id : $hold_id )
  }
  `;

  const retry_q = gql`
  mutation retry_dork_hold( $hold_id : ID! ){
    retry_dork_hold( hold_id : $hold_id )
  }
  `;

  const { loading, error, data, refetch } = useQuery<{ dork_holds : DorkHold[] }>(holds_q);

  const [solve, solve_state] = useMutation<{ start_solve_session : boolean }, { hold_id : string }>(solve_q);
  const [abort, abort_state] = useMutation<{ abort_solve_session : boolean }, { hold_id : string }>(abort_q);
  const [dismiss, dismiss_state] = useMutation<{ dismiss_dork_hold : boolean }, { hold_id : string }>(dismiss_q);
  const [retry, retry_state] = useMutation<{ retry_dork_hold : boolean }, { hold_id : string }>(retry_q);

  const [ notice, set_notice ] = useState<Notice | null>(null);

  const busy = solve_state.loading || abort_state.loading ||
               dismiss_state.loading || retry_state.loading;

  const holds = (data as { dork_holds : DorkHold[] } | undefined)?.dork_holds ?? [];
  const waiting = holds.some((hold) => hold.state === 'HOLDING' || hold.state === 'SOLVING');

  //the list has to follow the window: solving is the user's time in a browser
  //somewhere else, and the state only changes when they close it
  useEffect(() => {

    if(!waiting){ return; }

    const timer = setInterval(() => { refetch(); }, POLL_MS);
    return () => { clearInterval(timer); };

  }, [ waiting, refetch ]);

  const run = async(
    mutation : ( options : { variables : { hold_id : string } }) =>
      Promise<{ data? : { [key : string] : boolean | undefined } | null }>,
    key : string,
    hold_id : string,
    done : string,
    refused : string
  ) => {

    set_notice(null);

    try{
      const answer = await mutation({ variables : { hold_id } });
      const ok = answer.data?.[key] === true;
      const shaped = act_notice(!ok, done, refused);
      set_notice(shaped);
    }
    catch(err){
      console.error(`[DORK HOLD ERROR] ${err}`);
      set_notice({
        kind : 'error',
        message : err instanceof Error ? err.message : 'something went wrong'
      });
    }

    await refetch();

  };

  const solve_it = ( hold_id : string ) => run(
    solve, 'start_solve_session', hold_id,
    'a browser window opened on that search, solve it and close it',
    'the backend refused to open a solve window, is the crawler busy?'
  );

  const abort_it = ( hold_id : string ) => run(
    abort, 'abort_solve_session', hold_id,
    'the solve window closed, the hold is back on the shelf',
    'the backend refused to close that window'
  );

  const dismiss_it = ( hold_id : string ) => run(
    dismiss, 'dismiss_dork_hold', hold_id,
    'the hold was dismissed, the crawler stops looking for that search',
    'the backend refused to dismiss that hold'
  );

  const retry_it = ( hold_id : string ) => run(
    retry, 'retry_dork_hold', hold_id,
    'the dork was run again, the list will show what came of it',
    'the backend refused the retry, is the crawler still busy?'
  );

  if(loading){ return ( <div className="dork_sessions borderable">loading..</div> ); }
  else if(error){

    console.error(`[DORK SESSIONS ERROR] ${error}`);
    return ( <div className="dork_sessions borderable">ups... something went wrong:(</div> );

  }

  return (

    <div className="dork_sessions borderable">

    <h1>dork sessions google blocked</h1>

    { notice && <Notification kind={notice.kind} message={notice.message} /> }

    {
      holds.length === 0 &&
      <p className="dork_empty">nothing is waiting on a solve right now</p>
    }

    {
      holds.map((hold) => {

        const needs_solving = hold.state === 'HOLDING' || hold.state === 'SOLVING';

        return (
          <div key={hold.id} className="borderable dork_hold">

          <span className="dork_hold_head">

          <h3>{ hold.profile_name }</h3>
          <span className={`dork_cause dork_cause-${hold.cause.toLowerCase()}`}>
            { hold.cause.toLowerCase() }
          </span>

          <span className="dork_state">{ hold.state.toLowerCase() }</span>
          <span className="dork_time">{ new Date(hold.created_at).toLocaleString() }</span>

          </span>

          <code className="dork_query">{ hold.dork }</code>

          <span className="dork_buttons">

          { hold.state === 'HOLDING' &&
            <button disabled={busy} onClick={ ()=>{ solve_it(hold.id); } }>
              solve in a window
            </button> }

          { hold.state === 'SOLVING' &&
            <button disabled={busy} onClick={ ()=>{ abort_it(hold.id); } }>
              close the window
            </button> }

          { hold.state === 'SOLVED' &&
            <button disabled={busy} onClick={ ()=>{ retry_it(hold.id); } }>
              retry now
            </button> }

          { needs_solving &&
            <button className="danger" disabled={busy}
              onClick={ ()=>{ dismiss_it(hold.id); } }>
              dismiss
            </button> }

          </span>

          </div>
        );

      })
    }

    </div>

  );

};

export default DorkSessions;
