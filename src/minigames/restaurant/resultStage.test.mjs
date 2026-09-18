import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RESULT_STAGE_LAYOUT,
  RESULT_STAGE_TIMING,
  createResultStage,
  reactionsFor,
} from './resultStage.js';

const SETTLING_SECONDS = RESULT_STAGE_TIMING.labelFade
  + RESULT_STAGE_TIMING.scoreShrink
  + RESULT_STAGE_TIMING.settle;

test('result stage exposes the requested timing and layout', () => {
  assert.deepEqual(RESULT_STAGE_TIMING, {
    reaction: 1.8,
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
  assert.deepEqual(reactionsFor('player'), { player: 'celebrate', rival: 'despair' });
  assert.deepEqual(reactionsFor('rival'), { player: 'dejected', rival: 'celebrate' });
  assert.deepEqual(reactionsFor('draw'), { player: 'shrug', rival: 'shrug' });

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
