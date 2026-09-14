# Current State

## Status

All five minigames are playable end to end and published at
<https://nolancasama.github.io/esl-likes/>, deployed from `main` by
`.github/workflows/pages.yml` (unit tests gate the deploy). Live = `d311b9c`
(rival logic only, not wired into the scene; pushed 2026-09-14).

Restaurant Challenge rival waiter integration (part 2) is ACCEPTED and committed
locally on `main`, not pushed. Push only with the owner's approval.

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

## Known Problems

- Zoo playthrough is flaky: route-finding gets stuck near (−27, 1.4) and the
  check count varies (88/96 on the working tree, 106/108 on a clean `d311b9c`
  checkout, 109/109 earlier). Harness problem, not caused by the rival work;
  needs a harness fix before it is a trustworthy regression check.

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

1. Push the rival integration commit once the owner approves.
2. Fix the flaky Zoo playthrough route-finding.
3. Later: `.ai/wo-zoo-rules.json` (re-check against removed pen signs),
   Chromebook pass, Farm Buildings licence, Zoo triangle budget.

## Codex / Delegated Work

- Rival part 1 `.ai/wo-restaurant-rival-logic.json`: accepted, committed `d311b9c`.
- Rival part 2 `.ai/wo-restaurant-rival-integration.json`: Codex PARTIAL (usage
  limit) after implementing; Claude completed acceptance and harness fixes
  directly; accepted 2026-09-14.
- None in flight.
