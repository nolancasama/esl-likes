import test from 'node:test';
import assert from 'node:assert/strict';

import { createRestaurantDirector } from './director.js';

function seededRng(seed = 0x5eed1234) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function sequenceRng(values = [0.5]) {
  let index = 0;
  return () => {
    const value = values[index % values.length];
    index += 1;
    return value;
  };
}

function makeSimulation({ level = 2, tables = 4, total = 7, rng = seededRng() } = {}) {
  const director = createRestaurantDirector({ level, tables, total, rng });
  const state = {
    tables: Array.from({ length: tables }, () => ({ occupied: false, customer: null })),
    customers: [],
    done: 0,
    events: [],
    maxDemand: 0,
    emptyRushSeconds: 0,
    longestEmptyRush: 0,
  };

  function view() {
    const liveOrders = state.customers.filter((customer) =>
      ['preparing', 'ready'].includes(customer.state)).length;
    return {
      tables: state.tables,
      customers: state.customers,
      liveOrders,
      focusReleasedAgo: Infinity,
      progress: { done: state.done },
    };
  }

  function apply(events) {
    for (const event of events) {
      state.events.push(event);
      if (event.type === 'seat') {
        state.tables[event.table] = { occupied: true, customer: event.customer };
        state.customers.push({
          id: event.customer,
          table: event.table,
          food: event.food,
          state: 'settling',
          prepRemaining: null,
        });
      } else if (event.type === 'raiseHand') {
        const customer = state.customers.find((entry) => entry.id === event.customer);
        if (customer) customer.state = 'orderCue';
      } else if (event.type === 'ready') {
        const customer = state.customers.find((entry) => entry.id === event.customer);
        if (customer) customer.state = 'ready';
      }
    }
  }

  function step(dt = 0.1, { attentive = false } = {}) {
    if (attentive) {
      const cue = state.customers.find((customer) => customer.state === 'orderCue');
      if (cue) {
        cue.state = 'preparing';
        cue.prepRemaining = 1.5;
      }
    }

    for (const customer of state.customers) {
      if (customer.state === 'preparing') customer.prepRemaining -= dt;
    }

    const events = director.advance(dt, view());
    apply(events);

    const demands = state.customers.filter((customer) =>
      ['orderCue', 'preparing', 'ready'].includes(customer.state)).length;
    state.maxDemand = Math.max(state.maxDemand, demands);
    if (director.phase === 'rush' && demands === 0) {
      state.emptyRushSeconds += dt;
      state.longestEmptyRush = Math.max(state.longestEmptyRush, state.emptyRushSeconds);
    } else {
      state.emptyRushSeconds = 0;
    }
    return events;
  }

  function resolve(id) {
    const customer = state.customers.find((entry) => entry.id === id);
    if (!customer || ['delivered', 'left'].includes(customer.state)) return;
    customer.state = 'delivered';
    state.tables[customer.table] = { occupied: false, customer: null };
    state.done += 1;
  }

  return { director, state, step, resolve, view, apply };
}

test('a freed table receives a new customer after a replacement delay', () => {
  const sim = makeSimulation({ level: 1, tables: 3, total: 5 });
  while (sim.state.customers.length < 3) sim.step(0.1);

  const first = sim.state.customers[0];
  const firstTable = first.table;
  sim.resolve(first.id);

  let replacement = null;
  for (let frame = 0; frame < 60 && !replacement; frame += 1) {
    replacement = sim.step(0.1).find((event) => event.type === 'seat');
  }

  assert.ok(replacement, 'replacement should be seated after a short delay');
  assert.equal(replacement.table, firstTable);
  assert.notEqual(replacement.customer, first.id);
});

test('each seat picks food independently and repeats are possible', () => {
  // Initial timing samples and food samples share the injected stream. A
  // constant sample deliberately selects the same food for every occupant.
  const sim = makeSimulation({ level: 1, tables: 3, total: 5, rng: () => 0.25 });
  while (sim.state.customers.length < 3) sim.step(0.1);

  assert.deepEqual(sim.state.customers.map((customer) => customer.food), [
    'pizza',
    'pizza',
    'pizza',
  ]);
});

test('the director respects the total and completes only when all are resolved', () => {
  const sim = makeSimulation({ level: 1, tables: 3, total: 5 });
  let sawComplete = false;

  for (let frame = 0; frame < 1200 && !sawComplete; frame += 1) {
    const events = sim.step(0.1, { attentive: true });
    for (const customer of sim.state.customers) {
      if (customer.state === 'ready') sim.resolve(customer.id);
    }
    sawComplete ||= events.some((event) => event.type === 'complete');
  }

  assert.equal(sim.director.handedOut, 5);
  assert.equal(sim.state.customers.length, 5);
  assert.equal(sim.state.done, 5);
  assert.equal(sawComplete, true);
  assert.deepEqual(sim.director.progress, { done: 5, total: 5 });
});

test('Easy never exceeds one live order including raised hands', () => {
  const sim = makeSimulation({ level: 1, tables: 3, total: 5 });
  for (let frame = 0; frame < 600; frame += 1) {
    sim.step(0.1, { attentive: true });
    const ready = sim.state.customers.find((customer) => customer.state === 'ready');
    if (ready) sim.resolve(ready.id);
  }

  assert.equal(sim.director.liveOrderLimit, 1);
  assert.ok(sim.state.maxDemand <= 1, `Easy reached ${sim.state.maxDemand} demands`);
});

test('Challenge defaults to eleven total customers while earlier level defaults stay unchanged', () => {
  assert.deepEqual(createRestaurantDirector({ level: 1 }).progress, { done: 0, total: 5 });
  assert.deepEqual(createRestaurantDirector({ level: 2 }).progress, { done: 0, total: 5 });
  assert.deepEqual(createRestaurantDirector({ level: 3 }).progress, { done: 0, total: 11 });
});

test('rival-owned orders do not consume the player live-order limit', () => {
  const director = createRestaurantDirector({ level: 3, tables: 5, total: 11, rng: () => 0 });
  const view = {
    tables: Array.from({ length: 5 }, () => ({ occupied: true })),
    customers: [
      { id: 0, state: 'preparing', owner: 'player', prepRemaining: 5 },
      { id: 1, state: 'ready', owner: 'player' },
      { id: 2, state: 'orderCue', owner: null, reservedBy: 'player' },
      { id: 3, state: 'preparing', owner: 'rival', prepRemaining: 5 },
      { id: 4, state: 'settling', owner: null },
    ],
    liveOrders: 99,
    focusReleasedAgo: 0,
  };

  // Keep the due hand behind the existing post-focus event hold until rush;
  // warm-up intentionally caps all levels at two demands.
  for (let second = 0; second < 19; second += 1) director.advance(1, view);
  view.focusReleasedAgo = Infinity;
  const events = director.advance(0.01, view);
  assert.deepEqual(events.find((event) => event.type === 'raiseHand'), {
    type: 'raiseHand', customer: 4,
  });
});

test('player-owned eating and leaving customers do not consume the live-order limit', () => {
  const director = createRestaurantDirector({ level: 3, tables: 5, total: 11, rng: () => 0 });
  const view = {
    tables: Array.from({ length: 5 }, () => ({ occupied: true })),
    customers: [
      { id: 0, state: 'preparing', owner: 'player', prepRemaining: 5 },
      { id: 1, state: 'ready', owner: 'player' },
      { id: 2, state: 'orderCue', owner: null, reservedBy: 'player' },
      { id: 3, state: 'eating', owner: 'player' },
      { id: 4, state: 'leaving', owner: 'player' },
      { id: 5, state: 'settling', owner: null },
    ],
    liveOrders: 99,
    focusReleasedAgo: 0,
  };

  for (let second = 0; second < 19; second += 1) director.advance(1, view);
  view.focusReleasedAgo = Infinity;
  const events = director.advance(0.01, view);
  assert.deepEqual(events.find((event) => event.type === 'raiseHand'), {
    type: 'raiseHand', customer: 5,
  });
});

test('an available rival lets one hand rise above a saturated player limit', () => {
  const saturatedView = (rivalAvailable) => ({
    tables: Array.from({ length: 5 }, () => ({ occupied: true })),
    customers: [
      { id: 0, state: 'preparing', owner: 'player', prepRemaining: 50 },
      { id: 1, state: 'preparing', owner: 'player', prepRemaining: 50 },
      { id: 2, state: 'preparing', owner: 'player', prepRemaining: 50 },
      { id: 3, state: 'preparing', owner: 'player', prepRemaining: 50 },
      { id: 4, state: 'settling', owner: null },
    ],
    liveOrders: 4,
    focusReleasedAgo: 0,
    rivalAvailable,
  });
  const handAfterRush = (rivalAvailable) => {
    const director = createRestaurantDirector({ level: 3, tables: 5, total: 11, rng: () => 0 });
    const view = saturatedView(rivalAvailable);
    for (let second = 0; second < 19; second += 1) director.advance(1, view);
    view.focusReleasedAgo = Infinity;
    return director.advance(0.01, view).find((event) => event.type === 'raiseHand') ?? null;
  };

  assert.deepEqual(handAfterRush(true), { type: 'raiseHand', customer: 4 });
  assert.equal(handAfterRush(false), null);
});

for (const [level, tables, total, expected] of [[2, 4, 7, 3], [3, 5, 8, 4]]) {
  test(`level ${level} reaches its ${expected}-order overlap budget`, () => {
    const sim = makeSimulation({ level, tables, total, rng: sequenceRng([0.05, 0.2, 0.4, 0.6]) });
    for (let frame = 0; frame < 450 && sim.state.maxDemand < expected; frame += 1) {
      // Attentive means every raised hand is taken on the following frame. We
      // intentionally leave ready dishes waiting so overlap can be observed.
      sim.step(0.1, { attentive: true });
    }

    assert.equal(sim.director.liveOrderLimit, expected);
    assert.equal(sim.state.maxDemand, expected);
  });
}

test('ready events are spaced and never share an advance frame', () => {
  const director = createRestaurantDirector({ level: 3, tables: 5, total: 8, rng: () => 0.5 });
  const view = {
    tables: Array.from({ length: 5 }, () => ({ occupied: true })),
    customers: [
      { id: 0, state: 'preparing', prepRemaining: 0 },
      { id: 1, state: 'preparing', prepRemaining: -1 },
      { id: 2, state: 'preparing', prepRemaining: -2 },
    ],
    liveOrders: 3,
    focusReleasedAgo: Infinity,
  };

  const first = director.advance(1, view).filter((event) => event.type === 'ready');
  const tooSoon = director.advance(0.8, view).filter((event) => event.type === 'ready');
  const second = director.advance(0.11, view).filter((event) => event.type === 'ready');

  assert.equal(first.length, 1);
  assert.equal(tooSoon.length, 0);
  assert.equal(second.length, 1);
  assert.notEqual(first[0].customer, second[0].customer);
});

test('advance(0) freezes all scheduling', () => {
  const director = createRestaurantDirector({ level: 2, tables: 4, total: 7, rng: () => 0 });
  const view = {
    tables: Array.from({ length: 4 }, () => ({ occupied: false })),
    customers: [{ id: 0, state: 'preparing', prepRemaining: 0 }],
    liveOrders: 1,
    focusReleasedAgo: 0,
  };

  for (let frame = 0; frame < 100; frame += 1) assert.deepEqual(director.advance(0, view), []);
  assert.equal(director.handedOut, 0);
  assert.equal(director.phase, 'warmup');
});

test('seat, hand and ready events wait through the post-focus hold', () => {
  const director = createRestaurantDirector({ level: 2, tables: 4, total: 7, rng: () => 0 });
  const view = {
    tables: Array.from({ length: 4 }, () => ({ occupied: false })),
    customers: [{ id: 20, state: 'preparing', prepRemaining: 0 }],
    liveOrders: 1,
    focusReleasedAgo: 0,
  };

  for (const ago of [0, 0.2, 0.4, 0.79]) {
    view.focusReleasedAgo = ago;
    const discrete = director.advance(0.2, view).filter((event) =>
      ['seat', 'raiseHand', 'ready'].includes(event.type));
    assert.deepEqual(discrete, []);
  }

  view.focusReleasedAgo = 0.8;
  assert.ok(director.advance(0.01, view).some((event) => event.type === 'seat'));
});

test('due hands are emitted one per frame and are staggered in service time', () => {
  const director = createRestaurantDirector({ level: 3, tables: 5, total: 8, rng: () => 0 });
  const view = {
    tables: Array.from({ length: 5 }, () => ({ occupied: true })),
    customers: [0, 1, 2, 3].map((id) => ({ id, state: 'settling' })),
    liveOrders: 0,
    focusReleasedAgo: Infinity,
  };

  director.advance(1, view);
  const first = director.advance(1, view).filter((event) => event.type === 'raiseHand');
  const sameMoment = director.advance(0.001, view).filter((event) => event.type === 'raiseHand');
  const later = director.advance(0.32, view).filter((event) => event.type === 'raiseHand');

  assert.equal(first.length, 1);
  assert.equal(sameMoment.length, 0);
  assert.equal(later.length, 1);
});

test('the rush idle guard prevents a long empty stretch', () => {
  const sim = makeSimulation({ level: 2, tables: 4, total: 7, rng: () => 0.999 });
  while (sim.director.phase === 'warmup') sim.step(0.1);

  // Resolve anything accumulated in warm-up and let the director recover the
  // room. A demand must return well inside the ordinary 1-2.5 s settle range.
  for (const customer of sim.state.customers) sim.resolve(customer.id);
  for (let frame = 0; frame < 40; frame += 1) sim.step(0.1);

  assert.ok(sim.state.longestEmptyRush < 1.1, `empty rush lasted ${sim.state.longestEmptyRush}s`);
  assert.ok(sim.state.customers.some((customer) =>
    ['orderCue', 'preparing', 'ready'].includes(customer.state)));
});

test('phases progress from warm-up through rush to final push', () => {
  const sim = makeSimulation({ level: 1, tables: 3, total: 5 });
  const phases = [sim.director.phase];

  while (sim.director.phase === 'warmup') sim.step(0.25);
  phases.push(sim.director.phase);

  while (sim.director.handedOut < 5) {
    for (const customer of sim.state.customers) {
      if (!['delivered', 'left'].includes(customer.state)) sim.resolve(customer.id);
    }
    sim.step(0.25);
  }
  sim.step(0.01);
  phases.push(sim.director.phase);

  assert.deepEqual(phases, ['warmup', 'rush', 'finalPush']);
  assert.ok(sim.state.events.some((event) => event.type === 'phase' && event.phase === 'rush'));
  assert.ok(sim.state.events.some((event) => event.type === 'phase' && event.phase === 'finalPush'));
});
