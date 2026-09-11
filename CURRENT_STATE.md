# Current State

## Status

Four minigames are playable end to end in the shared 3D shell: Restaurant,
Coloring v1, Drink Stand v1 and Sports v1. Zoo is not started; the hub shows it
as coming soon. Sports has passed Claude's review (see Verified) and awaits the
user's review. Do not start Zoo until the user has reviewed it.

## What Exists

- `SPEC.md` — the frozen design, including the anti-shortcut rule, the
  vocabulary rule, the listening-again policy, Coloring v1, Drink Stand v1 and
  Sports v1.
- Vocabulary in `src/config/lesson.js`: one `{ id, answer }` per item with the
  exact sentence and natural plurals; `answerFor`, `answerChoices`.
- Speech: hold-to-talk plus the forgiving matcher. Shared prompts in
  `src/systems/speechPrompt.js`. Shared 🔊 control in `src/ui/listenAgain.js`.
- Shell: hub with five doors, stamp book, settings, HUD with the two-failure
  fallback, dialogue (balanced lines, Japanese phrases kept whole),
  progression and save (`esl-likes-save-v1`), transitions, Kenney characters.
- Restaurant; Coloring v1 (`src/minigames/coloring/`); Drink Stand v1
  (`src/minigames/drinkStand/`) — see SPEC sections 4 to 6.
- Sports v1 (`src/minigames/sports/`): plaza plus four corner zones (goal and
  pitch, hoop and court, backstop and diamond, net and sand) with large signs,
  zone corners shuffled per session. Ask a waiting friend, hear "I like ___.",
  they follow; entering a zone makes every matching follower join and play
  (procedural ball animation); a zone with no match gives ここじゃないよ with no
  English and costs every current follower their first-try credit. L1/L2/L3 =
  3 one at a time / 4 in waves of two / 6 in waves of three; no timer.
  Turnaround with a coach, then the avatar runs to the chosen sport. Pure
  tested scoring in `scoring.js` (first 5, later 2, memory 1; first-try share
  under half caps at 2 stars). Read-only test hook `window.__eslDebug.sports`
  (player, zones, NPC states and positions; no wanted sports).
- Conventions: Kenney models face +z; movement heading is `atan2(x, -y)`;
  `characters.playerModel` is the one avatar key.

## Verified

- `npm test` 121/121; `npm run build` clean.
- Playthroughs, all mic-free, all after the shared dialogue change:
  `scripts/playthrough.mjs` (Restaurant) 23/23,
  `scripts/playthrough-coloring.mjs` 25/25,
  `scripts/playthrough-drink.mjs` 23/23,
  `scripts/playthrough-sports.mjs` 21/21.
- Sports session A (listening, keyboard): three friends asked, exact
  sentences, answer not left on screen, 🔊 replays the exact sentence, each led
  straight to their zone and joined, turnaround with four sports, hub greeting,
  stamp and answer saved, 3 stars after one replay, clean re-entry. Session B
  (touring with the heard zone last): ここじゃないよ without English, friend keeps
  following, still finishes with the stamp, capped at 2 stars. No console
  errors. Random touring reaching 3 stars is measured in the unit test (under
  1%); a lucky first-zone guess is allowed by SPEC.
- Sports anti-shortcut review: sports uniformly random per friend,
  independent of model, spot and order, repeats allowed (no elimination); zone
  corners shuffled; friends carry nothing sport-related; no persistent answer;
  touring costs the dominant first-try credit.
- Screenshots reviewed: field, answer, following, playing in a zone, wrong
  zone, turnaround two-shot (reframed side-on by Claude after the first pass
  hid the coach behind the avatar).

## NOT Verified — Manual Chromebook Pass Required

Real speech recognition cannot run headless. On a classroom Chromebook with its
microphone, check: holding the talk button starts listening; "What food do you
like?" is accepted; failed or partial speech reaches Try Again; after two
failures the fallback works. Also check real trackpad play in Coloring and
Drink Stand, and levels 2 and 3 of Restaurant, Drink Stand and Sports (only
level 1 is scripted). Record findings here. Do not redesign speech unless this
pass exposes a problem.

## Known Limits

- Sports: signs on the far zones are small in the opening overview (they grow
  as the child approaches); the follow camera can briefly put the avatar in
  front of a friend as they run into their zone.
- Two-word Drink Stand signs sit tight against the sign's bottom edge; Drink
  Stand customers are scaled up, so the waiting line looks large.
- The Coloring NPC wears two palette colours; the result card never names the
  NPC's colour. Consider after classroom observation.
- Bundle over 600 kB (three.js); phonetic tables are guesses until real
  transcripts exist; 2.5 s character preload cap.

## Next Steps

1. User review of the Sports slice.
2. The manual Chromebook pass above.
3. Only then Zoo (SPEC section 8), applying the anti-shortcut review first.

## Codex / Delegated Work

None in flight. Sports v1 (Codex, Sol) has been reviewed and accepted; Claude
applied the side-on two-shot camera and the shared bubble wrapping fix.
