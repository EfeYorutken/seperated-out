//colours are derived from the profile, not stored, so the same profile always
//gets the same colour on every reload and for every user, and a profile never
//changes colour just because another one was added or removed

//fnv1a, small and spreads short strings like profile names well
const fnv1a = ( value : string ) : number => {

  let hash = 0x811c9dc5;

  for(let i = 0; i < value.length; i++){
    hash ^= value.charCodeAt(i);
    //0x01000193, the fnv prime
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash >>> 0;

};

export type Rgb = { r : number; g : number; b : number };

const hue_to_rgb = ( p : number, q : number, t : number ) : number => {

  let value = t;
  if(value < 0){ value += 1; }
  if(value > 1){ value -= 1; }

  if(value < 1 / 6){ return p + (q - p) * 6 * value; }
  if(value < 1 / 2){ return q; }
  if(value < 2 / 3){ return p + (q - p) * (2 / 3 - value) * 6; }

  return p;

};

const hsl_to_rgb = ( h : number, s : number, l : number ) : Rgb => {

  const hue = ((h % 360) + 360) % 360 / 360;
  const sat = s / 100;
  const lit = l / 100;

  if(sat === 0){
    const grey = Math.round(lit * 255);
    return { r : grey, g : grey, b : grey };
  }

  const q = lit < 0.5 ? lit * (1 + sat) : lit + sat - lit * sat;
  const p = 2 * lit - q;

  return {
    r : Math.round(hue_to_rgb(p, q, hue + 1 / 3) * 255),
    g : Math.round(hue_to_rgb(p, q, hue) * 255),
    b : Math.round(hue_to_rgb(p, q, hue - 1 / 3) * 255)
  };

};

export const rgb_string = ( { r, g, b } : Rgb ) : string => {
  return `rgb(${r}, ${g}, ${b})`;
};

//the two profiles a plain hash lands on the same hue would be indistinguishable,
//so hues are handed out in a stable order and each one walks the wheel until it
//finds room
const hue_gap = 30;
const hue_is_free = ( hue : number, taken : number[] ) : {

  ok : boolean;

} => {

  for(const used of taken){
    //shortest distance around the circle, so 350 and 10 count as neighbours
    const distance = Math.abs(((used - hue) % 360 + 540) % 360 - 180);
    if(distance < hue_gap){ return { ok : false }; }
  }

  return { ok : true };

};
export type NamedProfile = { profile_id : number; profile_name : string };

//the backend already sorts by id, sorting again here means the result cannot
//change just because something upstream got the order wrong
export const colors_for = ( profiles : NamedProfile[] ) : Map<number, string> => {

  const ordered = [ ...profiles ].sort((a, b) => a.profile_id - b.profile_id);

  const assigned = new Map<number, string>();
  const taken : number[] = [];

  for(const profile of ordered){

    const seed = fnv1a(`${profile.profile_id}:${profile.profile_name}`);

    //three decorrelated slices out of the one hash
    const wanted = seed % 360;
    const sat = 58 + (seed >>> 9) % 22;
    const lit = 42 + (seed >>> 17) % 16;

    let hue = wanted;
    for(let step = 0; step < 12; step++){
      if(hue_is_free(hue, taken).ok){ break; }
      hue = (wanted + (step + 1) * hue_gap) % 360;
    }

    taken.push(hue);
    assigned.set(profile.profile_id, rgb_string(hsl_to_rgb(hue, sat, lit)));

  }

  return assigned;

};

//recharts keys a line off the dataKey, profile names can repeat but ids cannot
export const line_key = ( profile_id : number ) : string => `p_${profile_id}`;
