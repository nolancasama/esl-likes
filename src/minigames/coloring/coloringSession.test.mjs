import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  __setCreationStorage,
  clearSavedCreations,
  clearColoringSession,
  creationPersistenceStatus,
  hydrateCreations,
  saveCompletedCreation,
  savedCreations,
} from './coloringSession.js';

const saveCompletedRobot = (artwork, crowd) => saveCompletedCreation({
  subjectId: 'robot', artwork, crowd,
});

class FakeCanvas {
  constructor(ownerDocument, pixels = []) {
    this.ownerDocument = ownerDocument;
    this.width = pixels.length;
    this.height = 1;
    this.pixels = pixels.slice();
    this.disposed = false;
  }

  getContext(kind) {
    if (kind !== '2d') return null;
    return {
      drawImage: (source) => { this.pixels = source.pixels.slice(); },
    };
  }

  dispose() { this.disposed = true; }
}

function canvas(pixels) {
  const ownerDocument = {
    createElement(tag) {
      assert.equal(tag, 'canvas');
      return new FakeCanvas(ownerDocument);
    },
  };
  return new FakeCanvas(ownerDocument, pixels);
}

class MemoryCreationStorage {
  constructor(rows = []) {
    this.rows = rows.slice();
  }

  async readRows() {
    return this.rows.slice();
  }

  async putRow(row) {
    const index = this.rows.findIndex((saved) => saved.id === row.id);
    if (index < 0) this.rows.push(row);
    else this.rows[index] = row;
    return row.artworkBlob.size;
  }

  async clearRows() {
    this.rows.length = 0;
  }

  async toBlob(artwork) {
    return new Blob([JSON.stringify(artwork.pixels)], { type: 'image/png' });
  }

  async toCanvas(blob) {
    return canvas(JSON.parse(await blob.text()));
  }
}

function durableRow(id, order, pixels, subjectId = 'robot') {
  return {
    id,
    version: 1,
    subjectId,
    createdAt: Math.floor(order / 1000),
    order,
    artworkBlob: new Blob([JSON.stringify(pixels)], { type: 'image/png' }),
    crowd: { start: order, idlePause: order + 0.25, stateTime: order + 0.5 },
  };
}

async function waitFor(check) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.fail('Timed out waiting for queued creation storage work.');
}

const variation = (start) => ({
  id: start + 10,
  start,
  idlePause: 1.25 + start,
  stateTime: 0.4 + start,
  points: [{ x: start, z: start }],
});

let fakeStorage;

beforeEach(() => {
  fakeStorage = new MemoryCreationStorage();
  __setCreationStorage(fakeStorage);
});

afterEach(() => clearColoringSession());

test('saving detaches artwork from the live painting canvas immediately', () => {
  const live = canvas([0, 14, 0, 29]);
  const saved = saveCompletedRobot(live, variation(2));

  assert.notEqual(saved.artwork, live);
  assert.equal(saved.subjectId, 'robot');
  assert.deepEqual(saved.artwork.pixels, [0, 14, 0, 29]);

  live.pixels.fill(99);
  live.width = 0;
  live.height = 0;
  assert.deepEqual(saved.artwork.pixels, [0, 14, 0, 29],
    'resetting the next round mutated the finished robot');
  assert.equal(saved.artwork.width, 4);
  assert.equal(saved.artwork.height, 1);
});

test('saved records survive a controller-style leave and later read', () => {
  saveCompletedRobot(canvas([1, 2, 3]), variation(0));

  const firstVisit = savedCreations();
  firstVisit.length = 0;
  const secondVisit = savedCreations();

  assert.equal(secondVisit.length, 1,
    'clearing a controller-owned livingRobots array must not clear the session');
  assert.deepEqual(secondVisit[0].crowd, {
    start: 0,
    idlePause: 1.25,
    stateTime: 0.4,
  });
  assert.ok(Object.isFrozen(secondVisit[0].crowd));
  assert.ok(!('id' in secondVisit[0].crowd));
  assert.ok(!('points' in secondVisit[0].crowd));
});

test('different finished robots retain different independent artwork', () => {
  const a = saveCompletedRobot(canvas([10, 20, 30]), variation(0));
  const b = saveCompletedRobot(canvas([30, 20, 10]), variation(1));
  const restored = savedCreations();

  assert.notEqual(a.artwork, b.artwork);
  assert.notEqual(restored[0].artwork, restored[1].artwork);
  assert.deepEqual(restored.map((record) => record.artwork.pixels), [
    [10, 20, 30],
    [30, 20, 10],
  ]);

  restored[0].artwork.pixels[0] = 77;
  assert.deepEqual(restored[1].artwork.pixels, [30, 20, 10],
    'two restored robots shared a canvas or backing pixels');
});

test('clearing the whole session drops records without disposing stored canvases', () => {
  const source = canvas([8, 6, 7, 5]);
  const record = saveCompletedRobot(source, variation(0));

  clearColoringSession();

  assert.equal(savedCreations().length, 0);
  assert.equal(source.disposed, false);
  assert.equal(record.artwork.disposed, false);
  assert.equal(record.artwork.width, 4);
  assert.deepEqual(record.artwork.pixels, [8, 6, 7, 5]);
});

test('savedCreations exposes every subject without consuming or reordering records', () => {
  saveCompletedRobot(canvas([1]), variation(0));
  saveCompletedCreation({ subjectId: 'future-subject', artwork: canvas([2]), crowd: variation(1) });
  saveCompletedCreation({ artwork: canvas([3]), crowd: variation(2) });

  assert.deepEqual(savedCreations().map((record) => record.subjectId), [
    'robot', 'future-subject', undefined,
  ]);
  assert.deepEqual(savedCreations().map((record) => record.artwork.pixels), [[1], [2], [3]]);
});

test('save and read stay synchronous while durable metadata is queued', async () => {
  const record = saveCompletedCreation({
    subjectId: 'future-test-creature',
    artwork: canvas([4, 8, 15, 16]),
    crowd: variation(3),
  });

  assert.equal(savedCreations()[0], record);
  assert.equal(typeof record.id, 'string');
  assert.equal(record.version, 1);
  assert.equal(record.subjectId, 'future-test-creature');
  assert.equal(typeof record.createdAt, 'number');
  assert.equal(typeof record.order, 'number');
  await waitFor(() => fakeStorage.rows.length === 1);
  assert.equal(fakeStorage.rows[0].subjectId, 'future-test-creature');
});

test('fake storage round-trip preserves subject and independent artwork', async () => {
  saveCompletedCreation({
    subjectId: 'future-test-creature',
    artwork: canvas([23, 42]),
    crowd: variation(4),
  });
  await waitFor(() => fakeStorage.rows.length === 1);

  clearColoringSession();
  __setCreationStorage(fakeStorage);
  await hydrateCreations();

  const [restored] = savedCreations();
  assert.equal(restored.subjectId, 'future-test-creature');
  assert.deepEqual(restored.artwork.pixels, [23, 42]);
  assert.notEqual(restored.artwork, fakeStorage.rows[0].artworkBlob);
});

test('hydration restores deterministic order and does not duplicate on a second call', async () => {
  fakeStorage.rows = [
    durableRow('D', 4000, [4]),
    durableRow('B', 2000, [2]),
    durableRow('A', 1000, [1]),
    durableRow('C', 3000, [3]),
  ];

  const firstHydration = hydrateCreations();
  const secondHydration = hydrateCreations();
  assert.equal(firstHydration, secondHydration);
  await firstHydration;

  assert.deepEqual(savedCreations().map((record) => record.id), ['A', 'B', 'C', 'D']);
  await hydrateCreations();
  assert.deepEqual(savedCreations().map((record) => record.id), ['A', 'B', 'C', 'D']);
});

test('a creation completed during hydration survives the merge', async () => {
  let releaseRead;
  const delayedStorage = new MemoryCreationStorage([durableRow('A', 1000, [1])]);
  delayedStorage.readRows = () => new Promise((resolve) => {
    releaseRead = () => resolve(delayedStorage.rows.slice());
  });
  __setCreationStorage(delayedStorage);

  const hydration = hydrateCreations();
  const newborn = saveCompletedCreation({ artwork: canvas([9]), crowd: variation(9) });
  releaseRead();
  await hydration;

  assert.ok(savedCreations().some((record) => record.id === 'A'));
  assert.ok(savedCreations().some((record) => record.id === newborn.id));
});

test('one corrupt durable row does not prevent its neighbours restoring', async () => {
  fakeStorage.rows = [
    durableRow('A', 1000, [1]),
    { id: 'broken', version: 1, artworkBlob: 'not-a-blob' },
    durableRow('C', 3000, [3]),
  ];
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args);
  try {
    await hydrateCreations();
  } finally {
    console.warn = originalWarn;
  }

  assert.deepEqual(savedCreations().map((record) => record.id), ['A', 'C']);
  assert.equal(warnings.length, 1);
});

test('total storage failure leaves synchronous creations usable', async () => {
  const failure = new Error('storage offline');
  const rejectingStorage = Object.fromEntries([
    'readRows', 'putRow', 'clearRows', 'toBlob', 'toCanvas',
  ].map((name) => [name, async () => { throw failure; }]));
  __setCreationStorage(rejectingStorage);
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args);
  try {
    const saved = saveCompletedCreation({ artwork: canvas([7]), crowd: variation(7) });
    assert.equal(savedCreations()[0], saved);
    await hydrateCreations();
    await waitFor(() => warnings.length === 2);
    assert.equal(savedCreations()[0], saved);
    assert.equal(creationPersistenceStatus().available, false);
  } finally {
    console.warn = originalWarn;
  }
});

test('clearSavedCreations empties memory and durable rows', async () => {
  saveCompletedRobot(canvas([5]), variation(5));
  await waitFor(() => fakeStorage.rows.length === 1);

  await clearSavedCreations();

  assert.deepEqual(savedCreations(), []);
  assert.deepEqual(fakeStorage.rows, []);
  assert.deepEqual(creationPersistenceStatus(), {
    hydrated: false,
    available: true,
    lastError: null,
    bytes: 0,
    count: 0,
  });
});
