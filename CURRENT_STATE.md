# Current State

## Usage watch

Codex was **available and took both delegated orders** this pass. Gemini and all
four `agy-*` workers remained under the global coding readiness quarantine
(`baseline-executor-unready [executor antigravity]`). Re-check with
`node ~/.claude/workers/bin/route.js .ai/<order>.json`; these go stale in hours.
`supervise.js` does **not** exist in `~/.claude/workers/bin/` — do not plan a
review around it.

## Latest pass (2026-09-23) — new animals, and a park built from boxes

**Committed and pushed** to `main` at the owner's request, so it is live.
`npm test` 693/693, `npm run build`, the `preview` playthrough 16/16 and the
`polish-visuals` pass 7/7.

Four delegated orders (all Codex via the router, all SUCCESS) plus controller
fixes: `.ai/wo-cube-world-animals.json`, `.ai/wo-turnaround-and-occlusion.json`,
`.ai/wo-zoo-blocky-park.json`, `.ai/wo-zoo-generated-rocks.json`.

- **The Zoo's animals are Quaternius Cube World**, chosen by the owner and found
  in Downloads. Roster is now cat, chicken, dog, horse, pig, raccoon, sheep,
  wolf. Tiger, giraffe, deer and penguin are gone — the pack has no exotic
  animals, so the park reads as farm-and-woodland now. Each `.gltf` is
  self-contained and carries its own clips, so `animalClips.js`, the 1.25 MB
  `animal-clips.json` and `scripts/build-animal-clips.mjs` were all deleted.
  **The chicken has no Walk clip**; `walk` falls back to `Run` as a general rule.
- **The park is procedural.** Every imported decorative model is gone; trees and
  rocks are generated from boxes with seeded placement. A student session fetches
  no environment model at all. Visible paths, the watering hollow, the plaza
  benches and the lamp posts are all removed. Navigation data is untouched.
- **Coloring's closing question shows only the creation** — no avatar teleport,
  no avatar at all, and つぎ ▶ is hidden for that beat.
- **Heads occlude the body outline** on ninja, snowman, gingerbread and hero.

### Verified in the browser

All eight animals load and resolve idle/walk/run. Scatter exclusions hold across
four seeds (nearest tree to any waypoint ≥ 2.6 units). The turnaround, the head
occlusion, the Restaurant hint and the easel preview were all confirmed from
screenshots.

### Not verified

Foot-skating: the per-animal `clipSpeed` values are starting points for the new
walk cycles and have not been judged in motion. The full Zoo request → find →
photograph loop with the new animals was not run end to end; the `zoo`
playthrough is long and known-flaky (see the harness-pitfalls note).

### Rejected twice, on looking

The first snowman render put its smile on the head/body seam. The first
generated rocks were warm beige near-cubes that read as crates and sat on the
white sheep's colour. Both were re-tuned and re-rendered.

## Previous pass (2026-09-23) — a polish pass across three games

**Committed and pushed** to `main` at the owner's request, so it is live on
GitHub Pages. `npm test` 689/689, `npm run build`, the `preview` playthrough
15/15 and the `polish-visuals` screenshot pass 5/5 all pass.

Four slices. The Zoo one was done directly by Claude (one line plus correcting a
test); the other three went to Codex via the router (Sol medium, SUCCESS) as
order `.ai/wo-polish-preview-snowman-hint.json`. Claude wrote both acceptance
harnesses and ran them.

- **The Coloring easel stops lying.** `previewSubject` is now separate from
  `activeSubject`: the sheet in the room shows exactly what Space will open.
  Before, the easel drew the subject the child had just *finished* and then
  `startRound()` rerolled at random on opening — the page you walked up to was
  never the page you got.
- **つぎ ▶ button** pages the preview in registry order and wraps. Verified
  live: `snowman -> gingerbread -> hero -> ninja -> robot -> snowman`.
- **The snowman is two balls** with its face in the clear upper half of the
  head, and reads 1.25x human size in the Restaurant and Zoo.
- **Zoo visitors face the arriving child** instead of showing their backs.
- **The Restaurant names the question** — `おきゃくさんに「What food do you
  like?」と きこう` — in the existing pill, only while asking is the contextual
  action.

### Two corrections to this project's own record

- The DESIGN_DECISIONS claim that `faceToward(character, 0, 19)` aimed Zoo
  visitors at "the park entrance" was **wrong**. The player spawns at z 33.8 and
  the spots sit at z 24.3–30.0, so it aimed them away from the child.
- `paperVisitorFacing.test.mjs` was **asserting the bug**, requiring
  `cos(worldYaw) < -0.5` on the mistaken premise that a child at the entrance
  looks along +Z. They look along −Z. Sign flipped, premise documented.

### Acceptance actually performed

`node scripts/playthrough-run.mjs preview` (15/15) proves the easel invariant
from `previewSubjectId`/`activeSubjectId` rather than from a screenshot that all
five subjects could plausibly produce, and proves Space still opens the canvas
after つぎ ▶. `polish-visuals` (5/5) shows the hint appearing beside a customer
and clearing once the action becomes `collect`. Screenshots confirmed the
two-ball snowman and a paper visitor showing its painted front to the child.

The first snowman render was rejected on looking at it: the smile had landed on
the head/body seam with the arms crossing it. Face and arms were re-tuned and
re-rendered.

### Not verified in the browser

The snowman's 1.25x cross-game size side by side with Restaurant or Zoo humans.
The multiplier is pinned by a test (its scale is strictly greater, defaults
unchanged at 1) but the Zoo cast the robot rather than the snowman into the
visible slot on the run that was made. It is one number and easy to tune once
seen.

## Previous pass (2026-09-23) — a finished creation survives the browser closing

Phase 5, persistence. **Committed and pushed** to `main` at the owner's request,
so it is live on GitHub Pages. `npm test` 678/678, `npm run build` and the new
`persistence` playthrough 21/21 all pass.

Order `.ai/wo-creation-persistence.json`, Codex via the router (Sol medium,
SUCCESS). Claude wrote the acceptance harness and ran it; Codex's sandbox cannot
start the preview.

- **Creations are stored in IndexedDB** (`esl-likes` / `coloring-creations`,
  keyPath `id`, record version 1) as lossless PNG blobs. New module
  `src/minigames/coloring/creationStorage.js` holds every browser-only piece:
  the database, `canvas -> PNG Blob` and `Blob -> canvas`.
- **`coloringSession.js` stayed synchronous.** `savedCreations()` still returns
  an array and `saveCompletedCreation()` still returns on the same tick; the
  durable write is a fire-and-forget module-owned queue. Coloring, Restaurant
  and Zoo call sites are completely unchanged and contain no database code.
- **`main.js` hydrates once at startup**, capped at 1500 ms and gated with
  `Promise.all([charactersReady, creationsReady])`. If the cap wins, the game
  opens anyway and hydration finishes in the background.
- **Hydration merges by record id**, never replaces — a creation finished while
  the database is still loading cannot be erased by rows arriving after it.
- Storage cost measured at **~17 KB per creation** (~167 KB for ten, ~335 KB for
  twenty).

### The thing worth protecting

`clearColoringSession()` is still memory-only, so Back, hub return, replay and
browser close can never delete a child's saved work. Only `clearSavedCreations()`
touches the database, and it is wired to no UI.

### Acceptance actually performed

`npm run build && node scripts/playthrough-run.mjs persistence` — a new harness
using a **persistent** Chromium profile, so it can close the browser entirely
and reopen it. Verified: two creations survive a page reload and a full browser
restart with pixel-identical artwork (`puppet.fingerprint(24)` compared before
and after), a third made after hydration joins them, pressing Back immediately
after finishing does not lose the write, and no duplicates appear. Confirmed in
a screenshot, not only in counters.

The harness was trust-tested before being believed: known-good 21/21, and with
hydration deliberately neutered 15/21, failing exactly the six restore checks
while the write checks still passed.

### Three deliberate departures from the supplied plan

- The plan's `crowd: {...crowd}` spread was **rejected**: the live crowd member
  carries a runtime `points` array and a session `id`, and existing tests assert
  both stay out of the record.
- The plan's `subjectId || 'robot'` fallback was **rejected** as contradicting
  its own "never hard-code subject IDs"; persistence keeps `subjectId` opaque
  and the caller applies `DEFAULT_SUBJECT_ID`.
- The plan's test list was largely unrunnable under `node --test` (no DOM, no
  canvas, no IndexedDB), so an injectable storage seam (`__setCreationStorage`,
  test-only) was added and all the logic tests run against an in-memory fake.

### Known limitations

- `creationPersistenceStatus().count` reports **durably stored** creations, not
  the in-memory count — useful for acceptance, but the name is ambiguous.
- A failed database open is cached for the session, so a transient failure keeps
  persistence off until reload. Real causes (private mode, blocked storage) are
  not transient, and `DB_VERSION` never upgrades, so `onblocked` is unreachable.
- A row whose `version` is not 1 is skipped with a warning, not migrated. That
  is the single intended migration point when a version 2 arrives.

## Previous pass (2026-09-23) — creations cross into both other games

Phase 3. **Committed and pushed** to `main` at the owner's request. `npm test`
671/671 and `npm run build` passed at the end of the pass, before the commit.

Slice A (order `.ai/wo-paper-characters-restaurant.json`, Codex via the router,
Sol high, SUCCESS) generalised the robot-only Restaurant adapter. Slice B (the
Zoo) was done directly by Claude, because Codex quota was nearly spent.

- **One shared adapter.** `src/systems/paperCharacter.js` replaces
  `restaurant/robotCustomer.js`; `src/systems/creationCasting.js` replaces
  `restaurant/robotCasting.js`. Both are game-neutral and now serve Restaurant
  and Zoo. `savedRobots()` is gone — everything filters `savedCreations()` by
  `crossGame` metadata instead.
- **All five subjects visit the Restaurant**, not just the robot. Verified in
  the browser: a ninja seated among three humans at correct height.
- **Paper visitors in the Zoo.** Built in `buildCharacters`, pushed only into
  `visitors`. Confirmed in the browser: a paper visitor stands at a spot and the
  talk prompt targets it.
- **Presentation is per subject**, not magic numbers in a controller:
  `subjectPresentation.js` derives Restaurant and Zoo blocks from `liveScale`,
  normalising both to the host game's human height.

### The thing worth protecting

A creation can never be photographed to satisfy "What animal do you like?" —
paper visitors never enter `zooWorld.habitats`, which the Zoo controller only
reads. Asserted against the source, plus a facing test proving a paper visitor
shows its artwork (not its blank back) at every visitor spot.

### Two corrections made during this pass

- The plan assumed "paper animals in Zoo from Phase 2". **There is no Phase 2**
  — the animals were cut. Items about photographable paper animals were
  dropped as unimplementable; the guard half was kept.
- Claude wrongly reported that the Zoo never ticks visitor animations, from a
  truncated read, and added a duplicate `updateAnimation` call. The Zoo **does**
  already tick them, at the end of the visitor loop. The duplicate was removed
  before testing; no double-speed animation shipped.

### Not verified in the browser

The full Zoo visitor lifecycle with a paper visitor — asking, photo delivery,
the celebration and the dialogue two-shot framing. The walk harness kept missing
the visitor, and chasing it further was not proportionate; the facing, casting
and role separation are all covered deterministically instead.

## Previous pass (2026-09-23) — four more pictures, chosen at random

Slices 2 and 3 of the Coloring subject plan. Order
`.ai/wo-coloring-eight-subjects.json` (Codex via the router, Sol medium,
SUCCESS) authored eight subjects; the controller **rejected the four animals
after looking at them** and the owner chose to drop them rather than spend
another pass. Slice 3 (selection and wording) was done directly.

**Five subjects ship: robot, snowman, gingerbread, hero, ninja.**

- The first page of a visit is always the robot; every page after it comes from
  `pickNextSubject({ lastId })`, so a subject never repeats back to back.
- The visible label is now `POWER` with its ⚡, and the canvas's accessible name
  is `えに いろを ぬろう`. Nothing tells a child colouring a snowman about a robot.
- `savedRobots()` still filters to `subjectId === 'robot'`, so the Restaurant
  keeps taking robots only. Confirmed in the browser: a room holding a robot and
  a snowman produced robot customers and no snowman.

### Why the animals were cut

Four animal subjects were authored, rendered and rejected. Built from
the robot's template — a circle head on a capsule body with two symmetric limbs
— one read as a bear, another as two large circles, and the side-on
cat and dog as jumbles. The cause is the silhouette vocabulary: it is only
rectangles and circles, so there is no way to make a pointed ear, a comb, a beak
or a tail, and cat ears came out as a cartoon mouse's. **Anyone retrying the
animals should add a `polygon` silhouette kind first** — one generic addition to
`shapeBounds`, `insideShape` and `pathSilhouette`. A draft of exactly that was
written and reverted unused when the animals were dropped. `category` and
`zooSpecies` remain in the contract for that later pass.

### Validation

`npm test` **663/663**. `npm run build` OK. Browser: all five pages rendered and
looked at (`.tmp/five-pages.png`, `.tmp/subjects-poses.png` — the pose sheet
samples each subject at four moments of its own hop); a full playthrough painted
a robot then a snowman, both roam the room together, and the Restaurant took
only the robot.

### How to look at the subjects again

`.tmp/render-subjects.mjs` runs against `npm run dev` (NOT the built bundle) and
imports the source modules straight into the page, so it calls the real
`drawPage` rather than a copy of it:

    npx vite --port 5300 --strictPort
    node .tmp/render-subjects.mjs http://localhost:5300 .tmp/subjects

### Next

The Coloring subject plan is complete for the five characters. Outstanding from
the original plan: the four animals (needs `polygon` first), and Zoo reuse of
animal records, which was explicitly out of scope.

## Previous pass (2026-09-23) — Coloring learns what a "subject" is

Slice 1 of 3 of the nine-subject Coloring plan. Order
`.ai/wo-coloring-subject-contract.json` (Codex via the router, Sol high,
SUCCESS). **No new characters yet** — this is the contract and the Robot's
migration onto it.

- `subjects/robot.js` holds the Robot as data: pieces, pivots, parents, depth,
  shapes, typed detail `marks`, a declarative `personality` and `liveScale`.
  `subjectRegistry.js` holds the registry, `subjectById`, `DEFAULT_SUBJECT_ID`
  and `pickNextSubject({ random, lastId })`.
- Geometry, renderer, motion, coverage and `createPaperPuppet` all take a
  subject. `poseFor(subject, state, t)` builds rotations from the subject's own
  piece list, so a legless snowman or a cat with a tail needs no new code.
- Session records carry `subjectId`. `savedCreations()` is the general view;
  `savedRobots()` is the filtered compatibility view the Restaurant still uses,
  treating a record with no `subjectId` as a robot.

### The bar was "nothing visible changes", and it was checked, not assumed

The controller diffed the new code against the pre-refactor modules directly:

- **Motion is bit-identical** — 15,652 numbers compared across all four states
  at 0.01 s steps, largest difference **0**.
- **Geometry is identical** — same silhouette bounds, same area to 8 decimal
  places, **0** membership and **0** piece-owner mismatches over 90,000 sampled
  points, and identical per-piece bounds.

### Validation

`npm test` **657/657**. `npm run build` OK. Browser: the full Coloring →
Restaurant playthrough still runs end to end (two robots painted, activation,
easel emergence, room roaming, door turnaround, hub, robot customers seated).

### A regression from the previous pass, found and fixed here

The Back button was sitting **on top of the Coloring room's title and hint**.
`.top-bar` is shared by Coloring, the Drink Stand, Sports, the Zoo and the hub,
so this affected four minigames, not one. Fixed with a `shell-has-back` class
and one shared padding rule. The earlier browser pass checked Back against
Settings but never against a scene card — worth remembering when adding any
shell-level control.

### Next

Slice 2: the subject definitions (four rejected animal drafts, snowman,
gingerbread, hero, ninja) as pure data against this contract. Slice 3: random
subject selection, the generic POWER wording (ロボットパワー still says "robot"),
and the browser review of all nine.

## Previous pass (2026-09-23) — a way out, and a finish worth pressing

Two shell/UI changes. Order `.ai/wo-global-back-button.json` (Codex via the
router, Sol medium, SUCCESS) for the Back button; Claude did the Coloring
Finished work directly, reviewed the delegated half, fixed one ordering defect
in it, and owned the browser pass.

- **One shell-owned Back control.** `src/ui/backControl.js` renders `← もどる`
  upper-left, mirroring the Settings launcher on the right, and routes through
  the existing `returnToHub()` — which already ran `controller.exit()`, so no
  minigame needed its own Back code or its own teardown.
- **One Escape authority.** backControl owns the only global Escape listener.
  Settings, the stamp book and the Zoo viewfinder register guards instead of
  their own listeners, so one press can never both close a local UI and leave
  the minigame. Claude added a **priority** to the registry: the viewfinder sits
  at `z-index: 18` and the Settings launcher at 40, so a child can open Settings
  over an open viewfinder, and most-recent-first would have closed the
  viewfinder underneath. Shell modals now outrank minigame guards.
- **`できた！` is the primary action.** Brighter green, gold ring, gold star,
  resting at `scale(1.06)`; flat grey and motionless below full power.
- **Three pulses, then it settles** (~1.6 s), fired on the below-full → full
  edge only — and **held until the brush lifts**: `picture.js` now reports
  `strokeActive`, because the surface reports on every pointer move and full
  power almost always arrives mid-drag.
- **The cue re-arms.** `createCompletionReadiness` resets when readiness is
  lost, so erasing the liked colour and painting it back invites Done again.
  This deliberately reverses the once-per-round rule recorded last pass.

### Validation

`npm test` **651/651**. `npm run build` OK.

### Browser pass — controller-owned, DONE

Harness `.tmp/accept-back-button.mjs` (session scratchpad, **UNTRUSTED** — no
known-bad run; `SKIP_BACK=1` runs only the Coloring half). **19/19**, plus a
full sweep of all five minigames: Coloring, Restaurant, Drink Stand, Sports and
Zoo each opened, showed Back upper-left at 122x60 px, returned to the hub (Back
by click for three, Escape for two) with no stale minigame UI, and Coloring
re-entered cleanly afterwards. Back and Settings hold opposite corners and never
overlap at 760x420, 1024x600 and 1366x768. The mid-drag deferral was genuinely
exercised — the run reports power crossing full with the pointer still down and
no pulse under the brush.

### Not exercised in the browser

Back during a cinematic or a rival introduction specifically (the control is a
fixed shell element at `z-index: 45`, above every minigame overlay — the only
higher layer is `#scene-wipe` at 1000, which is `pointer-events: none`), and
`prefers-reduced-motion` (asserted in CSS by unit test, not rendered).

## Previous pass (2026-09-23) — the child's robots visit the Restaurant

Two changes: the paper puppet stopped sinking into the floor, and saved Coloring
robots now turn up as Restaurant customers. Order
`.ai/wo-restaurant-robot-customers.json` (Codex via the router, Sol high,
SUCCESS). Claude fixed the feet slice directly before dispatching, reviewed the
diff, added the missing tests and owned the browser pass.

- **Sinking feet, fixed at the root.** `paperPuppet.js` had `const FEET = 0.875`
  while the definition's lowest point had grown to `silhouetteBounds().maxY` =
  0.947, burying every puppet 0.126 world units. `FEET` is now derived, so a
  later change to the robot's proportions moves the ground with it. Measured
  lowest paint after the fix: −0.0067 (a newborn-pose tilt), was −0.133.
- **Robot customers.** Pure `robotCasting.js` reserves one of the first three
  arrivals when `savedRobots()` is non-empty and gives every other arrival a
  0.25 chance; `robotCustomer.js` wraps a fresh puppet built from the saved
  artwork in a THREE.Group carrying `playAnimation` / `updateAnimation` /
  `disposeCharacter` — the same duck type `characters.create()` returns.
- **No fork.** `index.js` changes are additive: the casting decision at
  `createCustomer`, `customer.seatedY` / `groundY` / `bubbleOffsetY` /
  `dialogueOffsetY`, and a `disposeSharedPaperAssets()` after teardown's
  existing dispose loop. `robotCustomerWiring.test.mjs` asserts the state
  machine grew no robot branch.
- **Edge-on.** The adapter eases a rendered yaw toward the heading Restaurant
  sets and holds it 0.44 rad clear of ±π/2. Independently swept by the
  controller: the sheet never drops below **42.6%** of its width, under both a
  slow sweep and the instant heading snaps the game actually produces.
- **Shared paper assets** are now freed only when the live-puppet count is zero.

### Validation

`npm test` **643/643** (was 611; +4 feet, +14 Codex, +14 controller).
`npm run build` OK (the large-chunk advisory is pre-existing).

### Browser pass — controller-owned, DONE

Harness `.tmp/accept-robot-customers.mjs` (session scratchpad, **UNTRUSTED** —
no known-bad run). It paints two robots through the real Coloring loop, walks
out through the door turnaround, enters the Restaurant and captures
`.tmp/robot-*.png`. **Observed:** robot customers appear built from the child's
real artwork and visibly differ from each other; humans still appear; a robot
sits correctly with its legs hidden by the table; the speech bubble anchors
above it and the food question answers normally ("I like ramen."); a standing
robot mid-entrance has its feet on the floor with its shadow at its base.

### Known visual limitation

Customers walk **away** from the camera to their tables, so a robot shows the
blank cream back of its sheet for the whole entrance and only reveals the
child's artwork once it turns at the table. Correct paper behaviour and the
rotation the owner asked for, but the entrance undersells the drawing. The
Coloring room solves the same problem by flipping the sheet instead of turning
it (`setHeading`'s mirror). Not changed here — the brief explicitly wanted real
Y-axis rotation.

### Not exercised in the browser

Serving a robot the correct dish, the celebrate animation, the patience/rival
ownership bubble and the leaving hop. All are the shared customer path and are
covered by unit tests, but none was seen rendered. Robot share on Easy
(`total: 5`) measures **40%** across 20k simulated shifts — humans stay the
majority, but it is higher than the brief's "20–30%" because the guaranteed slot
lands in a short shift. `EXTRA_ROBOT_CHANCE` is the dial.

## Previous pass (2026-09-23) — the Coloring polish pass

The frozen contract is `.ai/coloring-polish-spec.md`. This source pass keeps
the existing loop and favourite-only power rule, but changes who decides when a
finished robot wakes up.

- The redundant visible Coloring title is gone. One centred hint now follows
  question → colour choice → free painting → ready-to-finish, without revealing
  the favourite colour; the canvas keeps its accessible name.
- ROBOT POWER is a bottom-to-top battery beside the page. At short/narrow sizes,
  tools span a compact row above a balanced canvas/meter row, so the vertical
  meter remains beside the picture and the picture stays horizontally centred.
- The bottom row is exactly Undo, Eraser and a distinct 「できた！」 action.
  Full power enables it but does not change phase or lock painting; readiness can
  fall and return with the artwork, while its celebration is once per round.
- Reset left gameplay. Its clean-slate logic remains behind the dev-gated
  `window.__eslDebug.coloringReset` hook alongside `coloringSpawn`.
- The answer bubble persists through coloring and contains its own keyboard-
  accessible speaker. The separate Listen Again control and duplicate answer
  notice are gone from Coloring; the shared `listenAgain.js` remains untouched.
- The sheet and shelf moved forward of the easel uprights. The paper camera keeps
  its exact 2.55-unit sheet gap, and the newborn puppet starts 0.16 units in
  front of the sheet, all derived from `PAPER_PLANE_Z`.
- Unit coverage now includes the UI/state invariants and Box3 assertions against
  the production-used easel assembly. Browser playthrough and screenshots remain
  controller-owned and were not run in this source order.

### Validation

`npm test` **611/611**. `npm run build` OK (the existing large-chunk advisory
remains non-fatal). `npm run playthrough:coloring` **363/363, exit 0** — six
rounds, three leave/return cycles, the door turnaround, a 15-robot performance
session and all three viewports.

**The harness is TRUSTED.** A known-bad build that restored automatic
activation went red on exactly the four checks that describe it — "the meter can
reach full without leaving coloring", "a real charging beat at full power still
leaves the page in coloring", "Done is enabled at full power", "the full-power
hint tells the child to press Done" — then aborted, which is correct once there
is no coloring session left to test.

### IF YOU CHANGE SOURCE, REBUILD BEFORE THE PLAYTHROUGH

`scripts/playthrough-run.mjs` serves `dist/` through `vite preview` and **never
builds**; it only refuses when `dist/` is missing. `npm run build` first, or you
are grading the previous build. This cost three runs in this pass.

### Five defects the controller found and fixed after the worker stopped

1. **Undo desynchronised the meter from the page** — `coverage.endStroke()`
   skipped empty strokes while `picture.js` pushed every one. Pre-existing;
   widened by this pass. See DESIGN_DECISIONS. Found by the playthrough.
2. **The persistent bubble blocked the brush** — no `pointer-events: none`. At
   760x420 it covered part of the head. Found by looking at a screenshot.
3. **The meter label was clipped at 760x420** — `white-space: nowrap` in the
   compact branch overflowed the 4.8rem column and cut the leading ロ. Found by
   looking at a screenshot.
4. **The speaker announced its icon twice** — the label string `UI.listenAgain`
   leads with 🔊 and the button already shows one; it now uses
   `UI.dialogue.replay`.
5. **Three harness defects** — the answer wait raced the bubble's .3s fade-in;
   `coloringReset` is dev-gated and the harness runs a PRODUCTION preview build,
   so Session A now opens with `?editor=1`; and the undo check compared a
   live-drawn canvas against a rebuilt one, which antialiasing makes impossible
   to match, so it now primes a rebuild first and also asserts the stroke count.

### Remaining visual finding

**At 760x420 the answer bubble overlaps the robot's head.** It no longer blocks
painting, but the child paints blind under it. At 1024x600 and 1366x768 it sits
on empty paper above the head and reads well. The bubble must stay visible
during coloring (owner's instruction), so the fix would be moving or shrinking
it in the compact branch — an owner call, not made here.

## Previous pass (2026-09-23) — the Coloring correction pass

The owner played the shipped easel loop and produced a fix list. This pass
implemented it, and **resolves all four visual findings from the previous pass**.

Two Codex orders (`.ai/wo-coloring-correction.json`, then
`.ai/wo-coloring-correction-harness.json`); contract in
`.ai/coloring-correction-spec.md`. The controller reviewed, corrected, ran the
playthrough and judged the screenshots.

### The one reversal, and its cost

**ROBOT POWER now charges ONLY from the spoken favourite colour**, at 28% of the
silhouette instead of 68%. This reverses a frozen non-negotiable ("the favourite
is a bonus... a robot must activate for a child who ignores it completely"),
which is marked superseded in `.ai/coloring-easel-loop-spec.md` rather than
quietly overwritten.

**The cost, accepted deliberately by the owner:** a child who does not hear or
remember the colour now has no way forward, and by the owner's instruction there
is **no on-screen hint** telling them. The listening task has teeth again; a
stuck child is now possible where it was not. An on-screen hint is deferred to
classroom testing. Do not add one without being asked.

### What changed

- **`coverage.js`** — one guard deleted from `dab()` so a dab overwrites. That
  alone gives correct repaint/erase/undo, because the per-stroke
  `{index, previous}` journal already existed. `FAVOURITE_BONUS`, `credit` and
  `creditOf` are gone; `FAVOURITE_POWER_THRESHOLD = 0.28` replaces
  `POWER_THRESHOLD`. No second history was added, deliberately.
- **`coloringSession.js`** (new) — finished robots survive leaving and
  re-entering Coloring for the running app session, as a detached canvas copy
  plus crowd personality. No three.js objects, no `localStorage`.
- **Canvas centring** — three-column grid, `visibility: hidden` for the hidden
  tool column. Measured 683.00 → 683.00 px, delta **0.00**.
- **Room** — rebuilt from `ROOM_WIDTH`/`WALL_HEIGHT`/`DOOR_WIDTH`/etc. The real
  defect was that the back wall topped at y=4.95 and the side walls at y=3.35.
- **Easel** — an A-frame that reads as an easel. Both canvas planes sit in one
  rotated `canvasGroup`, so the line art cannot desynchronise from the paper.
- **Emergence** — player retreat, a 1.2s viewing beat, and `from` on
  `createRoamPlan`/`startRoaming` so the robot roams from where it landed.

### Three corrections the controller made after looking at the result

1. **The retreat was implemented exactly as specified and was still wrong.** A
   purely backward step moves the player **towards the camera**, so they grew on
   screen and still masked the newborn robot — while the positional check
   passed. Fixed with a 1.85 lateral component and a partial turn. World-space
   distance is not screen-space clearance.
2. **A hairline seam ran from the doorway's head to the ceiling** on both sides,
   because the lintel met the wall spans exactly. It now overlaps them.
3. **`debug.pending`** was added to the snapshot: between the authored landing
   and the first roam step the newborn is not in `livingRobots`, so the one
   window where a teleport could hide had no observer. Position only — the
   favourite colour still never appears in the snapshot.

### Verified

`npm test` **600/600**. `npm run build` OK. `npm run playthrough:coloring`
**234/234, exit 0** — six rounds, three leave/return cycles, three viewports.

**The harness is TRUSTED.** A known-bad copy corrupting the recorded fingerprint
went red on **exactly** the eight artwork-persistence checks (225/234, exit 1).

Measured in the browser:
- Power semantics (a)–(h) all hold, including undo restoring power exactly after
  overpaint, reverse-overpaint and erase.
- Painting the **entire** silhouette in non-favourite colours leaves power at 0.
- Activation at **28.1–32.2%** favourite coverage against the 0.28 contract, so
  the threshold needs no re-tuning.
- Robots survive two full leave/return cycles with fingerprints unchanged.
- 15 robots: **34.7 fps** under *software* rendering; canvases 160 → 160.

### Remaining visual finding

**Robots gather in one region of the room.** Six robots read distinctly but
bunch toward one end while the rest of the floor stays empty. Spacing is decided
once at join (`RING_RADIUS = 0.62`), which prevents stacking but does not spread
a crowd. Not in this pass's scope; the fix is wider roam points, not a steering
loop. The harness's stack check uses a 0.1-unit threshold and does **not** cover
this — judge it from a screenshot.

### NEXT STEPS for a fresh session

1. **Owner acceptance of Coloring.** Still never played by a human, and now
   LIVE on GitHub Pages at the owner's instruction. Two things to watch: can a
   child work out that the spoken colour is what wakes the robot (no on-screen
   hint says so, deliberately), and does the 760x420 bubble overlapping the head
   bother a real child?
2. The robot-clustering finding above, if it bothers the owner.
3. **Owner acceptance of the scene editor** — outstanding from an earlier pass:
   open the Zoo with `npm run dev` and press `P`.
4. **Migrate scenery placements to layout JSON** — still not started.

### Codex / Delegated Work

Both orders came from Codex and have been reviewed, corrected and run by the
controller. Accepted. Nothing is in flight; nothing in the tree is unreviewed
worker output.

## Previous pass (2026-09-22) — the Coloring playthrough, and the harness for it

**Committed and pushed** as `7639e35` (the refactor) and `153673d` (the
harness), and `main` is deployed live to GitHub Pages. Pushed at the owner's
explicit request **before any human had played it** — see the four visual
findings below, which are live.

The easel-loop refactor itself was built in the previous (unrecorded) pass and
was complete but **entirely unverified in a browser** — its playthrough harness
still walked to an artist NPC that no longer exists. This pass wrote the new
harness and ran it.

- **Harness rewritten** — `scripts/playthrough-coloring.mjs`, delegated to Codex
  (`gpt-5.6-sol`, order `.ai/wo-coloring-playthrough.json`). Codex was told it
  could not run the harness and did not try; the controller ran it.
- **Claude fixed three harness defects** Codex could not have seen without
  running it: `const URL = process.argv[2]` shadowed the global `URL`
  constructor so the performance session died on `new URL(...)`; the
  "tools appear after the answer" check asserted on palette/brush/bar DOM
  visibility it had never waited for, so it raced the fade-in and failed while
  reporting `toolsVisible: true`; and `assertRoundStart` ran twice per round.

### Verified

`npm test` **592/592**. `npm run build` OK. `npm run playthrough:coloring`
**114/114, exit 0** — four complete rounds plus a 15-robot performance session.

**The harness is TRUSTED.** Runner self-tests pass (`selftest-pass` exit 0,
`selftest-fail` exit 1), and a known-bad copy that corrupted the recorded art
fingerprint went red on **exactly** the four artwork-persistence checks and
nothing else (110/114, exit 1). That is the claim that most needed proving:
robot 1 silently acquiring robot 2's paint is invisible to every unit test.

Measured in the browser, not asserted from source:
- Four robots accumulate, each keeping its own fingerprint across later rounds.
- Space works on a **blank**, a **fading** (caught at opacity 0.042) and a
  **ready** canvas. No lockout, no "wait for the next picture" text anywhere.
- Phase order per round: `canvas-question → canvas-answer → coloring →
  activation-page → reveal-easel → robot-exit → room-reveal → room`.
- Round 4 reached full power at **45.8%** coverage because the child's colour
  happened to be the robot's favourite — the 1.5x bonus doing exactly its job.
  Other rounds landed at 68.3–71.1%.
- 15 robots: **39.6 fps** under *software* rendering (swiftshader), worst frame
  gap 66.7 ms; canvases created 159 → 159 across four seconds of roaming, DOM
  canvases 1 → 1. No runaway allocation. Real GPU hardware will be far higher.
- Door turnaround works end to end: newest robot asks, answer accepted, hub
  reads back `きみは purple がすき！`, 3 stars saved.

### Four visual findings, none of them fixed

Found by looking at the screenshots, which is the only way any of them could be
found. All four are **game-side**; the harness passes with them present.

1. **The room's open side renders as a flat pink void.** The room has three
   walls, and the pulled-back camera now frames past the missing one — a large
   empty pink wedge fills the right third in both the 15-robot shot and the
   turnaround shot. Pre-existing room design, made visible by the new camera.
2. **The canvas jumps position when the tools appear.** During
   `canvas-question` the page sits left-of-centre; when the palette fades in
   the canvas reflows to centre. A visible lurch at the exact moment the child
   is meant to start painting.
3. **The turnaround bubble occludes the robot asking.** The speech bubble is
   large and centred, and the newest robot sits underneath it. The tail points
   at the right robot, but the child cannot see the speaker.
4. **Robots cluster transiently right after a round.** Four robots bunched at
   one end in the four-robot shot, while fifteen spread perfectly well. The
   harness's stack check uses a 0.1-unit threshold, far too tight to catch
   visible overlap — treat that check as not covering this.

### NEXT STEPS for a fresh session

1. **Owner acceptance of Coloring — and it is already live.** `npm run dev`,
   enter Coloring, paint a robot, watch it leave the page, make a second one.
   Still never played by a human. Screenshots in `.tmp/playthrough/coloring/`.
2. Decide on the four visual findings above; they are shipped. 1 and 2 are the
   ones a classroom would notice; 3 and 4 are polish.
3. **Owner acceptance of the scene editor** — still outstanding from an earlier
   pass: open the Zoo with `npm run dev` and press `P`.
4. **Migrate scenery placements to layout JSON** — still not started.

### Codex / Delegated Work

The harness (`scripts/playthrough-coloring.mjs`) came from Codex and has been
reviewed, corrected and run by the controller. It is accepted. Nothing is in
flight. Nothing in the tree is unreviewed worker output.

## Previous pass (2026-09-22) — Coloring goes back to freehand

Claude direct (the router found no delegating worker: Codex inside a usage-limit
window to 11:00, Gemini and the agy-* workers quarantined, Qwen declines hard
work). **Committed and pushed**, and `main` is deployed to GitHub Pages.

The owner judged the tap-to-fill robot "too segmented and instructional" and
reversed the interaction model. The come-to-life system was kept intact.

**The loop now is:** ask the artist → hear `I like ___` → paint the robot
freehand with three brush sizes and seven colours → the ⚡ ROBOT POWER bar fills
from unique painted area → at full power the robot activates **by itself** and
hops into the atelier as a five-piece paper puppet carrying the real brushwork.

### What this pass deleted

`colorState.js`, `robotScoring.js`, region types, the ★ region, colour-word
labels and their leader lines, tap-to-fill hit testing, the four activation
outcomes, the 40% free-region rule, and the Done button. Deleted, not switched
off — see DESIGN_DECISIONS for why two models of "coloured correctly" is worse
than either.

### What exists now

- **`robotDefinition.js`** — one connected robot: 11 silhouette shapes over 5
  pieces, plus `DETAILS` (face, bolts, cuffs, knees) drawn as line art *over*
  the paint so nothing subdivides into a thing that must be coloured. v1's
  proportions with the gaps closed; limbs overlap the torso on purpose.
- **`coverage.js`** (pure) — the power model. Unique area only, silhouette only,
  first-colour-wins credit, 1.5x favourite bonus, 68% threshold, 3 milestones,
  stroke-level undo, and `scoreRound`.
- **`palette.js` / `brushes.js`** — seven colours; Small 18px, Medium 38px
  (default), Large 70px.
- **`picture.js`** — the brush. Two canvases: **paint** (the child's strokes
  only, and the source for the puppet's textures) and display, redrawn as paper,
  blank body, paint, line art. Undo replays a stroke list rather than
  snapshotting images.
- **`robotRenderer.js`** — `drawPage` and `drawPiece`; a piece is the paint
  canvas clipped to that piece's own shapes.
- **`robotPuppet.js` / `paperPuppet.js`** — the hop, unchanged, adapted to five
  pieces with the arm lag moved to the whole arm.

### Verified

`npm test` **556/556**. `npm run build` OK. `npm run playthrough:coloring`
**54/54** at 1366x768, including measured-in-browser proof that repainting and
background paint charge nothing, that the favourite colour charges **exactly
1.500x**, that full power lands at **69.5% coverage after 21 large-brush
sweeps**, and that ignoring the favourite entirely still activates the robot.
**The harness is TRUSTED** — 54/54 known-good, and 53/54 with the silhouette
mask disabled, failing on exactly the background check.

Layout measured at 760x420, 1024x600 and 1366x768: no overflow, swatches 44px+,
canvas 229 / 444 / 575px.

`src/dev/robot-preview/` is the visual tool: `index.html` renders the blank page,
a simulated freehand painting, the brush sizes, the five cut pieces and five
self-checking assertions; `puppet.html` renders the seam test at rest plus a hop
frame by frame. **Judge anything visual here** — the seam question and the
130px-canvas bug were both found this way and no test would have caught either.

### Known visual limits

- When an arm swings wide during a hop, its inner edge carries a sliver of the
  torso's paint, because the overlap zone genuinely has torso paint on it. The
  alternative is a notch in the silhouette, which is worse. A few pixels at
  playing size.
- At 760x420 the canvas is 229px. Usable, but a 1366x768 Chromebook is the
  real target and gets 575px.
- The robot reads slightly squat: the visible leg is 0.167 of the picture
  against a 0.395 torso. This matches v1, whose legs were only lines.

### NEXT STEPS for a fresh session

1. **Owner acceptance.** `npm run dev`, enter the Atelier, paint a robot and
   watch it wake up. This is live and has never been played by a human.
2. **Owner acceptance of the scene editor** is still outstanding from an
   earlier pass: open the Zoo with `npm run dev` and press `P`.
3. **Migrate scenery placements to layout JSON** — still not started.

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

- **Eight animals, all animated**: cat, chicken, dog, horse, pig, raccoon,
  sheep and wolf. Each uses one self-contained Quaternius Cube World glTF.
- **Clips live in each model.** Runtime animation resolves exact names without
  an external bundle. Walk falls back to Run when absent, which covers the
  chicken without a species-specific branch.
- **Everything that pointed the way is gone**: the `YOU ARE HERE` board, four
  junction signposts, `REGION_SIGNAGE`, `JUNCTION_SIGNPOSTS`, the sign canvases,
  `getSignageData`, all thirteen circular pens with their fence posts, rails and
  **habitat fence colliders**, and the eight `*-viewpoint` path spokes. Nothing
  replaced them — no arrows, targets, minimap dots or waypoints. Also removed:
  a former feeding post that read as a blank sign and blocked roaming routes.
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
- **Every animal roams.** The horse uses the former grassland landmark slot and
  now walks with its model's own cycle.
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
The harness walks straight at an animal it can
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
  facing their viewpoint, zoomed viewfinder that
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
  photo bounds and steps to 0.7x and 0.5x on
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
- Zoo animals: Quaternius Cube World. The download had no accompanying licence
  file; confirm the source page for exact attribution.
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
