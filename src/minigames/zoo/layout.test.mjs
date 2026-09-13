import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PLAYER_RADIUS,
  SIGN_DEPTH,
  SIGN_WIDTH,
  bounds,
  canOccupy,
  colliders,
  habitats,
  landmarks,
  nearestNode,
  pathEdges,
  pathNodes,
  regions,
  signs,
  shortestPath,
} from './layout.js';

const ANIMALS = [
  'elephant', 'giraffe', 'penguin', 'tiger', 'deer', 'alpaca', 'horse',
  'fox', 'wolf', 'stag', 'bull', 'cow', 'donkey',
];
const HABITAT_REGIONS = ['savanna', 'forest', 'farm', 'penguinCove'];
const nodesById = new Map(pathNodes.map((node) => [node.id, node]));

test('the campus contains every animal exactly once in its specified region', () => {
  assert.deepEqual([...habitats.map(({ id }) => id)].sort(), [...ANIMALS].sort());
  assert.equal(new Set(habitats.map(({ id }) => id)).size, ANIMALS.length);
  assert.deepEqual(
    Object.fromEntries(habitats.map(({ id, region }) => [id, region])),
    {
      elephant: 'savanna', giraffe: 'savanna', tiger: 'savanna',
      deer: 'forest', fox: 'forest', wolf: 'forest', stag: 'forest',
      horse: 'farm', alpaca: 'farm', cow: 'farm', bull: 'farm', donkey: 'farm',
      penguin: 'penguinCove',
    },
  );
  const regionIds = new Set(regions.map(({ id }) => id));
  for (const habitat of habitats) assert.ok(regionIds.has(habitat.region), habitat.id);
});

test('every habitat viewpoint is a reachable path node and every region reaches the plaza', () => {
  for (const habitat of habitats) {
    const node = nodesById.get(`${habitat.id}-viewpoint`);
    assert.ok(node, `${habitat.id} is missing a viewpoint node`);
    assert.equal(node.kind, 'viewpoint');
    assert.deepEqual({ x: node.x, z: node.z }, habitat.viewpoint);
    const route = shortestPath('plaza', node.id);
    assert.equal(route.nodeIds[0], 'plaza');
    assert.equal(route.nodeIds.at(-1), node.id);
    assert.ok(Number.isFinite(route.length));
  }

  for (const region of HABITAT_REGIONS) {
    const habitat = habitats.find((candidate) => candidate.region === region);
    const route = shortestPath(`${habitat.id}-viewpoint`, 'plaza');
    assert.equal(route.nodeIds.at(-1), 'plaza', `${region} cannot reach the plaza`);
  }
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

test('only one-edge viewpoint spurs are dead ends', () => {
  const degree = new Map(pathNodes.map(({ id }) => [id, 0]));
  for (const [fromId, toId] of pathEdges) {
    degree.set(fromId, degree.get(fromId) + 1);
    degree.set(toId, degree.get(toId) + 1);
  }
  for (const node of pathNodes) {
    if (degree.get(node.id) !== 1) continue;
    assert.equal(node.kind, 'viewpoint', `${node.id} begins a non-viewpoint dead-end chain`);
    const edge = pathEdges.find(([fromId, toId]) => fromId === node.id || toId === node.id);
    const neighbourId = edge[0] === node.id ? edge[1] : edge[0];
    assert.ok(degree.get(neighbourId) > 1, `${node.id} is on a longer dead-end chain`);
  }
});

test('all path nodes and viewpoints are valid player positions inside the bounds', () => {
  const inBounds = ({ x, z }) => x >= bounds.minX && x <= bounds.maxX
    && z >= bounds.minZ && z <= bounds.maxZ;
  for (const node of pathNodes) {
    assert.ok(inBounds(node), `${node.id} is outside bounds`);
    assert.ok(canOccupy(node.x, node.z, PLAYER_RADIUS), `${node.id} is blocked`);
  }
  for (const habitat of habitats) {
    assert.ok(inBounds(habitat.viewpoint), `${habitat.id} viewpoint is outside bounds`);
    assert.ok(canOccupy(habitat.viewpoint.x, habitat.viewpoint.z, PLAYER_RADIUS), `${habitat.id} viewpoint is blocked`);
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

test('the farthest habitat is comfortably within the travel budget', () => {
  const routes = habitats.map(({ id }) => shortestPath('plaza', `${id}-viewpoint`));
  const farthest = Math.max(...routes.map(({ length }) => length));
  assert.ok(farthest <= 135, `farthest route is ${farthest.toFixed(2)} units`);
});

test('habitat signs are explicit, path-facing, and clear every photo sightline', () => {
  assert.equal(signs.length, habitats.length);
  assert.deepEqual(
    [...signs.map(({ habitatId }) => habitatId)].sort(),
    [...habitats.map(({ id }) => id)].sort(),
  );
  for (const sign of signs) {
    const habitat = habitats.find(({ id }) => id === sign.habitatId);
    const viewpointId = `${habitat.id}-viewpoint`;
    const spur = pathEdges.find(([a, b]) => a === viewpointId || b === viewpointId);
    const approach = nodesById.get(spur[0] === viewpointId ? spur[1] : spur[0]);
    const toApproachX = approach.x - sign.x;
    const toApproachZ = approach.z - sign.z;
    const approachLength = Math.hypot(toApproachX, toApproachZ);
    const faceAlignment = (
      Math.sin(sign.facing) * toApproachX + Math.cos(sign.facing) * toApproachZ
    ) / approachLength;
    assert.ok(faceAlignment >= 0.8, `${sign.habitatId} sign does not face its approach path`);

    const margin = 0.45;
    const crossesSightline = segmentIntersectsBox(habitat.viewpoint, habitat, {
      x: sign.x,
      z: sign.z,
      hw: SIGN_WIDTH * 0.5 + margin,
      hd: SIGN_DEPTH * 0.5 + margin,
      rotation: sign.facing,
    });
    assert.equal(crossesSightline, false, `${sign.habitatId} sign crosses its photo sightline`);
  }
});

function pointInPolygon(point, polygon) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const a = polygon[index];
    const b = polygon[previous];
    const crosses = ((a.z > point.z) !== (b.z > point.z))
      && point.x < (b.x - a.x) * (point.z - a.z) / (b.z - a.z) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

test('the campus has interior exhibits, a bent entrance, and place-like junctions', () => {
  const polygon = (ids) => ids.map((id) => nodesById.get(id));
  const westLoop = polygon([
    'fountain-hub', 'savanna-south', 'savanna-bend', 'savanna-forest-junction',
    'forest-bend', 'forest-north', 'north-cross',
  ]);
  const eastLoop = polygon([
    'fountain-hub', 'farm-south', 'farm-bend', 'farm-east', 'cove-bend',
    'farm-north', 'north-cross',
  ]);
  const interior = habitats.filter((candidate) => (
    pointInPolygon(candidate, westLoop) || pointInPolygon(candidate, eastLoop)
  ));
  assert.ok(interior.length >= 3, `only ${interior.length} habitats are inside a loop`);

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

test('the donkey is spaced inside the Farm and deer is separated from stag', () => {
  const donkey = habitats.find(({ id }) => id === 'donkey');
  assert.equal(donkey.region, 'farm');
  for (const other of habitats.filter(({ region, id }) => region === 'farm' && id !== 'donkey')) {
    assert.ok(Math.hypot(donkey.x - other.x, donkey.z - other.z) >= 14.5,
      `donkey fence is too close to ${other.id}`);
  }
  const penguin = habitats.find(({ id }) => id === 'penguin');
  assert.ok(Math.hypot(donkey.x - penguin.x, donkey.z - penguin.z) >= 16);
  const deer = habitats.find(({ id }) => id === 'deer');
  const stag = habitats.find(({ id }) => id === 'stag');
  assert.ok(Math.hypot(deer.x - stag.x, deer.z - stag.z) >= 16);
});

test('Penguin Cove is well separated from the giraffe', () => {
  const penguin = habitats.find(({ id }) => id === 'penguin');
  const giraffe = habitats.find(({ id }) => id === 'giraffe');
  assert.ok(Math.hypot(penguin.x - giraffe.x, penguin.z - giraffe.z) >= 25);
});

test('each viewpoint has a useful photo distance and faces the habitat correctly', () => {
  for (const habitat of habitats) {
    const dx = habitat.viewpoint.x - habitat.x;
    const dz = habitat.viewpoint.z - habitat.z;
    const distance = Math.hypot(dx, dz);
    assert.ok(distance >= 4 && distance <= 9, `${habitat.id} photo distance is ${distance}`);
    const facingX = Math.sin(habitat.facing);
    const facingZ = Math.cos(habitat.facing);
    const alignment = (facingX * dx + facingZ * dz) / distance;
    assert.ok(alignment >= 0.85, `${habitat.id} does not face its viewpoint`);
  }
});

test('layout navigation data is frozen and never refers to a current request', () => {
  for (const value of [regions, habitats, signs, pathNodes, pathEdges, colliders, bounds, landmarks]) {
    assert.ok(Object.isFrozen(value));
  }
  assert.doesNotMatch(JSON.stringify({ landmarks }), /current[ _-]?request|requested|targetAnimal/i);
  assert.equal(nearestNode(0.1, 30.8).id, 'plaza');
});
