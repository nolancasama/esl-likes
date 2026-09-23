/**
 * Roaming territories for the eight animal-park animals.
 *
 * The park is one continuous space — no pens, no fences, no signs — so an
 * animal is found by searching the area it belongs to rather than by walking to
 * a labelled exhibit. Each animal therefore gets a bounded patch of the map and
 * a handful of authored waypoints inside it.
 *
 * Waypoints are authored rather than sampled from a navmesh. There are eight
 * animals on a fixed map, so hand-placed points that are known to be clear of
 * the fountain, barn, pool and big trees are cheaper, more predictable and
 * easier to tune for the search difficulty each area should have. A test walks
 * every waypoint through `canOccupy`, so a point that drifts into scenery fails
 * the suite rather than trapping an animal at runtime.
 *
 * Pure data and pure maths: no three.js, so the game and the playthrough
 * harness can both reason about where an animal may be.
 */

import { canOccupy } from './layout.js';

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/**
 * `speed` is world units per second. The player walks at 13.5, so every animal
 * is far slower — they are meant to be caught up with and photographed, not
 * chased. `clipSpeed` is the speed at which that animal's walk cycle looks
 * natural at timeScale 1; the animator divides the two so feet do not skate.
 */
const specs = [
  // Open grassland — long sightlines suit the three larger roaming animals.
  ['horse', 'grassland', 1.8, 2.0, [
    [-36, 8], [-31, 17], [-25, 13], [-34, 18], [-27, 6], [-38, 13],
  ]],
  ['sheep', 'grassland', 1.2, 1.4, [
    [-12, 18], [-20, 17], [-22, 10], [-14, 10], [-17, 20], [-11, 13],
  ]],
  ['dog', 'grassland', 2.0, 1.8, [
    [-32, 0], [-22, 4], [-27, -2], [-20, -1], [-33, 5], [-24, 7],
  ]],

  // Woodland — trees and bushes break up the sightlines, so this is the
  // hardest area to search. Territories are still small enough to sweep.
  ['wolf', 'woodland', 1.8, 1.7, [
    [-36, -10], [-30, -19], [-24, -14], [-34, -19], [-26, -8], [-38, -16],
  ]],
  ['raccoon', 'woodland', 1.6, 1.5, [
    [-19, -25], [-10, -18], [-16, -16], [-8, -25], [-20, -19], [-12, -27],
  ]],
  ['cat', 'woodland', 1.6, 1.1, [
    [-9, -15], [-2, -22], [-6, -25], [0, -17], [-10, -21], [3, -23],
  ]],

  // Farm meadow — open, but the chicken is small, so it still takes looking.
  // It is the slowest land walker in the park so that the pauses between its
  // walks are long enough to actually aim at.
  ['chicken', 'farm', 0.95, 0.7, [
    [17, 10], [26, 12], [22, 19], [28, 17], [18, 17], [25, 8],
  ]],

  // The cove. These waypoints keep the pig on the bank rather than asking a
  // land animal to cross the pool between destinations.
  ['pig', 'cove', 1.0, 1.0, [
    [29, -7], [30, -13], [28, -18], [33, -20], [37, -20], [38, -8], [34, -6],
  ]],
];

/** How wide a body each animal is assumed to have when testing a waypoint. */
export const ANIMAL_RADIUS = Object.freeze({
  cat: 0.45, chicken: 0.4, dog: 0.6, horse: 0.85,
  pig: 0.6, raccoon: 0.5, sheep: 0.6, wolf: 0.7,
});

export const TERRITORIES = deepFreeze(specs.map(([id, area, speed, clipSpeed, points]) => {
  const waypoints = points.map(([x, z]) => ({ x, z }));
  const xs = waypoints.map((p) => p.x);
  const zs = waypoints.map((p) => p.z);
  const centre = {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    z: (Math.min(...zs) + Math.max(...zs)) / 2,
  };
  return {
    id,
    area,
    speed,
    clipSpeed,
    waypoints,
    centre,
    // The bounding box a roaming animal must stay inside, with a little slack
    // for the turn it makes on arrival.
    bounds: {
      minX: Math.min(...xs) - 1.5,
      maxX: Math.max(...xs) + 1.5,
      minZ: Math.min(...zs) - 1.5,
      maxZ: Math.max(...zs) + 1.5,
    },
  };
}));

export const TERRITORY_BY_ID = deepFreeze(Object.fromEntries(
  TERRITORIES.map((territory) => [territory.id, territory]),
));

export const ANIMAL_IDS = Object.freeze(TERRITORIES.map((territory) => territory.id));

/** A photo target must explicitly name a species in the current Zoo roster. */
export function zooPhotoSpecies(subject) {
  return ANIMAL_IDS.includes(subject?.zooSpecies) ? subject.zooSpecies : null;
}

/** The broad areas, for orientation and for the harness's area sweep. */
export const AREAS = deepFreeze([
  { id: 'grassland', name: 'くさはら', centre: { x: -25, z: 10 } },
  { id: 'woodland', name: 'もり', centre: { x: -20, z: -18 } },
  { id: 'farm', name: 'ぼくじょう', centre: { x: 23, z: 14 } },
  { id: 'cove', name: 'みずべ', centre: { x: 32, z: -12 } },
]);

/** Whether a point lies inside an animal's territory box. */
export function withinTerritory(animalId, x, z, slack = 0) {
  const territory = TERRITORY_BY_ID[animalId];
  if (!territory || !Number.isFinite(x) || !Number.isFinite(z)) return false;
  const { bounds } = territory;
  return x >= bounds.minX - slack && x <= bounds.maxX + slack
    && z >= bounds.minZ - slack && z <= bounds.maxZ + slack;
}

/** Whether an animal of this species may stand at this point. */
export function canStand(animalId, x, z) {
  return canOccupy(x, z, ANIMAL_RADIUS[animalId] ?? 0.6);
}

/**
 * Whether an animal could walk from one point to another without clipping
 * scenery, sampled along the line. Waypoints are authored close enough together
 * that a straight line between two of them is the whole path — this is the
 * lightweight check that replaces pathfinding.
 */
export function canWalkBetween(animalId, from, to, samples = 8) {
  for (let i = 1; i <= samples; i += 1) {
    const t = i / samples;
    if (!canStand(animalId, from.x + (to.x - from.x) * t, from.z + (to.z - from.z) * t)) {
      return false;
    }
  }
  return true;
}
