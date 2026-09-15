import {
  RIVAL_MIN_SEATED_AGE,
  RESTAURANT_OWNERS,
  createCustomerClaimRegistry,
} from './claims.js';

export { RIVAL_MIN_SEATED_AGE, createCustomerClaimRegistry } from './claims.js';

export const RIVAL_LEVELS = Object.freeze({
  2: Object.freeze({
    enabled: false,
    speed: 3.4,
    minSeatedAge: 8,
    share: 0.3,
    hesitationMin: 0.8,
    hesitationMax: 1.6,
  }),
  3: Object.freeze({
    enabled: true,
    speed: 4.25,
    minSeatedAge: 4,
    share: 0.5,
    hesitationMin: 0.3,
    hesitationMax: 0.9,
  }),
});
export const RIVAL_SPEED = RIVAL_LEVELS[3].speed;

const POST_FOCUS_HOLD_SECONDS = 0.8;
const TAKE_ORDER_SECONDS = 1.2;
const ABANDON_MIN = 0.6;
const ABANDON_MAX = 1.2;
const DEFAULT_BELT_FRONT_Z = -4.4;
const DEFAULT_PICKUP_WINDOW = 1.4;
const DEFAULT_DISH_NOTICE_SECONDS = 0.6;

function sample(rng) {
  const value = Number(rng());
  if (!Number.isFinite(value)) return 0;
  return Math.min(0.999999999, Math.max(0, value));
}

function randomBetween(rng, minimum, maximum) {
  return minimum + ((maximum - minimum) * sample(rng));
}

function nonNegativeOption(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
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
  return Math.hypot(second.x - first.x, second.z - first.z);
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

function isConveyor(value) {
  return value && typeof value.take === 'function'
    && typeof value.snapshot === 'function'
    && typeof value.predictX === 'function';
}

function beltSnapshot(conveyor) {
  if (!isConveyor(conveyor)) return null;
  const snapshot = conveyor.snapshot();
  const visibleHalfWidth = Number(snapshot?.visibleHalfWidth);
  if (!snapshot || !Array.isArray(snapshot.dishes)
    || !Number.isFinite(visibleHalfWidth) || visibleHalfWidth < 0) return null;
  return { ...snapshot, visibleHalfWidth };
}

function secondsUntilInvisible(dishX, snapshot) {
  const velocity = Number(snapshot.speed) * Number(snapshot.direction);
  if (!Number.isFinite(velocity) || velocity === 0) return Infinity;
  const edge = velocity < 0 ? -snapshot.visibleHalfWidth : snapshot.visibleHalfWidth;
  return Math.max(0, (edge - dishX) / velocity);
}

// Finds the first interception after `delay`; predictX remains authoritative.
function solveInterception(conveyor, dish, snapshot, from, beltFrontZ, delay, speed) {
  const exitAfter = secondsUntilInvisible(Number(dish.x), snapshot);
  if (exitAfter < delay) return null;
  const maxWalk = Number.isFinite(exitAfter) ? Math.max(0, exitAfter - delay) : 120;

  function candidate(walkSeconds) {
    const x = Number(conveyor.predictX(dish.id, delay + walkSeconds));
    if (!Number.isFinite(x)) return null;
    const position = { x, z: beltFrontZ };
    return {
      position,
      difference: (distanceBetween(from, position) / speed) - walkSeconds,
    };
  }

  const immediate = candidate(0);
  if (!immediate) return null;
  if (immediate.difference <= Number.EPSILON) {
    return Math.abs(immediate.position.x) <= snapshot.visibleHalfWidth
      ? { duration: 0, position: immediate.position }
      : null;
  }

  let lower = 0;
  let upper = null;
  const steps = 96;
  for (let index = 1; index <= steps; index += 1) {
    const time = maxWalk * (index / steps);
    const atTime = candidate(time);
    if (!atTime) return null;
    if (atTime.difference <= 0) {
      upper = time;
      break;
    }
    lower = time;
  }
  if (upper === null) return null;

  for (let iteration = 0; iteration < 50; iteration += 1) {
    const midpoint = (lower + upper) / 2;
    const atMidpoint = candidate(midpoint);
    if (!atMidpoint) return null;
    if (atMidpoint.difference > 0) lower = midpoint;
    else upper = midpoint;
  }
  const arrival = candidate(upper);
  if (!arrival || Math.abs(arrival.position.x) > snapshot.visibleHalfWidth) return null;
  return { duration: upper, position: arrival.position };
}

/**
 * Pure Challenge rival-waiter decision model. It owns no scene or DOM object.
 *
 * Options:
 * - `level` (default 3): level 1 and unknown levels return an inert model.
 * - `total` (default 11): shift customer count used to calculate claim share.
 * - `speed`, `minSeatedAge`, `share`, `hesitationMin`, `hesitationMax`, and
 *   `enabled`: optional overrides for the selected level settings.
 * - `registry`: claim registry, advanced once per positive `advance` call.
 * - `conveyor`: shared belt exposing `take`, `snapshot`, and `predictX`.
 *   The option takes precedence over `view.conveyor`; otherwise the view belt
 *   is used for that update.
 * - `initialPosition`, `beltFrontZ` (default -4.4), `pickupWindow` (default
 *   1.4), and `dishNoticeSeconds` (default 0.6) are plain model values.
 * - `rng`: injected random source used only for hesitations and abandon pauses.
 *
 * `view` is `{ customers, focusReleasedAgo, conveyor? }`. Invalid, negative,
 * or zero service dt makes no progress: no registry time, noticing, snapshots,
 * RNG samples, events, or belt takes.
 */
export function createRestaurantRival({
  level = 3,
  total = 11,
  speed: speedOverride,
  minSeatedAge: minSeatedAgeOverride,
  share: shareOverride,
  hesitationMin: hesitationMinOverride,
  hesitationMax: hesitationMaxOverride,
  enabled: enabledOverride,
  registry = createCustomerClaimRegistry(),
  conveyor = null,
  initialPosition = { x: 5.5, z: -5.6 },
  beltFrontZ = DEFAULT_BELT_FRONT_Z,
  pickupWindow = DEFAULT_PICKUP_WINDOW,
  dishNoticeSeconds = DEFAULT_DISH_NOTICE_SECONDS,
  rng = Math.random,
} = {}) {
  if (typeof rng !== 'function') throw new TypeError('rng must be a function');
  if (!registry || typeof registry.advance !== 'function'
    || typeof registry.claimRival !== 'function') {
    throw new TypeError('registry must be a customer claim registry');
  }
  if (conveyor !== null && !isConveyor(conveyor)) {
    throw new TypeError('conveyor must expose take, snapshot, and predictX');
  }

  const levelConfig = RIVAL_LEVELS[Number(level)] ?? null;
  const settings = {
    ...(levelConfig ?? { enabled: false }),
    ...(speedOverride === undefined ? {} : { speed: speedOverride }),
    ...(minSeatedAgeOverride === undefined ? {} : { minSeatedAge: minSeatedAgeOverride }),
    ...(shareOverride === undefined ? {} : { share: shareOverride }),
    ...(hesitationMinOverride === undefined ? {} : { hesitationMin: hesitationMinOverride }),
    ...(hesitationMaxOverride === undefined ? {} : { hesitationMax: hesitationMaxOverride }),
    ...(enabledOverride === undefined ? {} : { enabled: enabledOverride }),
  };
  const enabled = Boolean(levelConfig && settings.enabled);
  const speed = nonNegativeOption(settings.speed, levelConfig?.speed ?? RIVAL_SPEED);
  const minSeatedAge = nonNegativeOption(
    settings.minSeatedAge, levelConfig?.minSeatedAge ?? RIVAL_MIN_SEATED_AGE,
  );
  const share = nonNegativeOption(settings.share, levelConfig?.share ?? 0);
  const hesitationMin = nonNegativeOption(
    settings.hesitationMin, levelConfig?.hesitationMin ?? 0,
  );
  const hesitationMax = Math.max(
    hesitationMin,
    nonNegativeOption(settings.hesitationMax, levelConfig?.hesitationMax ?? hesitationMin),
  );
  const customerTotal = nonNegativeOption(total, 11);
  const claimLimit = Math.max(1, Math.round(customerTotal * share));
  const start = copyPosition(initialPosition, { x: 0, z: 0 });
  const frontZ = Number.isFinite(Number(beltFrontZ)) ? Number(beltFrontZ) : DEFAULT_BELT_FRONT_Z;
  const window = nonNegativeOption(pickupWindow, DEFAULT_PICKUP_WINDOW);
  const noticeSeconds = nonNegativeOption(dishNoticeSeconds, DEFAULT_DISH_NOTICE_SECONDS);
  const firstSeenAt = new Map();

  let state = 'idle';
  let position = start;
  let remaining = 0;
  let claims = 0;
  let task = null;
  let targetDish = null;
  let carriedDish = null;

  function hesitation() {
    return randomBetween(rng, hesitationMin, hesitationMax);
  }

  function walkData(target, delay = 0, duration = null) {
    const from = copyPosition(position);
    const destination = copyPosition(target);
    const walkDuration = duration ?? (distanceBetween(from, destination) / speed);
    return { from, position: destination, delay, duration: walkDuration, speed };
  }

  function beginChoosing(pause = hesitation()) {
    state = 'choosing';
    remaining = pause;
  }

  function discardedDish() {
    return carriedDish ? { dishId: carriedDish.dishId, food: carriedDish.food } : null;
  }

  function abandonClaimedTask(events, reason) {
    events.push({
      type: 'abandonTask', customer: task.customer, reason, discardedDish: discardedDish(),
    });
    task = null;
    targetDish = null;
    carriedDish = null;
    state = 'idle';
    remaining = 0;
  }

  function taskLossReason() {
    if (!task || ['idle', 'choosing', 'walkingToCustomer'].includes(state)) return null;
    const customer = registry.getCustomer(task.customer);
    if (!customer) return 'left';
    return customer.owner === RESTAURANT_OWNERS.RIVAL ? null : 'ownershipLost';
  }

  function chooseNext(viewCustomers, events) {
    if (claims >= claimLimit) {
      state = 'idle';
      remaining = 0;
      return;
    }
    const target = registry.longestWaitingUnclaimed(minSeatedAge);
    const viewCustomer = target ? findCustomer(viewCustomers, target.id) : null;
    const targetPosition = copyPosition(viewCustomer?.position, target?.position);
    if (!target || !targetPosition) {
      state = 'idle';
      remaining = 0;
      return;
    }
    const walk = walkData(targetPosition);
    task = { customer: target.id, food: viewCustomer?.food ?? target.food, targetPosition };
    state = 'walkingToCustomer';
    remaining = walk.duration;
    events.push({ type: 'targetCustomer', customer: target.id, delay: 0, ...walk });
  }

  function targetFailureReason(customer) {
    if (!customer) return 'missing';
    if (customer.reservedBy !== null) return 'reserved';
    return 'owned';
  }

  function recordVisibleDishes(snapshot, seenAt = registry.serviceTime) {
    if (!snapshot) return;
    for (const dish of snapshot.dishes) {
      const x = Number(dish?.x);
      if (dish?.id !== null && dish?.id !== undefined
        && Number.isFinite(x) && Math.abs(x) <= snapshot.visibleHalfWidth
        && !firstSeenAt.has(dish.id)) {
        firstSeenAt.set(dish.id, seenAt);
      }
    }
  }

  function targetMatchingDish(activeConveyor, snapshot, events, now = registry.serviceTime) {
    if (!activeConveyor || !snapshot) return;
    // Epsilon: accumulated service-time sums (0.1 × 6) must still count as 0.6.
    const matching = snapshot.dishes.filter((dish) => dish?.food === task.food
      && firstSeenAt.has(dish.id)
      && now - firstSeenAt.get(dish.id) + 1e-9 >= noticeSeconds);
    if (matching.length === 0) return;

    const delay = hesitation();
    let selected = null;
    for (const dish of matching) {
      const intercept = solveInterception(
        activeConveyor, dish, snapshot, position, frontZ, delay, speed,
      );
      if (!intercept) continue;
      const arrival = delay + intercept.duration;
      if (!selected || arrival < selected.arrival) selected = { dish, intercept, arrival };
    }
    if (!selected) {
      remaining = delay;
      return;
    }

    const walk = walkData(selected.intercept.position, delay, selected.intercept.duration);
    targetDish = {
      dishId: selected.dish.id,
      food: selected.dish.food,
      position: walk.position,
      conveyor: activeConveyor,
    };
    state = 'walkingToDish';
    remaining = walk.delay + walk.duration;
    events.push({
      type: 'targetDish', customer: task.customer, dishId: targetDish.dishId,
      food: targetDish.food, ...walk,
    });
  }

  function abandonDish(events, reason) {
    events.push({
      type: 'abandonDish', customer: task.customer, dishId: targetDish.dishId, reason,
    });
    targetDish = null;
    state = 'watchingBelt';
    remaining = randomBetween(rng, ABANDON_MIN, ABANDON_MAX);
  }

  function advance(serviceDt, view = {}) {
    const dt = Number(serviceDt);
    if (!Number.isFinite(dt) || dt <= 0) return [];

    // A frame judges the belt as it stood when the frame began, so a dish seen
    // across N frames of dt has been noticed for N × dt, not one frame less.
    const frameStart = registry.serviceTime;
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

    const activeConveyor = conveyor ?? (isConveyor(view.conveyor) ? view.conveyor : null);
    const snapshot = beltSnapshot(activeConveyor);
    recordVisibleDishes(snapshot, frameStart);

    const lostReason = taskLossReason();
    if (lostReason) {
      abandonClaimedTask(events, lostReason);
      return events;
    }

    if (state === 'idle') {
      if (claims < claimLimit) beginChoosing();
      return events;
    }

    if (state === 'choosing') {
      remaining = Math.max(0, remaining - dt);
      if (remaining === 0) chooseNext(viewCustomers, events);
      return events;
    }

    if (state === 'walkingToCustomer') {
      const customerBeforeArrival = registry.getCustomer(task.customer);
      if (!customerBeforeArrival) {
        events.push({ type: 'abandonTarget', customer: task.customer, reason: 'missing' });
        task = null;
        beginChoosing(randomBetween(rng, ABANDON_MIN, ABANDON_MAX));
        return events;
      }
      remaining = Math.max(0, remaining - dt);
      if (remaining > 0) return events;
      position = copyPosition(task.targetPosition);
      if (isPostFocusHold(view.focusReleasedAgo)) return events;
      if (!registry.claimRival(task.customer, { minSeatedAge })) {
        events.push({
          type: 'abandonTarget', customer: task.customer,
          reason: targetFailureReason(registry.getCustomer(task.customer)),
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
      state = 'watchingBelt';
      remaining = 0;
      events.push({ type: 'orderTaken', customer: task.customer, food: task.food });
      return events;
    }

    if (state === 'watchingBelt') {
      remaining = Math.max(0, remaining - dt);
      if (remaining > 0) return events;
      targetMatchingDish(activeConveyor, snapshot, events, frameStart);
      return events;
    }

    if (state === 'walkingToDish') {
      const current = snapshot?.dishes.find((dish) => dish.id === targetDish.dishId);
      if (!current) {
        abandonDish(events, 'taken');
        return events;
      }
      remaining = Math.max(0, remaining - dt);
      if (remaining > 0) return events;

      position = copyPosition(targetDish.position);
      if (Math.abs(Number(current.x) - position.x) > window) {
        abandonDish(events, 'missed');
        return events;
      }
      const taken = targetDish.conveyor.take(targetDish.dishId);
      if (!taken) {
        abandonDish(events, 'taken');
        return events;
      }
      carriedDish = { dishId: targetDish.dishId, food: taken.food ?? targetDish.food };
      events.push({
        type: 'pickUpDish', customer: task.customer, dishId: carriedDish.dishId,
        food: carriedDish.food, position: copyPosition(position),
      });
      targetDish = null;
      state = 'carrying';
      remaining = hesitation();
      return events;
    }

    if (state === 'carrying') {
      remaining = Math.max(0, remaining - dt);
      if (remaining > 0) return events;
      const current = findCustomer(viewCustomers, task.customer);
      const registered = registry.getCustomer(task.customer);
      const destination = copyPosition(current?.position, registered?.position);
      if (!destination) {
        abandonClaimedTask(events, 'left');
        return events;
      }
      const walk = walkData(destination);
      state = 'delivering';
      remaining = walk.duration;
      task.targetPosition = destination;
      events.push({ type: 'deliverToCustomer', customer: task.customer, delay: 0, ...walk });
      return events;
    }

    if (state === 'delivering') {
      remaining = Math.max(0, remaining - dt);
      if (remaining > 0) return events;
      const customer = registry.getCustomer(task.customer);
      if (!customer || customer.owner !== RESTAURANT_OWNERS.RIVAL) {
        abandonClaimedTask(events, customer ? 'ownershipLost' : 'left');
        return events;
      }
      position = copyPosition(task.targetPosition);
      const servedCustomer = task.customer;
      const servedFood = carriedDish.food;
      registry.resolveCustomer(servedCustomer, { outcome: 'served' });
      const counts = registry.counts;
      events.push({
        type: 'servedCustomer', customer: servedCustomer, food: servedFood,
        owner: RESTAURANT_OWNERS.RIVAL, playerServed: counts.playerServed,
        rivalServed: counts.rivalServed,
      });
      task = null;
      carriedDish = null;
      state = 'idle';
      remaining = 0;
    }
    return events;
  }

  return {
    advance,
    registry,
    get enabled() { return enabled; },
    get claimLimit() { return claimLimit; },
    get state() { return state; },
    get position() { return copyPosition(position); },
    get targetCustomer() { return task?.customer ?? null; },
    get targetDishId() { return targetDish?.dishId ?? null; },
    get carriedDish() { return carriedDish ? { ...carriedDish } : null; },
    get claims() { return claims; },
    get counts() { return registry.counts; },
  };
}
