/*
 * the one thing the solve window has to say to the scheduler: this hold is
 * solved, run the profile again.
 *
 * it lives here rather than as a direct call because scheduler.ts already
 * imports solves.ts for is_solve_active, and solves.ts importing the scheduler
 * back would close the cycle. a listener registry keeps the two apart
 */

export type HoldSolvedListener = ( hold_id : string ) => void;

const listeners = new Set<HoldSolvedListener>();

export const on_hold_solved = ( listener : HoldSolvedListener ) : void => {
  listeners.add(listener);
};

export const emit_hold_solved = ( hold_id : string ) : void => {
  for(const listener of listeners){
    try{
      listener(hold_id);
    }
    catch(err){
      console.error(`[HOLD EVENTS] a solved listener failed for ${hold_id}: ${err}`);
    }
  }
};
