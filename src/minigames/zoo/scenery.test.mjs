import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CLONE_GROUPS,
  ENVIRONMENT_MODELS,
  ENVIRONMENT_MODEL_BY_KEY,
  EXPECTED_PLACEMENT_COUNTS,
  INSTANCED_GROUPS,
  SCENERY_GROUPS,
} from './scenery.js';
import { bounds, landmarks } from './layout.js';

const ANCHORS = new Set(['ticketBooth', ...landmarks.map((landmark) => landmark.id)]);

test('every group names a model the park actually loads', () => {
  for (const group of SCENERY_GROUPS) {
    assert.ok(
      ENVIRONMENT_MODEL_BY_KEY[group.asset],
      `${group.name} wants "${group.asset}", which is not in ENVIRONMENT_MODELS`,
    );
  }
});

test('model keys are unique and every model is used by at least one group', () => {
  const keys = ENVIRONMENT_MODELS.map((model) => model.key);
  assert.equal(new Set(keys).size, keys.length, 'duplicate model key');
  const used = new Set(SCENERY_GROUPS.map((group) => group.asset));
  for (const key of keys) {
    assert.ok(used.has(key), `${key} is loaded but nothing places it`);
  }
});

test('group names are unique — they appear in mesh names and scene stats', () => {
  const names = SCENERY_GROUPS.map((group) => group.name);
  assert.equal(new Set(names).size, names.length);
});

test('the placement counts match what the code had before the data move', () => {
  const actual = Object.fromEntries(
    SCENERY_GROUPS.map((group) => [group.name, group.placements.length]),
  );
  assert.deepEqual(actual, EXPECTED_PLACEMENT_COUNTS);
});

test('every placement is a finite point with a positive scale', () => {
  for (const group of SCENERY_GROUPS) {
    for (const [index, placement] of group.placements.entries()) {
      const where = `${group.name}[${index}]`;
      assert.ok(Number.isFinite(placement.x), `${where} x`);
      assert.ok(Number.isFinite(placement.z), `${where} z`);
      if (placement.y !== undefined) assert.ok(Number.isFinite(placement.y), `${where} y`);
      if (placement.yaw !== undefined) assert.ok(Number.isFinite(placement.yaw), `${where} yaw`);
      if (placement.scale !== undefined) {
        assert.ok(Number.isFinite(placement.scale) && placement.scale > 0, `${where} scale`);
      }
    }
  }
});

test('world-anchored placements stand inside the park', () => {
  for (const group of SCENERY_GROUPS) {
    if (group.anchor) continue;   // offsets, not world coordinates
    for (const [index, placement] of group.placements.entries()) {
      const where = `${group.name}[${index}]`;
      assert.ok(placement.x >= bounds.minX && placement.x <= bounds.maxX, `${where} x out of bounds`);
      assert.ok(placement.z >= bounds.minZ && placement.z <= bounds.maxZ, `${where} z out of bounds`);
    }
  }
});

test('an anchored group names a landmark that exists', () => {
  for (const group of SCENERY_GROUPS) {
    if (!group.anchor) continue;
    assert.ok(ANCHORS.has(group.anchor), `${group.name} anchors to unknown "${group.anchor}"`);
  }
});

test('every group declares how it is drawn', () => {
  for (const group of SCENERY_GROUPS) {
    assert.ok(['clone', 'instanced'].includes(group.draw), `${group.name} draw=${group.draw}`);
    assert.equal(typeof group.occluder, 'boolean', `${group.name} occluder`);
    assert.ok(group.placements.length > 0, `${group.name} places nothing`);
  }
});

test('the clone and instanced views partition the groups', () => {
  assert.equal(CLONE_GROUPS.length + INSTANCED_GROUPS.length, SCENERY_GROUPS.length);
  assert.ok(CLONE_GROUPS.every((group) => group.draw === 'clone'));
  assert.ok(INSTANCED_GROUPS.every((group) => group.draw === 'instanced'));
});

test('the tall occluders are the ones an animal can hide behind', () => {
  // Trees, pines, rocks, crates and the farm buildings block the camera; grass
  // and low props do not. A group changing sides changes how hard an animal is
  // to photograph, so it should have to be done deliberately.
  const occluders = SCENERY_GROUPS.filter((group) => group.occluder).map((group) => group.name).sort();
  assert.deepEqual(occluders, [
    'cove-rock',
    'farm-barn',
    'farm-crates',
    'farm-water-tower',
    'farm-well',
    'grassland-rock',
    'grassland-tree',
    'ticket-crate',
    'woodland-pine',
    'woodland-rock',
    'woodland-tree',
  ]);
});

test('the park is still dressed from one short plant palette', () => {
  const plants = ENVIRONMENT_MODELS
    .filter((model) => model.folder === 'quaternius-nature')
    .map((model) => model.key)
    .sort();
  assert.deepEqual(plants, ['bush', 'common-tree', 'grass', 'grass-wispy', 'pine', 'rock']);
});

test('the data is frozen so nothing can edit the park at runtime', () => {
  assert.ok(Object.isFrozen(SCENERY_GROUPS));
  assert.ok(Object.isFrozen(SCENERY_GROUPS[0].placements));
  assert.ok(Object.isFrozen(SCENERY_GROUPS[0].placements[0]));
});
