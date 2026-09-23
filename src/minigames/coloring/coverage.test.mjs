import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FAVOURITE_POWER_THRESHOLD,
  GRID,
  MILESTONES,
  createCoverage as trackCoverage,
  sessionStars,
  silhouetteMask as subjectMask,
  subjectCellCount,
} from './coverage.js';
import * as coverageModule from './coverage.js';
import { PALETTE, PALETTE_HEX, isColor } from './palette.js';
import { BRUSHES, BRUSH_IDS, DEFAULT_BRUSH, brushFor } from './brushes.js';
import { insideSilhouette as subjectContains } from './robotDefinition.js';
import robot from './subjects/robot.js';

const createCoverage = (options = {}) => trackCoverage({ subject: robot, ...options });
const silhouetteMask = () => subjectMask(robot);
const robotCellCount = () => subjectCellCount(robot);
const insideSilhouette = (x, y) => subjectContains(robot, x, y);

const D = (name) => BRUSHES[name].diameter / 720;

/** Sweeps the brush across a horizontal band of the picture. */
function sweep(coverage, y, color, brush = 'large', from = 0.3, to = 0.7) {
  coverage.beginStroke();
  coverage.paintSegment([from, y], [to, y], D(brush), color);
  coverage.endStroke();
}

// --- the palette and the brushes -------------------------------------------

test('all seven colours are available and every one has a hex', () => {
  assert.equal(PALETTE.length, 7);
  assert.deepEqual([...PALETTE].sort(),
    ['blue', 'green', 'orange', 'pink', 'purple', 'red', 'yellow']);
  for (const color of PALETTE) {
    assert.match(PALETTE_HEX[color], /^#[0-9a-f]{6}$/, color);
    assert.ok(isColor(color));
  }
  assert.ok(!isColor('taupe'));
});

test('there are exactly three brushes, Medium is the default, and they differ', () => {
  assert.deepEqual(BRUSH_IDS, ['small', 'medium', 'large']);
  assert.equal(DEFAULT_BRUSH, 'medium');
  const sizes = BRUSH_IDS.map((id) => BRUSHES[id].diameter);
  assert.deepEqual(sizes, [...sizes].sort((a, b) => a - b), 'sizes must ascend');
  assert.equal(new Set(sizes).size, 3, 'two brushes are the same size');
  assert.ok(sizes[2] / sizes[0] > 3, 'Large must be obviously larger than Small');
  assert.equal(brushFor('nonsense').id, DEFAULT_BRUSH, 'an unknown brush falls back to Medium');
});

// --- the coverage grid ------------------------------------------------------

test('the mask covers only the robot, and a fair number of cells', () => {
  const { mask, cells } = silhouetteMask();
  assert.equal(mask.length, GRID * GRID);
  assert.equal(cells, robotCellCount());
  assert.ok(cells > 1000, `only ${cells} cells`);
  for (let i = 0; i < mask.length; i += 97) {
    const gx = i % GRID;
    const gy = Math.floor(i / GRID);
    assert.equal(Boolean(mask[i]), insideSilhouette((gx + 0.5) / GRID, (gy + 0.5) / GRID), `cell ${i}`);
  }
});

test('non-favourite paint tracks coverage but leaves power at zero', () => {
  const coverage = createCoverage({ favourite: 'blue' });
  sweep(coverage, 0.5, 'red');
  assert.equal(coverage.power(), 0);
  assert.ok(coverage.coverage() > 0, 'ordinary paint was not tracked as coverage');
  assert.equal(coverage.favouriteShare(), 0);
  assert.equal(coverage.undoStroke(), true);
  assert.equal(coverage.power(), 0);
  assert.equal(coverage.coverage(), 0);
});

test('favourite paint raises power', () => {
  const coverage = createCoverage({ favourite: 'blue' });
  sweep(coverage, 0.5, 'blue');
  assert.ok(coverage.power() > 0, 'a favourite stroke across the torso charged nothing');
  assert.ok(coverage.coverage() > 0);
  assert.equal(coverage.favouriteShare(), 1);
  assert.equal(coverage.undoStroke(), true);
  assert.equal(coverage.power(), 0);
  assert.equal(coverage.coverage(), 0);
});

test('painting the same area in the favourite again adds nothing', () => {
  const coverage = createCoverage({ favourite: 'blue' });
  sweep(coverage, 0.5, 'blue');
  const firstPower = coverage.power();
  const firstCoverage = coverage.coverage();
  for (let i = 0; i < 12; i += 1) sweep(coverage, 0.5, 'blue');
  assert.equal(coverage.power(), firstPower, 'repeating the favourite farmed power');
  assert.equal(coverage.coverage(), firstCoverage, 'repeating the favourite inflated coverage');
  // Each repeat still takes its own undo slot. Skipping the empty ones read
  // well in isolation — "don't make the child undo twelve no-ops" — but the
  // journal is not consumed on its own: `picture.js` pushes every stroke and
  // pops both stacks together, so a skipped slot means one もどす press rubs
  // out a no-op on the page while draining the meter of an earlier stroke.
  for (let i = 0; i < 12; i += 1) {
    assert.equal(coverage.undoStroke(), true, `repeat ${i} had no undo slot`);
    assert.equal(coverage.power(), firstPower, `undoing repeat ${i} moved the meter`);
  }
  assert.equal(coverage.undoStroke(), true);
  assert.equal(coverage.power(), 0);
});

test('favourite paint outside the silhouette charges nothing at all', () => {
  const coverage = createCoverage({ favourite: 'blue' });
  // Down the left margin. The left arm starts at x=0.125 and a Large brush has
  // a radius of 0.049, so x=0.035 keeps the whole capsule off the robot — the
  // first attempt at this test used the top edge and clipped the antenna ball,
  // which was the code being right and the test being wrong.
  const margin = 0.035;
  for (let y = 0.1; y <= 0.9; y += 0.01) {
    assert.equal(insideSilhouette(margin + D('large') / 2, y), false, `margin is not clear at ${y}`);
  }
  coverage.beginStroke();
  coverage.paintSegment([margin, 0.1], [margin, 0.9], D('large'), 'blue');
  coverage.endStroke();
  assert.equal(coverage.power(), 0, 'background paint charged the bar');
  assert.equal(coverage.coverage(), 0);
  // It takes an undo slot even though it changed no cell, so that the meter
  // and the page stay in step when the child undoes a background decoration.
  assert.equal(coverage.undoStroke(), true, 'background paint took no undo slot');
  assert.equal(coverage.power(), 0);
});

test('non-favourite area repainted favourite raises power and undo restores it exactly', () => {
  const coverage = createCoverage({ favourite: 'blue' });
  sweep(coverage, 0.5, 'red');
  const plainPower = coverage.power();
  const paintedArea = coverage.coverage();
  sweep(coverage, 0.5, 'blue');
  assert.ok(coverage.power() > plainPower);
  assert.equal(coverage.coverage(), paintedArea, 'repainting changed unique painted area');
  assert.equal(coverage.favouriteShare(), 1);
  assert.equal(coverage.undoStroke(), true);
  assert.equal(coverage.power(), plainPower);
  assert.equal(coverage.coverage(), paintedArea);
  assert.equal(coverage.favouriteShare(), 0);
});

test('favourite area repainted non-favourite lowers power and undo restores it exactly', () => {
  const coverage = createCoverage({ favourite: 'blue' });
  sweep(coverage, 0.5, 'blue');
  const favouritePower = coverage.power();
  const paintedArea = coverage.coverage();
  sweep(coverage, 0.5, 'red');
  assert.ok(coverage.power() < favouritePower);
  assert.equal(coverage.power(), 0);
  assert.equal(coverage.coverage(), paintedArea, 'repainting changed unique painted area');
  assert.equal(coverage.favouriteShare(), 0);
  assert.equal(coverage.undoStroke(), true);
  assert.equal(coverage.power(), favouritePower);
  assert.equal(coverage.coverage(), paintedArea);
  assert.equal(coverage.favouriteShare(), 1);
});

test('activation lands near the favourite-only threshold', () => {
  assert.equal(FAVOURITE_POWER_THRESHOLD, 0.28);
  const coverage = createCoverage({ favourite: 'blue' });
  for (let y = 0.04; y < 0.97 && !coverage.isFull(); y += 0.004) {
    sweep(coverage, y, 'blue', 'small', 0.1, 0.9);
  }
  assert.ok(coverage.isFull());
  assert.ok(coverage.coverage() >= FAVOURITE_POWER_THRESHOLD,
    `full below threshold at ${(coverage.coverage() * 100).toFixed(1)}% coverage`);
  assert.ok(coverage.coverage() < FAVOURITE_POWER_THRESHOLD + 0.02,
    `full too far past threshold at ${(coverage.coverage() * 100).toFixed(1)}% coverage`);
});

// --- undo and the eraser ----------------------------------------------------

test('undo takes back a whole stroke, power and all', () => {
  const coverage = createCoverage({ favourite: 'blue' });
  sweep(coverage, 0.5, 'blue');
  const after = coverage.power();
  sweep(coverage, 0.6, 'blue');
  assert.ok(coverage.power() > after);
  assert.ok(coverage.canUndo);
  coverage.undoStroke();
  assert.equal(coverage.power(), after, 'undo left power behind');
});

test('undoing every stroke returns to exactly nothing', () => {
  const coverage = createCoverage({ favourite: 'blue' });
  for (const y of [0.25, 0.5, 0.55, 0.8]) sweep(coverage, y, 'blue');
  while (coverage.canUndo) coverage.undoStroke();
  assert.equal(coverage.power(), 0);
  assert.equal(coverage.coverage(), 0);
  assert.equal(coverage.favouriteShare(), 0);
  assert.equal(coverage.canUndo, false);
});

test('erasing favourite paint lowers power and undo restores it exactly', () => {
  const coverage = createCoverage({ favourite: 'blue' });
  sweep(coverage, 0.5, 'blue');
  const painted = coverage.power();
  const paintedArea = coverage.coverage();
  coverage.beginStroke();
  coverage.eraseSegment([0.3, 0.5], [0.7, 0.5], D('large'));
  coverage.endStroke();
  assert.ok(coverage.power() < painted, 'erasing kept the power');
  assert.equal(coverage.power(), 0, `erasing the same sweep left ${coverage.power()}`);
  assert.equal(coverage.coverage(), 0);
  assert.equal(coverage.undoStroke(), true);
  assert.equal(coverage.power(), painted);
  assert.equal(coverage.coverage(), paintedArea);
  assert.equal(coverage.favouriteShare(), 1);
});

test('erased area can be earned again, and in a different colour', () => {
  const coverage = createCoverage({ favourite: 'blue' });
  sweep(coverage, 0.5, 'red');
  coverage.beginStroke();
  coverage.eraseSegment([0.3, 0.5], [0.7, 0.5], D('large'));
  coverage.endStroke();
  sweep(coverage, 0.5, 'blue');
  assert.ok(coverage.power() > 0);
  assert.equal(coverage.favouriteShare(), 1, 'the repaint should now count as favourite');
});

test('reset clears everything', () => {
  const coverage = createCoverage({ favourite: 'blue' });
  for (const y of [0.3, 0.5, 0.7]) sweep(coverage, y, 'blue');
  coverage.reset();
  assert.equal(coverage.power(), 0);
  assert.equal(coverage.canUndo, false);
  assert.equal(coverage.takeMilestone(), null);
});

// --- interpolation ----------------------------------------------------------

test('a fast flick leaves no gap: one long segment covers what many short ones do', () => {
  const flick = createCoverage({ favourite: 'blue' });
  flick.beginStroke();
  flick.paintSegment([0.32, 0.5], [0.68, 0.5], D('small'), 'red');
  flick.endStroke();

  const crawl = createCoverage({ favourite: 'blue' });
  crawl.beginStroke();
  const steps = 60;
  for (let i = 0; i < steps; i += 1) {
    const x1 = 0.32 + (0.36 * i) / steps;
    const x2 = 0.32 + (0.36 * (i + 1)) / steps;
    crawl.paintSegment([x1, 0.5], [x2, 0.5], D('small'), 'red');
  }
  crawl.endStroke();

  const ratio = flick.coverage() / crawl.coverage();
  assert.ok(ratio > 0.97, `a flick covered only ${(ratio * 100).toFixed(1)}% of a slow drag`);
});

test('a single tap marks something', () => {
  const coverage = createCoverage({ favourite: 'blue' });
  coverage.beginStroke();
  coverage.paintSegment([0.5, 0.5], [0.5, 0.5], D('small'), 'blue');
  coverage.endStroke();
  assert.ok(coverage.power() > 0, 'a tap did nothing');
});

// --- milestones -------------------------------------------------------------

test('milestones fire once each, in order, and never repeat', () => {
  const coverage = createCoverage({ favourite: 'blue' });
  const fired = [];
  for (let y = 0.04; y < 0.97; y += 0.006) {
    sweep(coverage, y, 'blue', 'large', 0.1, 0.9);
    let milestone = coverage.takeMilestone();
    while (milestone) {
      fired.push(milestone.index);
      milestone = coverage.takeMilestone();
    }
  }
  assert.deepEqual(fired, [0, 1, 2], `fired ${fired}`);
  assert.equal(coverage.takeMilestone(), null, 'a milestone repeated');
  assert.equal(MILESTONES.length, 3);
});

test('a milestone never fires before its power', () => {
  const coverage = createCoverage({ favourite: 'blue' });
  for (let y = 0.04; y < 0.97; y += 0.006) {
    sweep(coverage, y, 'blue', 'large', 0.1, 0.9);
    const milestone = coverage.takeMilestone();
    if (milestone) {
      assert.ok(coverage.power() >= MILESTONES[milestone.index] - 1e-9,
        `milestone ${milestone.index} at power ${coverage.power()}`);
    }
  }
});

// --- scoring ----------------------------------------------------------------

test('stars count the robots the child brought to life, and never fail', () => {
  assert.equal(sessionStars(1), 1, 'one robot is one star');
  assert.equal(sessionStars(2), 2);
  assert.equal(sessionStars(3), 3);
  assert.equal(sessionStars(17), 3, 'three is the ceiling');
});

test('the star floor is one, even for nonsense input', () => {
  // The room is only ever reached by finishing a robot, so zero should not
  // happen — but a stamp of zero stars is a punishment the child cannot have
  // earned, so the floor is defensive on purpose.
  assert.equal(sessionStars(0), 1);
  assert.equal(sessionStars(-4), 1);
  assert.equal(sessionStars(), 1);
});

test('there is no longer any way to grade a round', () => {
  // Creativity is not graded, so the per-round scorer is gone rather than
  // merely unused. A module that
  // still exported it would invite a caller.
  assert.equal(coverageModule.scoreRound, undefined);
  assert.ok(!Object.keys(coverageModule).some((name) => /score/i.test(name)),
    `something still scores: ${Object.keys(coverageModule)}`);
});

/**
 * A stroke that never touches the robot must still occupy a slot in the
 * journal. `picture.js` pushes EVERY stroke onto its own paint stack and
 * `undo()` pops both stacks together, so a journal that silently skips an
 * empty stroke leaves the two one apart for ever: the next undo rubs a
 * margin doodle off the page and takes an earlier stroke's power off the
 * meter. Found by the playthrough at full power, where the child is now
 * invited to keep decorating.
 */
test('a stroke entirely in the paper margin still takes an undo slot', () => {
  const coverage = createCoverage({ favourite: 'blue' });
  sweep(coverage, 0.5, 'blue');
  const earned = coverage.power();
  assert.ok(earned > 0, 'the silhouette sweep earned no power to lose');

  // Along the very top edge of the page, clear of the robot.
  coverage.beginStroke();
  coverage.paintSegment([0.04, 0.02], [0.30, 0.02], D('small'), 'red');
  coverage.endStroke();
  assert.equal(coverage.power(), earned, 'margin paint moved the meter');

  // One undo reverses the margin stroke, which changed no cell.
  assert.equal(coverage.undoStroke(), true);
  assert.equal(coverage.power(), earned,
    'undoing a margin stroke took power from an earlier stroke');
});
