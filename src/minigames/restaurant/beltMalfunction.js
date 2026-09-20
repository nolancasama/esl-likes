// Round 3 only: the conveyor is old and stalls (DESIGN_DECISIONS 2026-09-20
// "Round 3 chaos"). This module owns nothing but the run/warning/stop cycle;
// the belt itself never learns it can stop. The scene expresses a stop by not
// advancing the conveyor clock at all, so dish positions, entry scheduling and
// spacing survive a stoppage untouched and a restart resumes exactly where it
// stopped. Suppressing movement inside the conveyor scheduler instead would
// leave `nextEntryTime` behind and pile dishes at the entry on restart.
//
// This clock runs on service time even while the belt is frozen: patience,
// customers and both waiters keep going, which is what makes a stoppage a
// chance to take another order rather than a pause.

export const BELT_MALFUNCTION = Object.freeze({
  // The belt moves through `running` and `warning`; only `stopped` freezes it,
  // so the shortest gap between two stoppages is runMin + warningMin.
  runMin: 8.0,
  runMax: 13.0,
  warningMin: 0.6,
  warningMax: 1.0,
  stopMin: 2.0,
  stopMax: 2.8,
  // The first stoppage never lands on the round's opening seconds.
  firstRunMin: 10.0,
});

const PHASES = Object.freeze({ RUNNING: 'running', WARNING: 'warning', STOPPED: 'stopped' });

export const BELT_PHASES = PHASES;

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
 * Pure service-clock belt malfunction cycle: running -> warning -> stopped ->
 * running. Disabled instances never leave `running`, never sample the rng and
 * never emit an event, so Rounds 1 and 2 are unaffected by construction.
 *
 * `advance(dt)` returns `{ type: 'phase', phase }` events in order and carries
 * a large dt across as many phase boundaries as it spans.
 */
export function createBeltMalfunction({ enabled = false, rng = Math.random, ...overrides } = {}) {
  if (typeof rng !== 'function') throw new TypeError('rng must be a function');

  const tuning = {};
  for (const field of Object.keys(BELT_MALFUNCTION)) {
    tuning[field] = positiveOption(overrides[field], BELT_MALFUNCTION[field]);
  }
  // A caller that lowers a maximum below its minimum gets a fixed value, not a
  // reversed range.
  const runMax = Math.max(tuning.runMin, tuning.runMax);
  const warningMax = Math.max(tuning.warningMin, tuning.warningMax);
  const stopMax = Math.max(tuning.stopMin, tuning.stopMax);

  const active = enabled === true;
  let phase = PHASES.RUNNING;
  let remaining = active ? Math.max(tuning.firstRunMin, randomBetween(rng, tuning.runMin, runMax)) : Infinity;
  let elapsed = 0;
  let stopCount = 0;
  let lastRunSeconds = active ? remaining : Infinity;
  let lastStopSeconds = null;

  function enterRunning() {
    phase = PHASES.RUNNING;
    lastRunSeconds = randomBetween(rng, tuning.runMin, runMax);
    return lastRunSeconds;
  }

  function enterWarning() {
    phase = PHASES.WARNING;
    return randomBetween(rng, tuning.warningMin, warningMax);
  }

  function enterStopped() {
    phase = PHASES.STOPPED;
    stopCount += 1;
    lastStopSeconds = randomBetween(rng, tuning.stopMin, stopMax);
    return lastStopSeconds;
  }

  function nextPhase() {
    if (phase === PHASES.RUNNING) return enterWarning();
    if (phase === PHASES.WARNING) return enterStopped();
    return enterRunning();
  }

  function advance(serviceDt) {
    const dt = Number(serviceDt);
    if (!active || !Number.isFinite(dt) || dt <= 0) return [];

    elapsed += dt;
    const events = [];
    let left = dt;
    // Bounded: every phase has a positive minimum, so a finite dt crosses a
    // finite number of boundaries.
    while (left >= remaining) {
      left -= remaining;
      remaining = nextPhase();
      events.push({ type: 'phase', phase });
    }
    remaining -= left;
    return events;
  }

  return {
    advance,
    get enabled() { return active; },
    get phase() { return active ? phase : PHASES.RUNNING; },
    /** The one question the conveyor caller asks: should the belt clock move? */
    get beltMoving() { return !active || phase !== PHASES.STOPPED; },
    get warningActive() { return active && phase === PHASES.WARNING; },
    get stopped() { return active && phase === PHASES.STOPPED; },
    get phaseRemaining() { return active ? remaining : Infinity; },
    get stopCount() { return stopCount; },
    get elapsed() { return elapsed; },
    get lastRunSeconds() { return lastRunSeconds; },
    get lastStopSeconds() { return lastStopSeconds; },
  };
}
