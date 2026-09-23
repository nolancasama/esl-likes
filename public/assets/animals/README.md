# Animal park models

The eight animal models in `cube-world/` come from Quaternius' **Cube World**
pack. The project owner downloaded them on 2026-09-23 in the source archive
`drive-download-20260923T103858Z-1-001.zip`. They were exported by
`Khronos glTF Blender I/O v1.7.33`.

Quaternius packs are released under CC0. **No license file accompanied this
particular download**, so the owner should confirm the source page for the
exact attribution that should ship with the project.

Each `.gltf` is self-contained: its mesh, skin, animation data, and PNG texture
are embedded in the file. Runtime loading needs no sidecar binary or texture.
The models face local +Z at rotation zero, matching the Zoo roaming convention.

## Animation clips

- `Cat.gltf`: Death, Headbutt, Idle, Idle_Eating, Jump_Loop, Jump_Start, Run, Walk
- `Chicken.gltf`: Attack, Death, Idle, Idle_Peck, Run
- `Dog.gltf`: Death, Headbutt, Idle, Idle_Eating, Jump_Loop, Jump_Start, Run, Walk
- `Horse.gltf`: Death, Headbutt, Idle, Idle_Eating, Jump_Loop, Jump_Start, Run, Walk
- `Pig.gltf`: Death, Headbutt, Idle, Idle_Eating, Jump_Loop, Jump_Start, Run, Walk
- `Raccoon.gltf`: Death, Headbutt, Idle, Idle_Eating, Jump_Loop, Jump_Start, Run, Walk
- `Sheep.gltf`: Death, Headbutt, Idle, Idle_Eating, Jump_Loop, Jump_Start, Run, Walk
- `Wolf.gltf`: Death, Headbutt, Idle, Idle_Eating, Jump_Loop, Jump_Start, Run, Walk

**The chicken has no Walk clip.** The runtime resolves animation names by an
exact case-insensitive match and uses Run for the walk role whenever Walk is
missing. Keep that rule general rather than branching on the chicken.

## Things that will bite

**Do not import `Chick.gltf`.** Chick and chicken are too similar for reliable
speech matching and for the intended photo-matching age group. The frozen Zoo
roster uses only `Chicken.gltf`.

**Do not assume one model scale.** Every species has an authored `targetHeight`
and is normalised from its own bounding box. The source files use inconsistent
dimensions, so a universal scale will make the relative sizes wrong.

**Do not add a 180-degree roaming correction.** These models face +Z. If one
model is replaced and genuinely differs, give only that model a `yawOffset` in
`ANIMAL_MODELS`; changing the roaming heading makes every correctly authored
model walk backwards.

**Animation names are a contract, not list positions.** Extra clips and their
order vary, and the chicken omits Walk. Resolve Idle, Walk, and Run by name.
