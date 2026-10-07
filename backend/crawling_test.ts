import { build_result, type CrawlingEvent } from './crawling.ts';

let seq = 0;

const mark = (selector : string) : CrawlingEvent => ({
  seq : seq++,
  kind : 'MARK',
  selector
});

const select = (selector : string) : CrawlingEvent => ({
  seq : seq++,
  kind : 'SELECT',
  selector
});

const reset = () => { seq = 0; };

Deno.test('a middle click lands in post_selector', () => {
  reset();
  const result = build_result([ mark('a.row'), mark('div.card') ]);

  if(result.post_selector.join(',') !== 'a.row,div.card'){
    throw new Error(`post_selector was ${JSON.stringify(result.post_selector)}`);
  }
  if(result.description_selector.length){
    throw new Error('a middle click leaked into description_selector');
  }
});

Deno.test('a right click lands in description_selector', () => {
  reset();
  const result = build_result([ select('.description'), select('h1') ]);

  if(result.description_selector.join(',') !== '.description,h1'){
    throw new Error(`description_selector was ${JSON.stringify(result.description_selector)}`);
  }
  if(result.post_selector.length){
    throw new Error('a right click leaked into post_selector');
  }
});

Deno.test('the two sets are filled side by side, in the order they were pointed at', () => {
  reset();
  const result = build_result([
    mark('a.row'),
    select('.description'),
    mark('#next'),
    select('h1')
  ]);

  if(result.post_selector.join(',') !== 'a.row,#next'){
    throw new Error(`post_selector was ${JSON.stringify(result.post_selector)}`);
  }
  if(result.description_selector.join(',') !== '.description,h1'){
    throw new Error(`description_selector was ${JSON.stringify(result.description_selector)}`);
  }
});

Deno.test('a repeat of the same shape is one selector, not two', () => {
  reset();
  const result = build_result([
    mark('div.card'),
    mark('div.card'),
    select('.description'),
    select('.description')
  ]);

  if(result.post_selector.length !== 1){
    throw new Error(`${result.post_selector.length} post selectors came through`);
  }
  if(result.description_selector.length !== 1){
    throw new Error(`${result.description_selector.length} description selectors came through`);
  }
});

Deno.test('the same selector can be both a post and a description section', () => {
  //nothing forbids the user pointing at one element twice with different
  //buttons, and each click belongs to the set it was recorded on
  reset();
  const result = build_result([ mark('div.card'), select('div.card') ]);

  if(result.post_selector[0] !== 'div.card' || result.description_selector[0] !== 'div.card'){
    throw new Error(`the capture was ${JSON.stringify(result)}`);
  }
});

Deno.test('an event with no selector is skipped', () => {
  reset();
  const result = build_result([
    { seq : seq++, kind : 'MARK' },
    mark('a.row')
  ]);

  if(result.post_selector.join(',') !== 'a.row'){
    throw new Error(`post_selector was ${JSON.stringify(result.post_selector)}`);
  }
});

Deno.test('an empty recording is an empty capture rather than a failure', () => {
  reset();
  const result = build_result([]);

  if(result.post_selector.length || result.description_selector.length){
    throw new Error(`the capture was ${JSON.stringify(result)}`);
  }
});
