import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VALID_FILL_LEVEL,
  advanceFill,
  emptyFill,
  isServable,
  selectDrink,
} from './fill.js';
import { scoreSession } from './scoring.js';

test('an empty cup is not servable', () => {
  assert.equal(isServable(emptyFill()), false);
});

test('filling through the valid threshold makes the cup servable', () => {
  const selected = selectDrink(emptyFill(), 'water');
  assert.equal(isServable(advanceFill(selected, VALID_FILL_LEVEL - 0.01)), false);
  assert.equal(isServable(advanceFill(selected, VALID_FILL_LEVEL)), true);
});

test('a partial cup tops up at the same station', () => {
  const partial = advanceFill(selectDrink(emptyFill(), 'milk'), 0.2);
  const resumed = selectDrink(partial, 'milk');
  const toppedUp = advanceFill(resumed, 0.2);
  assert.equal(toppedUp.level, 0.4);
  assert.equal(isServable(toppedUp), true);
});

test('selecting a different drink empties the old cup', () => {
  const apple = advanceFill(selectDrink(emptyFill(), 'apple juice'), 0.8);
  assert.deepEqual(selectDrink(apple, 'tea'), { drink: 'tea', level: 0, overflowed: false });
});

test('holding past full flags overflow and leaves the cup valid', () => {
  const full = advanceFill(selectDrink(emptyFill(), 'soda'), 1);
  const overflowed = advanceFill(full, 0.1);
  assert.equal(overflowed.level, 1);
  assert.equal(overflowed.overflowed, true);
  assert.equal(isServable(overflowed), true);
});

test('fill level and overflow data have no scoring effect', () => {
  const records = [{ outcome: 'first', patienceLeft: 0.8, replayed: false }];
  const baseline = scoreSession(records);
  const withFillFeedback = scoreSession(records.map((record) => ({
    ...record,
    fillLevel: 0.35,
    overflowed: true,
  })));
  assert.deepEqual(withFillFeedback, baseline);
});
