import test from 'node:test';
import assert from 'node:assert/strict';

import { createCustomerClaimRegistry } from './claims.js';

test('ownership never transfers between player and rival', () => {
  const claims = createCustomerClaimRegistry();
  claims.registerCustomer({ id: 1, food: 'curry' });
  claims.markSeated(1);
  assert.equal(claims.reservePlayer(1), true);
  assert.equal(claims.commitPlayer(1), true);
  claims.advance(20);
  assert.equal(claims.claimRival(1), false);
  assert.equal(claims.getCustomer(1).owner, 'player');

  claims.registerCustomer({ id: 2, food: 'pizza' });
  claims.markSeated(2);
  claims.advance(4);
  assert.equal(claims.claimRival(2), true);
  assert.equal(claims.reservePlayer(2), false);
  assert.equal(claims.commitPlayer(2), false);
  assert.equal(claims.getCustomer(2).owner, 'rival');
});

test('a player reservation blocks rival claims until it is released', () => {
  const claims = createCustomerClaimRegistry();
  claims.registerCustomer({ id: 4, food: 'sushi' });
  claims.markSeated(4);
  assert.equal(claims.reservePlayer(4), true);

  for (let second = 0; second < 30; second += 1) {
    claims.advance(1);
    assert.equal(claims.claimRival(4), false);
  }

  assert.equal(claims.releasePlayerReservation(4), true);
  assert.equal(claims.claimRival(4), true);
});

test('a newly seated customer can be reserved and committed immediately', () => {
  const claims = createCustomerClaimRegistry();
  claims.registerCustomer({ id: 3, food: 'curry' });

  assert.deepEqual(
    { seated: claims.getCustomer(3).seated, seatedAge: claims.getCustomer(3).seatedAge },
    { seated: false, seatedAge: 0 },
  );
  assert.equal(claims.reservePlayer(3), false);
  assert.equal(claims.markSeated(3), true);
  assert.deepEqual(
    { seated: claims.getCustomer(3).seated, seatedAge: claims.getCustomer(3).seatedAge },
    { seated: true, seatedAge: 0 },
  );
  assert.equal(claims.reservePlayer(3), true);
  assert.equal(claims.commitPlayer(3), true);
  assert.equal(claims.getCustomer(3).owner, 'player');
  assert.equal(claims.markSeated(3), false);
  assert.equal(claims.markSeated(999), false);
});

test('reserving any seated Talk target moves the single player reservation', () => {
  const claims = createCustomerClaimRegistry();
  for (const id of [5, 6, 7]) {
    claims.registerCustomer({ id, food: 'sushi' });
    claims.markSeated(id);
  }
  claims.reservePlayer(5);
  claims.reservePlayer(7);
  assert.equal(claims.reservation, 7);
  assert.equal(claims.getCustomer(5).reservedBy, null);
  assert.equal(claims.getCustomer(6).reservedBy, null);
  assert.equal(claims.getCustomer(7).reservedBy, 'player');
});

test('zero service dt freezes seated age and registry state across repeated frames', () => {
  const claims = createCustomerClaimRegistry();
  claims.registerCustomer({ id: 8, food: 'ramen', position: { x: 2, z: 3 } });
  claims.markSeated(8);
  const before = claims.getCustomer(8);

  for (let frame = 0; frame < 200; frame += 1) {
    assert.deepEqual(claims.advance(0), []);
  }

  assert.equal(claims.serviceTime, 0);
  assert.deepEqual(claims.getCustomer(8), before);
  assert.equal(claims.claimRival(8), false);
});

test('owned customers cannot be reserved', () => {
  const claims = createCustomerClaimRegistry();
  claims.registerCustomer({ id: 20 });
  claims.markSeated(20);
  claims.commitPlayer(20);
  assert.equal(claims.reservePlayer(20), false);

  claims.registerCustomer({ id: 21 });
  claims.markSeated(21);
  claims.advance(4);
  claims.claimRival(21);
  assert.equal(claims.reservePlayer(21), false);
});

test('release returns a reserved customer to unclaimed and rival chooses another available customer', () => {
  const claims = createCustomerClaimRegistry();
  for (const id of [30, 31]) {
    claims.registerCustomer({ id });
    claims.markSeated(id);
  }
  claims.reservePlayer(30);
  claims.advance(4);

  assert.equal(claims.longestWaitingUnclaimed()?.id, 31);
  assert.equal(claims.claimRival(31), true);
  assert.equal(claims.releasePlayerReservation(30), true);
  assert.equal(claims.getCustomer(30).reservedBy, null);
  assert.equal(claims.getCustomer(30).owner, null);
  assert.equal(claims.longestWaitingUnclaimed()?.id, 30);
});

test('rival respects the configured minimum seated age', () => {
  const claims = createCustomerClaimRegistry();
  claims.registerCustomer({ id: 40 });
  claims.markSeated(40);
  claims.advance(5);

  assert.equal(claims.claimRival(40, { minSeatedAge: 6 }), false);
  assert.equal(claims.claimRival(40, { minSeatedAge: 5 }), true);
});

test('longest waiting unclaimed customer is ordered by seated time', () => {
  const claims = createCustomerClaimRegistry();
  claims.registerCustomer({ id: 50 });
  claims.registerCustomer({ id: 51 });
  claims.markSeated(51);
  claims.advance(2);
  claims.markSeated(50);
  claims.advance(4);

  assert.equal(claims.longestWaitingUnclaimed(4)?.id, 51);
  assert.equal(claims.getCustomer(51).seatedAge, 6);
  assert.equal(claims.getCustomer(50).seatedAge, 4);
});

test('resolved customers are removed, replacements start unclaimed, and served counts stay separate', () => {
  const claims = createCustomerClaimRegistry();
  claims.registerCustomer({ id: 10, food: 'pizza' });
  claims.markSeated(10);
  claims.commitPlayer(10);
  assert.equal(claims.resolveCustomer(10, { outcome: 'served' }), true);
  assert.equal(claims.getCustomer(10), null);

  claims.registerCustomer({ id: 11, food: 'pizza' });
  assert.deepEqual(
    { owner: claims.getCustomer(11).owner, reservedBy: claims.getCustomer(11).reservedBy },
    { owner: null, reservedBy: null },
  );
  claims.markSeated(11);
  claims.advance(4);
  claims.claimRival(11);
  claims.resolveCustomer(11, { outcome: 'served' });

  claims.registerCustomer({ id: 12, food: 'curry' });
  claims.resolveCustomer(12, { outcome: 'left' });
  assert.deepEqual(claims.counts, { playerServed: 1, rivalServed: 1 });
  assert.deepEqual(claims.progress, { done: 3 });
});
