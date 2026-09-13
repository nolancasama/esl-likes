# Zoo environment assets

Copied on 2026-09-13 from archives in the owner's `Downloads` folder for the Zoo
redesign. Nothing here is referenced from `Downloads` at runtime. Only the files
the Zoo uses were copied; each pack keeps its own licence file.

| Folder | Source archive | Licence | Used for | Modifications |
|---|---|---|---|---|
| `quaternius-nature/` | `Stylized Nature MegaKit[Standard].zip` (Quaternius, free Standard edition) | CC0 1.0 — `License_Standard.txt` | Trees, pines, a dead tree (savanna), bushes, flowers, grass, ferns, rocks, pebbles, a rock path | Textures downscaled for Chromebooks: colour maps to 512 px, normal maps (`*_Normal.png`) to 256 px. File names unchanged so glTF references still resolve. Models untouched except `Bush_Common.gltf`, whose leaf image now points at `Leaves_NormalTree_C.png` (green) instead of the dark red `Leaves_TwistedTree_C.png`. |
| `kenney-suburban/` | `kenney_city-kit-suburban_20.zip` (Kenney, City Kit Suburban 2.0) | CC0 1.0 — `License.txt` | Fences, stone paths, planters, simple trees | None. `Textures/colormap.png` kept beside the GLBs. |
| `kaykit-restaurant/` | `KayKit_Restaurant_Bits_1.0_FREE.zip` (Kay Lousberg) | CC0 1.0 — `License.txt` | Café terrace tables, chairs, crates | The source 1024 px atlas is retained for provenance but its texture slots are stripped before Zoo parsing; the furniture uses flat material colour, so no texture above 512 px is requested or uploaded. |
| `quaternius-farm/` | `Farm Buildings by Quaternius.zip` | **Unverified in archive**: no licence file inside. Quaternius publishes its packs as CC0 at quaternius.com. | Barns, well, water tower, paddock fence for the Farm region | None (OBJ/MTL, colour-only materials). |

**Before a public release:** confirm the Farm Buildings licence on
quaternius.com (or replace those six models with Kenney/procedural buildings).
Everything else carries its CC0 licence text in the folder.

Not imported, and why: `Fence.zip` and `hedge_maze_pack.zip` (no licence,
heavier), the traffic-sign and unnamed Drive archives (no licence), the two large
Drive character packs (not environment), twisted trees from the MegaKit (700–800
KB each for little gain).
