import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceTapIntent, canShowPhoto, createTapIntent } from './tapIntent.js';

const visitor = (asked = false) => ({ state: 'waiting', asked, served: false });
const state = (extra = {}) => ({
  active: true, phase: 'playing', viewfinderOpen: false, guideOpen: false,
  sequenceRunning: false, visitorPresent: true, validSpeechTarget: true,
  carriedPhoto: null, reached: true, stopped: true, ...extra,
});
const tap = (value, context = state(), type = 'visitor') => (
  createTapIntent({ type, value }, context)
);

test('an unasked visitor tap records talk, and waits for both arrival and a stop', () => {
  const intent = tap(visitor());
  assert.equal(intent.action, 'talk');
  for (const extra of [{ reached: false }, { stopped: false }, { reached: false, stopped: false }]) {
    assert.deepEqual(advanceTapIntent(intent, state(extra)), { pending: intent, arrived: null });
  }
  const result = advanceTapIntent(intent, state());
  assert.equal(result.arrived.action, 'talk');
  assert.equal(result.pending, null);
  assert.equal(advanceTapIntent(result.pending, state()).arrived, null, 'a tap cannot fire twice');
});

test('photo delivery outranks speech and preserves wrong-photo refusal', () => {
  const target = { ...visitor(true), wanted: 'horse' };
  const photo = { animal: 'chicken' };
  const context = state({ carriedPhoto: photo });
  assert.equal(canShowPhoto(target, photo), true);
  assert.equal(tap(target, context).action, 'show-photo');
  assert.equal(advanceTapIntent(tap(target, context), context).arrived.action, 'show-photo');
  assert.equal(tap(visitor(), context).action, 'talk', 'an unasked visitor cannot accept delivery yet');
});

test('asked visitors without photos, animals, ground and invalid speech targets only approach', () => {
  assert.equal(tap(visitor(true)).action, 'approach');
  assert.equal(tap(visitor(), state({ validSpeechTarget: false })).action, 'approach');
  for (const type of ['animal', 'floor']) {
    assert.equal(tap(visitor(), state(), type).action, 'approach');
    assert.equal(tap(visitor(true), state({ carriedPhoto: {} }), type).action, 'approach');
  }
  const intent = tap(visitor(true));
  intent.value.asked = false;
  assert.equal(advanceTapIntent(intent, state()).arrived.action, 'approach', 'never infer a new action');
});

test('manual movement cancels walking and the pending action', () => {
  const intent = tap(visitor());
  const result = advanceTapIntent(intent, state({ manualMovement: true }));
  assert.deepEqual(result, { pending: null, arrived: null });
  assert.equal(advanceTapIntent(result.pending, state()).arrived, null);
});

test('overlays, sequences and every non-playing phase cannot queue or retain intents', () => {
  const intent = tap(visitor());
  for (const extra of [
    { active: false }, { viewfinderOpen: true }, { guideOpen: true }, { sequenceRunning: true },
    ...['inactive', 'animal-guide', 'opening-viewfinder', 'viewfinder', 'closing-viewfinder',
      'answering', 'replaying', 'reacting-wrong', 'reacting-correct', 'round-end',
      'turnaround', 'finishing', 'editing'].map((phase) => ({ phase })),
  ]) {
    assert.equal(tap(visitor(), state(extra)), null, JSON.stringify(extra));
    assert.deepEqual(advanceTapIntent(intent, state(extra)), { pending: null, arrived: null });
  }
});

test('arrival drops stale talk and photo intents without selecting a replacement action', () => {
  for (const extra of [{ visitorPresent: false }, { validSpeechTarget: false }]) {
    assert.equal(advanceTapIntent(tap(visitor()), state(extra)).arrived, null);
  }
  for (const change of [{ asked: true }, { state: 'leaving' }, { served: true }]) {
    const target = visitor();
    const intent = tap(target);
    Object.assign(target, change);
    assert.deepEqual(advanceTapIntent(intent, state()), { pending: null, arrived: null });
  }
  const photo = { animal: 'cat' };
  const intent = tap(visitor(true), state({ carriedPhoto: photo }));
  for (const extra of [
    { carriedPhoto: null }, { carriedPhoto: { animal: 'cat' } }, { visitorPresent: false },
  ]) {
    assert.equal(advanceTapIntent(intent, state({ carriedPhoto: photo, ...extra })).arrived, null);
  }
  intent.value.state = 'served';
  assert.equal(advanceTapIntent(intent, state({ carriedPhoto: photo })).arrived, null);
});

test('a new tap replaces the entire intent, including its action and photo', () => {
  let pending = tap(visitor());
  const point = { x: 8, z: 12 };
  pending = createTapIntent({ type: 'floor', value: point }, state());
  assert.equal(pending.action, 'approach');
  assert.equal(pending.value, point);
  assert.equal(pending.photo, null);
  assert.equal(advanceTapIntent(pending, state()).arrived.action, 'approach');
});
