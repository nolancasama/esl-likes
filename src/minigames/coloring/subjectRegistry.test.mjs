import test from 'node:test';
import assert from 'node:assert/strict';

import { insideSilhouette, silhouetteBounds } from './robotDefinition.js';
import { PUPPET_HEIGHT } from './robotPuppet.js';
import robot from './subjects/robot.js';
import { TARGET_HEIGHT } from '../../systems/characters.js';
import {
  DEFAULT_SUBJECT_ID,
  SUBJECTS,
  pickNextSubject,
  subjectById,
} from './subjectRegistry.js';

const expectedPieces = {
  robot: ['body', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg'],
  snowman: ['body', 'leftArm', 'rightArm'],
  gingerbread: ['body', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg'],
  hero: ['body', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg', 'cape'],
  ninja: ['body', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg'],
};

/**
 * The contract still carries `category` and `zooSpecies` so a later pass can add
 * animals and let the Zoo find them, but the owner cut the four animals from
 * this pass, so every registered subject is a character today.
 */
const animalIds = new Set();

function assertDeepFrozen(value) {
  if (!value || typeof value !== 'object') return;
  assert.ok(Object.isFrozen(value));
  for (const child of Object.values(value)) assertDeepFrozen(child);
}

function assertConnected(subject) {
  const size = 120;
  const cells = Array.from({ length: size * size }, (_, index) => {
    const x = (index % size + 0.5) / size;
    const y = (Math.floor(index / size) + 0.5) / size;
    return insideSilhouette(subject, x, y);
  });
  const first = cells.findIndex(Boolean);
  const visited = new Set(first < 0 ? [] : [first]);
  const queue = first < 0 ? [] : [first];
  while (queue.length) {
    const at = queue.shift();
    const x = at % size;
    const y = Math.floor(at / size);
    for (const next of [at - 1, at + 1, at - size, at + size]) {
      const nx = next % size;
      const ny = Math.floor(next / size);
      if (next < 0 || next >= cells.length || Math.abs(nx - x) + Math.abs(ny - y) !== 1) continue;
      if (cells[next] && !visited.has(next)) { visited.add(next); queue.push(next); }
    }
  }
  assert.equal(visited.size, cells.filter(Boolean).length, `${subject.id} is not one connected silhouette`);
}

test('all five subjects are registered and robot stays the default', () => {
  assert.equal(DEFAULT_SUBJECT_ID, 'robot');
  assert.deepEqual(SUBJECTS.map(({ id }) => id), Object.keys(expectedPieces));
  assert.equal(subjectById('robot'), robot);
  assert.equal(subjectById('missing'), null);
  assert.notEqual(pickNextSubject({ random: () => 0, lastId: 'robot' }), robot);
});

test('every subject satisfies the shared frozen data contract', () => {
  for (const subject of SUBJECTS) {
    assert.deepEqual(subject.pieces, expectedPieces[subject.id], `${subject.id} pieces`);
    assert.equal(subject.pieces[0], 'body');
    assert.deepEqual(Object.keys(subject.pivots).sort(), [...subject.pieces].sort());
    assert.deepEqual(Object.keys(subject.parents).sort(), [...subject.pieces].sort());
    assert.deepEqual(Object.keys(subject.depth).sort(), [...subject.pieces].sort());
    assert.equal(subject.parents.body, null);
    assert.ok(subject.details.eyes.length > 0);
    assert.ok(subject.details.pupilRatio > 0 && subject.details.pupilRatio < 1);
    assert.ok(subject.details.marks.length <= 12, `${subject.id} has too many detail marks`);
    assert.ok(subject.liveScale >= 0.8 && subject.liveScale <= 1.1);
    for (const piece of subject.pieces) {
      assert.ok(subject.shapes.some((entry) => entry.piece === piece), `${subject.id}/${piece} has no shape`);
    }
    assertDeepFrozen(subject);
  }
});

test('subjects have the requested categories, zoo species and glow policy', () => {
  for (const subject of SUBJECTS) {
    if (animalIds.has(subject.id)) {
      assert.equal(subject.category, 'animal');
      assert.equal(subject.zooSpecies, subject.id);
    } else {
      assert.equal(subject.category, 'character');
      assert.equal(subject.zooSpecies, null);
    }
    if (subject.id !== 'robot') {
      assert.equal(subject.personality.glow, undefined);
      for (const state of ['idle', 'startup', 'hop', 'celebrate']) {
        assert.equal(subject.personality[state]?.glow, undefined, `${subject.id}/${state} glows`);
      }
    }
  }
});

test('every subject declares cross-game eligibility and Restaurant presentation', () => {
  for (const subject of SUBJECTS) {
    assert.deepEqual(subject.crossGame, {
      restaurantCustomer: true,
      zooVisitor: true,
    });
    assert.deepEqual(
      Object.keys(subject.presentation.restaurant).sort(),
      [
        'bubbleOffsetY',
        'dialogueOffsetY',
        'groundY',
        'hitTargetScale',
        'hitTargetY',
        'scale',
        'seatedY',
      ],
    );
    for (const value of Object.values(subject.presentation.restaurant)) {
      assert.ok(Number.isFinite(value), `${subject.id} has non-finite presentation metadata`);
    }
    assert.ok(subject.presentation.restaurant.scale > 0);
    assert.ok(subject.presentation.restaurant.hitTargetScale > 0);
    assert.ok(Math.abs(
      subject.presentation.restaurant.scale * PUPPET_HEIGHT * subject.liveScale
        - TARGET_HEIGHT * 0.72,
    ) < 1e-12, `${subject.id} is not normalized to Restaurant customer height`);
  }

  const scale = TARGET_HEIGHT * 0.72 / PUPPET_HEIGHT;
  const hitTargetScale = 0.72 / scale;
  assert.deepEqual(robot.presentation.restaurant, {
    scale,
    groundY: 0,
    seatedY: 0.35,
    bubbleOffsetY: 2.10,
    dialogueOffsetY: 1.65,
    hitTargetY: 1.05 * hitTargetScale,
    hitTargetScale,
  });
});

test('every subject is connected, centered and stands near the page baseline', () => {
  for (const subject of SUBJECTS) {
    assertConnected(subject);
    const bounds = silhouetteBounds(subject);
    assert.ok(bounds.minY <= 0.07, `${subject.id} leaves too much space above`);
    assert.ok(bounds.maxY >= 0.94 && bounds.maxY <= 0.97, `${subject.id} misses the baseline`);
    assert.ok(Math.abs((bounds.minX + bounds.maxX) / 2 - 0.5) <= 0.04, `${subject.id} is off-centre`);
  }
});

test('the hero cape is the back-most shape and piece', () => {
  const hero = subjectById('hero');
  const capeShape = hero.shapes.find(({ piece }) => piece === 'cape');
  assert.equal(capeShape.order, Math.min(...hero.shapes.map(({ order }) => order)));
  assert.equal(hero.depth.cape, Math.min(...Object.values(hero.depth)));
});

test('the selector never immediately repeats when a registry has alternatives', () => {
  const subjects = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  for (const random of [() => 0, () => 0.49, () => 0.999999]) {
    assert.notEqual(pickNextSubject({ random, lastId: 'b', subjects }).id, 'b');
  }
});
