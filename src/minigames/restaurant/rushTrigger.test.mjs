import test from 'node:test';
import assert from 'node:assert/strict';

import { RUSH_PLAYER_DELIVERIES, createRushTrigger } from './rushTrigger.js';

test('disabled trigger never counts or starts a rush', () => {
  const trigger = createRushTrigger({ enabled: false });
  for (let index = 0; index < 5; index += 1) assert.equal(trigger.recordPlayerDelivery(), false);
  assert.equal(trigger.playerDeliveries, 0);
  assert.equal(trigger.triggered, false);
});

test('enabled trigger fires exactly once on the third player delivery', () => {
  const trigger = createRushTrigger({ enabled: true });
  assert.equal(RUSH_PLAYER_DELIVERIES, 3);
  assert.equal(trigger.recordPlayerDelivery(), false);
  assert.equal(trigger.recordPlayerDelivery(), false);
  assert.equal(trigger.triggered, false);
  assert.equal(trigger.recordPlayerDelivery(), true);
  assert.equal(trigger.triggered, true);
  assert.equal(trigger.recordPlayerDelivery(), false);
  assert.equal(trigger.recordPlayerDelivery(), false);
  assert.equal(trigger.playerDeliveries, 5);
});
