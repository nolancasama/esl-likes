import test from 'node:test';
import assert from 'node:assert/strict';

import { createTalkDwell } from './talkDwell.js';

const customer = (id = 'a', overrides = {}) => ({
  id,
  x: 0,
  z: 2,
  radiusSq: 9,
  ...overrides,
});

const player = (overrides = {}) => ({
  x: 0,
  z: 0,
  forwardX: 0,
  forwardZ: 1,
  ...overrides,
});

const input = (overrides = {}) => ({
  candidates: [customer()],
  player: player(),
  moving: false,
  lockedTargetId: null,
  ...overrides,
});

test('facing is judged toward lookX/lookZ while the radius stays centred on x/z', () => {
  // The Drink Stand case: the player stands on a window's approach point (the
  // radius centre) and faces the customer behind the counter.
  const standingOn = customer('w', { x: 0, z: 0, radiusSq: 4, lookX: 0, lookZ: 2 });

  const facing = createTalkDwell();
  facing.update(1.2, input({ candidates: [standingOn] }));
  assert.equal(facing.phase, 'ready');

  const turnedAway = createTalkDwell();
  turnedAway.update(1.2, input({ candidates: [standingOn], player: player({ forwardZ: -1 }) }));
  assert.equal(turnedAway.phase, 'idle');

  // Without a look point, facing toward the point you stand on is undefined.
  const withoutLook = createTalkDwell();
  withoutLook.update(1.2, input({ candidates: [customer('w', { x: 0, z: 0, radiusSq: 4 })] }));
  assert.equal(withoutLook.phase, 'idle');
});

test('entering a customer radius while moving never starts a dwell', () => {
  const dwell = createTalkDwell();

  dwell.update(10, input({ moving: true }));

  assert.equal(dwell.phase, 'idle');
  assert.equal(dwell.targetId, null);
  assert.equal(dwell.progress, 0);
});

test('standing still and facing for the dwell duration reaches ready', () => {
  const dwell = createTalkDwell();

  dwell.update(0.6, input());
  assert.equal(dwell.phase, 'dwelling');
  assert.equal(dwell.targetId, 'a');
  assert.equal(dwell.progress, 0.5);

  dwell.update(0.6, input());
  assert.equal(dwell.phase, 'ready');
  assert.equal(dwell.progress, 1);
});

test('moving during a dwell cancels it and resets progress', () => {
  const dwell = createTalkDwell();
  dwell.update(0.5, input());

  dwell.update(0.1, input({ moving: true }));

  assert.equal(dwell.phase, 'idle');
  assert.equal(dwell.targetId, null);
  assert.equal(dwell.progress, 0);
});

test('turning beyond the facing tolerance cancels the dwell', () => {
  const dwell = createTalkDwell();
  dwell.update(0.5, input());

  dwell.update(0.1, input({ player: player({ forwardX: 1, forwardZ: 0 }) }));

  assert.equal(dwell.phase, 'idle');
  assert.equal(dwell.progress, 0);
});

test('a closer and better-faced neighbour cannot steal a dwelling target', () => {
  const dwell = createTalkDwell();
  const original = customer('original', { x: 1, z: 2, radiusSq: 16 });
  const neighbour = customer('neighbour', { x: 2, z: 2, radiusSq: 16 });

  dwell.update(0.4, input({ candidates: [original, neighbour] }));
  assert.equal(dwell.targetId, 'original');

  dwell.update(0.4, input({
    candidates: [original, customer('neighbour', { x: 0, z: 1, radiusSq: 16 })],
  }));

  assert.equal(dwell.phase, 'dwelling');
  assert.equal(dwell.targetId, 'original');
  assert.ok(dwell.progress > 0.6);
});

test('lockedTargetId restricts selection to the clicked customer', () => {
  const dwell = createTalkDwell();
  const nearestFacing = customer('near', { x: 0, z: 1, radiusSq: 16 });
  const clicked = customer('clicked', { x: 2, z: 3, radiusSq: 16 });

  dwell.update(0.2, input({
    candidates: [nearestFacing, clicked],
    lockedTargetId: 'clicked',
  }));

  assert.equal(dwell.phase, 'dwelling');
  assert.equal(dwell.targetId, 'clicked');
});

test('an accepted id is permanently ineligible until reset', () => {
  const dwell = createTalkDwell({ dwellMs: 100 });
  dwell.update(0.1, input());
  assert.equal(dwell.phase, 'ready');

  dwell.notifyAccepted('a');
  dwell.update(100, input());

  assert.equal(dwell.phase, 'idle');
  assert.equal(dwell.targetId, null);

  dwell.reset();
  dwell.update(0.1, input());
  assert.equal(dwell.phase, 'ready');
});

test('a failed target cannot rearm while the player remains still in its radius', () => {
  const dwell = createTalkDwell({ dwellMs: 100, rearmMs: 1000 });
  dwell.update(0.1, input());
  dwell.commit();
  dwell.notifyEnded('a', 'failed');

  dwell.update(60, input());

  assert.equal(dwell.phase, 'idle');
  assert.equal(dwell.targetId, null);
});

test('a failed target rearms only after movement and the full still pause', () => {
  const dwell = createTalkDwell({ dwellMs: 100, rearmMs: 1000 });
  dwell.update(0.1, input());
  dwell.notifyEnded('a', 'failed');

  dwell.update(0.1, input({ moving: true }));
  dwell.update(0.999, input());
  assert.equal(dwell.phase, 'idle');

  dwell.update(0.001, input());
  assert.equal(dwell.phase, 'dwelling');
  assert.equal(dwell.targetId, 'a');
});

test('leaving the failed target radius also begins the rearm pause', () => {
  const dwell = createTalkDwell({ dwellMs: 100, rearmMs: 1000 });
  dwell.update(0.1, input());
  dwell.notifyEnded('a', 'cancelled');

  const outside = input({ player: player({ z: -10 }) });
  dwell.update(0, outside);
  dwell.update(1, outside);
  assert.equal(dwell.phase, 'idle');

  dwell.update(0.1, input());
  assert.equal(dwell.phase, 'ready');
});

test('ready stays ready and never starts another dwell by itself', () => {
  const dwell = createTalkDwell({ dwellMs: 100 });
  dwell.update(0.1, input());

  for (let frame = 0; frame < 10; frame += 1) dwell.update(10, input());

  assert.equal(dwell.phase, 'ready');
  assert.equal(dwell.targetId, 'a');
  assert.equal(dwell.progress, 1);
});

test('commit can immediately promote a manual hold during dwelling', () => {
  const dwell = createTalkDwell();
  dwell.update(0.1, input());

  assert.equal(dwell.commit(), true);
  assert.equal(dwell.phase, 'committed');
  assert.equal(dwell.progress, 1);

  dwell.update(10, input({ moving: true, candidates: [] }));
  assert.equal(dwell.phase, 'committed');
});

test('invalid and non-positive dt do not advance progress, while a huge dt clamps safely', () => {
  const dwell = createTalkDwell();

  for (const dt of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    dwell.update(dt, input());
    assert.equal(dwell.phase, 'dwelling');
    assert.equal(dwell.progress, 0);
  }

  dwell.update(Number.MAX_VALUE, input());
  assert.equal(dwell.phase, 'ready');
  assert.equal(dwell.progress, 1);
  assert.equal(Number.isFinite(dwell.progress), true);
});

test('an unnormalised forward vector works and a zero vector cannot face a target', () => {
  const dwell = createTalkDwell({ dwellMs: 100 });
  dwell.update(0.1, input({ player: player({ forwardZ: 50 }) }));
  assert.equal(dwell.phase, 'ready');

  dwell.reset();
  dwell.update(1, input({ player: player({ forwardX: 0, forwardZ: 0 }) }));
  assert.equal(dwell.phase, 'idle');
});

test('losing the target from the candidate list or leaving its radius cancels', () => {
  const dwell = createTalkDwell();
  dwell.update(0.2, input());
  dwell.update(0.1, input({ candidates: [] }));
  assert.equal(dwell.phase, 'idle');

  dwell.update(0.2, input());
  dwell.update(0.1, input({ player: player({ z: -10 }) }));
  assert.equal(dwell.phase, 'idle');
});
