import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { advanceTapIntent, createTapIntent } from './tapIntent.js';

const source = readFileSync(new URL('./index.js', import.meta.url), 'utf8');

test('Zoo applies one touch-to-walk handler only during normal park play', () => {
  const start = source.indexOf('function onCanvasPointer(event)');
  const end = source.indexOf('function updateContext()', start);
  assert.ok(start >= 0 && end > start);
  const handler = source.slice(start, end);
  assert.match(handler, /active \|\| phase !== 'playing' \|\| sceneEditor\?\.enabled/);
  assert.match(handler, /type: 'visitor'/);
  assert.match(handler, /type: 'animal'/);
  assert.match(handler, /intersectPlane\(groundPlane, groundPoint\)/);
  assert.match(handler, /type: 'floor'/);
  assert.equal((source.match(/addEventListener\('pointerdown', onCanvasPointer\)/g) ?? []).length, 1);
  assert.equal((source.match(/removeEventListener\('pointerdown', onCanvasPointer\)/g) ?? []).length, 1);
});

test('Zoo keyboard movement overrides touch movement and non-playing phases clear it', () => {
  const start = source.indexOf('function updateMovement(dt)');
  const end = source.indexOf('function updateViewfinderMovement(dt)', start);
  const movement = source.slice(start, end);
  assert.match(movement, /if \(move\.lengthSq\(\) !== 0\) \{\s*autoTarget = null/);
  assert.match(source, /if \(phase !== 'playing'\) autoTarget = null/);
});

test('Zoo tap targets stop at useful interaction distances', () => {
  assert.match(source, /VISITOR_APPROACH_RADIUS = 2\.45/);
  assert.match(source, /ANIMAL_APPROACH_RADIUS = 2\.4/);
  assert.match(source, /finishAutoArrival\(arrived\)/);
  assert.match(source, /actionVisitor = visitor;\s*showPhotoToVisitor\(\)/);

  // Exercise the controller's arrival dispatch with the real pure validator.
  const arrival = source.slice(source.indexOf('  function finishAutoArrival('),
    source.indexOf('  function updateAutoMovement('));
  const rangeCheck = source.slice(source.indexOf('  function visitorInTalkRange('),
    source.indexOf('  function nearestVisitor('));
  const approachRadius = Number(source.match(/VISITOR_APPROACH_RADIUS = ([\d.]+)/)[1]);
  const calls = [];
  const visitor = { state: 'waiting', asked: false, served: false,
    character: { position: { x: 0, z: 0 } } };
  const context = {
    active: true, phase: 'playing', carriedPhoto: null, visitorPresent: true,
    validSpeechTarget: true, sequenceRunning: false,
  };
  const player = { position: { x: approachRadius, z: 0 } };
  const dispatch = new Function('advanceTapIntent', 'tapContext', 'player',
    'showPhotoToVisitor', 'targetQuestion', 'hud', `
      const TALK_RADIUS_SQ = 3.2 * 3.2;
      let actionVisitor = null;
      ${rangeCheck}
      ${arrival}
      return finishAutoArrival;
    `)(advanceTapIntent, () => context, player,
    () => calls.push('show-photo'), (target) => {
      assert.equal(target, visitor);
      calls.push('target');
    }, { talkButton: { click: () => calls.push('talk') } });
  const intent = createTapIntent({ type: 'visitor', value: visitor }, context);
  dispatch(intent);
  assert.deepEqual(calls, ['target', 'talk'], 'arrival is inside the normal talk range');
  calls.length = 0;
  player.position.x = 3.2;
  dispatch(intent);
  assert.deepEqual(calls, [], 'talk cannot fire outside the normal talk range');
  player.position.x = approachRadius;
  context.sequenceRunning = true;
  dispatch(intent);
  assert.deepEqual(calls, [], 'committed questions or active speech block arrival actions');
  context.sequenceRunning = false;
  visitor.asked = true;
  context.carriedPhoto = { animal: 'cat' };
  dispatch(intent);
  assert.deepEqual(calls, [], 'stale talk never becomes photo delivery');
  const delivery = createTapIntent({ type: 'visitor', value: visitor }, context);
  dispatch(delivery);
  assert.deepEqual(calls, ['show-photo']);
});
