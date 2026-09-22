# Current State

## Usage watch

Codex was **still inside a usage-limit window until 2026-09-22T11:00** when this
pass ran, Gemini and all four `agy-*` workers were under the global coding
readiness quarantine, and Qwen was skipped as a hard task. The router therefore
chose **Claude direct** for the whole Coloring pass. Always re-check with
`node ~/.claude/workers/bin/route.js .ai/<order>.json` rather than assuming
either way; the numbers in this file go stale within hours.

## Latest pass (2026-09-22) — the Coloring robot comes alive

Claude direct (the router found no delegating worker). **Nothing is committed
for this pass** — the owner asked for no commit or push until they have looked
at it. The one commit on the branch, `de8f62e`, predates the plan and only fixes
the three rendering defects the previous pass recorded. Branch
`coloring-robot-alive`, off `main` at `9bbac23` (which is pushed; the earlier
note that `main` sat at `8d83807` was stale).

The whole loop now works: **listen → remember a favourite colour → colour the
required parts → decorate freely → press できた → the child's exact robot comes
alive and hops around the 3D atelier as a paper puppet.**

### What changed

- **`robotDefinition.js`** — arms narrowed 0.105→0.072 and lengthened (they read
  as two blobs before), the shoulder plank became two shoulder caps that bridge
  torso to arm, legs tucked under the torso, `buttons` drawn as three studs, and
  a `labelBox`/`labelPlacement` model so a colour word can sit on clear paper
  with a leader when its own shape cannot hold `ORANGE`. `tappablePoint()` is
  exported: **a region's bounding-box centre is not necessarily in that region**
  (the middle of the torso belongs to the chest panel), which broke the harness
  before it broke anything else.
- **`picture.js`** — rewritten as the live tap-to-fill surface. Pointer, hover
  highlight, keyboard traversal in reading order, a `setHint` ring for a wrong
  labelled region, and a labels-free `snapshot()` for the wall frame. The
  freehand brush, the 72×72 grid and `scoring.js` are **deleted**.
- **`robotPuppet.js`** (new, pure) — four states, the hop curve, squash/stretch
  clamped to 0.82–1.18, limb lag, the piece layout/parent/depth tables and the
  authored roam loop. 30 tests, no three.js.
- **`paperPuppet.js`** (new) — nine unlit flat quads textured by
  `robotRenderer.drawPiece`, each with a cream *silhouette* backing for the cut
  edge, a gradient shadow and a gradient antenna glow.
- **`index.js`** — seven-colour palette, undo/eraser/guarded reset, the four
  outcomes, the activation cinematic, the roaming puppet, the old star panel
  gone, and an `__eslDebug.coloring` snapshot for the harness.
- **`src/dev/robot-preview/`** — `index.html` renders the page and the nine cut
  pieces; `puppet.html` renders a hop frame by frame and from several angles.
  **Use these to judge anything visual here**; three real defects were found
  this way that no test would have caught.

### Verified

`npm test` **568/568**. `npm run build` OK. The rewritten
`npm run playthrough:coloring` passes **59/59**, covering all four activation
outcomes, undo/eraser/reset, keyboard filling, the hop, and the anti-shortcut
route. **The harness is TRUSTED**: it was proved both ways — 59/59 known-good,
and 58/59 with `HOP_HEIGHT` forced to 0, failing on exactly the hop check.
Layout checked at 760×420, 1024×600 and 1366×768 with no overflow and 44px+
swatches. Claude looked at the colouring page, the piece cut, the hop frames and
the room.

### Three things that were not obvious

1. **A flat cut-out must not face its travel direction.** Rotating it to its
   heading showed the camera its edge and the robot was an invisible sliver. It
   flips (mirror on X) and leans at most 0.17rad instead.
2. **An untextured quad is a rectangle.** The antenna's additive "glow" rendered
   as a white box above the robot's head, and the shadow as a grey card. Both
   needed radial-gradient textures. Only a screenshot showed this.
3. **A bounding-box centre is not inside its region.** See `tappablePoint`.

### NEXT STEPS for a fresh session

1. **Owner acceptance.** `npm run dev`, enter the Atelier, and play a round.
   Judge the hop and the activation by watching them. Nothing is committed.
2. **Commit when the owner is happy** — the work is complete and green, it is
   held back only by their instruction.
3. Optional polish noticed but not done: the carried picture plane faces away
   from the camera while the child walks it to the artist (pre-existing, not a
   regression); and the effective on-screen size of a small region is ~26px at
   1024×600, comfortable for a cursor but tight for a finger.
4. **Owner acceptance of the scene editor** is still outstanding from the
   previous pass: open the Zoo with `npm run dev` and press `P`.
5. **Migrate scenery placements to layout JSON** — still not started.

## Previous pass (2026-09-22) — a reusable scene placement editor

Claude direct. The router found **no delegating worker available** (Codex in a
usage-limit window to 2026-09-22T11:00, Gemini and agy-* quarantined, Qwen
declines adaptive work), so this was all Claude. **Committed on branch `zoo-park-and-scene-editor`, not pushed** (`main` is untouched at `8d83807`) —
the owner asked for testing first. This sits on top of the still-uncommitted
roaming-animal-park pass below; both are in the tree together.

A browser level-layout tool: select, move, rotate, scale, duplicate and delete
things in the live world, export portable JSON, load that same JSON with no
editor present. `.ai/scene-editor-spec.md` is the frozen contract.

- **Generic core in `src/dev/scene-editor/`** — imports nothing from
  `src/minigames/`, `src/systems/` or `src/config/`, and a test plus a
  primitive-only demo adapter keep that honest. `layoutSerializer.js`,
  `editorHistory.js`, `editorIds.js` and `layoutLoader.js` are pure (no three.js,
  no DOM) and carry all 43 of the editor's unit tests. `SceneEditor.js`,
  `editorUI.js`, `editorCamera.js` and `pointLayer.js` are the live parts.
- **`demo/index.html`** is the reusability proof: a cube/sphere/cylinder adapter
  at `/src/dev/scene-editor/demo/` under `npm run dev`, importing no game code.
- **Zoo adapter** in `zooEditorAdapter.js`: 15 environment models, 5 categories,
  8 roaming-point groups (one per animal), collider and territory helpers.
- **Scenery is data now.** All 25 placement groups moved out of `world.js` into
  `scenery.js`; `world.js` drives them through one loop. `scenery.test.mjs` pins
  every group's placement count so a dropped row fails the suite.
- **Gated twice.** `DEV_TOOLS_ENABLED` (vite dev, or `?editor=1`) decides whether
  `P` does anything, and the editor is a dynamic `import()`, so the build emits
  it as a separate 75 kB chunk a student's browser never requests.

### Four things that were not obvious

- **`cameraRig` has no user rotation at all**, so the editor takes the camera
  and restores position, quaternion, fov **and far** on close. `far` is 100; a
  camera pulled back to see the park clips straight through it.
  `cameraRig.setEnabled(false)` is new, to stop the main loop fighting it.
- **`InstancedMesh` cannot be picked or dragged.** Grass, bushes, rocks and the
  small props are instanced, so `setSceneryEditable(true)` rebuilds those groups
  as individual objects while the editor is open. It deliberately **never
  reverts** — rebuilding would re-read the frozen placements and silently undo
  every edit made to existing scenery.
- **Placing is one-shot** unless Shift is held. Staying armed meant the next
  click anywhere dropped another object, including a click meant to select.
- **Enter in a transform field blurs it.** Otherwise focus stays in the input and
  every shortcut (delete, duplicate, undo) silently does nothing.

### Verified

`npm test` **475/475**. `npm run build` OK. Zoo playthrough **113/113** in one
clean run (seed 1592594996) — identical to the pre-existing clean run, so the
scenery data move caused no regression; Claude also viewed the grassland
screenshot and the dressing is intact. A 40-check browser pass
(demo + Zoo integration) passes 40/40, covering place, transform via gizmo and
numeric fields, duplicate, delete, undo, redo, one-undo-per-drag, export, clear,
import round-trip, unknown-asset and bad-version errors, and confirming the
editor leaves no trace and the park resumes play on close.

## Superseded — the Coloring foundation (2026-09-22)

The pure half (`robotDefinition`, `colorState`, `robotScoring`, `robotRenderer`)
was built and tested in this pass and then **built upon** by the pass at the top
of this file, which fixed its three recorded rendering defects and wired
everything to a canvas, to three.js and to `index.js`. Nothing is outstanding
from it; `.ai/coloring-robot-spec.md` remains the frozen contract and
`.ai/wo-coloring-robot.json` the (now completed) work order.

## Previous pass (2026-09-20) — the Zoo becomes a roaming animal park

Claude directly. Router: Codex in a usage-limit window until 2026-09-22, Gemini
and the agy-* workers under the global readiness quarantine, so no delegating
worker was available (order `.ai/wo-zoo-clips.json`). **Not committed, not
pushed** — the owner asked for testing first.

The fenced zoo let a sign do the finding and a pen do the framing. It is now one
continuous park where eight animals walk around and have to be looked for.

- **Eight animals, all animated**: tiger, horse, dog, deer, cat, penguin,
  chicken, giraffe. Removed with their vocabulary, models and pens: elephant,
  alpaca, fox, wolf, stag, bull, cow, donkey. The horse moved from a static OBJ
  to the rigged `Animals.glb` node, because a static mesh cannot walk.
- **The clips did not exist and had to be built.** `Animals.glb` ships seven
  rigged skins and **zero** clips. `scripts/build-animal-clips.mjs`
  (`npm run build:animal-clips`) lifts idle/walk/run out of the ITHappy pack's
  source FBX — the `.unitypackage` is a gzip tar, so **no Unity was needed** —
  and writes `assets/animals/animal-clips.json` (1.2 MB raw, 310 KB gzipped).
  The models are untouched; clips attach at runtime.
- **Two traps worth remembering.** (1) GLTFLoader renames duplicate node names,
  and all seven animals share bone names, so a clip binds to the tiger alone and
  silently animates nothing for the other six — `retargetClip` resolves the
  `_1`/`_2` suffixes. (2) Tracks targeting `<Mesh>_rig` carry armature root
  motion and must be dropped or animals drift off their own position.
- **The giraffe's walk is borrowed from the styloo cow**, which uses a
  byte-for-byte identical 48-node Rigify rig. Rotation tracks only, so the
  giraffe keeps its own neck and legs. Verified by rendering six phases.
- **Everything that pointed the way is gone**: the `YOU ARE HERE` board, four
  junction signposts, `REGION_SIGNAGE`, `JUNCTION_SIGNPOSTS`, the sign canvases,
  `getSignageData`, all thirteen circular pens with their fence posts, rails and
  **habitat fence colliders**, and the eight `*-viewpoint` path spokes. Nothing
  replaced them — no arrows, targets, minimap dots or waypoints. Also removed:
  the giraffe feeding post (a pen fixture that read as a blank sign and blocked
  a third of the giraffe's routes).
- **Roaming**: `territories.js` (authored waypoints, 14–17 units across) and
  `roaming.js` (a pure idle/walk state machine with seeded RNG). Animals idle
  2–6 s, pick a reachable waypoint, turn, walk, idle again. They never flee, and
  never teleport — not even the ~0.3-unit arrival snap the first version had.
- **`animalAnimator.js`** crossfades idle/walk at 0.2 s and divides the walk
  clip's timeScale by a per-animal `clipSpeed` so feet do not skate.
- **Soft animal collision**: the big animals ease the player out over a few
  frames and never push them into scenery. No hard colliders, no deadlocks.
- **Assets deleted** (git-tracked, recoverable): `elephant.glb`, `alpaca.gltf`,
  `obj/` — 2.3 MB nothing referenced.


### The owner's corrections after playing it

Four things, three of which no test caught. **Orientation and camera handedness
are judged by looking, never by reasoning about the maths.**

- **The animals walked backwards.** Every `ANIMAL_MODELS` entry carried
  `yawOffset: Math.PI` from the fenced zoo, where animals stood still facing a
  viewpoint. These models face **+z**, and roaming sets rotation to the heading,
  so the offset turned each 180 degrees. Deleted. The playthrough passed 62/62
  through this, because it checks the *player* faces the animal, never which way
  the animal faces.
- **The viewfinder turned the wrong way.** `rotation.y += move.x` — but
  screen-right in world is `(-cos y, sin y)`, a *smaller* yaw. Now `-=`. The
  harness's own aiming had to be flipped to match, or it converged on the exact
  opposite bearing (`dot: -0.99`).
- **The giraffe stands still** (speed 0). The cow-retargeted walk moves its legs
  correctly but with a cow's gait; the owner judged still better than strange.
  The clip stays in the bundle, unused.
- **One plant palette, led by grass.** Already all Quaternius Nature, but wide:
  two pines, dead tree, ferns, flowering bushes, two rocks, pebbles. Now six —
  two grasses, bush, broadleaf, pine, rock — with grass roughly doubled and the
  farm meadow and cove given their own. Ground colour moved from `0x75b866` to
  `0x74ad3d`, taken from the pack's own grass ramp, so the tufts stop reading as
  stuck onto differently-coloured ground. `Grass.png` is a palette strip, not a
  tileable ground texture, so the field cannot literally use it.

### Verified

`npm test` **420/420**. `npm run build` OK. Zoo playthrough **113/113** in one
clean run (seed 1592594996) after the corrections — listening 30/30,
antiShortcut 18/18, animals 62/62, suite 3/3. Search times from the plaza: horse
4.3 s, chicken 7.1 s, giraffe 10.2 s, penguin 14.2 s, deer 14.6 s, cat 15.5 s,
dog 17.4 s, tiger 25.1 s — the harness walks straight at an animal it can
already locate, so a child who must look will take longer. Claude viewed the
park: no signs, no pens, animals facing the way they walk, one plant palette.

### Replacing the old zoo harness assumptions

`scripts/playthrough-zoo.mjs` was built around fixed viewpoints and signage.
The `habitats` section is now `animals`; `faceHabitat` is `faceAnimal` and
re-reads the target every pass; `approachAnimal` walks to a photographing
distance from wherever the animal is now; the signage checks are replaced by
checks that the signage, viewpoints and habitat records are **gone**.

### NEXT STEPS for a fresh session

1. **The owner judges the park in play.** Is the search satisfying rather than
   tedious? The harness walks straight at an animal it can already locate and
   still takes 4-19 s; a child who has to actually look will take longer.
2. **Watch the chicken specifically.** It is the one animal whose size and speed
   were tuned rather than measured, and the one a child must walk right up to.
3. **Nothing is committed.** The tree holds the whole pass, including the
   deletion of `elephant.glb`, `alpaca.gltf` and `obj/`.
4. Codex was unavailable (usage limit to 2026-09-22) and the other workers were
   quarantined, so this was all Claude direct. If more animal-park work follows
   and Codex is back, the roaming and clip modules are small and well-bounded.

## Earlier pass (2026-09-20) — rival quota, solid room, hint removed

**PUSHED LIVE 2026-09-20** at the owner's request, after the whole pass was
tested. On top of `568bec1`. Verified before the push: `npm test` **391/391**,
`npm run build` OK, permanent Restaurant playthrough **73/73**, plus a
known-bad run of each new instrument. Claude viewed the room: the upper-left is
clear and the bottom bar carries the Talk action (🎤 おして はなそう + `Space`).

- **Rival lifetime quota removed.** `canClaimMore()` is now
  `orders.length + (pending ? 1 : 0) < maxActiveOrders` — capacity, not history.
  The old `claims < round(total * share)` resolved to **2 in every round**, so
  the rival went idle after two customers and Waiter 3's two-order memory was
  invisible. `share`, `claimLimit` and the unused `total` option are deleted
  from `RIVAL_LEVELS`, `createRestaurantRival`, `currentRivalConfig()` and the
  debug snapshot. `claims` stays as statistics; `rival.eligibleUnclaimed` is new.
- **New pure `roomCollision.js` (+18 tests).** Owns `TABLES`, `TALK_RADIUS`,
  `ROOM_BOUNDS`, `blocksMovement`, `canOccupy`, `resolveMove` and
  `chairPositions` — which `index.js` now builds the chair meshes from, so mesh
  and collision box cannot drift. Chairs 0.57 × 0.53, seated bodies r 0.50
  (visible size + the 0.12 body padding the table always had). Only `seated` /
  `awaiting` / `eating` are solid; walking-in and leaving customers stay soft.
  Keyboard and click-to-walk share `resolveMove`, which lets a body already
  inside an obstacle walk out (a customer can sit down on the player).
- **The upper-left contextual hint is deleted** — element, CSS, `setInstruction`
  and all 15 call sites. It duplicated the button beneath it; the Space action
  button and the Talk button carry it. The owner ruled out replacing it with a
  bottom line. Three moments lost their text line (turnaround, round end,
  stamp) and rely on their existing cues — judge the turnaround in play.
- **Two new permanent playthrough checks** (73/73): the Round 3 rival serves
  more than the old two-customer quota, and keeps seeking work afterwards.
  Known-bad (quota reinstated) fails exactly those two with `rival served 2,
  claimed 2`, so they are trusted.

### NEXT STEPS for a fresh session

1. **Round 1 is now strictly harder.** Waiter 1 could only ever take two
   customers a shift; it now works continuously, throttled only by
   `minSeatedAge` 7 and 0.8–1.5 s hesitation. This stacks on the removal of
   Easy. Watch it against a real child before tuning.
2. **Judge the turnaround** without 「こんどは きみの ばん！」: does the close-up
   plus the partner's question bubble read as "your turn"? If not, it belongs in
   the temporary notice, not a restored panel.
3. Rival steering was left alone (see DESIGN_DECISIONS); watch whether it ever
   visibly clips a chair corner now that chairs are solid for the player.
4. Re-run the other four minigames' playthroughs — untouched this pass, but
   still not re-run since the earlier `lesson.js` / `main.js` edits.

## Previous pass (2026-09-21)

**Restaurant: one fixed difficulty, three waiters, ramen, fast belt bursts.
PUSHED LIVE 2026-09-21** at the owner's request, after testing. Verified before
the push: `npm test` **369/369**, `npm run build` OK, permanent browser
playthrough **71/71**, and a known-bad run that failed only on its seeded check
(so the harness is TRUSTED). Claude viewed the Round 3 room, the Waiter 3
challenge panel and a fast burst; the owner approved Waiter 3's look.

- Restaurant ignores the global difficulty; `RESTAURANT_LEVEL = 2` is the one
  baseline (4 tables, 9 customers, 38 s patience). The difficulty control is
  hidden while the Restaurant is open (`settings.setDifficultyAvailable`).
  **Easy is gone as a Restaurant mode** — see DESIGN_DECISIONS for the
  classroom consequence.
- `ROUND_TWO` / `ROUND_THREE` are single objects. R1 and R2 share the baseline
  patience; R3 is 29 s (`ROUND_THREE_PATIENCE_SCALE` 0.76, 23.7% shorter). No
  round overrides the customer share any more.
- Waiter 2 lost the gold bow tie. **Waiter 3 is new** (`RIVAL_IDS.WAITER_3`)
  and gets the full challenger entrance through a shared
  `beginNextRivalTransition(round)` / `beginNextRivalIntro()` path.
- `beltMalfunction.js` and the amber warning-lamp bar are **deleted**. New pure
  `beltTempo.js` (+15 tests): normal 5–9 s / fast 2–4 s at 2.0×, belt never
  stops. `conveyor.setTempo(multiplier)` divides the entry interval so spatial
  spacing is preserved.
- **Conveyor bug fixed:** dish spacing is now enforced as a distance rule
  (`entryClearanceDelay`), not a time rule. A speed change could bunch dishes to
  1.26 (under `MIN_DISH_SPACING` 1.9). This also closed the same latent hole in
  the pre-existing rush / Round 2 mode switches.
- `noodles` -> `ramen` everywhere, with toppings on the bowl, a saved-answer
  migration in `progression.js` (`RENAMED_ANSWERS`) and explicit speech
  variants. New `src/systems/progression.test.mjs` (8 tests).

### NEXT STEPS for a fresh session

1. **Classroom playtest of the new curve.** Removing Easy is the biggest open
   risk: every student now meets the waiter ladder at the competitive baseline
   (38 s patience, 9 customers) where Easy used to give 48 s, 5 customers and no
   rival at all. The solo warm-up still shields a struggling child — the rival
   only arrives on the third correct delivery — but that is untested in class.
2. Judge a Round 3 fast burst by eye: dramatic but still readable? And whether
   Waiter 3 reads as a friendly waiter to actual children.
3. Re-run the other four minigames' playthroughs — they were not run after the
   `lesson.js` and `main.js` edits in this pass.

NOT done: Challenge/412 px (both now moot for the Restaurant, which is fixed at
one baseline, but the other minigames still use difficulty and were not re-run
after the `lesson.js` and `main.js` changes), real unforced outcomes, and any
human playtest of the new curve.

## Status

All five minigames are playable end to end and published at
<https://nolancasama.github.io/esl-likes/>, deployed from `main` by
`.github/workflows/pages.yml` (unit tests gate the deploy). **Live = the
2026-09-20 pass at the top of this file** (rival works the whole round, solid
chairs and seated customers, no upper-left hint), on top of the 2026-09-21
three-waiter/ramen pass and, before that, Restaurant
2026-09-17 passes (まってる… bubbles, patience strip, rival intro, 0–0 score,
sign/conveyor, result moment, rival/customer turnaround partner; pushed
2026-09-17 at the owner's request, `npm test` 255/255 + build, Challenge not run,
owner has not reviewed renders) on top of solo-then-rush (2026-09-16) and open
seating `583e07d`; earlier the conveyor revision, Zoo wrong-photo rule and Zoo harness.

Pushed with known gaps (owner informed): `npm test` 239/239 and build passed,
but Drink Stand/Sports/Zoo playthroughs were not rerun after the
conveyor change (`src/config/lesson.js` touched), the owner has not reviewed
screenshots A–E, the Restaurant harness is UNTRUSTED (131–134/136, no
known-bad run), and the tub-over-delivery Space priority ships unchanged.

## What Exists

- `SPEC.md` — the frozen design; `DESIGN_DECISIONS.md` — why.
- Shared: `speechFocus.js` (service clock frozen during speech), `talkDwell.js`
  (stop + face + 1.2 s dwell starts a conversation; moving drops the target, and
  stopping again inside the radius while facing starts a fresh dwell),
  hold-to-talk fallback, `AUTO_TALK_ENABLED` in `src/config/interaction.js`.
- **Restaurant solo-then-rush (2026-09-16, LIVE):** every
  shift starts solo; on Normal/Challenge the player's third correct delivery
  (pure `rushTrigger.js`) starts a one-shot rush after a 1.6 s beat — conveyor
  `startRush()` (solo ≈ 3.7 visible dishes, rush ≈ 5.1 Normal / 6.6 Challenge,
  speed +8% / +12%, `MIN_DISH_SPACING` 1.9), director `manualRush`, and the rival
  walks in up the front-left aisle under a temporary `ウェイター` tag and waves before its AI starts
  (superseded by the challenge scene, live 2026-09-17, Next Steps 000000: the
  belt and director now switch only after the player's reply). Normal rival
  enabled. Totals 5/9/13. DESIGN_DECISIONS 2026-09-16 "shifts start solo".
- **Restaurant open seating (2026-09-16, LIVE `583e07d`; owner has not marked
  screenshots A–D):** Talk is Space everywhere (speech consumes only handled
  presses); any seated unclaimed customer can be asked (no raised hands,
  `orderCue`, `?` cue, patience meter or owner badge); pure rules in
  `customerState.js`; white `I like...` bubble = mine, black = rival's, none
  when unasked or eating; patience internal (150/140/130 s) with a look-around
  late warning; belt front (z ≤ -4.0) outranks Talk; rival claim share 0.5
  (6 of 11), 4 s seated-age delay, white waist band; `RIVAL_LEVELS[2]` defined
  but disabled. DESIGN_DECISIONS 2026-09-16. Lines below about hands, the
  live-order limit, the 3-customer cap and the tray badge are superseded.
- Restaurant (`src/minigames/restaurant/`): rush-hour shift run by pure
  `director.js`; tables 3/4/5, live-order limit 1/3/4 (a raised hand counts),
  food-owned prep times (`FOOD_PREP_SECONDS` in `scoring.js`), dishes matched by
  food, combo, Listen Again, wrong-delivery refusal lock, whole-room camera,
  click-to-walk. Working tree: pure `conveyor.js` (committed `07f1f64`) drives a
  belt entering the right wall and leaving the left under a MATSUBARA
  RESTAURANT sign; no counter/bell/ready cue; host only at turnaround;
  dish-return tub at (6.0, -3.95); a raised hand outranks the return action.
- Restaurant Challenge rival (SPEC §4 "Challenge rival waiter"):
  - Pure `claims.js` (ownership, player reservation on dwell/talk, claim on
    commit) and `rival.js` (state machine, own pass, 4 s hand age, 3-customer
    cap, speed 3.75); director owner-aware budget; Challenge total 11.
  - Scene: rival character (white apron), rival pass (live: left end of the
    counter; working tree: its own hatch on the left wall, never on the belt;
    not collectable, no bell), neutral tray badge on rival tables,
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

## Verified (2026-09-14; conveyor tree 2026-09-15)

- `npm test` 239/239 and `npm run build` on the uncommitted conveyor tree
  (2026-09-15). The Restaurant playthrough counts below predate the conveyor.
- `npm test` 227/227 (2026-09-14).
- Restaurant playthrough 127/127 on the current tree, including the Challenge
  staged takeover, rival freeze during speech (sampled mid-walk), rival-owned
  delivery refusal, and a full 11-customer Challenge shift.
- Regression: Drink Stand 56/56, Sports 21/21. (The Coloring figure here is
  historical — that harness was rewritten on 2026-09-22 and now runs 59/59.)
- Owner visual confirmation of Challenge screenshots 09–12: rival clearly
  distinct, score pill readable, room reads busy, five-order stretch kept.

## NOT Verified

- Chromebook: real speech and auto-listening, trackpad/touch, whether Challenge
  with a rival is too much for Grade 3, Zoo frame rate (~137k triangles).

## Zoo playthrough (rebuilt 2026-09-20 for the animal park, harness TRUSTED)

- **113 checks** per run now, not 144: the thirteen habitats became eight
  animals, and the signage checks became checks that the signage is gone.
- `approachAnimal` derives its standing distance from each animal's reported
  photo bounds (giraffe ~9.9 units, chicken ~2.3) and steps to 0.7x and 0.5x on
  a failure; `faceAnimal` re-reads the moving target and taps the turn key for
  the time the remaining error needs. Holding the key until a predicate flipped
  span the player through whole revolutions.
- Known-good **113/113** after the owner's corrections (seed 1592594996).

## Zoo playthrough, pre-park (fixed 2026-09-14)

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

000000000000. 2026-09-20 Restaurant Round 3 + no-teleport transitions
     (Claude directly — router: Codex in a usage-limit window until 2026-09-22,
     Gemini and the agy-* workers under the global readiness quarantine, so no
     delegating worker was available; order
     `.ai/wo-round3-rival-multiorder.json`). **PUSHED LIVE 2026-09-20 at the
     owner's request**, after the whole pass was tested. See "Latest pass" at
     the top for what changed and what was verified. NEXT: the owner judges
     Round 3 in play — are the stoppages noticeable but not annoying, is the
     amber warning understandable, and does the difficulty read as multitasking
     rather than speed? Then Challenge (level 3) and 412 px in the browser.

00000000000. 2026-09-19 Restaurant rival progression (PUSHED LIVE 2026-09-19 at
     the owner's request, after testing; Claude directly — router: Codex usage-limit until
     2026-09-22, other workers quarantined; order `.ai/wo-restaurant-rival-progression.json`;
     DESIGN_DECISIONS "rival progression", SPEC §4 "Rival progression").
     Round 1 loss/draw → `もう一回 やる？` rematch/finish (rematch = Waiter 1, no
     solo, no cinematic, 0–0); win → Waiter 1 walks out, Waiter 2 (model `k`,
     black apron, gold bow tie) full intro → Round 2 (harder per level) → final
     question from Waiter 2. Pure `rivalProgression.js` (+ `ROUND_TWO` tuning),
     conveyor `startRoundTwo`, director `paceScale`, `resetForNextRound` in
     index.js, debug `progression {...}`, `rival.config`, `hud.overlayCreates`.
     Verified: `npm test` 317/317, build OK; browser harness (session scratchpad
     `restaurant-progression.mjs`, forced outcomes, Normal shift patched to 5)
     paths A 9/9, B 19/19, C 41/41, D 31/31, E 19/19, F 32/32, G 49/49 (F/G
     after harness-only sampling fixes); known-bad (choice removed) fails as
     expected. Claude viewed W2 close-up, replies, Round 2 start, choice screen,
     final question. Old `npm run playthrough:restaurant` stopped after ~20 min, 0 passes (stale harness, raised-hands era). NOT run: Challenge (level 3) in the browser, 412 px,
     real unforced outcomes. NEXT: owner judges Waiter 2's look and Round 2
     difficulty in play on the live build.
0000000000. 2026-09-19 Restaurant belt exchange + もどす tub sign + shared
     dejected pose (Codex via router, Sol high, SUCCESS; Claude reviewed and fixed
     directly; DESIGN_DECISIONS "belt exchange, labelled return, shared
     dejection"). PUSHED LIVE 2026-09-19 at the owner's request. Carrying at the
     belt front: `スペースで りょうりを とりかえる` swaps in place (`conveyor.exchange`,
     new id, same x); clicking a belt dish while carrying also swaps. Pure
     `actionPriority.js` (food-blind: tub > exchange > deliver) and
     `reactionPose.js` (the shared dejected pose replaces the kneeling despair).
     Claude fixes: the tub now outranks proximity Talk (it sat inside the
     back-right diner's talk radius, which blocked returns), and the belt hint
     text went back to `walkToConveyor`. Verified: `npm test`, build; browser
     (session scratchpad `restaurant-exchange.mjs`, UNTRUSTED) 14/14 (Space swap
     lands at the exact x with a new id, count and spacing kept, click swap, tub
     sign, tub return) and a player win 19/19; Claude viewed the tub sign in the
     room view and the rival's dejected shake/hold. NOT run: rival win or draw
     after the pose refactor (both use unchanged math), Challenge, 412 px.
000000000. 2026-09-19 Restaurant rival reveal + longer result hold (Codex via
     router, Sol high, SUCCESS; Claude reviewed, fixed and tuned directly;
     DESIGN_DECISIONS 2026-09-19, SPEC revised). PUSHED LIVE 2026-09-19 at the
     owner's request. Intro: walk → 0.2 s turn to camera → 2.0 s close-up with a
     fists-up challenger pose and generated BA-BAM jingle → 0.8 s camera return →
     title fades → floating `ウェイター` label + panel together (in-panel name
     badge removed) → furigana-safe typewriter (`typewriter.js`, 30/s; Space,
     Enter or a panel tap reveals all, and that press cannot answer) → all three
     replies at once. Result reaction 1.8 → 3.6 s, animations at normal speed
     then held. Claude fixed a pre-existing shared bug: `input.js` keyup
     prevented Space on focused buttons, so Space never answered a reply.
     Verified: `npm test` 288/288, build OK; browser (session scratchpad
     `restaurant-reveal.mjs` / `restaurant-stage.mjs`, UNTRUSTED, no known-bad
     run) intro skip 38/38 and natural 35/36, win/lose/draw 19/19 each. The
     remaining misses were script sampling gaps, not game failures. Claude
     viewed the close-up, typing and reply renders. NOT run: Challenge, 412 px
     close-up, other minigames after the `input.js` change (it only stops
     preventing Space/Enter keyup on focused buttons). NEXT: owner judges the
     reveal's feel and the jingle by ear (sound was not observed).
00000000. 2026-09-18 Restaurant dedicated result stage (Codex via router, Sol
     high, SUCCESS; Claude reviewed renders and tuned directly; DESIGN_DECISIONS
     2026-09-18, SPEC "Result moment"/"Turnaround partner" revised).
     PUSHED LIVE 2026-09-18 at the owner's request. Rival shifts: 0.9 s frozen room beat, then the same
     player/rival staged left/right in front of the stopped belt under the sign,
     procedural reactions (celebrate / three-quarter kneel with fist shakes /
     dejected / shrug), label fades, score shrinks to the top, waiters turn to
     each other, camera eases in, the rival asks the question; Easy/pre-rush
     unchanged. Pure `resultStage.js` + tests; debug `resultStage {...}`;
     portrait viewports pull the stage camera back (`fitStageCamera`).
     Verified: `npm test` 277/277, build OK; browser (session scratchpad
     `restaurant-stage.mjs`, UNTRUSTED, no known-bad run; dev server with the
     outcome forced and the Normal shift shortened to 5, harness-side only)
     18/18 each for win/lose/draw at 1366x768 (before the portrait fit, which
     leaves desktop framing unchanged) and a 412x915 layout run. NOT run: an
     unpatched real full shift, Challenge. Known: at 412 px the score pill
     touches the settings button (pre-existing, gameplay pill too); during the
     question the bubble covers part of the sign. NEXT: owner judges the renders
     (is the kneel funny, not distressing?) on the live build.
0000000. 2026-09-17 Restaurant faster patience + modal challenge + hint-only HUD
     (Claude directly; DESIGN_DECISIONS sixth pass, SPEC §3 patience and director
     paragraphs). PUSHED LIVE 2026-09-17 at the owner's request. Patience 48/38/28 s (`PATIENCE_SECONDS`,
     supersedes the 150/120/100 lines below), green/amber/red at 50%/20%, thicker
     strip, red pulse. Challenge overlap root cause fixed (same-frame context
     update re-showed Talk) + modal class + Talk forced hidden + bubbles hidden.
     Upper-left is a compact hint only; no title, no progress (debug `progress`
     and new `hud {hintVisible, hintText, modal, talkVisible, talkEnabled,
     actionVisible, listenAgainVisible, scoreVisible}`). Verified: `npm test`
     269/269, build OK, Normal browser run 30/31 (the failure was in the check
     itself) + solo section rerun 12/12 + strip renders
     (session scratchpad `restaurant-hud.mjs`, UNTRUSTED). NOT run in the browser:
     Easy/Challenge, result-moment and turnaround hint hiding. NEXT: owner
     playtest of patience pressure (2–3 orders manageable?).
000000. 2026-09-17 Restaurant rival challenge scene (Claude directly; SPEC §4
     "Rush and rival waiter" and DESIGN_DECISIONS fifth pass). PUSHED LIVE
     2026-09-17 at the owner's request. The rival walks in, challenges in Japanese (furigana), and the player
     picks one of three replies (click, or arrows + Enter/Space; no mic). Everything,
     belt included, is frozen until the reply; then a 0.55 s nod, and after it the rush,
     0–0 score and `ランチラッシュ！`. Pure `rivalChallenge.js` + 9 unit tests;
     debug `rivalChallenge {active, phase, awaitingResponse, lineVisible,
     choicesVisible, choices, selectedResponse}` and top-level `elapsed`. Verified:
     `npm test` 264/264, build OK, focused Normal browser check 34/34 twice
     (session scratchpad `restaurant-challenge.mjs`, UNTRUSTED — no known-bad
     run), layout probe at 1366/1024/412 px, Claude viewed renders. NOT run: Easy
     and Challenge in the browser (Easy is unit-tested; Challenge uses the same
     path). NEXT: owner plays Normal and judges whether a child reads "another
     waiter, now we compete".
00000. 2026-09-17 Restaurant ending (PUSHED LIVE with 0000 below at the owner's
     request, 2026-09-17; DESIGN_DECISIONS third and
     fourth passes): 1.9 s win/loss/draw result moment in `round-end` (pure
     `competitionOutcome`), then the final question comes from the same rival
     character after a short walk, or on Easy from the last served diner still at
     their table. The police-officer host is removed. Verified: `npm test`
     255/255, build OK; real full Normal shifts, one player win 10/10 and one
     rival win 9/10 (the label overlapped the score; fixed and passed on the
     rerun); Easy through the answer 9/9; Normal through the answer 14/14.
     A draw is unit-tested only; Challenge not run. Scratchpad script
     `restaurant-result.mjs` (untrusted, no known-bad run).
0000. 2026-09-17 Restaurant `まってる…` bubbles + claimed-patience strip + frozen
     camera rival intro + upper-centre score (Claude directly; DESIGN_DECISIONS
     2026-09-17). PUSHED LIVE 2026-09-17. Verified: `npm test` 250/250, build
     OK, focused Normal browser check 28/28 (session scratchpad
     `restaurant-wait.mjs`, untrusted — no known-bad run). Claude viewed renders:
     bubble/strip, intro and rush read well. The score pill covered the back-wall
     sign → sign lowered to y 2.85 AFTER the run, NOT yet seen rendered. Challenge
     not run. NEXT: owner reviews; patience 150/120/100 needs a classroom check.
     Second pass same day (pushed): head-to-head score starts 0–0
     (`createCompetitionScore`), two-line wood/cream wall sign at y 2.45 (A/B
     rendered; supersedes the y 2.85 note above), conveyor recoloured
     cream/wood/stainless. `npm test` 253/253, build OK, focused Normal run
     30/30; Claude viewed rush renders. Open: rush/notice cues overlap the sign
     for ~2 s.
     Supersedes the "I like..." bubble and "patience internal, no meter" lines below.
000. 2026-09-16 Restaurant solo-then-rush — PUSHED LIVE at the owner's request
     (owner has NOT reviewed screenshots A–D). Second pass added a temporary
     `ウェイター` tag over the rival during its entrance only (debug
     `rivalCharacter.entranceLabelVisible`). Verified: `npm test` 248/248, build
     OK, focused browser check (session scratchpad `restaurant-rush.mjs`, not in
     repo) 17/17 Normal and 17/17 Challenge; visible dishes solo 2–3, rush Normal
     3–5, Challenge 4–6. Other minigames not rerun (only `lesson.js` strings
     touched). NEXT: owner reviews live A (solo), B (entrance + tag), C (Normal
     rush), D (Challenge rush); classroom playtest of Normal rival.
00. 2026-09-16 Restaurant open seating (Codex x3 via router + Claude visual
    fixes; all reviewed). Verified: `npm test` 236/236, build OK, focused
    Challenge browser check 25/25 (scratchpad `restaurant-accept.mjs`, not in
    repo), Coloring 27/27, Sports 21/21. Owner asked for Restaurant-only
    testing: Zoo run stopped; Drink Stand had already failed 2 checks
    ("walking along the windows opens no prompt" saw the Talk prompt; turnaround
    timed out) — NOT investigated, may predate today (harness not rerun since
    press-to-talk). NEXT: owner reviews screenshots A–D; commit only with the
    owner's OK; decide rival on Normal after a classroom playtest.
    `scripts/playthrough.mjs` (Restaurant) is stale (raised hands) and untrusted.
0. IN PROGRESS 2026-09-15: random belt + shared-dish rival + press-to-talk in
   every minigame (DESIGN_DECISIONS 2026-09-15, SPEC §3/§4 revised). Keep tests
   proportionate (owner feedback). PUSHED LIVE 2026-09-15 at the owner's request,
   before the Sports/Zoo/Drink Stand playthrough runs finished (Coloring 27/27 had
   passed); the Restaurant playthrough is stale (see below).
   - DONE (Codex, stopped PARTIAL at usage limit; Claude reviewed, fixed the
     rival notice-timing off-by-one-frame): `.ai/wo-belt-random-stream.json`
     (conveyor.js shuffled bag), `.ai/wo-rival-shared-belt.json` (rival.js belt
     racing, speed 4.25, claims commit on acceptance), `.ai/wo-press-to-talk.json`
     (PressToTalk in speech.js, Enter key, onCommit/onCancel, HUD pulse ring and
     labels, talkDwell.js and interaction.js deleted, all minigames migrated).
     `npm test` 224/224, build OK.
   - DONE (Claude directly, owner's request): `.ai/wo-restaurant-shared-belt-scene.json`
     — index.js advances the belt order-blind, hatch removed (rival starts at
     RIVAL_START_POSITION), rival targetDish/pickUpDish/abandonDish wired (belt dish
     mesh moves into the rival's hands), player pickup resolves before rival.advance
     each update, debug rival.targetDishId/carriedDish, speech onCommit now runs
     before the mic starts (refused commit opens nothing). `npm test` 225/225, build OK.
   - Visual check DONE (`.tmp/visual-check-rival.mjs`, screenshots
     `.tmp/visual-rival-*.png`): belt carries food with no orders, first five
     entries were all five foods, hatch gone, rival walked to the belt and carried
     noodles, no page errors.
   - Playthroughs (Claude): shared `scripts/lib/pressTalk.mjs` (press Talk before
     the mic-free fallback); Coloring/Sports/Zoo/Drink Stand updated to press-to-talk
     (Drink Stand mic probe: arrival + standing opens no mic, one Enter press = one
     session); `speech-states.mjs` updated. **Restaurant playthrough left stale on
     purpose** (dwell/filler/hatch-based; rewrite belongs to the backburnered harness
     trust work) — Restaurant is covered by unit tests + the visual check for now.
   - NEXT: one run each of Coloring/Sports/Zoo/Drink Stand, then owner screenshots.
   - Router note: Claude removed a stale Codex usage window from
     ~/.claude/workers/provider-availability.json on the owner's report (backup
     in the session scratchpad); Codex then genuinely hit a new limit.
1. BACKBURNER (owner, 2026-09-15) — Restaurant conveyor harness trust. Diagnosis DONE 2026-09-15
   (`.ai/codex-diagnosis-conveyor-pickup.md`, Claude verified against source/log):
   key route walks into the table at (-4.2,-1.0); pickupCount made every pickup
   after the first a key pickup; wall-clock deadline ends Anti-shortcut early;
   click setup polling can miss the same-frame collect. Fix order
   `.ai/wo-restaurant-conveyor-harness-fix2.json`: Codex SUCCESS (adds read-only
   `carried.dishId` debug field). Known-good run 117/136: both pickup probes PASS;
   remaining failures harness-side (key-walk delivery blocked by table (0,1.8),
   pickup while carrying, dish near exit, rival-freeze staging, cascade labelled
   PRODUCT_FAILURE). Fix order `.ai/wo-restaurant-conveyor-harness-fix3.json`:
   Codex hit its usage limit (unavailable until 2026-09-19, no edits); router fell
   back to Claude, who implemented it directly in `scripts/playthrough.mjs`
   (`walkClear` via aisles ±2.1 and crossing row z -3.3, `reachableBeltDishes`,
   no pickup while carrying, return orphaned plates, `outcomeCheck` for
   end-of-shift checks, pre-click latch observe, repeated-foods check also
   accepts two same-food customers served sequentially, table-2 delivery spot
   x 3.9 clear of the return radius, `stageRivalFreezePrompt` waits outside the
   talk radius for a long rival walk). Runs: 133/136 → 134/136 → 131/136
   (`.tmp/playthrough-good6.log`). Diagnosis DONE 2026-09-15
   (`.ai/codex-diagnosis-restaurant-harness-intermittent.md`): all harness-side,
   no product bug. Rival freeze: staged too late (rival hits its 3-claim cap and
   idles) and walk estimate wrong (rival walks to aisle-side approach points);
   fix = stage early, additive read-only debug `focusScale` + `rivalWalk`
   remaining, baseline after focus ramp. Probe 5/6: late non-atomic arrivedAt +
   fixed 600 ms sleep / 700 ms threshold; fix = speech mock snapshots dwell and
   question state at recognition start. 40/41: askShowingCues consumes the
   table-2 cue; fix = explicit staging phase. Owner said stop testing
   2026-09-15; regression Drink Stand 56/56, Coloring 25/25, Sports 21/21 on the
   live tree, Zoo run stopped. Not yet dispatched. Earlier symptoms:
   - Challenge rival speech freeze: never sampled; three 12 s waits beside a
     raised hand saw no rival walk with > 1.9 s left (rival walk = distance /
     3.75). Unverified whether rivalWalkSecondsLeft reads the right destination.
   - INTERMITTENT (passed in runs 3–5): Conversation probe 5/6 — mock mic start
     514 ms after click-to-walk arrival, before the 1.2 s dwell
     (`startsDuringDwell 1`); unknown if product or harness timing. Normal 40/41
     table-2 carrying conversation not staged (timing).
   - PRODUCT QUESTION for owner: near the dish-return tub, Space returns the plate
     even when a matching awaiting customer is in range (seen at table 2 during
     delivery). Should delivery outrank return? Not changed.
   Then known-good
   `npm run playthrough:restaurant` and known-bad
   `RESTAURANT_FORCE_MISS_PICKUP=1` (harness TRUSTED only after both), then owner
   screenshots A–E via visual-review.js. Commit only with the owner's OK — all
   conveyor work (scene, harness, docs) is still uncommitted.
2. Push `ca1c246` (wrong photo used up) and the Zoo harness with the owner's OK.
3. Later: `.ai/wo-zoo-rules.json` (re-check against removed pen signs),
   Chromebook pass, Farm Buildings licence, Zoo triangle budget.

## Codex / Delegated Work

- Rival part 1 `.ai/wo-restaurant-rival-logic.json`: accepted, committed `d311b9c`.
- Rival part 2 `.ai/wo-restaurant-rival-integration.json`: Codex PARTIAL (usage
  limit) after implementing; Claude completed acceptance and harness fixes
  directly; accepted 2026-09-14.
- Conveyor logic `.ai/wo-restaurant-conveyor-logic.json`: accepted, committed `07f1f64`.
- Conveyor scene (resume order): Codex SUCCESS 2026-09-15, UNCOMMITTED
  (`src/minigames/restaurant/index.js`, `src/config/lesson.js`). Claude looked at
  1366x768 screenshots: belt, side openings, host absent, return tub, speech
  freeze all fine. Claude fixed directly: sign text clipped ("IATSUBARA
  RESTAURAN" → fits canvas); dish return moved to (6.0, -3.95) and a raised hand
  now outranks the return action (the old tub blocked table 2's conversation
  while carrying — DESIGN_DECISIONS 2026-09-14 conveyor entry). `npm test`
  239/239 after both; the tub move is NOT yet rebuilt or seen rendered.
- Conveyor harness `.ai/wo-restaurant-conveyor-harness.json`: Codex SUCCESS,
  UNCOMMITTED `scripts/playthrough.mjs`, **UNTRUSTED**. First known-good run
  (pre-tub-fix build) failed: key pickup chases the dish's stale x (harness
  defect), duplicate check names per session (harness defect), table-2 prompt
  blocked (product defect, fixed above; Challenge customer 8 at the same table
  failed the same way), review screenshots A (transition wipe), C and D (no
  qualifying dish visible) captured the wrong state. Correction fix1 (Codex
  SUCCESS) rerun on the tub-fixed build: 120/157, no page errors; table-2 talk
  block gone, full Challenge shift completes, review screenshots A–E now show
  the right states and Claude accepts the scene visually (tub clear of table 2).
  Still failing, harness-side: key pickup times out reaching z=-4.40 (19x) and
  click pickups race the game's on-arrival collect (setup:null while carried),
  cascading into Normal 4/7 and turnaround failures. Second failed attempt →
  `diagnose-review` before any further patch. Then rebuild,
  known-good run, `RESTAURANT_FORCE_MISS_PICKUP=1` known-bad run, screenshots
  A–E, owner review.
