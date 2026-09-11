# Current State

## Status

Vertical slice built and reviewed: the shared 3D shell plus the Restaurant
minigame, playable end to end. Coloring, Drink Stand, Sports and Zoo are not
started; the hub shows them as coming soon.

## What Exists

- `SPEC.md` — the frozen design for all five minigames. Read it first.
- Speech matcher (`src/systems/speechMatch.js`) with per-word phonetic
  tolerance tables, judging both "What ___ do you like?" and "I like ___."
- Shared shell: three.js bootstrap, hub with five doors in an arc, stamp book,
  settings (volume, mic-free, difficulty, text size), hold-to-talk HUD with the
  two-failure fallback ladder, dialogue bubbles, progression and save
  (localStorage `esl-likes-save-v1`), transitions, Kenney character loader.
- Minigame interface: `createX(ctx) => { id, enter(level), update(dt), exit() }`.
  `src/minigames/placeholder/` is the reference implementation; the registry is
  in `src/main.js`.
- Character conventions (see DESIGN_DECISIONS): Kenney models face +z at
  rotation 0, movement heading is `atan2(move.x, -move.y)`, and
  `characters.playerModel` is the one avatar key.
- Restaurant: waiter loop, orders never displayed, remind-at-a-cost, random
  counter slots and food-based cook times (no spatial or timing shortcut), food
  temperature, patience, three levels, host beside the bell, turnaround.
- HUD fallback supports `choices`: the turnaround offers every "I like ___." so
  a mic-free child still chooses their own answer.

## Verified

- `npm test` 89/89; `npm run build` clean.
- `scripts/playthrough.mjs`, headless, mic-free route, level 1: 19/19 checks —
  hub, enter Restaurant, ask, answer, order absent once the bubble clears, bell,
  collect, deliver, turnaround with a chosen answer, hub greets with that
  answer, stamp earned, re-entry leaves no duplicated overlays, no console
  errors.
- Screenshots reviewed: all five hub doors visible; avatar faces the way it
  walks and is the same model on every screen; customers and host face the
  camera; turnaround shows the host's face, a full-width bubble and the answer
  buttons without overlap; carried sushi and hamburger read clearly.
- NOT verified: real speech recognition (needs a Chromebook with a working
  microphone); levels 2 and 3 were not driven by automation; the recoloured
  curry has not yet come up in a screenshot (the food is random).

## Known Limits

- Bundle is 642 kB (170 kB gzip), mostly three.js; Vite warns on chunk size.
- `configureSpeech` is copied into each minigame from the placeholder. Consider a
  shared helper before the next four minigames copy it again.
- `likeSentence()` uses the bare answer word ("I like elephant."). Zoo will want
  natural plurals ("I like elephants.") — decide per-lesson phrasing first.
- The remind action (もういちど きく) is the big primary button, bound to Space,
  whenever the child stands at a customer whose food is cooking. Watch whether
  children press it by habit and lose stars.
- If character assets take longer than 2.5 s, the first hub still shows the
  fallback body until the next scene change.
- `UI.restaurant.foodNames` is defined but unused.
- The phonetic variant tables are informed guesses until real classroom
  transcripts exist.

## Next Steps

1. Manual pass on a real classroom Chromebook with a microphone: hold-to-talk,
   accepted and try-again states, fallback after two failures, Restaurant at
   levels 2 and 3.
2. Decide answer phrasing (plurals) and whether to extract a shared
   speech-binding helper; both shape the next four minigames.
3. Build Coloring (SPEC section 5): 3D art room plus a full-screen 2D brush
   canvas with starred regions.

## Codex / Delegated Work

None in flight. All delegated output so far (matcher, shell, Restaurant) has
been reviewed, fixed where needed, and committed.
