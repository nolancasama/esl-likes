import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RIVAL_CHALLENGE_CHOICE_DELAY_SECONDS,
  RIVAL_CHALLENGE_REACTION_SECONDS,
  createRivalChallenge,
} from './rivalChallenge.js';
import { RUSH_PLAYER_DELIVERIES, createRushTrigger } from './rushTrigger.js';
import { UI } from '../../config/lesson.js';

function toAwaitingChoices(challenge) {
  challenge.start();
  challenge.arrive();
  challenge.advance(RIVAL_CHALLENGE_CHOICE_DELAY_SECONDS);
}

function runToRush(index) {
  const challenge = createRivalChallenge({ enabled: true });
  toAwaitingChoices(challenge);
  const chosen = challenge.choose(index);
  const events = [];
  for (let step = 0; step < 20; step += 1) events.push(challenge.advance(0.05));
  return { chosen, phase: challenge.phase, paused: challenge.paused, rushEvents: events.filter((e) => e === 'rush').length };
}

test('the third player delivery triggers the challenge on Normal and Challenge only', () => {
  const rivalLevel = createRushTrigger({ enabled: true });
  const results = [];
  for (let index = 0; index < RUSH_PLAYER_DELIVERIES + 2; index += 1) results.push(rivalLevel.recordPlayerDelivery());
  assert.deepEqual(results, [false, false, true, false, false]);

  const challenge = createRivalChallenge({ enabled: true });
  assert.equal(challenge.start(), true);
  assert.equal(challenge.phase, 'entering');
});

test('Easy (no rival) never starts the challenge', () => {
  const trigger = createRushTrigger({ enabled: false });
  for (let index = 0; index < 10; index += 1) assert.equal(trigger.recordPlayerDelivery(), false);
  const challenge = createRivalChallenge({ enabled: false });
  assert.equal(challenge.start(), false);
  assert.equal(challenge.paused, false);
  assert.equal(challenge.phase, 'idle');
});

test('service stays paused from the entrance until the reaction has finished', () => {
  const challenge = createRivalChallenge({ enabled: true });
  assert.equal(challenge.paused, false);
  challenge.start();
  assert.equal(challenge.paused, true);
  challenge.arrive();
  assert.equal(challenge.paused, true);
  // Waiting for a reply never times out.
  for (let step = 0; step < 2000; step += 1) challenge.advance(0.05);
  assert.equal(challenge.phase, 'awaiting');
  assert.equal(challenge.paused, true);
  challenge.choose(0);
  assert.equal(challenge.paused, true);
  challenge.advance(RIVAL_CHALLENGE_REACTION_SECONDS);
  assert.equal(challenge.paused, false);
  assert.equal(challenge.phase, 'done');
});

test('replies appear only after a short beat and cannot be chosen before it', () => {
  const challenge = createRivalChallenge({ enabled: true });
  challenge.start();
  assert.equal(challenge.choose(0), false, 'no reply while walking in');
  challenge.arrive();
  assert.equal(challenge.choicesVisible, false);
  assert.equal(challenge.choose(0), false, 'a queued press cannot answer');
  assert.equal(challenge.advance(RIVAL_CHALLENGE_CHOICE_DELAY_SECONDS), 'choices-shown');
  assert.equal(challenge.choicesVisible, true);
  assert.equal(challenge.selectedResponse, null);
});

test('the rush begins only after a reply and its brief reaction', () => {
  const challenge = createRivalChallenge({ enabled: true });
  toAwaitingChoices(challenge);
  assert.equal(challenge.advance(10), null);
  assert.equal(challenge.choose(1), true);
  assert.equal(challenge.choicesVisible, false, 'choosing dismisses the replies');
  assert.equal(challenge.selectedResponse, 1);
  assert.equal(challenge.advance(RIVAL_CHALLENGE_REACTION_SECONDS / 2), null);
  assert.equal(challenge.advance(RIVAL_CHALLENGE_REACTION_SECONDS / 2), 'rush');
  assert.ok(RIVAL_CHALLENGE_REACTION_SECONDS >= 0.4 && RIVAL_CHALLENGE_REACTION_SECONDS <= 0.7);
});

test('all three replies have the same gameplay outcome', () => {
  const outcomes = [0, 1, 2].map(runToRush);
  for (const outcome of outcomes) {
    assert.deepEqual(outcome, { chosen: true, phase: 'done', paused: false, rushEvents: 1 });
  }
});

test('invalid replies are ignored and a second reply does nothing', () => {
  const challenge = createRivalChallenge({ enabled: true });
  toAwaitingChoices(challenge);
  assert.equal(challenge.choose(3), false);
  assert.equal(challenge.choose(-1), false);
  assert.equal(challenge.choose('0'), false);
  assert.equal(challenge.choose(2), true);
  assert.equal(challenge.choose(0), false);
  assert.equal(challenge.selectedResponse, 2);
});

test('the challenge is one shot per shift', () => {
  const challenge = createRivalChallenge({ enabled: true });
  toAwaitingChoices(challenge);
  assert.equal(challenge.start(), false, 'cannot restart mid-challenge');
  challenge.choose(0);
  challenge.advance(1);
  assert.equal(challenge.start(), false, 'cannot trigger again after the rush');
  assert.equal(challenge.arrive(), false);
  assert.equal(challenge.advance(1), null, 'the rush event fires once');
});

test('the challenge line and replies are Japanese, three replies', () => {
  const strings = UI.restaurant;
  const plain = (text) => text.replace(/\{([^|}]+)\|[^}]+\}/g, '$1').replace(/\n/g, '');
  assert.equal(plain(strings.rivalChallenge), '勝負しよう！どっちがたくさん料理を運べるかな？');
  assert.deepEqual(strings.rivalChallengeReplies.map(plain), ['いいよ！勝負だ！', '負けないよ！', 'がんばるぞ！']);
});
