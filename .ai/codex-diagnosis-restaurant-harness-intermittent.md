## Diagnosis

No gameplay semantic change is indicated. Items 1 and 3 are genuine `HARNESS_PRECONDITION_FAILED` cases; item 2’s two `PRODUCT_FAILURE` labels are invalid because the harness measures arrival too late. The integrated rival freeze remains unproven, though source and unit tests strongly support it.

The latest [manifest.json](C:/Users/nolan/recipe-tester/esl-likes/.tmp/playthrough/restaurant/manifest.json:80) already contains a fixed 136 checks: 131 passed, five failed.

### 1. Rival freeze never sampled

Ranked causes:

1. **Late staging after the useful rival window — 99%.**  
   `stageRivalFreezePrompt` runs only in the final Challenge loop, after the hatch, separate-route, four-order, and ownership probes ([playthrough.mjs](C:/Users/nolan/recipe-tester/esl-likes/scripts/playthrough.mjs:2335)). By then the rival is reaching its three-claim cap ([rival.js](C:/Users/nolan/recipe-tester/esl-likes/src/minigames/restaurant/rival.js:190)). Good6 shows claims for customers 1, 2, and 6, followed by permanent idle.

2. **The full automatic dwell outlasts available walks — 97%.**  
   The best early overlap had approximately 1.215 seconds of actual rival walking left, while the player route plus 1.2-second dwell required approximately 2.018 seconds ([restaurant-trace.json](C:/Users/nolan/recipe-tester/esl-likes/.tmp/playthrough/restaurant/restaurant-trace.json:1138)). The customer-3 prompt therefore necessarily opened after the walk.

3. **The walk estimator is wrong — 100%.**  
   It estimates routes to `TABLE_SEATS` at nominal speed ([playthrough.mjs](C:/Users/nolan/recipe-tester/esl-likes/scripts/playthrough.mjs:757)), but the rival walks to aisle-side `rivalApproach` points ([index.js](C:/Users/nolan/recipe-tester/esl-likes/src/minigames/restaurant/index.js:703)) with steering, speed clamping, and stationary hesitation. In the trace, the estimator gives 1.713 seconds where the actual model route has 1.215 seconds.

4. **Latent false-failure risk once sampled — 95%.**  
   Rival baselines are taken immediately when `focusActive` becomes true, but focus takes 120 ms to ramp its service scale to zero ([speechFocus.js](C:/Users/nolan/recipe-tester/esl-likes/src/systems/speechFocus.js:1)). Some initial movement is expected. The conveyor check already waits through this ramp; the rival checks do not ([playthrough.mjs](C:/Users/nolan/recipe-tester/esl-likes/scripts/playthrough.mjs:606)).

Recommended solution: add read-only debug fields for `focusScale` and the controller’s existing `rivalWalk` data (`active`, delay/duration remaining, exact target). Stage earlier, before the claim cap, preferably during a `delivering` route so carried food is non-null. Pre-position beside a different raised hand, wait for authoritative visual motion, enter range, and use the documented manual commit instead of waiting the full dwell. Baseline only after `focusScale === 0`, then compare state, target, position, carried food, and walk-remaining across render frames—not a fixed sleep.

Risk: duplicating approach geometry in the harness would be a smaller source change, but would remain coupled to layout and steering. The additive debug fields are more trustworthy and do not alter gameplay.

### 2. Conversation probe failures

Ranked causes:

1. **Non-atomic, delayed arrival timestamp — 99%.**  
   `h.ui()` captures an initial snapshot, then performs additional page evaluations and may await screenshots before returning ([playthrough.mjs](C:/Users/nolan/recipe-tester/esl-likes/scripts/playthrough.mjs:348), [playthrough.mjs](C:/Users/nolan/recipe-tester/esl-likes/scripts/playthrough.mjs:388)). `arrivedAt` is recorded only afterward in a separate call ([playthrough.mjs](C:/Users/nolan/recipe-tester/esl-likes/scripts/playthrough.mjs:1357)). Dwell time continues during that delay.

2. **Fixed timing assertions — 99%.**  
   The probe then sleeps 600 ms and applies an arbitrary 700 ms threshold ([playthrough.mjs](C:/Users/nolan/recipe-tester/esl-likes/scripts/playthrough.mjs:1425)). This violates the protocol’s state-based waiting rule. Passing runs measured 1,398.7 and 1,569.8 ms; good6 measured 514.2 ms despite identical product code.

3. **Actual early-listening product defect — below 5%.**  
   Auto-walk keeps `movementActive` true until arrival; moving prevents dwell selection; listening is called only after `dwell.commit()` and `questionCommitted = true` ([index.js](C:/Users/nolan/recipe-tester/esl-likes/src/minigames/restaurant/index.js:1492), [talkDwell.js](C:/Users/nolan/recipe-tester/esl-likes/src/systems/talkDwell.js:204), [index.js](C:/Users/nolan/recipe-tester/esl-likes/src/minigames/restaurant/index.js:888)).

4. **Minor product boundary uncertainty.**  
   Arrival and the first dwell advancement occur in the same controller update, so up to one capped frame—50 ms—may be counted before the exact arrival instant. That cannot explain the roughly 686 ms observation error.

Recommended solution: remove the sleep and timestamp threshold. Have the test-only speech mock snapshot `debug.player`, `debug.dwell`, and `debug.question` synchronously when recognition starts. Require `autoWalking === false`, dwell committed/progress 1, the intended question committed, exactly one recognition start, and the customer’s `awaiting` transition. No application debug addition is needed.

Also separate passive UI sampling from review screenshot capture; otherwise unrelated visual evidence collection continues to perturb control timing.

### 3. Back-right carried-dish staging

Ranked causes:

1. **Exhaustive cue handling consumes the target — 99%.**  
   `askShowingCues` continues taking newly appearing cues until none remain ([playthrough.mjs](C:/Users/nolan/recipe-tester/esl-likes/scripts/playthrough.mjs:710)). Good6 consumed both the initial table-2 customer and its replacement before a pickup could stage the check ([restaurant-trace.json](C:/Users/nolan/recipe-tester/esl-likes/.tmp/playthrough/restaurant/restaurant-trace.json:189), [restaurant-trace.json](C:/Users/nolan/recipe-tester/esl-likes/.tmp/playthrough/restaurant/restaurant-trace.json:459)).

2. **The outer gate and pickup predicate disagree — 95%.**  
   Staging is preserved for any visible dish, but actual pickup requires a reachable, non-filler dish wanted by a remembered order ([playthrough.mjs](C:/Users/nolan/recipe-tester/esl-likes/scripts/playthrough.mjs:1629), [playthrough.mjs](C:/Users/nolan/recipe-tester/esl-likes/scripts/playthrough.mjs:1644)).

3. **Product blocks conversation while carrying — below 10%.**  
   Product code explicitly prioritizes a raised-hand conversation over dish return while carrying ([index.js](C:/Users/nolan/recipe-tester/esl-likes/src/minigames/restaurant/index.js:1748)); good3–good5 sampled and passed it.

Recommended solution: make this an explicit Normal staging phase. Preserve the table-2 cue, establish non-target orders and due supply, wait for a reachable wanted dish, collect it, re-read `carried && cueShowing`, and verify the resulting `question.customer` is that exact table-2 customer. Existing debug data is sufficient.

## Verification and handoff

- `npm test`: **239/239 passed**.
- Targeted rival/dwell tests: **25/25 passed**, including zero-service-delta rival freeze and 1.2-second dwell readiness.
- Build and full browser playthrough were not rerun; supplied artifacts were sufficient for diagnosis.
- No files changed. The pre-existing untracked `.ai/codex-diagnose-restaurant-harness-intermittent.md` remains untouched.
- No new visual evidence produced.

After implementation, trust should require a clean **136/136 PASS**, followed by `RESTAURANT_FORCE_MISS_PICKUP=1` producing the intended known-bad `PRODUCT_FAILURE` with the same 136-check registry and no unrelated harness failures.