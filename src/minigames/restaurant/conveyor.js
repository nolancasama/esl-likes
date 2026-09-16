const SHARED_CONFIG = Object.freeze({
  entryX: 7.2,
  exitX: -7.2,
  direction: -1,
  visibleHalfWidth: 6.6,
});
const SCHEDULER_EPSILON = 1e-10;
export const MIN_DISH_SPACING = 1.9;

function difficultyConfig(speed, entryInterval, rush) {
  return Object.freeze({
    ...SHARED_CONFIG,
    speed,
    entryInterval,
    rush: rush ? Object.freeze(rush) : null,
  });
}

export const CONVEYOR_CONFIG = Object.freeze({
  // Visible span 13.2: solo ≈ 3.7 dishes; rush ≈ 5.1 (Normal) and 6.6 (Challenge).
  // Pickups by both waiters keep the on-screen count about one lower.
  1: difficultyConfig(0.9, 4.0, null),
  2: difficultyConfig(1.0, 3.6, { speed: 1.08, entryInterval: 2.4 }),
  3: difficultyConfig(1.05, 3.4, { speed: 1.18, entryInterval: 1.7 }),
});

function sample(rng) {
  const value = Number(rng());
  if (!Number.isFinite(value)) return 0;
  return Math.min(0.999999999, Math.max(0, value));
}

function stableNumber(value) {
  return Number(value.toFixed(12));
}

function copyDish(dish) {
  return { id: dish.id, food: dish.food, x: dish.x, filler: false };
}

/** Pure, service-clock-driven Restaurant conveyor stream. */
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

  let speed = Number(config.speed);
  const direction = Number(config.direction);
  const entryX = Number(config.entryX);
  const exitX = Number(config.exitX);
  const visibleHalfWidth = Number(config.visibleHalfWidth);
  let entryInterval = Math.max(Number(config.entryInterval), MIN_DISH_SPACING / speed);
  let mode = 'solo';

  let serviceTime = 0;
  let beltTravel = 0;
  let nextId = 1;
  let nextEntryTime = 0.5;
  let lastEntryTime = nextEntryTime - entryInterval;
  let lastFood = null;
  let bag = [];
  const dishes = [];

  function shuffle(entries) {
    for (let index = entries.length - 1; index > 0; index -= 1) {
      const other = Math.floor(sample(rng) * (index + 1));
      [entries[index], entries[other]] = [entries[other], entries[index]];
    }
  }

  function nextFood() {
    if (bag.length === 0) {
      bag = [...foods];
      shuffle(bag);
      if (bag.length > 1 && bag[0] === lastFood) [bag[0], bag[1]] = [bag[1], bag[0]];
    }
    const food = bag.shift();
    lastFood = food;
    return food;
  }

  function moveBy(dt) {
    if (dt <= 0) return;
    const travel = stableNumber(speed * dt);
    beltTravel = stableNumber(beltTravel + travel);
    for (const dish of dishes) dish.x = stableNumber(dish.x + (direction * travel));
    serviceTime = stableNumber(serviceTime + dt);
  }

  function hasReachedExit(dish) {
    return direction < 0 ? dish.x <= exitX + SCHEDULER_EPSILON : dish.x >= exitX - SCHEDULER_EPSILON;
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

  function removeExited(events) {
    let removed = false;
    for (let index = dishes.length - 1; index >= 0; index -= 1) {
      const dish = dishes[index];
      if (!hasReachedExit(dish)) continue;
      dishes.splice(index, 1);
      events.push({ type: 'exit', dish: { id: dish.id, food: dish.food, filler: false } });
      removed = true;
    }
    return removed;
  }

  function enter(events) {
    const dish = { id: nextId, food: nextFood(), x: entryX, filler: false };
    nextId += 1;
    dishes.push(dish);
    events.push({ type: 'enter', dish: copyDish(dish) });
    lastEntryTime = serviceTime;
    nextEntryTime += entryInterval;
  }

  function startRush() {
    const rush = defaults.rush;
    if (!rush || mode === 'rush') return false;
    speed = Number(rush.speed);
    entryInterval = Math.max(Number(rush.entryInterval), MIN_DISH_SPACING / speed);
    const acceleratedEntryTime = Math.max(serviceTime, lastEntryTime + entryInterval);
    if (acceleratedEntryTime < nextEntryTime) nextEntryTime = stableNumber(acceleratedEntryTime);
    mode = 'rush';
    return true;
  }

  function advance(serviceDt, view = {}) { // view remains accepted but intentionally unused.
    void view;
    const dt = Number(serviceDt);
    if (!Number.isFinite(dt) || dt <= 0) return [];

    const events = [];
    const targetTime = stableNumber(serviceTime + dt);
    while (serviceTime + SCHEDULER_EPSILON < targetTime) {
      const boundary = Math.min(targetTime, nextEntryTime, nextExitTime());
      moveBy(Math.max(0, boundary - serviceTime));
      const exited = removeExited(events);
      let entered = false;
      if (foods.length > 0 && nextEntryTime <= serviceTime + SCHEDULER_EPSILON) {
        enter(events);
        entered = true;
      }
      if (serviceTime + SCHEDULER_EPSILON >= targetTime) break;
      if (boundary === serviceTime && !exited && !entered) moveBy(targetTime - serviceTime);
    }
    if (serviceTime < targetTime) moveBy(targetTime - serviceTime);
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
      entryInterval,
      mode,
      beltTravel,
      dishes: dishes.map(copyDish),
      pending: [],
      serviceTime,
    };
  }

  return { advance, startRush, take, nearestPickable, predictX, snapshot };
}
