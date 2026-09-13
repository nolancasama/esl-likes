import test from 'node:test';
import assert from 'node:assert/strict';

import { createSpeechFocus } from './speechFocus.js';

test('service time runs at full scale while focus is at rest', () => {
  const focus = createSpeechFocus();

  assert.equal(focus.scale, 1);
  assert.equal(focus.active, false);
  assert.equal(focus.serviceDelta(0.25), 0.25);
});

test('focus reaches the default floor and freezes service time', () => {
  const focus = createSpeechFocus();

  focus.begin('question prompt');
  assert.equal(focus.active, true);
  focus.update(0.12);

  assert.equal(focus.scale, 0);
  assert.equal(focus.serviceDelta(2), 0);
  assert.equal(focus.active, true);
});

test('end ramps back to exactly one without overshooting', () => {
  const focus = createSpeechFocus();
  focus.begin();
  focus.update(1);
  focus.end();

  focus.update(0.1);
  assert.ok(focus.scale > 0 && focus.scale < 1);
  assert.equal(focus.active, true);

  focus.update(10);
  assert.equal(focus.scale, 1);
  assert.equal(focus.active, false);

  focus.update(10);
  assert.equal(focus.scale, 1);
});

test('duplicate begin calls are idempotent and one end cannot leave focus stuck', () => {
  const focus = createSpeechFocus();

  focus.begin('prompt');
  focus.update(0.06);
  const halfwayScale = focus.scale;
  focus.begin('retry');
  focus.update(0.06);

  assert.ok(halfwayScale > 0 && halfwayScale < 1);
  assert.equal(focus.scale, 0);

  focus.end();
  focus.update(1);
  assert.equal(focus.scale, 1);
  assert.equal(focus.active, false);
});

test('cancel immediately restores normal service time from focus or release', () => {
  const focus = createSpeechFocus();
  focus.begin();
  focus.update(1);
  focus.end();
  focus.update(0.1);

  focus.cancel();

  assert.equal(focus.scale, 1);
  assert.equal(focus.active, false);
  assert.equal(focus.serviceDelta(0.5), 0.5);
});

test('a configured non-zero floor nearly pauses service time', () => {
  const focus = createSpeechFocus({ floor: 0.08 });
  focus.begin();
  focus.update(1);

  assert.equal(focus.scale, 0.08);
  assert.equal(focus.serviceDelta(2), 0.16);
});

test('update safely ignores invalid deltas and clamps very large updates', () => {
  const focus = createSpeechFocus();
  focus.begin();

  for (const dt of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    focus.update(dt);
    assert.equal(Number.isNaN(focus.scale), false);
    assert.ok(focus.scale >= 0 && focus.scale <= 1);
  }

  focus.update(Number.MAX_VALUE);
  assert.equal(focus.scale, 0);
  assert.ok(focus.scale >= 0 && focus.scale <= 1);
});

test('many small resting updates do not drift scale away from one', () => {
  const focus = createSpeechFocus();

  for (let frame = 0; frame < 100_000; frame += 1) focus.update(1 / 60);

  assert.equal(focus.scale, 1);
  assert.equal(focus.active, false);
});

test('re-entering during release returns to focus without getting stuck off', () => {
  const focus = createSpeechFocus();
  focus.begin();
  focus.update(1);
  focus.end();
  focus.update(0.1);

  focus.begin('retry');
  focus.update(1);
  assert.equal(focus.scale, 0);
  assert.equal(focus.active, true);

  focus.end();
  focus.update(1);
  assert.equal(focus.scale, 1);
  assert.equal(focus.active, false);
});
