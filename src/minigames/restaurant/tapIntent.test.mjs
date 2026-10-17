import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { customerTapIntent, resolveCustomerTapIntent } from './tapIntent.js';

const unasked = () => ({ state: 'seated', owner: null, reservation: null, food: 'curry' });
const order = () => ({ ...unasked(), state: 'awaiting', owner: 'player', refusalRemaining: 0 });
const stateFor = (customer, overrides = {}) => ({
  phase: 'service', customer, present: true, carried: null, talkTargetAllowed: true,
  ...overrides,
});
const arrival = { arrived: true, inRange: true, stopped: true };

test('tapping an empty-handed unasked customer captures Talk, without firing on the approach', () => {
  const state = stateFor(unasked());
  const intent = customerTapIntent(state);
  assert.equal(intent.type, 'customer');
  assert.equal(intent.action, 'talk');
  for (const readiness of [
    {}, { arrived: false, inRange: true, stopped: true },
    { arrived: true, inRange: false, stopped: true },
    { arrived: true, inRange: true, stopped: false },
  ]) {
    assert.deepEqual(resolveCustomerTapIntent(intent, { ...state, ...readiness }), { intent, action: null });
  }
  assert.deepEqual(resolveCustomerTapIntent(intent, { ...state, ...arrival }), { intent: null, action: 'talk' });
  assert.deepEqual(resolveCustomerTapIntent(null, { ...state, ...arrival }), { intent: null, action: null });
});

test('carrying never captures Talk, including an unasked customer or the wrong dish', () => {
  const carried = { food: 'sushi' };
  for (const customer of [unasked(), order()]) {
    const state = stateFor(customer, { carried });
    const intent = customerTapIntent(state);
    assert.equal(intent.action, 'approach');
    assert.equal(resolveCustomerTapIntent(intent, { ...state, ...arrival }).action, null);
  }
});

test('the correct carried dish captures delivery and fires through arrival only once', () => {
  const state = stateFor(order(), { carried: { food: 'curry' } });
  const intent = customerTapIntent(state);
  assert.equal(intent.action, 'deliver');
  assert.equal(resolveCustomerTapIntent(intent, { ...state, inRange: true }).action, null);
  const result = resolveCustomerTapIntent(intent, { ...state, ...arrival });
  assert.equal(result.action, 'deliver');
  assert.equal(resolveCustomerTapIntent(result.intent, { ...state, ...arrival }).action, null);
});

test('asked, rival-owned, reserved and onboarding-ineligible customers do not capture a question', () => {
  for (const state of [
    stateFor(order()),
    stateFor({ ...unasked(), owner: 'rival' }),
    stateFor({ ...unasked(), reservation: 'rival' }),
    stateFor(unasked(), { talkTargetAllowed: false }),
    stateFor(unasked(), { speechCooldown: true }),
  ]) assert.equal(customerTapIntent(state).action, 'approach');
});

test('delivery outranks another context action, which in turn outranks Talk', () => {
  assert.equal(customerTapIntent(stateFor(order(), {
    carried: { food: 'curry' }, otherAction: 'exchange', otherDishId: 12,
  })).action, 'deliver');
  const state = stateFor(unasked(), { otherAction: 'collect', otherDishId: 12 });
  const intent = customerTapIntent(state);
  assert.equal(intent.action, 'collect');
  assert.equal(resolveCustomerTapIntent(intent, { ...state, ...arrival }).action, 'collect');
  assert.equal(resolveCustomerTapIntent(intent, { ...state, ...arrival, otherDishId: 13 }).action, null);
});

test('manual movement drops a pending Talk intent', () => {
  const state = stateFor(unasked());
  assert.deepEqual(resolveCustomerTapIntent(customerTapIntent(state), {
    ...state, ...arrival, manualMovement: true,
  }), { intent: null, action: null });
});

test('all non-service phases and modal sequences refuse and clear intents', () => {
  const state = stateFor(unasked());
  const intent = customerTapIntent(state);
  for (const change of [
    ...['round-end', 'result-stage', 'round-transition', 'turnaround', 'finishing'].map((phase) => ({ phase })),
    { blocked: true },
  ]) {
    assert.equal(customerTapIntent({ ...state, ...change }), null);
    assert.deepEqual(resolveCustomerTapIntent(intent, { ...state, ...arrival, ...change }), { intent: null, action: null });
  }
});

test('arrival drops stale Talk when the customer leaves, is asked, or hands/context change', () => {
  const state = stateFor(unasked());
  const intent = customerTapIntent(state);
  for (const change of [
    { present: false }, { customer: { ...state.customer, state: 'left' } },
    { customer: { ...state.customer, state: 'awaiting', owner: 'player' } },
    { carried: { food: 'curry' } }, { talkTargetAllowed: false }, { speechCooldown: true },
  ]) assert.equal(resolveCustomerTapIntent(intent, { ...state, ...arrival, ...change }).action, null);
  state.customer.state = 'leaving';
  assert.equal(resolveCustomerTapIntent(intent, { ...state, ...arrival }).intent, null);
});

test('a stale delivery never becomes Talk, another delivery dish, or a different context action', () => {
  const state = stateFor(order(), { carried: { food: 'curry' } });
  const intent = customerTapIntent(state);
  for (const change of [
    { carried: null }, { carried: { food: 'curry' } }, { carried: { food: 'sushi' } },
    { phase: 'result-stage' }, { present: false },
  ]) assert.equal(resolveCustomerTapIntent(intent, { ...state, ...arrival, ...change }).action, null);
  state.customer.refusalRemaining = 1;
  assert.equal(resolveCustomerTapIntent(intent, { ...state, ...arrival }).intent, null);
});

const source = readFileSync(new URL('./index.js', import.meta.url), 'utf8');
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));

test('scene arrival consumes the captured action and activates the shared Talk button', () => {
  const movement = section('function updateMovement(', 'function moveCustomerToward(');
  assert.match(movement, /autoTarget = null;[\s\S]*resolveCustomerTapIntent/);
  assert.match(movement, /inRange: Boolean\(customerWithinRange\(arrived.value\)\)/);
  assert.match(movement, /stopped: true/);
  assert.match(movement, /action === 'deliver'\) deliver\(arrived.value\)/);
  assert.match(movement, /action === 'talk'[\s\S]*targetQuestion\(arrived.value\)[\s\S]*hud.talkButton.click\(\)/);
  assert.doesNotMatch(movement, /getUserMedia|SpeechRecognition|speech\.bind/);
  assert.match(movement, /if \(move.lengthSq\(\) > 0\) \{\s*autoTarget = null;\s*clickQuestionCustomer = null;/);
});

test('scene taps replace intent, gate service/onboarding, and expose the stored action', () => {
  const pointer = section('function onCanvasPointer(', 'function projectObject(');
  assert.match(pointer, /tapServiceAvailable\(\)/);
  assert.match(pointer, /autoTarget = null;/);
  assert.match(pointer, /customerTapIntent\(customerTapState\(target.value, position\)\)/);
  assert.match(pointer, /\.\.\.intent/);
  assert.match(source, /talkTargetAllowed: !onboarding\?\.active \|\| customer === tutorialCustomer/);
  assert.match(source, /if \(!tapServiceAvailable\(\)\) \{\s*autoTarget = null;\s*clickQuestionCustomer = null;/);
  assert.match(source, /autoTarget: autoTarget \? \{ type: autoTarget.type, action: autoTarget.action/);
});
