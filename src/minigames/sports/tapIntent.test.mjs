import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { advanceTapIntent, createTapIntent } from './tapIntent.js';

const friend = (state = 'waiting') => ({ state, asked: state !== 'waiting' && state !== 'hidden' });
const contextFor = (npcs, overrides = {}) => ({ active: true, phase: 'playing', npcs, ...overrides });
const arrival = { reached: true, inRange: true };

test('a field tap walks only', () => {
  const intent = createTapIntent({ type: 'floor' }, contextFor([]));
  assert.deepEqual(intent, { type: 'floor', value: null, action: 'approach' });
  assert.equal(advanceTapIntent(intent, contextFor([], arrival)).arrived, intent);
});

test('a waiting friend captures Talk, which waits for arrival in talk range', () => {
  const npc = friend();
  const context = contextFor([npc]);
  const intent = createTapIntent({ type: 'npc', value: npc }, context);
  assert.equal(intent.action, 'talk');
  assert.equal(intent.value, npc);
  for (const readiness of [{}, { reached: true, inRange: false }, { reached: false, inRange: true }]) {
    assert.deepEqual(advanceTapIntent(intent, { ...context, ...readiness }), { pending: intent, arrived: null });
  }
  assert.deepEqual(advanceTapIntent(intent, { ...context, ...arrival }), { pending: null, arrived: intent });
});

test('a follower or joined friend is walked toward, never asked again', () => {
  for (const state of ['following', 'joined']) {
    const npc = friend(state);
    assert.equal(createTapIntent({ type: 'npc', value: npc }, contextFor([npc])).action, 'approach');
  }
});

test('a hidden next-wave friend is not a target', () => {
  const npc = friend('hidden');
  assert.equal(createTapIntent({ type: 'npc', value: npc }, contextFor([npc])), null);
});

test('a zone tap only navigates', () => {
  const zone = { id: 'soccer', x: 0, z: -11 };
  const intent = createTapIntent({ type: 'zone', value: zone }, contextFor([]));
  assert.equal(intent.action, 'approach');
  assert.equal(advanceTapIntent(intent, contextFor([], arrival)).arrived.action, 'approach');
});

test('manual movement drops a pending Talk so it can never fire later', () => {
  const npc = friend();
  const intent = createTapIntent({ type: 'npc', value: npc }, contextFor([npc]));
  assert.deepEqual(advanceTapIntent(intent, contextFor([npc], { ...arrival, manualMovement: true })),
    { pending: null, arrived: null });
});

test('non-playing phases neither capture nor keep an intent', () => {
  const npc = friend();
  const intent = createTapIntent({ type: 'npc', value: npc }, contextFor([npc]));
  for (const change of [
    ...['answering', 'replaying', 'round-end', 'turnaround', 'celebrating', 'finishing', 'inactive'].map((phase) => ({ phase })),
    { active: false },
  ]) {
    assert.equal(createTapIntent({ type: 'floor' }, contextFor([npc], change)), null);
    assert.equal(createTapIntent({ type: 'npc', value: npc }, contextFor([npc], change)), null);
    assert.deepEqual(advanceTapIntent(intent, contextFor([npc], { ...arrival, ...change })), { pending: null, arrived: null });
  }
});

test('arrival drops a stale Talk instead of re-inferring', () => {
  const npc = friend();
  const intent = createTapIntent({ type: 'npc', value: npc }, contextFor([npc]));
  npc.state = 'following';
  npc.asked = true;
  assert.equal(advanceTapIntent(intent, contextFor([npc], arrival)).arrived, null);
  const gone = friend();
  const goneIntent = createTapIntent({ type: 'npc', value: gone }, contextFor([gone]));
  assert.equal(advanceTapIntent(goneIntent, contextFor([], arrival)).arrived, null);
});

const source = readFileSync(new URL('./index.js', import.meta.url), 'utf8');
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));

test('scene taps prefer friends and zones over the field and replace the previous target', () => {
  const pointer = section('function onCanvasPointer(', 'function updateAutoWalk(');
  assert.match(pointer, /createTapIntent\(target, tapContext\(\)\)/);
  assert.ok(pointer.indexOf('createTapIntent(target') < pointer.indexOf("createTapIntent({ type: 'floor' }"));
  assert.match(pointer, /if \(!intent && raycaster\.ray\.intersectPlane/);
  assert.match(pointer, /character\.visible\) continue;/);
  assert.match(pointer, /clamp\(position\.x, -FIELD_LIMIT, FIELD_LIMIT\)/);
  assert.match(pointer, /autoTarget = \{ \.\.\.intent, position \};/);
  // Navigation only: joining stays with checkZones() once the child walks in.
  assert.doesNotMatch(pointer, /joinZone|checkZones|wrongZone|state = '|talkButton|targetQuestion\(/);
  assert.match(source, /zone\.group\.userData\.sportsTarget = \{ type: 'zone', value: zone \}/);
  assert.match(source, /npc\.character\.userData\.sportsTarget = \{ type: 'npc', value: npc \}/);
});

test('arrival validates the captured Talk and presses the shared Talk button', () => {
  const walk = section('function updateAutoWalk(', 'function updateMovement(');
  assert.match(walk, /advanceTapIntent\(target, tapContext\(\{[\s\S]*reached: true,[\s\S]*npcInTalkRange\(target\.value\)/);
  assert.match(walk, /autoTarget = null;/);
  assert.match(walk, /arrived\.action === 'talk'[\s\S]*targetQuestion\(arrived\.value\)[\s\S]*hud\.talkButton\.click\(\)/);
  assert.match(walk, /recordTrail\(\)/);
  assert.doesNotMatch(walk, /getUserMedia|SpeechRecognition/);
  assert.equal((source.match(/hud\.talkButton\.click\(\)/g) ?? []).length, 1);
});

test('keyboard movement cancels the pending tap; other phases clear it', () => {
  const movement = section('function updateMovement(', 'function updateFollowers(');
  assert.match(movement, /autoTarget = null;\s*if \(overviewCamera\) restoreFollowCamera\(\);\s*player\.position\.x = clamp\(player\.position\.x \+ move\.x/);
  assert.match(source, /if \(autoTarget && phase !== 'playing'\) autoTarget = null;/);
  const context = section('function updateContext(', 'function updateCameraFocus(');
  assert.doesNotMatch(context, /talkButton/);
  assert.match(context, /if \(autoTarget && nearby !== autoTarget\.value\) nearby = null;/);
});

test('the canvas pointer listener is added in enter and removed in exit, once each', () => {
  assert.equal((source.match(/addEventListener\('pointerdown', onCanvasPointer\)/g) ?? []).length, 1);
  assert.equal((source.match(/removeEventListener\('pointerdown', onCanvasPointer\)/g) ?? []).length, 1);
  assert.match(section('function enter(', 'function update('), /addEventListener\('pointerdown', onCanvasPointer\)/);
  assert.match(source.slice(source.indexOf('function exit(')), /removeEventListener\('pointerdown', onCanvasPointer\);[\s\S]*autoTarget = null;/);
});
