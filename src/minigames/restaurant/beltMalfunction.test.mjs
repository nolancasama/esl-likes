import test from 'node:test';
import assert from 'node:assert/strict';

import { BELT_MALFUNCTION, createBeltMalfunction } from './beltMalfunction.js';
import { createConveyor } from './conveyor.js';

const FOODS = ['curry', 'pizza', 'hamburger', 'noodles', 'sushi'];

function seededRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = ((state * 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/** Runs the cycle at a fixed step and records every phase it passes through. */
function runCycle(belt, seconds, dt = 0.05) {
  const timeline = [];
  let time = 0;
  while (time < seconds) {
    for (const event of belt.advance(dt)) timeline.push({ at: time + dt, phase: event.phase });
    time += dt;
  }
  return timeline;
}

/** Measured durations of each completed phase run, in order. */
function phaseDurations(timeline, startPhase) {
  const spans = [];
  for (let index = 0; index < timeline.length - 1; index += 1) {
    if (timeline[index].phase !== startPhase) continue;
    spans.push(timeline[index + 1].at - timeline[index].at);
  }
  return spans;
}

test('a disabled belt never leaves running, never stops and emits nothing', () => {
  const belt = createBeltMalfunction({ enabled: false, rng: () => { throw new Error('rng used'); } });
  const timeline = runCycle(belt, 120);
  assert.deepEqual(timeline, []);
  assert.equal(belt.phase, 'running');
  assert.equal(belt.beltMoving, true);
  assert.equal(belt.stopped, false);
  assert.equal(belt.warningActive, false);
  assert.equal(belt.stopCount, 0);
});

test('malfunction only occurs when enabled: Rounds 1 and 2 pass enabled false', () => {
  const off = createBeltMalfunction({ enabled: false, rng: seededRng(3) });
  const on = createBeltMalfunction({ enabled: true, rng: seededRng(3) });
  runCycle(off, 200);
  runCycle(on, 200);
  assert.equal(off.stopCount, 0);
  assert.ok(on.stopCount > 0, 'an enabled belt stops within 200 s');
});

test('the cycle is strictly running -> warning -> stopped: a warning always precedes a stop', () => {
  const belt = createBeltMalfunction({ enabled: true, rng: seededRng(11) });
  const timeline = runCycle(belt, 400);
  assert.ok(timeline.length > 12, 'several cycles observed');
  const expected = ['warning', 'stopped', 'running'];
  timeline.forEach((entry, index) => {
    assert.equal(entry.phase, expected[index % 3], `transition ${index} out of order`);
  });
});

test('stop duration stays inside the configured range', () => {
  const belt = createBeltMalfunction({ enabled: true, rng: seededRng(23) });
  const timeline = runCycle(belt, 600, 0.02);
  const stops = phaseDurations(timeline, 'stopped');
  assert.ok(stops.length >= 5, 'several stoppages measured');
  for (const duration of stops) {
    assert.ok(duration >= BELT_MALFUNCTION.stopMin - 0.03, `stop ${duration} under the minimum`);
    assert.ok(duration <= BELT_MALFUNCTION.stopMax + 0.03, `stop ${duration} over the maximum`);
  }
});

test('a minimum run time separates stoppages, so stop/start spam is impossible', () => {
  const belt = createBeltMalfunction({ enabled: true, rng: seededRng(31) });
  const timeline = runCycle(belt, 600, 0.02);
  // From the restart to the next stop is a full running phase plus its warning.
  const gaps = [];
  for (let index = 0; index < timeline.length; index += 1) {
    if (timeline[index].phase !== 'running') continue;
    const nextStop = timeline.slice(index + 1).find((entry) => entry.phase === 'stopped');
    if (nextStop) gaps.push(nextStop.at - timeline[index].at);
  }
  assert.ok(gaps.length >= 4, 'several gaps measured');
  const floor = BELT_MALFUNCTION.runMin + BELT_MALFUNCTION.warningMin;
  for (const gap of gaps) assert.ok(gap >= floor - 0.05, `gap ${gap} shorter than ${floor}`);
});

test('the first stoppage does not land on the round opening', () => {
  for (let seed = 1; seed <= 40; seed += 1) {
    const belt = createBeltMalfunction({ enabled: true, rng: seededRng(seed) });
    const timeline = runCycle(belt, 60, 0.05);
    const firstWarning = timeline.find((entry) => entry.phase === 'warning');
    assert.ok(firstWarning, `seed ${seed} produced no warning inside 60 s`);
    assert.ok(
      firstWarning.at >= BELT_MALFUNCTION.firstRunMin - 0.05,
      `seed ${seed} warned at ${firstWarning.at}`,
    );
  }
});

test('run lengths vary within bounds rather than being perfectly predictable', () => {
  const belt = createBeltMalfunction({ enabled: true, rng: seededRng(47) });
  const timeline = runCycle(belt, 900, 0.02);
  const runs = phaseDurations(timeline, 'running');
  assert.ok(runs.length >= 5, 'several run phases measured');
  for (const duration of runs) {
    assert.ok(duration >= BELT_MALFUNCTION.runMin - 0.03, `run ${duration} under the minimum`);
    assert.ok(duration <= BELT_MALFUNCTION.runMax + 0.03, `run ${duration} over the maximum`);
  }
  assert.ok(new Set(runs.map((value) => value.toFixed(2))).size > 1, 'run lengths vary');
});

test('a single large dt crosses several boundaries in order', () => {
  const belt = createBeltMalfunction({ enabled: true, rng: seededRng(5) });
  const events = belt.advance(200);
  assert.ok(events.length >= 6, 'many transitions in one step');
  const phases = events.map((event) => event.phase);
  const expected = ['warning', 'stopped', 'running'];
  phases.forEach((phase, index) => assert.equal(phase, expected[index % 3]));
});

test('invalid or zero dt makes no progress and samples no randomness', () => {
  let samples = 0;
  const rng = seededRng(9);
  const belt = createBeltMalfunction({ enabled: true, rng: () => { samples += 1; return rng(); } });
  const afterConstruction = samples;
  assert.deepEqual(belt.advance(0), []);
  assert.deepEqual(belt.advance(-5), []);
  assert.deepEqual(belt.advance(Number.NaN), []);
  assert.equal(samples, afterConstruction);
  assert.equal(belt.elapsed, 0);
});

test('beltMoving is the only question the conveyor caller needs', () => {
  const belt = createBeltMalfunction({ enabled: true, rng: seededRng(13) });
  runCycle(belt, 400, 0.02);
  // Whatever phase the sweep ended on, the two agree.
  assert.equal(belt.beltMoving, belt.phase !== 'stopped');
  assert.equal(belt.stopped, belt.phase === 'stopped');
});

// The stop contract, exercised against the real conveyor: the scene withholds
// the clock rather than telling the belt to freeze.
test('withholding the clock freezes dishes and resumes from the exact positions', () => {
  const conveyor = createConveyor({ difficulty: 2, foods: FOODS, rng: seededRng(17) });
  conveyor.advance(20);
  const before = conveyor.snapshot();

  // Three seconds of "stopped": the belt clock simply does not advance.
  for (let step = 0; step < 60; step += 1) conveyor.advance(0);
  const during = conveyor.snapshot();
  assert.deepEqual(during.dishes, before.dishes, 'dishes did not move while stopped');
  assert.equal(during.serviceTime, before.serviceTime, 'the belt clock did not advance');
  assert.equal(during.beltTravel, before.beltTravel, 'no belt travel accumulated');

  conveyor.advance(0.1);
  const after = conveyor.snapshot();
  const travelled = before.beltTravel === after.beltTravel;
  assert.equal(travelled, false, 'the belt resumed moving');
  assert.equal(after.dishes.length >= before.dishes.length - 1, true, 'no dishes vanished in the stop');
});

test('a stoppage does not duplicate dishes, lose them or break spacing on restart', () => {
  const conveyor = createConveyor({ difficulty: 3, foods: FOODS, rng: seededRng(29) });
  const belt = createBeltMalfunction({ enabled: true, rng: seededRng(29) });
  const seen = new Set();
  let exits = 0;

  for (let step = 0; step < 6000; step += 1) {
    belt.advance(0.05);
    // The scene's rule, verbatim: no clock for the belt while it is stopped.
    const events = conveyor.advance(belt.beltMoving ? 0.05 : 0);
    for (const event of events) {
      if (event.type === 'enter') {
        assert.equal(seen.has(event.dish.id), false, `dish ${event.dish.id} entered twice`);
        seen.add(event.dish.id);
      } else if (event.type === 'exit') exits += 1;
    }
    const { dishes } = conveyor.snapshot();
    const ids = dishes.map((dish) => dish.id);
    assert.equal(new Set(ids).size, ids.length, 'a dish id appeared twice on the belt');
    const ordered = [...dishes].sort((a, b) => b.x - a.x);
    for (let index = 1; index < ordered.length; index += 1) {
      const gap = ordered[index - 1].x - ordered[index].x;
      assert.ok(gap > 1.0, `dishes bunched to ${gap.toFixed(3)} after a stoppage`);
    }
  }

  assert.ok(belt.stopCount >= 10, 'the run covered many stoppages');
  assert.ok(exits > 0, 'dishes still completed the belt');
  assert.ok(seen.size > exits, 'dishes remain on the belt at the end');
});

test('a stopped belt holds its entry schedule instead of releasing a burst', () => {
  const steady = createConveyor({ difficulty: 2, foods: FOODS, rng: seededRng(61) });
  const stalled = createConveyor({ difficulty: 2, foods: FOODS, rng: seededRng(61) });

  for (let step = 0; step < 400; step += 1) steady.advance(0.05);
  for (let step = 0; step < 400; step += 1) stalled.advance(0.05);
  for (let step = 0; step < 60; step += 1) stalled.advance(0);
  for (let step = 0; step < 40; step += 1) {
    steady.advance(0.05);
    stalled.advance(0.05);
  }

  // The stalled belt is exactly three seconds of travel behind, not catching up.
  assert.equal(
    Number(stalled.snapshot().beltTravel.toFixed(6)),
    Number(steady.snapshot().beltTravel.toFixed(6)),
    'the stalled belt travelled the same distance for the same clock',
  );
  assert.deepEqual(
    stalled.snapshot().dishes.map((dish) => dish.food),
    steady.snapshot().dishes.map((dish) => dish.food),
    'the food sequence is unchanged by a stoppage',
  );
});
