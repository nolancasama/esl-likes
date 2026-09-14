## 1. Observed evidence

- Zoo and harness sources are identical at `27cc580`, `d311b9c`, and current HEAD.
- Reported stall coordinates around `(-27.1, 1.4–2.1)` are valid player positions; the next movement step toward the graph node is also collision-free.
- A deer route first “gave up,” then succeeded on retry, taking 44.41 wall seconds. Habitat travel routinely took 4–6× its modeled duration.
- The timeout chain is causal: `showPhoto()` ignores a failed route, presses Space from far away, leaves the visitor unserved, then later waits for a visitor, turnaround, and hub all expire.
- Targeted Zoo tests pass: 19/19.
- The totals are fully explained:

  - Nominal: 109.
  - 108: turnaround check conditionally omitted.
  - 96: same omission plus four failed arrivals × three skipped checks: `109 − 1 − 12 = 96`.

## 2. Ranked probable causes

1. **High confidence — frame-sensitive harness movement.**  
   The walker sends 70–210 ms key pulses and declares a stall after nine samples without 0.08 progress ([playthrough-zoo.mjs:219](/C:/Users/nolan/recipe-tester/esl-likes/scripts/playthrough-zoo.mjs:219), [playthrough-zoo.mjs:228](/C:/Users/nolan/recipe-tester/esl-likes/scripts/playthrough-zoo.mjs:228)). Near a node, pulses are approximately 86 ms. Zoo movement only advances on rendered frames and clamps each frame to 0.05 seconds ([index.js:879](/C:/Users/nolan/recipe-tester/esl-likes/src/minigames/zoo/index.js:879)); the shell also clamps frame time ([main.js:198](/C:/Users/nolan/recipe-tester/esl-likes/src/main.js:198)). Under SwiftShader, a pulse can contain no rendered update.

   Against: no rAF trace was captured.  
   Confirm: log per pulse `{target, keys, before, after, actualHoldMs, rafDelta, progress}`. `rafDelta=0` with a valid next position confirms it.

2. **Medium-high confidence — unseeded randomness changes the workload.**  
   The harness seeds storage, not randomness ([playthrough-zoo.mjs:47](/C:/Users/nolan/recipe-tester/esl-likes/scripts/playthrough-zoo.mjs:47)). Visitor spots, models, and wanted animals use `Math.random` ([index.js:39](/C:/Users/nolan/recipe-tester/esl-likes/src/minigames/zoo/index.js:39), [index.js:235](/C:/Users/nolan/recipe-tester/esl-likes/src/minigames/zoo/index.js:235)). The failing runs selected different animals and visitor positions; deer’s long west-to-plaza return exposed the movement bug.

   Against: fixed-order habitat traversal also flakes, so randomness is an amplifier, not the root cause.  
   Confirm: install a logged deterministic PRNG in the browser init script and repeat one seed three times.

3. **Certain — conditional check registration causes the varying denominator and false verdicts.**  
   The anti-shortcut turnaround check exists only inside `if (s)` ([playthrough-zoo.mjs:722](/C:/Users/nolan/recipe-tester/esl-likes/scripts/playthrough-zoo.mjs:722)). Failed habitat arrival executes `continue`, skipping three dependent checks ([playthrough-zoo.mjs:876](/C:/Users/nolan/recipe-tester/esl-likes/scripts/playthrough-zoo.mjs:876)). Moreover, the runner manifest has no protocol result class or per-check records ([playthrough-run.mjs:195](/C:/Users/nolan/recipe-tester/esl-likes/scripts/playthrough-run.mjs:195)).

   Against: none; the arithmetic exactly matches both logs.  
   Confirm: pre-register the expected names and verify every run reports 109, with unavailable outcomes classified as `HARNESS_PRECONDITION_FAILED`.

4. **Low confidence for these failures — latent graph-clearance problem.**  
   Static sampling found `plaza → farm-south` intersects the horse collider after expanding it by `PLAYER_RADIUS`, and `fountain-hub → farm-south` similarly intersects the fountain. The current test checks collider centerlines without player-radius expansion ([layout.test.mjs:144](/C:/Users/nolan/recipe-tester/esl-likes/src/minigames/zoo/layout.test.mjs:144)).

   Against: reported failures occur on clear west-side coordinates, and those routes pass on other runs.  
   Confirm: add a pure radius-aware edge-sampling test and include the current graph-leg ID plus collision decision in the runtime trace.

## 3. Possible solutions

- **Root harness fix:** keep movement keys down until semantic position progress is observed; count stalls across rendered updates, not short wall-clock pulses. Require successful arrival before pressing Space. Files: `scripts/playthrough-zoo.mjs`, possibly `scripts/lib/driver.mjs`. Harness-only blast radius.
- **Determinism:** seed and report acceptance randomness. Harness-only, low risk.
- **Resource pressure:** close each section’s browser/context immediately. Currently pages close per section, but all browser processes remain until line 928.
- **Bookkeeping/protocol:** define a fixed check registry, always finalize downstream checks, and produce protocol-compliant result classes. Files: `scripts/playthrough-zoo.mjs`, `scripts/lib/driver.mjs`, `scripts/playthrough-run.mjs`.
- Do not alter Zoo movement, collision, layout, or visuals for this flake. Current evidence does not show a real player dead end.

## 4. Recommended solution

Fix the harness in this order: frame-aware movement and action preconditions; fixed classified check registration; seeded randomness; immediate browser closure. Then establish harness trust with a known-good pass and known-bad detection.

Ask Claude to run each three times:

```powershell
1..3 | ForEach-Object {
  npm run playthrough:zoo -- --only antiShortcut 2>&1 |
    Tee-Object ".tmp/zoo-flake/anti-$_.log"
}
1..3 | ForEach-Object {
  npm run playthrough:zoo -- --only habitats 2>&1 |
    Tee-Object ".tmp/zoo-flake/habitats-$_.log"
}
```

Include the per-pulse rAF trace described above. If isolated sections pass while full runs fail, retained Chromium/SwiftShader load is also confirmed.

## 5. Relevant files/systems

- [scripts/playthrough-zoo.mjs](/C:/Users/nolan/recipe-tester/esl-likes/scripts/playthrough-zoo.mjs)
- [scripts/lib/driver.mjs](/C:/Users/nolan/recipe-tester/esl-likes/scripts/lib/driver.mjs)
- [scripts/playthrough-run.mjs](/C:/Users/nolan/recipe-tester/esl-likes/scripts/playthrough-run.mjs)
- [src/minigames/zoo/index.js](/C:/Users/nolan/recipe-tester/esl-likes/src/minigames/zoo/index.js)
- [src/minigames/zoo/layout.js](/C:/Users/nolan/recipe-tester/esl-likes/src/minigames/zoo/layout.js)
- [src/minigames/zoo/layout.test.mjs](/C:/Users/nolan/recipe-tester/esl-likes/src/minigames/zoo/layout.test.mjs)

## 6. Remaining uncertainties

The rAF trace is needed to distinguish frame starvation conclusively from a lower-level input-delivery issue.

Separately, there is a genuine but unrelated product/spec defect: the specification requires a wrong photo to be consumed ([SPEC.md:774](/C:/Users/nolan/recipe-tester/esl-likes/SPEC.md:774)), but the wrong branch returns without clearing it ([index.js:687](/C:/Users/nolan/recipe-tester/esl-likes/src/minigames/zoo/index.js:687)). That should be tracked independently; it did not cause these failures.

No files were changed and no visual evidence was produced.