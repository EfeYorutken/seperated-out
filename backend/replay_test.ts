import { is_bare_tag, STEP_ATTEMPTS } from './replay.ts';

Deno.test('a tag on its own is bare', () => {
  for(const selector of [ 'label', 'input', 'div', 'a', 'span', 'p' ]){
    if(!is_bare_tag(selector)){ throw new Error(`${selector} should be bare`); }
  }
});

Deno.test('an id is not a bare tag', () => {
  if(is_bare_tag('#first')){ throw new Error('#first is not a bare tag'); }
});

Deno.test('classes are not a bare tag', () => {
  for(const selector of [ 'a.row', 'div.card-layout', 'input.search-field' ]){
    if(is_bare_tag(selector)){ throw new Error(`${selector} is not a bare tag`); }
  }
});

Deno.test('an attribute selector is not a bare tag', () => {
  //these are exactly the ones the recorder emits when it falls past the id,
  //and the failure this guards against is misreading one for a bare tag
  for(const selector of [ 'input[name="q"]', 'div[data-id="1"]' ]){
    if(is_bare_tag(selector)){ throw new Error(`${selector} is not a bare tag`); }
  }
});

Deno.test('the descendant and pseudo forms are not bare tags', () => {
  for(const selector of [ 'div > a', 'li:nth-of-type(2) > a', 'div > div > p' ]){
    if(is_bare_tag(selector)){ throw new Error(`${selector} is not a bare tag`); }
  }
});

Deno.test('a bare tag is a tag and one optional hyphen or digit', () => {
  //h1 and my-widget are what a browser tag actually looks like, and neither
  //may be reported as bare or the warning goes quiet on real pages
  for(const selector of [ 'h1', 'h6', 'my-widget', 'custom-element' ]){
    if(!is_bare_tag(selector)){ throw new Error(`${selector} should be bare`); }
  }
});

Deno.test('surrounding space does not hide a bare tag', () => {
  //a hand typed selector in the profile form is the likeliest way one arrives
  if(!is_bare_tag('  label  ')){ throw new Error('a padded bare tag went unnoticed'); }
});

Deno.test('the retry budget is three attempts', () => {
  //the whole point of the retry is that a step survives one bad page load, so
  //the count is a behaviour other files are entitled to rely on
  if(STEP_ATTEMPTS !== 3){
    throw new Error(`the budget is ${STEP_ATTEMPTS} attempts`);
  }
});
