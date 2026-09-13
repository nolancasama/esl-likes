import test from 'node:test';
import assert from 'node:assert/strict';

import { createDrinkDirector } from './director.js';

function seededRng(seed = 0x5eed1234) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function makeSimulation({ level = 2, total = level + 4, windows = level, rng = seededRng() } = {}) {
  const director = createDrinkDirector({ level, total, windows, rng });
  const state = {
    active: [],
    queued: [],
    done: 0,
    time: 0,
    events: [],
    maxWindows: 0,
    sawBusyQueue: false,
    busyQueueArrivalPhases: new Set(),
  };

  function view(focusReleasedAgo = Infinity) {
    return {
      windowsInUse: state.active.length,
      queuedCount: state.queued.length,
      customersRemaining: total - state.done,
      focusReleasedAgo,
    };
  }

  function promote() {
    while (state.active.length < director.windows && state.queued.length > 0) {
      state.active.push(state.queued.shift());
    }
  }

  function step(dt = 0.1, focusReleasedAgo = Infinity) {
    state.time += dt;
    const events = director.advance(dt, view(focusReleasedAgo));
    for (const event of events) {
      state.events.push({ ...event, at: state.time });
      if (event.type === 'arrive') state.queued.push(event.customer);
    }
    promote();
    state.maxWindows = Math.max(state.maxWindows, state.active.length);
    state.sawBusyQueue ||= state.active.length === director.windows && state.queued.length > 0;
    if (state.active.length === director.windows && state.queued.length > 0) {
      for (const event of events) {
        if (event.type === 'arrive') state.busyQueueArrivalPhases.add(event.phase);
      }
    }
    return events;
  }

  function resolveOne() {
    if (state.active.length === 0) return false;
    state.active.shift();
    state.done += 1;
    promote();
    return true;
  }

  return { director, state, step, resolveOne, view };
}

for (const [level, total, windows] of [[1, 5, 1], [2, 6, 2], [3, 7, 3]]) {
  test(`level ${level} respects its ${total}-customer shift and resolves`, () => {
    const sim = makeSimulation({ level, total, windows });
    let complete = false;

    for (let frame = 0; frame < 3000 && !complete; frame += 1) {
      const events = sim.step(0.1);
      if (sim.state.active.length > 0 && frame % 18 === 0) sim.resolveOne();
      complete ||= events.some((event) => event.type === 'complete');
    }

    // The completion event observes progress from the view on the next tick.
    if (!complete) complete = sim.step(0.1).some((event) => event.type === 'complete');
    assert.equal(sim.director.handedOut, total);
    assert.equal(sim.state.done, total);
    assert.equal(complete, true);
    assert.deepEqual(sim.director.progress, { done: total, total });
  });
}

test('advance(0) emits nothing and freezes phase and arrivals', () => {
  const director = createDrinkDirector({ level: 3, total: 7, windows: 3, rng: () => 0 });
  const view = { windowsInUse: 0, queuedCount: 0, customersRemaining: 7, focusReleasedAgo: Infinity };

  for (let frame = 0; frame < 100; frame += 1) assert.deepEqual(director.advance(0, view), []);
  assert.equal(director.handedOut, 0);
  assert.equal(director.phase, 'warmup');
});

test('no arrival is emitted inside the post-focus hold', () => {
  const director = createDrinkDirector({ level: 3, total: 7, windows: 3, rng: () => 0 });
  const view = { windowsInUse: 0, queuedCount: 0, customersRemaining: 7, focusReleasedAgo: 0 };

  for (const ago of [0, 0.2, 0.4, 0.79]) {
    view.focusReleasedAgo = ago;
    assert.equal(director.advance(0.25, view).some((event) => event.type === 'arrive'), false);
  }

  view.focusReleasedAgo = 0.8;
  assert.equal(director.advance(0.01, view).some((event) => event.type === 'arrive'), true);
});

test('phases progress in warm-up, main, rush order', () => {
  const sim = makeSimulation({ level: 3, total: 7, windows: 3 });
  const phases = [sim.director.phase];

  for (let frame = 0; frame < 500 && !sim.state.events.some((event) =>
    event.type === 'phase' && event.phase === 'rush'); frame += 1) {
    sim.step(0.1);
  }
  for (const event of sim.state.events) {
    if (event.type === 'phase') phases.push(event.phase);
  }

  assert.deepEqual(phases, ['warmup', 'main', 'rush']);
});

test('rush arrival gaps are materially shorter than the main-phase gap', () => {
  const sim = makeSimulation({ level: 3, total: 7, windows: 3, rng: seededRng(1234) });

  for (let frame = 0; frame < 600 && sim.director.handedOut < 7; frame += 1) sim.step(0.05);
  const arrivals = sim.state.events.filter((event) => event.type === 'arrive');
  const mainArrival = arrivals.findIndex((event) => event.phase === 'main');
  const mainGap = arrivals[mainArrival].at - arrivals[mainArrival - 1].at;
  const rushArrivals = arrivals.filter((event) => event.phase === 'rush');
  const rushGaps = rushArrivals.slice(1).map((event, index) => event.at - rushArrivals[index].at);
  const averageRushGap = rushGaps.reduce((sum, gap) => sum + gap, 0) / rushGaps.length;

  assert.ok(rushGaps.length >= 1, 'expected multiple arrivals during rush');
  assert.ok(averageRushGap <= 1.05, `rush averaged ${averageRushGap.toFixed(2)}s`);
  assert.ok(mainGap >= averageRushGap * 1.5, `main ${mainGap.toFixed(2)}s vs rush ${averageRushGap.toFixed(2)}s`);
});

for (const level of [2, 3]) {
  test(`level ${level} usually keeps a queued customer behind busy windows`, () => {
    const sim = makeSimulation({ level, total: level + 4, windows: level, rng: seededRng(level) });
    for (let frame = 0; frame < 500 && sim.director.handedOut < level + 4; frame += 1) sim.step(0.1);

    assert.equal(sim.state.sawBusyQueue, true);
    assert.deepEqual([...sim.state.busyQueueArrivalPhases], ['main', 'rush']);
  });
}

test('Easy never uses more than one window', () => {
  const sim = makeSimulation({ level: 1, total: 5, windows: 3, rng: seededRng() });
  for (let frame = 0; frame < 1500 && sim.director.handedOut < 5; frame += 1) {
    sim.step(0.1);
    if (sim.state.active.length > 0 && frame % 20 === 0) sim.resolveOne();
  }

  assert.equal(sim.director.windows, 1);
  assert.ok(sim.state.maxWindows <= 1, `Easy reached ${sim.state.maxWindows} windows`);
  assert.equal(sim.state.queued.length, 0);
});
