import type { Profile } from '../global_types/profile.ts';

import { build_dork } from './dork.ts';

const profile = ( overrides : Partial<Profile> = {} ) : Profile => {
  return {
    id : 0,
    name : 'dork test',
    platform_domain : 'www.example-jobs.com',
    url_section : '/open-positions/',
    publish_after : null,
    post_selector : [ '.card' ],
    description_selector : [ '.description' ],
    keywords : [ 'rust', 'backend' ],
    anti_keywords : [],
    ...overrides
  };
};

Deno.test('the dork picks the platform and the url section', () => {
  const dork = build_dork(profile({ keywords : [] }));
  if(dork !== 'site:www.example-jobs.com inurl:/open-positions/'){
    throw new Error(`the dork was '${dork}'`);
  }
});

Deno.test('several keywords become one or group', () => {
  const dork = build_dork(profile());
  if(!dork.includes('(rust OR backend)')){ throw new Error(`the dork was '${dork}'`); }
});

Deno.test('a single keyword is not wrapped in a group', () => {
  const dork = build_dork(profile({ keywords : [ 'rust' ] }));
  if(!dork.includes(' rust ') && !dork.endsWith(' rust')){
    throw new Error(`the dork was '${dork}'`);
  }
  if(dork.includes('(')){ throw new Error(`the dork was '${dork}'`); }
});

Deno.test('a keyword with a space is quoted so it searches as a phrase', () => {
  const dork = build_dork(profile({ keywords : [ 'computer engineering' ] }));
  if(!dork.includes('"computer engineering"')){
    throw new Error(`the dork was '${dork}'`);
  }
});

Deno.test('every anti keyword becomes an exclusion', () => {
  const dork = build_dork(profile({ anti_keywords : [ 'internship', 'senior level' ] }));
  if(!dork.includes('-internship')){ throw new Error(`the dork was '${dork}'`); }
  if(!dork.includes('-"senior level"')){ throw new Error(`the dork was '${dork}'`); }
});

Deno.test('a publish date becomes after', () => {
  const dork = build_dork(profile({ publish_after : '2026-01-01' }));
  if(!dork.includes('after:2026-01-01')){ throw new Error(`the dork was '${dork}'`); }
});

Deno.test('no publish date leaves the dork without a bound', () => {
  const dork = build_dork(profile({ publish_after : null }));
  if(dork.includes('after:')){ throw new Error(`the dork was '${dork}'`); }
});

Deno.test('blank parts are left out rather than searched for as nothing', () => {
  const dork = build_dork(profile({
    url_section : '   ',
    keywords : [ '', '  ' ],
    anti_keywords : [ ' ' ],
    publish_after : ''
  }));

  if(dork.includes('inurl:')){ throw new Error(`the dork was '${dork}'`); }
  if(dork.includes('after:')){ throw new Error(`the dork was '${dork}'`); }
  if(dork.includes('()')){ throw new Error(`the dork was '${dork}'`); }
  //the hyphen in the domain is not an exclusion, only a part that starts with
  //one would be
  if(dork.split(' ').some((part) => part.startsWith('-'))){
    throw new Error(`the dork was '${dork}'`);
  }
});

Deno.test('a domain typed with a protocol still lands as site:', () => {
  const dork = build_dork(profile({ platform_domain : 'https://www.example-jobs.com/jobs' }));
  if(!dork.startsWith('site:www.example-jobs.com ')){
    throw new Error(`the dork was '${dork}'`);
  }
});

Deno.test('the whole query is one string of every part at once', () => {
  const dork = build_dork(profile({
    publish_after : '2025-06-01',
    anti_keywords : [ 'remote' ]
  }));

  const expected =
    'site:www.example-jobs.com inurl:/open-positions/ (rust OR backend) ' +
    '-remote after:2025-06-01';

  if(dork !== expected){ throw new Error(`the dork was '${dork}'`); }
});
