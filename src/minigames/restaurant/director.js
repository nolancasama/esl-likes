import { pickFood } from './scoring.js';

const PHASES = Object.freeze({
  WARMUP: 'warmup',
  RUSH: 'rush',
  FINAL_PUSH: 'finalPush',
});

const LEVELS = Object.freeze({
  1: { liveOrderLimit: 1 },
  2: { liveOrderLimit: 3 },
  3: { liveOrderLimit: 4 },
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
const HAND_SPACING_SECONDS = 0.32;

const SETTLING_STATES = new Set(['seated', 'settling']);
const RAISED_HAND_STATES = new Set(['orderCue', 'raisedHand']);
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
    let demand = 0;
    for (const customer of customers) {
      if (!customer || RESOLVED_STATES.has(customer.state)) continue;
      if (customer.owner === 'player') {
        demand += 1;
      } else if ((customer.owner === null || customer.owner === undefined)
        && RAISED_HAND_STATES.has(customer.state)) {
        // A player reservation does not change ownership, so it remains an
        // unclaimed raised hand for budget purposes.
        demand += 1;
      }
    }
    return demand;
  }

  const reported = Array.isArray(view?.liveOrders)
    ? view.liveOrders.length
    : Number(view?.liveOrders);
  const takenOrders = Number.isFinite(reported) ? Math.max(0, Math.floor(reported)) : 0;
  let raisedHands = 0;
  for (const customer of customers) {
    if (RAISED_HAND_STATES.has(customer?.state)) raisedHands += 1;
  }
  return takenOrders + raisedHands;
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
 *   customers: [{ id: number, state: string, prepRemaining?: number }]
 *     prepRemaining is copied from that customer's preparing dish; state may
 *     be either `preparing` or the controller's existing `awaiting` state.
 *     Challenge additionally supplies owner: null | 'player' | 'rival' and
 *     reservedBy: null | 'player'. When any owner is supplied, demand is
 *     derived from these records: player-owned unresolved orders plus
 *     unclaimed raised hands. Eating/leaving customers are already resolved
 *     for demand purposes, rival-owned customers never consume the budget,
 *     and a player-reserved hand still does.
 *   liveOrders: number // taken, unresolved orders; excludes raised hands
 *     Legacy Easy/Normal fallback used only when owner fields are absent.
 *   focusReleasedAgo: number // Infinity/null before any focus
 *   rivalAvailable?: boolean // Challenge rival could take a customer now;
 *     outside warm-up it allows one hand above the player's live-order limit
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
  const configuredLimit = LEVELS[safeLevel].liveOrderLimit;

  let serviceTime = 0;
  let currentPhase = PHASES.WARMUP;
  let phaseEventPending = null;
  let handedOut = 0;
  let done = 0;
  let completed = false;
  let lastReadyAt = Number.NEGATIVE_INFINITY;
  let lastHandAt = Number.NEGATIVE_INFINITY;

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

  const handAt = new Map();
  const pendingHands = new Set();
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

      if (SETTLING_STATES.has(customer.state)) {
        if (!handAt.has(id) && !pendingHands.has(id)) {
          const finalPace = handedOut >= customerTotal;
          const minimum = finalPace ? 0.8 : 1;
          const maximum = finalPace ? 1.55 : 2.5;
          handAt.set(id, serviceTime + randomBetween(rng, minimum, maximum));
        }
      } else {
        handAt.delete(id);
      }

      // A reservation exists only until the controller reflects the emitted
      // hand. Attentive players can advance orderCue -> preparing before the
      // next director tick, so any non-settling state acknowledges it.
      if (!SETTLING_STATES.has(customer.state)) pendingHands.delete(id);
      if (!isReadyCandidate(customer)) pendingReady.delete(id);
    }

    for (const id of handAt.keys()) {
      if (!present.has(id)) handAt.delete(id);
    }
    for (const id of pendingHands) {
      if (!present.has(id)) pendingHands.delete(id);
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

  function applyIdleGuard(liveDemand, customers) {
    if (safeLevel === 1 || currentPhase !== PHASES.RUSH || liveDemand >= 2) return;

    for (const plan of tablePlans) {
      if (plan.availableLastFrame && plan.reservedCustomer === null && plan.seatAt !== null) {
        plan.seatAt = Math.min(plan.seatAt, serviceTime + randomBetween(rng, 0.18, 0.42));
      }
    }
    for (const customer of customers) {
      const id = customerId(customer);
      if (SETTLING_STATES.has(customer?.state) && handAt.has(id)) {
        handAt.set(id, Math.min(handAt.get(id), serviceTime + randomBetween(rng, 0.18, 0.42)));
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

  function nextHandEvent(customers, liveDemand, rivalAvailable) {
    // A saturated player must not freeze the whole room: while the Challenge
    // rival can take a customer, one extra hand may rise above the player's limit.
    const demandLimit = currentPhase === PHASES.WARMUP
      ? Math.min(configuredLimit, 2)
      : configuredLimit + (rivalAvailable ? 1 : 0);
    if (liveDemand >= demandLimit || serviceTime - lastHandAt < HAND_SPACING_SECONDS) return null;

    let selected = null;
    let earliest = Number.POSITIVE_INFINITY;
    for (const customer of customers) {
      const id = customerId(customer);
      const due = handAt.get(id);
      if (!SETTLING_STATES.has(customer?.state) || pendingHands.has(id)) continue;
      if (due <= serviceTime && due < earliest) {
        selected = id;
        earliest = due;
      }
    }
    if (selected === null) return null;

    handAt.delete(selected);
    pendingHands.add(selected);
    lastHandAt = serviceTime;
    return { type: 'raiseHand', customer: selected };
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

    const liveDemand = countLiveOrders(view, customers) + pendingHands.size;
    applyIdleGuard(liveDemand, customers);

    if (!holdingEvents) {
      const seat = nextSeatEvent();
      if (seat) events.push(seat);

      const hand = nextHandEvent(customers, liveDemand, view.rivalAvailable === true);
      if (hand) events.push(hand);

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
    get liveOrderLimit() {
      return configuredLimit;
    },
  };
}

export const RESTAURANT_PHASES = PHASES;
