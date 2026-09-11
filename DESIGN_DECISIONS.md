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
