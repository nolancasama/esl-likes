import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ANIMALS,
  MIN_APPARENT_SIZE,
  SHUTTER_ACTIVATE_THRESHOLD,
  SHUTTER_HOLD_THRESHOLD,
  SHUTTER_GRACE_MS,
  isFramingEligible,
  isShutterReady,
  measureApparentSize,
  measureFraming,
  photoSubjectForPress,
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

test('several hundred seeded animal draws cover all eight animals', () => {
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

test('tall and wide narrow subjects activate, while tiny subjects and slivers fail', () => {
  for (const [width, height] of [[0.04, 0.18], [0.18, 0.04]]) {
    const frame = { x: 0.5, y: 0.5, width, height };
    assert.ok(measureApparentSize(width, height) >= MIN_APPARENT_SIZE);
    assert.ok(isFramingEligible(frame));
    assert.ok(isShutterReady(measureFraming(frame)));
  }
  for (const [width, height] of [[0.025, 0.025], [0.004, 0.9], [0.9, 0.004], [0, 0.8]]) {
    const frame = { x: 0.5, y: 0.5, width, height };
    assert.equal(isFramingEligible(frame), false);
    assert.equal(isShutterReady(measureFraming(frame)), false);
  }
});

test('square framing preserves the old score and off-centre framing scores lower', () => {
  for (const side of [0.02, 0.08, 0.12, 0.25, 0.45]) {
    for (const [x, y] of [[0.5, 0.5], [0.3, 0.4], [0.8, 0.7]]) {
      const oldScore = Math.max(0, 1 - (Math.hypot(x - 0.5, y - 0.5) / Math.SQRT1_2) ** 1.5)
        * Math.min(1, side / 0.32);
      assert.ok(Math.abs(measureFraming({ x, y, width: side, height: side }) - oldScore) < 1e-12);
    }
  }
  const frame = { x: 0.5, y: 0.5, width: 0.04, height: 0.18 };
  assert.ok(measureFraming({ ...frame, x: 0.75 }) < measureFraming(frame));
});

test('large mostly-offscreen, behind-camera, and heavily occluded subjects remain ineligible', () => {
  const frame = { x: 0.5, y: 0.5, width: 0.8, height: 0.8 };
  assert.equal(isFramingEligible({ ...frame, x: 0.96 }), false);
  assert.equal(isFramingEligible({ ...frame, y: 0.03 }), false);
  assert.equal(isFramingEligible(frame, { depth: 1.1 }), false);
  assert.equal(isFramingEligible(frame, { depth: -1.1 }), false);
  // Five occlusion samples still require at least three clear rays.
  assert.equal(isFramingEligible(frame, { visibleFraction: 2 / 5 }), false);
  assert.equal(isFramingEligible(frame, { visibleFraction: 3 / 5 }), true);
  assert.equal(isFramingEligible(frame, { visibleFraction: 0 }), false);
});

test('shutter hysteresis holds readiness between activation and hold thresholds', () => {
  const between = (SHUTTER_HOLD_THRESHOLD + SHUTTER_ACTIVATE_THRESHOLD) / 2;
  assert.equal(isShutterReady(between), false);
  assert.equal(isShutterReady(between, true), true);
  assert.equal(isShutterReady(SHUTTER_ACTIVATE_THRESHOLD), true);
  assert.equal(isShutterReady(SHUTTER_HOLD_THRESHOLD - 0.001, true), false);
  assert.equal(isShutterReady(NaN, true), false);
});

test('a press just after readiness drops keeps its last good subject for exactly the grace window', () => {
  const lastGoodSubject = { species: ANIMALS[0] };
  const framedSubject = { species: ANIMALS[1] };
  const state = { shutterReady: false, framedSubject, lastGoodSubject, lastGoodAt: 1000 };
  assert.equal(photoSubjectForPress({ ...state, now: 1001 }), lastGoodSubject);
  assert.equal(photoSubjectForPress({ ...state, now: 1000 + SHUTTER_GRACE_MS }), lastGoodSubject);
  assert.equal(photoSubjectForPress({ ...state, now: 1001 + SHUTTER_GRACE_MS }), null);
  assert.equal(photoSubjectForPress({ ...state, shutterReady: true, now: 2000 }), framedSubject);
  assert.equal(photoSubjectForPress({ ...state, lastGoodSubject: null, now: 1001 }), null);
});
