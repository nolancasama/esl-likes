/**
 * Pure, fixed spatial data for the Zoo campus. Coordinates use the same
 * convention as the three.js world: +x is right and +z is toward the entrance.
 * This module deliberately has no renderer or browser dependencies so both the
 * game and the playthrough harness can rely on the same navigation data.
 */

export const PLAYER_RADIUS = 0.72;
export const PATH_WIDTH = 4.8;

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

// Broad areas of the park. These are orientation only: nothing is fenced and
// no sign names them. Animals roam territories inside them (see territories.js).
export const regions = deepFreeze([
  { id: 'entrance', name: 'エントランス', center: { x: 0, z: 31 } },
  { id: 'hub', name: '中央広場', center: { x: 0, z: 10 } },
  { id: 'grassland', name: 'くさはら', center: { x: -25, z: 10 } },
  { id: 'woodland', name: 'もり', center: { x: -20, z: -18 } },
  { id: 'farm', name: 'ぼくじょう', center: { x: 23, z: 14 } },
]);

export const pathNodes = deepFreeze([
  { id: 'plaza', x: 0, z: 31, kind: 'plaza' },
  { id: 'entrance-bend', x: -2, z: 23.5, kind: 'path' },
  { id: 'central-hub', x: 0, z: 10, kind: 'hub' },

  { id: 'savanna-south', x: -10, z: 19, kind: 'junction' },
  { id: 'savanna-bend', x: -25, z: 15, kind: 'junction' },
  { id: 'savanna-forest-junction', x: -27, z: 3, kind: 'junction' },
  { id: 'forest-bend', x: -25, z: -11, kind: 'junction' },
  { id: 'forest-north', x: -12, z: -19, kind: 'junction' },
  { id: 'north-cross', x: 1, z: -17, kind: 'path' },

  { id: 'farm-south', x: 12, z: 20, kind: 'junction' },
  { id: 'farm-bend', x: 25, z: 14, kind: 'junction' },
  { id: 'farm-east', x: 29, z: 2, kind: 'junction' },
  { id: 'east-bend', x: 28, z: -10, kind: 'junction' },
  { id: 'farm-north', x: 14, z: -18, kind: 'junction' },
]);

export const pathEdges = deepFreeze([
  ['plaza', 'entrance-bend'],
  ['entrance-bend', 'central-hub'],
  ['plaza', 'savanna-south'],
  ['plaza', 'farm-south'],

  // West lobe: Savanna flows into the Forest trail.
  ['central-hub', 'savanna-south'],
  ['savanna-south', 'savanna-bend'],
  ['savanna-bend', 'savanna-forest-junction'],
  ['savanna-forest-junction', 'forest-bend'],
  ['forest-bend', 'forest-north'],
  ['forest-north', 'north-cross'],
  ['north-cross', 'central-hub'],

  // East lobe: Farm bends through the open park and back across the north.
  ['central-hub', 'farm-south'],
  ['farm-south', 'farm-bend'],
  ['farm-bend', 'farm-east'],
  ['farm-east', 'east-bend'],
  ['east-bend', 'farm-north'],
  ['farm-north', 'north-cross'],

  // The explicit northern cross-path avoids forcing a return through the hub.
  ['forest-north', 'farm-north'],
]);

// Only real scenery blocks movement now. The circular habitat fences are gone
// with the enclosures, and no invisible ring is left behind where they stood.
export const colliders = deepFreeze([
  { id: 'giant-forest-tree', role: 'landmark', landmarkId: 'giantForestTree', type: 'circle', x: -0.5, z: -27, r: 2.1 },
]);

export const landmarks = deepFreeze([
  { id: 'plaza', x: 0, z: 31 },
  { id: 'giantForestTree', x: -0.5, z: -27 },
]);

// Small retained props are kept as placement data so procedural scatter can
// leave them breathing room without turning them into player colliders.
export const retainedProps = deepFreeze([
  { id: 'forestLog', x: -30, z: -19, clearance: 3.1 },
  { id: 'farmHayA', x: 27, z: 27, clearance: 1.8 },
  { id: 'farmHayB', x: 28.2, z: 27.1, clearance: 1.5 },
  { id: 'farmTrough', x: 20.2, z: 27, clearance: 2.4 },
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
