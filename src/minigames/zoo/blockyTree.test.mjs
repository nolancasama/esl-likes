import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
  BLOCKY_ROCK_VARIANTS,
  BLOCKY_TREE_VARIANTS,
  createBlockyRock,
  createBlockyTree,
  createParkScatter,
} from './blockyTree.js';
import { bounds, colliders, landmarks } from './layout.js';
import { createRng } from './roaming.js';
import { TERRITORIES } from './territories.js';

test('park scatter is deterministic and keeps the intended open-area density', () => {
  const first = createParkScatter(24680);
  const second = createParkScatter(24680);
  assert.deepEqual(first, second);
  assert.notDeepEqual(first, createParkScatter(24681));
  assert.equal(first.trees.length, 80);
  assert.equal(first.rocks.length, 60);

  const treeCounts = Object.groupBy(first.trees, (tree) => tree.area);
  assert.ok(treeCounts.woodland.length > treeCounts.grassland.length);
  assert.ok(treeCounts.grassland.length > treeCounts.farm.length);
  assert.ok(treeCounts.grassland.length > treeCounts.cove.length);
  assert.ok(new Set(first.rocks.map((rock) => rock.clusterId)).size < first.rocks.length);
});

test('every scatter point obeys the real layout and territory exclusions', () => {
  const { trees, rocks } = createParkScatter(97531);
  const poolEdges = colliders.filter((collider) => collider.role === 'poolEdge');
  const pool = {
    minX: Math.min(...poolEdges.map((edge) => edge.x - edge.hw)),
    maxX: Math.max(...poolEdges.map((edge) => edge.x + edge.hw)),
    minZ: Math.min(...poolEdges.map((edge) => edge.z - edge.hd)),
    maxZ: Math.max(...poolEdges.map((edge) => edge.z + edge.hd)),
  };
  const waypoints = TERRITORIES.flatMap((territory) => territory.waypoints);

  for (const point of [...trees, ...rocks]) {
    assert.ok(point.x >= bounds.minX && point.x <= bounds.maxX);
    assert.ok(point.z >= bounds.minZ && point.z <= bounds.maxZ);
    assert.ok(point.z < 22, `${point.area} scatter entered the plaza`);
    for (const waypoint of waypoints) {
      assert.ok(Math.hypot(point.x - waypoint.x, point.z - waypoint.z) >= 2.5);
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
    assert.equal(point.x >= pool.minX && point.x <= pool.maxX
      && point.z >= pool.minZ && point.z <= pool.maxZ, false, 'scatter entered cove pool');
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
