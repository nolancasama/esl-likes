import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BASELINE,
  RIVAL_IDS,
  ROUND_TWO,
  ROUND_THREE,
  RESTAURANT_LEVEL,
  ROUND_THREE_PATIENCE_SCALE,
  competitiveRoundTotal,
  createRivalProgression,
  roundSettings,
} from './rivalProgression.js';
import { RIVAL_LEVELS } from './rival.js';
import { CONVEYOR_CONFIG, MIN_DISH_SPACING, createConveyor } from './conveyor.js';
import { RUSH_PLAYER_DELIVERIES } from './rushTrigger.js';

const FOODS = ['curry', 'pizza', 'hamburger', 'ramen', 'sushi'];

function snapshot(progression) {
  return {
    phase: progression.phase,
    round: progression.round,
    rivalId: progression.rivalId,
    attempt: progression.attempt,
    awaitingChoice: progression.awaitingChoice,
  };
}

test('starts as Round 1 against Waiter 1', () => {
  assert.deepEqual(snapshot(createRivalProgression()), {
    phase: 'round1', round: 1, rivalId: RIVAL_IDS.WAITER_1, attempt: 1, awaitingChoice: false,
  });
});

for (const outcome of ['rival', 'draw']) {
  test(`Round 1 ${outcome} offers rematch or finish and never Waiter 2`, () => {
    const progression = createRivalProgression();
    assert.deepEqual(progression.resolveRound(outcome), { next: 'choice' });
    assert.equal(progression.awaitingChoice, true);
    assert.equal(progression.rivalId, RIVAL_IDS.WAITER_1);
    assert.equal(progression.startRound2(), null);
    assert.equal(progression.rivalId, RIVAL_IDS.WAITER_1);
    // No second result while the choice is open.
    assert.equal(progression.resolveRound('player'), null);
  });
}

test('rematch is Waiter 1 again and repeats without growth beyond the attempt count', () => {
  const progression = createRivalProgression();
  for (let attempt = 2; attempt <= 6; attempt += 1) {
    assert.deepEqual(progression.resolveRound(attempt % 2 ? 'draw' : 'rival'), { next: 'choice' });
    assert.deepEqual(progression.chooseRematch(), { next: 'round1-rematch' });
    assert.deepEqual(snapshot(progression), {
      phase: 'round1', round: 1, rivalId: RIVAL_IDS.WAITER_1, attempt, awaitingChoice: false,
    });
    // The choice is closed again until the next result.
    assert.equal(progression.chooseRematch(), null);
    assert.equal(progression.chooseFinish(), null);
  }
});

test('finish after a loss goes to the final question and nothing follows', () => {
  const progression = createRivalProgression();
  progression.resolveRound('rival');
  assert.deepEqual(progression.chooseFinish(), { next: 'final-question' });
  assert.equal(progression.phase, 'final');
  assert.equal(progression.chooseRematch(), null);
  assert.equal(progression.resolveRound('player'), null);
  assert.equal(progression.startRound2(), null);
});

test('a Round 1 win goes to Waiter 2 with no choice and no question yet', () => {
  const progression = createRivalProgression();
  assert.deepEqual(progression.resolveRound('player'), { next: 'round2-intro' });
  assert.equal(progression.awaitingChoice, false);
  assert.equal(progression.chooseRematch(), null);
  assert.equal(progression.chooseFinish(), null);
  assert.deepEqual(progression.startRound2(), { next: 'round2' });
  assert.equal(progression.round, 2);
  assert.equal(progression.rivalId, RIVAL_IDS.WAITER_2);
  assert.notEqual(RIVAL_IDS.WAITER_2, RIVAL_IDS.WAITER_1);
  assert.equal(progression.startRound2(), null);
});

test('a win after rematches still unlocks Waiter 2', () => {
  const progression = createRivalProgression();
  progression.resolveRound('rival');
  progression.chooseRematch();
  progression.resolveRound('draw');
  progression.chooseRematch();
  assert.deepEqual(progression.resolveRound('player'), { next: 'round2-intro' });
  assert.deepEqual(progression.startRound2(), { next: 'round2' });
  assert.equal(progression.attempt, 3);
});

// Round 3 is a reward for beating Round 2, never an obligation.
for (const outcome of ['rival', 'draw']) {
  test(`Round 2 ${outcome} ends in the final question and never unlocks Round 3`, () => {
    const progression = createRivalProgression();
    progression.resolveRound('player');
    progression.startRound2();
    assert.deepEqual(progression.resolveRound(outcome), { next: 'final-question' });
    assert.equal(progression.phase, 'final');
    for (const next of ['player', 'rival', 'draw']) assert.equal(progression.resolveRound(next), null);
    assert.equal(progression.chooseRematch(), null);
    assert.equal(progression.chooseFinish(), null);
    assert.equal(progression.startRound2(), null);
    assert.equal(progression.startRound3(), null, 'Round 3 cannot be reached without winning Round 2');
    assert.equal(progression.round, 2);
  });
}

test('winning Round 2 advances to Round 3, not to the final question', () => {
  const progression = createRivalProgression();
  progression.resolveRound('player');
  progression.startRound2();
  assert.deepEqual(progression.resolveRound('player'), { next: 'round3-intro' });
  assert.equal(progression.phase, 'round3-intro');
  assert.equal(progression.round, 2, 'the round only turns over when Round 3 starts');
  assert.deepEqual(progression.startRound3(), { next: 'round3' });
  assert.equal(progression.phase, 'round3');
  assert.equal(progression.round, 3);
  assert.equal(progression.rivalId, RIVAL_IDS.WAITER_3, 'Round 3 brings a third waiter');
  assert.notEqual(RIVAL_IDS.WAITER_3, RIVAL_IDS.WAITER_2);
  assert.notEqual(RIVAL_IDS.WAITER_3, RIVAL_IDS.WAITER_1);
});

for (const outcome of ['player', 'rival', 'draw']) {
  test(`Round 3 ${outcome} always ends in the final question; there is no Round 4`, () => {
    const progression = createRivalProgression();
    progression.resolveRound('player');
    progression.startRound2();
    progression.resolveRound('player');
    progression.startRound3();
    assert.deepEqual(progression.resolveRound(outcome), { next: 'final-question' });
    assert.equal(progression.phase, 'final');
    for (const next of ['player', 'rival', 'draw']) assert.equal(progression.resolveRound(next), null);
    assert.equal(progression.chooseRematch(), null);
    assert.equal(progression.chooseFinish(), null);
    assert.equal(progression.startRound2(), null);
    assert.equal(progression.startRound3(), null);
    assert.equal(progression.round, 3, 'the round never reaches 4');
  });
}

test('Round 3 cannot be started out of turn', () => {
  const progression = createRivalProgression();
  assert.equal(progression.startRound3(), null, 'not during Round 1');
  progression.resolveRound('rival');
  assert.equal(progression.startRound3(), null, 'not from the rematch choice');
  progression.chooseRematch();
  progression.resolveRound('player');
  assert.equal(progression.startRound3(), null, 'not from the Round 2 intro');
  progression.startRound2();
  assert.equal(progression.startRound3(), null, 'not during Round 2');
});

test('later rounds no longer ride on the Round 1 warm-up rush trigger', () => {
  const progression = createRivalProgression();
  // Round 1 still gates on the three-delivery rush trigger.
  assert.equal(progression.challengeGateOpen(false), false);
  assert.equal(progression.challengeGateOpen(true), true);

  progression.resolveRound('player');
  progression.startRound2();
  assert.equal(progression.challengeGateOpen(false), true, 'Round 2 depends on progression alone');

  progression.resolveRound('player');
  progression.startRound3();
  assert.equal(progression.challengeGateOpen(false), true, 'Round 3 depends on progression alone');
});

test('Round 3 gives the rival two orders without making it faster or greedier', () => {
  const two = ROUND_TWO.rival;
  const three = ROUND_THREE.rival;
  assert.equal(three.maxActiveOrders, 2, 'the Round 3 rival must juggle two orders');
  assert.equal(three.speed, two.speed, 'Round 3 changed rival speed');
  assert.equal(three.dishNoticeSeconds, two.dishNoticeSeconds);
  assert.equal(three.minSeatedAge, two.minSeatedAge);
  assert.equal(ROUND_THREE.beltTempo, true);
  // Ownership is never rigged: no round overrides the baseline customer share.
  assert.equal(two.share, undefined, 'Round 2 must not override the share');
  assert.equal(three.share, undefined, 'Round 3 must not override the share');
});

test('Rounds 1 and 2 share the baseline patience; only Round 3 shortens it', () => {
  assert.equal(ROUND_TWO.patience, BASELINE.patience,
    'Round 2 must not secretly shorten customer timers');
  const reduction = 1 - (ROUND_THREE.patience / BASELINE.patience);
  assert.ok(reduction >= 0.20 && reduction <= 0.25,
    `Round 3 patience is ${(reduction * 100).toFixed(1)}% shorter, outside 20-25%`);
  assert.equal(ROUND_THREE.patience, Math.round(BASELINE.patience * ROUND_THREE_PATIENCE_SCALE));
});

test('Round 2 keeps the baseline room: only the rival changes', () => {
  assert.equal(ROUND_TWO.tables, BASELINE.tables);
  assert.equal(ROUND_TWO.paceScale, BASELINE.paceScale);
  assert.equal(ROUND_THREE.tables, BASELINE.tables);
  assert.equal(ROUND_THREE.paceScale, BASELINE.paceScale);
});

test('roundSettings selects the right tuning and nothing for Round 1', () => {
  assert.equal(roundSettings(1), null);
  assert.equal(roundSettings(2), ROUND_TWO);
  assert.equal(roundSettings(3), ROUND_THREE);
  assert.equal(roundSettings(4), null, 'there is no Round 4 tuning');
});

test('unknown outcomes change nothing', () => {
  const progression = createRivalProgression();
  for (const outcome of [null, undefined, '', 'win', 3]) assert.equal(progression.resolveRound(outcome), null);
  assert.equal(progression.phase, 'round1');
});

test('rematches and Round 2 are the competitive part of the first shift', () => {
  assert.equal(competitiveRoundTotal(9), 9 - RUSH_PLAYER_DELIVERIES);
  assert.equal(competitiveRoundTotal(13), 13 - RUSH_PLAYER_DELIVERIES);
  assert.equal(competitiveRoundTotal(2), 1);
});

test('the Round 2 rival is faster and quicker, not greedier', () => {
  const first = RIVAL_LEVELS[RESTAURANT_LEVEL];
  const second = ROUND_TWO.rival;
  const speedUp = second.speed / first.speed;
  assert.ok(speedUp >= 1.15 && speedUp <= 1.2, `speed ratio ${speedUp}`);
  assert.ok(second.hesitationMin < first.hesitationMin);
  assert.ok(second.hesitationMax < first.hesitationMax);
  assert.ok(second.hesitationMin <= second.hesitationMax);
  assert.ok(second.dishNoticeSeconds < first.dishNoticeSeconds);
  assert.ok(second.minSeatedAge <= first.minSeatedAge);
});

test('the Round 2 belt is 15-20% faster than the rush and keeps dish spacing', () => {
  const rush = CONVEYOR_CONFIG[RESTAURANT_LEVEL].rush;
  const roundTwo = CONVEYOR_CONFIG[RESTAURANT_LEVEL].roundTwo;
  const speedUp = roundTwo.speed / rush.speed;
  assert.ok(speedUp >= 1.15 && speedUp <= 1.2, `belt ratio ${speedUp}`);
  assert.ok(roundTwo.speed * roundTwo.entryInterval >= MIN_DISH_SPACING);
  // Denser: more dishes per metre of belt than the rush.
  assert.ok(roundTwo.speed * roundTwo.entryInterval < rush.speed * rush.entryInterval);
});

test('startRoundTwo switches the belt from the rush, keeps its dishes and is one-shot', () => {
  const easy = createConveyor({ difficulty: 1, foods: FOODS, rng: () => 0.3 });
  assert.equal(easy.startRoundTwo(), false);
  for (const level of [RESTAURANT_LEVEL]) {
    const conveyor = createConveyor({ difficulty: level, foods: FOODS, rng: () => 0.3 });
    conveyor.advance(6);
    assert.equal(conveyor.startRush(), true);
    conveyor.advance(4);
    const before = conveyor.snapshot().dishes.map((dish) => dish.id);
    assert.equal(conveyor.startRoundTwo(), true);
    const after = conveyor.snapshot();
    assert.equal(after.mode, 'roundTwo');
    assert.equal(after.speed, CONVEYOR_CONFIG[level].roundTwo.speed);
    assert.equal(after.entryInterval, CONVEYOR_CONFIG[level].roundTwo.entryInterval);
    assert.deepEqual(after.dishes.map((dish) => dish.id), before);
    assert.equal(conveyor.startRoundTwo(), false);
    assert.equal(conveyor.startRush(), false);
  }
});
