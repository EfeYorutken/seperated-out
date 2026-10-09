//a dork google pushed back with a wall: shown in the anti-bot panel where the
//user can solve it once in a headful window, and it carries on afterwards.
//the types are the strings the graphql enums serialize to
export type DorkHoldCause = 'CAPTCHA' | 'CONSENT';
export type DorkHoldState = 'HOLDING' | 'SOLVING' | 'SOLVED' | 'DISCARDED';

export type DorkHold = {
  id : string;
  profile_id : number;
  profile_name : string;
  //the exact query google blocked, shown on the hold itself
  dork : string;
  cause : DorkHoldCause;
  state : DorkHoldState;
  //whether a tick or a recording session raised it
  purpose? : 'tick' | 'recording';
  created_at : string;
  solved_at : string | null;
};
