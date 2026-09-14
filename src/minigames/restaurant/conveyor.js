const SHARED_CONFIG = Object.freeze({
  entryX: 7.2,
  exitX: -7.2,
  direction: -1,
  visibleHalfWidth: 6.6,
  minSpacing: 2.2,
  reentryDelay: Object.freeze([1.5, 2.5]),
});

function difficultyConfig(speed, maxEntryDelay, fillerMeanInterval, visibleCap) {
  return Object.freeze({
    speed,
    entryX: SHARED_CONFIG.entryX,
    exitX: SHARED_CONFIG.exitX,
    direction: SHARED_CONFIG.direction,
    visibleHalfWidth: SHARED_CONFIG.visibleHalfWidth,
    minSpacing: SHARED_CONFIG.minSpacing,
    maxEntryDelay,
    reentryDelay: SHARED_CONFIG.reentryDelay,
    fillerMeanInterval,
    visibleCap,
  });
}

export const CONVEYOR_CONFIG = Object.freeze({
  1: difficultyConfig(0.9, 3, null, 2),
  2: difficultyConfig(1.05, 4, 12, 3),
  3: difficultyConfig(1.2, 5, 8, 4),
});

function sample(rng) {
  const value = Number(rng());
  if (!Number.isFinite(value)) return 0;
  return Math.min(0.999999999, Math.max(0, value));
}

function randomBetween(rng, minimum, maximum) {
  return minimum + ((maximum - minimum) * sample(rng));
}

function countFoods(items, selector) {
  const counts = new Map();
  for (const item of items) {
    const food = selector(item);
    if (typeof food !== 'string') continue;
    counts.set(food, (counts.get(food) ?? 0) + 1);
  }
  return counts;
}

function copyDish(dish) {
  return { id: dish.id, food: dish.food, x: dish.x, filler: dish.filler };
}

/**
 * Pure, service-clock-driven Restaurant conveyor scheduler.
 */
export function createConveyor(options = {}) {
  const difficulty = Number(options.difficulty ?? 1);
  const defaults = CONVEYOR_CONFIG[difficulty];
  if (!defaults) throw new RangeError('difficulty must be 1, 2, or 3');

  const rng = options.rng ?? Math.random;
  if (typeof rng !== 'function') throw new TypeError('rng must be a function');

  const foods = Array.isArray(options.foods)
    ? options.foods.filter((food) => typeof food === 'string')
    : [];
  const config = {};
  for (const field of Object.keys(defaults)) {
    config[field] = Object.hasOwn(options, field) ? options[field] : defaults[field];
  }

  const speed = Number(config.speed);
  const direction = Number(config.direction);
  const entryX = Number(config.entryX);
  const exitX = Number(config.exitX);
  const visibleHalfWidth = Number(config.visibleHalfWidth);
  const minSpacing = Number(config.minSpacing);
  const maxEntryDelay = Number(config.maxEntryDelay);
  const reentryDelay = Array.isArray(config.reentryDelay)
    ? config.reentryDelay.map(Number)
    : defaults.reentryDelay;
  const fillerMeanInterval = config.fillerMeanInterval === null
    ? null
    : Number(config.fillerMeanInterval);
  const visibleCap = Number(config.visibleCap);

  let serviceTime = 0;
  let beltTravel = 0;
  let nextId = 1;
  let lastEntryTime = -Infinity;
  let fillerDueAt = null;
  const dishes = [];
  const pending = [];

  function dueCounts(view) {
    const orders = Array.isArray(view?.dueOrders) ? view.dueOrders : [];
    return countFoods(orders, (order) => order?.food);
  }

  function carriedCount(view, food) {
    return view?.carriedFood === food ? 1 : 0;
  }

  function beltCount(food) {
    let count = 0;
    for (const dish of dishes) if (dish.food === food) count += 1;
    return count;
  }

  function pendingCount(food) {
    let count = 0;
    for (const entry of pending) if (entry.food === food) count += 1;
    return count;
  }

  function shuffle(entries) {
    for (let index = entries.length - 1; index > 0; index -= 1) {
      const other = Math.floor(sample(rng) * (index + 1));
      [entries[index], entries[other]] = [entries[other], entries[index]];
    }
  }

  function addNewDemand(additions, food, count) {
    for (let index = 0; index < count; index += 1) {
      additions.push({
        food,
        dueAt: serviceTime + randomBetween(
          rng,
          0.4,
          maxEntryDelay * 0.7,
        ),
        reentry: false,
      });
    }
  }

  function enqueueReentry(food) {
    const minimum = Number(reentryDelay[0]);
    const maximum = Number(reentryDelay[1]);
    pending.push({
      food,
      dueAt: serviceTime + randomBetween(rng, minimum, maximum),
      reentry: true,
    });
  }

  function cancelPending(food, count) {
    for (let index = pending.length - 1; index >= 0 && count > 0; index -= 1) {
      if (pending[index].food !== food) continue;
      pending.splice(index, 1);
      count -= 1;
    }
  }

  function reconcileDemand(view, counts = dueCounts(view)) {
    const relevantFoods = new Set(counts.keys());
    const additions = [];
    for (const dish of dishes) relevantFoods.add(dish.food);
    for (const entry of pending) relevantFoods.add(entry.food);
    if (typeof view?.carriedFood === 'string') relevantFoods.add(view.carriedFood);

    for (const food of relevantFoods) {
      const deficit = (counts.get(food) ?? 0)
        - beltCount(food)
        - carriedCount(view, food)
        - pendingCount(food);
      if (deficit > 0) addNewDemand(additions, food, deficit);
      if (deficit < 0) cancelPending(food, -deficit);
    }
    shuffle(additions);
    pending.push(...additions);
    return counts;
  }

  function spacingReadyAt() {
    if (!Number.isFinite(lastEntryTime)) return -Infinity;
    return lastEntryTime + (minSpacing / speed);
  }

  function earliestPendingEntryTime() {
    if (pending.length === 0) return Infinity;
    let earliest = Infinity;
    const spacingTime = spacingReadyAt();
    for (const entry of pending) earliest = Math.min(earliest, Math.max(entry.dueAt, spacingTime));
    return earliest;
  }

  function nextExitTime() {
    if (speed <= 0 || direction === 0) return Infinity;
    let earliest = Infinity;
    for (const dish of dishes) {
      const remaining = (exitX - dish.x) / direction;
      earliest = Math.min(earliest, serviceTime + (Math.max(0, remaining) / speed));
    }
    return earliest;
  }

  function moveBy(dt) {
    if (dt <= 0) return;
    const travel = speed * dt;
    beltTravel += travel;
    for (const dish of dishes) dish.x += direction * travel;
    serviceTime += dt;
  }

  function hasReachedExit(dish) {
    return direction < 0 ? dish.x <= exitX : dish.x >= exitX;
  }

  function releasePending(events) {
    if (serviceTime + Number.EPSILON < spacingReadyAt()) return false;
    const index = pending.findIndex((entry) => entry.dueAt <= serviceTime + Number.EPSILON);
    if (index < 0) return false;
    const entry = pending.splice(index, 1)[0];
    const dish = { id: nextId, food: entry.food, x: entryX, filler: false };
    nextId += 1;
    lastEntryTime = serviceTime;
    dishes.push(dish);
    events.push({ type: 'enter', dish: copyDish(dish) });
    return true;
  }

  function exponentialDelay(mean) {
    const delay = -Math.log(1 - sample(rng)) * mean;
    return delay > 0 ? delay : mean;
  }

  function visibleDishCount() {
    let count = 0;
    for (const dish of dishes) if (Math.abs(dish.x) <= visibleHalfWidth) count += 1;
    return count;
  }

  function attemptFiller(view, counts, events) {
    fillerDueAt = serviceTime + exponentialDelay(fillerMeanInterval);
    if (pending.length > 0 || serviceTime + Number.EPSILON < spacingReadyAt()) return;
    if (visibleDishCount() >= visibleCap) return;
    const candidates = foods.filter((food) => (counts.get(food) ?? 0) === 0
      && food !== view?.carriedFood);
    if (candidates.length === 0) return;
    const food = candidates[Math.floor(sample(rng) * candidates.length)];
    const dish = { id: nextId, food, x: entryX, filler: true };
    nextId += 1;
    lastEntryTime = serviceTime;
    dishes.push(dish);
    events.push({ type: 'enter', dish: copyDish(dish) });
  }

  function advance(serviceDt, view = {}) {
    const dt = Number(serviceDt);
    if (!Number.isFinite(dt) || dt <= 0) return [];

    const events = [];
    const counts = reconcileDemand(view);
    if (fillerMeanInterval !== null && fillerDueAt === null) {
      fillerDueAt = serviceTime + exponentialDelay(fillerMeanInterval);
    }
    const targetTime = serviceTime + dt;

    while (serviceTime < targetTime) {
      const boundary = Math.min(
        targetTime,
        earliestPendingEntryTime(),
        nextExitTime(),
        fillerDueAt ?? Infinity,
      );
      moveBy(Math.max(0, boundary - serviceTime));

      let handledBoundary = false;
      for (let index = dishes.length - 1; index >= 0; index -= 1) {
        const dish = dishes[index];
        if (!hasReachedExit(dish)) continue;
        handledBoundary = true;
        dishes.splice(index, 1);
        events.push({
          type: 'exit',
          dish: { id: dish.id, food: dish.food, filler: dish.filler },
        });
        const deficit = (counts.get(dish.food) ?? 0)
          - beltCount(dish.food)
          - carriedCount(view, dish.food)
          - pendingCount(dish.food);
        if (deficit > 0) enqueueReentry(dish.food);
      }

      const entered = releasePending(events);
      if (fillerDueAt !== null && fillerDueAt <= serviceTime + Number.EPSILON) {
        handledBoundary = true;
        attemptFiller(view, counts, events);
      }

      if (serviceTime >= targetTime) break;
      if (boundary === Infinity || (boundary === serviceTime && !entered && !handledBoundary)) {
        moveBy(targetTime - serviceTime);
      }
    }
    return events;
  }

  function take(dishId) {
    const index = dishes.findIndex((dish) => dish.id === dishId);
    if (index < 0 || Math.abs(dishes[index].x) > visibleHalfWidth) return null;
    return copyDish(dishes.splice(index, 1)[0]);
  }

  function nearestPickable(x, window) {
    const target = Number(x);
    const radius = Number(window);
    if (!Number.isFinite(target) || !Number.isFinite(radius) || radius < 0) return null;
    let nearest = null;
    let distance = Infinity;
    for (const dish of dishes) {
      if (Math.abs(dish.x) > visibleHalfWidth) continue;
      const candidateDistance = Math.abs(dish.x - target);
      if (candidateDistance <= radius && candidateDistance < distance) {
        nearest = dish;
        distance = candidateDistance;
      }
    }
    return nearest ? copyDish(nearest) : null;
  }

  function predictX(dishId, seconds) {
    const dish = dishes.find((candidate) => candidate.id === dishId);
    const duration = Number(seconds);
    if (!dish || !Number.isFinite(duration)) return null;
    return dish.x + (direction * speed * duration);
  }

  function snapshot() {
    return {
      speed,
      direction,
      entryX,
      exitX,
      visibleHalfWidth,
      beltTravel,
      dishes: dishes.map(copyDish),
      pending: pending.map((entry) => ({ ...entry })),
      serviceTime,
    };
  }

  return { advance, take, nearestPickable, predictX, snapshot };
}
