# Current State

## Status

All five minigames are playable end to end and published at
<https://nolancasama.github.io/esl-likes/>, deployed from `main` by
`.github/workflows/pages.yml` (unit tests gate the deploy). Live = `7c9e011`
(Restaurant Challenge rival waiter, accepted and pushed 2026-09-14 with the
owner's approval).

## What Exists

- `SPEC.md` — the frozen design; `DESIGN_DECISIONS.md` — why.
- Shared: `speechFocus.js` (service clock frozen during speech), `talkDwell.js`
  (stop + face + 1.2 s dwell starts a conversation; moving drops the target, and
  stopping again inside the radius while facing starts a fresh dwell),
  hold-to-talk fallback, `AUTO_TALK_ENABLED` in `src/config/interaction.js`.
- Restaurant (`src/minigames/restaurant/`): rush-hour shift run by pure
  `director.js`; tables 3/4/5, live-order limit 1/3/4 (a raised hand counts),
  food-owned prep times (`FOOD_PREP_SECONDS` in `scoring.js`), several ready
  dishes, dishes matched by food, combo, Listen Again, wrong-delivery refusal
  lock, whole-room camera, click-to-walk.
- Restaurant Challenge rival (SPEC §4 "Challenge rival waiter"):
  - Pure `claims.js` (ownership, player reservation on dwell/talk, claim on
    commit) and `rival.js` (state machine, own pass, 4 s hand age, 3-customer
    cap, speed 3.75); director owner-aware budget; Challenge total 11.
  - Scene: rival character (white apron), rival pass at the left end of the
    counter (not collectable, no bell), neutral tray badge on rival tables,
    score pill `きみ N ・ ウェイター N` below the settings button,
    `ランチラッシュ！` intro, debug hook ownership/rival fields.
  - Eating/leaving customers don't use the player's order limit; one extra hand
    may rise above the player's limit while the rival is free.
- Drink Stand: rush + dwell revision, hold-to-fill at six stations.
- Zoo: campus from pure `layout.js`, CC0 dressing, Japanese region signposts +
  YOU ARE HERE board, no entrance gate and no per-pen signs, animals stand still
  facing their viewpoint (alpaca/giraffe idle clips), zoomed viewfinder that
  avoids photo occluders.
- Playthroughs: `npm run build`, then `npm run playthrough:<scenario>`
  (restaurant, drink-stand, coloring, sports, zoo); the runner owns the preview.

## Verified (2026-09-14)

- `npm test` 227/227.
- Restaurant playthrough 127/127 on the current tree, including the Challenge
  staged takeover, rival freeze during speech (sampled mid-walk), rival-owned
  delivery refusal, and a full 11-customer Challenge shift.
- Regression: Drink Stand 56/56, Coloring 25/25, Sports 21/21.
- Owner visual confirmation of Challenge screenshots 09–12: rival clearly
  distinct, score pill readable, room reads busy, five-order stretch kept.

## NOT Verified

- Chromebook: real speech and auto-listening, trackpad/touch, whether Challenge
  with a rival is too much for Grade 3, Zoo frame rate (~137k triangles).

## Zoo playthrough (fixed 2026-09-14, harness TRUSTED)

- Frame-aware walker (keys held through observed game updates; stalls judged by
  debug `elapsed`/`frame`), arrival preconditions, fixed per-section check
  registry (144 checks every run), seeded `Math.random` (`ZOO_SEED`, default
  1592594996), per-section browser closure, manifest with per-check classes.
- Known-good 144/144 twice with the same seed; known-bad
  `ZOO_FORCE_WALK_SHORT=1` fails with only `HARNESS_PRECONDITION_FAILED`.
- Residual: an occasional recovered route give-up on open ground and one
  wall-clock wait for the 🔊 control; both retried successfully.
- Wrong photo is now used up on refusal (SPEC), committed `ca1c246`, not pushed.

## Known Limits

- Challenge can briefly reach five live player orders (owner accepted 2026-09-14).
- Restaurant Easy has one live order, so a child can place the dish by
  remembering the person alone. SPEC accepts this.
- A Restaurant customer without a raised hand still refuses an offered dish.
- Drink Stand Normal goes warm-up → rush with no main phase.
- Bundle over 600 kB (three.js) plus models and environment assets.

## Asset licences

- CC0: Kenney Blocky Characters and City Kit Suburban; Quaternius animals and
  Stylized Nature MegaKit; KayKit Restaurant Bits (1024 px atlas not loaded).
- **Quaternius Farm Buildings: CC0 not confirmed** (no licence file) — published;
  confirm on quaternius.com or remove the folder (procedural barn fallback).
- Own work: `elephant.glb`. `Animals.glb` (ithappy) and `giraffe.glb` (Styloo)
  published at the owner's explicit decision; forks should replace them.
- Provenance: `public/assets/zoo/environment/README.md`.

## Next Steps

1. Restaurant conveyor revision (SPEC §4 "Conveyor", DESIGN_DECISIONS
   2026-09-14): slices (a) pure `conveyor.js` + tests
   `.ai/wo-restaurant-conveyor-logic.json`, (b) scene integration — remove
   counter/bell/ready cue, host only at turnaround, belt through side-wall
   openings, MATSUBARA RESTAURANT sign, dish return, rival hatch on left wall,
   (c) Restaurant playthrough update. Then Claude acceptance + owner
   screenshots A–E (back wall, multiple dishes, entry, exit, rush).
2. Push `ca1c246` (wrong photo used up) and the Zoo harness with the owner's OK.
3. Later: `.ai/wo-zoo-rules.json` (re-check against removed pen signs),
   Chromebook pass, Farm Buildings licence, Zoo triangle budget.

## Codex / Delegated Work

- Rival part 1 `.ai/wo-restaurant-rival-logic.json`: accepted, committed `d311b9c`.
- Rival part 2 `.ai/wo-restaurant-rival-integration.json`: Codex PARTIAL (usage
  limit) after implementing; Claude completed acceptance and harness fixes
  directly; accepted 2026-09-14.
- Conveyor logic `.ai/wo-restaurant-conveyor-logic.json`: accepted, committed `07f1f64`.
- Conveyor scene `.ai/wo-restaurant-conveyor-scene.json`: Codex PARTIAL — usage
  limit (resets 2026-09-14 23:28). UNCOMMITTED, UNREVIEWED partial edit to
  `src/minigames/restaurant/index.js` only (+372/−211): conveyor created and
  advanced, sign, dish return, rival hatch, debug fields, counter slots and bell
  sounds removed. Known defects: cleanup still assigns undeclared `readyCue` /
  `bellDome` (ReferenceError on exit); `src/config/lesson.js` untouched, so new
  STRINGS keys may be missing. Owner chose to wait for the Codex reset: resume
  with `.ai/wo-restaurant-conveyor-scene-resume.json`. Do not revert the partial
  work and do not re-implement it from scratch.
- Conveyor harness `.ai/wo-restaurant-conveyor-harness.json`: drafted, not
  dispatched; runs after the scene is accepted.
