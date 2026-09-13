import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FOODS,
  advanceRefusalLock,
  pickFood,
  scoreSession,
} from './scoring.js';

function delivered(overrides = {}) {
  return {
    delivered: true,
    firstTry: true,
    temperatureScore: 3,
    patienceAtDelivery: 1,
    listenedAgain: false,
    ...overrides,
  };
}

test('a perfect first-try session earns three stars', () => {
  const result = scoreSession([
    delivered(),
    delivered(),
    delivered(),
  ]);

  assert.equal(result.earned, 30);
  assert.equal(result.maximum, 30);
  assert.equal(result.ratio, 1);
  assert.equal(result.stars, 3);
  assert.equal(result.firstTryCount, 3);
  assert.equal(result.firstTryShare, 1);
});

test('correct second-attempt deliveries score lower than first-try deliveries', () => {
  const firstTry = scoreSession([delivered(), delivered(), delivered()]);
  const secondAttempt = scoreSession([
    delivered({ firstTry: false }),
    delivered({ firstTry: false }),
    delivered({ firstTry: false }),
  ]);

  assert.ok(secondAttempt.earned < firstTry.earned);
  assert.equal(secondAttempt.earned, 21);
  assert.equal(secondAttempt.stars, 2);
  assert.equal(secondAttempt.firstTryCount, 0);
});

test('Listen Again costs only the memory bonus and never normal delivery credit', () => {
  const withoutReplay = scoreSession([delivered()]);
  const withReplay = scoreSession([delivered({ listenedAgain: true })]);

  assert.equal(withoutReplay.earned - withReplay.earned, 1);
  assert.equal(withReplay.firstTryCount, withoutReplay.firstTryCount);
  assert.equal(withReplay.firstTryShare, withoutReplay.firstTryShare);
  assert.equal(withReplay.earned, 9);
  assert.equal(withReplay.stars, 3);
});

test('cold food still earns correct-delivery credit', () => {
  const result = scoreSession([delivered({ temperatureScore: 1 })]);

  assert.equal(result.earned, 8);
  assert.equal(result.firstTryCount, 1);
  assert.equal(result.stars, 3);
});

test('a customer who left earns nothing', () => {
  const result = scoreSession([
    delivered(),
    {
      delivered: false,
      firstTry: true,
      temperatureScore: 3,
      patienceAtDelivery: 1,
      listenedAgain: false,
    },
  ]);

  assert.equal(result.earned, 10);
  assert.equal(result.maximum, 20);
  assert.equal(result.firstTryCount, 1);
  assert.equal(result.firstTryShare, 0.5);
});

test('first-try share below one half caps an otherwise three-star score', () => {
  const result = scoreSession([
    delivered(),
    delivered({ firstTry: false }),
    delivered({ firstTry: false }),
  ]);

  assert.ok(result.ratio >= 0.75);
  assert.ok(result.firstTryShare < 0.5);
  assert.equal(result.stars, 2);
});

test('food choices are independent and allow repeats', () => {
  const choosePizza = () => 0.25;

  assert.equal(pickFood(choosePizza), 'pizza');
  assert.equal(pickFood(choosePizza), 'pizza');
  assert.deepEqual(
    [0, 0.2, 0.4, 0.6, 0.8].map((sample) => pickFood(() => sample)),
    FOODS,
  );
});

test('refusal locks advance only by supplied service time and stop at zero', () => {
  assert.equal(advanceRefusalLock(5, 0), 5);
  assert.equal(advanceRefusalLock(5, 1.25), 3.75);
  assert.equal(advanceRefusalLock(3.75, 10), 0);
});
