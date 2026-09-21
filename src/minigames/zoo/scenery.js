/**
 * Where every piece of the park's dressing stands.
 *
 * This was a set of literal arrays buried inside five functions in `world.js`.
 * It is data now for two reasons: the scene placement editor
 * (`src/dev/scene-editor/`) has to be able to read a placement, move it and
 * write it back out, which it cannot do to a literal inside a closure; and a
 * placement list is data about the park, not behaviour, so it belongs beside
 * `layout.js` and `territories.js` with the rest of the park's fixed facts.
 *
 * Pure data: no three.js and no browser, so a test can check it without a
 * renderer. `world.js` turns it into meshes; nothing here knows how.
 *
 * `draw` is the one field with a rendering consequence. `instanced` groups
 * become a single `InstancedMesh` — right for the dozens of grass tufts, but an
 * instance cannot be picked or dragged, so the editor asks `world.js` to
 * rebuild those groups as individual objects while it is open. `clone` groups
 * are already individual objects. Students only ever see the instanced form.
 */

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/**
 * The model files the park dresses itself from.
 *
 * Every plant comes from one pack, Quaternius Nature, so the greenery reads as
 * a single piece of art rather than a collection. The palette is deliberately
 * short — two grasses, one bush, one broadleaf tree, one pine, one rock. Grass
 * does the work; the rest is punctuation. Earlier this carried dead trees,
 * ferns, flowering bushes, a second pine, a second rock and pebbles, which made
 * every corner look different without making any of it look better.
 *
 * The non-plant entries are buildings and props, not scenery planting.
 * `optional: true` marks an asset the park does without if it fails to load.
 */
export const ENVIRONMENT_MODELS = deepFreeze([
  { key: 'grass', folder: 'quaternius-nature', file: 'Grass_Common_Tall.gltf', height: 0.75 },
  { key: 'grass-wispy', folder: 'quaternius-nature', file: 'Grass_Wispy_Tall.gltf', height: 0.9 },
  { key: 'bush', folder: 'quaternius-nature', file: 'Bush_Common.gltf', height: 1.05 },
  { key: 'common-tree', folder: 'quaternius-nature', file: 'CommonTree_1.gltf', height: 6.2 },
  { key: 'pine', folder: 'quaternius-nature', file: 'Pine_1.gltf', height: 6.4 },
  { key: 'rock', folder: 'quaternius-nature', file: 'Rock_Medium_1.gltf', height: 1.05 },
  { key: 'planter', folder: 'kenney-suburban', file: 'planter.glb', height: 0.85 },
  { key: 'low-fence', folder: 'kenney-suburban', file: 'fence-low.glb', height: 0.85 },
  { key: 'long-fence', folder: 'kenney-suburban', file: 'fence-1x3.glb', height: 1.05 },
  { key: 'cafe-table', folder: 'kaykit-restaurant', file: 'table_round_A.gltf', height: 0.9 },
  { key: 'cafe-chair', folder: 'kaykit-restaurant', file: 'chair_A.gltf', height: 1.05 },
  { key: 'crate', folder: 'kaykit-restaurant', file: 'crate.gltf', height: 0.8 },
  { key: 'farm-barn', folder: 'quaternius-farm', file: 'Barn.obj', materialFile: 'Barn.mtl', format: 'obj', height: 6.2, optional: true },
  { key: 'farm-well', folder: 'quaternius-farm', file: 'Well.obj', materialFile: 'Well.mtl', format: 'obj', height: 2.4, optional: true },
  { key: 'water-tower', folder: 'quaternius-farm', file: 'WaterTower.obj', materialFile: 'WaterTower.mtl', format: 'obj', height: 7.2, optional: true },
]);

export const ENVIRONMENT_MODEL_BY_KEY = deepFreeze(Object.fromEntries(
  ENVIRONMENT_MODELS.map((model) => [model.key, model]),
));

/**
 * Every dressing group, in the order the park builds them.
 *
 * - `name` is the group's identity. It appears in mesh names and in the
 *   scene-stats debug report, so it is not free to rename.
 * - `occluder` marks a group solid enough to hide an animal from the camera.
 *   The Zoo's photo-framing check samples against these, so a group that gains
 *   or loses the flag changes how hard an animal is to photograph.
 * - `anchor` marks a group positioned relative to a landmark rather than in
 *   world coordinates; its placements are offsets from that landmark. Freezing
 *   the resolved number here would let the two drift apart.
 */
export const SCENERY_GROUPS = deepFreeze([
  // --- Entrance plaza -----------------------------------------------------
  {
    name: 'entrance-planters', asset: 'planter', area: 'entrance', draw: 'instanced', occluder: false,
    placements: [
      { x: -8.8, z: 34.5 }, { x: -1.5, z: 34.5 }, { x: 6.3, z: 31 }, { x: 9.5, z: 35 },
    ],
  },
  {
    name: 'cafe-tables', asset: 'cafe-table', area: 'entrance', draw: 'instanced', occluder: false,
    placements: [
      { x: 7.2, z: 31.8 }, { x: 9, z: 33.8, yaw: 0.4 },
    ],
  },
  {
    name: 'cafe-chairs', asset: 'cafe-chair', area: 'entrance', draw: 'instanced', occluder: false,
    placements: [
      { x: 6.1, z: 31.8, yaw: Math.PI / 2 }, { x: 8.3, z: 31.8, yaw: -Math.PI / 2 },
      { x: 7.2, z: 30.7, yaw: Math.PI }, { x: 7.2, z: 32.9 },
      { x: 7.9, z: 33.8, yaw: Math.PI / 2 }, { x: 10.1, z: 33.8, yaw: -Math.PI / 2 },
    ],
  },
  {
    name: 'ticket-crate', asset: 'crate', area: 'entrance', draw: 'clone', occluder: true,
    anchor: 'ticketBooth',
    placements: [{ x: -0.8, z: -1.35, yaw: 0.2, scale: 0.75 }],
  },

  // --- Grassland ----------------------------------------------------------
  // Open ground with long sightlines: grass everywhere, a handful of trees to
  // steer by, and nothing tall enough to hide a horse behind.
  {
    name: 'grassland-grass', asset: 'grass', area: 'grassland', draw: 'instanced', occluder: false,
    placements: [
      { x: -18, z: 22 }, { x: -20, z: 18 }, { x: -26, z: 21 }, { x: -31, z: 24 },
      { x: -36, z: 23 }, { x: -40, z: 18 }, { x: -38, z: 5 }, { x: -31, z: 8 },
      { x: -25, z: 3 }, { x: -18, z: 5 }, { x: -9, z: 8 }, { x: -9, z: 13 },
      { x: -14, z: 16 }, { x: -22, z: 13 }, { x: -28, z: 17 }, { x: -33, z: 12 },
      { x: -35, z: 19 }, { x: -29, z: 2 }, { x: -21, z: 9 }, { x: -13, z: 21 },
      { x: -16, z: 11 }, { x: -24, z: 19 }, { x: -37, z: 15 }, { x: -12, z: 6 },
      { x: -30, z: 20, scale: 0.85 }, { x: -19, z: 2, scale: 0.9 },
      { x: -34, z: 9, scale: 1.1 }, { x: -11, z: 17, scale: 0.95 },
    ],
  },
  {
    name: 'grassland-wispy-grass', asset: 'grass-wispy', area: 'grassland', draw: 'instanced', occluder: false,
    placements: [
      { x: -23, z: 16 }, { x: -32, z: 22 }, { x: -39, z: 11 }, { x: -15, z: 19 },
      { x: -27, z: 11 }, { x: -36, z: 2 }, { x: -20, z: 6 }, { x: -12, z: 11 },
      { x: -25, z: 24, scale: 0.9 }, { x: -33, z: 5, scale: 1.05 },
    ],
  },
  {
    name: 'grassland-tree', asset: 'common-tree', area: 'grassland', draw: 'clone', occluder: true,
    placements: [
      { x: -24, z: 25, scale: 1.05 }, { x: -39, z: 8, scale: 0.9 },
      { x: -21, z: 1, scale: 0.82 }, { x: -37, z: 21, scale: 0.95 },
    ],
  },
  {
    name: 'grassland-bush', asset: 'bush', area: 'grassland', draw: 'instanced', occluder: false,
    placements: [
      { x: -21, z: 20 }, { x: -29, z: 10, scale: 0.8 }, { x: -40, z: 21 },
      { x: -23, z: 7 }, { x: -39, z: -1 }, { x: -10, z: 20, scale: 0.75 },
    ],
  },
  {
    name: 'grassland-rock', asset: 'rock', area: 'grassland', draw: 'instanced', occluder: true,
    placements: [
      { x: -27, z: 23, scale: 0.7 }, { x: -41, z: 11, scale: 0.9 }, { x: -25, z: 7, scale: 0.65 },
    ],
  },

  // --- Woodland -----------------------------------------------------------
  // The hardest area to search: pines and bushes break the sightlines, and
  // longer grass between them gives a cat somewhere to be half-hidden.
  {
    name: 'woodland-pine', asset: 'pine', area: 'woodland', draw: 'clone', occluder: true,
    placements: [
      { x: -39, z: -22 }, { x: -25, z: -21, scale: 0.9 }, { x: -2, z: -22, scale: 1.05 },
      { x: -31, z: -28, scale: 0.95 }, { x: -12, z: -14, scale: 0.85 },
      { x: -4, z: -30, scale: 0.9 }, { x: -34, z: -13, scale: 1.0 },
      { x: -17, z: -27, scale: 0.88 },
    ],
  },
  {
    name: 'woodland-tree', asset: 'common-tree', area: 'woodland', draw: 'clone', occluder: true,
    placements: [
      { x: -22, z: -8, scale: 0.95 }, { x: -8, z: -24, scale: 0.9 },
    ],
  },
  {
    name: 'woodland-grass', asset: 'grass', area: 'woodland', draw: 'instanced', occluder: false,
    placements: [
      { x: -37, z: -18 }, { x: -34, z: -23 }, { x: -30, z: -19 }, { x: -27, z: -26 },
      { x: -22, z: -17 }, { x: -18, z: -15 }, { x: -15, z: -30 }, { x: -11, z: -12 },
      { x: -3, z: -19 }, { x: -3, z: -8 }, { x: -31, z: -4 }, { x: -19, z: -11 },
      { x: -26, z: -15 }, { x: -33, z: -9 }, { x: -14, z: -22 }, { x: -7, z: -15 },
      { x: -24, z: -24 }, { x: -36, z: -27 }, { x: -9, z: -28 }, { x: -20, z: -20 },
      { x: -29, z: -12, scale: 0.9 }, { x: -6, z: -23, scale: 1.05 },
      { x: -16, z: -8, scale: 0.85 }, { x: -1, z: -13, scale: 0.95 },
    ],
  },
  {
    name: 'woodland-wispy-grass', asset: 'grass-wispy', area: 'woodland', draw: 'instanced', occluder: false,
    placements: [
      { x: -32, z: -21 }, { x: -21, z: -28 }, { x: -13, z: -18 }, { x: -5, z: -26 },
      { x: -28, z: -7 }, { x: -35, z: -16 }, { x: -10, z: -21 }, { x: -2, z: -16 },
      { x: -18, z: -25, scale: 1.1 }, { x: -25, z: -18, scale: 0.9 },
    ],
  },
  {
    name: 'woodland-bush', asset: 'bush', area: 'woodland', draw: 'instanced', occluder: false,
    placements: [
      { x: -37, z: -16 }, { x: -30, z: -19 }, { x: -23, z: -30 }, { x: -18, z: -15 },
      { x: -15, z: -30 }, { x: -3, z: -19 }, { x: -31, z: -4 }, { x: -20, z: -13 },
      { x: -27, z: -22 }, { x: -11, z: -25 },
    ],
  },
  {
    name: 'woodland-rock', asset: 'rock', area: 'woodland', draw: 'instanced', occluder: true,
    placements: [
      { x: -24, z: -13, scale: 0.8 }, { x: -16, z: -19, scale: 0.7 }, { x: -4, z: -18, scale: 0.75 },
    ],
  },

  // --- Farm meadow --------------------------------------------------------
  // The barn replaces a procedural fallback box once its model arrives, so it
  // is anchored to the same landmark the fallback and its collider use.
  {
    name: 'farm-barn', asset: 'farm-barn', area: 'farm', draw: 'clone', occluder: true,
    anchor: 'barn', replacesFallback: 'barn',
    placements: [{ x: 0, z: 0, yaw: -0.08 }],
  },
  {
    name: 'farm-well', asset: 'farm-well', area: 'farm', draw: 'clone', occluder: true,
    placements: [{ x: 25, z: 25, yaw: -0.35 }],
  },
  {
    name: 'farm-water-tower', asset: 'water-tower', area: 'farm', draw: 'clone', occluder: true,
    placements: [{ x: 38.5, z: 28, yaw: 0.15 }],
  },
  {
    name: 'farm-paddock-fence', asset: 'long-fence', area: 'farm', draw: 'instanced', occluder: false,
    placements: [
      { x: 19, z: 29, yaw: Math.PI / 2 }, { x: 23, z: 29, yaw: Math.PI / 2 },
      { x: 27, z: 27, yaw: 0.1 }, { x: 29, z: 25, yaw: 0.1 },
    ],
  },
  {
    name: 'farm-crates', asset: 'crate', area: 'farm', draw: 'instanced', occluder: true,
    placements: [
      { x: 28.5, z: 24.8 }, { x: 29.3, z: 24.8, scale: 0.8 }, { x: 30, z: 24.6, yaw: 0.3 },
    ],
  },
  // Meadow grass the chicken can be lost in without being buried by it.
  {
    name: 'farm-grass', asset: 'grass', area: 'farm', draw: 'instanced', occluder: false,
    placements: [
      { x: 16, z: 8 }, { x: 20, z: 12 }, { x: 24, z: 9 }, { x: 28, z: 13 },
      { x: 19, z: 16 }, { x: 23, z: 20 }, { x: 27, z: 18 }, { x: 30, z: 9 },
      { x: 17, z: 21 }, { x: 25, z: 15 }, { x: 21, z: 6 }, { x: 29, z: 21 },
      { x: 15, z: 13 }, { x: 26, z: 6, scale: 0.9 }, { x: 31, z: 16, scale: 1.05 },
    ],
  },
  {
    name: 'farm-wispy-grass', asset: 'grass-wispy', area: 'farm', draw: 'instanced', occluder: false,
    placements: [
      { x: 18, z: 10 }, { x: 22, z: 17 }, { x: 27, z: 11 }, { x: 30, z: 19 },
      { x: 16, z: 18 }, { x: 24, z: 22, scale: 0.9 },
    ],
  },

  // --- Cove ---------------------------------------------------------------
  {
    name: 'cove-rock', asset: 'rock', area: 'cove', draw: 'instanced', occluder: true,
    placements: [
      { x: 32, z: -20, scale: 0.8 }, { x: 38.5, z: -19, scale: 0.95 },
      { x: 39, z: -10.2, scale: 0.7 }, { x: 34, z: -20.3, scale: 0.85 },
      { x: 40, z: -17.5, scale: 0.9 }, { x: 33, z: -9.7, scale: 0.75 },
    ],
  },
  {
    name: 'cove-grass', asset: 'grass', area: 'cove', draw: 'instanced', occluder: false,
    placements: [
      { x: 28, z: -21 }, { x: 31, z: -5 }, { x: 40, z: -6 }, { x: 26, z: -12 },
      { x: 36, z: -22 }, { x: 41, z: -12, scale: 0.9 },
    ],
  },
  {
    name: 'cove-railing', asset: 'low-fence', area: 'cove', draw: 'instanced', occluder: false,
    placements: [
      { x: 33, z: -9, yaw: 0, scale: 0.6 }, { x: 37, z: -9, yaw: 0, scale: 0.6 },
      { x: 40.2, z: -12, yaw: Math.PI / 2, scale: 0.6 },
      { x: 40.2, z: -16, yaw: Math.PI / 2, scale: 0.6 },
    ],
  },
]);

export const SCENERY_GROUP_BY_NAME = deepFreeze(Object.fromEntries(
  SCENERY_GROUPS.map((group) => [group.name, group]),
));

/**
 * The placement count each group had when it was literals inside `world.js`.
 * A test compares the data against these, so a row dropped in a future edit
 * fails the suite instead of quietly thinning out a corner of the park.
 */
export const EXPECTED_PLACEMENT_COUNTS = deepFreeze({
  'entrance-planters': 4,
  'cafe-tables': 2,
  'cafe-chairs': 6,
  'ticket-crate': 1,
  'grassland-grass': 28,
  'grassland-wispy-grass': 10,
  'grassland-tree': 4,
  'grassland-bush': 6,
  'grassland-rock': 3,
  'woodland-pine': 8,
  'woodland-tree': 2,
  'woodland-grass': 24,
  'woodland-wispy-grass': 10,
  'woodland-bush': 10,
  'woodland-rock': 3,
  'farm-barn': 1,
  'farm-well': 1,
  'farm-water-tower': 1,
  'farm-paddock-fence': 4,
  'farm-crates': 3,
  'farm-grass': 15,
  'farm-wispy-grass': 6,
  'cove-rock': 6,
  'cove-grass': 6,
  'cove-railing': 4,
});

/** Groups drawn one object at a time — the ones an editor can pick as they are. */
export const CLONE_GROUPS = deepFreeze(SCENERY_GROUPS.filter((group) => group.draw === 'clone'));

/** Groups batched into an InstancedMesh, which an editor has to expand first. */
export const INSTANCED_GROUPS = deepFreeze(SCENERY_GROUPS.filter((group) => group.draw === 'instanced'));
