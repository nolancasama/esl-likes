import test from 'node:test';
import assert from 'node:assert/strict';

import { CONVEYOR_CONFIG, MIN_DISH_SPACING, createConveyor } from './conveyor.js';

const FOODS = ['curry', 'pizza', 'hamburger', 'ramen', 'sushi'];

function seededRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = ((state * 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function entries(conveyor, count, view, dt = 0.1) {
  const result = [];
  while (result.length < count) {
    for (const event of conveyor.advance(dt, view)) {
      if (event.type === 'enter') result.push(event);
    }
  }
  return result;
}

test('each fresh bag contains every food exactly once', () => {
  const stream = entries(createConveyor({ difficulty: 1, foods: FOODS, rng: seededRng(4) }), 10);
  for (let index = 0; index < stream.length; index += FOODS.length) {
    assert.deepEqual([...stream.slice(index, index + FOODS.length).map((event) => event.dish.food)].sort(), [...FOODS].sort());
  }
});

test('the shuffled stream continues and does not repeat across bag seams', () => {
  const stream = entries(createConveyor({ difficulty: 3, foods: FOODS, rng: seededRng(7) }), 205);
  const names = stream.map((event) => event.dish.food);
  assert.equal(names.length, 205);
  for (let index = FOODS.length; index < names.length; index += FOODS.length) {
    assert.notEqual(names[index - 1], names[index]);
  }
});

test('a food is absent for at most eight other entries', () => {
  const names = entries(createConveyor({ difficulty: 2, foods: FOODS, rng: seededRng(9) }), 205).map((event) => event.dish.food);
  for (const food of FOODS) {
    const positions = names.map((name, index) => (name === food ? index : -1)).filter((index) => index >= 0);
    for (let index = 1; index < positions.length; index += 1) assert.ok(positions[index] - positions[index - 1] - 1 <= 8);
  }
});

test('view never affects the stream', () => {
  const left = createConveyor({ difficulty: 3, foods: FOODS, rng: seededRng(11) });
  const right = createConveyor({ difficulty: 3, foods: FOODS, rng: seededRng(11) });
  const dts = [0.25, 3.1, 0.4, 6.7, 0.01, 4.3];
  for (const dt of dts) {
    assert.deepEqual(left.advance(dt, { dueOrders: [{ food: 'curry' }] }), right.advance(dt, { carriedFood: 'sushi' }));
    assert.deepEqual(left.snapshot(), right.snapshot());
  }
});

test('entries continue without orders at the configured cadence', () => {
  for (const [difficulty, interval] of [[1, 4.0], [2, 3.6], [3, 3.4]]) {
    const conveyor = createConveyor({ difficulty, foods: FOODS, rng: seededRng(difficulty) });
    const stream = entries(conveyor, 4, undefined, 0.1);
    assert.deepEqual(stream.map((event) => event.dish.id), [1, 2, 3, 4]);
    assert.ok(Math.abs(conveyor.snapshot().serviceTime - (0.5 + (3 * interval))) < 0.11);
  }
});

test('large advances match small advances, including mid-step entry travel', () => {
  const large = createConveyor({ difficulty: 2, foods: FOODS, rng: seededRng(15) });
  const small = createConveyor({ difficulty: 2, foods: FOODS, rng: seededRng(15) });
  const largeEvents = large.advance(22);
  const smallEvents = [];
  for (let index = 0; index < 220; index += 1) smallEvents.push(...small.advance(0.1));
  assert.deepEqual(largeEvents, smallEvents);
  assert.deepEqual(large.snapshot(), small.snapshot());
  const fifth = large.snapshot().dishes.find((dish) => dish.id === 5);
  // Entered at 0.5 + 4 × 3.6 = 14.9 s; 7.2 − 1.0 × (22 − 14.9).
  assert.equal(fifth.x, 0.1);
});

test('zero, invalid, and negative dt freeze positions without sampling rng', () => {
  let samples = 0;
  const conveyor = createConveyor({ difficulty: 1, foods: FOODS, rng: () => { samples += 1; return 0.5; } });
  conveyor.advance(1);
  const before = conveyor.snapshot();
  const beforeSamples = samples;
  for (const dt of [0, -1, NaN, Infinity]) assert.deepEqual(conveyor.advance(dt), []);
  assert.deepEqual(conveyor.snapshot(), before);
  assert.equal(samples, beforeSamples);
});

test('dishes leave the belt with exit events', () => {
  const conveyor = createConveyor({ difficulty: 1, foods: ['pizza'], rng: seededRng(20) });
  const events = conveyor.advance(20);
  // Dish 1 needs 14.4 / 0.9 = 16 s, so it exits at 16.5 s: the same instant dish 5
  // enters, and exits are removed before entries are added.
  assert.deepEqual(events.map((event) => event.type), ['enter', 'enter', 'enter', 'enter', 'exit', 'enter']);
  assert.deepEqual(events[4], { type: 'exit', dish: { id: 1, food: 'pizza', filler: false } });
});

test('take observes the pickup bounds and is atomic', () => {
  const conveyor = createConveyor({ difficulty: 1, foods: ['pizza'], rng: seededRng(21) });
  const [entry] = entries(conveyor, 1, undefined, 0.1);
  assert.equal(conveyor.take(entry.dish.id), null);
  conveyor.advance(1);
  const dish = conveyor.nearestPickable(6.3, 0.2);
  assert.ok(dish);
  assert.deepEqual(conveyor.take(dish.id), dish);
  assert.equal(conveyor.take(dish.id), null);
  assert.equal(conveyor.predictX(dish.id, 1), null);
});

test('exchange replaces a visible dish in place without changing the stream', () => {
  const conveyor = createConveyor({ difficulty: 1, foods: FOODS, rng: seededRng(22) });
  const control = createConveyor({ difficulty: 1, foods: FOODS, rng: seededRng(22) });
  conveyor.advance(4.9);
  control.advance(4.9);
  const before = conveyor.snapshot();
  const target = before.dishes.find((dish) => Math.abs(dish.x) <= before.visibleHalfWidth);
  const neighbours = before.dishes.filter((dish) => dish.id !== target.id);

  const exchanged = conveyor.exchange(target.id, 'sushi');
  assert.deepEqual(exchanged.taken, target);
  assert.equal(exchanged.placed.food, 'sushi');
  assert.equal(exchanged.placed.x, target.x);
  assert.notEqual(exchanged.placed.id, target.id);
  assert.equal(conveyor.snapshot().dishes.length, before.dishes.length);
  for (const neighbour of neighbours) {
    assert.ok(Math.abs(neighbour.x - exchanged.placed.x) >= MIN_DISH_SPACING - 1e-9);
  }

  assert.equal(conveyor.nearestPickable(exchanged.placed.x, 0.01)?.id, exchanged.placed.id);
  assert.equal(conveyor.predictX(exchanged.placed.id, 1), exchanged.placed.x - before.speed);
  conveyor.advance(0.5);
  assert.equal(
    conveyor.snapshot().dishes.find((dish) => dish.id === exchanged.placed.id)?.x,
    exchanged.placed.x - (before.speed * 0.5),
  );
  assert.equal(conveyor.take(exchanged.placed.id)?.food, 'sushi');

  const exchangedFoods = conveyor.advance(20)
    .filter((event) => event.type === 'enter').map((event) => event.dish.food);
  control.advance(0.5);
  const controlFoods = control.advance(20)
    .filter((event) => event.type === 'enter').map((event) => event.dish.food);
  assert.deepEqual(exchangedFoods, controlFoods, 'exchange does not draw from the food bag');
});

test('exchange rejects unknown and out-of-view dishes without mutation', () => {
  const conveyor = createConveyor({ difficulty: 1, foods: FOODS, rng: seededRng(23) });
  const [entry] = entries(conveyor, 1, undefined, 0.1);
  const before = conveyor.snapshot();
  assert.equal(conveyor.exchange(entry.dish.id, 'sushi'), null);
  assert.deepEqual(conveyor.snapshot(), before);
  assert.equal(conveyor.exchange(9999, 'sushi'), null);
  assert.deepEqual(conveyor.snapshot(), before);
});

test('config defaults remain frozen', () => {
  assert.equal(Object.isFrozen(CONVEYOR_CONFIG), true);
  assert.equal(Object.isFrozen(CONVEYOR_CONFIG[1]), true);
  assert.equal(Object.isFrozen(CONVEYOR_CONFIG[2].rush), true);
  assert.equal(Object.isFrozen(CONVEYOR_CONFIG[3].rush), true);
});

function averageVisible(conveyor, duration = 120, dt = 0.1) {
  let total = 0;
  let samples = 0;
  for (let elapsed = 0; elapsed < duration; elapsed += dt) {
    conveyor.advance(dt);
    const snapshot = conveyor.snapshot();
    total += snapshot.dishes.filter((dish) => Math.abs(dish.x) <= snapshot.visibleHalfWidth).length;
    samples += 1;
  }
  return total / samples;
}

test('solo and rush steady-state density stays in the intended ranges', () => {
  for (const difficulty of [1, 2, 3]) {
    const conveyor = createConveyor({ difficulty, foods: FOODS, rng: seededRng(30 + difficulty) });
    conveyor.advance(30);
    const average = averageVisible(conveyor);
    assert.ok(average >= 3 && average <= 4, `difficulty ${difficulty} solo average ${average}`);
  }

  for (const [difficulty, minimum, maximum] of [[2, 4.5, 5.5], [3, 6, 7]]) {
    const conveyor = createConveyor({ difficulty, foods: FOODS, rng: seededRng(40 + difficulty) });
    conveyor.advance(12);
    assert.equal(conveyor.startRush(), true);
    conveyor.advance(30);
    const average = averageVisible(conveyor);
    assert.ok(average >= minimum && average <= maximum, `difficulty ${difficulty} rush average ${average}`);
  }
});

test('consecutive dishes keep the spacing floor across a rush switch', () => {
  for (const difficulty of [2, 3]) {
    const conveyor = createConveyor({ difficulty, foods: FOODS, rng: seededRng(50 + difficulty) });
    for (let step = 0; step < 500; step += 1) {
      if (step === 73) assert.equal(conveyor.startRush(), true);
      conveyor.advance(0.1);
      const positions = conveyor.snapshot().dishes.map((dish) => dish.x).sort((left, right) => left - right);
      for (let index = 1; index < positions.length; index += 1) {
        assert.ok(positions[index] - positions[index - 1] >= MIN_DISH_SPACING - 1e-9);
      }
    }
  }
});

test('rush speed stays secondary and startRush is one-shot', () => {
  const easy = createConveyor({ difficulty: 1, foods: FOODS, rng: seededRng(61) });
  assert.equal(easy.startRush(), false);
  assert.equal(easy.snapshot().mode, 'solo');

  for (const difficulty of [2, 3]) {
    const conveyor = createConveyor({ difficulty, foods: FOODS, rng: seededRng(60 + difficulty) });
    const soloSpeed = conveyor.snapshot().speed;
    assert.equal(conveyor.startRush(), true);
    assert.equal(conveyor.snapshot().mode, 'rush');
    assert.ok(conveyor.snapshot().speed <= soloSpeed * 1.15);
    assert.equal(conveyor.startRush(), false);
  }
});

test('rush timing does not change the shuffled food sequence', () => {
  const solo = createConveyor({ difficulty: 3, foods: FOODS, rng: seededRng(70) });
  const rushed = createConveyor({ difficulty: 3, foods: FOODS, rng: seededRng(70) });
  const soloFoods = entries(solo, 60).map((event) => event.dish.food);
  rushed.advance(7.3);
  assert.equal(rushed.startRush(), true);
  const rushedFoods = [];
  for (const dish of rushed.snapshot().dishes) rushedFoods.push(dish.food);
  while (rushedFoods.length < 60) {
    for (const event of rushed.advance(0.1)) {
      if (event.type === 'enter') rushedFoods.push(event.dish.food);
    }
  }
  assert.deepEqual(rushedFoods.slice(0, 60), soloFoods);
});

test('rush pulls the next entry forward without an entry gap', () => {
  for (const difficulty of [2, 3]) {
    const conveyor = createConveyor({ difficulty, foods: FOODS, rng: seededRng(80 + difficulty) });
    let lastEntryTime = null;
    while (lastEntryTime === null) {
      if (conveyor.advance(0.05).some((event) => event.type === 'enter')) lastEntryTime = conveyor.snapshot().serviceTime;
    }
    conveyor.advance(1.1);
    assert.equal(conveyor.startRush(), true);
    let nextEntryTime = null;
    while (nextEntryTime === null) {
      if (conveyor.advance(0.05).some((event) => event.type === 'enter')) nextEntryTime = conveyor.snapshot().serviceTime;
    }
    assert.ok(nextEntryTime - lastEntryTime <= CONVEYOR_CONFIG[difficulty].entryInterval + 0.051);
    assert.ok(entries(conveyor, 3).length === 3);
  }
});

test('snapshot reports effective solo overrides and rush state', () => {
  const conveyor = createConveyor({ difficulty: 2, foods: FOODS, speed: 2, entryInterval: 0.1 });
  assert.equal(conveyor.snapshot().entryInterval, MIN_DISH_SPACING / 2);
  assert.equal(conveyor.snapshot().mode, 'solo');
  assert.equal(conveyor.startRush(), true);
  assert.equal(conveyor.snapshot().entryInterval, 2.4);
  assert.equal(conveyor.snapshot().mode, 'rush');
});

test('Round 3 keeps Round 2 speed and only densifies the stream', () => {
  for (const difficulty of [2, 3]) {
    const { roundTwo, roundThree } = CONVEYOR_CONFIG[difficulty];
    assert.equal(roundThree.speed, roundTwo.speed, `level ${difficulty} changed speed for Round 3`);
    assert.ok(
      roundThree.entryInterval <= roundTwo.entryInterval,
      `level ${difficulty} thinned the Round 3 stream`,
    );
    assert.ok(
      roundThree.entryInterval >= MIN_DISH_SPACING / roundThree.speed - 1e-9,
      `level ${difficulty} Round 3 would bunch dishes closer than MIN_DISH_SPACING`,
    );
  }
});

test('startRoundThree switches once and keeps the dishes already on the belt', () => {
  const conveyor = createConveyor({ difficulty: 2, foods: FOODS, rng: seededRng(77) });
  conveyor.advance(30);
  const before = conveyor.snapshot();
  assert.equal(before.mode, 'solo');

  assert.equal(conveyor.startRoundThree(), true);
  const after = conveyor.snapshot();
  assert.equal(after.mode, 'roundThree');
  assert.deepEqual(after.dishes, before.dishes, 'the belt kept its dishes across the switch');
  assert.equal(after.speed, CONVEYOR_CONFIG[2].roundThree.speed);
  assert.equal(conveyor.startRoundThree(), false, 'the switch is one-shot');
});

test('Round 3 never runs at Round 2 mode: the two switches are distinct', () => {
  const conveyor = createConveyor({ difficulty: 3, foods: FOODS, rng: seededRng(83) });
  conveyor.advance(20);
  conveyor.startRoundTwo();
  assert.equal(conveyor.snapshot().mode, 'roundTwo');
  assert.equal(conveyor.startRoundThree(), true);
  assert.equal(conveyor.snapshot().mode, 'roundThree');
  assert.equal(conveyor.snapshot().entryInterval, CONVEYOR_CONFIG[3].roundThree.entryInterval);
});

test('level 1 has no Round 3 belt, so the switch is inert', () => {
  const conveyor = createConveyor({ difficulty: 1, foods: FOODS, rng: seededRng(91) });
  conveyor.advance(10);
  assert.equal(conveyor.startRoundThree(), false);
  assert.equal(conveyor.snapshot().mode, 'solo');
});
