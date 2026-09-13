const PHASES = Object.freeze({
  WARMUP: 'warmup',
  MAIN: 'main',
  RUSH: 'rush',
});

const DEFAULTS = Object.freeze({
  1: Object.freeze({ total: 5, windows: 1 }),
  2: Object.freeze({ total: 6, windows: 2 }),
  3: Object.freeze({ total: 7, windows: 3 }),
});

const POST_FOCUS_HOLD_SECONDS = 0.8;

function finiteInt(value, minimum, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(minimum, Math.floor(number));
}

function sample(rng) {
  const value = Number(rng());
  if (!Number.isFinite(value)) return 0;
  return Math.min(0.999999999, Math.max(0, value));
}

function randomBetween(rng, minimum, maximum) {
  return minimum + (maximum - minimum) * sample(rng);
}

function reportedCount(view, primary, fallback) {
  const value = Number(view?.[primary] ?? view?.[fallback]);
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function resolvedCount(view, total) {
  const reported = Number(view?.progress?.done ?? view?.done);
  if (Number.isFinite(reported)) return Math.min(total, Math.max(0, Math.floor(reported)));

  const remaining = Number(view?.customersRemaining ?? view?.remaining);
  if (Number.isFinite(remaining)) {
    return Math.min(total, Math.max(0, total - Math.floor(remaining)));
  }
  return 0;
}

/**
 * Pure service-time arrival scheduler for the Drink Stand.
 *
 * Controller view:
 *   windowsInUse: number
 *   queuedCount: number
 *   customersRemaining: number // unresolved customers, including un-arrived
 *   focusReleasedAgo: number // service seconds since focus ended; Infinity before focus
 *   progress?: { done: number } // may be used instead of customersRemaining
 *
 * Returned events are data only. The controller owns the customer objects,
 * queue movement, window assignment, and immediate promotion from the line.
 */
export function createDrinkDirector({
  level = 1,
  total,
  windows,
  rng = Math.random,
} = {}) {
  if (typeof rng !== 'function') throw new TypeError('rng must be a function');

  const safeLevel = Math.min(3, finiteInt(level, 1, 1));
  const defaults = DEFAULTS[safeLevel];
  const customerTotal = finiteInt(total, 0, defaults.total);
  const requestedWindows = finiteInt(Array.isArray(windows) ? windows.length : windows, 1, defaults.windows);
  // Easy is deliberately a single-window stream even if a caller supplies a
  // larger count. Higher levels are bounded by the three-window stand.
  const windowCount = safeLevel === 1 ? 1 : Math.min(3, requestedWindows);
  const rushCount = Math.min(customerTotal, Math.max(2, Math.ceil(customerTotal * 0.4)));
  const rushThreshold = Math.max(0, customerTotal - rushCount);
  const warmupEndsAt = safeLevel === 1
    ? randomBetween(rng, 7, 9)
    : randomBetween(rng, 8, 12);

  let serviceTime = 0;
  let currentPhase = PHASES.WARMUP;
  let pendingPhaseEvent = null;
  let handedOut = 0;
  let done = 0;
  let completed = false;
  let nextArrivalAt = randomBetween(rng, 0.18, 0.42);
  let easyOccupiedLastAdvance = false;

  function enterPhase(nextPhase) {
    if (currentPhase === nextPhase) return;
    currentPhase = nextPhase;
    pendingPhaseEvent = nextPhase;
  }

  function updateTimePhase() {
    if (currentPhase === PHASES.WARMUP && serviceTime >= warmupEndsAt) {
      enterPhase(PHASES.MAIN);
      nextArrivalAt = Math.min(nextArrivalAt, serviceTime);
    }
  }

  function scheduleNextArrival() {
    let minimum;
    let maximum;
    if (currentPhase === PHASES.WARMUP) {
      // Only two customers enter during warm-up. The first is almost
      // immediate; the second leaves a gentler beat before the busy section.
      minimum = 3.2;
      maximum = 4.6;
    } else if (currentPhase === PHASES.RUSH) {
      if (safeLevel === 1) {
        minimum = 1.7;
        maximum = 2.4;
      } else {
        minimum = 0.6;
        maximum = 1;
      }
    } else if (safeLevel === 1) {
      minimum = 2.3;
      maximum = 3.4;
    } else {
      minimum = 1.45;
      maximum = 2.15;
    }
    nextArrivalAt = serviceTime + randomBetween(rng, minimum, maximum);
  }

  function applyPressureGuard(windowsInUse, queuedCount) {
    if (safeLevel === 1 || currentPhase === PHASES.WARMUP || handedOut >= customerTotal) return;

    const visibleLoad = windowsInUse + queuedCount;
    if (visibleLoad === 0) {
      // Normal and Challenge should never turn into an empty mid-shift room.
      nextArrivalAt = Math.min(nextArrivalAt, serviceTime + randomBetween(rng, 0.08, 0.2));
    } else if (windowsInUse >= windowCount && queuedCount === 0) {
      // Top up a busy set of windows. This remains gentler than the final
      // rush's regular cadence, but keeps a line present most of the time.
      // Rush already schedules every arrival at 0.6-1.0 s; only main needs
      // its ordinary gap shortened to establish the waiting line.
      if (currentPhase === PHASES.MAIN) {
        nextArrivalAt = Math.min(nextArrivalAt, serviceTime + randomBetween(rng, 0.65, 0.95));
      }
    }
  }

  function canArrive(windowsInUse, queuedCount) {
    if (handedOut >= customerTotal || serviceTime < nextArrivalAt) return false;
    if (currentPhase === PHASES.WARMUP && handedOut >= Math.min(2, customerTotal)) return false;
    // Easy never builds a line. Its next customer enters only after the sole
    // active/queued customer has cleared.
    if (safeLevel === 1 && windowsInUse + queuedCount > 0) return false;
    return true;
  }

  function advance(serviceDt, view = {}) {
    const dt = Number(serviceDt);
    if (!Number.isFinite(dt) || dt <= 0) return [];

    serviceTime += dt;
    done = resolvedCount(view, customerTotal);
    updateTimePhase();

    const events = [];
    if (pendingPhaseEvent !== null) {
      events.push({ type: 'phase', phase: pendingPhaseEvent });
      pendingPhaseEvent = null;
    }

    const focusReleasedAgo = Number(view?.focusReleasedAgo);
    const holdingArrival = Number.isFinite(focusReleasedAgo)
      && focusReleasedAgo >= 0
      && focusReleasedAgo < POST_FOCUS_HOLD_SECONDS;
    const windowsInUse = Math.min(windowCount, reportedCount(view, 'windowsInUse', 'activeWindows'));
    const queuedCount = reportedCount(view, 'queuedCount', 'queued');

    if (safeLevel === 1) {
      const occupied = windowsInUse + queuedCount > 0;
      if (easyOccupiedLastAdvance && !occupied) {
        // Give Easy a visible reset beat after each customer instead of
        // releasing an arrival whose timer expired while the window was busy.
        nextArrivalAt = Math.max(nextArrivalAt, serviceTime + randomBetween(rng, 1.3, 2));
      }
      easyOccupiedLastAdvance = occupied;
    }

    applyPressureGuard(windowsInUse, queuedCount);
    if (!holdingArrival && canArrive(windowsInUse, queuedCount)) {
      const customer = handedOut;
      handedOut += 1;
      events.push({ type: 'arrive', customer, phase: currentPhase });

      if (currentPhase === PHASES.MAIN && handedOut >= rushThreshold && handedOut < customerTotal) {
        enterPhase(PHASES.RUSH);
      }
      scheduleNextArrival();
    }

    if (!completed && handedOut >= customerTotal && done >= customerTotal) {
      completed = true;
      events.push({ type: 'complete' });
    }
    return events;
  }

  return {
    advance,
    get phase() {
      return currentPhase;
    },
    get progress() {
      return { done, total: customerTotal };
    },
    get handedOut() {
      return handedOut;
    },
    get windows() {
      return windowCount;
    },
  };
}

export const DRINK_PHASES = PHASES;
