import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DRINKS,
  pickDrink,
  scoreSession,
  shuffleStations,
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

function record(outcome, overrides = {}) {
  return {
    outcome,
    patienceLeft: 0.5,
    replayed: false,
    ...overrides,
  };
}

test('all first-try serves with moderate patience and no replays earn three stars', () => {
  const result = scoreSession(Array.from({ length: 8 }, () => record('first')));

  assert.equal(result.firstTryShare, 1);
  assert.ok(result.ratio >= 0.75);
  assert.equal(result.stars, 3);
});

test('all first-try serves still earn three stars when every answer was replayed', () => {
  const result = scoreSession(Array.from(
    { length: 8 },
    () => record('first', { replayed: true }),
  ));

  assert.ok(result.ratio >= 0.75);
  assert.equal(result.stars, 3);
});

test('seeded random guessing reaches three stars in under one percent of sessions', () => {
  const rng = seededRng(0x51a7c0de);
  const sessionCount = 10_000;
  let threeStarSessions = 0;

  for (let session = 0; session < sessionCount; session += 1) {
    const records = [];
    for (let customer = 0; customer < 6; customer += 1) {
      const wanted = pickDrink(rng);
      let attempts = 1;
      while (pickDrink(rng) !== wanted) attempts += 1;
      records.push(record(attempts === 1 ? 'first' : 'later'));
    }
    if (scoreSession(records).stars === 3) threeStarSessions += 1;
  }

  assert.ok(
    threeStarSessions / sessionCount < 0.01,
    `${threeStarSessions} of ${sessionCount} guessing sessions earned three stars`,
  );
});

test('a first-try share below one half can never earn three stars', () => {
  const records = [
    record('first', { patienceLeft: 1 }),
    record('first', { patienceLeft: 1 }),
    record('later', { patienceLeft: 1 }),
    record('later', { patienceLeft: 1 }),
    record('later', { patienceLeft: 1 }),
  ];
  const result = scoreSession(records);

  assert.equal(result.firstTryShare, 0.4);
  assert.ok(result.ratio >= 0.75);
  assert.equal(result.stars, 2);
});

test('all customers leaving earns one star', () => {
  const result = scoreSession(Array.from({ length: 8 }, () => record('left')));

  assert.equal(result.earned, 0);
  assert.equal(result.stars, 1);
});

test('streak bonus counts only consecutive first-try serves', () => {
  const result = scoreSession([
    record('first', { patienceLeft: 0, replayed: true }),
    record('first', { patienceLeft: 0, replayed: true }),
    record('later', { patienceLeft: 0, replayed: true }),
    record('first', { patienceLeft: 0, replayed: true }),
    record('first', { patienceLeft: 0, replayed: true }),
    record('first', { patienceLeft: 0, replayed: true }),
    record('left'),
    record('first', { patienceLeft: 0, replayed: true }),
  ]);

  assert.equal(result.streakBonus, 1.5);
  assert.equal(result.earned, 33.5);
});

test('several hundred seeded drink draws cover all six drinks', () => {
  const rng = seededRng(0x12345678);
  const drawn = new Set();

  for (let draw = 0; draw < 600; draw += 1) drawn.add(pickDrink(rng));

  assert.deepEqual([...drawn].sort(), [...DRINKS].sort());
});

test('station shuffle returns a permutation without changing the drink list', () => {
  const shuffled = shuffleStations(seededRng(0xcafebabe));

  assert.deepEqual([...shuffled].sort(), [...DRINKS].sort());
  assert.notDeepEqual(shuffled, DRINKS);
  assert.deepEqual(DRINKS, [
    'water',
    'milk',
    'orange juice',
    'apple juice',
    'tea',
    'soda',
  ]);
});
