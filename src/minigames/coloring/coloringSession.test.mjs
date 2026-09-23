import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  clearColoringSession,
  saveCompletedCreation,
  savedCreations,
  savedRobots,
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

const variation = (start) => ({
  id: start + 10,
  start,
  idlePause: 1.25 + start,
  stateTime: 0.4 + start,
  points: [{ x: start, z: start }],
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

  const firstVisit = savedRobots();
  firstVisit.length = 0;
  const secondVisit = savedRobots();

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
  const restored = savedRobots();

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

  assert.equal(savedRobots().length, 0);
  assert.equal(source.disposed, false);
  assert.equal(record.artwork.disposed, false);
  assert.equal(record.artwork.width, 4);
  assert.deepEqual(record.artwork.pixels, [8, 6, 7, 5]);
});

test('savedCreations exposes every subject while savedRobots is a compatibility filter', () => {
  saveCompletedRobot(canvas([1]), variation(0));
  saveCompletedCreation({ subjectId: 'future-subject', artwork: canvas([2]), crowd: variation(1) });
  saveCompletedCreation({ artwork: canvas([3]), crowd: variation(2) });

  assert.deepEqual(savedCreations().map((record) => record.subjectId), [
    'robot', 'future-subject', undefined,
  ]);
  assert.deepEqual(savedRobots().map((record) => record.artwork.pixels), [[1], [3]]);
});
