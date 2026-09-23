import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EXTRA_ROBOT_CHANCE,
  chooseGuaranteedRobotSlot,
  isRobotSlot,
  pickRobotRecord,
} from './robotCasting.js';

function randomSequence(values) {
  let index = 0;
  return () => values[index++];
}

test('no robot slot is reserved when there is no saved artwork', () => {
  let calls = 0;
  const random = () => {
    calls += 1;
    return 0;
  };

  assert.equal(chooseGuaranteedRobotSlot({ savedCount: 0, shiftLength: 8, random }), null);
  assert.equal(isRobotSlot({ index: 0, guaranteedSlot: 0, savedCount: 0, random }), false);
  assert.equal(calls, 0);
});

test('the guaranteed robot is selected uniformly from the first three arrivals', () => {
  const random = randomSequence([0, 1 / 3, 2 / 3, 1]);

  assert.equal(chooseGuaranteedRobotSlot({ savedCount: 1, shiftLength: 9, random }), 0);
  assert.equal(chooseGuaranteedRobotSlot({ savedCount: 1, shiftLength: 9, random }), 1);
  assert.equal(chooseGuaranteedRobotSlot({ savedCount: 1, shiftLength: 9, random }), 2);
  assert.equal(chooseGuaranteedRobotSlot({ savedCount: 1, shiftLength: 9, random }), 2);
});

test('the guaranteed slot is clamped to the shift length', () => {
  assert.equal(chooseGuaranteedRobotSlot({ savedCount: 2, shiftLength: 1, random: () => 0.99 }), 0);
  assert.equal(chooseGuaranteedRobotSlot({ savedCount: 2, shiftLength: 2, random: () => 0.99 }), 1);
  assert.equal(chooseGuaranteedRobotSlot({ savedCount: 2, shiftLength: 0, random: () => 0 }), null);
});

test('the reserved slot is always a robot without a probability roll', () => {
  let calls = 0;
  const random = () => {
    calls += 1;
    return 0.99;
  };

  assert.equal(isRobotSlot({ index: 2, guaranteedSlot: 2, savedCount: 1, random }), true);
  assert.equal(calls, 0);
});

test('non-reserved slots use the 0.25 extra chance by default', () => {
  assert.equal(EXTRA_ROBOT_CHANCE, 0.25);
  assert.equal(isRobotSlot({ index: 1, guaranteedSlot: 0, savedCount: 1, random: () => 0.249 }), true);
  assert.equal(isRobotSlot({ index: 1, guaranteedSlot: 0, savedCount: 1, random: () => 0.25 }), false);
  assert.equal(isRobotSlot({ index: 1, guaranteedSlot: 0, savedCount: 1, random: () => 0.9 }), false);
});

test('pickRobotRecord selects uniformly and preserves record identity', () => {
  const records = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const random = randomSequence([0, 1 / 3, 2 / 3, 1]);

  assert.deepEqual(pickRobotRecord({ records, random }), { record: records[0], index: 0 });
  assert.deepEqual(pickRobotRecord({ records, random }), { record: records[1], index: 1 });
  assert.deepEqual(pickRobotRecord({ records, random }), { record: records[2], index: 2 });
  assert.deepEqual(pickRobotRecord({ records, random }), { record: records[2], index: 2 });
  assert.deepEqual(records, [{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
});

test('pickRobotRecord excludes the previous index when alternatives exist', () => {
  const records = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  assert.deepEqual(
    pickRobotRecord({ records, lastIndex: 1, random: () => 0 }),
    { record: records[0], index: 0 },
  );
  assert.deepEqual(
    pickRobotRecord({ records, lastIndex: 1, random: () => 0.99 }),
    { record: records[2], index: 2 },
  );
  assert.deepEqual(
    pickRobotRecord({ records, lastIndex: 0, random: () => 0 }),
    { record: records[1], index: 1 },
  );
});

test('pickRobotRecord handles one or no saved records', () => {
  const only = { id: 'only' };
  assert.deepEqual(pickRobotRecord({ records: [only], lastIndex: 0 }), { record: only, index: 0 });
  assert.deepEqual(pickRobotRecord({ records: [] }), { record: null, index: -1 });
  assert.deepEqual(pickRobotRecord({}), { record: null, index: -1 });
});
