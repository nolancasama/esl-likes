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
