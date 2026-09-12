export const ANIMALS = Object.freeze([
  'elephant',
  'giraffe',
  'penguin',
  'tiger',
  'dog',
  'cat',
]);

function randomIndex(length, rng) {
  const sample = Number(rng());
  return Math.min(length - 1, Math.max(0, Math.floor(sample * length)));
}

/** Pick from all six animals without removing an option. */
export function pickAnimal(rng = Math.random) {
  return ANIMALS[randomIndex(ANIMALS.length, rng)];
}

function clampUnit(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(1, Math.max(0, number));
}

/**
 * Measure a subject's framing from normalised viewfinder coordinates.
 * x/y are the subject centre and width/height are its visible bounds, all 0..1.
 */
export function measureFraming({ x, y, width, height } = {}) {
  const centreX = clampUnit(x);
  const centreY = clampUnit(y);
  const subjectWidth = clampUnit(width);
  const subjectHeight = clampUnit(height);

  if (subjectWidth === 0 || subjectHeight === 0) return 0;

  const distanceFromCentre = Math.hypot(centreX - 0.5, centreY - 0.5)
    / Math.SQRT1_2;
  const centreScore = Math.max(0, 1 - distanceFromCentre ** 1.5);

  // Geometric mean treats tall and wide silhouettes alike. A subject spanning
  // roughly one third of the frame is already large enough for full size credit.
  const apparentSize = Math.sqrt(subjectWidth * subjectHeight);
  const sizeScore = Math.min(1, apparentSize / 0.32);

  return clampUnit(centreScore * sizeScore);
}

const OUTCOME_POINTS = Object.freeze({
  first: 5,
  later: 2,
});

const MAX_POINTS_PER_REQUEST = 8;

/**
 * Score a completed session from request-resolution records.
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
      throw new TypeError(`Unknown request outcome: ${String(record?.outcome)}`);
    }

    earned += OUTCOME_POINTS[record.outcome];
    earned += 2 * clampUnit(record.framing);
    if (!record.replayed) earned += 1;
    if (record.outcome === 'first') firstTryCount += 1;
  }

  const count = records.length;
  const maximum = MAX_POINTS_PER_REQUEST * count;
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
