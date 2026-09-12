# Zoo animal models

Supplied by the project owner from their own downloads, September 2026. Three
files cover the zoo's six animals.

**`Animals.glb`** — "Animals FREE" by ithappy, exported from the Unity package
to glTF. Scene root children: `tiger`, `horse.001`, `dog.001`, `deer`,
`kitty.001`, `pinguin.001`, `chicken.001`. The zoo instantiates four of them —
tiger, dog, kitty and pinguin — and ignores the horse, deer and chicken.

**`elephant.glb`** — a single elephant, named parts (`Body`, `Trunk_1..5`,
`Tusk_L/R`, …), no animation clips.

**`giraffe.glb`** — from the **Styloo animal asset pack**,
<https://styloo.itch.io/> (the pack's read-me asks only that you consider a
donation; it ships fbx and glb, and we use the glb as advised). Originally
`glb/girafe.glb`; renamed to the English spelling used by the lesson.

## Two things that will bite

**Scales are not consistent between files.** Raw heights are elephant 1.84,
giraffe 1.45, tiger 1.28, pinguin 1.28, dog 0.79, kitty 0.22 — a cat modelled
at a tenth the elephant's height, and a giraffe shorter than the elephant.
Every animal is scaled per habitat so the relative sizes read correctly; do not
assume one world scale fits all six.

**The elephant's origin is at its centre**, y running −0.92 to +0.92, while
every other model has its feet at y = 0. It has to be lifted by half its height
or it sinks to the knees. Placement is derived from each model's bounding box
rather than hand-written constants, so this stays true if a model is replaced.

## Why these six animals

The lesson used to teach elephant, lion, panda, monkey, giraffe and penguin.
The supplied models contain no lion, panda or monkey, so the vocabulary follows
the models instead of the zoo mixing detailed animals with procedural blocks.
See DESIGN_DECISIONS.md, 2026-09-12.
