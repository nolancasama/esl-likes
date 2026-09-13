/**
 * Pure, fixed spatial data for the Zoo campus. Coordinates use the same
 * convention as the three.js world: +x is right and +z is toward the entrance.
 * This module deliberately has no renderer or browser dependencies so both the
 * game and the playthrough harness can rely on the same navigation data.
 */

export const PLAYER_RADIUS = 0.72;
export const PATH_WIDTH = 4.8;
export const SIGN_WIDTH = 3.4;
export const SIGN_DEPTH = 0.16;

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export const bounds = deepFreeze({
  minX: -41,
  maxX: 41,
  minZ: -31,
  maxZ: 39,
});

export const regions = deepFreeze([
  { id: 'entrance', name: 'エントランス', center: { x: 0, z: 31 } },
  { id: 'hub', name: '中央広場', center: { x: 0, z: 10 } },
  { id: 'savanna', name: 'サバンナ', center: { x: -25, z: 12 } },
  { id: 'forest', name: '森のどうぶつ', center: { x: -18, z: -17 } },
  { id: 'farm', name: 'ぼくじょう', center: { x: 22, z: 10 } },
  { id: 'penguinCove', name: 'ペンギン入り江', center: { x: 32, z: -13 } },
]);

// Facing is a yaw in radians: (sin(facing), cos(facing)) points from the
// habitat centre toward its viewpoint. Kenney and animal models face local +z.
const habitatSpecs = [
  // Elephant, deer, alpaca and donkey sit inside the two path loops. Paths
  // therefore pass exhibits on both sides instead of enclosing an empty lawn.
  ['elephant', 'savanna', -13, 11, -13, 15.5],
  ['giraffe', 'savanna', -34, 16, -28, 16],
  ['tiger', 'savanna', -36, 2, -30, 2],
  ['deer', 'forest', -15, -7, -19, -10],
  ['fox', 'forest', -20, -27, -17, -21.5],
  ['wolf', 'forest', -7, -27, -8, -21],
  ['stag', 'forest', -34, -10, -28, -10],
  ['horse', 'farm', 10, 27, 10, 21],
  ['alpaca', 'farm', 14, 10, 14, 16],
  ['cow', 'farm', 37, 4, 31, 4],
  ['bull', 'farm', 32, 17, 26.5, 14.5],
  ['donkey', 'farm', 17, -8, 21.5, -11.5],
  ['penguin', 'penguinCove', 35, -14, 29, -14],
];

export const habitats = deepFreeze(habitatSpecs.map(([id, region, x, z, viewX, viewZ]) => ({
  id,
  region,
  x,
  z,
  facing: Math.atan2(viewX - x, viewZ - z),
  viewpoint: { x: viewX, z: viewZ },
})));

// Sign centres and front-face yaw are authored independently of habitat
// fences. Each board sits beside its viewpoint spur, and faces the junction a
// visitor approaches from. The renderer puts the same texture on a second
// front-facing plane at facing + PI, so neither side is blank or mirrored.
export const signs = deepFreeze([
  { habitatId: 'elephant', x: -9.8, z: 15.5, facing: Math.atan2(-0.2, 3.5) },
  { habitatId: 'giraffe', x: -28, z: 19.2, facing: Math.atan2(3, -4.2) },
  { habitatId: 'tiger', x: -30, z: 5.2, facing: Math.atan2(3, -2.2) },
  { habitatId: 'deer', x: -20.9, z: -7.5, facing: Math.atan2(-4.1, -3.5) },
  { habitatId: 'fox', x: -19.8, z: -20, facing: Math.atan2(7.8, 1) },
  { habitatId: 'wolf', x: -4.8, z: -20.5, facing: Math.atan2(-7.2, 1.5) },
  { habitatId: 'stag', x: -28, z: -6.8, facing: Math.atan2(3, -4.2) },
  { habitatId: 'horse', x: 13.2, z: 21, facing: Math.atan2(-1.2, -1) },
  { habitatId: 'alpaca', x: 17.2, z: 16, facing: Math.atan2(-5.2, 4) },
  { habitatId: 'cow', x: 31, z: 7.2, facing: Math.atan2(-2, -4.2) },
  { habitatId: 'bull', x: 25.2, z: 17.4, facing: Math.atan2(-0.2, -2.4) },
  { habitatId: 'donkey', x: 23.5, z: -8.9, facing: Math.atan2(4.5, -1.1) },
  { habitatId: 'penguin', x: 29, z: -17.2, facing: Math.atan2(-1, 7.2) },
]);

export const pathNodes = deepFreeze([
  { id: 'plaza', x: 0, z: 31, kind: 'plaza' },
  { id: 'entrance-bend', x: -2, z: 23.5, kind: 'path' },
  { id: 'fountain-hub', x: 0, z: 10, kind: 'hub' },

  { id: 'savanna-south', x: -10, z: 19, kind: 'junction' },
  { id: 'savanna-bend', x: -25, z: 15, kind: 'junction' },
  { id: 'savanna-forest-junction', x: -27, z: 3, kind: 'junction' },
  { id: 'forest-bend', x: -25, z: -11, kind: 'junction' },
  { id: 'forest-north', x: -12, z: -19, kind: 'junction' },
  { id: 'north-cross', x: 1, z: -17, kind: 'path' },

  { id: 'farm-south', x: 12, z: 20, kind: 'junction' },
  { id: 'farm-bend', x: 25, z: 14, kind: 'junction' },
  { id: 'farm-east', x: 29, z: 2, kind: 'junction' },
  { id: 'cove-bend', x: 28, z: -10, kind: 'junction' },
  { id: 'farm-north', x: 14, z: -18, kind: 'junction' },

  ...habitats.map(({ id, viewpoint }) => ({
    id: `${id}-viewpoint`,
    x: viewpoint.x,
    z: viewpoint.z,
    kind: 'viewpoint',
  })),
]);

export const pathEdges = deepFreeze([
  ['plaza', 'entrance-bend'],
  ['entrance-bend', 'fountain-hub'],
  ['plaza', 'savanna-south'],
  ['plaza', 'farm-south'],

  // West lobe: Savanna flows into the Forest trail.
  ['fountain-hub', 'savanna-south'],
  ['savanna-south', 'savanna-bend'],
  ['savanna-bend', 'savanna-forest-junction'],
  ['savanna-forest-junction', 'forest-bend'],
  ['forest-bend', 'forest-north'],
  ['forest-north', 'north-cross'],
  ['north-cross', 'fountain-hub'],

  // East lobe: Farm bends through Penguin Cove and back across the north.
  ['fountain-hub', 'farm-south'],
  ['farm-south', 'farm-bend'],
  ['farm-bend', 'farm-east'],
  ['farm-east', 'cove-bend'],
  ['cove-bend', 'farm-north'],
  ['farm-north', 'north-cross'],

  // The explicit northern cross-path avoids forcing a return through the hub.
  ['forest-north', 'farm-north'],

  ['savanna-south', 'elephant-viewpoint'],
  ['savanna-bend', 'giraffe-viewpoint'],
  ['savanna-forest-junction', 'tiger-viewpoint'],
  ['forest-bend', 'deer-viewpoint'],
  ['forest-north', 'fox-viewpoint'],
  ['forest-north', 'wolf-viewpoint'],
  ['forest-bend', 'stag-viewpoint'],
  ['farm-south', 'horse-viewpoint'],
  ['farm-south', 'alpaca-viewpoint'],
  ['farm-east', 'cow-viewpoint'],
  ['farm-bend', 'bull-viewpoint'],
  ['cove-bend', 'donkey-viewpoint'],
  ['cove-bend', 'penguin-viewpoint'],
]);

const habitatColliders = habitats.map(({ id, x, z }) => ({
  id: `habitat-${id}`,
  role: 'habitatFence',
  habitatId: id,
  type: 'circle',
  x,
  z,
  r: 3.35,
}));

export const colliders = deepFreeze([
  ...habitatColliders,
  { id: 'entrance-gate-left', role: 'landmark', landmarkId: 'entranceGate', type: 'box', x: -3.15, z: 35.5, hw: 0.42, hd: 0.5, rotation: 0 },
  { id: 'entrance-gate-right', role: 'landmark', landmarkId: 'entranceGate', type: 'box', x: 3.15, z: 35.5, hw: 0.42, hd: 0.5, rotation: 0 },
  { id: 'fountain', role: 'landmark', landmarkId: 'fountainHub', type: 'circle', x: 3.2, z: 10, r: 1.45 },
  { id: 'giraffe-feeder', role: 'landmark', landmarkId: 'giraffeFeeder', type: 'box', x: -35, z: 13.4, hw: 0.5, hd: 0.5, rotation: 0 },
  { id: 'barn', role: 'landmark', landmarkId: 'barn', type: 'box', x: 32.5, z: 23.5, hw: 3, hd: 2.3, rotation: -0.08 },
  { id: 'giant-forest-tree', role: 'landmark', landmarkId: 'giantForestTree', type: 'circle', x: -0.5, z: -27, r: 2.1 },
  { id: 'penguin-pool-west', role: 'poolEdge', landmarkId: 'penguinBridge', type: 'box', x: 31.65, z: -14, hw: 0.22, hd: 3.1, rotation: 0 },
  { id: 'penguin-pool-east', role: 'poolEdge', landmarkId: 'penguinBridge', type: 'box', x: 38.35, z: -14, hw: 0.22, hd: 3.1, rotation: 0 },
  { id: 'penguin-pool-north', role: 'poolEdge', landmarkId: 'penguinBridge', type: 'box', x: 35, z: -17.1, hw: 3.55, hd: 0.22, rotation: 0 },
  { id: 'penguin-pool-south', role: 'poolEdge', landmarkId: 'penguinBridge', type: 'box', x: 35, z: -10.9, hw: 3.55, hd: 0.22, rotation: 0 },
]);

export const landmarks = deepFreeze([
  { id: 'entranceGate', x: 0, z: 35.5 },
  { id: 'plaza', x: 0, z: 31 },
  { id: 'fountainHub', x: 3.2, z: 10 },
  { id: 'giraffeFeeder', x: -35, z: 13.4 },
  { id: 'barn', x: 32.5, z: 23.5 },
  { id: 'penguinBridge', x: 35, z: -17.1 },
  { id: 'giantForestTree', x: -0.5, z: -27 },
]);

const nodesById = new Map(pathNodes.map((node) => [node.id, node]));
const adjacency = new Map(pathNodes.map((node) => [node.id, []]));

for (const [fromId, toId] of pathEdges) {
  const from = nodesById.get(fromId);
  const to = nodesById.get(toId);
  if (!from || !to) continue;
  const length = Math.hypot(to.x - from.x, to.z - from.z);
  adjacency.get(fromId).push({ id: toId, length });
  adjacency.get(toId).push({ id: fromId, length });
}

/**
 * Finds a shortest route through the undirected path graph.
 * Unknown node IDs return an empty, infinite route rather than throwing.
 */
export function shortestPath(fromNodeId, toNodeId) {
  if (!nodesById.has(fromNodeId) || !nodesById.has(toNodeId)) {
    const nodeIds = Object.freeze([]);
    return Object.freeze({ nodeIds, nodes: nodeIds, length: Infinity });
  }

  const distances = new Map(pathNodes.map((node) => [node.id, Infinity]));
  const previous = new Map();
  const unvisited = new Set(nodesById.keys());
  distances.set(fromNodeId, 0);

  while (unvisited.size > 0) {
    let currentId = null;
    let currentDistance = Infinity;
    for (const id of unvisited) {
      const distance = distances.get(id);
      if (distance < currentDistance) {
        currentId = id;
        currentDistance = distance;
      }
    }
    if (currentId === null || currentId === toNodeId) break;
    unvisited.delete(currentId);
    for (const neighbour of adjacency.get(currentId)) {
      if (!unvisited.has(neighbour.id)) continue;
      const candidate = currentDistance + neighbour.length;
      if (candidate < distances.get(neighbour.id)) {
        distances.set(neighbour.id, candidate);
        previous.set(neighbour.id, currentId);
      }
    }
  }

  const length = distances.get(toNodeId);
  if (!Number.isFinite(length)) {
    const nodeIds = Object.freeze([]);
    return Object.freeze({ nodeIds, nodes: nodeIds, length });
  }
  const route = [];
  for (let id = toNodeId; id !== undefined; id = previous.get(id)) {
    route.push(id);
    if (id === fromNodeId) break;
  }
  route.reverse();
  const nodeIds = Object.freeze(route);
  return Object.freeze({ nodeIds, nodes: nodeIds, length });
}

/** Returns whether a circular avatar may occupy a point without overlap. */
export function canOccupy(x, z, radius = PLAYER_RADIUS) {
  if (![x, z, radius].every(Number.isFinite) || radius < 0) return false;
  if (x - radius < bounds.minX || x + radius > bounds.maxX
    || z - radius < bounds.minZ || z + radius > bounds.maxZ) return false;

  for (const collider of colliders) {
    if (collider.type === 'circle') {
      const combinedRadius = collider.r + radius;
      if ((x - collider.x) ** 2 + (z - collider.z) ** 2 <= combinedRadius ** 2) return false;
      continue;
    }

    const cosine = Math.cos(collider.rotation);
    const sine = Math.sin(collider.rotation);
    const dx = x - collider.x;
    const dz = z - collider.z;
    const localX = dx * cosine - dz * sine;
    const localZ = dx * sine + dz * cosine;
    const outsideX = Math.max(Math.abs(localX) - collider.hw, 0);
    const outsideZ = Math.max(Math.abs(localZ) - collider.hd, 0);
    if ((outsideX === 0 && outsideZ === 0)
      || outsideX ** 2 + outsideZ ** 2 <= radius ** 2) return false;
  }
  return true;
}

/** Returns the nearest frozen path-node record, or null for invalid input. */
export function nearestNode(x, z) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  let nearest = null;
  let bestDistanceSquared = Infinity;
  for (const node of pathNodes) {
    const distanceSquared = (node.x - x) ** 2 + (node.z - z) ** 2;
    if (distanceSquared < bestDistanceSquared) {
      nearest = node;
      bestDistanceSquared = distanceSquared;
    }
  }
  return nearest;
}
