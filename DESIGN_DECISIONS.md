# Design Decisions

This file records meaningful product, UX, visual, architectural, or behavioral decisions for this project.

For each significant decision, record:

- Date
- What was decided or changed
- Why
- Previous approach, if relevant
- Rejected alternatives, if useful

Only record decisions that may be useful to understand later.

Do NOT record:
- trivial UI adjustments
- routine bug fixes
- formatting changes
- mechanical refactors with no design consequence
- every individual code modification

Git is the source of truth for detailed code-change history.

A useful rule:

> If a future developer or AI could reasonably ask, "Why is it designed this way?", record the answer here.

## 2026-09-11 — One 3D application, not five games or two stacks

The game is a single three.js application containing five independent minigame
controllers. 2D interfaces appear only where flat input is genuinely better:
the coloring canvas, the zoo viewfinder, the stamp book, settings.

Rejected: a pure 2D build (cheaper, but the escort and exploration mechanics in
Sports and Zoo want real space); and a hybrid of separate 2D and 3D stacks
(best fit per minigame, but two renderers, two NPC systems and two art
pipelines to maintain for one classroom game).

## 2026-09-11 — Five distinct minigames, no universal gameplay base class

Each minigame owns its gameplay controller, state machine, scoring, camera
preset and completion logic. Shared code exists only where it removes real
duplication: speech, audio, characters, camera rig, dialogue, progression, hub,
settings, transitions.

The repeated language pattern is the point of the lesson, so the gameplay
around it has to carry the variety. A universal minigame engine would pull the
five back toward being reskins of one another, which is the specific failure
this design exists to avoid.

## 2026-09-11 — Scoring is deliberately NOT unified

Each minigame scores what naturally matters to its own activity — temperature
and patience in Restaurant, coverage and correct color in Coloring, streaks and
speed in Drink Stand. Only the final conversion to one, two, or three stars is
shared. Unifying the underlying math would force every activity toward the same
shape.

## 2026-09-11 — The student produces "I like ___", not only comprehends it

ADDED to the original plan, which had the student only ever asking the question
and listening to the answer. That practices half the target pattern.

Every minigame now ends with a turnaround beat: an NPC asks the child "What
food do you like?" and the child answers "I like pizza." Any category word is
correct, because this is expression rather than a quiz. The answer is saved and
referenced in the hub so it feels heard.

## 2026-09-11 — Coloring scores starred regions only

MODIFIED from the original plan, which scored correct color, coverage and
neatness across every region of the picture.

One to three regions are starred, each belonging to one NPC and requiring that
NPC's favorite color. Every other region is free, unscored, creative coloring.

Scoring every region made trackpad coloring fiddly and left the English doing
little work — one color was named and the rest were prescribed by the picture.
Starring regions instead makes memory load the difficulty axis (one NPC at L1,
three at L3), keeps the stage calm, and still lets the child make something of
their own.

## 2026-09-11 — Zoo photography needs framing, not a trigger tile

ADDED. The original had the player walk to an enclosure and take a photo, which
is a proximity check wearing a camera costume. Pressing the camera now opens a
2D viewfinder, and the animal must be reasonably framed before the shutter
works. The photo becomes an action, and the snapshot is kept in the stamp book.

## 2026-09-11 — Phonetic tolerance tables alongside Levenshtein matching

Levenshtein fuzz alone will reject correct Japanese-accented English heard
through a classroom Chromebook microphone: "foot" for food, "caller" for color,
"spot" for sport, "anime" for animal. Every category noun carries an explicit
accepted-variant list, extended from real classroom transcripts.

A false rejection teaches a child that their correct English was wrong. That is
far more damaging than a false acceptance, so the matcher is tuned to err
toward accepting.

## 2026-09-11 — Restaurant orders are never displayed

Memory is the mechanic. Showing the order on a ticket or above the table would
let a child complete the minigame without understanding the English, which
violates the project's governing rule. A "remind me" action re-asks the
customer at a small star cost, so being stuck is always recoverable.

## 2026-09-11 — The shell proves integration through a replaceable practice build

Until the separate Restaurant work order lands, its hub door opens a deliberately
trivial controller from `src/minigames/placeholder/`. It uses the exact frozen
factory/context/controller contract, exercises both directions of speech (including
the reading fallback), returns a three-star result, saves the child's answer, and
awards the Restaurant stamp. The other four unbuilt doors remain visible but are
marked coming soon and cannot be entered.

This makes the complete hub-to-minigame-to-save-to-hub path testable now without
quietly turning the placeholder into an early Restaurant implementation. Replacing
the practice factory later requires changing only the shell's registry entry.

## 2026-09-11 — Character loading is optional to first paint

The shared character library begins loading immediately but does not delay the hub.
Every character request has the same animation and tint API whether it returns a
Kenney model or the procedural block fallback. Loaded instances share source
geometry and textures while cloning materials for independent tinting.

This keeps a missing or slow external texture fetch from becoming a startup dead
end, while later-created characters automatically use the full Kenney asset set.

## 2026-09-11 — Per-module injected styles are the single source of UI styling

`ui/hud.js`, `systems/dialogue.js` and `systems/settings.js` each inject their
own `<style>` block. A parallel set of rules for the same concepts had also
accumulated in `src/styles.css` (`.speech-panel`, `.talk-button`,
`.dialogue-bubble`, `.setting-row`) which nothing referenced, and whose class
names had already drifted from the real markup.

The dead rules were removed. `styles.css` now holds only page-level and
shared-shell styling — layout roots, the hub card, modals, the stamp grid, the
scene wipe. A component that injects its own styles owns them completely.

## 2026-09-11 — `[hidden]` is enforced globally in CSS

`.lesson-hud` sets `display: flex`, which beats the user-agent stylesheet's
`[hidden] { display: none }`. The result was that `hud.hide()` had no visual
effect: the hold-to-talk button and the tap-the-sentence fallback stayed on
screen in the hub, where there is no NPC to talk to and nothing to say.

`styles.css` now declares `[hidden] { display: none !important; }`. Any
component setting a `display` property would otherwise silently defeat the
`hidden` property, and every screen in this game shows and hides overlays.

## 2026-09-11 — Hub doors fan in an arc, camera looks ahead of the child

The five doors sit on a shallow arc with the outer pair nearer the camera and
turned slightly inward, and the follow camera is centred behind the child with
its look target pushed forward toward the doors.

Previously the doors were a straight row and the rig was offset 7.5 units to
one side, which pushed the fifth door (Zoo) entirely off screen and hid the
first behind the guidance card. A child choosing between five minigames has to
be able to see all five without walking around to find them.

## 2026-09-11 — Restaurant dishes carry no spatial or timing clue to their table

A ready dish goes to a random free counter slot, customers are given a
shuffled set of distinct foods, and cooking time depends on the food itself
(sushi is quick, curry is slow), scaled by level.

As first delivered, each customer index had a fixed counter slot and a fixed
prep time. The slots ran left to right in the same order as the tables, and
the bells always rang in the order the orders were taken. A child could finish
every delivery with "left plate to the left table" or "first bell to the first
customer" without understanding a single answer — which breaks the governing
rule that the NPC's English must be information the player needs. Now the food
named in the answer is the only reliable link between a dish and its customer.

## 2026-09-11 — The turnaround fallback offers every answer, not one

In the turnaround the child answers "I like ___." for themselves. The HUD
fallback (`configureTalk({ choices })`) now shows one read-along button per
answer, and the one the child taps is what gets saved.

Previously the fallback read out a single fixed sentence ("I like curry.") and
saved its word as the child's answer. Every child in a mic-free classroom was
recorded as liking curry, and the hub then told them so — the one moment the
game claims to have heard the child, and it was false. The fallback still never
removes the English: the child reads a complete "I like ___." sentence along
with the audio. They just get to choose which one.

## 2026-09-11 — Kenney characters are never tinted; the first hub waits briefly for them

Two avatar fixes, both found in playthrough screenshots.

Tint: character tinting multiplied a colour over every material. Kenney models
are a single textured atlas, so a light-blue tint turned skin grey-green along
with the clothing and the child's own avatar looked like a zombie. Textured
materials are now left untouched; the cast is told apart by model, and only the
untextured fallback body is tinted.

Preload: character assets were deliberately kept off the startup path, so the
first hub always spawned the procedural fallback body and the avatar turned into
a different character after the first minigame. The first hub now waits up to
2.5 s for the models. The cap keeps the original guarantee — a slow classroom
connection still starts the game on the fallback body rather than hanging.

## 2026-09-11 — Character facing convention, and one avatar key

Kenney blocky models face +z at rotation 0. Movement heading is
`atan2(move.x, -move.y)` — forward (W) moves toward -z — turned the short way
round. An NPC who should face the camera or the room uses rotation 0, or an
angle toward whatever it should look at.

The first build assumed the opposite everywhere. The avatar walked backwards in
the hub and the Restaurant, customers sat with their backs to their own tables
(in chairs built backwards to match), and the host and the placeholder NPC faced
the back wall — so the child never saw the face of the person they were talking
to. Confirmed with screenshots of the avatar walking toward and away from the
camera. Every future minigame should follow this convention.

`characters.playerModel` is the one avatar key. Model keys are the bare letters
`a`–`r`; the hub had asked for `character-a`, which silently fell back to a
random model, so the child's avatar changed between screens and sessions.
`chooseKey` now accepts the file-name form and warns on a genuinely unknown key.

## 2026-09-11 — Each vocabulary item defines its own answer sentence

`src/config/lesson.js` holds vocabulary as `{ id, answer }` objects with the
exact spoken and displayed sentence: "I like hamburgers.", "I like elephants.",
"I like curry." Games use `answerFor(lesson, id)` and `answerChoices(lesson)`.

Rejected: building answers as `"I like " + label`. Singular and plural cannot be
inferred safely from a label (curry, sushi, noodles, hamburgers, lions). The
matcher accepts either form from the child. A test round-trips every NPC
sentence through the matcher to its own id, which also catches the lesson and
matcher tables drifting apart — it found that "baseball" matched "basketball".

## 2026-09-11 — The matcher picks the closest answer

`matchAnswer` now returns the answer heard at the smallest edit distance, not
the first answer inside the fuzz range. Similar vocabulary sits within each
other's range ("baseball" is two edits from "basketball"), so first-match
recorded the wrong word. Fuzz and variant tables are unchanged.

## 2026-09-11 — Listening again earns no penalty; first-listen memory is a bonus

Replaces the Restaurant's star deduction for asking again. A delivery made after
hearing the order only once earns a memory bonus; asking again forfeits only
that bonus, so a replayed order can still reach full normal credit and three
stars. Asking again is support, not failure (SPEC section 3).

The control moved off the main interaction: `src/ui/listenAgain.js` is a small
secondary 🔊 button, reachable with Tab, never bound to Space. It used to be the
big primary button on Space whenever the child stood by a cooking order, which
invited habitual presses. A mouse or touch press releases focus so the next
Space still acts; and `input.js` now lets movement keys through a focused
button — a clicked button used to freeze the avatar.

Deliberately minimal until classroom behaviour has been observed.

## 2026-09-11 — Shared speech prompts, and `transitions` in the minigame context

`src/systems/speechPrompt.js` (`promptQuestion`, `promptAnswer`) replaces the
`configureSpeech` block every minigame had copied from the placeholder, before
Coloring made a third copy. Game policy stays in each minigame.

The minigame context gains `transitions`, so a minigame can wipe between its
own screens (Coloring: 3D room -> 2D canvas -> 3D room). It is additive; the
rest of the frozen interface is unchanged.

## 2026-09-11 — Anti-shortcut rule added to SPEC

SPEC now states that no minigame may be reliably solvable through fixed
positions, sequence, timing, visual cues or other non-language shortcuts, and
every review must ask "Can a child consistently succeed without understanding
the NPC's answer?" Prompted by the Restaurant review, where dish placement and
bell order let children ignore the English.

## 2026-09-11 — Coloring v1 randomizes the two facts independently

Coloring chooses the NPC's favourite from red, blue, and yellow independently
from the starred body, arms, or visor region. The free regions have no target
colours, the neutral star carries no colour information, and the palette starts
with no selection. This keeps the spoken answer as the only reliable way to earn
maximum credit while preserving creative freedom everywhere except the star.

Rejected: fixed colour-to-region pairings, prescribed colours for the free
regions, or a preselected swatch. Each creates a position, elimination, or
default-selection shortcut that can replace listening.

## 2026-09-11 — Coloring uses one brush geometry for pixels and scoring

The visible canvas and the coarse 72 by 72 scoring grid are painted by the same
interpolated round stroke. The grid is authoritative for coverage, starred-colour
accuracy, and a two-cell overshoot margin; the bitmap is presentation and the
texture later hung in the Art Room.

This avoids device-resolution-dependent scores and makes fast Chromebook
trackpad strokes continuous without introducing a fill tool. The 2D screen is
built and removed under the shared opaque wipe so the room and canvas never
appear together in a partially constructed state.

## 2026-09-11 — Drink Stand v1: fixed stand, walked work area, costly guessing

Drink Stand uses a fixed camera over a three-row stand (customers at the top,
the avatar in the middle, six large stations at the bottom). The avatar walks
inside a small work area with the usual WASD and proximity actions, and
clicking a station or customer walks there by itself, so trackpad-only play
works. Rejected: a pure menu/cursor selection, which would make the stage 2D in
all but name, and free exploration, which SPEC rules out for this stage.

Guessing cannot be removed without dead ends, so it is made costly instead: a
wrong serve loses the first-try credit that dominates scoring, the customer
declines without repeating the English, and under half first-try serves caps
at two stars. Drinks are independently random per customer with repeats
allowed (no elimination), and the station order is shuffled per session.
Patience pauses while the child is speaking.

## 2026-09-11 — Drink Stand keeps transient order speech separate from replay support

The customer's English answer appears only in the shared spoken dialogue bubble,
which closes after a short beat. Its inline replay affordance is hidden in this
minigame; the only replay route is the shared secondary listen-again button shown
while the child is beside that customer. This ensures every replay is recorded for
the memory bonus without leaving an order ticket or an untracked replay shortcut.

Patience meters use projected DOM bars anchored above the 3D customers. At the fixed
Chromebook framing this keeps the generous timer legible at both target resolutions,
while customers waiting in the overflow line have no meter and lose no patience.

## 2026-09-12 — Drink Stand serving spots sit beside each window

The fixed camera looks over the avatar's back, so a serving spot directly in
front of a window put the avatar between the camera and the customer, hiding
the face and the "I like ___." bubble. Each spot is now offset to the side of
its window, the customer-side counter is lower, and customers are scaled up so
head and torso clear it. The overflow line stands on the customer side of the
counter and is ignored by clicks, so it can never block a station.

## 2026-09-12 — Sports v1: wrong zones cost first-try credit, sports may repeat

MODIFIED from the original plan, where a wrong zone had "no penalty". That
let a child walk the followers through all four zones until everyone joined,
which is reliably solvable without the English. A zone where no follower's
sport matches now costs every current follower their first-try credit, the
dominant scoring term, and under half first-try caps at two stars. It is still
never a dead end.

Also MODIFIED: followers' sports are independent and may repeat, instead of
"different sports" at L2/L3, because guaranteed-distinct sports let the last
follower's sport be found by elimination. Any matching follower joins on
entering a zone, so the child plans a route across two or three remembered
answers. Route efficiency is expressed through the same first-try term rather
than a separate distance score.

## 2026-09-12 — Sports keeps destinations readable and followers unlabelled

The four sport zones use a session-shuffled corner assignment, large illustrated
English signs, distinct ground colours, and sport-specific silhouettes. The signs
face the camera so they remain readable on a 1366×768 Chromebook, while the goal,
hoop, backstop, and net preserve spatial identity even when a sign is edge-on.

Friends use independently selected, untinted Kenney models and random plaza spots.
They carry no equipment, badge, colour, or persistent answer marker. A moving trail
history spaces multiple followers behind the avatar, and waiting friends have no
collision, so a face or speech bubble is not hidden because another character has
become a blocker.

## 2026-09-12 — Sports turnaround ends by joining the child's chosen zone

The coach asks from the solid floor of the last visited sport zone in a close,
grounded two-shot. After the child answers, the avatar runs to that sport's shuffled
zone and briefly joins the play animation before the result is saved. This makes the
turnaround answer visibly consequential instead of ending on a speech form alone.

## 2026-09-12 — Speech bubbles balance their lines and keep Japanese phrases whole

The shared dialogue bubble now uses `text-wrap: balance` and
`word-break: keep-all`. Previously it could strand one word on the last line
("What sport do you / like?") and split Japanese mid-word ("いっし / ょに"),
because Japanese has no spaces for the browser to break on. The UI strings
already put spaces between phrases, so keep-all breaks only there;
`overflow-wrap: anywhere` stays as the guard against a single overlong token.
Coloring solved this locally for its result title; the Sports review showed it
belonged in the shared bubble.

## 2026-09-12 — Zoo v1: the camera holds one photo, and nothing points the way

The child's camera keeps a single photo; a new shot replaces it. Without that,
the obvious shortcut is to photograph all six animals and show them to the
visitor one by one, which wins without understanding the answer. With it, every
extra attempt costs a walk back to a habitat, and showing the wrong animal also
loses the dominant first-try credit. The zoo still never becomes a dead end.

Habitat positions stay fixed, as a real zoo's would, because knowing where the
pandas live is not a shortcut — which animal is wanted is what the sentence
carries. For the same reason there is no arrow, marker or minimap pointing at
the wanted habitat: that would replace the English entirely. Orientation comes
from a single looping path, landmarks and signage instead.

## 2026-09-12 — Sports: camera behind the avatar, zones on the axes

User feedback after playing: the controls felt awkward. Two causes, both
layout. The follow camera sat off to one side (offset x 8.8), so pressing
forward moved the avatar diagonally across the screen; it now sits directly
behind, as in every other minigame. The four zones sat on diagonal corners, so
reaching one meant holding two keys; they now sit straight ahead, behind, left
and right of the plaza, which makes each zone one key away and still shows all
four signs at once.

## 2026-09-12 — Zoo photography uses the rendered scene as the keepsake

The viewfinder evaluates the same procedural animal objects that the child sees
in the zoo, using their projected bounds for a forgiving centre-and-size score.
The shutter is disabled until a subject is both visible and large enough, then a
small crop of the rendered scene is saved as the one carried photo. This keeps
the viewfinder, recognition silhouettes, scoring and stamp-book reward tied to
one source of truth while keeping the stored data URL modest.

The normal camera stays world-aligned directly behind the avatar's starting
forward direction, matching the movement convention already validated in the
Restaurant and Sports. Dialogue and the final turnaround temporarily use a
side-on two-shot over the plaza floor so neither character nor speech bubble is
hidden by the other.

## 2026-09-12 — Zoo: the shutter is never lit unless it can actually shoot

Two bugs found by playing the Zoo, both fixed. Framing state persisted between
photos, so during the wipe that opens the viewfinder the shutter was already
enabled with the previous shot's judgement; a press then hit takePhoto's phase
guard and did nothing. Framing is now reset when the viewfinder opens and
closes, so the button is lit only when a press will really take a picture. The
ready threshold also has hysteresis (ready at 0.38, stays ready until 0.30) and
a short grace window, because the animals wander and a frame hovering at the
threshold made the shutter blink on and off under the child's finger.

Habitat signs were double-sided planes, so the lettering appeared mirrored from
behind — backwards English across the zoo. Signs now render their text on the
front only, with a plain board behind them.

## 2026-09-12 — The shell lends its canvas for one frame: ctx.captureFrame

The Zoo's photos saved blank. A WebGL drawing buffer is empty once the frame is
composited, so copying `#game-canvas` from a click handler yields nothing. The
minigame context gained `captureFrame(draw)`: the shell renders the scene once
and calls back with the canvas in the same task, while the pixels are still
readable.

Rejected: `preserveDrawingBuffer: true` on the renderer. It would make canvas
reads work anywhere, but every minigame would pay for it on every frame of every
session on a classroom Chromebook, for a feature only the Zoo uses.

## 2026-09-12 — Zoo animals follow the models we actually have

The zoo's six animals change from elephant, lion, panda, monkey, giraffe,
penguin to elephant, giraffe, penguin, tiger, dog, cat. The user supplied real
3D models, and those cover only three of the original six; a lion, panda and
monkey do not exist in the set. Rather than run a zoo where half the animals are
detailed models and half are procedural blocks, the vocabulary follows the
assets so every habitat holds a real animal.

The target grammar is untouched: it is still "What animal do you like?" and
"I like ___." with six countable animals, and dog and cat are words Japanese
third graders meet early. Rejected: keeping the old list and dressing a tiger as
a lion, which teaches the wrong word for the picture on the sign.

## 2026-09-12 — Zoo models scale by animal and load behind placeholders

Each real animal is measured from its loaded bounding box, centred horizontally,
and grounded from the measured minimum Y. This handles the elephant's centred
origin without a special-case lift and keeps replacement assets from inheriting
hand-written offsets. Target heights are 3.65 for the giraffe, 2.45 for the
elephant, 1.65 for the tiger, 1.55 for the penguin, 1.05 for the dog and 0.72
for the cat. The deliberately per-animal targets restore believable relative
scale while fitting inside the existing fences. The photo target is the placed
bounds centre and its radius is half the largest horizontal extent.

The Zoo builds immediately with a simple, photographable placeholder in every
habitat, then loads the three supplied glTF files asynchronously and swaps in
clones that share each source's geometry and untouched textured materials. A
failed or slow file leaves its placeholders usable, so loading never blocks the
lesson. Each Zoo instance owns and disposes its glTF sources, and late loads are
aborted or discarded on exit so re-entering cannot attach duplicate animals.
Animals keep a grounded, gentle wander while their +z-facing models stay turned
toward the visitor path. The existing boards stay path-facing but sit toward one
fence edge, with the animals idling slightly toward the other, so the real
silhouettes and their English signs remain visible together from the loop.

## 2026-09-12 — Skinned glTF animals must be cloned with SkeletonUtils

Five of the six zoo animals are skinned meshes (all four taken from
`Animals.glb`, plus the giraffe). They were instantiated with
`Object3D.clone(true)`, which copies meshes but does not rebind their skeleton,
so each one kept rendering from the source rig near the file's origin: the tiger
stood out on the grass and the dog, cat and penguin never appeared in their pens
at all. They are now cloned with `SkeletonUtils.clone` from three's own examples
— no new dependency.

The elephant is the exception: it has no skin, no texture, and three materials
all set to the same flat 0.8 grey, so it blew out to a white blob under the
zoo's lights. Its materials are now coloured by name (body, dark, ivory tusks).
Tinting is safe here precisely because the model carries no texture — the
opposite of the Kenney rule, where tinting a textured character turns its skin
grey.

## 2026-09-12 — Seven zoo animals, and none of them pets

Dog and cat were wrong for a zoo, so the zoo now teaches seven animals:
elephant, giraffe, penguin, tiger, deer, horse and alpaca. Deer and horse were
already sitting unused inside `Animals.glb`, so they cost nothing and match the
tiger and penguin exactly; the alpaca comes from `animalz.zip` as a rigged,
self-contained glTF whose materials are already distinct browns.

Seven is not a problem: colours already teach seven words. "deer" also earns its
place as the clearest case of the vocabulary rule — its plural is "deer", which
no amount of label inference would produce, so the item defines the sentence
"I like deer." itself.

The seventh pen sits in the gap on the loop at (15, -6), about ten units from
each neighbour, so no fence or sign overlaps another.

## 2026-09-12 — Zoo OBJ animals load through their colour materials

Fox, wolf, stag, bull, cow, donkey and the replacement white horse load from
their OBJ files after the matching MTL has loaded, and OBJLoader receives that
material library so the textureless models retain their per-part Kd colours.
They are static meshes, so ordinary deep clones are sufficient; SkeletonUtils
remains mandatory only for the potentially skinned glTF animals. Both formats
share the same measured placement and placeholder-first failure path, and their
source geometry and materials are owned and disposed by each Zoo instance.

The OBJ versions are deliberate: all seven total 779 KB instead of 21.9 MB for
the equivalent glTF files, and the Zoo moves whole animal groups rather than
playing the pack's animation clips. A failed or aborted MTL or OBJ fetch leaves
the photographable placeholder and cannot attach a late model after exit.

## 2026-09-12 — Thirteen habitats use a larger single loop

Thirteen habitat centres are evenly measured around a 33 by 28 ellipse with a
100-degree entrance gap. Neighbouring centres stay at least about 10.6 units
apart, clearing the 3.45-radius floors, fences and offset signs. The continuous
path grows to a 29.4 by 24.9 ellipse with 144 overlapping slabs; the plaza,
fountain, tree, gate and waiting visitors move together so the plaza remains
tangent to the southern loop mouth. The ground grows from 42 by 38 to 100 by 96
and the movement limit from about 25 to 41.

The longer plaza-to-farthest-habitat distance is about 2.2 times the old one,
so walking speed rises from 6 to 13.5. Crossing the expanded zoo therefore
takes no longer even though exploration now offers nearly twice as many pens.

## 2026-09-12 — New Zoo animals keep believable measured heights

All animals continue to derive a bounding box after loading, scale uniformly
from its measured height and sit on the ground from its measured minimum Y.
The replacement white horse targets 2.2 units; fox 1.05, wolf 1.35, stag 2.45,
bull 2.35, cow 2.2 and donkey 1.9. These targets account for the source OBJ
heights ranging from 2.69 to 5.37 units without trusting their inconsistent
authoring scale: fox and wolf read smaller than horse and bull, stag is clearly
taller than fox, and giraffe remains tallest at 3.65.

## 2026-09-12 — OBJ animals: undo MTLLoader's second colour conversion

The Quaternius OBJ models arrived far too dark: the white horse rendered grey,
the fox maroon, the cow nearly black, while the glTF animals beside them looked
right. Their .mtl files carry Blender's LINEAR Kd values (Horse_White's coat is
0.354, which is about 0.63 in sRGB), but MTLLoader interprets Kd as sRGB and
converts it down to linear a second time, roughly cubing the brightness.

Each parsed material's colour is now converted back with
`convertLinearToSRGB()`, so the value that reaches the renderer is the value the
file specified. Rejected: hand-tinting each material, which would have to be
redone for every model added and would hide the real cause.

## 2026-09-12 — The zoo shutter prefers the pen the child is standing at

`evaluateFraming` chose whichever habitat framed best anywhere in view. With
seven pens that was invisible; at thirteen, a photo taken at the ALPACA fence
came back a horse from the neighbouring pen — and the visitor then refused it,
punishing a child who had understood the English perfectly well.

Framing is now scored with a small distance penalty (`framing - min(.3, away *
.012)`), so the nearest pen wins ties and near-ties while a deliberately distant
shot that is genuinely better framed still wins. The readiness threshold still
uses the raw framing score, so what counts as a good photo is unchanged.

This takes nothing from the anti-shortcut rule: the child must still know which
animal was asked for. It only makes aiming honest.

## 2026-09-12 — Speaking is protected time, and one service clock enforces it

Every minigame with service pressure now pauses that pressure while a speech
interaction is open: all patience meters, preparation, spawning, queue
promotion and the rush, not merely the customer being spoken to. A sentence
that needed two recognition attempts must not cost twice the service time of
one that worked first try; classroom recognition noise is the game's problem.

The mechanism is deliberately structural rather than a guard at each timer:
`src/systems/speechFocus.js` reports a focus scale, and each minigame keeps a
**service clock** advancing by `dt * focusScale`. Spawns, patience, cooking and
rush all read that clock, so every one of them freezes by construction. A guard
per timer was rejected: the Drink Stand already had one (`if (questionCustomer
!== customer)`) and it is exactly the kind that gets forgotten on the next
timer added — the other windows kept draining while a child spoke.

Rejected polish: moving the camera toward the speaker during focus. Re-framing
is what produced the zoo shutter bug, and it buys nothing a duck of the ambient
mix and a slow-motion world do not already give.

## 2026-09-12 — Restaurant is a memory game, so it never has one customer

Level 1 seated a single customer. With one recipient the only ready dish
obviously belongs to them, so the child could finish without understanding the
answer — the anti-shortcut rule failing at the level where it matters most.
Easy is now three seated customers with one live order: the load is one
person-food pair, but the answer is still needed to place it.

Difficulty rises by memory load and competing demands (4 customers / 2-3 live
orders, then ~5 / 3-4, staggered readiness, several ready dishes), never by
requiring faster or fluent speech. Difficulty happens after the English.

The two service minigames must also stay distinct: Restaurant asks "who said
curry?", Drink Stand asks "where is the milk machine?". Restaurant is working
memory and prioritisation; Drink Stand is recognition and fast production.

## 2026-09-12 — A refused dish stays in hand; the customer stops reconsidering

Wrong deliveries were free, so with three tables walking the dish from person
to person beat listening. Guessing stays possible and stays recoverable, but a
refused customer will not reconsider that dish for a few seconds and the player
must leave their radius before trying somebody else. First-try credit and the
combo are lost; the English answer is not repeated and no food hint appears.

Rejected: requiring the player to carry a refused dish back to the pickup
counter. That turns a listening mistake into a temperature penalty plus a long
walk, punishing the least confident child hardest. The friction exists to make
listening the faster route, not to punish the slower one.

## 2026-09-12 — Hold to fill, forgiving, and never scored

Pouring was "press, wait a second, a cup appears". It is now one hold-to-fill
control identical at all six stations, with each station differing only in
look and sound — six stations, not six minigames.

Fill level never enters the score. A cup past about a third is valid, an
underfilled one can be topped up, and holding past full plays a comic overflow
that is still a valid drink. A "tiny efficiency component" for overfilling was
rejected: it creates a pouring-skill axis competing with listening, and a Grade
3 child cannot tell why their stars dropped. A short tap on the on-screen
action latches the fill to full, so the trackpad-only child is not worse off
than the keyboard child.

Drink counts drop from 6/7/8 to 5/5/5-6. Asking one question eight times is
repetition, not practice.

## 2026-09-12 — Restaurant foods are independent; a dish is matched by food, not by plate

Foods were dealt `shuffled(LESSON.answers)[index]`, one each, no repeats. With
five foods that was invisible at one or two customers and fatal at five: every
food appears exactly once, so the last order is deducible without listening to
it, and a child can rule foods out as they go. The anti-shortcut rule names
elimination directly, and Drink Stand already forbids it.

Each customer's food is now independent and uniform, repeats allowed. The
consequence that had to be solved with it: two identical plates must not create
an unfair delivery. So a ready dish is matched by **food**, not by plate
identity — either curry satisfies either curry customer. That is fairer than
binding a plate to a person and is less state, not more.

## 2026-09-13 — The Restaurant camera frames the room, and stops following the waiter

The follow camera (offset `[0, 8.5, 10.5]` behind the player) pushed the front
tables off the bottom edge whenever the child stood at the pickup counter. At
three customers that was survivable; at five, with a raised hand as the only
signal that somebody wants to order, a customer could be asking for service
from off-screen. That breaks the mechanic the redesign is built on — choosing
who to serve next is impossible when the demands are not all visible.

The dining room is small enough to frame whole, so it now is: a `fixed` preset
at `[0, 11.5, 12]` looking at `[0, 0.8, 0.6]`. All five tables, the counter,
the bell and the host are on screen at 1366x768 at every level, and nothing the
child must react to can hide. The turnaround still cuts to its own closeup.

Rejected: an off-screen arrow indicator, which adds HUD clutter to solve a
problem the room's own size makes unnecessary; and keeping the follow camera
with a wider offset, which still loses corners as the player moves.

## 2026-09-13 — Playthroughs are project commands that own their own lifecycle

Acceptance runs used to be a manual three-step job: build, start `vite preview`
on some port, then run `node scripts/playthrough-<x>.mjs URL PREFIX`. That made
every delegated brief carry raw `npx vite preview` instructions, scattered
screenshots as loose prefixed files, and depended on `playwright` resolving from
the parent `recipe-tester/node_modules`. That last part is why a sandboxed
worker (whose writable root is this project) could not run the playthrough at all.

Now `playwright` is this project's own dev dependency, and
`npm run playthrough:<scenario>` runs `scripts/playthrough-run.mjs`, which starts
the preview, waits, runs the scenario, always stops the preview, and exits with
the scenario's status. Each run writes only `.tmp/playthrough/<scenario>/` plus a
`manifest.json` naming that run's screenshots, so nobody has to list a directory
of old artifacts. The preview is spawned as `node node_modules/vite/bin/vite.js`,
not through the `.bin` shim: on Windows the shim needs a shell, and killing that
shell left vite orphaned and still listening (observed on the first run).

The scenario scripts are unchanged. `selftest-pass` / `selftest-fail` exist so
the runner can show it reports both outcomes without touching a real scenario.

Rejected: widening the worker sandbox to the parent directory (it grants far
more than one dependency needs), and a second browser framework.

## 2026-09-13 — Service revision checks: overlap that really happens, and a fill you can see

Found by playing the built game at 1366x768, not by the unit tests.

- **Restaurant budgets sit at the top of each SPEC range: Normal 3, Challenge 4.**
  The budget was drawn per session and counts a raised hand as well as a taken
  order, so a drawn 2 could never hold "one cooking, one ready, one waiting to
  order" at once and Normal played close to one-at-a-time. Easy stays 1. Rejected:
  keeping the random draw, which bought nothing and failed the overlap that level
  exists for in roughly half its sessions.
- **A raised hand can be answered with a dish in hand.** Walking up to it takes
  the order. It used to count as a wrong delivery — refusal, combo reset, lost
  first-try credit — punishing exactly the "deliver this now, or take that order
  first?" choice SPEC 4 is built around. Customers without a raised hand still
  refuse a dish, as before.
- **Click-to-walk steers around a table lying across its straight line.** From a
  front table to the counter the line ran through a back table and the avatar
  stalled there for good: at Challenge three dishes waited about forty seconds
  while customers gave up. A trackpad-only child simply stopped.
- **The Drink Stand fill is shown as a large glass beside the controls**: the
  drink's colour rising, a dashed line where the cup becomes valid, a check once
  it is, a gold rim when full and a wobbling spill past it. The 3D cup is a few
  pixels in the avatar's hands at 1366x768, so the fill was forgiving but not
  visible. It is still feedback only and never scored. Good-news notices (valid,
  full, overflow) are green and the top-up hint is blue; all of them used the red
  of a problem, which made a playful overflow read as an error.
- **ラッシュ！ sits over the floor band, not the windows**, where it covered the
  customers and patience meters a child needs to watch during the rush.
- **A click-to-walk opens a talk prompt only for the customer it is walking to**
  (Drink Stand and Restaurant). Walking to a far window passed a neighbouring
  unasked customer, whose prompt opened on the way; a tap on it was cancelled
  when the walk carried the child out of range and the prompt jumped to the
  chosen customer, because re-targeting hides the HUD and cancels a read-along
  in progress. The answer silently vanished and the prompt reopened. Proven with
  a debug trace (prompt for customer 3, walk target customer 2), after a first
  guess — keeping the prompt while still in range — did not cure it; that guard
  stays as a secondary protection. Keyboard walking still opens prompts by
  proximity. The pattern predates this revision; two and three live windows
  made it frequent.
- Drink Stand level 3 keeps five customers, not six: the last-three rush already
  fills all three windows and still reads as a finale.

## 2026-09-13 — Rush-hour revision: service shifts run by a director (DECIDED, not yet built)

Both service games felt like one small errand after another. The revision makes
them busier without touching the English. Decisions taken on the owner's plan:

- **Accepted — shifts, not fixed lists.** A session is bounded by a customer
  total, not a clock, because speech focus freezes time and the total keeps
  askings bounded. Restaurant 5 / 7 / 8 customers over 3 / 4 / 5 tables with
  replacement customers (new independent food each time). Drink Stand 5 / 6 / 7
  customers (every one a real asking, no filler) over 1 / 2 / 3 windows.
- **Accepted — a small pure director per game** (`restaurant/director.js`,
  `drinkStand/director.js`, each tested with an injected RNG), advanced only by
  the service clock so speech focus freezes it by construction. Phases: warm-up
  (~18 s service time, at most two demands) → rush → final push (Restaurant:
  ラストスパート！ cue once the last customers are seated; Drink Stand: the
  existing ラッシュ！ becomes a real phase with fast arrivals and a longer line).
  It staggers hands (settle 1–2.5 s), spaces bells, holds new discrete events
  ~0.8 s after focus ends, and keeps Normal/Challenge from going serial.
  Deliberately NOT a shared abstraction between the two games.
- **Accepted — feel:** louder two-tone bell, visible walk-in/walk-out, arrival
  chimes, phase cues, combo, and `audio.setFocusDuck()` (added) ducking effects
  to 25% while focused; TTS is unaffected.
- **Modified — progress, not timers.** A small served/total counter; no
  countdown.
- **Rejected — the Challenge two-dish tray.** A carry-slot state machine and
  delivery ambiguity; flow matters more. Revisit after classroom observation.
- **Rejected — continuous ambience and footstep sounds.** In a classroom,
  speaker sound bleeds into the microphone during recognition.

## 2026-09-13 — Dwell to talk in the service games (DECIDED, not yet built)

Holding a button for every customer broke the "run → stop → speak → run" rhythm
the rush revision is after. In Restaurant and Drink Stand a conversation now
starts when the child stops in range, faces an eligible customer (±55°) and
stays still for 1.2 s; hold-to-talk stays as the manual fallback, the mic-free
fallback opens after the dwell. Logic lives once in `src/systems/talkDwell.js`
(pure, tested) with timings in `src/config/interaction.js`; the speech system
gains a bounded programmatic `listenOnce()`.

- Speech focus starts at the **commit**, not at the radius: dwelling costs a
  moment of service time, and that moment is the child's own choice.
- **Rejected: the camera ease-in.** It contradicts two standing decisions — the
  Restaurant frames the whole room so no raised hand can hide, and camera
  re-framing produced the zoo shutter bug. The customer turning toward the
  player, a progress ring and a ready chime carry the same meaning.
- **Added: no mid-game permission popup.** The mic opens automatically only if
  permission is already granted or a hold has worked this session; otherwise
  the commit leaves the ordinary hold control waiting.
- **Added: no reopening loop.** A failed or cancelled attempt disarms the dwell
  until the child moves or leaves the radius, then a 1 s neutral pause.
- **Modified: an internal switch, not a settings toggle.** `AUTO_TALK_ENABLED`
  restores proximity prompts; a user-facing setting waits for Chromebook
  evidence.
- **The owner explicitly authorised relaxing "press-and-HOLD to talk"** for
  this. That rule was inherited from esl-time's speech port (child-controlled
  listening, no mic hearing the game's own voice, never an unknowingly open
  mic); each automatic session stays one bounded attempt the child chose by
  stopping. Known classroom risk to check on a real Chromebook: a neighbour
  saying the same sentence during an automatic session could be accepted for a
  silent child — more chances than with a hold.

## 2026-09-13 — Restaurant Challenge gains a rival waiter

Challenge gains one deliberately limited rival waiter; Easy and Normal remain
exactly as they are. The purpose is readable competition and prioritisation,
not taking English practice away from the child, so Challenge grows from 8 to
11 total customers and the rival may claim at most 3. Progress counts every
customer resolved by either waiter or by leaving, while `playerServed` and
`rivalServed` are separate comparison data. Rival service never contributes to
or reduces the player's stars.

Ownership is permanent for the life of a seated customer: `null`, `player`, or
`rival`. A replacement starts unclaimed. The player temporarily reserves one
customer when a locked dwell starts and claims them when conversation commits;
manual hold or fallback opening reserves and commits at that same trigger.
Cancelling a dwell or talk before commit releases its reservation, while
click-to-walk alone does neither. The rival announces a target, walks there,
and claims only on arrival if the customer is still unclaimed and unreserved.
It abandons a target the player reserved or claimed on the way. Neither waiter
can take an order owned by the other.

The rival is a pure injected-RNG state machine, advanced only by the service
clock: idle, choose, walk to customer, take the order, walk to its pass, wait,
carry, deliver, then idle. It prioritises its own ready dish, otherwise the
oldest eligible raised hand after a minimum 4-second hand age. Its walking is
distance-based at 75% of player speed, order-taking takes about 1.2 seconds,
ordinary transitions have 0.3–0.9 second hesitations, and a lost target causes
a 0.6–1.2 second pause before re-choosing. Its events and walk positions are
data; the controller continues to own all scene objects.

Rival dishes use the same food-owned prep times but exist only at a separate
rival pass. The rival never touches player dishes, player counter slots, or
player-owned customers. Independent food selection and repeats still apply
across both waiters. Customer patience still applies after a rival claim, and
a departure makes the rival abandon that task.

The player's live-order budget counts only player-owned unresolved orders plus
unclaimed raised hands, including a player-reserved hand. Rival-owned customers
do not consume it, preserving Normal's limit of 3 and Challenge's limit of 4.
The registry and rival read service delta only, so speech focus and recognition
retries freeze them structurally, and new rival claims honour the existing
0.8-second post-focus hold.

Added in acceptance: **a saturated player no longer freezes the room.** Hands
were gated by the player's live-order limit, so a child holding four orders
stopped every new hand and the rival stood idle exactly when the restaurant was
busiest. While the rival can take a customer (under its cap and not already
serving one), one extra hand may rise above the player's limit outside warm-up.
A child may still take that hand, so Challenge can briefly reach five live
orders; a rival idling beside waiting customers read worse than that stretch.

Part 2 integration keeps the comparison and scoring surfaces separate. Shift
progress comes from the ownership registry, while the existing Restaurant score
records contain only the child's work, so a rival delivery can neither award nor
remove a star. The rival's pass dish is a separate scene object with no counter
slot or interaction metadata. Rival customer endpoints are aisle-side approach
points; the character steers around tables over the model's exact walk duration,
with the rendered speed constrained to stay close to the modelled speed. The
Challenge score remains visible through round-end and turnaround as its plain
final result; Easy and Normal do not create any of this rival UI or scene state.

Rejected:

- **The two-dish tray remains deferred.** Its carry-slot state machine and
  delivery ambiguity still add complexity without pedagogical gain.
- **Rival footsteps and continuous ambience.** They add classroom microphone
  bleed without useful information.
- **A bell for rival dishes.** The Restaurant bell means *your* food is ready;
  sharing that cue would make it ambiguous.
- **Food labels above claimed customers.** They expose the remembered answer
  and defeat the Restaurant's working-memory mechanic.

## 2026-09-13 — Speech bubbles never block a click on the room

NPC answer bubbles float over the 3D world and captured every pointer event,
so a click on a customer sitting behind a fresh "I like hamburgers." bubble did
nothing for about 2.5 seconds — a trackpad child simply could not reach the next
raised hand, and a scripted run proved it (`elementFromPoint` hit
`.npc-dialogue__line`). The bubble is now `pointer-events: none`; only its
replay button takes the pointer. Applies to every minigame, all for the better.

## 2026-09-13 — The Zoo becomes a small campus (DECIDED, not yet built)

Thirteen pens on a radius-33 ring read as an animal-selection board. The Zoo is
rebuilt as a compact campus (SPEC §8 "Campus"): entrance plaza, central
fountain, Savanna / Forest / Farm / Penguin Cove regions, an irregular
figure-eight of broad paths, signposts and a YOU ARE HERE board.

- **Accepted** from the owner's plan: themed region kits, a closer follow camera
  so the zoo spans several screens, simple collision, CC0 environment assets
  (imported with a provenance README; textures cut to 512 px), equal-listing
  signs and map, visitor-specific Listen Again.
- **Accepted — one photograph is one delivery attempt.** A wrong photo used to
  stay in hand, so one photo could be shown to every waiting visitor until one
  accepted it. Now it is consumed either way.
- **Modified — region names on signs are Japanese, animal names English.** The
  interface stays Japanese; the vocabulary word stays English, as at the Drink
  Stand stations.
- **Modified — Challenge 6 → 5 requests.** The campus adds walking; six askings
  is repetition.
- **Modified — travel measured, capped at ~10 s entrance → farthest habitat** at
  the existing walking speed, instead of 5–8 s per leg, which would need a far
  larger world.
- **Added — the world exposes a path graph and a photo viewpoint per habitat**
  from a pure layout module, so tests can prove reachability and no dead ends,
  and scripted runs can route instead of walking straight into fences.
- **Added — Penguin Cove sits far from the giraffe**, which also removes the
  intermittent neighbouring-pen shutter misfire between those two.
- **Deferred** — a click-to-enlarge map (the in-world board comes first).
- **Build order**: layout and navigation first (placeholder dressing), then
  asset dressing, then the gameplay rules — three sequential orders.

## 2026-09-13 — Restaurant replacement staging details

Served customers eat for 3.2 seconds of service time before walking out. New
customer looks cycle through model/tint pairs rather than either list alone:
simultaneous occupants stay distinct, and a reused table never immediately
gets the same-looking customer even when the five base models wrap.

## 2026-09-13 — Zoo campus placement and camera

The built campus keeps the entrance plaza at the south (`z = 31`) and the
fountain hub one short path north, with Savanna and Forest on the west lobe,
Farm on the east lobe, and Penguin Cove at the far north-east. The follow camera
uses a world-aligned 10.8-unit back / 8.6-unit high offset: close enough for a
bend to reveal a new area while preserving forward movement up the screen.

## 2026-09-13 — Zoo photos must actually show the animal

- **Signs live in layout.js** beside each viewpoint spur, outside the
  viewpoint→habitat sightline (tested), about a third smaller than before, and
  carry two single-sided lettered planes back to back — no blank backs, no
  mirrored English. Previously each sign stood on the fence edge in the
  sightline and hid the animal.
- **Framing readiness ignores hidden animals.** Five sample points on the
  animal are raycast from the camera against opaque scenery (signs, barn,
  bridge, pool rim); at least 60% must be clear. Fence rails do not count —
  the animal is seen between them. A green frame over a sign-covered alpaca
  taught nothing.
- **Framing measures width and height separately.** The old square estimate
  used width only, so tall narrow animals (penguin, giraffe, alpaca) never
  counted as framed and a distant cow won the penguin shot.
- **The viewfinder zooms and sits close.** While aiming (avatar hidden) the
  camera is 3.8 units behind the player at height 3.4 with a 34° field of view,
  restored to the follow camera's on close and on exit. Previously it was 7.6
  back, 4.1 high at the shared 48°: from their fence viewpoints the slim animals
  (fox, penguin, alpaca, wolf, donkey) were centred and unblocked yet too small
  to count as framed, and stepping closer is blocked by the fence. Zoom was
  chosen over moving viewpoints (the fence leaves no room) or lowering the size
  gate (a tiny animal is not a good photo); it also keeps neighbouring pens and
  the nearby sign out of most shots.
- **The viewfinder camera never sits behind a sign or building.** If a photo
  occluder lies between the camera and the player, the camera slides along its
  sightline to just in front of it. The layout test only clears the
  viewpoint→animal line, and the camera stands behind the player: the deer
  sign, behind its viewpoint, intermittently filled the deer shot.

## 2026-09-13 — Zoo animals stand still, no pen signs, no entrance gate

Owner's decision. The per-habitat name boards (animal icon + English word)
and the red-and-white entrance gate are removed; the Japanese region
signposts and the YOU ARE HERE board stay. Animals no longer wander: models
without an idle clip glided around with frozen legs, so every animal now stands
at its pen centre facing its viewpoint (toward the screen when photographed),
with a per-model half-turn where the source model faces backwards (tiger,
deer, penguin, giraffe). Models that ship an idle clip (alpaca, giraffe) play
it in place.

## 2026-09-13 — Zoo campus dressing stays within a Chromebook budget

Environment sources load once and are cloned only for sparse landmark accents;
repeated bushes, grass, flowers, pebbles and rocks use instancing and shared
materials. The dressing targets no more than about 25 unique environment models,
keeps imported textures at 512 px or smaller, and avoids using the 3.5k–6.3k
triangle tree meshes as a forest substitute.
KayKit's retained 1024 px source atlas is not loaded: its furniture texture
slots are removed before glTF parsing and the café props use flat material colour.

The Quaternius Farm Buildings pack remains behind the same quiet asynchronous
failure path as the other dressing, with a procedural barn fallback, because
its archive contains no licence file. Removing that folder must leave the Zoo
playable; its claimed CC0 status must be confirmed on quaternius.com before a
public release. The unlicensed/heavier fence, hedge-maze, traffic-sign and
unnamed Drive archives, unrelated character packs, and 700–800 KB twisted trees
remain rejected as documented in the environment provenance README.

## 2026-09-14 — Challenge rival look, score pill and five-order stretch accepted

The owner reviewed the Challenge screenshots and accepted them as they are: the
rival waiter (seen from above as a dark figure; its white apron does not show
from the whole-room camera) is clearly distinct from the player, the
`きみ N ・ ウェイター N` pill under the settings button is readable, and the room
reads as a busy lunch rush. The brief stretch where the child can hold five live
orders (the spare hand raised for a free rival is taken by the child) stays;
capping the child at four was offered and declined.

## 2026-09-14 — Restaurant food arrives on a moving conveyor, not a bell counter

The kitchen counter, its bell, the ready cue and the expediter position are
replaced by a continuous conveyor that enters through an opening in the right
side wall, crosses the back wall and leaves through the left wall, under a
MATSUBARA RESTAURANT sign. The child notices food by seeing it move; no
"dish ready" alert of any kind replaces the bell. The identity question becomes
"Curry is going past — who said curry?"

- Supply is demand-count based, not plate-per-customer: for each food, the
  belt must supply (player-owned orders of that food whose prep is complete) −
  (dishes of that food on the belt or in the player's hands). This follows the
  existing rule that any curry serves any curry customer. Rejected: binding a
  belt dish to one customer — duplicates would become unfair and invisible.
- Prep timing survives: the director's per-customer `ready` now means the food
  may enter the belt, so dishes still arrive out of asking order. Each unmet
  unit must enter within a per-difficulty bound; a dish that leaves unmet
  re-enters after a short delay. Missing a dish costs time, never the order.
- Filler is always a food nobody currently needs, never delays a required
  entry, and respects a visible-dish cap (Easy 2 with no filler, Normal 3,
  Challenge 4). Pressure rises through load, not belt speed.
- Temperature is measured from pickup, keeping "cools after leaving the pass".
- The belt surface scrolls from service time, so it keeps running when empty,
  freezes under speech focus and resumes without resetting positions.
- Wrong pickup is recovered at a dish-return tub beside the entry end; it is a
  separate mistake from wrong delivery, whose behaviour is unchanged.
- Added in acceptance: **the dish return never blocks a conversation.** First
  placed at (5.45, -3.55), its radius covered the back-right table's talk spot,
  and with a dish in hand the return action cleared that customer's prompt every
  frame — a raised hand could not be answered, against the rule above. The tub
  moved to (6.0, -3.95) beside the entry opening, and a raised hand now outranks
  the return action, so a future layout change cannot bring the block back.
- The turnaround host (previously standing at the counter by the bell) is not in
  the room during service and appears in the dining room only to ask the
  turnaround question. No kitchen attendant replaces them.
- The Challenge rival never uses the belt: it prepares at its own hatch on the
  left wall, so ownership stays strictly safe without labelling food.
- No looping motor audio is added; the bell sounds are removed and pickup keeps
  a soft plate sound.

## 2026-09-15 — Random belt, shared dishes, and press-to-talk everywhere

Owner's plan, reviewed and adapted (SPEC §3 "Press to talk", §4 Conveyor and
Challenge rival).

- **Accepted — the belt is order-blind.** A shuffled bag of the five foods
  (reshuffled, no repeat across a bag seam) enters at a steady per-difficulty
  interval whatever the orders are. The old demand-driven supply leaked the
  answer twice over: food appeared because someone asked, and "filler" was by
  definition a food nobody wanted. Prep time no longer gates anything the
  player sees. No hidden drought bias: the bag already bounds absence to eight
  dishes (~36 s Easy worst case, ~20 s average).
- **Accepted — dishes are shared, customers are not.** This reverses the
  2026-09-14 "rival never uses the belt" rule, which existed only to keep plate
  ownership safe; with owner-free dishes and customer-owned orders the safety
  comes from the claim registry instead. First pickup wins; the player's pickup
  resolves before the rival's within one update; carried food is untouchable.
  The rival hatch and rival cooking are removed.
- **Modified — rival speed 3.75 → 4.25 (85%)** plus a 0.6 s "must have seen the
  dish" delay. At 75% the rival could almost never win a belt race; the plan
  asked for "about player speed or slightly slower" and "no instant knowledge".
  The share cap (3) and 4 s hand age stay.
- **Accepted — reservation on Talk press, ownership on acceptance.** Previously
  ownership committed at the dwell/hold commit, before speaking. Now a press
  reserves, an accepted question converts, a cancel or leaving range releases,
  and a failed attempt keeps the reservation while the child stays nearby.
- **Accepted — press-to-talk replaces hold and dwell in every minigame.** The
  2026-09-13 dwell (authorised then as a relaxation of hold-to-talk) is
  removed with `talkDwell.js` and `AUTO_TALK_*`; the microphone opens only on a
  deliberate press, which also removes the classroom risk noted then (a
  neighbour's voice accepted during an automatic session).
- **Modified — Enter, not Space, is the talk key.** Space is collect / deliver /
  return at the Restaurant and fill at the Drink Stand, and the belt front lies
  within the back tables' talk radius, so a shared key would open a microphone
  mid-race. The on-screen 🎤 button works identically.
- **Modified — the listening label is Japanese** (● きいてるよ…) with a pulsing ring:
  UI chrome stays Japanese (SPEC §1); the red state plus motion carries it.
- **Added — cancel is not a failure; a failed attempt keeps focus.** A second
  press while listening drops the attempt without advancing the fallback
  ladder. A recognizer that ends without a match keeps target, focus and
  reservation while the child stays in range, so retries stay protected.
- **Added — 8 s safety cap** on a press session (recognizers occasionally never
  fire `onend`).
- **Rejected — the plan's full test matrix and manual play of every minigame.**
  Unit tests cover the pure modules (bag, rival belt competition, claims,
  press-to-talk adapter); playthroughs are updated only enough to use the new
  control and run once; the owner judges targeted screenshots, not free play.
- **Unchanged / deferred:** wrong delivery, dish return, temperature, score
  pill. The Restaurant harness trust work and the tub-over-delivery priority
  stay on the backburner at the owner's request.

## 2026-09-16 — Space talks; any seated customer can be asked; bubbles show ownership

Owner revision plan for the Restaurant, analysed and implemented with changes.

- **Accepted — Talk is Space, in every minigame** (supersedes 2026-09-15
  "Enter, not Space"). Press once, release does nothing, a second press cancels.
- **Modified — speech consumes only presses it handles.** A Space press is
  swallowed when it starts, cancels, falls back or fails into the read-along;
  a refused press (no target, already accepted, reservation refused) still
  reaches the world interact. Repeats and the keyup of a consumed press are
  swallowed too, or a held Space would fire a pickup on auto-repeat.
- **Added — the belt front outranks Talk.** The 2026-09-15 reason for Enter
  still holds geometrically (the belt band lies inside the back tables' talk
  radius), so standing at the belt (z ≤ -4.0) with a pickable dish and no
  clicked/locked customer shows collect and sets no talk prompt. The talk spot
  behind a back-table customer (z -3.7) still talks.
- **Added — the nearest seated customer decides the context.** Unclaimed →
  Talk (even carrying a dish); mine → Listen Again / Deliver. Otherwise a talk
  prompt would make delivery unreachable by keyboard where two tables overlap.
- **Accepted — raised hands, the `?` cue and `orderCue` are removed.** The
  director paces population (arrivals, tables, phases), never permission. The
  live-order limit goes with them. Rejected: keeping `orderCue` as hidden gating.
- **Accepted — patience meters removed.** Patience stays internal and more
  generous (150/140/130 s awaiting); unclaimed customers drain as slowly as
  before (effectively never leave). Late warning below 30%: the customer looks
  around. No icon, ring or countdown.
- **Accepted — ownership bubbles replace the rival badge.** None = not asked;
  white `I like...` with dark text = mine; near-black with white text =
  rival's; none while eating. The full answer shows ~2.5 s and collapses; a
  persistent bubble never names the food. Listen Again reopens it briefly.
- **Modified — rival cap is a share, not 3.** Challenge: round(total × 0.5) = 6
  of 11, 4 s seated-age reaction delay, speed 4.25. `RIVAL_LEVELS[2]` (speed
  3.4, share 0.3, 8 s delay) exists but is **disabled**: whether a rival on
  Normal is too much for Grade 3 needs a classroom playtest, not a harness.
- **Fixed — `promptSpeech` dropped `onCommit`'s return value**, so a refused
  Restaurant reservation still opened the microphone.
- **Rejected — the plan's 32-item browser matrix and a full harness rewrite.**
  Pure rules are unit-tested (`customerState`, claims, rival, director, speech
  keys); one focused Challenge browser run and owner screenshots A–D cover the
  scene. `scripts/playthrough.mjs` (Restaurant) stays stale and untrusted.

## 2026-09-16 — Restaurant shifts start solo; the third correct delivery brings the rush

Owner plan, analysed and implemented with changes.

- **Accepted — solo start, one-shot rush on the player's third correct
  delivery** (Normal and Challenge; Easy stays solo). Only a correct player
  delivery counts. A 1.6 s service-time beat lets the success land first (0.9 s
  stacked the rush pill on the thanks, temperature and combo pops);
  then the belt goes to rush, the director's rush phase starts (manual, no
  18 s timer on these levels), the pill reads `ランチラッシュ！ ウェイターが きたよ！`,
  and the rival walks in up the front-left aisle (x -2.1, z 6.6 → 2.4), turns
  to the room and waves (0.6 s) before its AI starts. No permanent label. The
  score pill appears only once the rush starts.
- **Modified — belt density by spacing, not the plan's counts.** The visible
  belt is 13.2 units; the old rates already showed ~3.7–4.2 dishes. Solo ≈ 3.7
  visible on every level; rush Normal ≈ 5.1 (interval 2.4, speed +8%),
  Challenge ≈ 6.6 (interval 1.7, spacing 2.0, speed +12%). The first tuning
  (solo 3, rush 4.4/5.6) measured only 1–2 solo and ~3.6/~4 in rush in the
  browser, because both waiters keep taking plates off the belt. `MIN_DISH_SPACING` 1.9 floors every interval so
  plates never overlap. The food order stays the shuffled bag either way.
- **Modified — shift totals 5/9/13** (were 5/7/11). With the rival arriving after
  three deliveries, a 7-customer Normal left almost nothing to compete for. The
  rival's claim limit is a share of the customers left when it enters.
- **Changed — rival on Normal enabled** (supersedes "disabled pending playtest"
  above, at the owner's request): speed 3.6, 7 s seated delay, share 0.35,
  hesitation 0.8–1.5 s, notices dishes after 1.0 s. Challenge: speed 4.4, 3.5 s,
  share 0.5, 0.3–0.8 s, 0.6 s.
- **Rejected — the plan's 20-test matrix and regression runs of other
  minigames** (owner: Restaurant-only testing). Pure modules are unit-tested;
  one focused browser run per level with three real deliveries.
- **Accepted (second pass, same day) — a temporary `ウェイター` tag during the
  entrance only.** The screenshots showed the entering rival from behind as a
  dark figure with a thin white band, easy to take for a customer. The tag uses
  the rival's dark bubble style, so the dark-bubble = other-waiter pairing
  carries into play; it disappears when the rival's AI starts. Rejected: a
  permanent label, and re-routing the entrance (the belt wall rules out walking
  in toward the camera). Pushed live at the owner's request before the owner
  reviewed screenshots A–D.

## 2026-09-17 — Restaurant: まってる… bubbles, visible claimed patience, frozen rival intro

Owner plan reviewed against the live solo-then-rush tree (much of it — rush
trigger, denser belt, shared dishes, no order cap, physical entrance — already
existed and was kept as is).

- **Accepted — `まってる…` replaces `I like...`** in the persistent bubble. English
  is what the child must remember and appears only as the ~2.5 s answer or Listen
  Again; Japanese is game state. `I like...` read as a half-finished English hint.
- **Accepted — visible patience for claimed customers only**, as a thin strip
  inside the waiting bubble (green / amber < 60% / red < 30%), not a floating bar.
  Reason: with patience hidden, claiming every customer at once had no cost.
  Unclaimed customers no longer drain at all (`preOrderDrain` 0 on every level).
- **Modified — patience tuned 150 / 120 / 100** (was 150 / 140 / 130) so holding
  four or five orders becomes risky. Not playtested; one table in `index.js`.
- **Accepted — frozen ~2 s rival intro**: eased camera move toward the aisle,
  `ライバル ウェイター！` title, rising sting, score appears as the rival waves,
  `ランチラッシュ！` under the score as the camera returns. The intro waits until
  any open Talk ends.
- **Modified — the belt keeps running during the intro** (the plan froze it). The
  player and rival cannot take dishes then, so nothing is lost, and the switch to
  rush density is actually seen.
- **Modified — Japanese titles**, not `RIVAL WAITER!` / `LUNCH RUSH!` / `YOU 3 —
  WAITER 0`: the plan's own rule makes these game state, and every other
  Restaurant cue is Japanese.
- **Accepted — score moves to upper centre**, hidden until the rival waves; the
  phase cue sits below it and generic notices below that. The back-wall sign
  moved down (y 3.62 → 2.85) because the centred pill covered it.
- **Rejected — rival urgency prioritisation.** The rival holds one order at a
  time (state machine claim → belt → deliver), so it never has competing orders
  to rank. Its customers already drain patience like the player's.
- **Rejected — pausing patience while the answer shows / on Listen Again.**
  Speech focus already freezes everything during Talk; the 2.5 s display is
  negligible, and pausing on Listen Again would let replays stop the clock.
- **Kept — the entrance-only `ウェイター` tag** alongside the new title; the
  rival is still seen from behind while walking in.
- **Rejected — the 43-test matrix.** Unit tests for the pure bubble/patience
  rules plus one focused Normal browser run (owner: minimum testing).

## 2026-09-17 (second pass) — Restaurant: 0–0 head-to-head score, real sign, restaurant conveyor

- **Accepted — head-to-head score starts 0–0.** Pure `createCompetitionScore()` in
  `rushTrigger.js` captures the served totals once at intro start and displays
  the difference; progress, stars and the real totals are untouched. Debug
  exposes `playerServed`/`rivalServed` and `competition.{baseline,score}`.
- **Accepted — physical wall sign; two lines chosen after an A/B render** at
  1366x768. One line (6.2 x 0.92 board) made the letters too small to read from
  the fixed camera; two lines (3.7 x 1.36) read clearly and look like a shop
  sign. Serif brick-red lettering on cream, dark wood frame, brass inner line,
  small steam-over-bowl mark, brass picture light, faint warm emissive. Placed
  at y 2.45 so it clears the score pill above and the belt below.
- **Accepted — conveyor recoloured as cabinetry**: charcoal belt `#283238`, cream
  housing `#E6D7BC`, stainless rails `#B8C3C1`, wood cabinet with panel seams
  (replacing the dark metal legs), one thin teal stripe. Boxes only; no new assets.
- **Modified — tests.** Unit tests for the pure baseline (hidden before capture,
  0–0 start, captured once, real counts not a fixed 3); the focused browser run
  covers solo totals, 0–0 reveal and a post-rush delivery. **Rejected — running
  `scripts/playthrough.mjs`**: it is stale (raised hands) and untrusted.
- **Open** — the temporary `ランチラッシュ！` cue and delivery notices sit over the
  sign for ~2 s; moving them lower would cover the belt, which matters more.

## 2026-09-17 (third pass) — Restaurant: end-of-shift result moment

- **Accepted — a 1.9 s win/loss/draw moment** replacing the 1.3 s round-end pause
  when the shift had a rival. It lives in the existing `round-end` phase, which
  already freezes every service system, so no new freeze path was needed.
  Outcome from pure `competitionOutcome()` over the head-to-head score.
- **Modified — Japanese labels** `きみの かち！` / `ウェイターの かち！` / `ひきわけ！`
  instead of `YOU WIN!` etc. (game-state text is Japanese); no failure wording,
  and the rival-win label uses the rival's dark style, never red.
- **Modified — reactions built from existing clips.** The models have
  `emote-yes` (nod) and `emote-no` (head shake), no jump, cheer or sad clip.
  Winner: `emote-yes` plus two procedural hops; other waiter: `emote-no` plus a
  0.16 rad droop ("aw, almost"); draw: both `emote-yes` with smaller hops. No
  new assets.
- **Rejected — camera zoom.** The fixed whole-room framing already keeps both
  waiters and the score in view wherever they stand; a zoom could crop one.
- **Kept — no ceremony on Easy or before the rush** (there is no competition).
- **Tests.** Unit tests for the outcome (win/loss/draw, uses the competition
  score not solo totals); two real full Normal shifts in the browser, one
  player win and one rival win. A draw is unit-tested only, because it can't be
  set up reliably in a real shift.

## 2026-09-17 (fourth pass) — Restaurant: the final question comes from someone in the story

- **Accepted — no unrelated host.** The police-officer host (model `j`) is
  removed from the Restaurant. Debug `host` is replaced by
  `turnaroundPartner {type, customerId, walking, uuid, cameraTarget}`.
- **Accepted — the rival asks on Normal/Challenge**, as the same character
  (same object, no clone): the result moment ends, the rival steers around the
  tables to open floor beside the player (~1.1 s), turns to the player, nods,
  and then the close-up and question start.
- **Modified — partner rule is "rival if it arrived, else a customer"**, so a
  Normal shift that ended before the rush also gets a customer, not an empty ending.
- **Modified — Easy's customer stays rather than returning.** When the last
  resolution is a served diner finishing their meal, they stay seated at their
  table and ask from there. If the final resolution was a walk-out, the most
  recently served diner walks back in through the door (physically; never teleported).
- **Rejected — a dedicated wave clip.** None exists; `emote-yes` is the friendly
  gesture, as elsewhere.
- **Tests.** One real full Easy shift and one real full Normal shift in the
  browser through to the answer. Challenge uses the same rival path and was
  not run separately.

## 2026-09-17 (fifth pass) — Restaurant: the rival's arrival is a challenge the player answers

Owner plan: turn the rival's entrance into a short interactive challenge scene.
Implemented by Claude directly (one scene file plus a small pure module).

- **Accepted — challenge dialogue and three replies.** The rival walks in,
  says `勝負しよう！どっちがたくさん料理を運べるかな？`, and the player picks one
  of `いいよ！勝負だ！` / `負けないよ！` / `がんばるぞ！`. Role-play only: every reply
  has the same outcome. Pure `rivalChallenge.js` (idle → entering → awaiting →
  reacting → done, one shot).
- **Accepted — the whole scene is a full pause, including the belt.** This
  reverses the 2026-09-16 "belt keeps running so the rush density is seen":
  with an open-ended wait for a reply, a running belt would not be a pause. The
  belt, director and rival AI switch to the rush together only after the reply.
- **Accepted — score and `ランチラッシュ！` only after the reply**, 0–0.
- **Modified — kept the existing Japanese score and cue** (`きみ 0 ・ ウェイター 0`,
  `ランチラッシュ！`) rather than the plan's English `YOU 0 — WAITER 0` /
  `LUNCH RUSH!`: the HUD is Japanese throughout.
- **Modified — the rival faces the room, not the player.** The player can be
  anywhere, often behind the rival, and facing them would show the camera the
  rival's back while it speaks.
- **Modified — one box along the bottom, not a bubble over the rival.** The
  line and replies sit together (RPG style) under the rival, so neither the
  existing `ウェイター` tag nor the rival is covered. The replies are in one row
  at Chromebook widths and stack at phone width.
- **Added — furigana on the kanji.** The rest of the game's Japanese is kana
  for young readers; the plan's kanji (勝負, 料理, 運, 負) get readings rather
  than being rewritten.
- **Added — 0.45 s before the replies appear**, so a Space press or click still
  queued from the third delivery cannot answer by accident. Brings the time
  before a reply is possible to about 1.5 s, inside the plan's 1.5–2 s.
- **Added — arrow keys work on the window while the replies show**, so a child
  who clicked into the room can still reach them by keyboard. Clicks into the
  room are ignored during the scene, so they can't queue a walk for afterwards.
- **Rejected — TTS for the rival's line.** The speech voice is set up for
  English; no Japanese voice is guaranteed on Chromebooks.
- **Kept — Easy unchanged** (no rival, no challenge).
- **Tests.** 9 unit tests for the challenge (trigger, Easy, pause, delayed
  replies, same outcome for every reply, one shot, strings). One focused
  browser run on Normal (34/34, then again after the style fixes): pause holds
  for 3.5 s with keys held and a room click, belt, patience and position
  unchanged, arrow + Enter reply, no mic start, rush and 0–0 after the reply,
  no second trigger. Timings are measured in game time (new read-only debug
  `elapsed`): the software renderer runs below 20 fps, so the wall clock
  overstates them.

## 2026-09-17 (sixth pass) — Restaurant: faster patience, modal challenge, hint-only HUD

Owner plan: faster patience with clear colour steps, a truly modal rival
challenge (the mic button covered the replies), and an upper-left HUD with only
the current action hint. Implemented by Claude directly.

- **Accepted — patience 48 / 38 / 28 s** (Easy / Normal / Challenge; was
  150 / 120 / 100), the middle of the owner's ranges. Checked against the belt:
  a given food enters about every 18 s on average on Normal solo and stays in
  view about 13 s, and every 8.5 s in the Challenge rush, so one order is
  always servable in time while three at once needs planning. Stars are barely
  affected: patience is at most 1 of 10 points per customer. Not yet
  playtested with children; tune `PATIENCE_SECONDS` in `customerState.js`.
- **Accepted — green / amber / red steps at 50% and 20%** (was 60% / 30%),
  hard steps with no blend. The look-around warning now starts with red.
- **Added — a thicker strip (19 → 33 texture px, track 26 → 44) and a gentle
  pulse in red.** At the old thickness the strip was about 5 px on screen from
  the room camera, too thin for the colour to be noticed.
- **Accepted — nothing refills patience** (pure `drainPatience`, unit-tested).
- **Accepted — the challenge is modal.** Root cause of the overlap: on the
  frame the challenge started, the scene read "paused" before the rush
  sequence began it, so the context update still ran and re-targeted a nearby
  seated customer, re-showing Talk. Fixed by re-reading the state after the
  sequence. On top of that, a modal class hides the action button, Listen
  Again, notices, combo, temperature and hint, and the Talk HUD is forced hidden
  every frame of the scene (a settings change could otherwise re-show it). The
  challenge box sits above every HUD layer (z-index 40).
- **Added — waiting bubbles are hidden during the challenge.** Patience is
  frozen then, and one bubble sat over the settings button in the challenge camera.
- **Accepted — no title and no `N / total` in the HUD.** Progress remains in
  the claim registry, director, completion and debug `progress`.
- **Accepted — the upper-left is a compact hint sized to its text**, replacing
  the `scene-card` with title + hint + progress. It is hidden during the
  challenge, the result moment, the walk to the turnaround and the finish.
- **Modified — the turnaround close-up keeps its hint** (`こんどは きみの ばん！`):
  it is the one moment the child's role changes from asking to answering.
- **Kept — existing hint strings.** Every service state already has a useful
  one, so in normal play the hint is always present, just small.
- **Tests.** Unit: patience ranges, thresholds, drain/no refill, speech-focus
  protection (269/269 total). Browser, Normal (session scratchpad
  `restaurant-hud.mjs`, untrusted: no known-bad run): full run 30/31 (the one
  failure was the check trying to claim a customer before anyone was seated), then
  that section rerun 12/12. The full run staged Talk as visible
  right before the challenge (the real overlap path) and a per-frame monitor saw
  no control or hint in 91 challenge frames. Other checks: replies uncovered by
  hit-test, Space does not start the mic, the click reply works, Talk returns
  after the rush starts, the hint is compact, progress is hidden but still counts,
  the score shows in the rush, a measured full drain of 38.0 s, a wrong delivery
  does not refill patience, green → amber → red matches the ratio, and an
  ignored customer walks out. Easy/Challenge patience are unit-tested only;
  the result moment and turnaround hint hiding were not run in the browser.

## 2026-09-18 - Restaurant: dedicated result stage flows into the final question

- **Accepted — dedicated staged composition.** Rival shifts move the same
  player and rival objects into a clean full-body result composition: player
  left, rival right, stopped belt behind them, and the MATSUBARA RESTAURANT sign
  centred between and above them.
- **Accepted — no walk-back and no gameplay camera between result and
  question.** The result stage is continuous: after the reaction settles, the
  waiters turn toward each other and the camera eases slightly closer for the
  rival's "What food do you like?" question.
- **Accepted — the score shrinks upward.** The head-to-head pill starts large
  above the result label, then smoothly compacts and moves to the top edge as
  the label fades, leaving the conversation clear while keeping the score
  visible.
- **Accepted — procedural poses on the rigid node rig.** Celebrate, funny
  despair, mild dejection and friendly shrug poses animate the existing player
  and rival nodes; no duplicate characters or new animation assets are used.
- **Modified — labels stay Japanese.** Keep `きみの かち！` /
  `ウェイターの かち！` / `ひきわけ！` and `きみ N ・ ウェイター N`, not `YOU
  WIN!` / `YOU 4 - WAITER 2`, following the 2026-09-17 decision that game-state
  text is Japanese.
- **Modified — "fists clenched" cannot be shown.** The models have block hands
  and no fingers, so fast, small fist shaking conveys the despair reaction
  instead.
- **Added — diners and dishes are hidden while the stage is up** so the staged
  composition stays clean.
- **Kept — Easy and pre-rush endings use the customer path.** Only shifts in
  which the rival arrived use the dedicated result stage.
- **Added at review (Claude, from renders) — 0.9 s frozen lead-in in the room**
  before the stage, so the last delivery's thanks and combo land (plan step 1);
  the stage then clears that bubble, because its diner is hidden.
- **Modified at review — the kneel is three-quarter.** From the front camera
  the rigid legs (no knee joint) folded back disappear and the rival reads as
  "shorter", and with arms up it looked like the winner's cheer. The despairing
  waiter turns 0.5 rad toward the stage centre, drops 0.46, folds the legs back
  and looks up with alternating fist shakes; no lean back (with the yaw it read
  as toppling over).
- **Modified at review — framing.** Result camera (0, 2.9, 0.4) → (0, 1.75, -4.6),
  in front of the middle table's chair, which sat in the foreground at the
  first proposed position; eases in with damping 5.5 so the reaction plays in
  the stage framing, not during a long sweep. Stage score and result label moved
  up (top .8rem / 5.3rem) so the label only touches the sign's frame, never
  its lettering. Accepted: during the question the English bubble covers part
  of the sign; the sign is fully visible for the whole result.

## 2026-09-19 — Restaurant: the rival reveal and challenge land as two beats

- **Accepted — a staged reveal before dialogue.** The frozen intro now runs
  entrance → 0.2 s turn → 2.0 s reveal → 0.8 s return. The rival finishes the
  existing walk before turning by the shortest angle to face the camera. The
  `ライバル ウェイター！` title remains through the walk, turn and reveal; the
  reveal punches the camera into a close three-quarter view, lands a BA-BAM
  accent, and holds a procedural challenger pose. The camera then eases all
  the way back to the entrance framing while the pose blends cleanly to rest,
  and the title fades only at the end of that return.
- **Accepted — a distinct playful challenger pose.** A planted wide stance,
  forward lean and fists raised in front make the invitation read as
  “bring it on.” Two quick pumps in the first 0.8 s add energy, then the strong
  pose holds. It deliberately differs from the result-stage sideways raised
  arms and hopping celebration and from the kneeling despair pose. The same
  captured-node offset machinery is restored before later idle and walking.
- **Accepted — a generated musical phrase, timed to the action.** Low warning
  notes and a quick rising run follow the walk; two brighter, punchier stacks
  fire from the reveal event, so BA-BAM cannot drift away from the camera
  punch-in. This keeps the entrance alert and exciting without adding an audio
  asset or making it frightening.
- **Accepted — label and challenge panel are a second beat.** Only after the
  return and title fade do the floating `ウェイター` label and bottom panel
  appear, together. The redundant in-panel name badge is removed, so the title,
  floating label and panel never compete. The challenge line and all three
  replies keep their existing Japanese strings.
- **Accepted — cost-based, furigana-safe typewriting.** The full line structure
  is laid out once at about 30 cost units per second: ordinary characters cost
  one, line breaks cost zero, and a complete ruby group costs the length of its
  base. Unrevealed unit spans use `visibility: hidden`, keeping centred lines
  stable and ensuring ruby and reading markup are never cut apart.
- **Accepted — deliberate skip and reply input.** Space, Enter or a panel
  click/tap reveals the rest of a typing line and performs no world, speech or
  reply action. A skip key's repeats and release are consumed before reply
  focus is enabled, so only a fresh keypress can answer. Natural completion
  replaces the fixed 0.45 s reply delay; all three replies appear together,
  after which arrows, click/tap and fresh Space/Enter work as before.
- **Kept — one continuous full pause.** Movement, actions, belt, patience,
  customer timers, director, temperature and rival AI remain frozen through
  entrance, reveal, typing, indefinite reply wait and the 0.55 s reaction.
  Only then do the 0–0 score, lunch-rush cue, room camera and rival AI begin.
- **Modified — result reaction holds for 3.6 s** (was 1.8 s). Reaction motion
  keeps its existing real-time functions, reaches its strong pose early and
  holds there; label fade, score shrink, settling, turn-to-face, question camera
  and final question all wait for the longer reaction to finish.
- **Why.** Separating the cinematic reveal from the challenge gives the rival
  an unmistakable entrance and lets the child read the dialogue without camera
  motion or competing labels. Stable type layout preserves furigana for young
  readers, while the longer result hold makes the outcome legible before the
  stage moves into its final conversation.
- **Rejected — slicing `innerHTML` for the typewriter.** Partial HTML can split
  a `<ruby>` or `<rt>`, produce invalid markup and make centred text reflow.
- **Rejected — slowing result animations to fill 3.6 s.** Time-scaling would
  make the reactions sluggish; they should perform at their existing pace and
  hold the readable final pose instead.
- **Tuned after renders (Claude).** Fists forward at shoulder height read as a
  zombie reach in the close-up, so the arms are raised up and out in a V above
  the shoulders, each pump driving them higher; the close-up camera sits 0.45
  further back so the rival is seen to the shins. The rival faces the camera,
  not the player's avatar, which can stand anywhere behind it.
- **Fixed — Space on a focused button (shared `input.js`).** The keyup handler
  called `preventDefault()` on Space even when a button had focus, which
  cancels the browser's keyup click: Space never answered a challenge reply
  (earlier checks used Enter). Keyup now exempts a focused button exactly as
  keydown already did, so Space works on any focused game button.

## 2026-09-19 — Restaurant: belt exchange, labelled return, shared dejection

- **Accepted — exchange in place.** Taking a conveyor dish while carrying swaps
  the two. The selected dish becomes the carried dish, while the previous dish
  receives a new ID at the selected dish's exact belt position. Count, spacing,
  entry timing and the shuffled food bag are unchanged. The new ID deliberately
  makes a rival abandon a vanished target cleanly; the placed dish is then an
  ordinary shared dish it can target later.
- **Accepted — keyboard and click parity.** At the belt front Space exchanges
  with the nearest pickable dish, and clicking a belt dish walks to its predicted
  position and exchanges on arrival, with the same nearest-dish fallback as a
  normal pickup.
- **Accepted — food-blind single-action priority.** Talk's existing capture and
  lock rules remain first. While carrying, the return tub outranks exchange,
  which outranks an eligible delivery; empty-handed pickup is unchanged. This
  choice never checks whether the carried food matches a customer, so the action
  label cannot reveal the listening answer. One Space press resolves only the
  selected action.
- **Accepted — a physical `もどす` sign.** A high-contrast canvas-texture board
  is mounted on the return tub's camera-facing rim, below the belt sightline. Its
  teal and cream treatment belongs to the station and uses no rubbish wording,
  bin icon or floating HUD marker.
- **Accepted — one shared losing pose.** Player and rival now use the same
  standing dejected reaction: shoulders and torso slump, head tips down, relaxed
  arms follow the slump, and a slow two-cycle head shake eases in and out before
  the waiter holds still. This supersedes both the 2026-09-18 funny-despair pose
  set and its reviewed three-quarter kneel, root drop, folded legs and ceiling
  fists. The winner's celebration, draw shrug, 3.6-second reaction hold,
  settling and final-question transition remain unchanged.
- **Why.** Exchange makes an accidental pickup recoverable without interrupting
  the order-blind conveyor, the tub label makes the alternative return action
  legible in the room, and a shared restrained loss reaction reads consistently
  for either character without turning defeat into melodrama.
- **Rejected — returning the old dish to the tub during exchange.** That would
  reduce belt count and spacing and make exchange behave like two actions.
- **Rejected — reusing the removed dish ID or drawing a replacement from the
  bag.** Reuse would leave a rival pursuing a different physical dish under the
  same target; a bag draw would alter future supply and scheduling.
- **Rejected — match-sensitive delivery priority.** Showing delivery only for a
  correct carried food would expose the answer the child is meant to remember.
- **Rejected — the kneeling despair reaction, crying effects and exaggerated
  failure gestures.** The intended reading is simply “Aw, I lost,” followed by
  the existing friendly final conversation.
- **Modified after the browser check (Claude) — the tub outranks proximity
  Talk.** The tub (6.0, -3.95) sits 2.6 from the back-right diner, inside the
  2.7 talk radius, so while that diner was unasked a waiter standing at the tub
  with a dish got Talk and could not return it. Standing at the tub with a dish
  now outranks proximity Talk exactly as the belt front already does; a clicked
  or committed conversation still wins. Supersedes the 2026-09-14 "a raised hand
  outranks the return action" rule for the tub radius only.

## 2026-09-19 — Restaurant: rival progression (rematch, Waiter 2, Round 2)

Owner's plan, reviewed and adjusted by Claude, implemented by Claude directly
(the router had no other worker available: Codex in a usage-limit window, the
rest quarantined). SPEC §4 "Rival progression" has the behaviour and numbers.

- **Accepted — a Round 1 loss or draw ends on the child's terms.** Waiter 1 asks
  `もう一回 やる？` with two choices, rematch or finish, instead of auto-starting
  another round. Finishing always reaches the final English question, so losing
  can never block the lesson. A draw counts as a loss for progression.
- **Accepted — a rematch is play, not ceremony.** Same waiter, same tuning, a
  clean room and 0–0, but no solo deliveries and no entrance scene.
- **Accepted — a Round 1 win is progress.** No rematch prompt and no question;
  Waiter 1 walks out and Waiter 2 gets the complete entrance (walk, jingle,
  close-up, challenger pose, title, typewriter, replies) through the same code
  path, with its own title, line and replies. Round 2 always ends in the final
  question, asked by Waiter 2. No Round 3.
- **Accepted — Waiter 2 must read as a different person.** Kenney models ignore
  tint, so the difference is the model (`k`: moustache, brown hair, red shirt),
  a black apron instead of white, and a gold bow tie. The floating label stays
  `ウェイター`. A red apron was tried first and vanished into the red shirt.
- **Accepted — Round 2 is harder through execution.** Faster rival (+17%),
  shorter hesitation and dish notice, a +17% denser belt, shorter patience, and
  more simultaneous customers; rival share stays at or under one half. Per
  level (SPEC numbers), because the owner's absolute numbers were Challenge-derived:
  applied to Normal they would have put a Normal child past the Challenge rival
  in one step. Normal Round 2 is therefore roughly the Challenge rival plus the
  Round 2 belt; Challenge Round 2 uses the owner's numbers.
- **Accepted — rematch and Round 2 length = the competitive part of the first
  shift** (6 Normal, 10 Challenge), so a retry costs about what the battle did.
- **Accepted — belt dishes survive the reset.** The belt is order-blind, so its
  dishes carry no state from the last round, and an emptied belt would leave the
  new round with seconds of nothing to pick up.
- **Accepted — the rematch question uses the challenge panel and its own camera**
  (aimed lower than the question camera) so both waiters stand above the panel.
  Keyboard presses that begin within 0.35 s of the choices appearing are
  swallowed, so Space mashed through the result cannot pick a rematch.
- **Rejected:** auto-starting a second round on a loss; a rematch prompt
  between Waiter 1 and Waiter 2; a shortened Waiter 2 intro; making Waiter 2
  hard by handing it most customers; a Round 3; one absolute Round 2 tuning for
  both levels; English REMATCH/FINISH labels (the UI is kana/furigana for
  Grade 3 readers).

## 2026-09-20 — Restaurant: Round 3 chaos, and no more teleports

Owner-authored plan, reviewed and amended before implementation. Round 3 is a
bonus round for a player who has already beaten Waiter 2, and every remaining
snap between gameplay and a presentation becomes a walk.

- **Supersedes the 2026-09-19 "Rejected: a Round 3" line.** That rejection was
  against a Round 3 that was simply more speed. This one is accepted because it
  changes the *kind* of pressure rather than the amount.
- **Accepted — Round 3 unlocks only by beating Round 2.** A loss or a draw in
  Round 2 goes straight to the final question, so a weaker student is never
  pushed through the hardest round. Round 3 ends in the final question whatever
  its outcome; there is no Round 4.
- **Accepted — Round 3's identity is chaos and multitasking, not speed.** It
  reuses Round 2's belt speed, rival speed, hesitation, dish-notice time and
  customer share exactly. It adds exactly two things: a belt that stops, and a
  rival that can hold two orders.
- **Accepted — a stoppage is a withheld clock, not a belt mode.** The conveyor
  is a boundary scheduler keyed on its own service time; suppressing movement
  inside it would leave `nextEntryTime` behind and dump a burst of dishes at the
  entry on restart. Instead the scene simply does not advance the belt while
  stopped, so positions, entry schedule and dish spacing survive a stoppage by
  construction and a restart resumes exactly where it stopped. `beltMalfunction.js`
  owns the run/warning/stop cycle and runs on the service clock, so patience,
  customers and both waiters keep going while the belt is frozen.
- **Accepted — belt timing 8–13 s running, 0.6–1.0 s warning, 2.0–2.8 s stopped,**
  with the first stoppage held back at least 10 s. The owner's 6–12 s run window
  left the belt stopped about a fifth of the round; at the longer window it is
  nearer a sixth. The Round 3 stream densifies slightly (Normal 1.75 → 1.55 s
  entry interval) purely to offset that downtime, so a stoppage bunches supply
  into a scramble instead of starving the room. Challenge is already at
  `MIN_DISH_SPACING` and barely densifies.
- **Accepted — Round 3 patience rises** (Normal 28 → 30 s, Challenge 25 → 27 s).
  Holding it would have quietly converted belt downtime into timeouts, which is
  difficulty from the environment rather than from the duel.
- **Accepted — two rival orders behind `maxActiveOrders`, defaulting to 1.** The
  rival was a strictly linear single-task machine; the refactor is the highest
  regression risk in the pass. Defaulting to one order means Rounds 1 and 2 take
  the identical path, and every pre-existing rival test passes unmodified — that
  is the regression guard, not a nicety.
- **Accepted — the rival claims a second customer only when no dish matches an
  order it already holds.** Claiming eagerly would make it simply twice as fast,
  which is the thing this round is not. Restricting it to an idle belt-watch
  makes the behaviour legible: it has nothing to carry, so it goes and takes
  another order.
- **Accepted — it never re-targets mid-walk.** A dish appearing for order A
  while it walks to claim customer B does not interrupt it. Otherwise it twitches
  and reads as psychic rather than competent.
- **Noted — a stoppage does not reliably push the rival to a second order.** A
  stopped belt leaves its dishes standing still, which makes them *easier* to
  collect, so a stoppage often sends the rival to the belt rather than to another
  table. Two overlapping orders therefore depend on what the belt is offering.
  This is good behaviour (it grabs the easy dish) and is left alone; the
  guarantee is unit-tested, and the browser harness reports it as an observation
  rather than asserting it.
- **Accepted — no new UI for the rival's two orders.** The existing black
  ownership bubbles already mark rival-claimed customers, so two black bubbles
  *is* the readout.
- **Accepted — an amber lamp bar on the front of the belt is the warning,** with
  one soft two-note cue. The lamps are deliberately large: at trim size they read
  as belt detail from the room camera, and this has to say "about to stop" to a
  child who reads no Japanese. A beep every ten seconds for a whole round would
  be punishing in a classroom, so the sound plays once per warning at low gain.
- **Accepted — Round 3 reuses Waiter 2 and skips the entrance cinematic.** The
  same waiter is already in the room; both simply walk back to their working
  positions and `ラウンド 3！` announces the round. Replaying the walk-in would
  contradict the fiction.

### No more teleports

- **Accepted — the result stage is walked into, not cut to.** `createResultStage`
  gains an opt-in leading `staging` phase; the waiters keep the positions the
  round left them in and walk to their marks at 8 units/sec while the camera
  eases to the result framing. The label, sting and reactions all wait for the
  walk. Staging is opt-in so the existing result-stage tests keep describing the
  reaction unchanged.
- **Accepted — 8.0 units/sec, not 7.5.** From the far corner of the room 7.5
  took 1.67 s, close enough to the 1.8 s deadlock guard that the guard could fire
  on an honest walk. At 8.0 the worst case is about 1.56 s.
- **Accepted — a safety timeout, always.** A blocked route must never strand the
  game short of its own result. The same rule covers the return walks.
- **Accepted — the rematch and the next challenger walk too.** A rematch walks
  both waiters back from the result marks; a Round 1 win walks the player back
  while Waiter 1 leaves, and the next intro waits for both. The player is no
  longer reset out from under a transition they can see.
- **Accepted — a 0.4 s settle beat before each round starts.** The camera is
  still easing back when gameplay used to begin, so the player lost time they
  could not see. Customers, belt, director and rival now all start together.

### Cleanup

- **Accepted — later rounds no longer ride on the Round 1 rush trigger.** Round 2
  and Round 3 worked partly because `rushTrigger.triggered` happened to stay
  true. The gate is now `progression.challengeGateOpen(rushTriggered)`: Round 1
  still depends on the three-delivery warm-up, later rounds on progression alone.
- **Accepted — a test-only `restaurantControl` debug hook.** Reaching Round 3
  honestly costs two won rounds, which made every check of it slow and flaky and
  pushed previous passes into monkey-patching the game from the harness. The
  game never reads it.
- **Accepted — the permanent Restaurant playthrough is replaced, not repaired.**
  The old one predates open seating (raised hands, live-order limits) and scored
  0 passes. It is kept as `playthrough:restaurant-legacy`, explicitly
  known-failing, for the scoring and dwell checks still worth porting.
- **Rejected:** a Round 4; a new character for Round 3; raising the Round 3 rival
  share (the rival is dangerous because it holds two jobs, not because ownership
  is rigged); making Round 3 primarily faster; a beep on every stoppage; a
  dedicated HUD element for the rival's second order; heavyweight pathfinding for
  the staging walks (the existing table steering is reused).

## 2026-09-21 — Restaurant: one fixed difficulty, three waiters, ramen

Owner-authored plan, reviewed and amended before implementation. The Restaurant
stops having two difficulty curves stacked on each other, gains a real third
challenger, and swaps belt stoppages for speed bursts.

- **Accepted — the Restaurant ignores the global difficulty setting.** The
  waiter ladder is the difficulty curve; a second, hidden curve underneath it
  meant the same round meant different things for different children. The one
  baseline is the competitive configuration the ladder was tuned against (4
  tables, 9 customers, 38 s patience, prep scale 0.85) — deliberately **not**
  the old Easy default, which predates the ladder and has no rival at all. The
  setting still works for the other four minigames, and the control is hidden
  while the Restaurant is open rather than lying to the student.
- **Known consequence — Easy is gone, and Easy was the only rival-free mode.**
  Every student now gets the competitive baseline. The graceful path that
  remains is real but quieter: the shift still starts solo and the rival only
  arrives on the third correct delivery, so a struggling child never meets one.
  Patience does drop 48 → 38 s for the weakest students and the round is nearly
  twice as long. Watch this in class before assuming it is fine.
- **Accepted — Rounds 1 and 2 share the baseline patience.** Round 2 previously
  shortened it to 28 s. Difficulty there now comes only from Waiter 2's
  execution (speed 3.6 → 4.2, hesitation 0.8–1.5 → 0.4–0.8, notice 1.0 → 0.6)
  and the Round 2 belt. Round 2 is therefore a softer step than it was; that is
  the intended trade for "the room is never tilted while you are not looking".
- **Accepted — no round overrides the customer share.** Round 2 used to raise it
  0.35 → 0.45. A rival is dangerous because it beats you to dishes, not because
  it was handed more customers.
- **Accepted — Round 3 is the only round that shortens patience,** to 29 s: one
  explicit scale (`ROUND_THREE_PATIENCE_SCALE` 0.76) applied once where the
  value is derived, so it can never drift from the baseline. 23.7% shorter.
- **Accepted — `ROUND_TWO` and `ROUND_THREE` are single objects.** With one
  baseline, a per-difficulty table would have been a fake index.
- **Kept — the level-keyed tables inside the pure modules** (`CONVEYOR_CONFIG`,
  `RIVAL_LEVELS`, `DIFFICULTY`). Those are a legitimate parameterisation of pure
  modules and their multi-level tests are real coverage; the Restaurant simply
  always passes `RESTAURANT_LEVEL`. Collapsing them would have churned the rival
  test file that exists specifically to prove the ladder has not regressed.

### Waiters

- **Accepted — Waiter 2 loses the gold bow tie.** It read as a final boss when
  Waiter 2 is the middle rung. Its own face, hair and moustache plus the black
  apron already separate it from Waiter 1 at room-camera distance.
- **Accepted — Waiter 3 is a real third character** (`RIVAL_IDS.WAITER_3`) with
  the full challenger entrance every other waiter gets: walk in, close-up,
  challenger pose, reveal, jingle, typewriter, replies. Round 3 previously
  reused Waiter 2 and skipped the cinematic entirely.
- **Accepted — the next-challenger transition is one shared path.**
  `beginNextRivalTransition(round)` plus `beginNextRivalIntro()` serve Rounds 2
  and 3 identically: the beaten waiter exits, the player walks back, then the
  new challenger arrives. No one-off Round 3 scene.
- **Accepted — Waiter 3 uses model `h` with a deep-red apron.** Claude raised
  that `h` reads as a grey, visored figure rather than a friendly waiter and
  offered the unused alternatives (b, c, d, g, j, l, n, o, p); the owner judged
  it fine on 2026-09-21. The three waiters are white / black / red aprons on
  models `r` / `k` / `h`, all distinct from the player (`a`) and the customers
  (e, f, i, m, q).

### The belt

- **Accepted — speed bursts replace stoppages, one day after the stoppages
  shipped.** The belt now alternates normal (5–9 s) and fast (2–4 s) at 2.0×,
  and never stops. `beltMalfunction.js` and its amber warning-lamp bar are
  deleted; the conveyor front is clean again. The cue is the belt visibly
  racing, plus a quiet motor spin-up and wind-down.
- **Accepted — a fast burst divides the entry interval by the multiplier.**
  Keeping the time interval would have spread dishes twice as far apart at the
  exact moment the belt should look frantic. Dividing it preserves the *spatial*
  gap exactly and doubles throughput.
- **Fixed — dish spacing is now a distance rule, not a time rule.** A speed
  change could schedule an immediate entry while the dish ahead had only
  travelled at the old, slower speed, bunching two dishes to 1.26 units (under
  `MIN_DISH_SPACING` 1.9). The conveyor now holds a dish at the hatch until the
  one ahead is genuinely clear, which also closes the same latent hole in the
  existing rush and Round 2 mode switches.
- **Noted — a burst invalidates the rival's interception maths.** It plans its
  walk from the belt speed at that moment, so a burst mid-walk makes it arrive
  to find the dish gone, and it abandons cleanly. That is fair — the player's
  click-to-walk is surprised identically — but if it looks incompetent in play,
  this is why.

### Ramen

- **Accepted — `noodles` becomes `ramen`,** a full semantic rename: vocabulary
  id, answer sentence (`I like ramen.`), `FOODS`, prep-time key, dish geometry
  branch and every test. The bowl gains a narutomaki disc and an egg half so it
  reads as ramen rather than plain noodles.
- **Accepted — old saves migrate on load.** `RENAMED_ANSWERS` in
  `progression.js` maps a stored `noodles` answer to `ramen` in `cleanState`, so
  a child who answered before the rename still sees their answer in the hub and
  stamp book. `noodles` is never written back.
- **Accepted — explicit speech variants for ramen.** The class says ラーメン, so
  the recogniser returns the long-vowel and l/r shapes far more often than the
  dictionary spelling; edit distance alone handles those poorly, and the
  `VARIANTS` table exists for exactly this.
- **Rejected:** keeping Easy as a Restaurant option; a per-difficulty Round 2/3
  table; raising the Round 3 share; a new physical warning structure for the
  fast belt; a Japanese instruction panel on every burst; a complex new ramen
  model.

## 2026-09-20 — The rival works the whole round; the room is solid; one place to look

### Rival workload, not a lifetime quota

- **Fixed — the round-long claim quota is gone.** `rival.js` derived
  `claimLimit = round(total * share)` and `canClaimMore()` required
  `claims < claimLimit`. With the fixed baseline that resolved to **2 in every
  round**: `total` is ~6 (Round 1 activates the rival after the player's third
  delivery; Rounds 2 and 3 use `competitiveRoundTotal(9) = 6`) and
  `RIVAL_LEVELS[2].share` was 0.35. The rival served two customers and then
  stood idle for the rest of the battle with customers still waiting, and it
  capped Waiter 3's two-order memory at two claims — hiding the one thing that
  makes Waiter 3 a different opponent.
- **Accepted — `canClaimMore()` is capacity, not history:**
  `orders.length + (pending ? 1 : 0) < maxActiveOrders`. A served customer frees
  its slot. There is no maximum number of customers the rival may serve in a
  round. Every other safeguard is untouched: it still walks to a customer before
  claiming, respects `minSeatedAge`, player reservations and player ownership,
  carries one dish, intercepts dishes physically, and pauses for speech focus.
- **Accepted — `share` and `claimLimit` are deleted,** from `RIVAL_LEVELS`,
  the `createRestaurantRival` options, `currentRivalConfig()` and the debug
  snapshot, rather than left as a dead compatibility field. The now-unused
  `total` option went with them. `claims` survives as debug/statistics only.
- **Rejected:** setting `share` to 1.0. It leaves a knob that does nothing,
  still caps the round, and would have to be re-derived every time the customer
  total moves.
- **Added — `rival.eligibleUnclaimed` in the debug snapshot,** so an idle rival
  with customers waiting can be told apart from one with nobody old enough to
  claim. `claimLimit` is gone rather than reported misleadingly.
- **Noted — Round 1 is now strictly harder.** Waiter 1 could previously only
  take two customers a shift; it can now work continuously. Its slow tuning
  (`minSeatedAge` 7, hesitation 0.8–1.5 s) is the only throttle left. Judge this
  in class before tuning it — see CURRENT_STATE Next Steps.

### The room is solid

- **Accepted — a new pure `roomCollision.js`** owns the room's solid geometry:
  `TABLES`, `ROOM_BOUNDS`, chair and body footprints, `blocksMovement`,
  `canOccupy` and `resolveMove`. `index.js` builds the chair meshes from its
  `chairPositions`, so a chair the child can see and the box they bump into
  cannot drift apart. It follows `claims.js` and `customerState.js`: rules the
  game depends on live in a pure module that can be tested without a scene.
- **Accepted — chairs and seated customers block movement.** Chair boxes are the
  visible mesh (0.9 × 0.82) plus 0.12 of body padding — 0.57 × 0.53. Seated
  bodies are radius 0.50. The padding matches the table, which has always
  blocked at 1.12 around a 1.0 top. Deliberately modest: four tables' worth of
  oversized barriers would close the aisles.
- **Accepted — only settled customers are solid** (`seated`, `awaiting`,
  `eating`). A customer walking in or leaving stays soft: a moving obstacle can
  pin the player against furniture, and neither state can be talked to anyway.
- **Accepted — `resolveMove` has an escape hatch.** A body already inside an
  obstacle may move freely until it is clear, because a customer can sit down on
  the spot the player is standing on and would otherwise wall them in on both
  axes at once. Keyboard walking and click-to-walk share this one function, so
  they cannot obey different obstacles.
- **Noted — the seated-body footprint is contained by its chair box.** At a seat
  the chair does all the blocking. The body rule is kept because it is what makes
  "a settled customer is solid" true independently of the furniture, and it is
  tested on open floor where it actually bites.
- **Accepted — `TALK_RADIUS` moved into `roomCollision.js`.** The footprints and
  the talk radius are one invariant: a test sweeps the floor and proves every
  table keeps a legal standing spot inside talk range, from both sides.
- **Unchanged — the rival keeps its existing table steering.** It is driven by
  the pure model's timed walks, so hard-blocking it would desync it from its own
  timing and could strand it. Seats sit inside the table's 1.45 steer radius, so
  the existing deflection already carries it ~0.7 clear of a seated diner.
  `setRivalApproach` already stopped it beside the table, never on the customer.

### One place to look

- **Accepted — the persistent upper-left contextual hint is deleted,** element,
  CSS, `setInstruction` and all fifteen call sites. Most of what it said
  duplicated the control directly beneath it ("go to the conveyor" beside
  「スペースで りょうりを もつ」); the rest was navigation a child can read from
  the room. The bottom bar already carried the real affordance: the Space action
  button, or the Talk button with its 🎤 label and `Space` chip.
- **Rejected — moving the hint into the bottom stack as its own line.** Tried
  first; it is still a second thing to read. The owner asked for no extra
  buttons, no extra text and no extra lines, which leaves the controls that were
  already there.
- **Noted — three moments lost their text line:** the turnaround
  (「こんどは きみの ばん！」), the round end and the stamp. Each still has its
  own cue — the close-up with the partner's question bubble, the result label,
  the stamp sound and book. Judge the turnaround in play; if the role flip does
  not read, it belongs in the temporary notice, not in a restored panel.
- **Unchanged — no auto-listen.** No dwell timer, microphone auto-start or
  progress ring was added. Speaking stays a deliberate press.

## 2026-09-20 — Animal park: where the animals' animation comes from

The Zoo becomes a roaming animal park, so every animal needs a real Idle and a
real Walk. Almost none of them shipped with one.

- **Accepted — the clips are lifted from the original ITHappy FBX, and the
  models are left alone.** `public/assets/animals/Animals.glb` carries seven
  rigged skins and **zero** animation clips, so there was nothing to play. The
  clips do exist, embedded in the pack's seven source FBX meshes. GLTFLoader
  runs `sanitizeNodeName` over every node, which strips `.` — so the glb's
  `spine.007`/`thigh.R` load as `spine007`/`thighR`, exactly what the FBX bones
  are already called. `scripts/build-animal-clips.mjs` reads the pack at build
  time and writes `assets/animals/animal-clips.json`; the game attaches the
  clips to the loaded models at runtime. Animals.glb, its materials, its shared
  texture atlas and the tuned `targetHeight`/`yawOffset` values are untouched.
- **Rejected — importing the `.unitypackage` into Unity and re-exporting a GLB
  per animal.** It was the obvious route and it is unnecessary: a
  `.unitypackage` is a gzip tar, and the takes are already in the FBX. Unity
  would also have meant re-exporting meshes and re-tuning every scale.
- **Accepted — tracks targeting `<Mesh>_rig` and `*_end` are dropped.** `_rig`
  is the FBX armature wrapper and carries the armature root motion; keeping it
  would slide an animating animal away from the position the roaming code sets.
  Measured: root drift is now exactly 0 on all eight. `*_end` bones are leaf
  tips that do not exist in the glTF models.
- **Accepted — clip tracks are remapped onto each model's real bone names at
  load time (`retargetClip`).** Animals.glb packs all seven animals into one
  scene and they all use the same bone names, so GLTFLoader renames the repeats:
  the tiger keeps `Root`, the horse gets `Root_1`, the dog `Root_2`. Binding by
  the name in the clip therefore worked for the tiger alone and silently
  animated nothing for the other six — it warns, it does not throw. The lookup
  now falls back to the name with any `_<digits>` suffix removed.
- **Accepted — the giraffe's walk is retargeted from the styloo cow.** The
  styloo pack ships the giraffe with one clip, the misspelled `iddle`, and no
  walk. Its cow uses a byte-for-byte identical 48-node Rigify rig, and all 46
  bones the cow's walk drives exist on the giraffe. A hooved quadruped is also a
  better donor than the pack's dog, which has a walk on the same rig. Only
  rotation tracks transfer: the giraffe's neck and legs are far longer, and
  inheriting the cow's bone translations would squash it into cow proportions.
  Verified by rendering six phases of the cycle — the legs stride, the body and
  neck stay intact. The giraffe has no run clip, so `run` is optional per animal.

## 2026-09-20 — The Zoo becomes a roaming animal park

The fenced zoo asked a child to read a sign, walk to a labelled pen and
photograph an animal standing still in it. The signs did the finding, so there
was no search; the pens did the framing, so there was no aiming.

- **Accepted — one continuous park, eight animals, no enclosures.** The roster
  is tiger, horse, dog, deer, cat, penguin, chicken, giraffe. Because it is a
  park rather than a zoo, a dog, a cat and a chicken need no justification.
  Removed: elephant, alpaca, fox, wolf, stag, bull, cow, donkey — with their
  vocabulary, their models and the circular pen floors, fence posts, fence rails
  and habitat fence colliders that went with them. **No invisible collider is
  left where a fence used to be**; `colliders` now holds only real scenery.
- **Accepted — all signage is deleted, and nothing replaces it.** The
  `YOU ARE HERE` board, the four junction signposts, `REGION_SIGNAGE`,
  `JUNCTION_SIGNPOSTS`, `createJunctionSignpost`, `createCampusBoard`, the sign
  canvases and `getSignageData` are gone. Deliberately **not** replaced with
  arrows, glowing targets, minimap dots or waypoint markers: the fountain, the
  barn, the pool, the bridge and the woodland are what a child navigates by.
- **Accepted — the map stays the size it was** (82 × 70). The challenge is
  meant to come from looking for something that moves, not from walking further.
- **Accepted — the eight `*-viewpoint` path spokes are deleted.** Eight spurs
  radiating off the main loops would have drawn a map of exactly where the
  animals were, which is the signage problem in another form. The path network
  is now loops only, and a test asserts no node is a dead end.
- **Accepted — bounded roaming territories, not a navmesh.** Each animal has
  6–7 authored waypoints spanning 14–17 units. Authored points are cheaper and
  far more predictable than a navmesh for eight animals on a fixed map, and they
  let each area be tuned for difficulty. A destination whose straight line is
  blocked is rejected, which is what keeps animals out of the fountain, the barn
  and the penguin pool. Tests walk every waypoint and every leg through
  `canOccupy`, so scenery and roaming cannot drift apart.
- **Accepted — idle/walk only, and never fleeing.** An animal idles 2–6s, picks
  a reachable waypoint, turns toward it, walks, and idles again. Approaching it
  changes nothing: its natural idle pauses are the photo opportunity. An animal
  that ran from the player would make the game unwinnable for a young child.
- **Accepted — no teleporting, including the arrival snap.** The first version
  snapped an animal onto its waypoint on arrival; it is only ~0.3 units but it
  is still a teleport, and it read as a hitch at the end of every walk. Animals
  now stop where they stand.
- **Accepted — speeds well under the player's.** The player moves at 13.5; the
  animals at 0.9 (penguin) to 2.3 (dog). The walk clip's timeScale is divided by
  a per-animal authored `clipSpeed` so feet do not skate.
- **Accepted — spawn positions are randomised but constrained.** No two animals
  within 4 units, nothing within 12 of the entrance, and the requested animal is
  drawn from the same pool as the rest so it is never reliably somewhere easy.
  Seeded, so a test or a harness run can reproduce a park exactly.
- **Accepted — the photo target already tracked the animal, so it was kept.**
  `photoTarget` is a child of the animal's own group; framing, occlusion and
  shutter readiness read its live world position. The one hidden dependency on a
  fixed pen centre — the nearest-subject tie-break in `evaluateFraming` — now
  reads the roamer's live position.
- **Accepted — the room is 「どうぶつパーク」.** The internal id stays `zoo` for
  save-file and module compatibility; renaming folders was not worth the churn.

## 2026-09-20 — Owner's corrections after playing the animal park

All four came from the owner playing the park, and three were things no test
caught. Worth remembering: **orientation and camera handedness are judged by
looking, never by reasoning about the maths.**

- **Fixed — the animals walked backwards.** Every entry in `ANIMAL_MODELS`
  carried `yawOffset: Math.PI`, inherited from the fenced zoo where animals
  stood still facing a viewpoint. These models face local **+z** at rotation 0,
  and the roaming code sets an animal's rotation to its heading, so the offset
  turned each of them through 180° and they moonwalked to their destinations.
  The offset is deleted. The playthrough never noticed, because it checks that
  the *player* faces the animal, not which way the animal faces.
- **Fixed — the viewfinder turned the wrong way.** `updateViewfinderMovement`
  did `player.rotation.y += move.x`. With the camera looking along
  `(sin y, cos y)`, screen-right in world is `(-cos y, sin y)`, which is where a
  *smaller* yaw points — so pressing D swung the view left. Now `-=`.
- **Accepted — the giraffe stands still.** Its own pack ships no walk cycle and
  the one retargeted from the styloo cow reads as wrong on a giraffe's build:
  the legs stride correctly but the gait is a cow's. The owner judged a still
  giraffe better than a strange one. `territories.js` gives it speed 0 and
  `roaming.js` treats speed 0 as "never walks", so it idles where it spawned —
  which also makes it a dependable landmark in the open grassland. The walk clip
  stays in the bundle, unused, if anyone wants to revisit it.
- **Accepted — one plant palette, led by grass.** Every plant already came from
  Quaternius Nature, but the palette was wide: two pines, a dead tree, ferns,
  flowering bushes, two rocks and pebbles, so each corner looked different
  without looking better. It is now six: two grasses, one bush, one broadleaf
  tree, one pine, one rock. Grass count roughly doubled and the farm meadow and
  cove gained their own, so grass carries the ground rather than dotting it.
- **Accepted — ground colour comes from the pack's own grass ramp.**
  `Grass.png` is a palette strip, not a tileable ground texture, so it cannot be
  laid on the field. Its colours can: olive `#b19800`, green `#399600`, rust
  `#b95700`, yellow-green `#67a300`. The ground moved from `0x75b866`, a bluer
  green, to `0x74ad3d`, and the area patches followed. The grass tufts no longer
  read as stuck onto a differently-coloured field.

## 2026-09-22 — A reusable scene placement editor, separate from the Zoo

The park's scenery was hundreds of hand-typed coordinates. Moving one tree
meant editing a literal, rebuilding and looking. There is now a browser editor
that selects, moves, rotates, scales, duplicates and deletes things in the live
world and exports the result as portable JSON.

**The split is the decision.** `src/dev/scene-editor/` is generic and may not
import from `src/minigames/`, `src/systems/` or `src/config/`. Everything a
project knows about itself — which assets exist, how one is built, where the
ground is, what may not be walked through — arrives through an adapter.
`src/minigames/zoo/zooEditorAdapter.js` is the first one;
`src/dev/scene-editor/demo/primitiveAdapter.js` is a second built from a cube,
a sphere and a cylinder, and it exists to keep the first from silently becoming
load-bearing. Rejected: building the editor into `world.js`, which would have
been faster and would have made it unusable in any other project.

**The layout JSON is the contract, and the game reads it without the editor.**
`layoutLoader.js` imports no three.js, no DOM and no editor module. An editor
whose output only the editor understands is a drawing of a level, not a level.

## 2026-09-22 — Zoo scenery is data, and the editor needs its own camera

Three things the integration forced, each worth recording because each looks
like an arbitrary choice from the outside.

**Scenery placement moved out of `world.js` into `scenery.js`.** The editor
cannot read, move or write back a literal buried inside a closure. The five
dressing functions are now one data-driven driver over `SCENERY_GROUPS`, and a
test pins the placement count of every group so a row dropped in a later edit
fails the suite instead of quietly thinning out a corner of the park. Nothing
about what is drawn changed.

**Instanced scenery is rebuilt as individual objects while the editor is open.**
Grass, bushes, rocks and the small props are drawn as `InstancedMesh` — one
draw call for dozens of tufts — and an instance cannot be raycast or dragged.
`setSceneryEditable(true)` rebuilds those groups as individual clones, and
closing the editor puts the instancing back. A student's session never leaves
the instanced form, so the draw-call budget the park was built around is
untouched. Rejected: making all scenery individual (costs every student
frames for a tool they will never open), and leaving grass and rocks
uneditable (they are the main thing anyone wants to move).

**The editor takes the camera.** `cameraRig` is a fixed, world-aligned
three-quarter follow with no user rotation at all. Editing through it would
mean adjusting only what happened to stand in front of the avatar, from one
angle, with half the gizmo's axes pointing away. The editor borrows the camera
and restores its position, quaternion, fov **and far plane** on close — `far`
is 100, and a camera pulled back far enough to see the park clips straight
through it. `cameraRig.setEnabled(false)` stops the main loop fighting it.

**The editor is gated twice, because this ships to classrooms.** `P` is exactly
the key a seven-year-old presses. `DEV_TOOLS_ENABLED` (vite dev, or `?editor=1`)
decides whether the key does anything, and the editor is loaded with a dynamic
`import()`, so in a production build it is a separate chunk a student's browser
never requests — nothing to find and nothing to pay for. Rejected: a key
combination alone, which still ships the code.

**Roaming points export as `[x, z]` pairs, not `[x, y, z]` triples.**
`territories.js` authors waypoints as pairs. An export shaped differently from
the file it came from has to be hand-converted every time, which is how a tool
stops being used.

## 2026-09-22 — the paper robot hops; it does not walk

**Locomotion is hopping, not a walk cycle.** The frozen spec said the puppet
would walk: legs alternating, arms swinging opposite. The owner replaced that
with a repeated hop — crouch, pop, airborne, land, recovery bounce — and it is
the better call for a reason worth keeping. A flat cut-out with nine rigid
pieces invites comparison with a real biped the moment it tries to walk, and it
loses that comparison every time; the same pieces hopping read as a
hand-puppeted paper toy, which is exactly what they are. Stylised motion cannot
be judged against reality, so it cannot look wrong. Rejected: the articulated
walk, and also a fully modelled 3D robot, which would have thrown away the one
thing the minigame is for — that *this* drawing, with these accents, is alive.

**Light squash and stretch is allowed; deformation is not.** The spec said
rigid pieces about authored pivots and nothing else. A hop with no compression
on landing reads as a sprite being teleported upward, so a piece group may be
scaled non-uniformly, capped at 0.82–1.18 per axis with the axes compensating.
That is a paper toy flexing, not rubber hose. No skeleton and no vertex
deformation either way, so the puppet is still just textured quads.

**Required-colour labels are placed by hand, not centred automatically.**
Sizing a word from its region's height alone let `RED` spill outside the 55px
antenna light and `YELLOW` past both ends of the eye band. Two fixes, both
kept: `fitLabelFont` measures the word and shrinks it to the box width, and a
region may author a `labelBox` elsewhere with a leader line drawn from the
region's *edge* to the word. The leader is not decoration — `YELLOW` sitting
silently under the eye band read as an instruction about the face. Rejected:
growing the eye band to fit its own label, which would have redesigned the
robot's face to solve a typography problem.

**Two shoulder caps, not one shoulder bar.** A single bar across the full width
read as a plank laid across the robot as soon as a child coloured it differently
from the body. A cap per side reads as a shoulder and does useful work for the
puppet: it belongs to the torso piece and overlaps the arm, so it hides the
joint when the arm swings. The arms were also narrowed from 0.105 wide to 0.072
and lengthened — at the old proportions they were two blobs beside the torso
with no shoulder and no elbow.

## 2026-09-22 — Coloring becomes tap-to-fill, and the drawing walks off the page

**Freehand painting and pixel-grid correctness are deleted, not extended.** The
old minigame gave three colours and three regions, painted with a brush and
graded on a 72×72 grid with a two-cell neatness margin. With eighteen regions,
a dozen of them small accents, a neatness margin stops being forgiving and
becomes impossible: tune it loose and colouring outside the lines is free, tune
it tight and a Chromebook touchpad cannot pass. Tap-to-fill removes the question
— there is nothing to be neat about, so correctness is a map lookup and the
child's attention goes to *which* colour rather than to staying inside a line.
Rejected: keeping the brush for large regions and filling only small ones, which
would have meant two correctness models and two ways to be wrong.

**The puppet is rendered from the shared shape definitions, not cropped out of
the finished canvas.** The plan asked for each puppet piece to be
extracted/masked from the final artwork bitmap. Re-rendering each piece with the
*same* draw code, from the same region definitions and the same colour map,
gives an identical guarantee — every accent survives, because the colours *are*
the artwork — with no crop arithmetic, no texture atlas and no second robot to
drift. `robotRenderer.drawPiece` and the colouring page are literally the same
function with a different region list. Rejected: canvas cropping, whose only
advantage would have been surviving a freehand mode that no longer exists.

**The paper robot turns by flipping, not by rotating.** Facing it along its
travel direction is what a 3D character does, and for a flat cut-out it means
presenting the camera its edge — in the first room test the robot was an
invisible sliver. So the sheet stays nearly parallel to the picture plane: a
heading becomes a mirror on X plus a lean of at most 0.17rad, which is how a
paper puppet turns round in a paper theatre. This is also why the puppet is
unlit `MeshBasicMaterial`: room lighting shading a cut-out makes it a prop, and
flat colour keeps it a drawing.

**Every button lives in one bottom bar.** The tools started as a column beside
the picture, which became a third row on a short screen, which slid the lower
palette rows underneath the できた button — a tap meant for a colour pressed
Done. Consolidating undo/eraser/reset/done into one bar fixed the collision and
gave the picture back the space it most needs, since the picture is the game.
The work area is a grid rather than a flex row for the same reason: a flex line
shorter than its content overflows in both directions, which is how the tool
buttons ended up drawn over the title.

**できた is never disabled.** It used to gate on a minimum painted share. Now it
is an activation attempt that always does something, and "not decorated enough"
is one of the four outcomes with its own friendly message. A greyed-out button
cannot explain itself; a robot that shrugs and asks for more decoration can.

**The `__eslDebug.coloring` hook does not expose the favourite colour.** The
Restaurant, Drink Stand and Zoo already publish debug snapshots for their
playthroughs, so Coloring follows suit — but the two labelled colours are
printed on the page anyway, and the favourite is the one thing a child is meant
to have remembered. A playthrough hears it in the dialogue, like they do, and
discovers the labelled colours by watching their words fade, which tests that
behaviour rather than trusting it.

## 2026-09-22 — the puppet-is-the-drawing claim, measured

**Re-rendering each piece is equivalent to cropping the finished canvas, and
now there is evidence rather than an argument.** The plan asked twice, firmly,
for puppet pieces to be cropped and masked out of the finished bitmap. The
objection to re-rendering is only valid if the two differ, so
`src/dev/robot-preview/index.html` measures it: it draws the finished page and
each of the nine pieces at full resolution and compares them pixel by pixel on
a 3px lattice.

Of **16,180 interior samples, 0 differ**. Interior means fully opaque in its
own piece across its whole neighbourhood *and* alpha exactly 0 in every other
piece there — a neighbour's antialiased outline owns nothing but still tints the
page, and counting those as interior is what first made this look like a real
mismatch. All 92 differences fall in 622 seam samples, where the page carries a
neighbour's black outline over the join and the lone piece does not. That
difference is *correct*: the pieces are coming apart, so a neighbour's ink must
not be baked into them — which is one thing canvas cropping would have got
wrong. All seven colours survive the cut, and region ownership is exclusive.

Keep those checks. They are the only thing standing between "the puppet is the
child's drawing" and a claim nobody has tested.

**The four Done outcomes get four distinct sounds.** They all played the same
cheerful blip, which told a child who cannot read the Japanese quickly nothing
at all. Now: a low buzz for ALMOST, the existing falling `retry` for a failed
start-up, the *ordinary tap* for INCOMPLETE — deliberately not a failure noise,
because nothing is wrong — and the rising `complete` sparkle for success. Plus a
quiet paper-tap on every landing, which the puppet reports through an `onLand`
callback driven by the hop stage now carried on the pose, so `index.js` never
keeps a second copy of the hop clock. `audio.playSfx` falls back to its second
argument for an unknown name, so the two new tones needed no edit to the SFX
table the other four minigames share.

**The antenna glow is a halo, not a blob.** A bright additive core washed the
antenna light to white, and that region is one of the two the child is *graded*
on — its colour has to stay readable. The gradient now peaks at 0.42 of the
quad's radius, just outside the light itself, with a nearly clear centre.

**The carried picture faces the camera, not the NPC.** Held in front of the
player it is physically right and completely invisible: the camera is a fixed
rear three-quarter follow and the child walks away from it to deliver. It now
sits on the player's back facing the viewer, unmirrored. This is the artwork the
whole minigame is about; the delivery walk is pointless if nobody can see it.

## 2026-09-22 — Coloring goes back to freehand, and the bar replaces the answer key

**The instructional robot is deleted.** Eighteen tappable regions, a starred
chest panel, two labelled required colours and four activation outcomes all
graded beautifully and produced a worksheet — the owner's words were "too
segmented and instructional" and "disconnected construction pieces". It is
replaced by one connected robot, painted freehand, with nothing written on it.
No colour names, no star, no required region. A child looks at the page and
sees a colouring book.

Gone with it: `colorState.js`, `robotScoring.js`, region types, label placement
and leader lines, tap-to-fill hit testing, the four outcomes, and the 40%
free-region rule. They are deleted rather than left switched off, because two
competing models of what "coloured correctly" means is how a codebase rots.

**Proportions come from the original v1 robot, but v1 was not connected.** Its
head and torso had a 0.03 gap, and so did its torso and arms; its legs were
open decorative *lines*, not shapes at all. What made it read simple was four
big shapes with no internal subdivisions, not literal connectivity. So this
robot takes v1's proportions — big head panel, big torso, chunky arms, feet
below, antenna — and closes the gaps with a neck and with limbs that overlap
the torso. The overlap is load-bearing twice: it makes the drawing read as one
robot, and it hides the puppet's seams.

**ROBOT POWER, and the three rules that make it unfarmable.** Unique area only,
so scribbling the same patch charges nothing; inside the silhouette only, so
colouring the background charges nothing; and a cell's credit is fixed by the
colour that *first* painted it, so repainting in the favourite cannot upgrade
old area. Stroke count, elapsed time and brush travel are worth nothing by
design — each is what a child would otherwise game. Full at 68% of the robot,
measured at 69.5% coverage in a real browser, after 21 large-brush sweeps.

**The favourite colour is a bonus, not a gate.** New area in the NPC's colour
charges 1.5x, measured at exactly 1.500x in the browser. A child who never
remembers it still activates the robot by colouring enough. The listening task
keeps its teeth at the *turnaround*, where the child still has to say
`I like ___` themselves — so making the colouring page forgiving costs the
lesson nothing while removing the answer-sheet feel. Nothing here can fail.

**No Done button.** Activation starts by itself when the bar fills, which is
the only thing that makes the bar mean anything. A button next to a full bar
asks a child to confirm what they can already see.

**Five puppet pieces, and every limb behind the body.** Nine was too segmented
for a flat paper toy: every joint is a seam that can show. `body` is head, neck,
torso and antenna as one continuous cutout. Putting the limbs *behind* the body
is what hides the joints — with an arm in front the join becomes a visible step
and the torso's paint shows on the arm. The forearm-lags-the-upper-arm trick
that sold the hop is gone with its pieces, so the lag moved to the whole arm:
each arm is posed from slightly earlier in the hop cycle than the body.

**Puppet textures now come from the paint canvas, and this time there is no
choice.** The previous pass re-rendered each piece from region colours and
measured that it was pixel-identical to cropping the canvas. With freehand
painting that equivalence is gone: the canvas holds brush strokes, gaps and
half-covered areas that no region data can reproduce. So `drawPiece` clips to a
piece's own silhouette shapes and stamps the real canvas through that clip.
Paint that spilled *outside* the lines is left behind, which is exactly why
spilling is allowed on the page and invisible on the robot.

**A short 420px-tall window is a real layout case, not a curiosity.** At
760x420 the header stacked, and the palette, the power bar and the tools each
took a row of their own, leaving the canvas 130px — too small to paint a robot
on. Header stacking is now keyed to width alone, and on a short screen the
power label sits beside its track with the tools on the same line. The canvas
went to 229px. The picture gets the space because the picture is the game.

## 2026-09-22 — Coloring becomes a loop, and the way out is a door

**The minigame is now indefinite, so it needed an exit it never had.** The
owner's plan deletes the artist, the gift, the wall frame and the turnaround —
and `finish()` was called from the turnaround. Implemented literally, the plan
traps the child in Coloring forever, awards no stamp, and drops a *frozen*
`SPEC.md` requirement: the student SAYS `I like ___` once per minigame, and the
hub reads that answer back. So the room gets a plain labelled doorway
(「おわる」), and the turnaround hangs on it. **The robot the child made most
recently is the one that turns around and asks.** That is better than the artist
NPC it replaces, not a fallback for it: your own creation asking you the
question is the fiction the whole loop is building. Rejected: ending on a timer,
ending after N robots, and an exit button in the HUD — all three end the session
*at* the child rather than *by* the child.

**Stars come from the session, not from a round.** There is no result modal any
more, and coverage cannot be graded — a robot that exists has already passed the
68% threshold by definition. So `scoreRound()` was deleted and replaced by
`sessionStars(robots) = min(3, robotsCompleted)`, never less than 1.
Accumulation is the reward the plan asks for, so accumulation is what the stamp
counts.

**Three camera stages, and a cross-fade instead of the wipe.** `transitions.run()`
is a scale-X wipe — a hard cut, which would break the illusion exactly where the
illusion matters. So stage 1→2 draws the finished page onto the easel's canvas
texture, frames the camera tight on it, and fades the DOM screen's opacity to 0:
the child sees the same picture they were painting, now on an easel, with their
own avatar in front of it. The wipe is still right for `to-canvas`, which is a
deliberate change of view and not an illusion. `cameraRig` already damps toward
whatever preset it is given, so the staged pullback is three `setPreset` calls
and no tween code.

**Crowd spacing is decided once, at join — never per frame.** Robots accumulate
without a cap, so they need to not stack, but a steering or avoidance loop is
what makes toys jitter. Instead each robot gets its own displaced copy of the
authored roam points (ring offset by golden angle from its index), its own start
index, its own idle pause and its own phase offset. Nothing recomputes, nothing
can oscillate, and two robots cannot converge on one authored point because they
do not share one. Occasional overlap is accepted; a persistent stack cannot
happen.

**Retaining every robot is paid for per robot, never by eviction.** The two
radial textures (shadow, glow) are module singletons that a puppet's `dispose()`
must never touch, piece geometry is shared, and room puppets drop from a 900px
texture sized for a close-up that no longer happens. Measured at 15 robots:
no canvas is created after construction, and none is redrawn per frame.

## 2026-09-23 — Coloring correction: listening gates power, while creations persist

**ROBOT POWER now measures only the robot's currently painted favourite-colour
area, reaching full at 28% of the silhouette.** Repaint, erase and undo all use
the existing per-stroke cell journal, so the current colour is the single source
of truth and ordinary colours remain creative choices without charging the bar.
This deliberately restores the risk that a child who misses the spoken colour
can get stuck; the owner accepted that cost to give the listening task teeth.
Rejected: retaining ordinary-colour credit, adding a favourite bonus, or keeping
a second coverage history beside the stroke journal.

**Finished robots persist for the running app session as detached artwork plus
their crowd personality.** The live paint canvas is copied exactly once before
round teardown; re-entry reconstructs fresh puppets and textures from those
plain records. This preserves gaps, mixing and individual movement without
retaining three.js objects or allowing the next page reset to repaint an old
robot. Rejected: `localStorage`, retaining disposed puppets, shared live canvas
references, and clearing the collection on minigame exit.

**The coloring page uses balanced side columns, and the room is authored from
one dimension set.** A reserved right-hand spacer keeps the canvas centred when
the left tools change visibility. The floor, three equal-height walls, trims and
doorway now derive from room and door constants, with overlapping corners.
Rejected: hiding the tool column with `display: none` and patching individual
wall coordinates, both of which preserve the visible defects.

**The easel is an A-frame and the emergence keeps its landing continuity.** Two
splayed front legs visibly carry the shelf, a raked rear leg supports them, and
the paper/art planes lean together under one parent. During the peel the player
eases backward for 0.55 seconds; after landing the easel view holds for 1.2
seconds, then roaming begins from the actual landing position. Rejected: moving
the player in one frame, snapping the robot to its first roam point, shortening
the viewing beat, or leaning page layers independently.


**The retreat steps aside, not just back — the first version was correct and
still wrong.** The player was moved 1.25 units backward, world-space separation
from the newborn robot was achieved, the harness check passed, and the robot was
*still* behind a shoulder in the rendered frame. The camera sits behind the
player, so retreating moves them **towards the lens**: they grow on screen and
occlude more, not less, however far they step. The retreat now carries a 1.85
lateral component and a partial turn to watch, which clears the robot in the
only space the child is looking at. Recorded because the reasoning generalises:
world-space distance is not screen-space clearance, and no positional assertion
can tell the difference. This one was caught by looking at a screenshot.

**The doorway lintel overlaps its wall spans instead of meeting them.** Butting
the pieces at exactly `doorLeft`/`doorRight` left a hairline seam from the
door's head to the ceiling on both sides — two faint vertical lines, plainly
visible in a room screenshot and invisible to all 600 tests. The lintel sits
above the opening, so widening it by one wall thickness costs the doorway
nothing. Rejected: nudging the spans, which reintroduces the magic numbers the
constants pass removed.

**The debug snapshot exposes the newborn puppet during the cinematic.** Between
the authored landing and the first roam step the robot is not yet in
`livingRobots`, so no observer could see it — precisely the window in which a
snap to a roam point would hide. A harness check written against the player's
position appeared to pass for the wrong reason, and broke the moment the retreat
gained a sideways component. Position only; the favourite colour still never
appears in the snapshot.

## 2026-09-23 — Coloring polish: finishing is the child's decision

**Full ROBOT POWER is permission to finish, not the trigger.** Reaching full
power enables a distinct 「できた！」 action while painting, colour choice,
erasing and undo remain available. Readiness follows the live favourite-colour
area in both directions, but its celebration fires only on the first enable in
the round. The child decides when the robot is finished. Rejected: automatic
activation at full power, because it takes the page away while the child may
still be decorating it; and a confirmation dialog, because the explicit Done
press already is the decision.

**The paper moves in front of the easel frame, and the calibrated camera moves
with it.** The sheet now has one local z source of truth; the shelf and newborn
puppet derive their positions from it, while the tight camera derives its offset
from the sheet plus the unchanged 2.55-unit viewing gap. That preserves the DOM
page-to-easel cross-fade scale while clearing every structural upright. Rejected:
`renderOrder`, disabling depth tests, or moving only the sheet — the first two
hide incorrect geometry, and the last makes the 3D page about 8% larger at the
handoff.

**The answer bubble persists through coloring and owns replay.** The spoken
`I like <colour>.` stays beside the drawing as a light memory aid, with a small
speaker button inside the same bubble. Replays pulse that bubble and still set
the scoring memory flag. Rejected: a separate Listen Again control and a second
temporary answer notice, because both duplicate the answer and split one idea
across unrelated parts of the screen.

## 2026-09-23 — Coloring polish: four defects the tests could not have found

**An empty stroke still takes a slot in the coverage journal.** `endStroke()`
pushed only when a stroke had touched a silhouette cell, while `picture.js`
pushes every stroke onto its paint stack and `undo()` pops both together. A
stroke painted entirely in the paper margin — decorating the background —
desynchronised the two for ever: the next もどす rubbed the doodle off the page
while subtracting an EARLIER stroke's power from the meter, with no way back.
Pre-existing, but this pass widened it sharply, because inviting the child to
keep painting at full power is an invitation to decorate the margin, and the
consequence is `できた！` disabling itself unrecoverably. Two unit tests asserted
the old behaviour on purpose ("no-op repeats must leave the original meaningful
stroke as the undo target"); that reads well only while the journal is consumed
alone, which it never is. Rejected: a second history, or making `undo()` skip
empty strokes on the paint side, which would desynchronise the same two stacks
from the other end.

**The answer bubble does not take pointer events.** Making it persist through
coloring (this pass) silently made the paper beneath it unpaintable — at
760x420 that includes part of the robot's head, which is silhouette the child
must paint to charge the meter. It never mattered before, because the bubble
vanished 2.35s after the answer, before painting began. The speaker inside it
keeps `pointer-events: auto`. No assertion could catch this: the harness aims
its strokes at the silhouette and simply covers fewer cells when some are
blocked — it never asks whether a particular point accepted paint.

**The debug fingerprint samples 24 points, not 6.** Six points across the body
piece catch a decoration dab and little else on a sparsely painted robot, so two
robots told DIFFERENT colours collided on their shared red decoration alone and
the distinctness check cried wolf on an unlucky random draw. Resolution, not
semantics; `fingerprint(samples)` already took the argument. Rejected: relaxing
the check, which is one of the eight that make the harness trusted.

**The playthrough harness runs against `dist/`, and never builds it.**
`playthrough-run.mjs` spawns `vite preview` and only checks that `dist/` is
non-empty, so a source change not followed by `npm run build` is graded against
the previous build. Three runs in this pass were spent on that, and the tell was
a floating-point power value reproducing to all 16 digits across a supposedly
changed code path. Recorded because nothing in the harness says so.

## 2026-09-23 — Coloring robots visit the Restaurant

**The paper puppet's ground baseline stays derived from its silhouette.** The
lowest painted point in the robot definition remains the source of truth for
world Y=0, so the Restaurant can place a fresh puppet at `groundY` without
duplicating a foot measurement or inheriting a stale magic number. Rejected:
typing a Restaurant-specific feet offset, because a future silhouette edit
would make the same artwork sink or float in one minigame only.

**Every shift with saved artwork reserves one of its first three arrivals for a
robot, then gives every other arrival a 0.25 chance.** The reserved index is
chosen uniformly from the first three slots, clamped to the shift length, so a
child reliably meets their creation early without making the opening customer
predictable. Rejected: probability alone, because even a generous chance can
produce a whole shift with none of the child's robots; and reserving slot zero,
because the reveal would become mechanical.

**A yaw guard keeps the paper sheet 0.44 radians away from edge-on.** The inner
puppet eases toward the Restaurant character's heading but holds a stable side
of the guard band during the sustained sideways step to a chair. This preserves
the wanted flat-paper turn while retaining at least about 42 percent of the
sheet's width. Rejected: increasing `PAPER_DEPTH` or `PAPER_EDGE`, because that
would change every Coloring puppet and make paper read as a thick object rather
than solve the Restaurant camera angle.

**Shared paper assets are freed only when the live-puppet count reaches zero.**
Each fresh puppet increments the count and an idempotent dispose decrements it;
`disposeSharedPaperAssets()` does nothing while any puppet still uses the quad
or gradients. Rejected: letting each minigame unconditionally free the shared
objects on exit, because Restaurant and Coloring now construct the same kind of
puppet and one owner cannot safely assume no other live instance exists.

## 2026-09-23 — Shell navigation and Escape authority

**Back is one shell-owned control.** The shell creates a single upper-left Back
button, mirrors the Settings launcher's safe margin, and routes it through the
existing `returnToHub()` transition and controller teardown. This keeps its
position, styling, availability and stacking consistent across every minigame.
Rejected: separate Back buttons in each minigame, because they would duplicate
navigation and could drift in placement or bypass shared teardown.

**Escape uses a most-recent-first guard registry.** The Back control owns the
only global Escape listener. Settings, the stamp book and temporary minigame UI
register guards that may consume one press before Back runs, and minigames
unregister their guards on exit. Rejected: relying on DOM listener order, which
can close a local UI and leave the game on the same press, and querying a fixed
set of modal-open states from the shell, which would couple it to local UI
implementations.

**Shell modals outrank a minigame's Escape guard.** Most-recent-first alone was
not enough: the Zoo's viewfinder sits at `z-index: 18` and the Settings launcher
at 40, so a child can open the Settings panel on top of an open viewfinder — and
the later-registered viewfinder guard would then close the thing they cannot see
instead of the panel they are looking at. Guards therefore carry a priority, and
Settings and the stamp book register at `SHELL_MODAL_ESCAPE_PRIORITY`. Rejected:
reordering registration, which the entry-time lifecycle of a minigame makes
impossible, and giving the shell a list of known modals, which re-couples it to
each local UI.

## 2026-09-23 — The finished picture asks again every time

**`できた！` is the primary action, Undo and the eraser stay utilities.** At full
power Done alone turns brighter green, gains a gold ring and a gold star, and
rests at `scale(1.06)`; below full power it is flat grey with no glow and no
motion at all. Emphasis is transform-only so the two buttons beside it never
shift under a child's hand. Rejected: an emoji sparkle — ✨ renders as a dark
monochrome glyph on this green and reads as a smudge at tool size.

**The full-power cue replays on every fresh arrival at full, not once a round.**
`createCompletionReadiness` now re-arms the moment readiness is lost, so a child
who erases their liked colour and paints it back is invited to press Done again.
Holding at full still celebrates nothing — the trigger is the below-full → full
edge, never the state. This reverses the once-per-round rule recorded earlier in
this file: that rule was written when the concern was cue spam, and edge
triggering already prevents that without also punishing a child who keeps
working on a finished picture.

**The cue waits for the brush to lift.** The painting surface reports on every
pointer move, so full power almost always arrives mid-drag; firing three pulses
under a moving brush is exactly the distraction a painting child does not need.
`picture.js` now reports `strokeActive`, and the page holds the celebration
until the stroke ends. Rejected: debouncing on a timer, which would fire in the
middle of a long sweep just the same.

## 2026-09-23 — Coloring subjects are frozen data behind one contract

**Every colorable figure is one deeply frozen subject object.** Its pieces,
pivots, parent tree, depth, silhouette shapes, details, personality and live
scale travel together, while geometry, rendering, coverage and puppet code take
that object explicitly. This makes authored data the only variable between
figures and prevents one module from silently falling back to the robot.
Rejected: parallel per-character modules or keeping robot constants as implicit
globals, both of which would duplicate engines or let page and puppet drift.

## 2026-09-23 — Line-art details are typed drawing primitives

**Small visual details are an ordered list of line, circle, arc, polygon and
triangle marks owned by pieces.** The renderer loops over them; the robot's
mouth, bolts, cuffs and knees use their original coordinates and weights. This
lets later noses, buttons, scarves, beaks and ties remain data. Rejected: named
fields such as `mouth` and `bolts`, or subject-id branches in the renderer,
because every new figure would otherwise expand renderer policy.

## 2026-09-23 — One motion engine reads declarative personality

**Idle, startup, hop, land, celebration, blink and squash/stretch remain shared
mechanics, while per-state root amounts and per-piece rotation drivers live in
the subject personality.** The engine starts from the subject's own piece list,
so absent legs and future heads or tails require data rather than code. Rejected:
one animation implementation per subject and subject-id switches, which would
make timing fixes diverge across the cast.

## 2026-09-23 — Coloring saves creations; robots remain a compatibility view

**Session records now carry `{ subjectId, artwork, crowd }`, and Coloring reads
them through `savedCreations()`.** `savedRobots()` remains as a filtered view for
Restaurant and treats id-less legacy records as robots, so Restaurant's customer
scope does not widen. Rejected: broadening Restaurant to every subject, deleting
the old view, or adding browser persistence; each changes behavior outside this
contract migration.

**The shell reserves its corner; the shared top bar moves over.** Adding Back
uncovered that `.top-bar` — used by Coloring, the Drink Stand, Sports, the Zoo
and the hub — starts its scene card in exactly the corner Back now occupies, so
the room title and hint sat underneath the button. The back control sets a
`shell-has-back` class on the document while it is visible and one shared rule
pads the bar clear of it. Rejected: nudging each minigame's own card, which is
four places to keep in sync and would have left the hub's bar indented for a
button that is not there.
