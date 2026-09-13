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
