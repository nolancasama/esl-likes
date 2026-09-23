import test from 'node:test';
import assert from 'node:assert/strict';

import { canOccupy } from './layout.js';
import {
  ANIMAL_IDS,
  ANIMAL_RADIUS,
  AREAS,
  TERRITORIES,
  TERRITORY_BY_ID,
  canStand,
  canWalkBetween,
  withinTerritory,
} from './territories.js';
import { IDLE_SECONDS, createRng, createRoamingAnimal, spawnAnimals } from './roaming.js';
import { ANIMALS } from './scoring.js';

const EXPECTED = ['cat', 'chicken', 'dog', 'horse', 'pig', 'raccoon', 'sheep', 'wolf'];
const REMOVED = ['elephant', 'alpaca', 'fox', 'stag', 'bull', 'cow', 'donkey'];

// --- roster -----------------------------------------------------------------

test('exactly eight animals roam the park', () => {
  assert.equal(ANIMAL_IDS.length, 8);
  assert.deepEqual([...ANIMAL_IDS].sort(), [...EXPECTED].sort());
  assert.deepEqual([...ANIMALS].sort(), [...EXPECTED].sort());
});

test('a removed species can never be requested or given a territory', () => {
  for (const removed of REMOVED) {
    assert.ok(!ANIMALS.includes(removed), `${removed} is still requestable`);
    assert.equal(TERRITORY_BY_ID[removed], undefined, `${removed} still has a territory`);
  }
});

test('every animal belongs to a named area', () => {
  const areaIds = new Set(AREAS.map(({ id }) => id));
  for (const territory of TERRITORIES) {
    assert.ok(areaIds.has(territory.area), `${territory.id} is in unknown area ${territory.area}`);
  }
});

// --- territories ------------------------------------------------------------

test('each territory has 4-8 waypoints, all of them standable', () => {
  for (const territory of TERRITORIES) {
    assert.ok(territory.waypoints.length >= 4 && territory.waypoints.length <= 8,
      `${territory.id} has ${territory.waypoints.length} waypoints`);
    for (const point of territory.waypoints) {
      assert.ok(canStand(territory.id, point.x, point.z),
        `${territory.id} waypoint (${point.x}, ${point.z}) is inside scenery`);
    }
  }
});

test('no territory is larger than a patch of the park', () => {
  // Roughly 12-20 units across. A territory that spanned the map would make the
  // animal unfindable; one much smaller would make it a pen by another name.
  for (const territory of TERRITORIES) {
    const width = territory.bounds.maxX - territory.bounds.minX;
    const depth = territory.bounds.maxZ - territory.bounds.minZ;
    assert.ok(width <= 23 && depth <= 23, `${territory.id} spans ${width} x ${depth}`);
    assert.ok(width >= 10 && depth >= 10, `${territory.id} spans only ${width} x ${depth}`);
  }
});

test('every territory is internally reachable', () => {
  // An animal that walked into a corner it could not walk out of would stand
  // there for the rest of the session.
  for (const territory of TERRITORIES) {
    const points = territory.waypoints;
    const seen = new Set([0]);
    const queue = [0];
    while (queue.length) {
      const current = queue.pop();
      points.forEach((point, index) => {
        if (index === current || seen.has(index)) return;
        if (!canWalkBetween(territory.id, points[current], point)) return;
        seen.add(index);
        queue.push(index);
      });
    }
    assert.equal(seen.size, points.length, `${territory.id} has unreachable waypoints`);
  }
});

test('the pig never has to cross the cove pool', () => {
  const pig = TERRITORY_BY_ID.pig;
  for (const point of pig.waypoints) {
    assert.ok(canOccupy(point.x, point.z, ANIMAL_RADIUS.pig),
      `pig waypoint (${point.x}, ${point.z}) is in the water`);
  }
});

// --- the state machine ------------------------------------------------------

function run(animal, seconds, dt = 1 / 60) {
  const samples = [];
  for (let t = 0; t < seconds; t += dt) {
    animal.update(dt);
    samples.push({ x: animal.x, z: animal.z, state: animal.state });
  }
  return samples;
}

test('an animal starts idle, then begins to walk', () => {
  const animal = createRoamingAnimal('dog', { rng: createRng(7) });
  assert.equal(animal.state, 'idle');
  const samples = run(animal, 30);
  assert.ok(samples.some((sample) => sample.state === 'walking'), 'never started walking');
});

test('an idle animal does not move, and idles for a few seconds at a time', () => {
  const animal = createRoamingAnimal('wolf', { rng: createRng(3) });
  const start = { x: animal.x, z: animal.z };
  // It is idle at t=0 for at least IDLE_SECONDS.min before anything happens.
  run(animal, IDLE_SECONDS.min * 0.9);
  assert.equal(animal.state, 'idle');
  assert.equal(animal.x, start.x);
  assert.equal(animal.z, start.z);
});

test('walking stops on arrival and returns to idle', () => {
  const animal = createRoamingAnimal('horse', { rng: createRng(11) });
  const samples = run(animal, 120);
  let sawWalk = false;
  let sawWalkThenIdle = false;
  for (const sample of samples) {
    if (sample.state === 'walking') sawWalk = true;
    else if (sawWalk) sawWalkThenIdle = true;
  }
  assert.ok(sawWalk && sawWalkThenIdle, 'never completed a walk-then-idle cycle');
});

test('an animal reaches the waypoint it chose', () => {
  const animal = createRoamingAnimal('dog', { rng: createRng(5) });
  let destination = null;
  for (let t = 0; t < 60 && !destination; t += 1 / 60) {
    animal.update(1 / 60);
    destination = animal.destination;
  }
  assert.ok(destination, 'never chose a destination');
  for (let t = 0; t < 60 && animal.state === 'walking'; t += 1 / 60) {
    animal.update(1 / 60);
  }
  assert.equal(animal.state, 'idle', 'never completed its first walk');
  // Arrival deliberately stops within the roamer's radius instead of snapping.
  assert.ok(Math.hypot(animal.x - destination.x, animal.z - destination.z) < 0.5,
    'stopped somewhere that is not its chosen waypoint');
});

test('an animal never teleports during normal roaming', () => {
  for (const id of ANIMAL_IDS) {
    const animal = createRoamingAnimal(id, { rng: createRng(23) });
    let previous = { x: animal.x, z: animal.z };
    const dt = 1 / 60;
    for (let t = 0; t < 90; t += dt) {
      animal.update(dt);
      const step = Math.hypot(animal.x - previous.x, animal.z - previous.z);
      // A single frame can never carry an animal further than its own speed.
      assert.ok(step <= animal.speed * dt + 1e-6,
        `${id} jumped ${step.toFixed(3)} in one frame`);
      previous = { x: animal.x, z: animal.z };
    }
  }
});

test('an animal stays inside its own territory and out of scenery', () => {
  for (const id of ANIMAL_IDS) {
    const animal = createRoamingAnimal(id, { rng: createRng(41) });
    for (let t = 0; t < 240; t += 1 / 30) {
      animal.update(1 / 30);
      assert.ok(withinTerritory(id, animal.x, animal.z, 0.5),
        `${id} left its territory at (${animal.x.toFixed(1)}, ${animal.z.toFixed(1)})`);
      assert.ok(canStand(id, animal.x, animal.z),
        `${id} walked into scenery at (${animal.x.toFixed(1)}, ${animal.z.toFixed(1)})`);
    }
  }
});

test('no animal roams across the whole park', () => {
  for (const id of ANIMAL_IDS) {
    const animal = createRoamingAnimal(id, { rng: createRng(67) });
    let minX = Infinity; let maxX = -Infinity;
    for (let t = 0; t < 600; t += 1 / 20) {
      animal.update(1 / 20);
      minX = Math.min(minX, animal.x);
      maxX = Math.max(maxX, animal.x);
    }
    assert.ok(maxX - minX <= 23, `${id} ranged ${(maxX - minX).toFixed(1)} units across`);
  }
});

test('a blocked destination is rejected rather than walked through', () => {
  // The cove pool sits between waypoints, so it rejects some straight lines.
  const pig = TERRITORY_BY_ID.pig;
  const blocked = pig.waypoints.flatMap((from) => pig.waypoints
    .filter((to) => from !== to && !canWalkBetween('pig', from, to)));
  assert.ok(blocked.length > 0, 'the pool blocks nothing, so the check is not exercised');

  const animal = createRoamingAnimal('pig', { rng: createRng(13) });
  for (let t = 0; t < 400; t += 1 / 30) {
    animal.update(1 / 30);
    assert.ok(canStand('pig', animal.x, animal.z), 'the pig entered the pool');
  }
});

// --- determinism and spawning ----------------------------------------------

test('the same seed replays the same roaming exactly', () => {
  const trace = (seed) => {
    const animal = createRoamingAnimal('cat', { rng: createRng(seed) });
    return run(animal, 60, 1 / 30).map(({ x, z }) => `${x.toFixed(4)},${z.toFixed(4)}`).join('|');
  };
  assert.equal(trace(99), trace(99));
  assert.notEqual(trace(99), trace(100));
});

test('spawning places every animal somewhere valid in its own territory', () => {
  for (const seed of [1, 2, 17, 512, 9001]) {
    const animals = spawnAnimals({ rng: createRng(seed) });
    assert.deepEqual(Object.keys(animals).sort(), [...EXPECTED].sort());
    for (const [id, animal] of Object.entries(animals)) {
      assert.ok(canStand(id, animal.x, animal.z), `${id} spawned in scenery (seed ${seed})`);
      assert.ok(withinTerritory(id, animal.x, animal.z), `${id} spawned outside its territory`);
    }
  }
});

test('animals do not spawn on top of each other or in the player\'s lap', () => {
  for (const seed of [4, 44, 444, 4444]) {
    const animals = spawnAnimals({ rng: createRng(seed), avoid: { x: 0, z: 31, radius: 12 } });
    const placed = Object.values(animals);
    for (const animal of placed) {
      assert.ok(Math.hypot(animal.x - 0, animal.z - 31) >= 12,
        `${animal.id} spawned on the entrance (seed ${seed})`);
    }
    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        const gap = Math.hypot(placed[i].x - placed[j].x, placed[i].z - placed[j].z);
        assert.ok(gap >= 4, `${placed[i].id} and ${placed[j].id} spawned ${gap.toFixed(1)} apart`);
      }
    }
  }
});

test('animals do not all start in the same place every session', () => {
  const positions = new Set();
  for (let seed = 1; seed <= 12; seed += 1) {
    const animals = spawnAnimals({ rng: createRng(seed) });
    positions.add(ANIMAL_IDS.map((id) => `${animals[id].x},${animals[id].z}`).join('|'));
  }
  assert.ok(positions.size > 1, 'every session laid the park out identically');
});

test('animals never flee: approaching one does not change its speed', () => {
  // There is no player argument anywhere in the roaming update, which is the
  // point — a child can walk up to an animal and wait for it to stop.
  const animal = createRoamingAnimal('dog', { rng: createRng(8) });
  assert.equal(animal.update.length, 1);
  assert.equal(animal.speed, TERRITORY_BY_ID.dog.speed);
  run(animal, 60);
  assert.equal(animal.speed, TERRITORY_BY_ID.dog.speed);
});

test('every walking animal is slower than the player', () => {
  const PLAYER_SPEED = 13.5;
  for (const territory of TERRITORIES) {
    assert.ok(territory.speed < PLAYER_SPEED, `${territory.id} outruns the player`);
    if (territory.speed > 0) {
      assert.ok(territory.speed > 0.5, `${territory.id} is too slow to read as walking`);
    }
  }
});

test('the horse now roams with its own walk cycle speed', () => {
  assert.equal(TERRITORY_BY_ID.horse.speed, 1.8);
  assert.equal(TERRITORY_BY_ID.horse.clipSpeed, 2.0);
  const horse = createRoamingAnimal('horse', { rng: createRng(5) });
  const start = { x: horse.x, z: horse.z };
  const samples = run(horse, 60);
  assert.ok(samples.some((sample) => sample.state === 'walking'));
  assert.ok(Math.hypot(horse.x - start.x, horse.z - start.z) > 0.5);
});
