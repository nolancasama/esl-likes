import { pickFood } from './scoring.js';

const PHASES = Object.freeze({
  WARMUP: 'warmup',
  RUSH: 'rush',
  FINAL_PUSH: 'finalPush',
});

const DEFAULT_TOTALS = Object.freeze({
  // Easy and Normal retain the director's previous fallback. Their controller
  // supplies 5 and 7 explicitly; Challenge's new default is part of the rival
  // contract and is used when part 2 switches the controller over.
  1: 5,
  2: 5,
  3: 11,
});

const WARMUP_SECONDS = 18;
const POST_FOCUS_HOLD_SECONDS = 0.8;
const READY_SPACING_SECONDS = 0.9;

const RESOLVED_STATES = new Set(['delivered', 'eating', 'leaving', 'left', 'resolved']);

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

function customerId(customer) {
  return customer?.id ?? customer?.index;
}

function isReadyCandidate(customer) {
  if (!customer || !['preparing', 'awaiting'].includes(customer.state)) return false;
  const remaining = Number(customer.prepRemaining);
  return Number.isFinite(remaining) && remaining <= 0;
}

function tableIsOccupied(table) {
  if (!table) return false;
  if (typeof table.occupied === 'boolean') return table.occupied;
  return table.customer !== null && table.customer !== undefined;
}

function tableIsAvailable(table) {
  if (!table) return true;
  if (tableIsOccupied(table)) return false;
  if (typeof table.available === 'boolean') return table.available;
  return true;
}

function countLiveOrders(view, customers) {
  const ownerAware = customers.some((customer) => customer
    && Object.prototype.hasOwnProperty.call(customer, 'owner'));
  if (ownerAware) {
    return customers.filter((customer) => customer
      && customer.owner === 'player'
      && !RESOLVED_STATES.has(customer.state)).length;
  }

  const reported = Array.isArray(view?.liveOrders)
    ? view.liveOrders.length
    : Number(view?.liveOrders);
  const takenOrders = Number.isFinite(reported) ? Math.max(0, Math.floor(reported)) : 0;
  return takenOrders;
}

function resolvedCount(view, customers) {
  const reported = Number(view?.progress?.done ?? view?.done);
  if (Number.isFinite(reported)) return Math.max(0, Math.floor(reported));
  let done = 0;
  for (const customer of customers) {
    if (RESOLVED_STATES.has(customer?.state)) done += 1;
  }
  return done;
}

/**
 * Pure service-time scheduler for the Restaurant shift.
 *
 * Controller view:
 *   tables: [{ occupied: boolean, available?: boolean, customer?: number }]
 *   customers: [{ id: number, state: string, prepRemaining?: number,
 *                 owner?: null | 'player' | 'rival' }]
 *     prepRemaining is copied from that customer's preparing dish; state may
 *     be either `preparing` or the controller's existing `awaiting` state.
 *     When any owner field is supplied, rush-idle demand is the number of
 *     unresolved player-owned customers. Otherwise `liveOrders` is used.
 *   liveOrders: number | unknown[] // unresolved player orders fallback
 *   focusReleasedAgo: number // Infinity/null before any focus
 *   progress?: { done: number }
 *
 * Returned events are intentionally data-only. The controller owns every scene
 * object and lifecycle transition.
 */
export function createRestaurantDirector({
  level = 1,
  tables = 3,
  total,
  rng = Math.random,
} = {}) {
  if (typeof rng !== 'function') throw new TypeError('rng must be a function');

  const safeLevel = Math.min(3, finiteInt(level, 1, 1));
  const tableCount = finiteInt(Array.isArray(tables) ? tables.length : tables, 1, 3);
  const customerTotal = finiteInt(total, 0, DEFAULT_TOTALS[safeLevel]);
  let serviceTime = 0;
  let currentPhase = PHASES.WARMUP;
  let phaseEventPending = null;
  let handedOut = 0;
  let done = 0;
  let completed = false;
  let lastReadyAt = Number.NEGATIVE_INFINITY;

  const tablePlans = [];
  let initialSeatAt = randomBetween(rng, 0.2, 0.55);
  for (let table = 0; table < tableCount; table += 1) {
    tablePlans.push({
      occupiedLastFrame: false,
      availableLastFrame: true,
      reservedCustomer: null,
      seatAt: initialSeatAt,
      hasBeenOccupied: false,
    });
    initialSeatAt += randomBetween(rng, 0.62, 1.05);
  }

  const pendingReady = new Set();

  function scheduleReplacement(plan) {
    const finalPace = handedOut >= customerTotal - 1;
    let minimum;
    let maximum;
    if (finalPace) {
      minimum = 0.35;
      maximum = 0.8;
    } else if (currentPhase === PHASES.WARMUP) {
      minimum = 1.25;
      maximum = 2.2;
    } else {
      minimum = 0.65;
      maximum = 1.35;
    }
    plan.seatAt = serviceTime + randomBetween(rng, minimum, maximum);
  }

  function reconcileTables(viewTables) {
    for (let index = 0; index < tablePlans.length; index += 1) {
      const plan = tablePlans[index];
      const occupied = tableIsOccupied(viewTables[index]);
      const available = tableIsAvailable(viewTables[index]);

      if (occupied) {
        plan.hasBeenOccupied = true;
        plan.reservedCustomer = null;
      } else if (available && !plan.availableLastFrame && plan.hasBeenOccupied) {
        plan.reservedCustomer = null;
        if (handedOut < customerTotal) scheduleReplacement(plan);
      }

      plan.occupiedLastFrame = occupied;
      plan.availableLastFrame = available;
    }
  }

  function reconcileCustomers(customers) {
    const present = new Set();
    for (const customer of customers) {
      const id = customerId(customer);
      if (id === null || id === undefined) continue;
      present.add(id);

      if (!isReadyCandidate(customer)) pendingReady.delete(id);
    }

    for (const id of pendingReady) {
      if (!present.has(id)) pendingReady.delete(id);
    }
  }

  function updatePhase() {
    if (currentPhase === PHASES.WARMUP && serviceTime >= WARMUP_SECONDS) {
      currentPhase = PHASES.RUSH;
      phaseEventPending = PHASES.RUSH;
      return;
    }
    if (currentPhase === PHASES.RUSH && handedOut >= customerTotal) {
      currentPhase = PHASES.FINAL_PUSH;
      phaseEventPending = PHASES.FINAL_PUSH;
    }
  }

  function applyIdleGuard(liveDemand) {
    if (safeLevel === 1 || currentPhase !== PHASES.RUSH || liveDemand >= 2) return;

    for (const plan of tablePlans) {
      if (plan.availableLastFrame && plan.reservedCustomer === null && plan.seatAt !== null) {
        plan.seatAt = Math.min(plan.seatAt, serviceTime + randomBetween(rng, 0.18, 0.42));
      }
    }
  }

  function nextSeatEvent() {
    if (handedOut >= customerTotal) return null;
    let selected = -1;
    let earliest = Number.POSITIVE_INFINITY;
    for (let table = 0; table < tablePlans.length; table += 1) {
      const plan = tablePlans[table];
      if (!plan.availableLastFrame || plan.reservedCustomer !== null || plan.seatAt === null) continue;
      if (plan.seatAt <= serviceTime && plan.seatAt < earliest) {
        selected = table;
        earliest = plan.seatAt;
      }
    }
    if (selected < 0) return null;

    const plan = tablePlans[selected];
    const customer = handedOut;
    handedOut += 1;
    plan.reservedCustomer = customer;
    plan.seatAt = null;
    return { type: 'seat', table: selected, customer, food: pickFood(rng) };
  }

  function nextReadyEvent(customers) {
    if (serviceTime - lastReadyAt < READY_SPACING_SECONDS) return null;
    for (const customer of customers) {
      const id = customerId(customer);
      if (pendingReady.has(id)) continue;
      if (isReadyCandidate(customer)) {
        pendingReady.add(id);
        lastReadyAt = serviceTime;
        return { type: 'ready', customer: id };
      }
    }
    return null;
  }

  function advance(serviceDt, view = {}) {
    const dt = Number(serviceDt);
    if (!Number.isFinite(dt) || dt <= 0) return [];

    serviceTime += dt;
    const viewTables = Array.isArray(view.tables) ? view.tables : [];
    const customers = Array.isArray(view.customers) ? view.customers : [];
    reconcileTables(viewTables);
    reconcileCustomers(customers);
    done = Math.min(customerTotal, resolvedCount(view, customers));

    updatePhase();
    const events = [];
    if (phaseEventPending !== null) {
      events.push({ type: 'phase', phase: phaseEventPending });
      phaseEventPending = null;
    }

    const focusReleasedAgo = view.focusReleasedAgo;
    const holdingEvents = typeof focusReleasedAgo === 'number'
      && Number.isFinite(focusReleasedAgo)
      && focusReleasedAgo >= 0
      && focusReleasedAgo < POST_FOCUS_HOLD_SECONDS;

    const liveDemand = countLiveOrders(view, customers);
    applyIdleGuard(liveDemand);

    if (!holdingEvents) {
      const seat = nextSeatEvent();
      if (seat) events.push(seat);

      const ready = nextReadyEvent(customers);
      if (ready) events.push(ready);
    }

    // A phase may advance on the same service frame that hands out the last
    // customer. Emitting it on the next advance keeps phase cues ordered.
    updatePhase();

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
  };
}

export const RESTAURANT_PHASES = PHASES;
