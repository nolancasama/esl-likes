import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RIVAL_IDS,
  ROUND_TWO,
  competitiveRoundTotal,
  createRivalProgression,
} from './rivalProgression.js';
import { RIVAL_LEVELS } from './rival.js';
import { CONVEYOR_CONFIG, MIN_DISH_SPACING, createConveyor } from './conveyor.js';
import { PATIENCE_SECONDS } from './customerState.js';
import { RUSH_PLAYER_DELIVERIES } from './rushTrigger.js';

const FOODS = ['curry', 'pizza', 'hamburger', 'noodles', 'sushi'];

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

for (const outcome of ['player', 'rival', 'draw']) {
  test(`Round 2 ${outcome} always ends in the final question; no Round 3`, () => {
    const progression = createRivalProgression();
    progression.resolveRound('player');
    progression.startRound2();
    assert.deepEqual(progression.resolveRound(outcome), { next: 'final-question' });
    assert.equal(progression.phase, 'final');
    for (const next of ['player', 'rival', 'draw']) assert.equal(progression.resolveRound(next), null);
    assert.equal(progression.chooseRematch(), null);
    assert.equal(progression.chooseFinish(), null);
    assert.equal(progression.startRound2(), null);
    assert.equal(progression.round, 2);
  });
}

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

for (const level of [2, 3]) {
  test(`Round 2 rival on level ${level} is faster and quicker, not greedier`, () => {
    const first = RIVAL_LEVELS[level];
    const second = ROUND_TWO[level].rival;
    const speedUp = second.speed / first.speed;
    assert.ok(speedUp >= 1.15 && speedUp <= 1.2, `speed ratio ${speedUp}`);
    assert.ok(second.hesitationMin < first.hesitationMin);
    assert.ok(second.hesitationMax < first.hesitationMax);
    assert.ok(second.hesitationMin <= second.hesitationMax);
    assert.ok(second.dishNoticeSeconds < first.dishNoticeSeconds);
    assert.ok(second.minSeatedAge <= first.minSeatedAge);
    assert.ok(second.share <= 0.5);
    assert.ok(second.share <= RIVAL_LEVELS[3].share);
    assert.ok(ROUND_TWO[level].patience < PATIENCE_SECONDS[level]);
    assert.ok(ROUND_TWO[level].patience >= 25 && ROUND_TWO[level].patience <= 28);
    assert.ok(ROUND_TWO[level].tables <= 5);
  });

  test(`Round 2 belt on level ${level} is 15–20% faster than the rush and keeps dish spacing`, () => {
    const rush = CONVEYOR_CONFIG[level].rush;
    const roundTwo = CONVEYOR_CONFIG[level].roundTwo;
    const speedUp = roundTwo.speed / rush.speed;
    assert.ok(speedUp >= 1.15 && speedUp <= 1.2, `belt ratio ${speedUp}`);
    assert.ok(roundTwo.speed * roundTwo.entryInterval >= MIN_DISH_SPACING);
    // Denser: more dishes per metre of belt than the rush.
    assert.ok(roundTwo.speed * roundTwo.entryInterval < rush.speed * rush.entryInterval);
  });
}

test('Round 2 patience is 28 s on Normal and 25 s on Challenge', () => {
  assert.equal(ROUND_TWO[2].patience, 28);
  assert.equal(ROUND_TWO[3].patience, 25);
});

test('startRoundTwo switches the belt from the rush, keeps its dishes and is one-shot', () => {
  const easy = createConveyor({ difficulty: 1, foods: FOODS, rng: () => 0.3 });
  assert.equal(easy.startRoundTwo(), false);
  for (const level of [2, 3]) {
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
