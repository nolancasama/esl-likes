import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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
});
