import test from 'node:test';
import assert from 'node:assert/strict';

import { chooseAction } from './actionPriority.js';

test('speech cooldown and a locked question block every world action', () => {
  const all = { carried: true, questionCandidate: {}, nearReturn: true, beltDish: {}, deliverTarget: {} };
  assert.equal(chooseAction({ ...all, speechCooldown: true }), 'none');
  assert.equal(chooseAction({ ...all, lockedQuestion: {} }), 'none');
});

test('a question candidate owns Talk when the belt does not win', () => {
  assert.equal(chooseAction({ questionCandidate: {} }), 'talk');
  assert.equal(chooseAction({ carried: true, questionCandidate: {}, nearReturn: true }), 'talk');
});

test('carrying priority is return, then exchange, then delivery', () => {
  const base = { carried: true, nearReturn: true, beltDish: {}, deliverTarget: {} };
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
