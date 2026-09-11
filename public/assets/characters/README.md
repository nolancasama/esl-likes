# Character models

**Kenney — Blocky Characters 2.0**, <https://kenney.nl>
Licence: CC0 1.0 (public domain). No attribution required; credited here anyway.

## What is here

`character-<a..r>.glb` — 18 characters, ~110 KB each.
`Textures/texture-<a..r>.png` — one texture per character.

The `.glb` files reference their texture **externally** as
`Textures/texture-<key>.png`, so the loader must be given this directory as the
glTF resource path. Parsing them with an empty path silently produces
untextured white characters.

## Structure

Each file is the same seven-node hierarchy — `root`, `torso`, `head`,
`arm-left`, `arm-right`, `leg-left`, `leg-right` — animated by node transforms.
There is **no skeleton and no skinning**, which is why the game ships no Draco
decoder and no glTF conversion step: the files are used exactly as downloaded.

27 clips are included; the game uses `idle`, `walk`, `sprint` and `emote-yes`.
The rest (`sit`, `drive`, `pick-up`, `emote-no`, `interact-*`, `wheelchair-*`,
and the combat set) are unused but left in place, since stripping them would
mean adding back a build step to save a few kilobytes.

Several clips translate `root` vertically — `walk` bobs it by 0.1 — so the
loader restores the root's rest position after every mixer update. The game
decides where a person stands; the clip only gets to rotate them.

## Casting

Nine ordinary townspeople (`a b e f i j k m q`) are the common cast, used for
pedestrians, tour visitors, the guide and the opening local.

The other nine (`c d g h l n o p r`) are costumed — a zombie, orcs, robot
knights, a ninja, a vampire, a pirate. They appear as roughly one ambient
street pedestrian in twelve and are never cast as the child's own avatar.
