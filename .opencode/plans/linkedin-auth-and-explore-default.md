# LinkedIn: out-of-band login, explore on by default, unpin the start url

## Why the profile matched nothing

`[REPLAY] 'ts backend' skipped a branch: Error: step 0 (CLICK) found no element for
'#rememberMeOptIn-checkbox' after 3 attempts`, then `matched=0 new=0 errors=0`.

That string is printed only from the branch loop at `replay.ts:484`. The counting pass
at `replay.ts:458` has no per-branch catch, so a throw there would surface as
`[SCHEDULER] profile 'ts backend' failed` with `errors=1`. The log said `errors=0`, so
the counting pass ran all 11 steps and the *next* visit failed on step 0.

That is the sign-in working. Steps 0-9 are a LinkedIn login and step 9 clicks
`button.btn__primary--large`, so the counting pass genuinely authenticates. The cookie
lands in the browser `scheduler.ts:223` launched once for the whole tick. The branch pass
navigates again, is already authenticated, gets redirected past the form, and
`#rememberMeOptIn-checkbox` genuinely is not there. Zero outcomes means the loop over
`end_urls` never runs, hence matched=0 new=0 errors=0.

70.1s corroborates: two 11-step passes at ~1.5s content wait each, plus ~3s of retries on
step 0 in the second.

The step-10 line in the same paste is from a later tick and is benign: 25 matches, no
section involvement, falls back to the first visible one.

## Secondary findings in the stored profile

- `crawling_start_url` carries `currentJobId=4401939355`, pinning the crawl to one job.
- Six of eleven steps are `explore=true` and all are login controls matching one element
  each (factor of 1, harmless). Step 10, the job card, is `explore=false`, so the
  cartesian product is 1 and there is structurally one path.
- Steps 0/1 byte-identical, steps 6/7 byte-identical. Step 4 types a stale
  `Efe020202@gmail` into `#password` before step 8 types the real one.
- `found_positions_url` is `[]` and is only ever stored and loaded, never read by replay
  or matching. Not the cause, never populated.
- Every selector is a rotating LinkedIn hash class (`div.bghlzp.bgha1x.bghipj...`).
- `positions: 0, hashes: 1` — the pre-existing orphan hash is still suppressing one text.
- No session persistence exists anywhere: grepping `userDataDir`, `cookie`, `login`
  returns nothing outside tests. `replay.ts:46` calls `puppeteer.launch` with no
  profile dir, so every tick begins cookie-free. The recorded login steps are therefore
  load-bearing and cannot simply be deleted.

## 1. Out-of-band login

Add persistent profile dirs to `launch_crawler_browser` (`replay.ts:34-52`) and a
one-off `backend/login.ts` that signs in by hand. The recorder already goes through the
same launcher (`crawling.ts:152`), so both inherit the session.

- New exported `CRAWLER_CHROME_DIR` and `RECORDER_CHROME_DIR`, defaulting to
  `./.crawler_chrome` and `./.recorder_chrome`, overridable by env.
- `userDataDir` passed through only when supplied, so a caller wanting the old
  throwaway behaviour still gets it.
- Two dirs, not one: only one process can hold a `userDataDir` at a time, and a
  recording session must not collide with a live scheduler tick.
- `crawling.ts:152` uses the recorder dir, `scheduler.ts:223` the crawler dir.
- `login.ts` launches headed on the chosen dir, navigates to the sign-in page, waits for
  the user to finish, closes cleanly so Puppeteer flushes cookies to disk.
- `deno task login` and `deno task login:record`.
- The dir holds live session cookies, so add a minimal `.gitignore` (the repo has
  none) covering both dirs.
- Auth steps leave the profile entirely, which also removes the duplicate steps and the
  stale password value.

## 2. Explore on by default

- `branches.ts:21` — `step.explore === true` becomes `step.explore !== false`, so an
  unflagged click branches.
- `edit_profile.tsx:71` (`clone_profile`) — `explore : step.explore === true` coerces
  absent/null to `false` and would defeat the default. Change to `!== false`.
- `edit_profile.tsx:194-206` — new steps default to `true`; explicitly unticked steps
  stay unticked. The current `ticked` set only remembers `true`, so it cannot tell "user
  turned this off" from "brand new step" and every re-record would silently switch
  unticked boxes back on. Add a parallel `unticked` set.
- `edit_profile.tsx:429` — `checked` follows the same default.

Read-side this is safe for existing data: all 11 stored steps carry an explicit boolean,
so the `!== false` flip alone changes nothing about today's profile.

Caveat, stated plainly: with explore on by default, a click whose broad selector matches
a 200-element container asks for 200 branches, truncated to `BRANCH_CAP` 25 — 25 full
page replays, roughly 12 minutes, tripping the overlap guard and skipping every other
tick. The untick box is the escape hatch and `BRANCH_CAP` is the other lever. With
10-class hash-chain selectors this is likely on the real page.

## 3. Unpin the start url, re-record

Rewrite the stored `crawling_start_url` to drop `currentJobId=4401939355`, keeping
`keywords=backend`. Then the user signs in via `deno task login:record`, records from
the results list, sections the job cards, and lets the explore default fan out.

## 4. Delete the orphan hash

`positions: 0, hashes: 1`, so every hash is an orphan. Delete that one document. The
position-first fix prevents new ones.

## 5. Tests and verification

- `branches_test.ts` — a step with no `explore` branches; `explore: false` does not;
  `explore: true` still does.
- `smoke_scheduler.ts` — a profile with an unflagged click still fans out, pinning the
  backward compatibility of the `!== false` read.
- A cheap check that `launch_crawler_browser` creates the profile dir on disk.
- Then `deno task test`, `deno check *.ts`, `smoke_scheduler.ts`, `smoke_timing.ts`.
- Do not run `smoke_crawl.ts`; it is the manual one that waits on a real browser and is
  what caused the two earlier long hangs.
- Frontend lint and tsc, since `edit_profile.tsx` changes.

## Ordering

1. `replay.ts` profile dirs, `crawling.ts`, `scheduler.ts` wiring
2. `login.ts`, `deno.json` tasks, `.gitignore`
3. `branches.ts` + `edit_profile.tsx` explore default
4. `branches_test.ts` + smoke check
5. DB: unpin start url, delete orphan hash
6. Full verification
7. User re-records
