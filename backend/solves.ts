import type { Browser, Page } from 'puppeteer';

import * as db_manager from './db_stuff.ts';
import { acquire_crawler_dir } from './chrome_lock.ts';
import { launch_crawler_browser, CRAWLER_CHROME_DIR } from './replay.ts';

const NAV_TIMEOUT_MS = 30_000;
//a tick or the recording dork can hold the crawler chrome dir for a while; the
//solve window parks until it lets go instead of failing the user's click
const SOLVE_DIR_TIMEOUT_MS = 5 * 60 * 1000;

type SolveWindow = {
  hold_id : string;
  browser : Browser | null;
  release_dir : (() => void) | null;
  finished : boolean;
  teardown : (() => void) | null;
};

const windows = new Map<string, SolveWindow>();

/*
 * while a solve window is open (or parked waiting for the chrome dir) the
 * scheduler must not launch a tick on the same profile directory, launching
 * two browsers on one userDataDir is how a chrome fails to start
 */
export const is_solve_active = () : boolean => {
  return [ ...windows.values() ].some((win) => !win.finished);
};

const launch_browser = async () : Promise<Browser> => {
  return await launch_crawler_browser({
    headless : false,
    user_data_dir : CRAWLER_CHROME_DIR
  });
};

export const start_solve = async ( hold_id : string ) : Promise<boolean> => {

  if(windows.has(hold_id)){ return false; }

  const hold = await db_manager.find_dork_hold(hold_id);
  if(!hold || hold.state !== 'HOLDING'){ return false; }

  const win : SolveWindow = {
    hold_id,
    browser : null,
    release_dir : null,
    finished : false,
    teardown : null
  };

  //registered before the window exists so no tick can grab the chrome dir in
  //the gap between the click and the launch
  windows.set(hold_id, win);

  const close_browser = () : void => {
    const dying = win.browser;
    win.browser = null;
    if(dying){ dying.close().catch(() => {}); }
  };

  const finish = async () : Promise<void> => {
    if(win.finished){ return; }
    win.finished = true;
    close_browser();
    win.release_dir?.();
    win.release_dir = null;
    win.teardown = null;
    windows.delete(hold_id);
    await db_manager.resolve_dork_hold(hold_id);
    console.log(`[SOLVE] hold ${hold_id} solved, cookies saved to the crawler chrome dir`);
  };

  try{

    win.release_dir = await acquire_crawler_dir(SOLVE_DIR_TIMEOUT_MS);
    if(!win.release_dir){
      throw new Error('the crawler chrome directory stayed busy, try again in a moment');
    }

    //mark it first, the list should say solving before the window is up
    await db_manager.mark_dork_hold_solving(hold_id);

    win.browser = await launch_browser();

    const page : Page = await win.browser.newPage();

    //any of these going away is the solve being done, the cookies stay behind
    page.on('close', () => { void finish(); });
    win.browser.on('disconnected', () => { void finish(); });

    //the very search url the headless dork was pushed off, so whatever the
    //wall was it is right there in front of the user
    const query = `https://www.google.com/search?q=${encodeURIComponent(hold.dork)}&num=100`;

    await page.goto(query, { waitUntil : 'domcontentloaded', timeout : NAV_TIMEOUT_MS });

    win.teardown = () => { void finish(); };

    console.log(`[SOLVE] a window opened for hold ${hold_id}, close it when the wall is passed`);
    return true;

  }
  catch(err){
    console.error(`[SOLVE] could not open a window for hold ${hold_id}: ${err}`);
    win.finished = true;
    win.release_dir?.();
    win.release_dir = null;
    close_browser();
    windows.delete(hold_id);
    //nothing was solved, so the hold is back on the shelf for another try
    await db_manager.mark_dork_hold_holding(hold_id);
    return false;
  }

};

export const abort_solve = async ( hold_id : string ) : Promise<boolean> => {

  const win = windows.get(hold_id);
  if(!win || win.finished){ return false; }

  win.finished = true;
  win.teardown = null;
  const browser = win.browser;
  win.browser = null;
  if(browser){ await browser.close().catch(() => {}); }
  win.release_dir?.();
  win.release_dir = null;
  windows.delete(hold_id);

  //the window is gone without anyone solving anything, keep the hold for a
  //later attempt
  await db_manager.mark_dork_hold_holding(hold_id);
  console.log(`[SOLVE] window for hold ${hold_id} closed by the user`);
  return true;

};