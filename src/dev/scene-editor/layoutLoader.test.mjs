import test from 'node:test';
import assert from 'node:assert/strict';

import { applyTransform, loadLayoutInto, readTransform } from './layoutLoader.js';
import { serializeLayout } from './layoutSerializer.js';

/**
 * A stand-in for an Object3D. The loader deliberately imports no three.js, so
 * the whole game-facing load path is testable with nothing but plain objects.
 */
function makeObject(name = 'stub') {
  const vector = () => {
    const v = { x: 0, y: 0, z: 0 };
    v.set = (x, y, z) => { v.x = x; v.y = y; v.z = z; return v; };
    return v;
  };
  return {
    name,
    position: vector(),
    rotation: vector(),
    scale: vector().set(1, 1, 1),
    userData: {},
    children: [],
    add(child) { this.children.push(child); child.parent = this; },
  };
}

function makeAdapter({ known = ['tree', 'rock'], failOn = null } = {}) {
  const built = [];
  return {
    built,
    assets: known.map((id) => ({ id, name: id, category: 'scenery' })),
    createAsset(assetId) {
      if (assetId === failOn) return null;
      const object = makeObject(assetId);
      built.push(assetId);
      return object;
    },
    getGroundPoint: () => null,
  };
}

const layoutOf = (objects) => serializeLayout({ project: 'test', objects });

const entry = (id, asset, position, rotation = [0, 0, 0], scale = [1, 1, 1]) => ({
  id, asset, category: 'scenery', position, rotation, scale,
});

test('transforms are applied exactly as stored', () => {
  const root = makeObject('root');
  const adapter = makeAdapter();
  const layout = layoutOf([entry('tree-001', 'tree', [-12.4, 0, 8.7], [0, 1.5708, 0], [1.1, 1.1, 1.1])]);

  const result = loadLayoutInto(root, layout, adapter);
  assert.equal(result.errors.length, 0);
  assert.equal(root.children.length, 1);

  const placed = root.children[0];
  assert.deepEqual(readTransform(placed), {
    position: [-12.4, 0, 8.7],
    rotation: [0, 1.5708, 0],
    scale: [1.1, 1.1, 1.1],
  });
});

test('every loaded object is tagged with its editor identity', () => {
  const root = makeObject('root');
  const adapter = makeAdapter();
  loadLayoutInto(root, layoutOf([entry('rock-006', 'rock', [1, 0, 2])]), adapter);
  assert.deepEqual(root.children[0].userData.__editor, {
    id: 'rock-006',
    assetId: 'rock',
    category: 'scenery',
    deletable: true,
    locked: false,
  });
});

test('an unknown asset is reported and the rest of the layout still loads', () => {
  const root = makeObject('root');
  const adapter = makeAdapter();
  const seen = [];
  const result = loadLayoutInto(root, layoutOf([
    entry('tree-001', 'tree', [0, 0, 0]),
    entry('ufo-001', 'ufo', [1, 0, 1]),
    entry('rock-001', 'rock', [2, 0, 2]),
  ]), adapter, { onError: (message) => seen.push(message) });

  assert.equal(result.created.length, 2);
  assert.equal(root.children.length, 2);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /unknown asset "ufo"/);
  assert.equal(seen.length, 1, 'onError is told about it rather than it passing silently');
});

test('an adapter that returns nothing is an error, not a crash', () => {
  const root = makeObject('root');
  const adapter = makeAdapter({ failOn: 'rock' });
  const result = loadLayoutInto(root, layoutOf([entry('rock-001', 'rock', [0, 0, 0])]), adapter);
  assert.equal(result.created.length, 0);
  assert.match(result.errors[0], /returned nothing/);
});

test('an adapter that throws is caught and named', () => {
  const root = makeObject('root');
  const adapter = makeAdapter();
  adapter.createAsset = () => { throw new Error('asset pack missing'); };
  const result = loadLayoutInto(root, layoutOf([entry('tree-001', 'tree', [0, 0, 0])]), adapter);
  assert.equal(result.created.length, 0);
  assert.match(result.errors[0], /asset pack missing/);
});

test('a bad version stops the load outright', () => {
  const root = makeObject('root');
  assert.throws(
    () => loadLayoutInto(root, { version: 7, objects: [] }, makeAdapter()),
    /Unsupported layout version 7/,
  );
});

test('an exported layout round-trips back to the same transforms', () => {
  const adapter = makeAdapter();
  const original = [
    entry('tree-001', 'tree', [-3.25, 0, 4.5], [0, 0.7854, 0], [0.9, 0.9, 0.9]),
    entry('rock-002', 'rock', [8.125, 0.5, -2], [0, -1.2, 0], [1.4, 1.4, 1.4]),
  ];
  const first = makeObject('root');
  loadLayoutInto(first, layoutOf(original), adapter);

  // Serialise what landed in the scene, then load that into a fresh root.
  const exported = serializeLayout({
    project: 'test',
    objects: first.children.map((child) => ({
      id: child.userData.__editor.id,
      asset: child.userData.__editor.assetId,
      category: child.userData.__editor.category,
      ...readTransform(child),
    })),
  });
  const second = makeObject('root');
  loadLayoutInto(second, exported, adapter);

  assert.deepEqual(
    second.children.map(readTransform),
    first.children.map(readTransform),
  );
});

test('applyTransform and readTransform are inverses', () => {
  const object = makeObject();
  const transform = { position: [1, 2, 3], rotation: [0.1, 0.2, 0.3], scale: [4, 5, 6] };
  applyTransform(object, transform);
  assert.deepEqual(readTransform(object), transform);
});

test('points ride along with the layout for the host to consume', () => {
  const root = makeObject('root');
  const layout = serializeLayout({
    project: 'test',
    objects: [],
    points: { tiger: [{ x: -1, y: 0, z: -2 }] },
    pointFormats: { tiger: 'xz' },
  });
  const result = loadLayoutInto(root, layout, makeAdapter());
  assert.deepEqual(result.points.tiger, [[-1, -2]]);
});
