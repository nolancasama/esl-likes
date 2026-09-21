# Scene Placement Editor — frozen interface

Authored by Claude (product/design lead) before delegation. **This file is the
contract.** Workers implement against it and do not renegotiate it. If something
here is impossible, stop and say so rather than inventing a different shape.

The goal is a lightweight level-layout tool for Three.js projects: place and
adjust assets in the real game world, save portable JSON, load that same JSON
without the editor. It is not a Blender, not a DCC suite.

## Separation

`src/dev/scene-editor/` is **generic**. It must not import anything from
`src/minigames/`, `src/systems/` or `src/config/`. Only `three` and its own
files. A second, primitive-only adapter proves this (see "Demo").

`src/minigames/zoo/zooEditorAdapter.js` is the **first adapter**. All Zoo
knowledge lives there or in `src/minigames/zoo/scenery.js`.

## Public API

```js
import { createSceneEditor } from '../../dev/scene-editor/SceneEditor.js';

const editor = createSceneEditor({
  scene,          // THREE.Scene
  camera,         // THREE.PerspectiveCamera — the editor DRIVES this while enabled
  domElement,     // renderer.domElement
  adapter,        // see below
  uiRoot,         // HTMLElement the panel mounts into
  storageKey,     // optional string; enables localStorage drafts when present
  onEnable,       // optional () => void  — host freezes gameplay + its camera rig
  onDisable,      // optional () => void  — host resumes
});
```

Returned object:

```js
{
  enable(), disable(), toggle(),
  get enabled,                 // boolean
  update(dt),                  // call every frame; a no-op when disabled
  getLayout(),                 // -> layout object (see JSON below)
  loadLayout(layout),          // -> { created, errors: [string] }; throws only on a bad version
  dispose(),
}
```

**Cost when disabled.** `update()` returns on the first line. No raycasts, no
helpers in the scene, no TransformControls attached, no panel in the DOM — the
panel is built on first `enable()` and removed on `disable()`. The host is
expected to `import()` this module dynamically so it is absent from a
production bundle entirely.

## Adapter contract

Required:

```js
{
  id: 'animal-park',                          // -> layout.project
  categories: [{ id, name }],                 // ordered; drives palette + visibility
  assets: [{ id, name, category,
             deletable = true, uniform = true }],
  createAsset(assetId) -> THREE.Object3D | null,   // fresh instance, origin at its own base
  getGroundPoint(raycaster, out) -> THREE.Vector3 | null,
}
```

Optional — omit and the editor silently drops that feature:

```js
{
  disposeAsset(assetId, object),          // called on delete / undo-create
  isPlaceable(x, y, z) -> true | string,  // string = the reason, shown in the panel
  listExisting() -> [{ id, assetId, category, object, deletable, locked }],
  pointGroups: [{ id, name, colour, format: 'xz' | 'xyz', points: [...] }],
  onPointsChanged(groupId, points),
  helpers: [{ id, name, build() -> THREE.Object3D }],   // e.g. colliders
}
```

`createAsset` returns the **logical root**. The editor sets `position`,
`rotation`, `scale` on that root and never touches its children.

## Registry

Every editable object carries `object.userData.__editor = { id, assetId,
category, deletable, locked }`. Selection raycasts the scene and walks up
`parent` until it finds that marker, so clicking any child mesh selects the
root. Identity is the string `id`, never an array index. New ids are
`${assetId}-${n}` with `n` the lowest free integer for that asset, zero-padded
to 3.

## JSON

```json
{
  "version": 1,
  "project": "animal-park",
  "objects": [
    { "id": "common-tree-014", "asset": "common-tree", "category": "vegetation",
      "position": [-12.4, 0, 8.7], "rotation": [0, 1.57, 0], "scale": [1.1, 1.1, 1.1] }
  ],
  "points": { "tiger": [[-18.2, -4.3], [-23.4, -10.2]] }
}
```

- `objects` sorted by `id`, ascending, before serialising. Same scene -> same
  bytes, so a diff is readable.
- Numbers rounded to 4 decimal places. No `-0`.
- `rotation` is XYZ Euler in radians.
- `points` keys are `pointGroup.id`. `format: 'xz'` writes pairs — the Zoo's
  `territories.js` authors `[x, z]` and the export must paste straight into it.
- Unknown `version` -> `loadLayout` throws. Unknown asset id -> collected into
  `errors`, that object skipped, the rest still load. Never silent.

## Layout loader (no editor)

`src/dev/scene-editor/layoutLoader.js`:

```js
export function loadLayoutInto(root, layout, adapter, { onError } = {})
```

Pure of any editor/UI/DOM code. Parses, validates, calls `adapter.createAsset`,
applies transforms, adds to `root`. This is what the game uses in normal play.
The editor's own `loadLayout` calls it and then registers what it made.

## Behaviour

- **Gizmo**: `TransformControls` from `three/examples/jsm/controls/TransformControls.js`.
  `W` translate, `E` rotate, `R` scale. `X` toggles world/local space.
- **Snapping**: rotation off/5/15/45/90 deg, translation off/0.1/0.25/0.5/1.0.
  Both default off (`setRotationSnap` / `setTranslationSnap`).
- **Undo**: one entry per *completed* gizmo drag — capture on `mouseDown`, push
  on `mouseUp` only if the transform actually changed. Never per frame.
  `Ctrl+Z` / `Ctrl+Shift+Z` / `Ctrl+Y`. Covers move, rotate, scale, create,
  duplicate, delete, point add/move/delete. Cap the stack at 200.
- **Duplicate** (`Ctrl+D`): new instance via `adapter.createAsset`, copied
  transform, offset `+0.5` on x and z, **new** id, selected. Never
  `object.clone()` — see the skinned-glTF trap in this repo's history.
- **Delete** (`Delete` / `Backspace`): refused on `deletable: false` or
  `locked: true`, with a visible reason.
- **Scale**: uniform lock on by default; clamped to a minimum of `0.01` and
  never negative.
- **Nudge**: arrows move x/z by 0.25 (`Shift` 1.0), PageUp/PageDown move y by
  0.25, `,` / `.` rotate y by 5 deg. Each is one undo entry.
- **Snap to ground** button and `G`: re-resolves y through
  `adapter.getGroundPoint` at the object's own x/z.
- **Locking**: per object, in the panel. Locked objects stay visible, cannot be
  selected by click, cannot be transformed or deleted.
- **Visibility**: per category checkbox. Editor-only; restored on `disable()`.
- **Panel** shows: category/visibility list, asset palette with a filter box,
  numeric X/Y/Z for position, rotation (**degrees**) and scale, a uniform-scale
  checkbox, the selected object's id, `Copy placement`
  (`{ x, y, z, yaw, scale }`), `Export` / `Copy JSON` / `Import` / `Reset`,
  snapping selects, and a helpers list. Fields and gizmo stay in sync both ways.
- **Reset** and **import-over-work** both confirm first.
- **Drafts**: when `storageKey` is given, save the layout to `localStorage` on
  every committed change (debounced 500 ms) and offer to restore it on the next
  `enable()`. Exported JSON stays canonical.
- **Input ownership**: while enabled the editor attaches its listeners in the
  **capture** phase on `window` and calls `stopPropagation` for the keys it
  owns, so the game's `input.js` never sees them. Pointer events on the canvas
  are ignored while `TransformControls.dragging`.

## Editor camera

The editor owns the camera while enabled: orbit on left-drag over empty space,
pan on middle-drag or `Shift`+left-drag, dolly on wheel, `F` frames the
selection. Restores the host's exact camera position, quaternion, `fov` and
`far` on `disable()`. The host raises `camera.far` — do not assume 100 is
enough to see a whole world.

## Points layer (roaming points)

A second registered item type. Each `pointGroup` renders as editor-only markers
(a small sphere plus a vertical pin, the group's colour, and a thin line
joining consecutive points). Click to select, drag on the ground plane to move,
`Delete` to remove, click empty ground in "add" mode to append. Markers live
under a group that is removed on `disable()` — they must be impossible to see
in normal play. `isPlaceable` tints an invalid marker red.

## Demo (the reusability proof)

`src/dev/scene-editor/demo/` — an `index.html` plus a `primitiveAdapter.js`
using only `BoxGeometry` / `SphereGeometry` / `CylinderGeometry`. It must import
**nothing** from `src/minigames/`. Reachable at `/src/dev/scene-editor/demo/`
under `npm run dev`. Placing, transforming, exporting, clearing and re-importing
must restore exact transforms.

## Tests

Pure modules only — no DOM, no WebGL. `node --test`, files named `*.test.mjs`
beside their source, matching this repo's existing style.

Cover: transform serialise/deserialise round-trip; rounding and `-0`;
deterministic ordering; stable and non-colliding id allocation; create, delete,
duplicate, transform commands and their undo and redo; duplicate gets a new id;
a locked object rejects mutation; a `deletable: false` object rejects delete; an
unknown asset id produces a named error and does not abort the load; a bad or
absent `version` throws; point serialisation in both `xz` and `xyz`;
`loadLayoutInto` applies transforms exactly.

## Non-goals

No mesh/vertex editing, terrain sculpting, texture or material editing,
animation or timeline, prefab inheritance, collaboration, scene hierarchy tree,
physics authoring, navmesh authoring, thumbnails, or writing back into source
files.
