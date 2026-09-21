# Animal park models

Supplied by the project owner from their own downloads, September 2026. Three
files cover the park's eight animals: two models and one generated clip bundle.

**`Animals.glb`** — "Animals FREE" by ithappy, exported from the Unity package
to glTF. Scene root children: `tiger`, `horse.001`, `dog.001`, `deer`,
`kitty.001`, `pinguin.001`, `chicken.001`. The animal park instantiates all
seven. **It contains no animation clips at all** — see the clip bundle below.

**`animal-clips.json`** — generated, do not hand-edit. Idle/Walk/Run for all
eight animals, built by `npm run build:animal-clips` from the owner's original
packs in Downloads (`Unity_2021_Animals_FREE_v2.3.unitypackage` and
`stylooanimalassetpack.zip`). The seven ITHappy animals' clips are lifted from
the pack's FBX meshes, whose bone names match this glb's once GLTFLoader has
sanitized them. The giraffe's walk is retargeted from the styloo cow, which
shares its rig; its idle is the model's own `iddle`. See DESIGN_DECISIONS.md,
2026-09-20.

Two things the loader must do: drop nothing, but **remap track names** — all
seven animals here share bone names, so GLTFLoader renames the duplicates
(`Root`, `Root_1`, `Root_2`, …) and a clip binds to the tiger only unless the
suffix is resolved. `retargetClip` in `src/minigames/zoo/animalClips.js` does
this.

**`giraffe.glb`** — from the **Styloo animal asset pack**,
<https://styloo.itch.io/> (the pack's read-me asks only that you consider a
donation; it ships fbx and glb, and we use the glb as advised). Originally
`glb/girafe.glb`; renamed to the English spelling used by the lesson. It carries
one clip, the misspelled `iddle`; its walk is borrowed from the same pack's cow.

## Removed with the enclosures

`elephant.glb`, `alpaca.gltf` and `obj/` (Bull, Cow, Donkey, Fox, Horse_White,
Stag, Wolf) were deleted in the 2026-09-20 animal-park pass. Those eight species
are no longer in the lesson, nothing referenced the files, and they were 2.3 MB
of dead weight in the bundle. They are in git history if they are ever wanted,
and the original packs (`animalz.zip`, Downloads) still have them. The horse now
comes from the rigged `Animals.glb` node rather than the static `Horse_White.obj`,
because a static mesh cannot walk.

## Two things that will bite

**Scales are not consistent between files.** Raw heights are deer 1.97, horse
1.86, giraffe 1.45, tiger 1.28, pinguin 1.28 — a giraffe shorter than a deer.
Every animal is scaled to a `targetHeight` so the relative sizes read correctly;
do not assume one world scale fits all eight. Placement is derived from each
model's bounding box rather than hand-written constants, so this stays true if a
model is replaced.

**Bone names repeat across `Animals.glb`,** so GLTFLoader renames the duplicates
and only the first animal in the file keeps the names its clips use. Clips are
remapped onto each model at load time; see the clip bundle note above.
