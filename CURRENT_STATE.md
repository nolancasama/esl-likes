# Current State

## Status

All five minigames are playable end to end and published at
<https://nolancasama.github.io/esl-likes/>, deployed from `main` by
`.github/workflows/pages.yml` (unit tests gate the deploy). Live = `27cc580`.

In progress: the Restaurant Challenge rival waiter (two sequential orders; part 1
accepted, part 2 next). See "Codex / Delegated Work".

## What Exists

- `SPEC.md` — the frozen design; `DESIGN_DECISIONS.md` — why.
- Shared: `speechFocus.js` (service clock frozen during speech), `talkDwell.js`
  (stop + face + 1.2 s dwell starts a conversation; hold-to-talk fallback),
  `AUTO_TALK_ENABLED` in `src/config/interaction.js`.
- Restaurant (`src/minigames/restaurant/`): rush-hour service shift run by pure
  `director.js` (warm-up → rush → final push, replacements with new random foods);
  tables 3/4/5, live-order limit 1/3/4 (a raised hand counts), food-owned prep
  times so dishes finish out of order, several ready dishes at random counter
  slots, dishes matched by food (repeats safe), first-try combo, Listen Again
  forfeits only the memory bonus, wrong-delivery refusal lock, whole-room
  camera, click-to-walk. NEW, not yet integrated: `claims.js` (ownership registry)
  and `rival.js` (Challenge rival state machine), director owner-aware budget,
  Challenge total 11 (SPEC §4 "Challenge rival waiter").
- Drink Stand: rush + dwell revision, hold-to-fill at six stations.
- Zoo (`src/minigames/zoo/`): campus from pure `layout.js` (path graph, viewpoint
  per habitat, colliders, landmarks), CC0 environment dressing with instancing
  and graceful asset fallbacks, Japanese region signposts + YOU ARE HERE board.
  No entrance gate and no per-pen animal signs (owner's decision). Animals stand
  still facing their viewpoint (half-turn for tiger/deer/penguin/giraffe);
  alpaca and giraffe play idle clips. Viewfinder camera: 3.8 back, 3.4 high,
  34° FOV, slides in front of photo occluders behind the player.
- Playthroughs: `npm run build`, then `npm run playthrough:<scenario>`
  (restaurant, drink-stand, coloring, sports, zoo); the runner owns the preview.
  Zoo supports `-- --only habitats`. Scratch probes live in `.tmp/` (not
  committed): `zoo-face-probe.mjs` (needs a preview on :5199), `rest-rush.mjs`,
  `drink-rush.mjs`.

## Verified (2026-09-13)

- `npm test` 225/225 (after rival part 1); build clean.
- Zoo at `27cc580`: `npm run playthrough:zoo` 109/109 (all 13 habitats
  photographed), region and viewfinder screenshots reviewed.
- Service games at `585b977`: Restaurant 78/78, Drink Stand 56/56, Coloring
  25/25, Sports 21/21; busy-moment probes and screenshots reviewed.

## NOT Verified — Manual Chromebook Pass Required

Real speech recognition cannot run headless. On a classroom Chromebook: a real
"What … do you like?", auto-listening after dwell (a neighbour's voice could be
accepted — set `AUTO_TALK_ENABLED` false if so), Try Again and the fallback;
trackpad/touch play; levels 2–3 of Coloring, Sports and Zoo; whether Restaurant
Challenge is too much for Grade 3. Zoo frame rate: scene is ~137k triangles
after dressing (22k before) — check it on a Chromebook first.

## Known Limits

- Restaurant Easy has one live order, so a child can place the dish by
  remembering the person alone. SPEC accepts this; revisit after observation.
- A Restaurant customer without a raised hand still refuses an offered dish.
- Drink Stand Normal goes warm-up → rush with no main phase — watch in class.
- Bundle over 600 kB (three.js) plus models and environment assets.

## Asset licences

- CC0: Kenney Blocky Characters and City Kit Suburban; Quaternius animals and
  Stylized Nature MegaKit; KayKit Restaurant Bits (1024 px atlas not loaded).
- **Quaternius Farm Buildings: CC0 not confirmed** (no licence file in the
  archive) — now published; confirm on quaternius.com or remove the folder (the
  Zoo falls back to a procedural barn).
- Own work: `elephant.glb`.
- `Animals.glb` (ithappy, Unity Asset Store) and `giraffe.glb` (Styloo) are
  published at the owner's explicit decision; forks should replace them.
- Provenance: `public/assets/zoo/environment/README.md`.

## Next Steps

1. Restaurant rival part 2: `.ai/wo-restaurant-rival-integration.json` (scene,
   ownership in interaction, rival pass, waiter badge, Japanese score pill,
   ランチラッシュ！, debug hook, Challenge playthrough checks + 5 screenshots).
   Controller acceptance: `npm test`, build, `npm run playthrough:restaurant`,
   the other four playthroughs, Normal + Challenge screenshots; then ask the
   owner for visual confirmation (artifact-first) before commit/push.
2. Zoo gameplay rules: `.ai/wo-zoo-rules.json` (one photo = one attempt,
   single-visitor Listen Again, Challenge 5 requests) — not yet dispatched;
   re-check it against the removed pen signs before sending.
3. Later: Chromebook pass; Farm Buildings licence; Zoo triangle budget; a
   no-undef lint in validation; shared playthrough helpers.

## Codex / Delegated Work

- Rival part 1 `.ai/wo-restaurant-rival-logic.json`: Codex SUCCESS, reviewed
  (focused) and accepted 2026-09-13 — claims.js, rival.js, director owner-aware
  budget, FOOD_PREP_SECONDS exported, SPEC/DESIGN_DECISIONS. Committed locally
  with this file.
- Rival part 2: not yet dispatched. Its brief carries the review findings
  (import FOOD_PREP_SECONDS, eating/leaving must not consume the budget, rival
  stands beside tables, animation finishes at model arrival, pass real
  prepDuration).
