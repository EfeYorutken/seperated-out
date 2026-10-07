import type { Profile } from '../global_types/profile.ts';

import { is_duplicate_key } from './db_stuff.ts';
import { build_position, content_hash, normalize } from './matching.ts';

const a_profile = ( overrides : Partial<Profile> = {} ) : Profile => {
  return {
    id : 3,
    name : 'test finder',
    platform_domain : 'someplatform.com',
    url_section : '/jobs/',
    publish_after : null,
    post_selector : [ '.card' ],
    description_selector : [ '.description' ],
    keywords : [ 'nodejs' ],
    anti_keywords : [],
    ...overrides
  };
};

Deno.test('normalize lowercases and squeezes whitespace', () => {
  if(normalize('  Senior   ENGINEER\n\n  ') !== 'senior engineer'){
    throw new Error('whitespace was not collapsed');
  }
});

Deno.test('hash is stable across case and whitespace churn', async () => {
  const first = await content_hash('Senior NodeJS Engineer');
  const second = await content_hash('  senior   nodejs\nengineer  ');
  if(first !== second){ throw new Error('a cosmetic reformat changed the hash'); }
});

Deno.test('hash changes when the wording changes', async () => {
  const first = await content_hash('Senior NodeJS Engineer');
  const second = await content_hash('Senior Rust Engineer');
  if(first === second){ throw new Error('different postings collided'); }
});

Deno.test('build_position carries the profile identity', () => {
  const position = build_position(
    a_profile(),
    'https://example.com/jobs/7',
    'Senior NodeJS Engineer\nWe use graphql daily'
  );

  if(position.found_by !== 'test finder'){ throw new Error('found_by is wrong'); }
  if(position.application_link !== 'https://example.com/jobs/7'){
    throw new Error('application_link is wrong');
  }

  const info = position.generic_information;

  if(info.which_platform_was_it_found_on !== 'someplatform.com'){
    throw new Error('platform is wrong');
  }
  if(info.job_title !== 'senior nodejs engineer'){
    throw new Error(`job_title was '${info.job_title}'`);
  }
  if(!info.description.includes('graphql')){ throw new Error('description was truncated'); }
  if(info.company !== null || info.location !== null || info.date_of_publish !== null){
    throw new Error('unknown fields must stay null instead of being invented');
  }
});

Deno.test('build_position tolerates empty text', () => {
  const position = build_position(a_profile(), 'https://example.com', '');
  if(position.generic_information.job_title !== ''){
    throw new Error('an empty posting still got a title');
  }
});

Deno.test('build_position falls back to the first line when there is no heading', () => {
  const position = build_position(
    a_profile({ post_selector : [], description_selector : [] }),
    'https://example.com',
    '\n\n  rust engineer wanted  \n apply within'
  );
  if(position.generic_information.job_title !== 'rust engineer wanted'){
    throw new Error(`job_title was '${position.generic_information.job_title}'`);
  }
});

Deno.test('the duplicate key guard only fires on 11000', () => {
  if(!is_duplicate_key({ code : 11000 })){ throw new Error('missed a duplicate key'); }
  if(is_duplicate_key({ code : 11001 })){ throw new Error('treated another error as a clash'); }
  if(is_duplicate_key(new Error('boom'))){ throw new Error('treated a plain error as a clash'); }
  if(is_duplicate_key(null)){ throw new Error('treated null as a clash'); }
});
