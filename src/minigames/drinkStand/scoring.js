export const DRINKS = Object.freeze([
  'water',
  'milk',
  'orange juice',
  'apple juice',
  'tea',
  'soda',
]);

function randomIndex(length, rng) {
  const sample = Number(rng());
  return Math.min(length - 1, Math.max(0, Math.floor(sample * length)));
}

/** Pick one of all six drinks without removing any option. */
export function pickDrink(rng = Math.random) {
  return DRINKS[randomIndex(DRINKS.length, rng)];
}

/** Return a newly shuffled station order using the supplied random source. */
export function shuffleStations(rng = Math.random) {
  const stations = [...DRINKS];

  for (let index = stations.length - 1; index > 0; index -= 1) {
    const swapIndex = randomIndex(index + 1, rng);
    [stations[index], stations[swapIndex]] = [stations[swapIndex], stations[index]];
  }

  return stations;
}

const OUTCOME_POINTS = Object.freeze({
  first: 5,
  later: 2,
  left: 0,
});

const MAX_POINTS_PER_CUSTOMER = 8;
const STREAK_BONUS = 0.5;

/**
 * Score a completed session from customer-resolution records.
 * This module deliberately has no dependency on DOM or three.js state.
 */
export function scoreSession(records) {
  if (!Array.isArray(records)) {
    throw new TypeError('records must be an array');
  }

  let earned = 0;
  let firstTryCount = 0;
  let consecutiveFirst = 0;
  let streakBonus = 0;

  for (const record of records) {
    if (!record || !Object.hasOwn(OUTCOME_POINTS, record.outcome)) {
      throw new TypeError(`Unknown customer outcome: ${String(record?.outcome)}`);
    }

    const served = record.outcome !== 'left';
    const patienceLeft = Math.min(1, Math.max(0, Number(record.patienceLeft) || 0));

    earned += OUTCOME_POINTS[record.outcome];
    if (served) {
      earned += 2 * patienceLeft;
      if (!record.replayed) earned += 1;
    }

    if (record.outcome === 'first') {
      firstTryCount += 1;
      consecutiveFirst += 1;
      if (consecutiveFirst >= 2) {
        earned += STREAK_BONUS;
        streakBonus += STREAK_BONUS;
      }
    } else {
      consecutiveFirst = 0;
    }
  }

  const customerCount = records.length;
  const maximum = customerCount === 0
    ? 0
    : MAX_POINTS_PER_CUSTOMER * customerCount + STREAK_BONUS * (customerCount - 1);
  const ratio = maximum === 0 ? 0 : earned / maximum;
  const firstTryShare = customerCount === 0 ? 0 : firstTryCount / customerCount;

  let stars = ratio >= 0.75 ? 3 : ratio >= 0.4 ? 2 : 1;
  if (firstTryShare < 0.5 && stars === 3) stars = 2;

  return {
    earned,
    maximum,
    ratio,
    stars,
    firstTryCount,
    firstTryShare,
    streakBonus,
  };
}
