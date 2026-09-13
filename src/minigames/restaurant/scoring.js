export const FOODS = Object.freeze([
  'curry',
  'pizza',
  'hamburger',
  'noodles',
  'sushi',
]);

// Preparation belongs to the food, not the customer or counter position. The
// Challenge rival imports this same table so its kitchen cannot drift from the
// player's timings.
export const FOOD_PREP_SECONDS = Object.freeze({
  curry: 11,
  pizza: 9,
  hamburger: 7.5,
  noodles: 6,
  sushi: 4.5,
});

function randomIndex(length, rng) {
  const sample = Number(rng());
  return Math.min(length - 1, Math.max(0, Math.floor(sample * length)));
}

/** Pick from all five foods without removing an option. */
export function pickFood(rng = Math.random) {
  return FOODS[randomIndex(FOODS.length, rng)];
}

function clamp(value, minimum, maximum, fallback = minimum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, number));
}

/**
 * Advance a customer's refusal lock using service time. Passing a zero service
 * delta (as speech focus does) leaves the lock unchanged.
 */
export function advanceRefusalLock(remainingSeconds, serviceDelta) {
  const remaining = clamp(remainingSeconds, 0, Number.MAX_VALUE, 0);
  const delta = clamp(serviceDelta, 0, Number.MAX_VALUE, 0);
  return Math.max(0, remaining - delta);
}

const DELIVERY_POINTS = Object.freeze({
  first: 5,
  later: 2,
});

const MAX_POINTS_PER_CUSTOMER = 10;
export const FIRST_TRY_SHARE_CAP = 0.5;

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

  for (const record of records) {
    if (!record || typeof record.delivered !== 'boolean') {
      throw new TypeError('Each customer record must have a delivered boolean');
    }
    if (!record.delivered) continue;

    const firstTry = record.firstTry === true;
    const temperatureScore = clamp(record.temperatureScore, 1, 3, 1);
    const patienceAtDelivery = clamp(record.patienceAtDelivery, 0, 1, 0);

    earned += DELIVERY_POINTS[firstTry ? 'first' : 'later'];
    earned += temperatureScore;
    earned += patienceAtDelivery;
    if (!record.listenedAgain) earned += 1;
    if (firstTry) firstTryCount += 1;
  }

  const customerCount = records.length;
  const maximum = MAX_POINTS_PER_CUSTOMER * customerCount;
  const ratio = maximum === 0 ? 0 : earned / maximum;
  const firstTryShare = customerCount === 0 ? 0 : firstTryCount / customerCount;

  let stars = ratio >= 0.75 ? 3 : ratio >= 0.4 ? 2 : 1;
  if (firstTryShare < FIRST_TRY_SHARE_CAP && stars === 3) stars = 2;

  return {
    earned,
    maximum,
    ratio,
    stars,
    firstTryCount,
    firstTryShare,
  };
}
