import * as THREE from 'three';

import { bounds, colliders, landmarks } from './layout.js';
import { createRng } from './roaming.js';
import { TERRITORIES } from './territories.js';

const TAU = Math.PI * 2;
const WAYPOINT_CLEARANCE = 2.5;
const SCENERY_CLEARANCE = 2;

const AREA_RANGES = Object.freeze({
  grassland: Object.freeze({ minX: bounds.minX, maxX: -3, minZ: 0, maxZ: 21.999 }),
  woodland: Object.freeze({ minX: bounds.minX, maxX: 5, minZ: bounds.minZ, maxZ: 0 }),
  farm: Object.freeze({ minX: 4, maxX: bounds.maxX, minZ: 0, maxZ: 21.999 }),
  cove: Object.freeze({ minX: 4, maxX: bounds.maxX, minZ: bounds.minZ, maxZ: 0 }),
});

const TREE_COUNTS = Object.freeze({ grassland: 24, woodland: 42, farm: 8, cove: 6 });
const ROCK_COUNTS = Object.freeze({ grassland: 18, woodland: 20, farm: 10, cove: 12 });

const waypoints = TERRITORIES.flatMap((territory) => territory.waypoints);
const poolEdges = colliders.filter((collider) => collider.role === 'poolEdge');
const poolRectangle = poolEdges.length ? Object.freeze({
  minX: Math.min(...poolEdges.map((edge) => edge.x - (edge.hw ?? 0))),
  maxX: Math.max(...poolEdges.map((edge) => edge.x + (edge.hw ?? 0))),
  minZ: Math.min(...poolEdges.map((edge) => edge.z - (edge.hd ?? 0))),
  maxZ: Math.max(...poolEdges.map((edge) => edge.z + (edge.hd ?? 0))),
}) : null;

function randomBetween(rng, min, max) {
  return min + rng() * (max - min);
}

function addBox(group, geometry, material, x, y, z, width, height, depth) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.scale.set(width, height, depth);
  group.add(mesh);
  return mesh;
}

function treeParts(rng, resources, variant) {
  const { boxGeometry, trunkMaterial, canopyMaterials } = resources;
  if (!boxGeometry || !trunkMaterial || !canopyMaterials?.length) {
    throw new Error('blocky trees need one shared box geometry and a shared material palette');
  }

  const group = new THREE.Group();
  group.userData.variant = variant;
  group.rotation.y = randomBetween(rng, -0.14, 0.14);
  const canopy = (index) => canopyMaterials[index % canopyMaterials.length];

  if (variant === 'tall-narrow') {
    const trunkHeight = randomBetween(rng, 3.2, 4.1);
    const width = randomBetween(rng, 1.65, 2.15);
    addBox(group, boxGeometry, trunkMaterial, 0, trunkHeight / 2, 0, 0.62, trunkHeight, 0.62);
    addBox(group, boxGeometry, canopy(0), 0, trunkHeight + 0.8, 0, width, 1.75, width);
    if (rng() > 0.45) addBox(group, boxGeometry, canopy(1), 0.14, trunkHeight + 1.75, -0.08,
      width * 0.78, 1.05, width * 0.78);
  } else if (variant === 'short-wide') {
    const trunkHeight = randomBetween(rng, 1.65, 2.25);
    const width = randomBetween(rng, 2.8, 3.65);
    addBox(group, boxGeometry, trunkMaterial, 0, trunkHeight / 2, 0, 0.72, trunkHeight, 0.72);
    addBox(group, boxGeometry, canopy(1), 0, trunkHeight + 0.75, 0, width, 1.65, width * 0.88);
    if (rng() > 0.58) addBox(group, boxGeometry, canopy(2), -0.35, trunkHeight + 1.5, 0.22,
      width * 0.66, 0.95, width * 0.62);
  } else if (variant === 'two-tier') {
    const trunkHeight = randomBetween(rng, 2.45, 3.15);
    const width = randomBetween(rng, 2.3, 3.05);
    addBox(group, boxGeometry, trunkMaterial, 0, trunkHeight / 2, 0, 0.66, trunkHeight, 0.66);
    addBox(group, boxGeometry, canopy(0), 0, trunkHeight + 0.45, 0, width, 1.35, width);
    addBox(group, boxGeometry, canopy(2), 0.12, trunkHeight + 1.55, -0.12,
      width * 0.72, 1.2, width * 0.72);
  } else {
    const trunkHeight = randomBetween(rng, 2.2, 2.85);
    const width = randomBetween(rng, 2.35, 3.05);
    addBox(group, boxGeometry, trunkMaterial, 0, trunkHeight / 2, 0, 0.76, trunkHeight, 0.76);
    addBox(group, boxGeometry, canopy(0), -0.36, trunkHeight + 0.6, 0.12,
      width * 0.82, 1.55, width * 0.8);
    addBox(group, boxGeometry, canopy(1), 0.42, trunkHeight + 0.72, -0.18,
      width * 0.76, 1.45, width * 0.78);
    addBox(group, boxGeometry, canopy(2), 0.04, trunkHeight + 1.58, 0.18,
      width * 0.7, 1.2, width * 0.68);
  }
  return group;
}

export const BLOCKY_TREE_VARIANTS = Object.freeze([
  'tall-narrow', 'short-wide', 'two-tier', 'chunky-round',
]);

export function createTallNarrowTree(rng, resources) {
  return treeParts(rng, resources, 'tall-narrow');
}

export function createShortWideTree(rng, resources) {
  return treeParts(rng, resources, 'short-wide');
}

export function createTwoTierTree(rng, resources) {
  return treeParts(rng, resources, 'two-tier');
}

export function createChunkyRoundTree(rng, resources) {
  return treeParts(rng, resources, 'chunky-round');
}

const TREE_BUILDERS = Object.freeze({
  'tall-narrow': createTallNarrowTree,
  'short-wide': createShortWideTree,
  'two-tier': createTwoTierTree,
  'chunky-round': createChunkyRoundTree,
});

/** Builds one voxel tree entirely from the caller's shared geometry/materials. */
export function createBlockyTree(rng, resources, variant = null) {
  const chosen = variant ?? BLOCKY_TREE_VARIANTS[
    Math.min(BLOCKY_TREE_VARIANTS.length - 1, Math.floor(rng() * BLOCKY_TREE_VARIANTS.length))
  ];
  const builder = TREE_BUILDERS[chosen];
  if (!builder) throw new Error(`unknown blocky tree variant "${chosen}"`);
  return builder(rng, resources);
}

export const BLOCKY_ROCK_VARIANTS = Object.freeze([
  'flat-slab', 'two-block', 'angular-chunk', 'pebble-cluster',
]);

/** Builds one voxel rock entirely from the caller's shared geometry/materials. */
export function createBlockyRock(rng, resources, variant = null) {
  const { boxGeometry, rockMaterials } = resources;
  if (!boxGeometry || !rockMaterials?.length) {
    throw new Error('blocky rocks need one shared box geometry and a shared material palette');
  }
  const chosen = variant ?? BLOCKY_ROCK_VARIANTS[
    Math.min(BLOCKY_ROCK_VARIANTS.length - 1, Math.floor(rng() * BLOCKY_ROCK_VARIANTS.length))
  ];
  if (!BLOCKY_ROCK_VARIANTS.includes(chosen)) throw new Error(`unknown blocky rock variant "${chosen}"`);
  const group = new THREE.Group();
  group.userData.variant = chosen;
  group.rotation.set(randomBetween(rng, -0.12, 0.12), randomBetween(rng, -0.16, 0.16),
    randomBetween(rng, -0.12, 0.12));
  const stone = (index) => rockMaterials[index % rockMaterials.length];
  if (chosen === 'flat-slab') {
    addBox(group, boxGeometry, stone(0), 0, 0.22, 0, 1.65, 0.44, 1.25);
  // Every boulder is wider than it is tall. A box as tall as it is wide reads
  // as a crate however it is coloured, which is what the first pass shipped.
  } else if (chosen === 'two-block') {
    addBox(group, boxGeometry, stone(0), -0.22, 0.26, 0.05, 1.15, 0.52, 1.0);
    addBox(group, boxGeometry, stone(1), 0.34, 0.4, -0.12, 0.82, 0.62, 0.78);
  } else if (chosen === 'angular-chunk') {
    addBox(group, boxGeometry, stone(0), 0, 0.34, 0, 1.45, 0.68, 1.22);
    addBox(group, boxGeometry, stone(1), -0.26, 0.74, 0.16, 0.86, 0.5, 0.74);
  } else {
    addBox(group, boxGeometry, stone(0), -0.35, 0.18, 0.1, 0.54, 0.36, 0.48);
    addBox(group, boxGeometry, stone(1), 0.22, 0.24, -0.16, 0.62, 0.48, 0.55);
    addBox(group, boxGeometry, stone(0), 0.08, 0.15, 0.32, 0.4, 0.3, 0.38);
  }
  return group;
}

function distanceToBox(point, collider) {
  const cosine = Math.cos(collider.rotation ?? 0);
  const sine = Math.sin(collider.rotation ?? 0);
  const dx = point.x - collider.x;
  const dz = point.z - collider.z;
  const localX = dx * cosine - dz * sine;
  const localZ = dx * sine + dz * cosine;
  const outsideX = Math.max(Math.abs(localX) - collider.hw, 0);
  const outsideZ = Math.max(Math.abs(localZ) - collider.hd, 0);
  return Math.hypot(outsideX, outsideZ);
}

/** The single rejection rule shared by tree and rock placement. */
export function isScatterPointAllowed(point) {
  if (!Number.isFinite(point?.x) || !Number.isFinite(point?.z)) return false;
  if (point.x < bounds.minX || point.x > bounds.maxX
    || point.z < bounds.minZ || point.z > bounds.maxZ || point.z >= 22) return false;
  if (waypoints.some((waypoint) => Math.hypot(point.x - waypoint.x, point.z - waypoint.z)
    < WAYPOINT_CLEARANCE)) return false;
  if (landmarks.some((landmark) => Math.hypot(point.x - landmark.x, point.z - landmark.z)
    < SCENERY_CLEARANCE)) return false;
  for (const collider of colliders) {
    const distance = collider.type === 'circle'
      ? Math.hypot(point.x - collider.x, point.z - collider.z) - collider.r
      : distanceToBox(point, collider);
    if (distance < SCENERY_CLEARANCE) return false;
  }
  if (poolRectangle && point.x >= poolRectangle.minX && point.x <= poolRectangle.maxX
    && point.z >= poolRectangle.minZ && point.z <= poolRectangle.maxZ) return false;
  return true;
}

function samplePoint(rng, area, occupied, spacing) {
  const range = AREA_RANGES[area];
  for (let attempt = 0; attempt < 5000; attempt += 1) {
    const point = {
      x: randomBetween(rng, range.minX, range.maxX),
      z: randomBetween(rng, range.minZ, range.maxZ),
    };
    if (!isScatterPointAllowed(point)) continue;
    if (occupied.some((other) => Math.hypot(point.x - other.x, point.z - other.z) < spacing)) continue;
    return point;
  }
  throw new Error(`could not place ${area} park scatter without blocking navigation`);
}

/**
 * Generates reproducible dressing coordinates without changing animal RNG use.
 * Counts are visual targets: dense woodland, open farm/cove, and clustered rock.
 */
export function createParkScatter(seed = 1) {
  const rng = createRng((Number.isFinite(seed) ? seed : 1) ^ 0x9e3779b9);
  const trees = [];
  for (const [area, count] of Object.entries(TREE_COUNTS)) {
    for (let index = 0; index < count; index += 1) {
      const point = samplePoint(rng, area, trees, 1.7);
      trees.push({
        ...point,
        area,
        variant: BLOCKY_TREE_VARIANTS[Math.floor(rng() * BLOCKY_TREE_VARIANTS.length)],
        seed: Math.floor(rng() * 0xffffffff),
        scale: randomBetween(rng, 0.82, 1.16),
        yaw: randomBetween(rng, -0.22, 0.22),
      });
    }
  }

  const rocks = [];
  let clusterId = 0;
  for (const [area, count] of Object.entries(ROCK_COUNTS)) {
    while (rocks.filter((rock) => rock.area === area).length < count) {
      const remaining = count - rocks.filter((rock) => rock.area === area).length;
      const clusterSize = Math.min(remaining, rng() < 0.58 ? 1 : (rng() < 0.72 ? 2 : 3));
      const centre = samplePoint(rng, area, rocks, 0.65);
      for (let member = 0; member < clusterSize; member += 1) {
        let point = centre;
        if (member > 0) {
          for (let attempt = 0; attempt < 80; attempt += 1) {
            const angle = rng() * TAU;
            const radius = randomBetween(rng, 0.65, 1.45);
            const candidate = {
              x: centre.x + Math.cos(angle) * radius,
              z: centre.z + Math.sin(angle) * radius,
            };
            if (isScatterPointAllowed(candidate)) {
              point = candidate;
              break;
            }
          }
          if (point === centre) continue;
        }
        rocks.push({
          ...point,
          area,
          clusterId,
          variant: BLOCKY_ROCK_VARIANTS[Math.floor(rng() * BLOCKY_ROCK_VARIANTS.length)],
          seed: Math.floor(rng() * 0xffffffff),
          yaw: rng() * TAU,
          scale: randomBetween(rng, 0.55, 1.18),
        });
      }
      clusterId += 1;
    }
  }
  return { trees, rocks };
}
