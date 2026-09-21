/**
 * The roaming state machine that moves the eight animals around the park.
 *
 * Pure: it knows positions, headings and time, and nothing about three.js. The
 * renderer reads `x`, `z`, `facing` and `state` each frame and copies them onto
 * a model. That keeps the behaviour testable without a browser, and lets the
 * playthrough harness reason about where an animal will be.
 *
 * Each animal alternates between two states and nothing else:
 *
 *   IDLE   — standing still, playing its idle clip, for a few seconds
 *   WALK   — turning toward a chosen waypoint, then travelling to it
 *
 * Deliberately absent: fleeing. Walking up to an animal does not startle it, so
 * a child can stand still, wait for it to stop, and take the photograph. That is
 * the whole game; an animal that ran away would break it.
 */

import {
  ANIMAL_RADIUS,
  TERRITORIES,
  TERRITORY_BY_ID,
  canStand,
  canWalkBetween,
} from './territories.js';

const TAU = Math.PI * 2;

export const IDLE_SECONDS = Object.freeze({ min: 2, max: 6 });

/** Radians per second an animal turns toward its destination. */
const TURN_RATE = 2.4;
/** How close counts as arrived. */
const ARRIVAL_RADIUS = 0.35;
/** Heading error beyond which an animal turns on the spot before setting off. */
const TURN_FIRST = 0.7;

/** A small seeded generator, so a session or a test can be reproduced exactly. */
export function createRng(seed = 1) {
  let state = (Math.floor(seed) || 1) >>> 0;
  return function rng() {
    state ^= state << 13; state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5; state >>>= 0;
    return state / 0x100000000;
  };
}

function shortestTurn(from, to) {
  let delta = (to - from) % TAU;
  if (delta > Math.PI) delta -= TAU;
  if (delta < -Math.PI) delta += TAU;
  return delta;
}

/**
 * Creates one roaming animal. `rng` is injected so spawn and waypoint choice are
 * reproducible; pass the same seed and the same session replays.
 */
export function createRoamingAnimal(animalId, { rng = Math.random, start = null } = {}) {
  const territory = TERRITORY_BY_ID[animalId];
  if (!territory) throw new Error(`no territory for "${animalId}"`);

  const waypoints = territory.waypoints;
  const origin = start ?? waypoints[Math.min(waypoints.length - 1, Math.floor(rng() * waypoints.length))];

  const animal = {
    id: animalId,
    area: territory.area,
    speed: territory.speed,
    clipSpeed: territory.clipSpeed,
    radius: ANIMAL_RADIUS[animalId] ?? 0.6,
    x: origin.x,
    z: origin.z,
    facing: rng() * TAU,
    state: 'idle',
    destination: null,
    timer: IDLE_SECONDS.min + rng() * (IDLE_SECONDS.max - IDLE_SECONDS.min),
    blockedChoices: 0,
    stuckRecoveries: 0,
  };

  /**
   * Chooses somewhere else to go. A destination is rejected if it is where the
   * animal already stands, or if the straight line to it is blocked by scenery,
   * which is what keeps animals out of the fountain, the barn and the pool
   * without a navmesh.
   */
  function chooseDestination() {
    const options = [];
    for (const point of waypoints) {
      if (Math.hypot(point.x - animal.x, point.z - animal.z) < 1) continue;
      if (!canWalkBetween(animalId, animal, point)) {
        animal.blockedChoices += 1;
        continue;
      }
      options.push(point);
    }
    if (!options.length) return null;
    return options[Math.min(options.length - 1, Math.floor(rng() * options.length))];
  }

  function beginIdle() {
    animal.state = 'idle';
    animal.destination = null;
    animal.timer = IDLE_SECONDS.min + rng() * (IDLE_SECONDS.max - IDLE_SECONDS.min);
  }

  function beginWalk() {
    // A speed of zero means this animal never walks. It idles where it spawned
    // for the whole session, which is what the giraffe does.
    if (animal.speed <= 0) {
      animal.timer = IDLE_SECONDS.max;
      return;
    }
    const destination = chooseDestination();
    if (!destination) {
      // Nowhere valid to go: wait and try again rather than teleport out.
      animal.stuckRecoveries += 1;
      animal.timer = 1;
      return;
    }
    animal.state = 'walking';
    animal.destination = destination;
  }

  function step(dt) {
    if (animal.state === 'idle') {
      animal.timer -= dt;
      if (animal.timer <= 0) beginWalk();
      return;
    }

    const target = animal.destination;
    const dx = target.x - animal.x;
    const dz = target.z - animal.z;
    const distance = Math.hypot(dx, dz);
    if (distance <= ARRIVAL_RADIUS) {
      // Close enough. The animal stops where it stands rather than being
      // snapped onto the waypoint: a snap is a teleport, however small, and it
      // showed up as a visible hitch at the end of every walk.
      beginIdle();
      return;
    }

    // Turn toward the destination first; a sharp corner is turned on the spot
    // so an animal never slides sideways through a stride.
    const desired = Math.atan2(dx, dz);
    const error = shortestTurn(animal.facing, desired);
    const turn = Math.max(-TURN_RATE * dt, Math.min(TURN_RATE * dt, error));
    animal.facing += turn;
    if (Math.abs(error) > TURN_FIRST) return;

    const travel = Math.min(animal.speed * dt, distance);
    const nextX = animal.x + Math.sin(animal.facing) * travel;
    const nextZ = animal.z + Math.cos(animal.facing) * travel;
    if (canStand(animalId, nextX, nextZ)) {
      animal.x = nextX;
      animal.z = nextZ;
      return;
    }

    // Scenery in the way that the straight-line check did not predict — a
    // rounding case, or another animal's push. Give up on this destination and
    // pick a different one rather than grinding against the obstacle.
    animal.stuckRecoveries += 1;
    beginIdle();
    animal.timer = 0.5;
  }

  return {
    get id() { return animal.id; },
    get x() { return animal.x; },
    get z() { return animal.z; },
    get facing() { return animal.facing; },
    get state() { return animal.state; },
    get speed() { return animal.speed; },
    get clipSpeed() { return animal.clipSpeed; },
    get destination() { return animal.destination; },
    get radius() { return animal.radius; },

    /** Advances the animal. `dt` is clamped so a stalled tab cannot teleport it. */
    update(dt) {
      const step_ = Math.max(0, Math.min(Number.isFinite(dt) ? dt : 0, 0.1));
      if (step_ > 0) step(step_);
      return animal.state;
    },

    /** Where the animal is, for the renderer and the photo target. */
    position() {
      return { x: animal.x, z: animal.z };
    },

    debug() {
      return {
        id: animal.id,
        area: animal.area,
        x: Number(animal.x.toFixed(2)),
        z: Number(animal.z.toFixed(2)),
        facing: Number(animal.facing.toFixed(3)),
        state: animal.state,
        destination: animal.destination ? { ...animal.destination } : null,
        speed: animal.speed,
        territory: territory.id,
        bounds: territory.bounds,
        blockedChoices: animal.blockedChoices,
        stuckRecoveries: animal.stuckRecoveries,
      };
    },
  };
}

/**
 * Places every animal for a new session.
 *
 * Randomised, so the park is not laid out identically every time, but
 * constrained: no two animals start on top of each other, nobody starts in the
 * player's lap at the entrance, and the animal the visitor is about to ask for
 * gets no special treatment — it is placed from the same pool as the rest, so
 * it is never reliably sitting in the easiest spot.
 */
export function spawnAnimals({ rng = Math.random, avoid = null, minSeparation = 4 } = {}) {
  const placed = [];
  const animals = {};

  for (const territory of TERRITORIES) {
    const candidates = [...territory.waypoints];
    // Fisher-Yates with the injected rng, so the order is reproducible.
    for (let i = candidates.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }

    const clear = (point) => {
      if (avoid && Math.hypot(point.x - avoid.x, point.z - avoid.z) < (avoid.radius ?? 8)) return false;
      return placed.every((other) => Math.hypot(point.x - other.x, point.z - other.z) >= minSeparation);
    };

    const start = candidates.find(clear) ?? candidates[0];
    placed.push(start);
    animals[territory.id] = createRoamingAnimal(territory.id, { rng, start });
  }

  return animals;
}
