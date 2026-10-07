export const PAGE_SCRIPT = String.raw`
(() => {
  if(window.__seperated_out_installed__){ return; }
  window.__seperated_out_installed__ = true;

  const LOG_KEY = '__seperated_out_crawl_events__';
  const SEQ_KEY = '__seperated_out_crawl_seq__';
  const READY_KEY = '__seperated_out_ready__';
  const SAVED_CLASS = 'seperated-out-saved-selector';
  const MARKED_CLASS = 'seperated-out-marked-candidate';

  const storage = (() => {
    try {
      const probe = '__seperated_out_probe__';
      window.sessionStorage.setItem(probe, '1');
      window.sessionStorage.removeItem(probe);
      return window.sessionStorage;
    } catch {
      return null;
    }
  })();

  const memory = { events : [], seq : 0 };

  const read_all = () => {
    if(!storage){ return memory.events; }
    try{
      const raw = storage.getItem(LOG_KEY);
      return raw ? JSON.parse(raw) : [];
    }
    catch{
      return [];
    }
  };

  const push = (event) => {
    let seq;
    if(storage){
      seq = (parseInt(storage.getItem(SEQ_KEY) || '0', 10) || 0) + 1;
      storage.setItem(SEQ_KEY, String(seq));
      const events = read_all();
      events.push(Object.assign({}, event, { seq : seq }));
      storage.setItem(LOG_KEY, JSON.stringify(events));
    }
    else{
      seq = ++memory.seq;
      memory.events.push(Object.assign({}, event, { seq : seq }));
    }
  };

  const escape_ident = (value) => {
    if(window.CSS && window.CSS.escape){ return window.CSS.escape(value); }
    return String(value).replace(/[^\w-]/g, (ch) => '\\' + ch);
  };

  //ours, not the page's, and both of them change after the click
  const page_classes = (element) => {
    return Array.prototype.filter.call(
      element.classList,
      (name) => name !== SAVED_CLASS && name !== MARKED_CLASS
    );
  };

  /*
   * the element's OWN hooks, strongest first: an id, a name attribute, its
   * classes, and failing all of that the bare tag. no ancestors and no
   * nth-of-type.
   *
   * this is what right clicks record, and a right click says "a real posting
   * has this in it", so it wants to be a shape rather than a place: the replay
   * checks this selector inside every marked candidate
   *
   * allow_name controls the one shape that is not a tag, a class or an id: the
   * name attribute. a name is worth keeping for a section, two checkboxes on
   * one form are told apart by it
   */
  const general_path = (element, allow_name) => {
    if(!(element instanceof Element)){ return null; }

    const tag = element.tagName.toLowerCase();

    if(element.id){ return '#' + escape_ident(element.id); }

    /*
     * a label carries no id of its own, so a bare tag was all it could ever
     * give and that matched every label on the page. its control is the element
     * the label actually drives, and its id is the precise thing worth keeping
     */
    if(tag === 'label'){
      const control = element.control;
      if(control && control.id){ return '#' + escape_ident(control.id); }
    }

    if(allow_name){
      const name_attr = element.getAttribute ? element.getAttribute('name') : null;
      if(name_attr && /^[A-Za-z][\w-]*$/.test(name_attr)){
        return tag + '[name="' + name_attr + '"]';
      }
    }

    const classes = page_classes(element);

    if(classes.length){
      return tag + Array.prototype.map.call(
        classes,
        (name) => '.' + escape_ident(name)
      ).join('');
    }

    return tag;
  };

  /*
   * a middle click says "every element shaped like this one is worth reading",
   * so it drops the id, the name and every ancestor and keeps the tag and the
   * classes, nothing more:
   *
   *   <div class="card" id="job-4417">   all three give 'div.card'
   *   <div class="card" id="job-9931">
   *   <div class="card" id="job-1204">
   *
   * a per-posting id would name exactly one of them, which is the opposite of
   * what was asked for. the fallback is the bare tag, which cannot tell two
   * elements of a kind apart at all, and that is survivable only because the
   * replay does not act on this selector: it checks the saved sections inside
   * every match and keeps the ones that hold all of them. replay.ts warns when
   * a bare tag fans out wide
   */
  const mark_path = (element) => {
    if(!(element instanceof Element)){ return null; }

    const classes = page_classes(element);

    if(classes.length){
      return element.tagName.toLowerCase() + Array.prototype.map.call(
        classes,
        (name) => '.' + escape_ident(name)
      ).join('');
    }

    return element.tagName.toLowerCase();
  };

  const keep_everything_in_one_tab = () => {
    for(const anchor of document.querySelectorAll('a[target]')){
      if(anchor.target && anchor.target !== '_self'){ anchor.target = '_self'; }
    }
  };

  const mark_as_saved = (element) => {
    if(!(element instanceof Element)){ return; }
    if(element.hasAttribute('data-seperated-out')){ return; }
    element.classList.add(SAVED_CLASS);
  };

  const mark_as_candidate = (element) => {
    if(!(element instanceof Element)){ return; }
    if(element.hasAttribute('data-seperated-out')){ return; }
    element.classList.add(MARKED_CLASS);
  };

  //a navigation drops both marks off screen, so they are put back from the log
  const reapply_saved_marks = () => {
    for(const event of read_all()){

      if(event.kind === 'SELECT' && event.selector){
        try{
          for(const found of document.querySelectorAll(event.selector)){ mark_as_saved(found); }
        }
        catch{
          continue;
        }
      }

      if(event.kind === 'MARK' && event.selector){
        try{
          for(const found of document.querySelectorAll(event.selector)){ mark_as_candidate(found); }
        }
        catch{
          continue;
        }
      }

    }
  };

  //a middle click names the whole element, not a part of it. see mark_path
  const record_mark = (element) => {
    if(!(element instanceof Element)){ return; }
    const selector = mark_path(element);
    if(!selector){ return; }
    push({ kind : 'MARK', selector : selector });
    mark_as_candidate(element);
  };

  const inject_chrome = () => {
    if(document.getElementById('seperated-out-style')){ return; }

    const style = document.createElement('style');
    style.id = 'seperated-out-style';
    style.textContent =
      //a section, one part of a posting. red, solid
      '.' + SAVED_CLASS + '{outline:2px solid #e5484d !important;outline-offset:1px !important;}' +
      //a candidate, the whole posting. green, dashed, so the two never read as
      //the same kind of marking at a glance
      '.' + MARKED_CLASS + '{outline:2px dashed #30a46c !important;outline-offset:2px !important;}' +
      '#seperated-out-hint{position:fixed;right:8px;bottom:8px;z-index:2147483647;' +
      'pointer-events:none;opacity:0.85;font:12px/1.4 monospace;color:#fff;background:#111;' +
      'padding:6px 8px;border-radius:4px;max-width:280px;}';
    document.documentElement.appendChild(style);

    const hint = document.createElement('div');
    hint.id = 'seperated-out-hint';
    hint.setAttribute('data-seperated-out', '1');
    hint.textContent =
      'middle click a posting, right click the parts every posting has';
    document.documentElement.appendChild(hint);
  };

  document.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const selector = general_path(event.target, true);
    if(!selector){ return; }
    push({ kind : 'SELECT', selector : selector });
    mark_as_saved(event.target);
  }, true);

  /*
   * mousedown and not auxclick, which is the more modern of the two. mousedown
   * is the one every engine agrees on, and it is the only one of the pair where
   * preventDefault actually reaches the middle button: it is what stops a
   * middle DRAG from turning into an autoscroll cursor
   */
  document.addEventListener('mousedown', (event) => {
    if(event.button !== 1){ return; }
    //no stopPropagation here, the page's own middle click handlers still run
    event.preventDefault();
    record_mark(event.target);
  }, true);

  /*
   * the matching auxclick exists only for its preventDefault. on linux a middle
   * click on a link opens it in a new background tab, which would spawn a page
   * the recorder then adopts and keeps recording into
   */
  document.addEventListener('auxclick', (event) => {
    if(event.button !== 1){ return; }
    event.preventDefault();
  }, true);

  const install = () => {
    if(document.getElementById('seperated-out-hint')){ return; }
    if(document.body){
      inject_chrome();
      keep_everything_in_one_tab();
      reapply_saved_marks();
      window[READY_KEY] = true;
      return;
    }
    document.addEventListener('DOMContentLoaded', install, { once : true });
  };

  install();

  window.__seperated_out_drain__ = (after_seq) => {
    const events = read_all();
    return {
      last_seq : events.length ? events[events.length - 1].seq : (after_seq || 0),
      events : events.filter((event) => event.seq > (after_seq || 0))
    };
  };
})();
`;
