## Diagnosis

This is primarily a harness failure; the evidence does not justify changing game semantics.

### Observed evidence

- Normal performs exactly one click pickup: dish 3, which passes with a valid setup and carried sushi ([log](C:/Users/nolan/recipe-tester/esl-likes/.tmp/playthrough-good2.log:39)).
- Every later Normal pickup is key-based because `pickupCount === 0` selects click only once ([playthrough.mjs](C:/Users/nolan/recipe-tester/esl-likes/scripts/playthrough.mjs:1050), [playthrough.mjs](C:/Users/nolan/recipe-tester/esl-likes/scripts/playthrough.mjs:1096)). Thus the 14 named `setup:null` failures are not click failures.
- The 19 z timeouts start immediately after approaching customer 3. Later key pickups 26 and 27 pass, ruling out a general keyboard, Space, focus, or conveyor failure ([log](C:/Users/nolan/recipe-tester/esl-likes/.tmp/playthrough-good2.log:87)).
- The unexpected-delivery screenshot shows successfully key-collected pizza 27, followed by delivery to a customer who left during three delivery waits—not pizza 6 succeeding with an unobserved setup ([screenshot](C:/Users/nolan/recipe-tester/esl-likes/.tmp/playthrough/restaurant/restaurant-unexpected-listening-delivery.png)).
- Challenge completes fully and there are no page errors.

### Ranked causes

1. **Collision-unaware key navigation — 99%**

   After customer 3, click-to-walk leaves the player near `(-4.2, 1.2)`. `moveAxisTo` holds W while keeping x fixed ([playthrough.mjs](C:/Users/nolan/recipe-tester/esl-likes/scripts/playthrough.mjs:518)). That route intersects the table centered at `(-4.2, -1.0)`; its 1.12-radius collision stops the player near z ≈ 0.12, far from the required z ≤ −3.95 ([index.js](C:/Users/nolan/recipe-tester/esl-likes/src/minigames/restaurant/index.js:48), [index.js](C:/Users/nolan/recipe-tester/esl-likes/src/minigames/restaurant/index.js:1170)).

   Solution: add a state-driven, collision-free aisle waypoint before moving toward the belt, then live-track dish x and require the visible collect action before Space.

   Risk: fixed waypoints couple the harness to layout; choose a documented same-side clear aisle and detect lack of movement early.

2. **One failed probe contaminates fulfillment and makes the checklist variable — 99%**

   Failed pickups still increment `pickupCount`, so all remaining service attempts use the blocked key route. Each costs six live seconds, allowing customers to leave. Every transient attempt also creates `collect ready … dish <id>` ([playthrough.mjs](C:/Users/nolan/recipe-tester/esl-likes/scripts/playthrough.mjs:1108)); conditional early returns and checks add further count variation. Uniqueness checking does not provide a fixed inventory.

   Solution: isolate one dedicated click probe and one dedicated key probe. Keep a failed probe failed, but use a reliable fulfillment route afterward so unrelated checks remain observable. Pre-register fixed logical checks and record retries/dish IDs in trace detail, not as new checks.

   Risk: fallback fulfillment must never overwrite or conceal the failed pickup result.

3. **Anti-shortcut independently exhausts its wall-clock deadline — 97%**

   Session B uses a fresh context, so Normal state cannot leak into it. Its loop terminates at `Date.now() + 240000` ([playthrough.mjs](C:/Users/nolan/recipe-tester/esl-likes/scripts/playthrough.mjs:1264)). It stops at 5/7 with two customers still awaiting and positive patience, with no preceding branch failure. This is not a product turnaround failure; the terminal state was never reached.

   Solution: probe wrong delivery deliberately, then recover efficiently and continue until semantic completion. Retain a bounded stagnation watchdog reporting the last state.

   Risk: removing the deadline without stagnation detection could create an indefinite run.

4. **Click setup sampling has a latent race, but did not cause this run — 80%**

   Click arrival and collection occur synchronously in one game update ([index.js](C:/Users/nolan/recipe-tester/esl-likes/src/minigames/restaurant/index.js:1498)), while the harness polls externally. It also applies the 1.4 keyboard window to clicks, although click arrival uses 1.6 ([index.js](C:/Users/nolan/recipe-tester/esl-likes/src/minigames/restaurant/index.js:998)). A valid setup can therefore be removed before sampling.

   Solution: use a page-side animation-frame setup latch and the method-specific 1.6 click window. Do not let outcome alone establish setup, so `RESTAURANT_FORCE_MISS_PICKUP=1` remains incapable of passing.

   Risk: exact clicked-dish identity is not exposed because `carried` lacks an id ([index.js](C:/Users/nolan/recipe-tester/esl-likes/src/minigames/restaurant/index.js:1981)). If exact identity is mandatory, an additive read-only debug field is needed; no conveyor or gameplay semantic change is needed.

### Recommendation

Make a harness-only correction: collision-aware key staging, isolated fixed pickup probes, frame-level click observation, fixed check registration, and state/stagnation-based session completion. Also make timeout reports include attempts, elapsed time, and last semantic state as required by the protocol. The Restaurant manifest currently lacks structured classifications and trace because the runner only imports them for Zoo ([playthrough-run.mjs](C:/Users/nolan/recipe-tester/esl-likes/scripts/playthrough-run.mjs:196)).

No files were changed. `npm test` passed 239/239. The build/playthrough was not rerun; the preserved log already comes from a build newer than the inspected sources. No new visual artifacts were produced.