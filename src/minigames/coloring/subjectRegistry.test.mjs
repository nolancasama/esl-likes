import test from 'node:test';
import assert from 'node:assert/strict';

import robot from './subjects/robot.js';
import {
  DEFAULT_SUBJECT_ID,
  SUBJECTS,
  pickNextSubject,
  subjectById,
} from './subjectRegistry.js';

test('the first slice registers only the robot as the default subject', () => {
  assert.equal(DEFAULT_SUBJECT_ID, 'robot');
  assert.deepEqual(SUBJECTS, [robot]);
  assert.equal(subjectById('robot'), robot);
  assert.equal(subjectById('missing'), null);
  assert.equal(pickNextSubject({ random: () => 0, lastId: 'robot' }), robot);
});

test('the selector never immediately repeats when a registry has alternatives', () => {
  const subjects = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  for (const random of [() => 0, () => 0.49, () => 0.999999]) {
    assert.notEqual(pickNextSubject({ random, lastId: 'b', subjects }).id, 'b');
  }
});
