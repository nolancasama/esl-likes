/**
 * Imported environment assets available to the scene editor and the small
 * subset the student park actually places. This module stays pure data so the
 * editor and tests can inspect it without a renderer.
 */

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/**
 * The complete editor palette. Runtime loading is deliberately driven by
 * SCENERY_GROUPS below, so an unused palette entry costs a student no fetch.
 */
export const ENVIRONMENT_MODELS = deepFreeze([
  { key: 'grass', folder: 'quaternius-nature', file: 'Grass_Common_Tall.gltf', height: 0.75 },
  { key: 'grass-wispy', folder: 'quaternius-nature', file: 'Grass_Wispy_Tall.gltf', height: 0.9 },
  { key: 'bush', folder: 'quaternius-nature', file: 'Bush_Common.gltf', height: 1.05 },
  { key: 'common-tree', folder: 'quaternius-nature', file: 'CommonTree_1.gltf', height: 6.2 },
  { key: 'pine', folder: 'quaternius-nature', file: 'Pine_1.gltf', height: 6.4 },
  { key: 'rock', folder: 'quaternius-nature', file: 'Rock_Medium_1.gltf', height: 1.05 },
  { key: 'bush-flowering', folder: 'quaternius-nature', file: 'Bush_Common_Flowers.gltf', height: 1.05 },
  { key: 'common-tree-b', folder: 'quaternius-nature', file: 'CommonTree_3.gltf', height: 6.2 },
  { key: 'dead-tree', folder: 'quaternius-nature', file: 'DeadTree_3.gltf', height: 5.4 },
  { key: 'fern', folder: 'quaternius-nature', file: 'Fern_1.gltf', height: 0.8 },
  { key: 'flower-cluster', folder: 'quaternius-nature', file: 'Flower_3_Group.gltf', height: 0.45 },
  { key: 'flower-patch', folder: 'quaternius-nature', file: 'Flower_4_Group.gltf', height: 0.45 },
  { key: 'leafy-plant', folder: 'quaternius-nature', file: 'Plant_1_Big.gltf', height: 1.2 },
  { key: 'pebble', folder: 'quaternius-nature', file: 'Pebble_Round_1.gltf', height: 0.35 },
  { key: 'pebble-flat', folder: 'quaternius-nature', file: 'Pebble_Round_2.gltf', height: 0.4 },
  { key: 'pine-b', folder: 'quaternius-nature', file: 'Pine_2.gltf', height: 6.4 },
  { key: 'pine-c', folder: 'quaternius-nature', file: 'Pine_5.gltf', height: 5.8 },
  { key: 'rock-b', folder: 'quaternius-nature', file: 'Rock_Medium_2.gltf', height: 1.05 },
  { key: 'rock-c', folder: 'quaternius-nature', file: 'Rock_Medium_3.gltf', height: 1.2 },
  { key: 'rock-path', folder: 'quaternius-nature', file: 'RockPath_Round_Thin.gltf', height: 0.12 },
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

/** Imported-model placements in the live park. Kept exported for the editor. */
export const SCENERY_GROUPS = deepFreeze([]);

const runtimeAssets = new Set(SCENERY_GROUPS.map((group) => group.asset));
export const RUNTIME_ENVIRONMENT_MODELS = deepFreeze(
  ENVIRONMENT_MODELS.filter((model) => runtimeAssets.has(model.key)),
);

export const SCENERY_GROUP_BY_NAME = deepFreeze(Object.fromEntries(
  SCENERY_GROUPS.map((group) => [group.name, group]),
));

/** Guards imported-model placement lists against accidental drift. */
export const EXPECTED_PLACEMENT_COUNTS = deepFreeze({});

/** Groups drawn one object at a time — the ones an editor can pick as they are. */
export const CLONE_GROUPS = deepFreeze(SCENERY_GROUPS.filter((group) => group.draw === 'clone'));

/** Groups batched into an InstancedMesh, which an editor has to expand first. */
export const INSTANCED_GROUPS = deepFreeze(SCENERY_GROUPS.filter((group) => group.draw === 'instanced'));
