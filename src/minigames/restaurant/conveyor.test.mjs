import test from 'node:test';
import assert from 'node:assert/strict';

import { CONVEYOR_CONFIG, createConveyor } from './conveyor.js';

const FOODS = ['curry', 'pizza', 'hamburger', 'noodles', 'sushi'];

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
  for (const [difficulty, interval] of [[1, 4], [2, 3.2], [3, 2.6]]) {
    const conveyor = createConveyor({ difficulty, foods: FOODS, rng: seededRng(difficulty) });
    const stream = entries(conveyor, 4, undefined, 0.1);
    assert.deepEqual(stream.map((event) => event.dish.id), [1, 2, 3, 4]);
    assert.ok(Math.abs(conveyor.snapshot().serviceTime - (0.5 + (3 * interval))) < 0.11);
  }
});

test('large advances match small advances, including mid-step entry travel', () => {
  const large = createConveyor({ difficulty: 2, foods: FOODS, rng: seededRng(15) });
  const small = createConveyor({ difficulty: 2, foods: FOODS, rng: seededRng(15) });
  const largeEvents = large.advance(15);
  const smallEvents = [];
  for (let index = 0; index < 150; index += 1) smallEvents.push(...small.advance(0.1));
  assert.deepEqual(largeEvents, smallEvents);
  assert.deepEqual(large.snapshot(), small.snapshot());
  const fifth = large.snapshot().dishes.find((dish) => dish.id === 5);
  assert.equal(fifth.x, 7.2 - (1.05 * 1.7));
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

test('config defaults remain frozen', () => {
  assert.equal(Object.isFrozen(CONVEYOR_CONFIG), true);
  assert.equal(Object.isFrozen(CONVEYOR_CONFIG[1]), true);
});
