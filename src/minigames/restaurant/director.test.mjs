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

function makeSimulation({ level = 2, tables = 4, total = 7, rng = seededRng() } = {}) {
  const director = createRestaurantDirector({ level, tables, total, rng });
  const state = {
    tables: Array.from({ length: tables }, () => ({ occupied: false, customer: null })),
    customers: [],
    done: 0,
    events: [],
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
      } else if (event.type === 'ready') {
        const customer = state.customers.find((entry) => entry.id === event.customer);
        if (customer) customer.state = 'ready';
      }
    }
  }

  function step(dt = 0.1) {
    for (const customer of state.customers) {
      if (customer.state === 'preparing') customer.prepRemaining -= dt;
    }

    const events = director.advance(dt, view());
    apply(events);

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
    const observedCustomers = new Set(sim.state.customers
      .filter((customer) => !['delivered', 'left'].includes(customer.state))
      .map((customer) => customer.id));
    const events = sim.step(0.1);
    for (const id of observedCustomers) sim.resolve(id);
    sawComplete ||= events.some((event) => event.type === 'complete');
  }

  assert.equal(sim.director.handedOut, 5);
  assert.equal(sim.state.customers.length, 5);
  assert.equal(sim.state.done, 5);
  assert.equal(sawComplete, true);
  assert.deepEqual(sim.director.progress, { done: 5, total: 5 });
});

test('Challenge defaults to eleven total customers while earlier level defaults stay unchanged', () => {
  assert.deepEqual(createRestaurantDirector({ level: 1 }).progress, { done: 0, total: 5 });
  assert.deepEqual(createRestaurantDirector({ level: 2 }).progress, { done: 0, total: 5 });
  assert.deepEqual(createRestaurantDirector({ level: 3 }).progress, { done: 0, total: 11 });
});

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

test('seat and ready events wait through the post-focus hold', () => {
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
      ['seat', 'ready'].includes(event.type));
    assert.deepEqual(discrete, []);
  }

  view.focusReleasedAgo = 0.8;
  assert.ok(director.advance(0.01, view).some((event) => event.type === 'seat'));
});

test('the rush idle guard only pulls seating forward', () => {
  const sim = makeSimulation({ level: 2, tables: 4, total: 7, rng: () => 0.999 });
  while (sim.director.phase === 'warmup') sim.step(0.1);

  for (const customer of sim.state.customers) sim.resolve(customer.id);
  const eventTypes = [];
  for (let frame = 0; frame < 11; frame += 1) {
    eventTypes.push(...sim.step(0.1).map((event) => event.type));
  }

  assert.ok(eventTypes.includes('seat'));
  assert.equal(eventTypes.includes('raiseHand'), false);
});

test('a full shift emits no raiseHand events and still seats, phases, and completes', () => {
  const sim = makeSimulation({ level: 3, tables: 5, total: 11, rng: seededRng(42) });
  let completed = false;

  for (let frame = 0; frame < 2000 && !completed; frame += 1) {
    const observedCustomers = new Set(sim.state.customers
      .filter((customer) => !['delivered', 'left'].includes(customer.state))
      .map((customer) => customer.id));
    const events = sim.step(0.1);
    if (sim.director.phase !== 'warmup') {
      for (const id of observedCustomers) sim.resolve(id);
    }
    completed ||= events.some((event) => event.type === 'complete');
  }

  assert.equal(sim.state.events.some((event) => event.type === 'raiseHand'), false);
  assert.equal(sim.state.events.some((event) => event.type === 'seat'), true);
  assert.equal(sim.state.events.some((event) => event.type === 'phase' && event.phase === 'rush'), true);
  assert.equal(sim.state.events.some((event) => event.type === 'phase' && event.phase === 'finalPush'), true);
  assert.equal(completed, true);
  assert.deepEqual(sim.director.progress, { done: 11, total: 11 });
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
