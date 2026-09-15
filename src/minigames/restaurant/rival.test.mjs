import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RIVAL_SHARE_CAP,
  RIVAL_SPEED,
  createCustomerClaimRegistry,
  createRestaurantRival,
} from './rival.js';

function makeCustomer(id, food = 'curry', x = 0) {
  return { id, food, position: { x, z: 0 } };
}

function makeConveyor({ dishes = [], visibleHalfWidth = 6.6, speed = 0, direction = -1 } = {}) {
  let beltDishes = dishes.map((dish) => ({ ...dish }));
  let snapshotCalls = 0;
  let takeCalls = 0;
  return {
    advance(dt) {
      for (const dish of beltDishes) dish.x += speed * direction * dt;
      beltDishes = beltDishes.filter((dish) => Math.abs(dish.x) <= visibleHalfWidth);
    },
    add(dish) {
      beltDishes.push({ ...dish });
    },
    take(dishId) {
      takeCalls += 1;
      const index = beltDishes.findIndex((dish) => dish.id === dishId);
      if (index < 0 || Math.abs(beltDishes[index].x) > visibleHalfWidth) return null;
      return { ...beltDishes.splice(index, 1)[0] };
    },
    snapshot() {
      snapshotCalls += 1;
      return {
        dishes: beltDishes.map((dish) => ({ ...dish })),
        visibleHalfWidth,
        speed,
        direction,
      };
    },
    predictX(dishId, seconds) {
      const dish = beltDishes.find((candidate) => candidate.id === dishId);
      return dish ? dish.x + (speed * direction * seconds) : null;
    },
    get snapshotCalls() { return snapshotCalls; },
    get takeCalls() { return takeCalls; },
  };
}

function setupRival({
  customers,
  conveyor = makeConveyor(),
  initialPosition = { x: 0, z: 0 },
  options = {},
} = {}) {
  const registry = createCustomerClaimRegistry();
  for (const customer of customers) {
    registry.registerCustomer(customer);
    registry.raiseHand(customer.id);
  }
  const rival = createRestaurantRival({
    registry,
    conveyor,
    initialPosition,
    rng: () => 0,
    ...options,
  });
  const view = { customers, focusReleasedAgo: Infinity };
  return { registry, rival, conveyor, view };
}

function advance(rival, view, conveyor, dt) {
  conveyor?.advance(dt);
  return rival.advance(dt, view);
}

function reachWatchingBelt(setup) {
  const { rival, view, conveyor } = setup;
  advance(rival, view, conveyor, 4);
  advance(rival, view, conveyor, 0.3);
  advance(rival, view, conveyor, 0.01);
  const events = advance(rival, view, conveyor, 1.2);
  assert.equal(events.some((event) => event.type === 'orderTaken'), true);
  assert.equal(rival.state, 'watchingBelt');
}

function runFrames(setup, frames = 300, dt = 0.1) {
  const events = [];
  for (let frame = 0; frame < frames; frame += 1) {
    events.push(...advance(setup.rival, setup.view, setup.conveyor, dt));
  }
  return events;
}

test('rival targets a matching dish only after noticing it for 0.6 service seconds', () => {
  const setup = setupRival({ customers: [makeCustomer(1)] });
  reachWatchingBelt(setup);
  setup.conveyor.add({ id: 10, food: 'curry', x: 0 });

  const early = [];
  for (let step = 0; step < 6; step += 1) {
    early.push(...advance(setup.rival, setup.view, setup.conveyor, 0.1));
  }
  assert.equal(early.some((event) => event.type === 'targetDish'), false);

  const target = advance(setup.rival, setup.view, setup.conveyor, 0.01)
    .find((event) => event.type === 'targetDish');
  assert.equal(target.dishId, 10);
  assert.equal(target.food, 'curry');
});

test('dish walk duration is distance divided by 4.25', () => {
  const setup = setupRival({ customers: [makeCustomer(2)] });
  reachWatchingBelt(setup);
  setup.conveyor.add({ id: 20, food: 'curry', x: 0 });
  advance(setup.rival, setup.view, setup.conveyor, 0.6);
  const target = advance(setup.rival, setup.view, setup.conveyor, 0.01)
    .find((event) => event.type === 'targetDish');

  assert.equal(RIVAL_SPEED, 4.25);
  assert.ok(Math.abs(target.duration - (4.4 / RIVAL_SPEED)) < 1e-10);
  assert.deepEqual(target.position, { x: 0, z: -4.4 });
});

test('player taking a targeted dish makes the rival abandon it and later target another match', () => {
  const setup = setupRival({ customers: [makeCustomer(3, 'pizza')] });
  reachWatchingBelt(setup);
  setup.conveyor.add({ id: 30, food: 'pizza', x: 0 });
  advance(setup.rival, setup.view, setup.conveyor, 0.6);
  assert.equal(advance(setup.rival, setup.view, setup.conveyor, 0.01)
    .some((event) => event.type === 'targetDish'), true);

  assert.equal(setup.conveyor.take(30).id, 30);
  setup.conveyor.add({ id: 31, food: 'pizza', x: 0 });
  const abandoned = advance(setup.rival, setup.view, setup.conveyor, 0.01);
  assert.deepEqual(abandoned.find((event) => event.type === 'abandonDish'), {
    type: 'abandonDish', customer: 3, dishId: 30, reason: 'taken',
  });

  advance(setup.rival, setup.view, setup.conveyor, 0.6);
  const retarget = advance(setup.rival, setup.view, setup.conveyor, 0.01)
    .find((event) => event.type === 'targetDish');
  assert.equal(retarget.dishId, 31);
});

test('rival arriving first takes the shared dish and exactly one waiter succeeds', () => {
  const setup = setupRival({ customers: [makeCustomer(4, 'sushi')] });
  reachWatchingBelt(setup);
  setup.conveyor.add({ id: 40, food: 'sushi', x: 0 });
  advance(setup.rival, setup.view, setup.conveyor, 0.6);
  const target = advance(setup.rival, setup.view, setup.conveyor, 0.01)
    .find((event) => event.type === 'targetDish');
  const pickup = advance(
    setup.rival, setup.view, setup.conveyor, target.delay + target.duration,
  ).find((event) => event.type === 'pickUpDish');

  assert.equal(pickup.dishId, 40);
  assert.deepEqual(setup.rival.carriedDish, { dishId: 40, food: 'sushi' });
  assert.equal(setup.conveyor.take(40), null);
  assert.equal(setup.conveyor.takeCalls, 2);
});

test('rival ignores non-matching foods and dishes it cannot reach before exit', () => {
  const conveyor = makeConveyor({
    dishes: [
      { id: 50, food: 'pizza', x: 0 },
      { id: 51, food: 'curry', x: -6.5 },
    ],
    speed: 10,
    direction: -1,
  });
  const setup = setupRival({ customers: [makeCustomer(5, 'curry')], conveyor });
  reachWatchingBelt(setup);
  const events = runFrames(setup, 20, 0.1);
  assert.equal(events.some((event) => event.type === 'targetDish'), false);
  assert.equal(setup.rival.targetDishId, null);
});

test('customer leaving while the rival carries discards the dish', () => {
  const setup = setupRival({ customers: [makeCustomer(6, 'noodles')] });
  reachWatchingBelt(setup);
  setup.conveyor.add({ id: 60, food: 'noodles', x: 0 });
  advance(setup.rival, setup.view, setup.conveyor, 0.6);
  const target = advance(setup.rival, setup.view, setup.conveyor, 0.01)
    .find((event) => event.type === 'targetDish');
  advance(setup.rival, setup.view, setup.conveyor, target.delay + target.duration);
  assert.deepEqual(setup.rival.carriedDish, { dishId: 60, food: 'noodles' });

  setup.registry.resolveCustomer(6, { outcome: 'left' });
  const events = advance(setup.rival, setup.view, setup.conveyor, 0.01);
  assert.deepEqual(events.find((event) => event.type === 'abandonTask'), {
    type: 'abandonTask',
    customer: 6,
    reason: 'left',
    discardedDish: { dishId: 60, food: 'noodles' },
  });
  assert.equal(setup.rival.carriedDish, null);
  assert.equal(setup.rival.state, 'idle');
});

test('zero and invalid service dt fully freeze the model and belt access', () => {
  let samples = 0;
  const conveyor = makeConveyor({ dishes: [{ id: 70, food: 'curry', x: 0 }] });
  const registry = createCustomerClaimRegistry();
  const customer = makeCustomer(7);
  registry.registerCustomer(customer);
  registry.raiseHand(7);
  const rival = createRestaurantRival({
    registry, conveyor, rng: () => { samples += 1; return 0; },
  });
  const before = { state: rival.state, position: rival.position, handAge: registry.getCustomer(7).handAge };

  for (const dt of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.deepEqual(rival.advance(dt, { customers: [customer], focusReleasedAgo: 0 }), []);
  }
  assert.deepEqual(
    { state: rival.state, position: rival.position, handAge: registry.getCustomer(7).handAge },
    before,
  );
  assert.equal(samples, 0);
  assert.equal(conveyor.snapshotCalls, 0);
  assert.equal(conveyor.takeCalls, 0);
});

test('rival share cap allows exactly three claims and serves', () => {
  const customers = [80, 81, 82, 83].map((id) => makeCustomer(id, 'pizza'));
  const dishes = Array.from({ length: 6 }, (_, index) => ({
    id: 800 + index, food: 'pizza', x: index - 2,
  }));
  const setup = setupRival({ customers, conveyor: makeConveyor({ dishes }) });
  const events = runFrames(setup, 800, 0.1);

  assert.equal(events.filter((event) => event.type === 'claimCustomer').length, RIVAL_SHARE_CAP);
  assert.equal(events.filter((event) => event.type === 'servedCustomer').length, RIVAL_SHARE_CAP);
  assert.equal(setup.rival.claims, RIVAL_SHARE_CAP);
  assert.equal(setup.registry.getCustomer(83).owner, null);
  assert.deepEqual(setup.rival.counts, { playerServed: 0, rivalServed: 3 });
});

test('Easy and Normal create no active rival', () => {
  for (const level of [1, 2]) {
    const registry = createCustomerClaimRegistry();
    const customer = makeCustomer(level);
    registry.registerCustomer(customer);
    registry.raiseHand(level);
    const rival = createRestaurantRival({ level, registry, rng: () => 0 });
    assert.equal(rival.enabled, false);
    assert.deepEqual(rival.advance(20, { customers: [customer] }), []);
    assert.equal(registry.getCustomer(level).owner, null);
    assert.equal(rival.state, 'idle');
  }
});
