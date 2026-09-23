import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EXTRA_CREATION_CHANCE,
  chooseCreationSlots,
  pickCreation,
} from './creationCasting.js';

function randomSequence(values) {
  let index = 0;
  return () => values[index++];
}

function seeded(seed) {
  let state = Math.imul(seed, 2654435761) >>> 0;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  for (let warm = 0; warm < 8; warm += 1) next();
  return next;
}

test('zero eligible creations yields no paper slots and consumes no randomness', () => {
  let calls = 0;
  const random = () => { calls += 1; return 0; };

  assert.deepEqual(chooseCreationSlots({ slots: 8, eligibleCount: 0, random }), []);
  assert.deepEqual(chooseCreationSlots({ slots: 0, eligibleCount: 2, random }), []);
  assert.equal(calls, 0);
});

test('the guarantee is explicitly reserved inside the early window', () => {
  for (let seed = 1; seed <= 200; seed += 1) {
    const slots = chooseCreationSlots({
      slots: 7,
      eligibleCount: 1,
      extraChance: 0,
      random: seeded(seed),
    });
    assert.equal(slots.length, 1, `seed ${seed} lost the guaranteed creation`);
    assert.ok(slots[0] >= 0 && slots[0] <= 2);
  }
});

test('the reserved slot varies and clamps to the session length', () => {
  const early = new Set();
  for (let seed = 1; seed <= 200; seed += 1) {
    early.add(chooseCreationSlots({
      slots: 7,
      eligibleCount: 1,
      extraChance: 0,
      random: seeded(seed),
    })[0]);
  }
  assert.deepEqual([...early].sort(), [0, 1, 2]);
  assert.deepEqual(chooseCreationSlots({
    slots: 1, eligibleCount: 1, extraChance: 0, random: () => 0.99,
  }), [0]);
  assert.deepEqual(chooseCreationSlots({
    slots: 2, eligibleCount: 1, extraChance: 0, random: () => 0.99,
  }), [1]);
});

test('reserved slots do not need a probability roll and extra slots do', () => {
  assert.equal(EXTRA_CREATION_CHANCE, 0.25);
  const random = randomSequence([0.5, 0.249, 0.25, 0.9]);
  assert.deepEqual(chooseCreationSlots({
    slots: 3,
    eligibleCount: 1,
    earlyWindow: 1,
    random,
  }), [0, 1]);

  assert.deepEqual(chooseCreationSlots({
    slots: 3,
    eligibleCount: 1,
    guaranteed: 0,
    random: randomSequence([0.249, 0.25, 0.9]),
  }), [0]);
});

test('humans remain the clear majority over seeded sessions', () => {
  let paper = 0;
  let total = 0;
  for (let seed = 1; seed <= 400; seed += 1) {
    paper += chooseCreationSlots({
      slots: 7, eligibleCount: 5, random: seeded(seed),
    }).length;
    total += 7;
  }
  const share = paper / total;
  assert.ok(share > 0.1, `paper characters are too rare at ${share}`);
  assert.ok(share < 0.45, `paper characters stopped being the exception at ${share}`);
});

test('pickCreation uses every unused record before repeating', () => {
  const records = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const used = new Set();
  let lastIndex = -1;
  const picked = [];

  for (let visit = 0; visit < records.length; visit += 1) {
    const choice = pickCreation({ records, used, lastIndex, random: () => 0 });
    picked.push(choice.index);
    used.add(choice.index);
    lastIndex = choice.index;
  }

  assert.deepEqual(picked.sort(), [0, 1, 2]);
  assert.deepEqual(records, [{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
});

test('pickCreation excludes the previous record when alternatives exist', () => {
  const records = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.deepEqual(
    pickCreation({ records, lastIndex: 1, random: () => 0 }),
    { record: records[0], index: 0 },
  );
  assert.deepEqual(
    pickCreation({ records, lastIndex: 1, random: () => 0.99 }),
    { record: records[2], index: 2 },
  );
});

test('pickCreation is pure and handles one or no records', () => {
  const records = Object.freeze([{ id: 'a' }, { id: 'b' }]);
  const used = new Set([0, 1]);
  const before = [...used];
  assert.equal(pickCreation({ records, used, lastIndex: 0, random: () => 0 }).index, 1);
  assert.deepEqual([...used], before);

  const only = { id: 'only' };
  assert.deepEqual(pickCreation({ records: [only], lastIndex: 0 }), { record: only, index: 0 });
  assert.deepEqual(pickCreation({ records: [] }), { record: null, index: -1 });
  assert.deepEqual(pickCreation({}), { record: null, index: -1 });
});
