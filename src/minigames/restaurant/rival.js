import { FOOD_PREP_SECONDS } from './scoring.js';
import {
  RIVAL_MIN_HAND_AGE,
  RESTAURANT_OWNERS,
  createCustomerClaimRegistry,
} from './claims.js';

export { RIVAL_MIN_HAND_AGE, createCustomerClaimRegistry } from './claims.js';

export const RIVAL_SHARE_CAP = 3;
export const RIVAL_SPEED = 3.75;

const CHALLENGE_PREP_SCALE = 1.3;
const POST_FOCUS_HOLD_SECONDS = 0.8;
const TAKE_ORDER_SECONDS = 1.2;
const HESITATION_MIN = 0.3;
const HESITATION_MAX = 0.9;
const ABANDON_MIN = 0.6;
const ABANDON_MAX = 1.2;

function sample(rng) {
  const value = Number(rng());
  if (!Number.isFinite(value)) return 0;
  return Math.min(0.999999999, Math.max(0, value));
}

function randomBetween(rng, minimum, maximum) {
  return minimum + ((maximum - minimum) * sample(rng));
}

function copyPosition(position, fallback = null) {
  const x = Number(position?.x);
  const z = Number(position?.z);
  if (!Number.isFinite(x) || !Number.isFinite(z)) {
    return fallback ? copyPosition(fallback) : null;
  }
  const copy = { x, z };
  const y = Number(position?.y);
  if (Number.isFinite(y)) copy.y = y;
  return copy;
}

function distanceBetween(first, second) {
  const dx = second.x - first.x;
  const dz = second.z - first.z;
  return Math.hypot(dx, dz);
}

function customerId(customer) {
  return customer?.id ?? customer?.index;
}

function findCustomer(viewCustomers, id) {
  return viewCustomers.find((customer) => customerId(customer) === id) ?? null;
}

function isPostFocusHold(focusReleasedAgo) {
  return Number.isFinite(focusReleasedAgo)
    && focusReleasedAgo >= 0
    && focusReleasedAgo < POST_FOCUS_HOLD_SECONDS;
}

/**
 * Pure Challenge rival-waiter decision model. It owns no scene or DOM object.
 *
 * Options:
 * - `level` (default 3): levels 1 and 2 return the same inert model with
 *   `enabled === false`, so Easy and Normal have no rival behavior.
 * - `registry`: optional claim registry. The model advances it exactly once per
 *   positive `advance` call and exposes it as `.registry`.
 * - `initialPosition`, `passPosition`: plain `{ x, z }` positions.
 * - `prepScale` (default 1.3) and `prepSeconds` (default the Restaurant's
 *   food-owned table); a customer-view `prepDuration` overrides both so the
 *   controller can pass the exact duration assigned to that customer's dish.
 * - `rng`: injected random source used only for hesitations.
 *
 * Call `advance(serviceDt, view)` once per service frame. `view` is:
 * `{ customers, focusReleasedAgo }`, where every active customer is
 * `{ id, food, position: {x,z}, prepDuration? }`. Ownership, reservations and
 * raised-hand age come from `.registry`. Before calling `advance`, the
 * controller registers/seats customers, raises hands, reserves/releases or
 * commits player conversations, and resolves served/left customers through
 * that registry. Do not separately call `registry.advance` when it is attached
 * to this model. Invalid, negative, or zero service dt emits nothing and makes
 * no progress (including no RNG sampling, registry time, walking, prep, claim,
 * or hesitation). `focusReleasedAgo < 0.8` holds a rival at arrival rather than
 * allowing a new claim.
 *
 * Data-only event contract:
 * - `targetCustomer`: `{ customer, position, from, delay, duration, speed }`
 * - `abandonTarget`: `{ customer, reason }`, reason is `reserved`, `owned`, or
 *   `missing`; re-choice waits the model's 0.6-1.2 s pause
 * - `claimCustomer`: `{ customer, owner: 'rival' }`
 * - `orderTaken`: `{ customer, food, prepSeconds }`
 * - `walkToPass`: `{ customer, position, from, delay, duration, speed }`
 * - `dishReady`: `{ customer, food, position, pass: 'rival' }`
 * - `pickUpDish`: `{ customer, food, position, pass: 'rival' }`
 * - `deliverToCustomer`: `{ customer, position, from, delay, duration, speed }`
 * - `servedCustomer`: `{ customer, food, owner: 'rival', playerServed,
 *   rivalServed }`
 * - `abandonTask`: `{ customer, reason: 'left' }`; any rival dish is discarded
 *
 * Walk events expose animation endpoints and timing. Rival dishes never have a
 * player counter slot and no event asks the controller to touch a player dish.
 */
export function createRestaurantRival({
  level = 3,
  registry = createCustomerClaimRegistry(),
  initialPosition = { x: 5.5, z: -5.6 },
  passPosition = { x: -4.8, z: -5.05 },
  prepScale = CHALLENGE_PREP_SCALE,
  prepSeconds = FOOD_PREP_SECONDS,
  rng = Math.random,
} = {}) {
  if (typeof rng !== 'function') throw new TypeError('rng must be a function');
  if (!registry || typeof registry.advance !== 'function'
    || typeof registry.claimRival !== 'function') {
    throw new TypeError('registry must be a customer claim registry');
  }

  const enabled = Number(level) === 3;
  const start = copyPosition(initialPosition, { x: 0, z: 0 });
  const rivalPass = copyPosition(passPosition, { x: 0, z: 0 });
  const scale = Number.isFinite(Number(prepScale)) && Number(prepScale) >= 0
    ? Number(prepScale)
    : CHALLENGE_PREP_SCALE;

  let state = 'idle';
  let position = start;
  let remaining = 0;
  let waitDelayStarted = false;
  let claims = 0;
  let task = null;
  let dish = null;

  function hesitation() {
    return randomBetween(rng, HESITATION_MIN, HESITATION_MAX);
  }

  function walkData(target, delay = 0) {
    const from = copyPosition(position);
    const destination = copyPosition(target);
    const duration = distanceBetween(from, destination) / RIVAL_SPEED;
    return { from, position: destination, delay, duration, speed: RIVAL_SPEED };
  }

  function beginChoosing(pause = hesitation()) {
    state = 'choosing';
    remaining = pause;
  }

  function abandonClaimedTask(events) {
    events.push({ type: 'abandonTask', customer: task.customer, reason: 'left' });
    task = null;
    dish = null;
    state = 'idle';
    remaining = 0;
    waitDelayStarted = false;
  }

  function claimedTaskWasLost() {
    if (!task || state === 'walkingToCustomer' || state === 'choosing' || state === 'idle') return false;
    return registry.getCustomer(task.customer)?.owner !== RESTAURANT_OWNERS.RIVAL;
  }

  function advanceDish(dt, events) {
    if (!dish || dish.state !== 'preparing') return;
    dish.remaining = Math.max(0, dish.remaining - dt);
    if (dish.remaining > 0) return;
    dish.state = 'ready';
    events.push({
      type: 'dishReady',
      customer: dish.customer,
      food: dish.food,
      position: copyPosition(rivalPass),
      pass: 'rival',
    });
  }

  function chooseNext(viewCustomers, events) {
    if (dish?.state === 'ready' && task
      && registry.getCustomer(task.customer)?.owner === RESTAURANT_OWNERS.RIVAL) {
      const walk = walkData(rivalPass, hesitation());
      state = 'walkingToPass';
      remaining = walk.delay + walk.duration;
      events.push({ type: 'walkToPass', customer: task.customer, ...walk });
      return;
    }

    if (claims >= RIVAL_SHARE_CAP) {
      state = 'idle';
      remaining = 0;
      return;
    }

    const target = registry.longestWaitingUnclaimed(RIVAL_MIN_HAND_AGE);
    const viewCustomer = target ? findCustomer(viewCustomers, target.id) : null;
    const targetPosition = copyPosition(viewCustomer?.position, target?.position);
    if (!target || !targetPosition) {
      state = 'idle';
      remaining = 0;
      return;
    }

    const walk = walkData(targetPosition);
    task = {
      customer: target.id,
      food: viewCustomer?.food ?? target.food,
      prepDuration: viewCustomer?.prepDuration,
      targetPosition,
    };
    state = 'walkingToCustomer';
    remaining = walk.duration;
    events.push({
      type: 'targetCustomer',
      customer: target.id,
      delay: 0,
      ...walk,
    });
  }

  function targetFailureReason(customer) {
    if (!customer) return 'missing';
    if (customer.reservedBy !== null) return 'reserved';
    return 'owned';
  }

  function advance(serviceDt, view = {}) {
    const dt = Number(serviceDt);
    if (!Number.isFinite(dt) || dt <= 0) return [];

    registry.advance(dt);
    if (!enabled) return [];

    const events = [];
    const viewCustomers = Array.isArray(view.customers) ? view.customers : [];
    for (const customer of viewCustomers) {
      const id = customerId(customer);
      if (id !== null && id !== undefined) {
        registry.updateCustomer(id, { food: customer.food, position: customer.position });
      }
    }

    if (claimedTaskWasLost()) {
      abandonClaimedTask(events);
      return events;
    }
    advanceDish(dt, events);

    if (state === 'idle') {
      if (claims < RIVAL_SHARE_CAP || dish?.state === 'ready') beginChoosing();
      return events;
    }

    if (state === 'choosing') {
      remaining = Math.max(0, remaining - dt);
      if (remaining === 0) chooseNext(viewCustomers, events);
      return events;
    }

    if (state === 'walkingToCustomer') {
      if (!registry.getCustomer(task.customer)) {
        events.push({ type: 'abandonTarget', customer: task.customer, reason: 'missing' });
        task = null;
        beginChoosing(randomBetween(rng, ABANDON_MIN, ABANDON_MAX));
        return events;
      }
      remaining = Math.max(0, remaining - dt);
      if (remaining > 0) return events;
      position = copyPosition(task.targetPosition);
      if (isPostFocusHold(view.focusReleasedAgo)) return events;

      if (!registry.claimRival(task.customer)) {
        const customer = registry.getCustomer(task.customer);
        events.push({
          type: 'abandonTarget',
          customer: task.customer,
          reason: targetFailureReason(customer),
        });
        task = null;
        beginChoosing(randomBetween(rng, ABANDON_MIN, ABANDON_MAX));
        return events;
      }

      claims += 1;
      state = 'takingOrder';
      remaining = TAKE_ORDER_SECONDS;
      events.push({ type: 'claimCustomer', customer: task.customer, owner: RESTAURANT_OWNERS.RIVAL });
      return events;
    }

    if (state === 'takingOrder') {
      remaining = Math.max(0, remaining - dt);
      if (remaining > 0) return events;
      const base = Number(prepSeconds?.[task.food]);
      const supplied = Number(task.prepDuration);
      const duration = Number.isFinite(supplied) && supplied >= 0
        ? supplied
        : (Number.isFinite(base) && base >= 0 ? base * scale : 0);
      dish = {
        customer: task.customer,
        food: task.food,
        state: duration === 0 ? 'ready' : 'preparing',
        remaining: duration,
      };
      events.push({ type: 'orderTaken', customer: task.customer, food: task.food, prepSeconds: duration });
      if (dish.state === 'ready') {
        events.push({
          type: 'dishReady',
          customer: dish.customer,
          food: dish.food,
          position: copyPosition(rivalPass),
          pass: 'rival',
        });
      }
      const walk = walkData(rivalPass, hesitation());
      state = 'walkingToPass';
      remaining = walk.delay + walk.duration;
      events.push({ type: 'walkToPass', customer: task.customer, ...walk });
      return events;
    }

    if (state === 'walkingToPass') {
      remaining = Math.max(0, remaining - dt);
      if (remaining > 0) return events;
      position = copyPosition(rivalPass);
      state = 'waitingAtPass';
      remaining = 0;
      waitDelayStarted = false;
      return events;
    }

    if (state === 'waitingAtPass') {
      if (dish?.state !== 'ready') return events;
      if (!waitDelayStarted) {
        remaining = hesitation();
        waitDelayStarted = true;
      }
      remaining = Math.max(0, remaining - dt);
      if (remaining > 0) return events;
      state = 'carrying';
      remaining = hesitation();
      events.push({
        type: 'pickUpDish',
        customer: dish.customer,
        food: dish.food,
        position: copyPosition(rivalPass),
        pass: 'rival',
      });
      return events;
    }

    if (state === 'carrying') {
      remaining = Math.max(0, remaining - dt);
      if (remaining > 0) return events;
      const current = findCustomer(viewCustomers, task.customer);
      const registered = registry.getCustomer(task.customer);
      const destination = copyPosition(current?.position, registered?.position);
      if (!destination) {
        abandonClaimedTask(events);
        return events;
      }
      const walk = walkData(destination);
      state = 'delivering';
      remaining = walk.duration;
      task.targetPosition = destination;
      events.push({
        type: 'deliverToCustomer',
        customer: task.customer,
        delay: 0,
        ...walk,
      });
      return events;
    }

    if (state === 'delivering') {
      remaining = Math.max(0, remaining - dt);
      if (remaining > 0) return events;
      const customer = registry.getCustomer(task.customer);
      if (!customer || customer.owner !== RESTAURANT_OWNERS.RIVAL) {
        abandonClaimedTask(events);
        return events;
      }
      position = copyPosition(task.targetPosition);
      const servedCustomer = task.customer;
      const servedFood = dish.food;
      registry.resolveCustomer(servedCustomer, { outcome: 'served' });
      const counts = registry.counts;
      events.push({
        type: 'servedCustomer',
        customer: servedCustomer,
        food: servedFood,
        owner: RESTAURANT_OWNERS.RIVAL,
        playerServed: counts.playerServed,
        rivalServed: counts.rivalServed,
      });
      task = null;
      dish = null;
      state = 'idle';
      remaining = 0;
      waitDelayStarted = false;
    }
    return events;
  }

  return {
    advance,
    registry,
    get enabled() {
      return enabled;
    },
    get state() {
      return state;
    },
    get position() {
      return copyPosition(position);
    },
    get targetCustomer() {
      return task?.customer ?? null;
    },
    get claims() {
      return claims;
    },
    get dish() {
      return dish ? { ...dish, position: copyPosition(rivalPass), pass: 'rival' } : null;
    },
    get counts() {
      return registry.counts;
    },
  };
}
