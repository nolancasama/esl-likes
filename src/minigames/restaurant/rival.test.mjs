import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RIVAL_LEVELS,
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
    registry.markSeated(customer.id);
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

test('dish walk duration uses the instance speed', () => {
  const speed = 2;
  const setup = setupRival({
    customers: [makeCustomer(2)],
    options: { speed },
  });
  reachWatchingBelt(setup);
  setup.conveyor.add({ id: 20, food: 'curry', x: 0 });
  advance(setup.rival, setup.view, setup.conveyor, 0.6);
  const target = advance(setup.rival, setup.view, setup.conveyor, 0.01)
    .find((event) => event.type === 'targetDish');

  assert.equal(RIVAL_SPEED, 4.4);
  assert.ok(Math.abs(target.duration - (4.4 / speed)) < 1e-10);
  assert.equal(target.speed, speed);
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
  registry.markSeated(7);
  const rival = createRestaurantRival({
    registry, conveyor, rng: () => { samples += 1; return 0; },
  });
  const before = {
    state: rival.state,
    position: rival.position,
    seatedAge: registry.getCustomer(7).seatedAge,
  };

  for (const dt of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.deepEqual(rival.advance(dt, { customers: [customer], focusReleasedAgo: 0 }), []);
  }
  assert.deepEqual(
    {
      state: rival.state,
      position: rival.position,
      seatedAge: registry.getCustomer(7).seatedAge,
    },
    before,
  );
  assert.equal(samples, 0);
  assert.equal(conveyor.snapshotCalls, 0);
  assert.equal(conveyor.takeCalls, 0);
});

test('Challenge claim limit follows its share and the rival keeps claiming past three', () => {
  const customers = [80, 81, 82, 83, 84, 85, 86].map((id) => makeCustomer(id, 'pizza'));
  const dishes = Array.from({ length: 8 }, (_, index) => ({
    id: 800 + index, food: 'pizza', x: index - 2,
  }));
  const setup = setupRival({
    customers,
    conveyor: makeConveyor({ dishes }),
    options: { total: 13 },
  });
  const events = runFrames(setup, 1400, 0.1);

  assert.equal(RIVAL_LEVELS[3].share, 0.5);
  assert.equal(setup.rival.claimLimit, 7);
  assert.equal(events.filter((event) => event.type === 'claimCustomer').length, 7);
  assert.equal(events.filter((event) => event.type === 'servedCustomer').length, 7);
  assert.equal(setup.rival.claims, 7);
  assert.equal(setup.registry.getCustomer(86), null);
  assert.deepEqual(setup.rival.counts, { playerServed: 0, rivalServed: 7 });
});

test('level 1 and unknown levels default to inert', () => {
  for (const level of [1, 99]) {
    const registry = createCustomerClaimRegistry();
    const customer = makeCustomer(level);
    registry.registerCustomer(customer);
    registry.markSeated(level);
    const rival = createRestaurantRival({ level, registry, rng: () => 0 });
    assert.equal(rival.enabled, false);
    assert.deepEqual(rival.advance(20, { customers: [customer] }), []);
    assert.equal(registry.getCustomer(level).owner, null);
    assert.equal(rival.state, 'idle');
  }
});

test('Normal is enabled with a claim limit based on its configured share', () => {
  const registry = createCustomerClaimRegistry();
  const rival = createRestaurantRival({ level: 2, total: 9, registry, rng: () => 0 });

  assert.equal(rival.enabled, true);
  assert.deepEqual(RIVAL_LEVELS[2], {
    enabled: true,
    speed: 3.6,
    minSeatedAge: 7,
    share: 0.35,
    hesitationMin: 0.8,
    hesitationMax: 1.5,
    dishNoticeSeconds: 1,
  });
  assert.equal(rival.claimLimit, 3);
});

test('dish notice time comes from the level unless explicitly overridden', () => {
  const normal = setupRival({
    customers: [makeCustomer(91)],
    options: { level: 2, minSeatedAge: 0, hesitationMin: 0, hesitationMax: 0 },
  });
  reachWatchingBelt(normal);
  normal.conveyor.add({ id: 910, food: 'curry', x: 0 });
  advance(normal.rival, normal.view, normal.conveyor, 0.99);
  assert.equal(
    advance(normal.rival, normal.view, normal.conveyor, 0.001)
      .some((event) => event.type === 'targetDish'),
    false,
  );
  assert.equal(
    advance(normal.rival, normal.view, normal.conveyor, 0.01)
      .some((event) => event.type === 'targetDish'),
    false,
  );
  assert.equal(
    advance(normal.rival, normal.view, normal.conveyor, 0.001)
      .some((event) => event.type === 'targetDish'),
    true,
  );

  const overridden = setupRival({
    customers: [makeCustomer(92)],
    options: {
      level: 2,
      dishNoticeSeconds: 0.2,
      minSeatedAge: 0,
      hesitationMin: 0,
      hesitationMax: 0,
    },
  });
  reachWatchingBelt(overridden);
  overridden.conveyor.add({ id: 920, food: 'curry', x: 0 });
  advance(overridden.rival, overridden.view, overridden.conveyor, 0.2);
  assert.equal(
    advance(overridden.rival, overridden.view, overridden.conveyor, 0.001)
      .some((event) => event.type === 'targetDish'),
    true,
  );
});

test('rival respects its configured minimum seated age', () => {
  const setup = setupRival({
    customers: [makeCustomer(90)],
    options: {
      minSeatedAge: 8,
      hesitationMin: 0,
      hesitationMax: 0,
    },
  });

  advance(setup.rival, setup.view, setup.conveyor, 7.9);
  const tooEarly = advance(setup.rival, setup.view, setup.conveyor, 0.09);
  assert.equal(tooEarly.some((event) => event.type === 'targetCustomer'), false);

  advance(setup.rival, setup.view, setup.conveyor, 0.01);
  const eligible = advance(setup.rival, setup.view, setup.conveyor, 0.01);
  assert.equal(eligible.some((event) => event.type === 'targetCustomer'), true);
});
