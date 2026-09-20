const SHARED_CONFIG = Object.freeze({
  entryX: 7.2,
  exitX: -7.2,
  direction: -1,
  visibleHalfWidth: 6.6,
});
const SCHEDULER_EPSILON = 1e-10;
export const MIN_DISH_SPACING = 1.9;

function difficultyConfig(speed, entryInterval, rush, roundTwo = null, roundThree = null) {
  return Object.freeze({
    ...SHARED_CONFIG,
    speed,
    entryInterval,
    rush: rush ? Object.freeze(rush) : null,
    roundTwo: roundTwo ? Object.freeze(roundTwo) : null,
    roundThree: roundThree ? Object.freeze(roundThree) : null,
  });
}

export const CONVEYOR_CONFIG = Object.freeze({
  // Visible span 13.2: solo ≈ 3.7 dishes; rush ≈ 5.1 (Normal) and 6.6 (Challenge).
  // Pickups by both waiters keep the on-screen count about one lower.
  // Round 2 (after beating the first rival): +17% speed and a denser stream,
  // ≈ 6.0 (Normal) and 6.8 (Challenge) visible, still MIN_DISH_SPACING apart.
  // Round 3's NORMAL belt is Round 2's belt exactly; its difficulty is the fast
  // bursts laid over it (beltTempo.js + setTempo), not a higher base speed.
  1: difficultyConfig(0.9, 4.0, null),
  2: difficultyConfig(
    1.0, 3.6,
    { speed: 1.08, entryInterval: 2.4 },
    { speed: 1.26, entryInterval: 1.75 },
    { speed: 1.26, entryInterval: 1.75 },
  ),
  3: difficultyConfig(
    1.05, 3.4,
    { speed: 1.18, entryInterval: 1.7 },
    { speed: 1.38, entryInterval: 1.4 },
    { speed: 1.38, entryInterval: 1.4 },
  ),
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

  // The mode (solo/rush/roundTwo/roundThree) sets the base speed and interval;
  // the Round 3 tempo multiplier is applied on top of them, so a fast burst
  // never loses the mode it is a burst of.
  let baseSpeed = Number(config.speed);
  let baseEntryInterval = Number(config.entryInterval);
  let tempo = 1;
  let speed = baseSpeed;
  const direction = Number(config.direction);
  const entryX = Number(config.entryX);
  const exitX = Number(config.exitX);
  const visibleHalfWidth = Number(config.visibleHalfWidth);
  let entryInterval = Math.max(baseEntryInterval, MIN_DISH_SPACING / speed);
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

  /**
   * Seconds until the entry point is clear enough for another dish.
   *
   * The entry interval alone only guarantees spacing while the speed is
   * constant: a dish that left the entry at the old, slower speed has not
   * travelled MIN_DISH_SPACING yet when a faster interval says the next one is
   * already due. Spacing is a distance rule, so it is enforced as one here, and
   * every speed change — tempo bursts and mode switches alike — is covered.
   */
  function entryClearanceDelay() {
    if (speed <= 0) return Infinity;
    let wait = 0;
    for (const dish of dishes) {
      const travelled = direction < 0 ? entryX - dish.x : dish.x - entryX;
      if (travelled >= MIN_DISH_SPACING || travelled < 0) continue;
      wait = Math.max(wait, (MIN_DISH_SPACING - travelled) / speed);
    }
    return wait;
  }

  function enter(events) {
    const dish = { id: nextId, food: nextFood(), x: entryX, filler: false };
    nextId += 1;
    dishes.push(dish);
    events.push({ type: 'enter', dish: copyDish(dish) });
    lastEntryTime = serviceTime;
    nextEntryTime += entryInterval;
  }

  function switchMode(nextMode, values) {
    if (!values || mode === nextMode) return false;
    baseSpeed = Number(values.speed);
    baseEntryInterval = Number(values.entryInterval);
    speed = baseSpeed * tempo;
    entryInterval = Math.max(baseEntryInterval / tempo, MIN_DISH_SPACING / speed);
    const acceleratedEntryTime = Math.max(serviceTime, lastEntryTime + entryInterval);
    if (acceleratedEntryTime < nextEntryTime) nextEntryTime = stableNumber(acceleratedEntryTime);
    mode = nextMode;
    return true;
  }

  /**
   * Round 3's speed burst. The interval is divided by the multiplier so the
   * *spatial* gap between dishes is preserved: keeping the time interval would
   * spread dishes twice as far apart and starve the belt at the very moment it
   * should look frantic. Dish positions are untouched, so a burst accelerates
   * what is already on the belt rather than moving or respawning anything, and
   * `nextEntryTime` is rebuilt from the last entry at the new speed so spacing
   * still holds across the switch in either direction.
   */
  function setTempo(multiplier) {
    const next = Number(multiplier);
    if (!Number.isFinite(next) || next <= 0 || next === tempo) return false;
    tempo = next;
    speed = baseSpeed * tempo;
    entryInterval = Math.max(baseEntryInterval / tempo, MIN_DISH_SPACING / speed);
    nextEntryTime = stableNumber(Math.max(serviceTime, lastEntryTime + entryInterval));
    return true;
  }

  function startRush() {
    return mode === 'solo' && switchMode('rush', defaults.rush);
  }

  // Round 2 only: the belt keeps its dishes and simply speeds up and densifies.
  function startRoundTwo() {
    return switchMode('roundTwo', defaults.roundTwo);
  }

  // Round 3 starts from Round 2's belt; the fast bursts that define the round
  // arrive through setTempo, never as a mode of their own.
  function startRoundThree() {
    return switchMode('roundThree', defaults.roundThree);
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
        const clearance = entryClearanceDelay();
        if (clearance > 0) {
          // Hold the dish at the hatch until the one ahead is far enough away.
          nextEntryTime = stableNumber(serviceTime + clearance);
        } else {
          enter(events);
          entered = true;
        }
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

  function exchange(dishId, food) {
    const index = dishes.findIndex((dish) => dish.id === dishId);
    if (index < 0 || Math.abs(dishes[index].x) > visibleHalfWidth) return null;
    const taken = dishes[index];
    const placed = { id: nextId, food, x: taken.x, filler: false };
    nextId += 1;
    dishes[index] = placed;
    return { taken: copyDish(taken), placed: copyDish(placed) };
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
      tempo,
      baseSpeed,
      beltTravel,
      dishes: dishes.map(copyDish),
      pending: [],
      serviceTime,
    };
  }

  return {
    advance, startRush, startRoundTwo, startRoundThree, setTempo,
    take, exchange, nearestPickable, predictX, snapshot,
  };
}
