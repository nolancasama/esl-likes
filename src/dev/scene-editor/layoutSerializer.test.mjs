import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LAYOUT_VERSION,
  deserializePointList,
  deserializeTransform,
  parseLayout,
  round,
  serializeLayout,
  serializePointList,
  serializeTransform,
  toJSON,
} from './layoutSerializer.js';

const transform = {
  position: [1.23456789, 0, -4.5],
  rotation: [0, Math.PI / 2, 0],
  scale: [1.1, 1.1, 1.1],
};

test('a transform survives a round trip at file precision', () => {
  const written = serializeTransform(transform);
  const read = deserializeTransform(written);
  assert.deepEqual(read.position, [1.2346, 0, -4.5]);
  assert.equal(read.rotation[1], 1.5708);
  assert.deepEqual(read.scale, [1.1, 1.1, 1.1]);
});

test('rounding never writes negative zero', () => {
  assert.ok(Object.is(round(-0.00001), 0));
  assert.ok(Object.is(round(-0), 0));
  const written = serializeTransform({ position: [-0.00004, -0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] });
  assert.equal(JSON.stringify(written.position), '[0,0,0]');
});

test('a missing or malformed transform falls back to identity', () => {
  const read = deserializeTransform({ position: [1, 2], scale: 'big' });
  assert.deepEqual(read.position, [0, 0, 0]);
  assert.deepEqual(read.rotation, [0, 0, 0]);
  assert.deepEqual(read.scale, [1, 1, 1]);
});

test('export order is deterministic regardless of insertion order', () => {
  const objects = [
    { id: 'rock-002', asset: 'rock', category: 'rocks', ...transform },
    { id: 'tree-001', asset: 'tree', category: 'vegetation', ...transform },
    { id: 'rock-001', asset: 'rock', category: 'rocks', ...transform },
  ];
  const forward = serializeLayout({ project: 'p', objects });
  const backward = serializeLayout({ project: 'p', objects: [...objects].reverse() });
  assert.deepEqual(forward.objects.map((entry) => entry.id), ['rock-001', 'rock-002', 'tree-001']);
  assert.equal(toJSON(forward), toJSON(backward));
});

test('the layout carries a version and the project id', () => {
  const layout = serializeLayout({ project: 'animal-park', objects: [] });
  assert.equal(layout.version, LAYOUT_VERSION);
  assert.equal(layout.project, 'animal-park');
  assert.deepEqual(layout.objects, []);
  assert.equal(layout.points, undefined, 'a layout with no point groups omits the key entirely');
});

test('xz points serialise as pairs so they paste back into territories.js', () => {
  const layout = serializeLayout({
    project: 'animal-park',
    objects: [],
    points: { tiger: [{ x: -18.2, y: 0, z: -4.3 }, { x: -23.4, y: 0, z: -10.2 }] },
    pointFormats: { tiger: 'xz' },
  });
  assert.deepEqual(layout.points.tiger, [[-18.2, -4.3], [-23.4, -10.2]]);
});

test('xyz points keep their height', () => {
  const written = serializePointList([{ x: 1, y: 2, z: 3 }], 'xyz');
  assert.deepEqual(written, [[1, 2, 3]]);
  assert.deepEqual(deserializePointList(written, 'xyz'), [{ x: 1, y: 2, z: 3 }]);
});

test('a stored xz pair reads back with y zero', () => {
  assert.deepEqual(deserializePointList([[5, 6]], 'xz'), [{ x: 5, y: 0, z: 6 }]);
});

test('a malformed point is dropped rather than read as zero', () => {
  assert.deepEqual(deserializePointList([[1, 2], 'nope', [3]], 'xz'), [{ x: 1, y: 0, z: 2 }]);
});

test('a wrong version throws rather than guessing', () => {
  assert.throws(() => parseLayout({ version: 99, objects: [] }), /Unsupported layout version 99/);
  assert.throws(() => parseLayout({ objects: [] }), /Unsupported layout version undefined/);
  assert.throws(() => parseLayout('[]'), /must be an object/);
});

test('an unknown asset is named and skipped, and the rest still load', () => {
  const parsed = parseLayout({
    version: 1,
    project: 'p',
    objects: [
      { id: 'tree-001', asset: 'tree', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      { id: 'ufo-001', asset: 'ufo', position: [1, 0, 1], rotation: [0, 0, 0], scale: [1, 1, 1] },
    ],
  }, { knownAssets: ['tree'] });
  assert.equal(parsed.objects.length, 1);
  assert.equal(parsed.objects[0].id, 'tree-001');
  assert.equal(parsed.errors.length, 1);
  assert.match(parsed.errors[0], /unknown asset "ufo"/);
});

test('a duplicate id is reported instead of overwriting the first object', () => {
  const parsed = parseLayout({
    version: 1,
    objects: [
      { id: 'tree-001', asset: 'tree' },
      { id: 'tree-001', asset: 'tree' },
    ],
  }, { knownAssets: ['tree'] });
  assert.equal(parsed.objects.length, 1);
  assert.match(parsed.errors[0], /duplicate id "tree-001"/);
});

test('an object with no asset is an error, not a silent skip', () => {
  const parsed = parseLayout({ version: 1, objects: [{ id: 'x' }] });
  assert.equal(parsed.objects.length, 0);
  assert.match(parsed.errors[0], /missing "asset"/);
});

test('a JSON string is accepted directly', () => {
  const layout = serializeLayout({ project: 'p', objects: [{ id: 'a-001', asset: 'a', ...transform }] });
  const parsed = parseLayout(toJSON(layout));
  assert.equal(parsed.objects.length, 1);
  assert.equal(parsed.project, 'p');
});
