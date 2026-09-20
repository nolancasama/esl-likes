import test from 'node:test';
import assert from 'node:assert/strict';

import { SAVE_KEY, createProgression } from './progression.js';

/** A minimal in-memory Storage stand-in. */
function fakeStorage(initial = null) {
  const data = new Map();
  if (initial !== null) data.set(SAVE_KEY, JSON.stringify(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    raw: () => JSON.parse(data.get(SAVE_KEY) ?? 'null'),
  };
}

test('a saved noodles answer migrates to ramen on load', () => {
  const storage = fakeStorage({ version: 1, answers: { food: 'noodles' } });
  const progression = createProgression({ storage });
  assert.equal(progression.getAnswer('food'), 'ramen');
});

test('the migrated answer is what gets persisted afterwards', () => {
  const storage = fakeStorage({ version: 1, answers: { food: 'noodles' } });
  const progression = createProgression({ storage });
  // Any write persists the cleaned state.
  progression.setAnswer('color', 'blue');
  assert.equal(storage.raw().answers.food, 'ramen');
  assert.equal(storage.raw().answers.color, 'blue');
});

test('migration touches only the renamed answer', () => {
  const storage = fakeStorage({
    version: 1,
    answers: { food: 'sushi', color: 'red', animal: 'wolf' },
  });
  const progression = createProgression({ storage });
  assert.equal(progression.getAnswer('food'), 'sushi');
  assert.equal(progression.getAnswer('color'), 'red');
  assert.equal(progression.getAnswer('animal'), 'wolf');
});

test('a fresh save is unaffected and noodles can never be written back', () => {
  const storage = fakeStorage();
  const progression = createProgression({ storage });
  assert.equal(progression.getAnswer('food'), null);
  progression.setAnswer('food', 'ramen');
  assert.equal(progression.getAnswer('food'), 'ramen');
  assert.equal(storage.raw().answers.food, 'ramen');
});

test('a corrupt save still loads with defaults rather than throwing', () => {
  const storage = {
    getItem: () => '{not json',
    setItem: () => {},
  };
  const progression = createProgression({ storage });
  assert.equal(progression.getAnswer('food'), null);
  assert.equal(progression.getSettings().difficulty, 1);
});

// The Restaurant ignores the global difficulty, but the setting itself must
// keep working for the other minigames.
for (const difficulty of [1, 2, 3]) {
  test(`difficulty ${difficulty} survives a load/save round trip for other games`, () => {
    const storage = fakeStorage({ version: 1, settings: { difficulty } });
    const progression = createProgression({ storage });
    assert.equal(progression.getSettings().difficulty, difficulty);
  });
}
