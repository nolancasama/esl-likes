import test from 'node:test';
import assert from 'node:assert/strict';

import { createCustomerClaimRegistry } from './claims.js';

test('ownership never transfers between player and rival', () => {
  const claims = createCustomerClaimRegistry();
  claims.registerCustomer({ id: 1, food: 'curry' });
  claims.raiseHand(1);
  assert.equal(claims.reservePlayer(1), true);
  assert.equal(claims.commitPlayer(1), true);
  claims.advance(20);
  assert.equal(claims.claimRival(1), false);
  assert.equal(claims.getCustomer(1).owner, 'player');

  claims.registerCustomer({ id: 2, food: 'pizza' });
  claims.raiseHand(2);
  claims.advance(4);
  assert.equal(claims.claimRival(2), true);
  assert.equal(claims.reservePlayer(2), false);
  assert.equal(claims.commitPlayer(2), false);
  assert.equal(claims.getCustomer(2).owner, 'rival');
});

test('a player reservation blocks rival claims until it is released', () => {
  const claims = createCustomerClaimRegistry();
  claims.registerCustomer({ id: 4, food: 'sushi' });
  claims.raiseHand(4);
  assert.equal(claims.reservePlayer(4), true);

  for (let second = 0; second < 30; second += 1) {
    claims.advance(1);
    assert.equal(claims.claimRival(4), false);
  }

  assert.equal(claims.releasePlayerReservation(4), true);
  assert.equal(claims.claimRival(4), true);
});

test('reserving a new Talk target moves the single player reservation', () => {
  const claims = createCustomerClaimRegistry();
  for (const id of [5, 6]) {
    claims.registerCustomer({ id, food: 'sushi' });
    claims.raiseHand(id);
  }
  claims.reservePlayer(5);
  claims.reservePlayer(6);
  assert.equal(claims.reservation, 6);
  assert.equal(claims.getCustomer(5).reservedBy, null);
  assert.equal(claims.getCustomer(6).reservedBy, 'player');
});

test('zero service dt freezes hand age and registry state across repeated frames', () => {
  const claims = createCustomerClaimRegistry();
  claims.registerCustomer({ id: 7, food: 'noodles', position: { x: 2, z: 3 } });
  claims.raiseHand(7);
  const before = claims.getCustomer(7);

  for (let frame = 0; frame < 200; frame += 1) {
    assert.deepEqual(claims.advance(0), []);
  }

  assert.equal(claims.serviceTime, 0);
  assert.deepEqual(claims.getCustomer(7), before);
  assert.equal(claims.claimRival(7), false);
});

test('resolved customers are removed, replacements start unclaimed, and served counts stay separate', () => {
  const claims = createCustomerClaimRegistry();
  claims.registerCustomer({ id: 10, food: 'pizza' });
  claims.raiseHand(10);
  claims.commitPlayer(10);
  assert.equal(claims.resolveCustomer(10, { outcome: 'served' }), true);
  assert.equal(claims.getCustomer(10), null);

  claims.registerCustomer({ id: 11, food: 'pizza' });
  assert.deepEqual(
    { owner: claims.getCustomer(11).owner, reservedBy: claims.getCustomer(11).reservedBy },
    { owner: null, reservedBy: null },
  );
  claims.raiseHand(11);
  claims.advance(4);
  claims.claimRival(11);
  claims.resolveCustomer(11, { outcome: 'served' });

  claims.registerCustomer({ id: 12, food: 'curry' });
  claims.resolveCustomer(12, { outcome: 'left' });
  assert.deepEqual(claims.counts, { playerServed: 1, rivalServed: 1 });
  assert.deepEqual(claims.progress, { done: 3 });
});
