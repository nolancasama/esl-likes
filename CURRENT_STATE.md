# Current State

## Status

All five minigames are playable end to end in the shared 3D shell: Restaurant,
Coloring v1, Drink Stand v1, Sports v1 and Zoo v1. The collection is feature
complete against SPEC.md. Zoo has passed Claude's review (see Verified) and
awaits the user's review. Nothing is in flight.

## What Exists

- `SPEC.md` — the frozen design: the anti-shortcut rule, the vocabulary rule,
  the listening-again policy, and all five minigames.
- Vocabulary in `src/config/lesson.js`: one `{ id, answer }` per item with the
  exact sentence and natural plurals; `answerFor`, `answerChoices`.
- Speech: hold-to-talk plus the forgiving matcher. Shared prompts in
  `src/systems/speechPrompt.js`. Shared 🔊 control in `src/ui/listenAgain.js`.
- Shell: hub with five doors, stamp book (renders the zoo photo), settings, HUD
  with the two-failure fallback, dialogue (balanced lines, Japanese phrases kept
  whole), progression and save (`esl-likes-save-v1`), transitions, characters.
  The minigame context also offers `captureFrame(draw)`, which renders one frame
  and lends the canvas so a minigame can copy real pixels.
- Restaurant, Coloring v1, Drink Stand v1, Sports v1 — see SPEC sections 4 to 7.
- Zoo v1 (`src/minigames/zoo/`): entrance plaza, one looping path past six
  habitats with signs and slow-moving animals, landmarks. Ask a visitor, hear
  "I like elephants.", find the habitat, frame the animal in the 2D viewfinder
  and shoot, return and press Space to show the photo. The camera holds ONE
  photo. Wrong animal: Japanese refusal, no English repeat, try again. L1/L2/L3
  = 3/4/6 requests with 1/2/3 visitors waiting; no timer. Pure tested scoring in
  `scoring.js` (first 5, later 2, framing x2, memory 1; first-try share under
  half caps at 2 stars) plus `measureFraming`. The finished photo is saved to
  the stamp book. Read-only hook `window.__eslDebug.zoo` (no wanted animals).
- Conventions: Kenney models face +z; movement heading is `atan2(x, -y)`;
  `characters.playerModel` is the one avatar key; the follow camera sits
  directly behind the avatar, never off to one side.

## Verified

- `npm test` 128/128; `npm run build` clean.
- All five playthroughs pass against the same build, mic-free:
  `scripts/playthrough.mjs` 23/23, `playthrough-coloring.mjs` 25/25,
  `playthrough-drink.mjs` 23/23, `playthrough-sports.mjs` 21/21,
  `playthrough-zoo.mjs` 24/24. No console errors.
- Zoo session A (listening): three visitors asked, exact sentences, answer not
  left on screen, 🔊 replays it, viewfinder refuses a badly framed shot, the
  photo is of the named animal, requests completed, turnaround with six animals,
  hub greeting, stamp and answer saved, 3 stars after one replay, a real photo
  (11 kB JPEG) rendered in the stamp book, clean re-entry. Session B (showing a
  wrong animal first): Japanese refusal without English, still finishes with the
  stamp, capped at 2 stars.
- Zoo anti-shortcut review: animals uniformly random per visitor, independent of
  model, spot and order, repeats allowed (no elimination); nothing points the
  way; one carried photo makes touring cost a walk back per attempt.
- Screenshots reviewed for every minigame.

## NOT Verified — Manual Chromebook Pass Required

Real speech recognition cannot run headless. On a classroom Chromebook with its
microphone, check: holding the talk button starts listening; "What food do you
like?" is accepted; failed or partial speech reaches Try Again; after two
failures the fallback works. Also check real trackpad play (Coloring painting,
Drink Stand clicking, Zoo aiming) and levels 2 and 3 of every minigame — only
level 1 is scripted. Record findings here. Do not redesign speech unless this
pass exposes a problem.

## Known Limits

- Zoo photos are framed by the child, so a saved photo may show more sign and
  fence than animal. The framing score reflects that; it is not a bug.
- Sports: far signs are small in the opening overview; the follow camera can
  briefly put the avatar in front of a friend entering a zone.
- Drink Stand: two-word signs sit tight against the sign's bottom edge;
  customers are scaled up, so the waiting line looks large.
- The Coloring NPC wears two palette colours; the result card never names the
  NPC's colour. Consider after classroom observation.
- Bundle over 600 kB (three.js); phonetic tables are guesses until real
  classroom transcripts exist; 2.5 s character preload cap.

## Next Steps

1. User review of the Zoo slice, and of the collection as a whole.
2. The manual Chromebook pass above, then extend the phonetic tables from what
   real children say.
3. Possible polish after classroom observation: difficulty tuning, the Coloring
   result card naming the colour, bundle splitting.

## Codex / Delegated Work

None in flight. Zoo v1 (Codex, Sol) reviewed and accepted. Claude fixed, in the
Zoo: blank saved photos (added `ctx.captureFrame`), a shutter that stayed lit
with stale framing state through the opening wipe and ate the press, mirrored
sign lettering, and an overflowing carried-photo label.
