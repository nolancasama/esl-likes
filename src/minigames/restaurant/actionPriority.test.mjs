import test from 'node:test';
import assert from 'node:assert/strict';

import { chooseAction } from './actionPriority.js';

test('speech cooldown and a locked question block empty-handed world actions', () => {
  assert.equal(chooseAction({ speechCooldown: true, beltDish: {} }), 'none');
  assert.equal(chooseAction({ lockedQuestion: {}, beltDish: {} }), 'none');
});

test('a question candidate owns Talk only with empty hands', () => {
  assert.equal(chooseAction({ questionCandidate: {} }), 'talk');
  assert.equal(chooseAction({ carried: true, questionCandidate: {} }), 'none');
});

test('carrying priority is return, then exchange, then delivery', () => {
  const base = {
    carried: true,
    questionCandidate: {},
    lockedQuestion: {},
    speechCooldown: true,
    nearReturn: true,
    beltDish: {},
    deliverTarget: {},
  };
  assert.equal(chooseAction(base), 'return');
  assert.equal(chooseAction({ ...base, nearReturn: false }), 'exchange');
  assert.equal(chooseAction({ ...base, nearReturn: false, beltDish: null }), 'deliver');
  assert.equal(chooseAction({ carried: true }), 'none');
});

test('empty hands collect a winning belt dish and otherwise do nothing', () => {
  assert.equal(chooseAction({ beltDish: {} }), 'collect');
  assert.equal(chooseAction(), 'none');
});

test('action choice is independent of whether carried food matches', () => {
  const common = { carried: true, beltDish: { id: 7 }, deliverTarget: { id: 2 } };
  assert.equal(chooseAction({ ...common, foodMatches: true }), 'exchange');
  assert.equal(chooseAction({ ...common, foodMatches: false }), 'exchange');
});
