# Current State

## Status

All five minigames are playable end to end in the shared 3D shell: Restaurant,
Coloring v1, Drink Stand v1, Sports v1 and Zoo v1. The collection is feature
complete against SPEC.md. The Zoo now uses the real 3D animal models the user
supplied, and its vocabulary follows those models. Nothing is in flight; this
awaits the user's review.

## What Exists

- `SPEC.md` — the frozen design: the anti-shortcut rule, the vocabulary rule,
  the listening-again policy, and all five minigames.
- Vocabulary in `src/config/lesson.js`: one `{ id, answer }` per item with the
  exact sentence and natural plurals; `answerFor`, `answerChoices`.
- Speech: hold-to-talk plus the forgiving matcher. Shared prompts in
  `src/systems/speechPrompt.js`. Shared 🔊 control in `src/ui/listenAgain.js`.
- Shell: hub with five doors, stamp book (renders the zoo photo), settings, HUD
  with the two-failure fallback, dialogue (balanced lines, Japanese phrases kept
  whole), progression and save (`esl-likes-save-v1`), transitions, characters,
  and `ctx.captureFrame(draw)` which renders one frame and lends the canvas so a
  minigame can copy real pixels.
- Restaurant, Coloring v1, Drink Stand v1, Sports v1 — see SPEC sections 4 to 7.
- Zoo v1 (`src/minigames/zoo/`): entrance plaza, one looping path past six
  habitats with signs, landmarks. Ask a visitor, hear "I like tigers.", find the
  habitat, frame the animal in the 2D viewfinder and shoot, return and press
  Space to show the photo. The camera holds ONE photo. Wrong animal: Japanese
  refusal, no English repeat, try again. L1/L2/L3 = 3/4/6 requests with 1/2/3
  visitors waiting; no timer. Pure tested scoring in `scoring.js` plus
  `measureFraming`. The photo is saved to the stamp book. Read-only hook
  `window.__eslDebug.zoo`.
- **Zoo animals are real models**: elephant, giraffe, penguin, tiger, deer,
  horse and alpaca. Dog and cat were dropped as not being zoo animals; deer and
  horse came from the pack already loaded and the alpaca from `animalz.zip`. Files and provenance: `public/assets/animals/README.md`.
  Loading is asynchronous with a placeholder per pen until a model arrives, and
  a failed load leaves the placeholders rather than breaking the room. Placement
  (scale, grounding, photo target and radius) is derived from each model's
  bounding box. Skinned models are instantiated with `SkeletonUtils.clone`; a
  plain `Object3D.clone` loses the skeleton binding and renders them at the
  file's origin instead of in the pen.
- Conventions: Kenney models face +z; movement heading is `atan2(x, -y)`;
  `characters.playerModel` is the one avatar key; the follow camera sits
  directly behind the avatar, never off to one side.

## Verified

- `npm test` 128/128; `npm run build` clean.
- All five playthroughs pass, mic-free: `scripts/playthrough.mjs` 23/23,
  `playthrough-coloring.mjs` 25/25, `playthrough-drink.mjs` 23/23,
  `playthrough-sports.mjs` 21/21, `playthrough-zoo.mjs` 24/24 (re-run after the
  seven-animal swap). No console errors.
- Screenshots reviewed for every minigame, and for all six zoo habitats after
  the swap: each animal stands inside its own pen, textured, feet on the ground,
  with believable relative sizes (giraffe tallest, cat smallest).
- Anti-shortcut reviews done for all five minigames and unchanged by the swap.

## NOT Verified — Manual Chromebook Pass Required

Real speech recognition cannot run headless. On a classroom Chromebook with its
microphone, check: holding the talk button starts listening; "What food do you
like?" is accepted; failed or partial speech reaches Try Again; after two
failures the fallback works. Also check real trackpad play (Coloring painting,
Drink Stand clicking, Zoo aiming) and levels 2 and 3 of every minigame — only
level 1 is scripted.

**Watch "deer" specifically.** The matcher gives words of four letters or fewer
no fuzzy matching at all, because at that length one edit is usually a different
word. "deer" is now the shortest animal answer, and its plural is also "deer",
so it is the likeliest to be rejected when a child says it correctly. If that happens, add
heard variants to `VARIANTS` in `src/systems/speechMatch.js` rather than
loosening the distance rule.

## Known Limits

- A habitat sign can overlap its animal from some angles on the path; the child
  walks around it, and the viewfinder still frames the animal.
- Zoo photos are framed by the child, so a saved photo may show more sign and
  fence than animal. The framing score reflects that; it is not a bug.
- Sports: far signs are small in the opening overview; the follow camera can
  briefly put the avatar in front of a friend entering a zone.
- Drink Stand: two-word signs sit tight against the sign's bottom edge;
  customers are scaled up, so the waiting line looks large.
- The Coloring NPC wears two palette colours; the result card never names the
  NPC's colour. Consider after classroom observation.
- Bundle over 600 kB (three.js) plus ~4 MB of animal models; phonetic tables
  are guesses until real classroom transcripts exist; 2.5 s character preload.

## Next Steps

1. User review of the Zoo with its new animals, and of the collection.
2. The manual Chromebook pass above, then extend the phonetic tables from what
   real children say.
3. Possible polish after classroom observation: difficulty tuning, the Coloring
   result card naming the colour, bundle splitting.

## Codex / Delegated Work

None in flight. The animal swap (Codex, Sol) was reviewed and accepted with four
Claude fixes: `SkeletonUtils.clone` for the skinned models, colouring the
untextured elephant's materials, and three stale matcher tests that Codex was
correctly barred from editing by its own work order.

## Asset licences (checked 2026-09-12, matters before publishing)

- CC0, safe to redistribute: Kenney Blocky Characters (all people), and the
  Quaternius pack (`obj/` models plus `alpaca.gltf`).
- Own work: `elephant.glb`, generated by the user's own Blender script.
- Unclear: `giraffe.glb` (Styloo, itch.io — the pack states no licence), and
  `Animals.glb` (ithappy "Animals FREE" from the Unity Asset Store, whose EULA
  forbids redistributing asset files; using them inside the game is permitted).
- Consequence: the game may be used and shown freely, but `Animals.glb` and
  `giraffe.glb` should not be committed to a public repository or served from a
  public site. A GitHub Pages site cannot be made private, and a private repo
  only hides source, not the published files.
