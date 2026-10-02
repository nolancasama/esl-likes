import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RESTAURANT_ONBOARDING_STEPS,
  createRestaurantOnboarding,
} from './onboarding.js';

test('the first-customer flow advances from approach through delivery', () => {
  const onboarding = createRestaurantOnboarding();

  assert.equal(onboarding.step, RESTAURANT_ONBOARDING_STEPS.APPROACH);
  assert.equal(onboarding.advance('enteredTalkRange'), RESTAURANT_ONBOARDING_STEPS.ASK);
  assert.equal(onboarding.advance('orderTaken'), RESTAURANT_ONBOARDING_STEPS.TO_CONVEYOR);
  assert.equal(onboarding.advance('dishPickedUp'), RESTAURANT_ONBOARDING_STEPS.DELIVER);
  assert.equal(onboarding.advance('correctDelivery'), RESTAURANT_ONBOARDING_STEPS.DONE);
  assert.equal(onboarding.active, false);
});

test('returning the tutorial dish sends guidance back to the conveyor', () => {
  const onboarding = createRestaurantOnboarding();
  onboarding.advance('orderTaken');
  onboarding.advance('dishPickedUp');

  assert.equal(onboarding.advance('dishReturned'), RESTAURANT_ONBOARDING_STEPS.TO_CONVEYOR);
});

test('a resolved tutorial customer ends guidance from any unfinished step', () => {
  for (const events of [[], ['enteredTalkRange'], ['orderTaken'], ['orderTaken', 'dishPickedUp']]) {
    const onboarding = createRestaurantOnboarding();
    for (const event of events) onboarding.advance(event);
    assert.equal(onboarding.advance('customerResolved'), RESTAURANT_ONBOARDING_STEPS.DONE);
  }
});

test('disabled onboarding starts and remains done', () => {
  const onboarding = createRestaurantOnboarding({ enabled: false });
  assert.equal(onboarding.step, RESTAURANT_ONBOARDING_STEPS.DONE);
  assert.equal(onboarding.advance('orderTaken'), RESTAURANT_ONBOARDING_STEPS.DONE);
});
