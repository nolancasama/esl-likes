import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PLAYER_RADIUS,
  bounds,
  canOccupy,
  colliders,
  landmarks,
  nearestNode,
  pathEdges,
  pathNodes,
  regions,
  shortestPath,
} from './layout.js';

const AREA_IDS = ['grassland', 'woodland', 'farm', 'cove'];
const nodesById = new Map(pathNodes.map((node) => [node.id, node]));

test('the park has no enclosures, viewpoints or habitat colliders left', () => {
  // The pens are gone; nothing invisible may be left standing where they were.
  for (const collider of colliders) {
    assert.notEqual(collider.role, 'habitatFence', `${collider.id} is a leftover pen`);
    assert.equal(collider.habitatId, undefined, `${collider.id} still names a habitat`);
  }
  for (const node of pathNodes) {
    assert.notEqual(node.kind, 'viewpoint', `${node.id} is a leftover viewpoint`);
    assert.doesNotMatch(node.id, /viewpoint/, `${node.id} is a leftover viewpoint`);
  }
});

test('the broad areas are named and nothing is called a zoo region', () => {
  const ids = regions.map(({ id }) => id);
  for (const area of AREA_IDS) assert.ok(ids.includes(area), `${area} is missing`);
  assert.ok(!ids.includes('savanna'));
  assert.ok(!ids.includes('penguinCove'));
});

test('the map is the size it always was', () => {
  // The search challenge comes from animals moving, not from longer walks.
  assert.equal(bounds.maxX - bounds.minX, 82);
  assert.equal(bounds.maxZ - bounds.minZ, 70);
});

test('the undirected path graph is connected', () => {
  const visited = new Set(['plaza']);
  const pending = ['plaza'];
  while (pending.length > 0) {
    const id = pending.pop();
    for (const edge of pathEdges) {
      const next = edge[0] === id ? edge[1] : edge[1] === id ? edge[0] : null;
      if (next && !visited.has(next)) {
        visited.add(next);
        pending.push(next);
      }
    }
  }
  assert.equal(visited.size, pathNodes.length);
});

test('no path node is a dead end', () => {
  // The spokes that used to lead to a pen are gone, and with them the shape
  // that told a child exactly where an animal stood.
  const degree = new Map(pathNodes.map(({ id }) => [id, 0]));
  for (const [fromId, toId] of pathEdges) {
    degree.set(fromId, degree.get(fromId) + 1);
    degree.set(toId, degree.get(toId) + 1);
  }
  for (const node of pathNodes) {
    assert.ok(degree.get(node.id) >= 2, `${node.id} is a dead-end spur`);
  }
});

test('every path node is a valid player position inside the bounds', () => {
  for (const node of pathNodes) {
    assert.ok(node.x >= bounds.minX && node.x <= bounds.maxX, `${node.id} is outside bounds`);
    assert.ok(node.z >= bounds.minZ && node.z <= bounds.maxZ, `${node.id} is outside bounds`);
    assert.ok(canOccupy(node.x, node.z, PLAYER_RADIUS), `${node.id} is blocked`);
  }
});

function distanceToSegmentSquared(point, start, end) {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const lengthSquared = dx ** 2 + dz ** 2;
  const amount = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1,
    ((point.x - start.x) * dx + (point.z - start.z) * dz) / lengthSquared));
  const x = start.x + dx * amount;
  const z = start.z + dz * amount;
  return (point.x - x) ** 2 + (point.z - z) ** 2;
}

function segmentIntersectsBox(start, end, collider) {
  const cosine = Math.cos(collider.rotation);
  const sine = Math.sin(collider.rotation);
  const local = (point) => {
    const dx = point.x - collider.x;
    const dz = point.z - collider.z;
    return { x: dx * cosine - dz * sine, z: dx * sine + dz * cosine };
  };
  const a = local(start);
  const b = local(end);
  let minimum = 0;
  let maximum = 1;
  for (const [origin, delta, halfSize] of [
    [a.x, b.x - a.x, collider.hw],
    [a.z, b.z - a.z, collider.hd],
  ]) {
    if (Math.abs(delta) < 1e-9) {
      if (origin < -halfSize || origin > halfSize) return false;
      continue;
    }
    const first = (-halfSize - origin) / delta;
    const second = (halfSize - origin) / delta;
    minimum = Math.max(minimum, Math.min(first, second));
    maximum = Math.min(maximum, Math.max(first, second));
    if (minimum > maximum) return false;
  }
  return true;
}

test('no collider overlaps a path edge centreline', () => {
  for (const [fromId, toId] of pathEdges) {
    const start = nodesById.get(fromId);
    const end = nodesById.get(toId);
    for (const collider of colliders) {
      const intersects = collider.type === 'circle'
        ? distanceToSegmentSquared(collider, start, end) <= collider.r ** 2
        : segmentIntersectsBox(start, end, collider);
      assert.equal(intersects, false, `${collider.id} overlaps ${fromId} -> ${toId}`);
    }
  }
});

test('the path network still reaches every corner of the park from the plaza', () => {
  for (const area of AREA_IDS) {
    const region = regions.find((candidate) => candidate.id === area);
    const node = nearestNode(region.center.x, region.center.z);
    const route = shortestPath('plaza', node.id);
    assert.equal(route.nodeIds[0], 'plaza', `${area} does not start at the plaza`);
    assert.ok(Number.isFinite(route.length), `${area} is unreachable`);
    assert.ok(route.length <= 135, `${area} route is ${route.length.toFixed(1)} units`);
  }
});

test('the entrance still bends rather than running straight to the fountain', () => {
  const plaza = nodesById.get('plaza');
  const bend = nodesById.get('entrance-bend');
  const hub = nodesById.get('fountain-hub');
  const crossProduct = (bend.x - plaza.x) * (hub.z - bend.z)
    - (bend.z - plaza.z) * (hub.x - bend.x);
  assert.ok(Math.abs(crossProduct) >= 5, 'the plaza-to-fountain route is still straight');

  const degree = (id) => pathEdges.filter(([a, b]) => a === id || b === id).length;
  assert.ok(degree('plaza') >= 3 && degree('plaza') <= 4);
  assert.ok(degree('fountain-hub') >= 3 && degree('fountain-hub') <= 4);
});

test('layout navigation data is frozen and never refers to a current request', () => {
  for (const value of [regions, pathNodes, pathEdges, colliders, bounds, landmarks]) {
    assert.ok(Object.isFrozen(value));
  }
  assert.doesNotMatch(JSON.stringify({ landmarks }), /current[ _-]?request|requested|targetAnimal/i);
  assert.equal(nearestNode(0.1, 30.8).id, 'plaza');
});
