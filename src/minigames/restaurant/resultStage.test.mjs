import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RESULT_STAGE_LAYOUT,
  RESULT_STAGE_MOVEMENT,
  RESULT_STAGE_TIMING,
  createResultStage,
  reactionsFor,
} from './resultStage.js';

const SETTLING_SECONDS = RESULT_STAGE_TIMING.labelFade
  + RESULT_STAGE_TIMING.scoreShrink
  + RESULT_STAGE_TIMING.settle;

test('result stage exposes the requested timing and layout', () => {
  assert.deepEqual(RESULT_STAGE_TIMING, {
    stagingTimeout: 1.8,
    reaction: 3.6,
    labelFade: 0.3,
    scoreShrink: 0.5,
    settle: 0.6,
  });
  assert.deepEqual(RESULT_STAGE_LAYOUT, {
    player: { x: -1.35, z: -3.75 },
    rival: { x: 1.35, z: -3.75 },
  });
});

test('phases advance in order at their specified durations', () => {
  const stage = createResultStage({ outcome: 'player' });
  assert.equal(stage.phase, 'idle');
  assert.equal(stage.start(), true);
  assert.equal(stage.phase, 'reaction');

  assert.deepEqual(stage.advance(RESULT_STAGE_TIMING.reaction - 0.01), []);
  assert.equal(stage.phase, 'reaction');
  assert.ok(Math.abs(stage.phaseElapsed - (RESULT_STAGE_TIMING.reaction - 0.01)) < 1e-10);
  assert.deepEqual(stage.advance(0.01), [{ type: 'phase', phase: 'settling' }]);
  assert.equal(stage.phase, 'settling');

  assert.deepEqual(stage.advance(SETTLING_SECONDS - 0.01), []);
  assert.equal(stage.phase, 'settling');
  assert.deepEqual(stage.advance(0.01), [{ type: 'phase', phase: 'question' }]);
  assert.equal(stage.phase, 'question');
  assert.deepEqual(stage.advance(20), []);
  assert.equal(stage.phase, 'question');

  assert.equal(stage.markAnswered(), true);
  assert.equal(stage.phase, 'answered');
});

test('settling and question wait for the full doubled reaction hold', () => {
  const stage = createResultStage({ outcome: 'player' });
  stage.start();

  assert.deepEqual(stage.advance(1.8), []);
  assert.equal(stage.phase, 'reaction', 'the former reaction duration is still mid-hold');
  assert.equal(stage.phaseElapsed, 1.8, 'reaction time remains measured in real seconds');

  assert.deepEqual(stage.advance(1.799), []);
  assert.equal(stage.phase, 'reaction');
  assert.deepEqual(stage.advance(0.001), [{ type: 'phase', phase: 'settling' }]);
  assert.equal(stage.phase, 'settling');

  assert.deepEqual(stage.advance(SETTLING_SECONDS - 0.001), []);
  assert.equal(stage.phase, 'settling');
  assert.deepEqual(stage.advance(0.001), [{ type: 'phase', phase: 'question' }]);
  assert.equal(stage.phase, 'question');
});

test('label visibility and compact score follow the phase', () => {
  const stage = createResultStage({ outcome: 'draw' });
  assert.equal(stage.labelVisible, false);
  assert.equal(stage.scoreCompact, false);

  stage.start();
  assert.equal(stage.labelVisible, true);
  assert.equal(stage.scoreCompact, false);

  stage.advance(RESULT_STAGE_TIMING.reaction);
  assert.equal(stage.labelVisible, false);
  assert.equal(stage.scoreCompact, true);

  stage.advance(SETTLING_SECONDS);
  assert.equal(stage.labelVisible, false);
  assert.equal(stage.scoreCompact, true);

  stage.markAnswered();
  assert.equal(stage.labelVisible, false);
  assert.equal(stage.scoreCompact, true);
});

test('reactions map all three outcomes', () => {
  assert.deepEqual(reactionsFor('player'), { player: 'celebrate', rival: 'dejected' });
  assert.deepEqual(reactionsFor('rival'), { player: 'dejected', rival: 'celebrate' });
  assert.deepEqual(reactionsFor('draw'), { player: 'shrug', rival: 'shrug' });
  for (const outcome of ['player', 'rival', 'draw']) {
    assert.ok(!Object.values(reactionsFor(outcome)).includes('despair'));
  }

  const stage = createResultStage({ outcome: 'rival' });
  assert.deepEqual(stage.reactions, { player: 'dejected', rival: 'celebrate' });
  assert.equal(stage.outcome, 'rival');
});

test('start is one shot', () => {
  const stage = createResultStage({ outcome: 'player' });
  assert.equal(stage.start(), true);
  assert.equal(stage.start(), false);
  stage.advance(RESULT_STAGE_TIMING.reaction + SETTLING_SECONDS);
  stage.markAnswered();
  assert.equal(stage.start(), false);
});

test('advance before start is a no-op', () => {
  const stage = createResultStage({ outcome: 'draw' });
  assert.deepEqual(stage.advance(100), []);
  assert.equal(stage.phase, 'idle');
  assert.equal(stage.elapsed, 0);
  assert.equal(stage.phaseElapsed, 0);
  assert.equal(stage.active, false);
});

test('a large advance emits every crossed transition in order', () => {
  const stage = createResultStage({ outcome: 'player' });
  stage.start();
  const extraQuestionTime = 0.25;

  assert.deepEqual(
    stage.advance(RESULT_STAGE_TIMING.reaction + SETTLING_SECONDS + extraQuestionTime),
    [
      { type: 'phase', phase: 'settling' },
      { type: 'phase', phase: 'question' },
    ],
  );
  assert.equal(stage.phase, 'question');
  assert.ok(Math.abs(stage.phaseElapsed - extraQuestionTime) < 1e-10);
  assert.ok(Math.abs(stage.elapsed - (RESULT_STAGE_TIMING.reaction + SETTLING_SECONDS + extraQuestionTime)) < 1e-10);
});

test('markAnswered is only valid from question', () => {
  const stage = createResultStage({ outcome: 'rival' });
  assert.equal(stage.markAnswered(), false);
  stage.start();
  assert.equal(stage.markAnswered(), false);
  stage.advance(RESULT_STAGE_TIMING.reaction);
  assert.equal(stage.markAnswered(), false);
  stage.advance(SETTLING_SECONDS);
  assert.equal(stage.markAnswered(), true);
  assert.equal(stage.active, true, 'the stage stays active until the scene finishes');
  assert.equal(stage.markAnswered(), false);
  assert.equal(stage.phase, 'answered');
});

test('staging is opt-in: without it the reaction starts immediately as before', () => {
  const stage = createResultStage({ outcome: 'player' });
  assert.equal(stage.usesStaging, false);
  stage.start();
  assert.equal(stage.phase, 'reaction');
  assert.equal(stage.staging, false);
  assert.deepEqual(stage.markStaged(), [], 'markStaged is inert without staging');
});

test('a staged result walks first and holds the reaction until both arrive', () => {
  const stage = createResultStage({ outcome: 'player', staging: true });
  stage.start();
  assert.equal(stage.phase, 'staging');
  assert.equal(stage.staging, true);
  assert.equal(stage.active, true);
  // Nothing of the result presentation shows while they are still walking.
  assert.equal(stage.labelVisible, false);
  assert.equal(stage.scoreCompact, false);

  assert.deepEqual(stage.advance(1.0), [], 'the reaction did not start on its own');
  assert.equal(stage.phase, 'staging');

  assert.deepEqual(stage.markStaged(), [{ type: 'phase', phase: 'reaction' }]);
  assert.equal(stage.phase, 'reaction');
  assert.equal(stage.phaseElapsed, 0, 'the reaction gets its full duration');
  assert.equal(stage.labelVisible, true);
  assert.deepEqual(stage.markStaged(), [], 'arriving twice changes nothing');
});

test('the safety timeout releases a staging that never reports arrival', () => {
  const stage = createResultStage({ outcome: 'draw', staging: true });
  stage.start();
  assert.deepEqual(stage.advance(RESULT_STAGE_TIMING.stagingTimeout - 0.01), []);
  assert.equal(stage.phase, 'staging');
  const events = stage.advance(0.02);
  assert.deepEqual(events, [{ type: 'phase', phase: 'reaction' }]);
  assert.equal(stage.phase, 'reaction');
});

test('a staged result still reaches the question, just one phase later', () => {
  const stage = createResultStage({ outcome: 'rival', staging: true });
  stage.start();
  stage.markStaged();
  const events = stage.advance(RESULT_STAGE_TIMING.reaction + SETTLING_SECONDS);
  assert.deepEqual(events.map((event) => event.phase), ['settling', 'question']);
  assert.equal(stage.phase, 'question');
  assert.equal(stage.markAnswered(), true);
});

test('a stuck staging still reaches the question rather than deadlocking', () => {
  const stage = createResultStage({ outcome: 'player', staging: true });
  stage.start();
  const events = stage.advance(
    RESULT_STAGE_TIMING.stagingTimeout + RESULT_STAGE_TIMING.reaction + SETTLING_SECONDS,
  );
  assert.deepEqual(events.map((event) => event.phase), ['reaction', 'settling', 'question']);
  assert.equal(stage.phase, 'question');
});

test('the staging walk speed lands both waiters inside the timeout', () => {
  // Worst case in this room: a waiter against the side wall at the front
  // (x 6.85, z 5.7) walking to the far result mark.
  const worstCase = Math.hypot(6.85 + Math.abs(RESULT_STAGE_LAYOUT.player.x),
    5.7 - RESULT_STAGE_LAYOUT.player.z);
  const walkSeconds = worstCase / RESULT_STAGE_MOVEMENT.speed;
  assert.ok(
    walkSeconds < RESULT_STAGE_TIMING.stagingTimeout,
    `worst-case walk ${walkSeconds.toFixed(2)} s would trip the ${RESULT_STAGE_TIMING.stagingTimeout} s guard`,
  );
  // And it stays a quick beat rather than becoming a cinematic.
  assert.ok(walkSeconds < 1.6, `worst-case walk ${walkSeconds.toFixed(2)} s is too slow to feel energetic`);
});
