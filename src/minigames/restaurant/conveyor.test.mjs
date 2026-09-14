import test from 'node:test';
import assert from 'node:assert/strict';

import { CONVEYOR_CONFIG, createConveyor } from './conveyor.js';

function seededRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = ((state * 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function due(...foods) {
  return { dueOrders: foods.map((food, customer) => ({ customer, food })), carriedFood: null };
}

function runUntil(conveyor, view, predicate, limit = 30, dt = 0.01) {
  const events = [];
  while (conveyor.snapshot().serviceTime < limit && !predicate(events)) {
    events.push(...conveyor.advance(dt, view));
  }
  return events;
}

test('config defaults are deeply frozen and belt travel accumulates while empty', () => {
  assert.equal(Object.isFrozen(CONVEYOR_CONFIG), true);
  assert.equal(Object.isFrozen(CONVEYOR_CONFIG[1]), true);
  assert.equal(Object.isFrozen(CONVEYOR_CONFIG[1].reentryDelay), true);

  const conveyor = createConveyor({ difficulty: 2, foods: [] });
  assert.deepEqual(conveyor.advance(2, due()), []);
  const state = conveyor.snapshot();
  assert.equal(state.beltTravel, 2.1);
  assert.equal(state.serviceTime, 2);
  assert.deepEqual(state.dishes, []);
});

test('non-positive and non-finite dt freezes all state and consumes no rng', () => {
  let samples = 0;
  const conveyor = createConveyor({
    difficulty: 3,
    foods: ['pizza'],
    rng: () => { samples += 1; return 0.5; },
  });
  const before = conveyor.snapshot();
  for (const dt of [0, -1, NaN, Infinity]) assert.deepEqual(conveyor.advance(dt, due('pizza')), []);
  assert.deepEqual(conveyor.snapshot(), before);
  assert.equal(samples, 0);
});

test('new demand uses the literal 0.4 second lower entry-delay bound', () => {
  const conveyor = createConveyor({ difficulty: 3, foods: [], rng: () => 0 });
  conveyor.advance(0.01, due('pizza'));
  assert.equal(conveyor.snapshot().pending[0].dueAt, 0.4);
});

test('simultaneous due units meet the bounded entry guarantee at every difficulty', () => {
  for (const difficulty of [1, 2, 3]) {
    for (const count of [1, 3, 4]) {
      const conveyor = createConveyor({ difficulty, foods: [], rng: seededRng(100 + count) });
      const view = due(...Array.from({ length: count }, (_, index) => `food-${index}`));
      const enteredAt = [];
      while (enteredAt.length < count) {
        const events = conveyor.advance(0.01, view);
        for (const event of events) {
          if (event.type === 'enter') enteredAt.push(conveyor.snapshot().serviceTime);
        }
      }
      const config = CONVEYOR_CONFIG[difficulty];
      enteredAt.forEach((time, index) => {
        const bound = config.maxEntryDelay + (index * config.minSpacing / config.speed);
        assert.ok(time <= bound + 0.011, `difficulty ${difficulty}, unit ${index}: ${time} <= ${bound}`);
      });
    }
  }
});

test('simultaneous foods can enter in different shuffled orders across seeds', () => {
  const orders = due('curry', 'pizza', 'sushi', 'noodles');
  const ordersSeen = new Set();
  for (let seed = 1; seed <= 8; seed += 1) {
    const conveyor = createConveyor({ difficulty: 3, foods: [], rng: seededRng(seed) });
    const events = runUntil(
      conveyor,
      orders,
      (all) => all.filter((event) => event.type === 'enter').length === 4,
    );
    ordersSeen.add(events.filter((event) => event.type === 'enter').map((event) => event.dish.food).join(','));
  }
  assert.ok(ordersSeen.size > 1);
});

test('multiple dishes coexist and consecutive entries retain minimum spacing', () => {
  const conveyor = createConveyor({ difficulty: 3, foods: [], rng: seededRng(9) });
  const view = due('curry', 'pizza', 'sushi', 'noodles');
  const entryTimes = [];
  while (entryTimes.length < 4) {
    for (const event of conveyor.advance(0.005, view)) {
      if (event.type === 'enter') entryTimes.push(conveyor.snapshot().serviceTime);
    }
  }
  assert.equal(conveyor.snapshot().dishes.length >= 2, true);
  for (let index = 1; index < entryTimes.length; index += 1) {
    const separation = (entryTimes[index] - entryTimes[index - 1]) * CONVEYOR_CONFIG[3].speed;
    assert.ok(separation >= CONVEYOR_CONFIG[3].minSpacing - 0.006);
  }
});

test('demand counts repeated foods exactly and carried food supplies one unit', () => {
  const repeated = createConveyor({ difficulty: 1, foods: [], rng: seededRng(3) });
  const view = due('pizza', 'pizza');
  const events = runUntil(
    repeated,
    view,
    (all) => all.filter((event) => event.type === 'enter').length === 2,
  );
  assert.equal(events.filter((event) => event.type === 'enter' && event.dish.food === 'pizza').length, 2);
  assert.equal(repeated.advance(1, view).filter((event) => event.type === 'enter').length, 0);

  const carried = createConveyor({ difficulty: 1, foods: [], rng: seededRng(4) });
  assert.deepEqual(carried.advance(10, { ...due('sushi'), carriedFood: 'sushi' }), []);
  assert.deepEqual(carried.snapshot().pending, []);
});

test('a missed due dish exits and re-enters, while a no-longer-due dish stays gone', () => {
  const view = due('curry');
  const conveyor = createConveyor({ difficulty: 1, foods: [], rng: seededRng(11) });
  let exitAt = null;
  let reenteredAt = null;
  let firstId = null;
  while (reenteredAt === null) {
    const events = conveyor.advance(0.01, view);
    for (const event of events) {
      if (event.type === 'enter' && firstId === null) firstId = event.dish.id;
      else if (event.type === 'enter') reenteredAt = conveyor.snapshot().serviceTime;
      if (event.type === 'exit' && event.dish.id === firstId) exitAt = conveyor.snapshot().serviceTime;
    }
  }
  assert.notEqual(exitAt, null);
  assert.ok(reenteredAt - exitAt <= 2.5 + (2.2 / 0.9) + 0.011);

  const resolved = createConveyor({ difficulty: 1, foods: [], rng: seededRng(12) });
  const first = runUntil(resolved, view, (all) => all.some((event) => event.type === 'enter'));
  assert.equal(first.some((event) => event.type === 'enter'), true);
  const noDemand = due();
  const later = runUntil(resolved, noDemand, (all) => all.some((event) => event.type === 'exit'), 30);
  assert.equal(later.some((event) => event.type === 'exit'), true);
  assert.deepEqual(resolved.advance(5, noDemand).filter((event) => event.type === 'enter'), []);
  assert.deepEqual(resolved.snapshot().pending, []);
});

test('cancelled demand removes pending units but never removes an existing belt dish', () => {
  const conveyor = createConveyor({ difficulty: 1, foods: [], rng: seededRng(14) });
  const two = due('pizza', 'pizza');
  runUntil(conveyor, two, () => conveyor.snapshot().dishes.length === 1);
  assert.equal(conveyor.snapshot().pending.length, 1);
  conveyor.advance(0.01, due());
  assert.equal(conveyor.snapshot().pending.length, 0);
  assert.equal(conveyor.snapshot().dishes.length, 1);
});

test('filler excludes due and carried foods, respects cap, and does not exist on Easy', () => {
  const normal = createConveyor({
    difficulty: 2,
    foods: ['curry', 'pizza', 'sushi'],
    rng: seededRng(20),
    fillerMeanInterval: 0.05,
    minSpacing: 0.1,
    visibleHalfWidth: 7.2,
    visibleCap: 2,
  });
  const view = { dueOrders: [{ customer: 1, food: 'curry' }], carriedFood: 'pizza' };
  normal.advance(5, view);
  const fillers = normal.snapshot().dishes.filter((dish) => dish.filler);
  assert.ok(fillers.length <= 2);
  assert.equal(fillers.every((dish) => dish.food === 'sushi'), true);
  assert.equal(normal.snapshot().dishes.some((dish) => !dish.filler && dish.food === 'curry'), true);

  const easy = createConveyor({ difficulty: 1, foods: ['sushi'], rng: seededRng(21) });
  assert.deepEqual(easy.advance(30, due()), []);
  assert.deepEqual(easy.snapshot().dishes, []);
});

test('filler entry never takes the spacing slot from an already pending due entry', () => {
  const conveyor = createConveyor({
    difficulty: 2,
    foods: ['sushi'],
    rng: seededRng(30),
    fillerMeanInterval: 0.01,
    minSpacing: 0.2,
  });
  const events = conveyor.advance(4, due('curry'));
  const dueEntry = events.find((event) => event.type === 'enter' && !event.dish.filler);
  assert.ok(dueEntry);
  assert.equal(dueEntry.dish.food, 'curry');
});

test('take, nearestPickable, and predictX use the visible pickup bounds', () => {
  const conveyor = createConveyor({ difficulty: 1, foods: [], rng: seededRng(40) });
  const view = due('pizza', 'sushi');
  const events = runUntil(
    conveyor,
    view,
    (all) => all.filter((event) => event.type === 'enter').length === 2,
  );
  const ids = events.filter((event) => event.type === 'enter').map((event) => event.dish.id);
  assert.equal(conveyor.take(ids[1]), null, 'the newest dish is still outside the right pickup bound');
  conveyor.advance(1, view);

  const state = conveyor.snapshot();
  const first = state.dishes.find((dish) => dish.id === ids[0]);
  const second = state.dishes.find((dish) => dish.id === ids[1]);
  assert.equal(conveyor.predictX(second.id, 2), second.x - 1.8);
  assert.equal(conveyor.nearestPickable(first.x + 0.05, 0.2).id, first.id);
  assert.equal(conveyor.nearestPickable(100, 0.2), null);
  assert.deepEqual(conveyor.take(first.id), first);
  assert.equal(conveyor.predictX(first.id, 1), null);
});
