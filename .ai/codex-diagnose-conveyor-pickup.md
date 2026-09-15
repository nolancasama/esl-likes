# READ-ONLY DIAGNOSIS — Restaurant conveyor playthrough pickups

**READ-ONLY DIAGNOSIS.** Do not edit application source, implement fixes,
refactor, change dependencies, commit, push, or merge. You may read files,
search code, inspect git history and diffs, read logs, screenshots, and test
output, run non-destructive diagnostic commands, and run tests or builds when
that helps reproduce or isolate the problem. Investigate independently.

## Observed symptom

`npm run playthrough:restaurant` (scripts/playthrough.mjs, after correction
`.ai/wo-restaurant-conveyor-harness-fix1.json`) reports 120/157, no page errors.

1. Key pickup never establishes its setup. The log prints
   `(timed out waiting for player z=-4.40)` 19 times, each followed by
   `HARNESS_PRECONDITION_FAILED Normal: precondition: the interact key at the belt
   front pickup reaches a visible moving dish within the pickup window`
   (e.g. dish id 4 curry at x 4.78).
2. Click pickups after the first one report `setup: null`
   (`HARNESS_PRECONDITION_FAILED Normal: collect ready pizza dish 6 ... "setup":null`)
   for ~15 dishes, yet `.tmp/playthrough/restaurant/restaurant-unexpected-listening-delivery.png`
   shows the player carrying a pizza at 4/7 served. The first click pickup
   (dish 3 sushi) passed with a setup recorded.
3. Cascade: Normal shift ends 4/7 with customers leaving, delivery "no-change"
   to a customer who had left, Anti-shortcut 5/7, turnaround/stamp checks fail
   because the shifts never finish.

Not failing: the full Challenge shift resolves, speech-focus belt freeze and
resume, conversation probe, review screenshots A–E (checked visually by Claude),
no console errors.

## Desired behaviour

A trustworthy regression check of SPEC.md §4 "Conveyor": both real pickup paths
(click-to-walk on a moving dish; walking to the belt front and pressing Space)
are exercised; a pickup whose setup was genuinely reached but did not carry the
dish is PRODUCT_FAILURE; a setup never reached is HARNESS_PRECONDITION_FAILED;
`RESTAURANT_FORCE_MISS_PICKUP=1` never passes; the check list has a fixed total.

## Reproduction

`npm run build` then `npm run playthrough:restaurant` (seed default
0x5eed0914, override with RESTAURANT_SEED). Log: `.tmp/playthrough-good2.log`
if still present. Every run so far.

## Systems that may be involved (no cause selected)

- scripts/playthrough.mjs: `moveAxisTo`, `collectDish` (setupAt sampling,
  click polling loop, key tracking loop), `reportPickup`, the Normal session loop.
- src/minigames/restaurant/index.js: keyboard movement and `canOccupy`
  (z >= -4.45), `BELT_FRONT_Z` -4.4 / `BELT_FRONT_BAND` 1.15 /
  `BELT_PICKUP_WINDOW` 1.4, click-to-walk arrival which calls
  `collectDish(arrived.value, true)` at arrivalRadius 0.45 (~line 1498),
  `updateContext` action priority, speech focus / talk HUD state that may
  block movement, src/systems/input.js.
- Debug surface `window.__eslDebug.restaurant` (player, conveyor, carried).

Unverified hypotheses to test, not direction: (a) the click-path sampler misses
the brief frame where the player is in range because the game collects on
arrival; alternatively the dish is taken before the player is inside the band
the harness requires. (b) keyboard movement toward -z is blocked or not
applied in the state the key pickup starts from (open prompt/focus, a table in
the path, an input focus issue); alternatively moveAxisTo's wait condition is
wrong.

## Already tried

1. Original harness: key pickup walked to the dish's stale x (fixed in fix1).
2. fix1: live tracking loop and setup/outcome classification — produced the
   symptoms above.

## Constraints

Do not change game source semantics without reporting the need; the conveyor
API is frozen. The harness must follow ~/.claude/workers/harness/PROTOCOL.md
(wait for state, not time; classify preconditions).

## Report shape

Short and decision-ready: observed evidence; 2–4 ranked causes with confidence
and file/line evidence; solutions per cause with risks; recommended solution;
relevant files; remaining uncertainties. Nothing is implemented.
