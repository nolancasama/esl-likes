import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { advanceTapIntent, createTapIntent } from './tapIntent.js';

const unasked = () => ({ state: 'atWindow', asked: false, served: false });
const asked = () => ({ ...unasked(), asked: true });
const station = { id: 'juice' };
const context = (overrides = {}) => ({
  active: true, phase: 'service', fillMode: null, speechCooldown: false,
  heldDrink: null, servable: false, ...overrides,
});
const reached = (overrides = {}) => context({ reached: true, ...overrides });

test('a floor tap walks only', () => {
  const intent = createTapIntent({ type: 'floor' }, context());
  assert.equal(intent.action, 'approach');
  assert.equal(advanceTapIntent(intent, reached()).arrived, intent);
});

test('an unasked customer captures Talk, which waits for arrival', () => {
  const customer = unasked();
  const intent = createTapIntent({ type: 'customer', value: customer }, context());
  assert.equal(intent.action, 'talk');
  assert.deepEqual(advanceTapIntent(intent, context()), { pending: intent, arrived: null });
  assert.deepEqual(advanceTapIntent(intent, reached()), { pending: null, arrived: intent });
});

test('an unasked customer still captures Talk with a cup in hand (nothing to serve yet)', () => {
  const intent = createTapIntent({ type: 'customer', value: unasked() }, context({ heldDrink: 'juice', servable: true }));
  assert.equal(intent.action, 'talk');
});

test('an asked customer with a servable drink captures Serve, including a wrong drink', () => {
  const customer = asked();
  const intent = createTapIntent({ type: 'customer', value: customer }, context({ heldDrink: 'tea', servable: true }));
  assert.equal(intent.action, 'serve');
  assert.equal(intent.drink, 'tea');
  assert.equal(advanceTapIntent(intent, reached({ heldDrink: 'tea', servable: true })).arrived, intent);
});

test('an asked customer without a servable drink walks only, never Talk', () => {
  for (const hands of [{}, { heldDrink: 'juice', servable: false }]) {
    const intent = createTapIntent({ type: 'customer', value: asked() }, context(hands));
    assert.equal(intent.action, 'approach');
  }
});

test('a station tap captures Pour', () => {
  const intent = createTapIntent({ type: 'station', value: station }, context());
  assert.equal(intent.action, 'pour');
  assert.equal(advanceTapIntent(intent, reached()).arrived, intent);
});

test('speech cooldown blocks a Talk capture', () => {
  assert.equal(createTapIntent({ type: 'customer', value: unasked() }, context({ speechCooldown: true })).action, 'approach');
});

test('manual movement, a pour or a phase change drops any pending intent', () => {
  const intent = createTapIntent({ type: 'customer', value: unasked() }, context());
  for (const change of [
    { manualMovement: true }, { fillMode: 'latched' }, { active: false },
    ...['round-end', 'turnaround', 'finishing', 'inactive'].map((phase) => ({ phase })),
  ]) assert.deepEqual(advanceTapIntent(intent, reached(change)), { pending: null, arrived: null });
});

test('nothing is captured outside service or while pouring', () => {
  for (const change of [{ phase: 'round-end' }, { fillMode: 'pointer' }, { active: false }]) {
    assert.equal(createTapIntent({ type: 'floor' }, context(change)), null);
    assert.equal(createTapIntent({ type: 'customer', value: unasked() }, context(change)), null);
  }
});

test('a customer who is not at a window is not a target', () => {
  assert.equal(createTapIntent({ type: 'customer', value: { ...unasked(), state: 'leaving' } }, context()), null);
});

test('arrival drops stale Talk and Serve instead of re-inferring another action', () => {
  const customer = unasked();
  const talk = createTapIntent({ type: 'customer', value: customer }, context());
  customer.asked = true;
  assert.equal(advanceTapIntent(talk, reached({ heldDrink: 'juice', servable: true })).arrived, null);

  const left = unasked();
  const talkLeft = createTapIntent({ type: 'customer', value: left }, context());
  left.state = 'leaving';
  assert.equal(advanceTapIntent(talkLeft, reached()).arrived, null);
  assert.equal(advanceTapIntent(createTapIntent({ type: 'customer', value: unasked() }, context()),
    reached({ speechCooldown: true })).arrived, null);

  const serveIntent = createTapIntent({ type: 'customer', value: asked() }, context({ heldDrink: 'juice', servable: true }));
  for (const change of [{ heldDrink: null }, { heldDrink: 'tea', servable: true }, { heldDrink: 'juice', servable: false }]) {
    assert.equal(advanceTapIntent(serveIntent, reached(change)).arrived, null);
  }
  serveIntent.value.served = true;
  assert.equal(advanceTapIntent(serveIntent, reached({ heldDrink: 'juice', servable: true })).arrived, null);
});

const source = readFileSync(new URL('./index.js', import.meta.url), 'utf8');
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));

test('scene taps check stations/customers before the floor fallback', () => {
  const pointer = section('function onCanvasPointer(', 'function projectObject(');
  assert.match(pointer, /createTapIntent\(target, tapContext\(\)\)/);
  assert.ok(pointer.indexOf('createTapIntent(target') < pointer.indexOf("createTapIntent({ type: 'floor' }"));
  assert.match(pointer, /if \(!intent && floorPoint\)/);
  assert.match(pointer, /intersection\.object === walkFloor/);
  assert.match(pointer, /WORK_BOUNDS\.minX, WORK_BOUNDS\.maxX/);
  assert.doesNotMatch(pointer, /beginFill|serve\(|talkButton|targetQuestion/);
});

test('arrival validates the captured action and Talks through the shared HUD button', () => {
  const movement = section('function updateMovement(', 'function freeWindowIndex(');
  assert.match(movement, /if \(move\.lengthSq\(\) > 0\) \{\s*autoTarget = null;/);
  assert.match(movement, /advanceTapIntent\(autoTarget, tapContext\(\{ reached: true \}\)\)/);
  assert.match(movement, /arrived\.action === 'pour'\) beginFill\(arrived\.value, 'latched'\)/);
  assert.match(movement, /arrived\.action === 'serve'\) serve\(arrived\.value\)/);
  assert.match(movement, /arrived\.action === 'talk'[\s\S]*targetQuestion\(arrived\.value\)[\s\S]*hud\.talkButton\.click\(\)/);
  assert.doesNotMatch(movement, /getUserMedia|SpeechRecognition/);
  assert.match(source, /if \(autoTarget && \(phase !== 'service' \|\| fillMode\)\) autoTarget = null;/);
});

test('proximity never presses Talk; only a tapped arrival does', () => {
  const context = section('function updateContext(', 'function performAction(');
  assert.doesNotMatch(context, /talkButton/);
  assert.equal((source.match(/hud\.talkButton\.click\(\)/g) ?? []).length, 1);
});

test('the canvas pointer listener is added once and removed once', () => {
  assert.equal((source.match(/addEventListener\('pointerdown', onCanvasPointer\)/g) ?? []).length, 1);
  assert.equal((source.match(/removeEventListener\('pointerdown', onCanvasPointer\)/g) ?? []).length, 1);
  assert.match(section('function enter(', 'function exit('), /addEventListener\('pointerdown', onCanvasPointer\)/);
  assert.match(source.slice(source.indexOf('function exit(')), /removeEventListener\('pointerdown', onCanvasPointer\)[\s\S]*autoTarget = null;/);
});
