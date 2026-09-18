import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RIVAL_CHALLENGE_REACTION_SECONDS,
  RIVAL_REVEAL_TIMING,
  createRivalChallenge,
} from './rivalChallenge.js';
import { RUSH_PLAYER_DELIVERIES, createRushTrigger } from './rushTrigger.js';

function eventTypes(events) {
  return events.map(({ type }) => type);
}

function reachTyping(challenge) {
  challenge.start();
  challenge.arrive();
  return challenge.advance(
    RIVAL_REVEAL_TIMING.turn
      + RIVAL_REVEAL_TIMING.reveal
      + RIVAL_REVEAL_TIMING.return,
  );
}

function reachChoices(challenge) {
  reachTyping(challenge);
  challenge.completeTyping();
}

function runToRush(index) {
  const challenge = createRivalChallenge({ enabled: true });
  reachChoices(challenge);
  const chosen = challenge.choose(index);
  const events = challenge.advance(RIVAL_CHALLENGE_REACTION_SECONDS);
  return {
    chosen,
    phase: challenge.phase,
    paused: challenge.paused,
    rushEvents: events.filter(({ type }) => type === 'rush').length,
  };
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

test('turn, reveal, and return use the exported durations in order', () => {
  assert.deepEqual(RIVAL_REVEAL_TIMING, { turn: 0.2, reveal: 2, return: 0.8 });
  const challenge = createRivalChallenge({ enabled: true });
  challenge.start();
  assert.equal(challenge.arrive(), true);
  assert.equal(challenge.phase, 'turning');

  assert.deepEqual(challenge.advance(RIVAL_REVEAL_TIMING.turn - 0.01), []);
  assert.equal(challenge.phase, 'turning');
  assert.deepEqual(eventTypes(challenge.advance(0.01)), ['reveal']);
  assert.equal(challenge.phase, 'reveal');

  assert.deepEqual(challenge.advance(RIVAL_REVEAL_TIMING.reveal - 0.01), []);
  assert.deepEqual(eventTypes(challenge.advance(0.01)), ['returning']);
  assert.equal(challenge.phase, 'returning');

  assert.deepEqual(challenge.advance(RIVAL_REVEAL_TIMING.return - 0.01), []);
  assert.deepEqual(eventTypes(challenge.advance(0.01)), ['panel']);
  assert.equal(challenge.phase, 'typing');
});

test('a large update emits every crossed intro event in order', () => {
  const challenge = createRivalChallenge({ enabled: true });
  challenge.start();
  challenge.arrive();
  assert.deepEqual(eventTypes(challenge.advance(20)), ['reveal', 'returning', 'panel']);
  assert.equal(challenge.phase, 'typing');
  assert.ok(Math.abs(challenge.phaseElapsed - 17) < 1e-9);
});

test('service stays paused through every intro and reply phase', () => {
  const challenge = createRivalChallenge({ enabled: true });
  assert.equal(challenge.paused, false);
  challenge.start();
  for (const phase of ['entering', 'turning', 'reveal', 'returning', 'typing']) {
    if (phase === 'turning') challenge.arrive();
    if (phase === 'reveal') challenge.advance(RIVAL_REVEAL_TIMING.turn);
    if (phase === 'returning') challenge.advance(RIVAL_REVEAL_TIMING.reveal);
    if (phase === 'typing') challenge.advance(RIVAL_REVEAL_TIMING.return);
    assert.equal(challenge.phase, phase);
    assert.equal(challenge.paused, true, phase);
  }
  challenge.completeTyping();
  assert.equal(challenge.phase, 'awaiting');
  assert.equal(challenge.paused, true);
  challenge.choose(0);
  assert.equal(challenge.phase, 'reacting');
  assert.equal(challenge.paused, true);
  challenge.advance(RIVAL_CHALLENGE_REACTION_SECONDS);
  assert.equal(challenge.phase, 'done');
  assert.equal(challenge.paused, false);
});

test('the panel appears only after the return has completed', () => {
  const challenge = createRivalChallenge({ enabled: true });
  challenge.start();
  challenge.arrive();
  const beforePanel = RIVAL_REVEAL_TIMING.turn + RIVAL_REVEAL_TIMING.reveal
    + RIVAL_REVEAL_TIMING.return - 0.001;
  assert.deepEqual(eventTypes(challenge.advance(beforePanel)), ['reveal', 'returning']);
  assert.equal(challenge.phase, 'returning');
  assert.deepEqual(eventTypes(challenge.advance(0.001)), ['panel']);
  assert.equal(challenge.phase, 'typing');
});

test('choices are gated by an explicit typewriter completion signal', () => {
  const challenge = createRivalChallenge({ enabled: true });
  challenge.start();
  assert.equal(challenge.choose(0), false, 'no reply while walking in');
  assert.deepEqual(challenge.completeTyping(), [], 'completion is ignored before typing');
  reachTyping(challenge);
  assert.equal(challenge.choicesVisible, false);
  assert.equal(challenge.choose(0), false, 'typing cannot be answered');
  assert.deepEqual(eventTypes(challenge.advance(10)), []);
  assert.equal(challenge.phase, 'typing', 'typing has no elapsed-time shortcut');
  assert.deepEqual(eventTypes(challenge.completeTyping()), ['choices-shown']);
  assert.equal(challenge.phase, 'awaiting');
  assert.equal(challenge.choicesVisible, true);
  assert.equal(challenge.selectedResponse, null);
  assert.deepEqual(challenge.completeTyping(), [], 'choices-shown fires once');
});

test('the rush begins only after a reply and its brief reaction', () => {
  const challenge = createRivalChallenge({ enabled: true });
  reachChoices(challenge);
  assert.deepEqual(challenge.advance(10), []);
  assert.equal(challenge.choose(1), true);
  assert.equal(challenge.choicesVisible, false, 'choosing dismisses the replies');
  assert.equal(challenge.selectedResponse, 1);
  assert.deepEqual(challenge.advance(RIVAL_CHALLENGE_REACTION_SECONDS / 2), []);
  assert.deepEqual(eventTypes(challenge.advance(RIVAL_CHALLENGE_REACTION_SECONDS / 2)), ['rush']);
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
  reachChoices(challenge);
  assert.equal(challenge.choose(3), false);
  assert.equal(challenge.choose(-1), false);
  assert.equal(challenge.choose('0'), false);
  assert.equal(challenge.choose(2), true);
  assert.equal(challenge.choose(0), false);
  assert.equal(challenge.selectedResponse, 2);
});

test('the challenge is one shot per shift', () => {
  const challenge = createRivalChallenge({ enabled: true });
  reachChoices(challenge);
  assert.equal(challenge.start(), false, 'cannot restart mid-challenge');
  challenge.choose(0);
  challenge.advance(1);
  assert.equal(challenge.start(), false, 'cannot trigger again after the rush');
  assert.equal(challenge.arrive(), false);
  assert.deepEqual(challenge.advance(1), [], 'the rush event fires once');
});
