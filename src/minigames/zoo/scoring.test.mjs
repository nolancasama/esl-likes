import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ANIMALS,
  measureFraming,
  pickAnimal,
  scoreSession,
} from './scoring.js';

function seededRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function record(outcome, framing = 1, replayed = false) {
  return { outcome, framing, replayed };
}

test('all first-try photos with good framing and no replays earn three stars', () => {
  const result = scoreSession(Array.from({ length: 6 }, () => record('first')));

  assert.equal(result.earned, result.maximum);
  assert.equal(result.firstTryShare, 1);
  assert.equal(result.ratio, 1);
  assert.equal(result.stars, 3);
});

test('all first-try photos still earn three stars when every answer was replayed', () => {
  const result = scoreSession(Array.from(
    { length: 6 },
    () => record('first', 1, true),
  ));

  assert.equal(result.ratio, 7 / 8);
  assert.equal(result.stars, 3);
});

test('a first-try share below one half can never earn three stars', () => {
  const result = scoreSession([
    record('first'),
    record('first'),
    record('later'),
    record('later'),
    record('later'),
  ]);

  assert.equal(result.firstTryShare, 0.4);
  assert.ok(result.ratio >= 0.75);
  assert.equal(result.stars, 2);
});

test('poor framing scores lower than good framing but never below one star', () => {
  const good = scoreSession([record('later', 1, true)]);
  const poor = scoreSession([record('later', 0, true)]);

  assert.ok(poor.earned < good.earned);
  assert.ok(poor.ratio < good.ratio);
  assert.equal(poor.stars, 1);
});

test('seeded show-every-animal-in-turn sessions reach three stars under one percent', () => {
  const rng = seededRng(0x2005a11);
  const sessionCount = 10_000;
  const requestsPerStatisticalSession = 32;
  const touringOrder = [...ANIMALS];
  let threeStarSessions = 0;

  for (let session = 0; session < sessionCount; session += 1) {
    const records = [];

    for (let request = 0; request < requestsPerStatisticalSession; request += 1) {
      const wanted = pickAnimal(rng);
      records.push(record(touringOrder[0] === wanted ? 'first' : 'later'));
    }

    if (scoreSession(records).stars === 3) threeStarSessions += 1;
  }

  assert.ok(
    threeStarSessions / sessionCount < 0.01,
    `${threeStarSessions} of ${sessionCount} touring sessions earned three stars`,
  );
});

test('several hundred seeded animal draws cover all six animals', () => {
  const rng = seededRng(0x12345678);
  const drawn = new Set();

  for (let draw = 0; draw < 600; draw += 1) drawn.add(pickAnimal(rng));

  assert.deepEqual([...drawn].sort(), [...ANIMALS].sort());
});

test('framing is symmetric and peaks for a centred, well-sized subject', () => {
  const centred = measureFraming({ x: 0.5, y: 0.5, width: 0.45, height: 0.45 });
  const left = measureFraming({ x: 0.3, y: 0.5, width: 0.45, height: 0.45 });
  const right = measureFraming({ x: 0.7, y: 0.5, width: 0.45, height: 0.45 });
  const small = measureFraming({ x: 0.5, y: 0.5, width: 0.08, height: 0.08 });

  assert.equal(centred, 1);
  assert.ok(centred > left);
  assert.equal(left, right);
  assert.ok(centred > small);
});
