import type { Profile } from '../global_types/profile.ts';
import type { Position } from '../global_types/position.ts';

//lowercases and squeezes every whitespace run into a single space, this is what
//lets a phrase like 'computer engineering' survive being wrapped over two lines
export const normalize = ( raw : string ) : string => {
  return raw.toLowerCase().replace(/\s+/g, ' ').trim();
};

//sha256 of the NORMALIZED text, hashing the raw html would change on every
//csrf token, ad id and lazy load skeleton so nothing would ever dedupe
export const content_hash = async ( raw : string ) : Promise<string> => {

  const bytes = new TextEncoder().encode(normalize(raw));
  const digest = await crypto.subtle.digest('SHA-256', bytes);

  return [ ...new Uint8Array(digest) ]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

};

const first_line = ( raw : string ) : string => {
  for(const line of raw.split('\n')){
    const trimmed = line.trim();
    if(trimmed){ return normalize(trimmed); }
  }
  return '';
};

//the profile knows which platform and which profile found this, it knows
//nothing about company/location/publish date, those stay null until profiles
//grow per field extraction selectors.
//
//keywords and anti keywords are not consulted here and nowhere else either:
//the dork carries them into the search itself, so a url that reaches this
//point has already been filtered by them
export const build_position = (
  profile : Profile,
  application_link : string,
  raw : string,
  title? : string
) : Position => {

  const description = normalize(raw);
  const heading = (title ?? '').trim();

  return {
    generic_information : {
      job_title : heading ? heading : first_line(raw),
      date_of_publish : null,
      description,
      which_platform_was_it_found_on : profile.platform_domain,
      company : null,
      location : null
    },
    found_by : profile.name,
    application_link
  };

};
