# Current State

## Status

Three minigames are playable end to end in the shared 3D shell: Restaurant,
Coloring v1 and Drink Stand v1. Sports and Zoo are not started; the hub shows
them as coming soon. Drink Stand has passed Claude's review (see Verified) and
awaits the user's review. Do not start Sports until the user has reviewed it.

## What Exists

- `SPEC.md` — the frozen design, including the anti-shortcut rule, the
  vocabulary rule, the listening-again policy, Coloring v1 and Drink Stand v1.
- Vocabulary in `src/config/lesson.js`: one `{ id, answer }` per item with the
  exact sentence and natural plurals; `answerFor`, `answerChoices`.
- Speech: hold-to-talk plus the forgiving matcher (phonetic variants, singular
  or plural, closest match). Shared prompts in `src/systems/speechPrompt.js`.
- Shell: hub with five doors, stamp book, settings, HUD with the two-failure
  fallback, dialogue, progression and save (`esl-likes-save-v1`), transitions,
  Kenney characters. Shared 🔊 listen-again control (`src/ui/listenAgain.js`).
- Restaurant: asking again forfeits that customer's memory bonus only.
- Coloring v1 (`src/minigames/coloring/`): Art Room -> question -> 2D robot
  colouring -> stars -> gift -> turnaround. Favourite colour and starred region
  independently random; pure tested scoring grid.
- Drink Stand v1 (`src/minigames/drinkStand/`): fixed camera over a three-row
  stand (customers at three windows, avatar in a small work area, six large
  signed stations). WASD + Space by proximity, or click/tap a station or
  customer and the avatar walks there and acts. Ask -> "I like ___." bubble
  that disappears -> pour -> serve. Wrong drink is declined in Japanese with no
  English repeat. L1/L2/L3 = 6/7/8 customers, 1/2/3 at windows, overflow line
  on the customer side with paused patience; RUSH finale; combo for
  consecutive first-try serves; patience pauses while the child speaks;
  turnaround with all six drinks. Pure tested scoring in `scoring.js`
  (first try 5, later 2, patience x2, memory 1, streak 0.5; first-try share
  under half caps at 2 stars). Read-only test hook
  `window.__eslDebug.drinkStand` (positions, no wanted drinks).
- Conventions: Kenney models face +z; movement heading is `atan2(x, -y)`;
  `characters.playerModel` is the one avatar key.

## Verified

- `npm test` 114/114; `npm run build` clean.
- `scripts/playthrough.mjs` (Restaurant) 23/23 and
  `scripts/playthrough-coloring.mjs` 25/25 — last run before Drink Stand; the
  Drink Stand change touched shared code only in the registry and lesson flag.
- `scripts/playthrough-drink.mjs`: 23/23, click-only (trackpad route), mic-free.
  Session A (listening): six customers asked, answered with exact sentences,
  order not left on screen, 🔊 replays the exact sentence, pour and serve by
  click, RUSH, combo, turnaround with six drinks, hub greeting, stamp and
  answer saved, 3 stars after one replay, clean re-entry. Session B (guessing
  stations in order): wrong drinks declined without English, still finishes
  with the stamp, capped at 2 stars. No console errors.
- `scripts/speech-states.mjs`: 9/9 against a scripted fake recogniser.
- Drink Stand anti-shortcut review: drinks uniformly random per customer and
  independent of model, window and order; repeats allowed (no elimination);
  stations shuffled per session; nothing highlighted or preselected; no ticket
  or persistent text; guessing costs the dominant first-try credit.
- Screenshots reviewed: stand, customer answering at a window, pour, turnaround
  two-shot.

## NOT Verified — Manual Chromebook Pass Required

Real speech recognition cannot run headless. On a classroom Chromebook with its
microphone, check: holding the talk button starts listening; "What food do you
like?" is accepted; failed or partial speech reaches Try Again; after two
failures the fallback works. Also check real trackpad play in Coloring and
Drink Stand, Restaurant levels 2 and 3, and Drink Stand levels 2 and 3 (only
level 1 was scripted). Record findings here. Do not redesign speech unless this
pass exposes a problem.

## Known Limits

- The shared dialogue bubble can wrap a lone last word ("What drink do you /
  like?"). Cosmetic; a shared fix in `dialogue.js` would affect every minigame.
- Two-word station signs ("orange juice") sit tight against the sign's bottom
  edge; readable.
- Drink Stand customers are scaled up for visibility, so the overflow line of
  waiting customers looks large beside the right window.
- The Coloring NPC wears two palette colours; the result card never names the
  NPC's colour. Consider after classroom observation.
- Bundle over 600 kB (three.js); phonetic tables are guesses until real
  transcripts exist; 2.5 s character preload cap.

## Next Steps

1. User review of the Drink Stand slice.
2. The manual Chromebook pass above.
3. Only then Sports (SPEC section 7), applying the anti-shortcut review first.

## Codex / Delegated Work

None in flight. Drink Stand v1 (Codex, Sol) plus two correction passes
(customer visibility, queue placement and click swallowing, sign size,
turnaround grounding) have been reviewed and accepted by Claude.
