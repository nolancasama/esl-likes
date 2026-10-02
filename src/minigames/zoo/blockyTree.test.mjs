import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
  BLOCKY_ROCK_VARIANTS,
  BLOCKY_TREE_VARIANTS,
  ENTRANCE_TREE_EXCLUSION,
  TREE_COUNT,
  TREE_MIN_SPACING,
  WAYPOINT_CLEARANCE,
  createBlockyRock,
  createBlockyTree,
  createParkScatter,
  isScatterPointAllowed,
} from './blockyTree.js';
import { bounds, colliders, landmarks, pathNodes, retainedProps } from './layout.js';
import { createRng } from './roaming.js';
import { TERRITORIES } from './territories.js';

test('park scatter is deterministic with whole-park tree probability', () => {
  const first = createParkScatter(24680);
  const second = createParkScatter(24680);
  assert.deepEqual(first, second);
  assert.notDeepEqual(first, createParkScatter(24681));
  assert.equal(first.trees.length, TREE_COUNT);
  assert.equal(first.rocks.length, 60);
  assert.ok(new Set(first.rocks.map((rock) => rock.clusterId)).size < first.rocks.length);

  const samples = [101, 202, 303, 404, 505].flatMap((seed) => createParkScatter(seed).trees);
  const third = (bounds.maxX - bounds.minX) / 3;
  const leftEdge = bounds.minX + third;
  const rightEdge = bounds.maxX - third;
  const horizontal = [0, 0, 0];
  const vertical = [0, 0];
  const middleZ = (bounds.minZ + bounds.maxZ) / 2;
  for (const tree of samples) {
    horizontal[tree.x < leftEdge ? 0 : tree.x > rightEdge ? 2 : 1] += 1;
    vertical[tree.z < middleZ ? 0 : 1] += 1;
  }
  for (const count of horizontal) {
    assert.ok(count >= 90 && count <= 175, `tree thirds are too uneven: ${horizontal}`);
  }
  for (const count of vertical) {
    assert.ok(count >= 155 && count <= 245, `tree halves are too uneven: ${vertical}`);
  }
});

test('every tree obeys navigation, prop, waypoint, and tree-spacing exclusions', () => {
  const { trees, rocks } = createParkScatter(97531);
  const waypoints = TERRITORIES.flatMap((territory) => territory.waypoints);

  for (const point of [...trees, ...rocks]) {
    assert.ok(isScatterPointAllowed(point), `${point.x}, ${point.z} violates a scatter exclusion`);
    assert.ok(point.x >= bounds.minX && point.x <= bounds.maxX);
    assert.ok(point.z >= bounds.minZ && point.z <= bounds.maxZ);
    for (const waypoint of waypoints) {
      assert.ok(Math.hypot(point.x - waypoint.x, point.z - waypoint.z) >= WAYPOINT_CLEARANCE);
    }
    for (const landmark of landmarks) {
      assert.ok(Math.hypot(point.x - landmark.x, point.z - landmark.z) >= 2);
    }
    for (const collider of colliders) {
      if (collider.type === 'circle') {
        assert.ok(Math.hypot(point.x - collider.x, point.z - collider.z) >= collider.r + 2);
        continue;
      }
      const cosine = Math.cos(collider.rotation);
      const sine = Math.sin(collider.rotation);
      const dx = point.x - collider.x;
      const dz = point.z - collider.z;
      const localX = dx * cosine - dz * sine;
      const localZ = dx * sine + dz * cosine;
      const outsideX = Math.max(Math.abs(localX) - collider.hw, 0);
      const outsideZ = Math.max(Math.abs(localZ) - collider.hd, 0);
      assert.ok(Math.hypot(outsideX, outsideZ) >= 2, `${collider.id} clearance`);
    }
  }

  for (let index = 0; index < trees.length; index += 1) {
    const tree = trees[index];
    assert.ok(Math.hypot(tree.x - ENTRANCE_TREE_EXCLUSION.x, tree.z - ENTRANCE_TREE_EXCLUSION.z)
      >= ENTRANCE_TREE_EXCLUSION.radius, 'tree entered the visitor/spawn area');
    for (const node of pathNodes) {
      assert.ok(Math.hypot(tree.x - node.x, tree.z - node.z) >= 2.35,
        `tree blocked navigation point ${node.id}`);
    }
    for (const prop of retainedProps) {
      assert.ok(Math.hypot(tree.x - prop.x, tree.z - prop.z) >= prop.clearance,
        `tree covered retained prop ${prop.id}`);
    }
    for (let other = index + 1; other < trees.length; other += 1) {
      assert.ok(Math.hypot(tree.x - trees[other].x, tree.z - trees[other].z) >= TREE_MIN_SPACING,
        `trees ${index} and ${other} are too close`);
    }
  }
});

test('all four blocky variants reuse the caller-owned boxes and materials', () => {
  const box = new THREE.BoxGeometry(1, 1, 1);
  const bark = new THREE.MeshStandardMaterial({ flatShading: true });
  const leaves = [0x397a43, 0x4f9955, 0x72b85d]
    .map((color) => new THREE.MeshStandardMaterial({ color, flatShading: true }));
  const resources = { boxGeometry: box, trunkMaterial: bark, canopyMaterials: leaves };

  for (const [index, variant] of BLOCKY_TREE_VARIANTS.entries()) {
    const tree = createBlockyTree(createRng(index + 1), resources, variant);
    assert.ok(tree.isGroup);
    assert.ok(tree.children.length >= 2 && tree.children.length <= 4);
    assert.ok(Math.abs(tree.rotation.y) <= 0.14);
    assert.equal(tree.children[0].material, bark);
    for (const child of tree.children) {
      assert.equal(child.geometry, box);
      assert.ok(child.material === bark || leaves.includes(child.material));
      assert.equal(child.material.flatShading, true);
    }
  }

  box.dispose();
  bark.dispose();
  leaves.forEach((material) => material.dispose());
});

test('blocky rock variants reuse the shared boxes and stone palette', () => {
  const box = new THREE.BoxGeometry(1, 1, 1);
  const stone = [0xb0a79d, 0x777b83]
    .map((color) => new THREE.MeshStandardMaterial({ color, flatShading: true }));
  const resources = { boxGeometry: box, rockMaterials: stone };

  for (const [index, variant] of BLOCKY_ROCK_VARIANTS.entries()) {
    const rock = createBlockyRock(createRng(index + 1), resources, variant);
    assert.ok(rock.isGroup);
    assert.ok(rock.children.length >= 1 && rock.children.length <= 3);
    assert.ok(Math.abs(rock.rotation.x) <= 0.12);
    assert.ok(Math.abs(rock.rotation.z) <= 0.12);
    for (const child of rock.children) {
      assert.equal(child.geometry, box);
      assert.ok(stone.includes(child.material));
      assert.equal(child.material.flatShading, true);
    }
  }

  box.dispose();
  stone.forEach((material) => material.dispose());
});
