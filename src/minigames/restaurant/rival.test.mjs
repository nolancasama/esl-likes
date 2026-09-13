import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RIVAL_MIN_HAND_AGE,
  RIVAL_SHARE_CAP,
  RIVAL_SPEED,
  createCustomerClaimRegistry,
  createRestaurantRival,
} from './rival.js';

function makeCustomer(id, food = 'curry', x = 0, prepDuration = 0.5) {
  return { id, food, position: { x, z: 0 }, prepDuration };
}

function setupRival({ customers, initialPosition = { x: 0, z: 0 }, passPosition = { x: 0, z: 0 } }) {
  const registry = createCustomerClaimRegistry();
  for (const customer of customers) {
    registry.registerCustomer(customer);
    registry.raiseHand(customer.id);
  }
  const rival = createRestaurantRival({
    registry,
    initialPosition,
    passPosition,
    rng: () => 0,
  });
  const view = { customers, focusReleasedAgo: Infinity };
  return { registry, rival, view };
}

function runFrames(rival, view, frames = 300, dt = 0.1) {
  const events = [];
  for (let frame = 0; frame < frames; frame += 1) events.push(...rival.advance(dt, view));
  return events;
}

test('rival targets and claims an unclaimed customer only after four service seconds', () => {
  const customer = makeCustomer(1);
  const { rival, registry, view } = setupRival({ customers: [customer] });
  const early = runFrames(rival, view, 39, 0.1);
  assert.equal(registry.getCustomer(1).handAge < RIVAL_MIN_HAND_AGE, true);
  assert.equal(early.some((event) => event.type === 'targetCustomer'), false);
  assert.equal(early.some((event) => event.type === 'claimCustomer'), false);

  const later = runFrames(rival, view, 20, 0.1);
  const targetIndex = later.findIndex((event) => event.type === 'targetCustomer');
  const claimIndex = later.findIndex((event) => event.type === 'claimCustomer');
  assert.ok(targetIndex >= 0);
  assert.ok(claimIndex > targetIndex, 'the target is announced before the arrival claim');
  assert.equal(registry.getCustomer(1).owner, 'rival');
});

test('a player reservation made during the walk forces abandon, then cancellation permits a later claim', () => {
  const customer = makeCustomer(2, 'pizza', RIVAL_SPEED);
  const { rival, registry, view } = setupRival({ customers: [customer] });
  rival.advance(4, view);
  const target = rival.advance(0.3, view);
  assert.equal(target.some((event) => event.type === 'targetCustomer'), true);

  assert.equal(registry.reservePlayer(2), true);
  const arrival = rival.advance(1, view);
  assert.deepEqual(
    arrival.find((event) => event.type === 'abandonTarget'),
    { type: 'abandonTarget', customer: 2, reason: 'reserved' },
  );
  assert.equal(registry.getCustomer(2).owner, null);

  registry.releasePlayerReservation(2);
  rival.advance(0.6, view);
  const claimed = rival.advance(0.01, view);
  assert.equal(claimed.some((event) => event.type === 'claimCustomer'), true);
  assert.equal(registry.getCustomer(2).owner, 'rival');
});

test('the post-focus hold prevents a new arrival claim', () => {
  const customer = makeCustomer(3);
  const { rival, registry, view } = setupRival({ customers: [customer] });
  rival.advance(4, view);
  rival.advance(0.3, view);
  view.focusReleasedAgo = 0.4;
  assert.deepEqual(rival.advance(0.1, view), []);
  assert.equal(registry.getCustomer(3).owner, null);

  view.focusReleasedAgo = 0.8;
  assert.equal(rival.advance(0.01, view).some((event) => event.type === 'claimCustomer'), true);
});

test('rival completes its isolated order lifecycle at its pass using the customer prep duration', () => {
  const customer = makeCustomer(5, 'sushi', 0, 0.4);
  const playerDishes = [{ food: 'sushi', prepRemaining: 9, slot: 2 }];
  const { rival, registry, view } = setupRival({ customers: [customer] });
  view.playerDishes = playerDishes;
  const events = runFrames(rival, view, 200, 0.1);

  const order = events.find((event) => event.type === 'orderTaken');
  const ready = events.find((event) => event.type === 'dishReady');
  const served = events.find((event) => event.type === 'servedCustomer');
  assert.equal(order.prepSeconds, 0.4);
  assert.equal(ready.pass, 'rival');
  assert.equal(Object.hasOwn(ready, 'slot'), false);
  assert.equal(served.owner, 'rival');
  assert.deepEqual(playerDishes, [{ food: 'sushi', prepRemaining: 9, slot: 2 }]);
  assert.equal(registry.getCustomer(5), null);
  assert.deepEqual(rival.counts, { playerServed: 0, rivalServed: 1 });
});

test('rival ignores player-owned customers and repeated foods keep independent dish state', () => {
  const playerCustomer = makeCustomer(20, 'curry', 0, 11);
  const rivalCustomer = makeCustomer(21, 'curry', 0, 0.5);
  const { rival, registry, view } = setupRival({ customers: [playerCustomer, rivalCustomer] });
  registry.reservePlayer(20);
  registry.commitPlayer(20);
  const playerDish = { customer: 20, food: 'curry', prepRemaining: 11, slot: 1 };
  view.playerDishes = [playerDish];

  const events = runFrames(rival, view, 200, 0.1);
  assert.equal(events.some((event) => event.customer === 20), false);
  assert.equal(events.some((event) => event.type === 'servedCustomer' && event.customer === 21), true);
  assert.deepEqual(playerDish, { customer: 20, food: 'curry', prepRemaining: 11, slot: 1 });
  assert.equal(registry.getCustomer(20).owner, 'player');
});

test('zero service dt freezes every rival and registry timer without consuming rng', () => {
  let samples = 0;
  const registry = createCustomerClaimRegistry();
  const customer = makeCustomer(30);
  registry.registerCustomer(customer);
  registry.raiseHand(30);
  const rival = createRestaurantRival({ registry, rng: () => { samples += 1; return 0; } });
  const before = {
    state: rival.state,
    position: rival.position,
    handAge: registry.getCustomer(30).handAge,
  };

  for (let frame = 0; frame < 300; frame += 1) {
    assert.deepEqual(rival.advance(0, { customers: [customer], focusReleasedAgo: 0 }), []);
  }

  assert.deepEqual({
    state: rival.state,
    position: rival.position,
    handAge: registry.getCustomer(30).handAge,
  }, before);
  assert.equal(samples, 0);
});

test('rival abandons its owned task if customer patience resolves to left', () => {
  const customer = makeCustomer(40, 'noodles', 0, 2);
  const { rival, registry, view } = setupRival({ customers: [customer] });
  let claimed = false;
  for (let frame = 0; frame < 100 && !claimed; frame += 1) {
    claimed = rival.advance(0.1, view).some((event) => event.type === 'claimCustomer');
  }
  assert.equal(claimed, true);
  registry.resolveCustomer(40, { outcome: 'left' });
  const events = rival.advance(0.1, view);
  assert.deepEqual(events.find((event) => event.type === 'abandonTask'), {
    type: 'abandonTask', customer: 40, reason: 'left',
  });
  assert.equal(rival.state, 'idle');
  assert.equal(rival.dish, null);
});

test('rival share cap allows three claims and leaves later hands unclaimed', () => {
  const customers = [50, 51, 52, 53].map((id) => makeCustomer(id, 'pizza', 0, 0));
  const { rival, registry, view } = setupRival({ customers });
  const events = runFrames(rival, view, 600, 0.1);
  assert.equal(events.filter((event) => event.type === 'claimCustomer').length, RIVAL_SHARE_CAP);
  assert.equal(events.filter((event) => event.type === 'servedCustomer').length, RIVAL_SHARE_CAP);
  assert.equal(rival.claims, RIVAL_SHARE_CAP);
  assert.equal(registry.getCustomer(53).owner, null);
});

test('Easy and Normal create no active rival', () => {
  for (const level of [1, 2]) {
    const registry = createCustomerClaimRegistry();
    const customer = makeCustomer(level);
    registry.registerCustomer(customer);
    registry.raiseHand(level);
    const rival = createRestaurantRival({ level, registry, rng: () => 0 });
    assert.equal(rival.enabled, false);
    assert.deepEqual(rival.advance(20, { customers: [customer], focusReleasedAgo: Infinity }), []);
    assert.equal(registry.getCustomer(level).owner, null);
    assert.equal(rival.state, 'idle');
  }
});
