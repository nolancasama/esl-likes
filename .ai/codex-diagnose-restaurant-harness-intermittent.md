# READ-ONLY DIAGNOSIS — Restaurant playthrough: rival freeze never sampled, intermittent probe failures

**READ-ONLY DIAGNOSIS.** Do not edit application source, implement fixes,
refactor, change dependencies, commit, push, or merge. You may read files,
search code, inspect git history and diffs, read logs, screenshots, and test
output, run non-destructive diagnostic commands, and run tests or builds when
that helps reproduce or isolate the problem. Investigate independently.

## Observed symptom

`npm run playthrough:restaurant` (scripts/playthrough.mjs at HEAD `bb7bd15`,
seed default 0x5eed0914) across the last three runs: 133/136, 134/136, 131/136.
No page errors. The game completes Normal, Anti-shortcut and Challenge shifts.

1. Every run: `Challenge: speech focus freezes rival state, target, position and
   carried food` = HARNESS_PRECONDITION_FAILED "no speech prompt remained open
   while the rival was moving". Latest log `.tmp/playthrough-good6.log` shows
   "(rival not mid-walk when customer N prompt opened; freeze not sampled here)"
   for customers 3, 7, 8, 9, 10 and three
   "(timed out waiting for long rival walk while waiting beside a raised hand)"
   from `stageRivalFreezePrompt`, which waits up to 12 s for
   `rivalIsWalking && targetCustomer !== cue && rivalWalkSecondsLeft > 1.9`.
2. Intermittent (passed in runs good3–good5, failed in good6):
   `Conversation probe: click-to-walk arrival does not listen before the dwell
   completes` PRODUCT_FAILURE detail
   `{"startsBeforeCorrect":0,"startsDuringDwell":1,"arrived":true}` and
   `a scripted correct question is accepted after the dwell` PRODUCT_FAILURE
   `{"countersAfterCorrect":{"starts":1,"aborts":1,"stops":0,"lastStartAt":16135.9},"arrivedAt":15621.7}`
   — mock mic start 514 ms after the harness's arrivedAt, before the 1.2 s dwell.
3. Intermittent: `Normal: precondition: a dish is carried beside a raised hand at
   the back-right table` (+ dependent check) "never staged".

Manifest with per-check detail: `.tmp/playthrough/restaurant/manifest.json`.
Earlier logs: `.tmp/playthrough-good3.log` … `good6.log`.

## Desired behaviour

A trustworthy, deterministic Restaurant harness per
~/.claude/workers/harness/PROTOCOL.md: every run reports the same fixed 136
checks; the rival speech-freeze check (SPEC §4 Challenge rival; rival freezes
with the service clock during speech focus) is actually sampled every run; a
PRODUCT_FAILURE only when the game is wrong. Then a known-good full pass and a
`RESTAURANT_FORCE_MISS_PICKUP=1` known-bad fail.

## Reproduction

`npm run build` then `npm run playthrough:restaurant`. Item 1 every run; items
2–3 roughly one run in four.

## Systems that may be involved (no cause selected)

- scripts/playthrough.mjs: `stageRivalFreezePrompt`, `rivalWalkSecondsLeft`,
  `TABLE_SEATS`, `askCustomer` checkRivalFreeze branch, the Challenge service
  loop, `clickAndWaitForArrival` (arrivedAt taken after a polled waitFor),
  the Conversation probe block (fixed `h.sleep(600)`), `walkClear`.
- src/minigames/restaurant/rival.js (walk events, durations = distance /
  RIVAL_SPEED 3.75, states), src/minigames/restaurant/index.js (`beginRivalWalk`,
  rival debug fields, dwell candidates, click-to-walk arrival, speech focus),
  src/systems/talkDwell.js, src/config/interaction.js.

Unverified hypotheses to test, not direction: (a) rival walks are shorter or
rarer than the harness assumes (e.g. `rival.position` or destination estimate
wrong, or the rival mostly idles/waits at its hatch), so the staging condition
is unreachable; alternatively the rival reliably abandons or the prompt timing
itself is the problem. (b) Probe item 2 is harness timing (arrival observed
late; dwell may start before autoWalking clears, or the player was already in
range); alternatively the game can genuinely start listening before the dwell
completes after a click-to-walk arrival — say which, with evidence.

## Already tried

1. Opportunistic sampling on each Challenge prompt (`checkRivalFreeze`): rival
   never mid-walk at prompt open.
2. Waiting before approach until rival walk remaining > player walk + dwell:
   never satisfied (walk + 1.2 s dwell outlasts rival walks).
3. `stageRivalFreezePrompt` (stand outside the 2.7 talk radius, step in on a
   long rival walk): the 1.9 s condition never became true in 3 × 12 s waits.

## Constraints

Game semantics must not change without reporting the need. If the only
reliable observation needs an additive read-only debug field (e.g. rival walk
remaining), say so. Harness must wait for state, not time.

## Report shape

Short and decision-ready: observed evidence; 2–4 ranked causes per item with
confidence and file/line evidence; solutions with risks; recommended solution;
relevant files; remaining uncertainties (especially whether item 2 is a product
bug). Nothing is implemented.
