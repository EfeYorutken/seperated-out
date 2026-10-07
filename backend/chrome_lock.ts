/*
 * a chrome profile directory can only be held by one browser process at a
 * time, and the dork (ticks and recording alike) and the solve window all
 * read and write the cookies of the same crawler profile. launching a browser
 * on that directory without a lock means the second one fails to start, so
 * every such launch has to pass through the lock first
 */

type Waiter = {
  grant : ( release : (() => void) | null ) => void;
  timeout : ReturnType<typeof setTimeout> | null;
};

class Mutex {

  private held = false;
  private queue : Waiter[] = [];

  /*
   * parks the caller behind whoever holds the lock. resolves with the release
   * function when it comes free, or with null when timeout_ms passes first.
   * the returned release is a once wrapper: calling a release twice can not
   * hand the lock to two holders
   */
  acquire = ( timeout_ms : number | null = null ) : Promise<(() => void) | null> => {

    return new Promise((resolve) => {

      if(!this.held){
        this.held = true;
        resolve(once(this.release));
        return;
      }

      const waiter : Waiter = {
        grant : (release) => {
          if(release){ release = once(release as () => void); }
          resolve(release);
        },
        timeout : null
      };

      if(timeout_ms !== null){
        waiter.timeout = setTimeout(() => {
          const at = this.queue.indexOf(waiter);
          //already handed the lock by release(), nothing to undo
          if(at < 0){ return; }
          this.queue.splice(at, 1);
          waiter.grant(null);
        }, timeout_ms);
      }

      this.queue.push(waiter);

    });

  };

  release = () : void => {
    const next = this.queue.shift();
    if(!next){ this.held = false; return; }
    if(next.timeout){ clearTimeout(next.timeout); }
    next.grant(this.release);
  };

}

const once = ( fn : () => void ) : () => void => {
  let done = false;
  return () => {
    if(done){ return; }
    done = true;
    fn();
  };
};

const crawler_dir_lock = new Mutex();

/*
 * a zero timeout tries once and fails fast, which is what a tick wants: when
 * any other holder has the directory the tick has nothing to do. a long
 * timeout is what the solve window and the recording dork want, they can park
 * until the crawler comes free
 */
export const acquire_crawler_dir = (
  timeout_ms : number | null = null
) : Promise<(() => void) | null> => {
  return crawler_dir_lock.acquire(timeout_ms);
};