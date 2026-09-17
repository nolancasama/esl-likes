import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RUSH_PLAYER_DELIVERIES,
  competitionOutcome,
  createCompetitionScore,
  createRushTrigger,
} from './rushTrigger.js';

test('competition outcome is player win, rival win or draw, and none without a rival', () => {
  assert.equal(competitionOutcome({ player: 4, rival: 2 }), 'player');
  assert.equal(competitionOutcome({ player: 1, rival: 3 }), 'rival');
  assert.equal(competitionOutcome({ player: 2, rival: 2 }), 'draw');
  assert.equal(competitionOutcome({ player: 0, rival: 0 }), 'draw');
  assert.equal(competitionOutcome(null), null);
});

test('the outcome uses the competition score, not the solo deliveries', () => {
  const competition = createCompetitionScore();
  competition.capture({ playerServed: 3, rivalServed: 0 });
  // 5 served in all beats the rival's 3, but head to head it is 2–3.
  assert.equal(competitionOutcome(competition.score({ playerServed: 5, rivalServed: 3 })), 'rival');
});

test('competition score is hidden until the baseline is captured', () => {
  const competition = createCompetitionScore();
  assert.equal(competition.score({ playerServed: 2, rivalServed: 0 }), null);
  assert.equal(competition.baseline, null);
});

test('competition score starts 0–0 from the served totals at rush start', () => {
  const competition = createCompetitionScore();
  assert.equal(competition.capture({ playerServed: 3, rivalServed: 0 }), true);
  assert.deepEqual(competition.score({ playerServed: 3, rivalServed: 0 }), { player: 0, rival: 0 });
  assert.deepEqual(competition.score({ playerServed: 4, rivalServed: 0 }), { player: 1, rival: 0 });
  assert.deepEqual(competition.score({ playerServed: 4, rivalServed: 1 }), { player: 1, rival: 1 });
});

test('the baseline is captured once and uses the real counts, not a fixed 3', () => {
  const competition = createCompetitionScore();
  competition.capture({ playerServed: 5, rivalServed: 2 });
  assert.equal(competition.capture({ playerServed: 9, rivalServed: 4 }), false);
  assert.deepEqual(competition.baseline, { player: 5, rival: 2 });
  assert.deepEqual(competition.score({ playerServed: 9, rivalServed: 4 }), { player: 4, rival: 2 });
});

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
