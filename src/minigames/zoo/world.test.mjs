import test from 'node:test';
import assert from 'node:assert/strict';

import { createZooWorld } from './world.js';

test('the park builds flat regions without visible paths or a watering hollow', () => {
  const world = createZooWorld({ seed: 1234 });
  const names = [];
  world.group.traverse((object) => names.push(object.name));
  assert.equal(names.some((name) => name.startsWith('zoo-path-')), false);
  assert.equal(names.some((name) => name.startsWith('zoo-path-node-')), false);
  assert.equal(names.includes('zoo-watering-hollow'), false);
  for (const id of ['grassland', 'woodland', 'farm']) {
    assert.ok(names.includes(`zoo-region-${id}`));
  }
  assert.equal(names.includes('zoo-region-cove'), false);
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

test('removed landmarks and the cold cove are absent from the runtime world', () => {
  const world = createZooWorld({ seed: 4321 });
  const names = [];
  world.group.traverse((object) => names.push(object.name));
  for (const name of [
    'zoo-ticket-booth',
    'zoo-cafe-terrace',
    'zoo-central-fountain-jet',
    'zoo-barn-procedural',
    'zoo-water-tower-procedural',
    'zoo-region-cove',
  ]) {
    assert.equal(names.includes(name), false, `${name} remains in the park`);
  }
  world.dispose();
});
