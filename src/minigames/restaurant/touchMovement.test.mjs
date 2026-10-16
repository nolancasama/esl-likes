import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./index.js', import.meta.url), 'utf8');

test('Restaurant applies the global tap-to-walk rule to reachable floor', () => {
  assert.match(source, /let restaurantFloor = null/);
  assert.match(source, /restaurantFloor = addPart\(world, box, floorMaterial/);
  const start = source.indexOf('function onCanvasPointer(event)');
  const end = source.indexOf('function projectObject(', start);
  assert.ok(start >= 0 && end > start);
  const handler = source.slice(start, end);
  assert.match(handler, /intersection\.object === restaurantFloor/);
  assert.match(handler, /canOccupy\(intersection\.point\.x, intersection\.point\.z\)/);
  assert.match(handler, /type: 'floor'/);
  assert.match(handler, /position: new THREE\.Vector3\(floorPoint\.x, 0, floorPoint\.z\)/);
  assert.ok(handler.indexOf("type: 'customer'") < handler.indexOf("type: 'floor'"),
    'interactive Restaurant targets must keep priority over empty floor');
});

test('Restaurant keyboard movement still cancels tap-to-walk', () => {
  const start = source.indexOf('function updateMovement(dt)');
  const end = source.indexOf('function moveCustomerToward(', start);
  const movement = source.slice(start, end);
  assert.match(movement, /if \(move\.lengthSq\(\) > 0\) \{\s*autoTarget = null/);
});
