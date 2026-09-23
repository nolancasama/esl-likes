import test from 'node:test';
import assert from 'node:assert/strict';

import { landmarks } from './layout.js';
import { createZooWorld } from './world.js';

test('the park builds flat regions without visible paths or a watering hollow', () => {
  const world = createZooWorld({ seed: 1234 });
  const names = [];
  world.group.traverse((object) => names.push(object.name));
  assert.equal(names.some((name) => name.startsWith('zoo-path-')), false);
  assert.equal(names.some((name) => name.startsWith('zoo-path-node-')), false);
  assert.equal(names.includes('zoo-watering-hollow'), false);
  for (const id of ['grassland', 'woodland', 'farm', 'cove']) {
    assert.ok(names.includes(`zoo-region-${id}`));
  }
  assert.ok(names.some((name) => name.startsWith('zoo-blocky-tree-scatter-')));
  assert.ok(names.some((name) => name.startsWith('zoo-blocky-rock-scatter-')));
  assert.ok(names.includes('zoo-giant-forest-tree-blocky'));
  assert.equal(names.includes('zoo-plaza-bench'), false);
  world.dispose();
});

test('student environment loading is a ready no-op when nothing is placed', async () => {
  const world = createZooWorld({ seed: 9876 });
  await world.loadEnvironment();
  assert.deepEqual(world.getEnvironmentState(), {
    status: 'ready', pending: 0, loadedUniqueModels: 0, failedAssets: [],
  });
  assert.equal(world.getSceneryGroups().length, 0);
  world.dispose();
});

test('procedural barn and water tower visibly occupy their authored landmarks', () => {
  const world = createZooWorld({ seed: 4321 });
  const barn = world.group.getObjectByName('zoo-barn-procedural');
  const tower = world.group.getObjectByName('zoo-water-tower-procedural');
  assert.ok(barn);
  assert.ok(tower);
  const barnLandmark = landmarks.find((landmark) => landmark.id === 'barn');
  const towerLandmark = landmarks.find((landmark) => landmark.id === 'waterTower');
  assert.ok(barn.children.some((mesh) => mesh.position.x === barnLandmark.x
    && Math.abs(mesh.position.z - barnLandmark.z) < 2.5));
  assert.ok(tower.children.some((mesh) => mesh.position.x === towerLandmark.x
    && mesh.position.z === towerLandmark.z));
  world.dispose();
});
