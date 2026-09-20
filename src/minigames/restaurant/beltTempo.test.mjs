import test from 'node:test';
import assert from 'node:assert/strict';

import { BELT_TEMPO, createBeltTempo } from './beltTempo.js';
import { CONVEYOR_CONFIG, MIN_DISH_SPACING, createConveyor } from './conveyor.js';
import { RESTAURANT_LEVEL } from './rivalProgression.js';

const FOODS = ['curry', 'pizza', 'hamburger', 'ramen', 'sushi'];

function seededRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = ((state * 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/** Runs the cycle at a fixed step and records every mode it passes through. */
function runCycle(tempo, seconds, dt = 0.05) {
  const timeline = [];
  let time = 0;
  while (time < seconds) {
    for (const event of tempo.advance(dt)) timeline.push({ at: time + dt, mode: event.mode });
    time += dt;
  }
  return timeline;
}

/** Measured durations of each completed run of `mode`, in order. */
function modeDurations(timeline, mode) {
  const spans = [];
  for (let index = 0; index < timeline.length - 1; index += 1) {
    if (timeline[index].mode !== mode) continue;
    spans.push(timeline[index + 1].at - timeline[index].at);
  }
  return spans;
}

test('Rounds 1 and 2 never cycle: a disabled tempo stays at normal for ever', () => {
  const tempo = createBeltTempo({ enabled: false, rng: () => { throw new Error('rng used'); } });
  assert.deepEqual(runCycle(tempo, 180), []);
  assert.equal(tempo.mode, 'normal');
  assert.equal(tempo.fast, false);
  assert.equal(tempo.speedMultiplier, 1);
  assert.equal(tempo.fastCount, 0);
});

test('Round 3 begins in normal belt mode', () => {
  for (let seed = 1; seed <= 30; seed += 1) {
    const tempo = createBeltTempo({ enabled: true, rng: seededRng(seed) });
    assert.equal(tempo.mode, 'normal', `seed ${seed} opened in fast mode`);
    assert.equal(tempo.speedMultiplier, 1);
  }
});

test('the opening normal stretch is never cut short by a burst', () => {
  for (let seed = 1; seed <= 30; seed += 1) {
    const tempo = createBeltTempo({ enabled: true, rng: seededRng(seed) });
    const timeline = runCycle(tempo, 40, 0.05);
    const firstFast = timeline.find((entry) => entry.mode === 'fast');
    assert.ok(firstFast, `seed ${seed} produced no burst inside 40 s`);
    assert.ok(
      firstFast.at >= BELT_TEMPO.firstNormalMin - 0.05,
      `seed ${seed} burst at ${firstFast.at}`,
    );
  }
});

test('the cycle alternates normal and fast, repeatedly', () => {
  const tempo = createBeltTempo({ enabled: true, rng: seededRng(11) });
  const timeline = runCycle(tempo, 400);
  assert.ok(timeline.length > 10, 'several cycles observed');
  const expected = ['fast', 'normal'];
  timeline.forEach((entry, index) => {
    assert.equal(entry.mode, expected[index % 2], `transition ${index} out of order`);
  });
  assert.ok(tempo.fastCount >= 5, `only ${tempo.fastCount} bursts in 400 s`);
});

test('fast is twice normal speed, and no zero-speed state exists', () => {
  const tempo = createBeltTempo({ enabled: true, rng: seededRng(23) });
  assert.equal(tempo.fastMultiplier, 2.0);
  for (let step = 0; step < 4000; step += 1) {
    tempo.advance(0.05);
    const multiplier = tempo.speedMultiplier;
    assert.ok(multiplier > 0, 'the belt reached a zero-speed state');
    assert.ok(multiplier === 1 || multiplier === 2.0, `unexpected multiplier ${multiplier}`);
    assert.equal(multiplier === 2.0, tempo.fast);
  }
});

test('normal durations stay inside the configured bounds', () => {
  const tempo = createBeltTempo({ enabled: true, rng: seededRng(31) });
  const timeline = runCycle(tempo, 600, 0.02);
  const normals = modeDurations(timeline, 'normal');
  assert.ok(normals.length >= 5, 'several normal stretches measured');
  for (const span of normals) {
    assert.ok(span >= BELT_TEMPO.normalMin - 0.03, `normal ${span} under the minimum`);
    assert.ok(span <= BELT_TEMPO.normalMax + 0.03, `normal ${span} over the maximum`);
  }
  assert.ok(new Set(normals.map((v) => v.toFixed(2))).size > 1, 'durations vary');
});

test('fast durations stay inside the configured bounds', () => {
  const tempo = createBeltTempo({ enabled: true, rng: seededRng(37) });
  const timeline = runCycle(tempo, 600, 0.02);
  const fasts = modeDurations(timeline, 'fast');
  assert.ok(fasts.length >= 5, 'several bursts measured');
  for (const span of fasts) {
    assert.ok(span >= BELT_TEMPO.fastMin - 0.03, `fast ${span} under the minimum`);
    assert.ok(span <= BELT_TEMPO.fastMax + 0.03, `fast ${span} over the maximum`);
  }
});

test('a reasonable normal stretch always separates bursts: no flickering', () => {
  const tempo = createBeltTempo({ enabled: true, rng: seededRng(43) });
  const timeline = runCycle(tempo, 900, 0.02);
  const gaps = [];
  for (let index = 0; index < timeline.length; index += 1) {
    if (timeline[index].mode !== 'normal') continue;
    const nextFast = timeline.slice(index + 1).find((entry) => entry.mode === 'fast');
    if (nextFast) gaps.push(nextFast.at - timeline[index].at);
  }
  assert.ok(gaps.length >= 4, 'several gaps measured');
  for (const gap of gaps) {
    assert.ok(gap >= BELT_TEMPO.normalMin - 0.05, `only ${gap}s between bursts`);
  }
});

test('the same seed produces the same cycle', () => {
  const first = runCycle(createBeltTempo({ enabled: true, rng: seededRng(99) }), 300, 0.02);
  const second = runCycle(createBeltTempo({ enabled: true, rng: seededRng(99) }), 300, 0.02);
  assert.deepEqual(first, second);
});

test('invalid or zero dt makes no progress and samples no randomness', () => {
  let samples = 0;
  const rng = seededRng(7);
  const tempo = createBeltTempo({ enabled: true, rng: () => { samples += 1; return rng(); } });
  const afterConstruction = samples;
  assert.deepEqual(tempo.advance(0), []);
  assert.deepEqual(tempo.advance(-3), []);
  assert.deepEqual(tempo.advance(Number.NaN), []);
  assert.equal(samples, afterConstruction);
  assert.equal(tempo.elapsed, 0);
});

// --- the tempo applied to the real belt ----------------------------------

const ROUND_THREE_BELT = CONVEYOR_CONFIG[RESTAURANT_LEVEL].roundThree;

test('a burst accelerates the dishes already on the belt without moving them', () => {
  const conveyor = createConveyor({ difficulty: RESTAURANT_LEVEL, foods: FOODS, rng: seededRng(17) });
  conveyor.startRoundThree();
  conveyor.advance(20);
  const before = conveyor.snapshot();

  assert.equal(conveyor.setTempo(2), true);
  const atSwitch = conveyor.snapshot();
  assert.deepEqual(
    atSwitch.dishes.map((dish) => ({ id: dish.id, x: dish.x })),
    before.dishes.map((dish) => ({ id: dish.id, x: dish.x })),
    'dishes moved at the moment the tempo changed',
  );
  assert.equal(atSwitch.speed, ROUND_THREE_BELT.speed * 2);

  // One second of fast travel covers twice the normal distance.
  conveyor.advance(1);
  const travelled = conveyor.snapshot().beltTravel - atSwitch.beltTravel;
  assert.ok(
    Math.abs(travelled - (ROUND_THREE_BELT.speed * 2)) < 1e-6,
    `travelled ${travelled} in a fast second`,
  );
});

test('returning to normal leaves dishes exactly where they are', () => {
  const conveyor = createConveyor({ difficulty: RESTAURANT_LEVEL, foods: FOODS, rng: seededRng(29) });
  conveyor.startRoundThree();
  conveyor.advance(15);
  conveyor.setTempo(2);
  conveyor.advance(3);
  const before = conveyor.snapshot();

  assert.equal(conveyor.setTempo(1), true);
  const after = conveyor.snapshot();
  assert.deepEqual(
    after.dishes.map((dish) => ({ id: dish.id, x: dish.x })),
    before.dishes.map((dish) => ({ id: dish.id, x: dish.x })),
    'dishes were repositioned on the way back to normal',
  );
  assert.equal(after.speed, ROUND_THREE_BELT.speed);
  assert.equal(conveyor.setTempo(1), false, 'setting the same tempo twice is inert');
});

test('a fast burst keeps the stream dense rather than starving the belt', () => {
  // Preserving the *spatial* gap is the point: keeping the time interval would
  // spread dishes twice as far apart exactly when the belt should look frantic.
  const normalGap = ROUND_THREE_BELT.speed * ROUND_THREE_BELT.entryInterval;
  const conveyor = createConveyor({ difficulty: RESTAURANT_LEVEL, foods: FOODS, rng: seededRng(41) });
  conveyor.startRoundThree();
  conveyor.advance(10);
  conveyor.setTempo(2);
  const fast = conveyor.snapshot();
  const fastGap = fast.speed * fast.entryInterval;
  assert.ok(
    Math.abs(fastGap - normalGap) < 1e-6,
    `fast gap ${fastGap} differs from the normal ${normalGap}`,
  );
  assert.ok(fastGap >= MIN_DISH_SPACING, `fast gap ${fastGap} under MIN_DISH_SPACING`);
});

test('bursts never bunch, duplicate or lose dishes across a whole round', () => {
  const conveyor = createConveyor({ difficulty: RESTAURANT_LEVEL, foods: FOODS, rng: seededRng(53) });
  const tempo = createBeltTempo({ enabled: true, rng: seededRng(53) });
  conveyor.startRoundThree();
  const seen = new Set();
  let exits = 0;

  for (let step = 0; step < 6000; step += 1) {
    // Exactly what the scene does.
    for (const _event of tempo.advance(0.05)) conveyor.setTempo(tempo.speedMultiplier);
    for (const event of conveyor.advance(0.05)) {
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
      assert.ok(gap >= MIN_DISH_SPACING - 1e-6, `dishes bunched to ${gap.toFixed(3)}`);
    }
  }

  assert.ok(tempo.fastCount >= 20, `only ${tempo.fastCount} bursts across the run`);
  assert.ok(exits > 0, 'dishes still completed the belt');
  assert.ok(seen.size > exits, 'dishes remain on the belt at the end');
});

test('the belt keeps moving through every burst: it never stalls', () => {
  const conveyor = createConveyor({ difficulty: RESTAURANT_LEVEL, foods: FOODS, rng: seededRng(61) });
  const tempo = createBeltTempo({ enabled: true, rng: seededRng(61) });
  conveyor.startRoundThree();
  let previous = conveyor.snapshot().beltTravel;
  for (let step = 0; step < 3000; step += 1) {
    for (const _event of tempo.advance(0.05)) conveyor.setTempo(tempo.speedMultiplier);
    conveyor.advance(0.05);
    const travel = conveyor.snapshot().beltTravel;
    assert.ok(travel > previous, `belt did not advance at step ${step}`);
    previous = travel;
  }
});
