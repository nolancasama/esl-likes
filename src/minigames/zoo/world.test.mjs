import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { createZooWorld } from './world.js';
import { isFramingEligible } from './scoring.js';

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

test('central visibility rays avoid scenery beside a narrow animal but reject a solid obstruction', () => {
  const world = createZooWorld({ seed: 4321 });
  // Isolate one registered scenery occluder and use real triangle raycasts.
  const blocker = world.group.getObjectByName('zoo-forest-fallen-log');
  world.group.traverse((object) => {
    if (object.isMesh && object !== blocker) object.raycast = () => {};
  });
  const positions = [];
  function panel(x, width, height) {
    const left = x - width / 2;
    const right = x + width / 2;
    const bottom = -height / 2;
    const top = height / 2;
    positions.push(left, bottom, 0, right, bottom, 0, right, top, 0,
      left, bottom, 0, right, top, 0, left, top, 0);
  }
  // One narrow obstruction covers the centre. The two side panels cover
  // empty space beside the animal, where the former outer rays landed.
  panel(0, 0.01, 0.06);
  panel(-0.06, 0.02, 0.3);
  panel(0.06, 0.02, 0.3);
  const partial = new THREE.BufferGeometry();
  partial.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const solid = new THREE.PlaneGeometry(2, 2);
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  blocker.geometry = partial;
  blocker.material = material;
  blocker.position.set(0, 0, 2);
  blocker.rotation.set(0, 0, 0);
  blocker.scale.setScalar(1);
  const camera = new THREE.PerspectiveCamera(34, 16 / 9, 0.1, 100);
  camera.position.set(0, 0, 5);
  camera.updateMatrixWorld(true);
  const photoTarget = new THREE.Object3D();
  const habitat = { photoTarget, photoRadius: 0.18, photoHalfHeight: 0.5 };
  const frame = { x: 0.5, y: 0.5, width: 0.12, height: 0.2 };
  try {
    world.group.updateMatrixWorld(true);
    const partiallyBlocked = world.countBlockedSamples(habitat, camera);
    assert.equal(partiallyBlocked, 1);
    assert.equal(isFramingEligible(frame, {
      visibleFraction: 1 - partiallyBlocked / world.visibilitySampleCount,
    }), true);
    blocker.geometry = solid;
    const fullyBlocked = world.countBlockedSamples(habitat, camera);
    assert.equal(fullyBlocked, world.visibilitySampleCount);
    assert.equal(isFramingEligible(frame, {
      visibleFraction: 1 - fullyBlocked / world.visibilitySampleCount,
    }), false);
  } finally {
    partial.dispose();
    solid.dispose();
    material.dispose();
    world.dispose();
  }
});
