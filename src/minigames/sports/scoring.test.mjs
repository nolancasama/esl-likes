import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SPORTS,
  pickSport,
  scoreSession,
  shuffleZones,
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

function record(outcome, replayed = false) {
  return { outcome, replayed };
}

test('all first-try joins with no replays earn three stars', () => {
  const result = scoreSession(Array.from({ length: 6 }, () => record('first')));

  assert.equal(result.earned, result.maximum);
  assert.equal(result.firstTryShare, 1);
  assert.equal(result.ratio, 1);
  assert.equal(result.stars, 3);
});

test('all first-try joins still earn three stars when every answer was replayed', () => {
  const result = scoreSession(Array.from(
    { length: 6 },
    () => record('first', true),
  ));

  assert.equal(result.ratio, 5 / 6);
  assert.equal(result.stars, 3);
});

test('seeded touring reaches three stars in under one percent of sessions', () => {
  const rng = seededRng(0x51a7c0de);
  const sessionCount = 10_000;
  const followersPerStatisticalSession = 32;
  let threeStarSessions = 0;

  for (let session = 0; session < sessionCount; session += 1) {
    const records = [];

    for (let follower = 0; follower < followersPerStatisticalSession; follower += 1) {
      const wanted = pickSport(rng);
      const touringOrder = shuffleZones(rng);
      records.push(record(touringOrder[0] === wanted ? 'first' : 'later'));
    }

    if (scoreSession(records).stars === 3) threeStarSessions += 1;
  }

  assert.ok(
    threeStarSessions / sessionCount < 0.01,
    `${threeStarSessions} of ${sessionCount} touring sessions earned three stars`,
  );
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
  assert.ok(result.ratio >= 0.4);
  assert.notEqual(result.stars, 3);
});

test('later joins earn part credit and retain the memory bonus', () => {
  const remembered = scoreSession([record('later')]);
  const replayed = scoreSession([record('later', true)]);

  assert.equal(remembered.earned, 3);
  assert.equal(replayed.earned, 2);
  assert.equal(remembered.stars, 2);
  assert.equal(replayed.stars, 1);
});

test('several hundred seeded sport draws cover all four sports', () => {
  const rng = seededRng(0x12345678);
  const drawn = new Set();

  for (let draw = 0; draw < 400; draw += 1) drawn.add(pickSport(rng));

  assert.deepEqual([...drawn].sort(), [...SPORTS].sort());
});

test('zone shuffle returns a permutation without changing the sport list', () => {
  const shuffled = shuffleZones(seededRng(0xcafebabe));

  assert.deepEqual([...shuffled].sort(), [...SPORTS].sort());
  assert.notDeepEqual(shuffled, SPORTS);
  assert.deepEqual(SPORTS, [
    'soccer',
    'basketball',
    'baseball',
    'volleyball',
  ]);
});
