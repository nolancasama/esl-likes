# Current State

## Status

Two minigames are playable end to end in the shared 3D shell: Restaurant and
Coloring v1. Drink Stand, Sports and Zoo are not started; the hub shows them as
coming soon. Do not start Drink Stand until the user has reviewed the Coloring
slice (Claude's review is done — see Verified).

## What Exists

- `SPEC.md` — the frozen design, including the anti-shortcut rule, the
  vocabulary rule, the listening-again policy and Coloring v1.
- Vocabulary in `src/config/lesson.js`: one `{ id, answer }` per item with the
  exact sentence and natural plurals; `answerFor`, `answerChoices`.
- Speech: hold-to-talk plus the forgiving matcher (phonetic variants, singular
  or plural, closest match). Shared prompts in `src/systems/speechPrompt.js`
  (`promptQuestion`, `promptAnswer`).
- Shell: hub with five doors, stamp book, settings, HUD with the two-failure
  fallback, dialogue, progression and save (`esl-likes-save-v1`), transitions
  (also in the minigame context), Kenney characters.
- Shared 🔊 listen-again control (`src/ui/listenAgain.js`): secondary,
  Tab-reachable, never on Space.
- Restaurant: asking again forfeits that customer's memory bonus instead of
  deducting score.
- Coloring v1 (`src/minigames/coloring/`): Art Room NPC -> question -> answer ->
  2D robot colouring (three regions, red/blue/yellow, interpolated brush, no
  default swatch) -> できた -> stars -> back to 3D -> give the picture, which
  hangs in the wall frame -> turnaround with all seven colours. The favourite
  colour and the starred region are independently random each round; the free
  regions have no target colours; scoring is a pure, tested 72x72 grid in
  `scoring.js`.
- Conventions: Kenney models face +z; movement heading is `atan2(x, -y)`;
  `characters.playerModel` is the one avatar key.

## Verified

- `npm test` 106/106 (matcher, vocabulary contract, Coloring scoring);
  `npm run build` clean.
- `scripts/playthrough.mjs` (Restaurant, mic-free, level 1): 23/23, including
  🔊 being secondary and never triggered by Space.
- `scripts/playthrough-coloring.mjs`: 25/25 — hub to room, question, exact
  answer, 3D -> 2D, no default swatch, できた gating, 🔊 shows the exact
  sentence, a single-jump stroke is interpolated, favourite colour everywhere
  gives 3 stars even after a replay, 2D -> 3D, gift and wall picture,
  turnaround (seven colours; chose green), hub greeting, stamp and save
  persisted, re-entry without duplicates, ignoring the answer (wrong colour
  everywhere) gives 2 stars, no console errors.
- `scripts/speech-states.mjs`: 9/9 against a scripted fake recogniser — holding
  starts listening, a valid question is accepted, unrelated or partial speech
  reaches Try Again, two failures bring up a working fallback.
- Screenshots reviewed: Art Room, colouring screen, painted picture, result
  cards, gift, turnaround two-shot.
- Coloring anti-shortcut review: no fixed mapping (both facts random, all nine
  combinations tested); no order or timing cue; no elimination (free regions
  untargeted); no colour cue (star is navy/white, paint pots teal); no default
  swatch; no feedback before できた and no resuming after. A wrong-colour
  picture caps at 2 stars; a lucky single-colour guess wins 1 time in 3.

## NOT Verified — Manual Chromebook Pass Required

Real speech recognition cannot run headless; the fake recogniser proves only
the software path. On a classroom Chromebook with its microphone, check:

1. Holding the talk button reliably starts listening.
2. "What food do you like?" is accepted.
3. Failed or partial speech reaches Try Again.
4. After two failures the fallback appears and works.

Also check real trackpad painting in Coloring (automation used synthetic mouse
drags) and Restaurant levels 2 and 3. Record the findings here. Do not redesign
the speech system unless this pass exposes a problem.

## Known Limits

- The Coloring NPC (Kenney `b`) wears a red top and blue trousers, two palette
  colours. It is not a reliable shortcut, because the favourite is random, but
  it could distract; swap to a neutrally dressed model if children use it.
- The result card never tells the child what the NPC's colour was. Saying so
  after completion would close the listening loop without creating a shortcut
  (the next round is random). Consider after classroom observation.
- The bundle is over 600 kB, mostly three.js; Vite warns on chunk size.
- The phonetic variant tables are informed guesses until real classroom
  transcripts exist.
- If character assets take longer than 2.5 s, the first hub shows the fallback
  body until the next scene change.

## Next Steps

1. User review of the Coloring slice.
2. The manual Chromebook pass above.
3. Only then Drink Stand (SPEC section 6), applying the anti-shortcut review.

## Codex / Delegated Work

None in flight. Coloring v1 (Codex, Sol high) has been reviewed: scoring and
anti-shortcut logic checked, visual QA done, and two framing fixes applied by
Claude (turnaround two-shot, result title wrapping).
