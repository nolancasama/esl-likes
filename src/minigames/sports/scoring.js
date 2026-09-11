export const SPORTS = Object.freeze([
  'soccer',
  'basketball',
  'baseball',
  'volleyball',
]);

function randomIndex(length, rng) {
  const sample = Number(rng());
  return Math.min(length - 1, Math.max(0, Math.floor(sample * length)));
}

/** Pick from all four sports without removing an option. */
export function pickSport(rng = Math.random) {
  return SPORTS[randomIndex(SPORTS.length, rng)];
}

/** Return a newly shuffled zone-to-corner order using the supplied random source. */
export function shuffleZones(rng = Math.random) {
  const zones = [...SPORTS];

  for (let index = zones.length - 1; index > 0; index -= 1) {
    const swapIndex = randomIndex(index + 1, rng);
    [zones[index], zones[swapIndex]] = [zones[swapIndex], zones[index]];
  }

  return zones;
}

const OUTCOME_POINTS = Object.freeze({
  first: 5,
  later: 2,
});

const MAX_POINTS_PER_NPC = 6;

/**
 * Score a completed session from follower-resolution records.
 * This module deliberately has no dependency on DOM or three.js state.
 */
export function scoreSession(records) {
  if (!Array.isArray(records)) {
    throw new TypeError('records must be an array');
  }

  let earned = 0;
  let firstTryCount = 0;

  for (const record of records) {
    if (!record || !Object.hasOwn(OUTCOME_POINTS, record.outcome)) {
      throw new TypeError(`Unknown follower outcome: ${String(record?.outcome)}`);
    }

    earned += OUTCOME_POINTS[record.outcome];
    if (!record.replayed) earned += 1;
    if (record.outcome === 'first') firstTryCount += 1;
  }

  const count = records.length;
  const maximum = MAX_POINTS_PER_NPC * count;
  const ratio = maximum === 0 ? 0 : earned / maximum;
  const firstTryShare = count === 0 ? 0 : firstTryCount / count;

  let stars = ratio >= 0.75 ? 3 : ratio >= 0.4 ? 2 : 1;
  if (firstTryShare < 0.5 && stars === 3) stars = 2;

  return {
    earned,
    maximum,
    ratio,
    stars,
    firstTryCount,
    firstTryShare,
  };
}
