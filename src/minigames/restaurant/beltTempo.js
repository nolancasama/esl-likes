// Round 3 only: the conveyor alternates between its normal speed and a much
// faster one (DESIGN_DECISIONS 2026-09-21 "fast bursts replace stoppages").
// This module owns nothing but the normal/fast cycle; the belt is simply told
// which speed multiplier to use, and never learns why.
//
// The belt NEVER stops. There is no zero-speed state here by construction:
// `speedMultiplier` is either 1 or `fastMultiplier`, both positive.
//
// This clock runs on service time, so it stops with the rest of the simulation
// during speech focus and the challenge scenes rather than racing ahead.

export const BELT_TEMPO = Object.freeze({
  // A doubling is dramatic enough to read instantly at room-camera distance
  // without making a dish impossible to intercept.
  fastMultiplier: 2.0,
  normalMin: 5.0,
  normalMax: 9.0,
  fastMin: 2.0,
  fastMax: 4.0,
  // The round does not open on a burst; the player sees the normal belt first.
  firstNormalMin: 6.0,
});

const MODES = Object.freeze({ NORMAL: 'normal', FAST: 'fast' });

export const BELT_MODES = MODES;

function sample(rng) {
  const value = Number(rng());
  if (!Number.isFinite(value)) return 0;
  return Math.min(0.999999999, Math.max(0, value));
}

function randomBetween(rng, minimum, maximum) {
  if (maximum <= minimum) return minimum;
  return minimum + ((maximum - minimum) * sample(rng));
}

function positiveOption(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

/**
 * Pure service-clock belt tempo cycle: normal -> fast -> normal. Disabled
 * instances stay at normal for ever, never sample the rng and never emit an
 * event, so Rounds 1 and 2 are unaffected by construction.
 *
 * `advance(dt)` returns `{ type: 'mode', mode }` events in order and carries a
 * large dt across as many boundaries as it spans.
 */
export function createBeltTempo({ enabled = false, rng = Math.random, ...overrides } = {}) {
  if (typeof rng !== 'function') throw new TypeError('rng must be a function');

  const tuning = {};
  for (const field of Object.keys(BELT_TEMPO)) {
    tuning[field] = positiveOption(overrides[field], BELT_TEMPO[field]);
  }
  // A caller that lowers a maximum below its minimum gets a fixed value, not a
  // reversed range.
  const normalMax = Math.max(tuning.normalMin, tuning.normalMax);
  const fastMax = Math.max(tuning.fastMin, tuning.fastMax);
  const fastMultiplier = Math.max(1, tuning.fastMultiplier);

  const active = enabled === true;
  let mode = MODES.NORMAL;
  let remaining = active
    ? Math.max(tuning.firstNormalMin, randomBetween(rng, tuning.normalMin, normalMax))
    : Infinity;
  let elapsed = 0;
  let fastCount = 0;
  let lastNormalSeconds = active ? remaining : Infinity;
  let lastFastSeconds = null;

  function enterNormal() {
    mode = MODES.NORMAL;
    lastNormalSeconds = randomBetween(rng, tuning.normalMin, normalMax);
    return lastNormalSeconds;
  }

  function enterFast() {
    mode = MODES.FAST;
    fastCount += 1;
    lastFastSeconds = randomBetween(rng, tuning.fastMin, fastMax);
    return lastFastSeconds;
  }

  function advance(serviceDt) {
    const dt = Number(serviceDt);
    if (!active || !Number.isFinite(dt) || dt <= 0) return [];

    elapsed += dt;
    const events = [];
    let left = dt;
    // Bounded: both modes have a positive minimum duration.
    while (left >= remaining) {
      left -= remaining;
      remaining = mode === MODES.NORMAL ? enterFast() : enterNormal();
      events.push({ type: 'mode', mode });
    }
    remaining -= left;
    return events;
  }

  return {
    advance,
    get enabled() { return active; },
    get mode() { return active ? mode : MODES.NORMAL; },
    get fast() { return active && mode === MODES.FAST; },
    /** The one question the conveyor caller asks. Never zero. */
    get speedMultiplier() { return active && mode === MODES.FAST ? fastMultiplier : 1; },
    get fastMultiplier() { return fastMultiplier; },
    get modeRemaining() { return active ? remaining : Infinity; },
    get fastCount() { return fastCount; },
    get elapsed() { return elapsed; },
    get lastNormalSeconds() { return lastNormalSeconds; },
    get lastFastSeconds() { return lastFastSeconds; },
  };
}
