import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CLONE_GROUPS,
  ENVIRONMENT_MODELS,
  ENVIRONMENT_MODEL_BY_KEY,
  EXPECTED_PLACEMENT_COUNTS,
  INSTANCED_GROUPS,
  RUNTIME_ENVIRONMENT_MODELS,
  SCENERY_GROUPS,
} from './scenery.js';
import { bounds } from './layout.js';

test('every group names a model the park actually loads', () => {
  for (const group of SCENERY_GROUPS) {
    assert.ok(
      ENVIRONMENT_MODEL_BY_KEY[group.asset],
      `${group.name} wants "${group.asset}", which is not in ENVIRONMENT_MODELS`,
    );
  }
});

test('model keys are unique', () => {
  const keys = ENVIRONMENT_MODELS.map((model) => model.key);
  assert.equal(new Set(keys).size, keys.length, 'duplicate model key');
});

test('the live park has no imported environment models', () => {
  assert.deepEqual(SCENERY_GROUPS, []);
  assert.deepEqual(RUNTIME_ENVIRONMENT_MODELS, []);
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

test('the clone and instanced views partition the groups', () => {
  assert.equal(CLONE_GROUPS.length + INSTANCED_GROUPS.length, SCENERY_GROUPS.length);
  assert.ok(CLONE_GROUPS.every((group) => group.draw === 'clone'));
  assert.ok(INSTANCED_GROUPS.every((group) => group.draw === 'instanced'));
});

test('every palette model is one file that actually ships', () => {
  for (const model of ENVIRONMENT_MODELS) {
    assert.match(model.file, /\.(gltf|glb|obj)$/, model.key);
    assert.ok(model.folder, model.key);
    assert.ok(Number.isFinite(model.height) && model.height > 0, `${model.key} height`);
  }
});

test('the data is frozen so nothing can edit the park at runtime', () => {
  assert.ok(Object.isFrozen(SCENERY_GROUPS));
  assert.ok(Object.isFrozen(EXPECTED_PLACEMENT_COUNTS));
});
