# Zoo animal models

Supplied by the project owner from their own downloads, September 2026. Four files cover the zoo's seven animals.

**`Animals.glb`** — "Animals FREE" by ithappy, exported from the Unity package
to glTF. Scene root children: `tiger`, `horse.001`, `dog.001`, `deer`,
`kitty.001`, `pinguin.001`, `chicken.001`. The zoo instantiates four of them —
tiger, deer, horse and pinguin — and ignores the dog, kitty and chicken.

**`elephant.glb`** — a single elephant, named parts (`Body`, `Trunk_1..5`,
`Tusk_L/R`, …), no animation clips.

**`giraffe.glb`** — from the **Styloo animal asset pack**,
<https://styloo.itch.io/> (the pack's read-me asks only that you consider a
donation; it ships fbx and glb, and we use the glb as advised). Originally
`glb/girafe.glb`; renamed to the English spelling used by the lesson.

## Two things that will bite

**Scales are not consistent between files.** Raw heights are deer 1.97, elephant
1.84, horse 1.86, giraffe 1.45, tiger 1.28, pinguin 1.28 — a giraffe shorter
than the elephant, and an alpaca from a different pack again at its own scale.
Every animal is scaled per habitat so the relative sizes read correctly; do not
assume one world scale fits all six.

**The elephant's origin is at its centre**, y running −0.92 to +0.92, while
every other model has its feet at y = 0. It has to be lifted by half its height
or it sinks to the knees. Placement is derived from each model's bounding box
rather than hand-written constants, so this stays true if a model is replaced.

## Why these seven animals

The lesson used to teach elephant, lion, panda, monkey, giraffe and penguin.
The supplied models contain no lion, panda or monkey, so the vocabulary follows
the models instead of the zoo mixing detailed animals with procedural blocks.
Dog and cat filled two slots briefly and were dropped: they are not zoo animals.
Deer, horse and alpaca took their place, which is why there are seven.
See DESIGN_DECISIONS.md, 2026-09-12.

## Later addition

**`alpaca.gltf`** — from `animalz.zip` (`glTF/Alpaca.gltf`), a rigged alpaca with
its buffers and colours embedded, so the same fetch-and-parse path loads it.
Seven distinct materials, no texture, feet at y = 0. The same pack also holds
deer, stag, fox, wolf, bull, cow, donkey, horse, husky and shiba, all rigged and
self-contained, if more animals are ever wanted.

Deer and horse come from `Animals.glb` rather than this pack, so they share the
tiger's and penguin's look. Dog and cat were dropped: they are not zoo animals.
