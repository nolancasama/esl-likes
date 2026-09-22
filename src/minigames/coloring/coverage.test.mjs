import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FAVOURITE_BONUS,
  GRID,
  MILESTONES,
  POWER_THRESHOLD,
  createCoverage,
  robotCellCount,
  scoreRound,
  silhouetteMask,
} from './coverage.js';
import { PALETTE, PALETTE_HEX, isColor } from './palette.js';
import { BRUSHES, BRUSH_IDS, DEFAULT_BRUSH, brushFor } from './brushes.js';
import { insideSilhouette } from './robotDefinition.js';

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

test('painting the robot charges the bar', () => {
  const coverage = createCoverage({ favourite: 'blue' });
  assert.equal(coverage.power(), 0);
  sweep(coverage, 0.5, 'red');
  assert.ok(coverage.power() > 0, 'a stroke across the torso charged nothing');
  assert.ok(coverage.coverage() > 0);
});

test('painting the same place again charges nothing', () => {
  const coverage = createCoverage({ favourite: 'blue' });
  sweep(coverage, 0.5, 'red');
  const once = coverage.power();
  for (let i = 0; i < 12; i += 1) sweep(coverage, 0.5, 'red');
  assert.equal(coverage.power(), once, 'scribbling over the same patch farmed power');
  assert.equal(coverage.coverage(), coverage.coverage());
});

test('painting the paper around the robot charges nothing at all', () => {
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
  coverage.paintSegment([margin, 0.1], [margin, 0.9], D('large'), 'red');
  coverage.endStroke();
  assert.equal(coverage.power(), 0, 'background paint charged the bar');
  assert.equal(coverage.coverage(), 0);
});

test('stroke count, travel and repetition are all worth nothing on their own', () => {
  const many = createCoverage({ favourite: 'blue' });
  for (let i = 0; i < 40; i += 1) sweep(many, 0.5, 'red', 'small', 0.45, 0.46);
  const one = createCoverage({ favourite: 'blue' });
  sweep(one, 0.5, 'red', 'small', 0.45, 0.46);
  assert.equal(many.power(), one.power(), 'forty strokes over one spot beat one stroke');
});

test('the favourite colour charges faster, by exactly the bonus', () => {
  const plain = createCoverage({ favourite: 'blue' });
  const fave = createCoverage({ favourite: 'blue' });
  sweep(plain, 0.5, 'red');
  sweep(fave, 0.5, 'blue');
  const ratio = fave.power() / plain.power();
  assert.ok(Math.abs(ratio - FAVOURITE_BONUS) < 1e-9, `ratio was ${ratio}`);
  assert.equal(fave.coverage(), plain.coverage(), 'the bonus must not inflate coverage itself');
  assert.equal(fave.favouriteShare(), 1);
  assert.equal(plain.favouriteShare(), 0);
});

test('a cell keeps the credit of the colour that first painted it', () => {
  // Otherwise "repaint everything in the favourite" is rule 1 with extra steps.
  const coverage = createCoverage({ favourite: 'blue' });
  sweep(coverage, 0.5, 'red');
  const before = coverage.power();
  sweep(coverage, 0.5, 'blue');
  assert.equal(coverage.power(), before, 'repainting in the favourite upgraded old area');
  assert.equal(coverage.favouriteShare(), 0);
});

test('the favourite colour is never required: plain paint alone reaches full', () => {
  const coverage = createCoverage({ favourite: 'blue' });
  for (let y = 0.04; y < 0.97; y += 0.008) sweep(coverage, y, 'red', 'large', 0.1, 0.9);
  assert.ok(coverage.isFull(), `plain painting only reached ${coverage.power().toFixed(3)}`);
  assert.equal(coverage.favouriteShare(), 0);
});

test('full power arrives at the threshold, not at total coverage', () => {
  const coverage = createCoverage({ favourite: 'blue' });
  for (let y = 0.04; y < 0.97; y += 0.004) {
    sweep(coverage, y, 'red', 'large', 0.1, 0.9);
    if (coverage.isFull()) break;
  }
  assert.ok(coverage.isFull());
  assert.ok(coverage.coverage() >= POWER_THRESHOLD - 0.02,
    `full at ${(coverage.coverage() * 100).toFixed(1)}% coverage`);
  assert.ok(coverage.coverage() < 0.95, 'a child should not have to fill every corner');
});

test('the threshold is between 65% and 70%, and deterministic', () => {
  assert.ok(POWER_THRESHOLD >= 0.65 && POWER_THRESHOLD <= 0.7, String(POWER_THRESHOLD));
  const runs = [0, 1, 2].map(() => {
    const coverage = createCoverage({ favourite: 'blue' });
    for (let y = 0.04; y < 0.97; y += 0.01) sweep(coverage, y, 'red', 'medium', 0.1, 0.9);
    return coverage.power();
  });
  assert.equal(new Set(runs).size, 1, `power varied between identical runs: ${runs}`);
});

test('painting entirely in the favourite reaches full sooner, but not instantly', () => {
  const fill = (color) => {
    const coverage = createCoverage({ favourite: 'blue' });
    for (let y = 0.04; y < 0.97; y += 0.004) {
      sweep(coverage, y, color, 'large', 0.1, 0.9);
      if (coverage.isFull()) return coverage.coverage();
    }
    return coverage.coverage();
  };
  const withFave = fill('blue');
  const without = fill('red');
  assert.ok(withFave < without, 'the bonus did not speed anything up');
  assert.ok(withFave > 0.3, `full at only ${(withFave * 100).toFixed(1)}% is too cheap`);
});

// --- undo and the eraser ----------------------------------------------------

test('undo takes back a whole stroke, power and all', () => {
  const coverage = createCoverage({ favourite: 'blue' });
  sweep(coverage, 0.5, 'red');
  const after = coverage.power();
  sweep(coverage, 0.6, 'red');
  assert.ok(coverage.power() > after);
  assert.ok(coverage.canUndo);
  coverage.undoStroke();
  assert.ok(Math.abs(coverage.power() - after) < 1e-9, 'undo left power behind');
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

test('undo restores the favourite credit it removes, not a plain one', () => {
  const coverage = createCoverage({ favourite: 'blue' });
  sweep(coverage, 0.5, 'blue');
  const faveOnly = coverage.power();
  sweep(coverage, 0.6, 'red');
  coverage.undoStroke();
  assert.ok(Math.abs(coverage.power() - faveOnly) < 1e-9);
  assert.equal(coverage.favouriteShare(), 1);
});

test('the eraser gives back the coverage it removes', () => {
  const coverage = createCoverage({ favourite: 'blue' });
  sweep(coverage, 0.5, 'red');
  const painted = coverage.power();
  coverage.beginStroke();
  coverage.eraseSegment([0.3, 0.5], [0.7, 0.5], D('large'));
  coverage.endStroke();
  assert.ok(coverage.power() < painted, 'erasing kept the power');
  assert.ok(coverage.power() < 1e-9, `erasing the same sweep left ${coverage.power()}`);
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
  coverage.paintSegment([0.5, 0.5], [0.5, 0.5], D('small'), 'red');
  coverage.endStroke();
  assert.ok(coverage.power() > 0, 'a tap did nothing');
});

// --- milestones -------------------------------------------------------------

test('milestones fire once each, in order, and never repeat', () => {
  const coverage = createCoverage({ favourite: 'blue' });
  const fired = [];
  for (let y = 0.04; y < 0.97; y += 0.006) {
    sweep(coverage, y, 'red', 'large', 0.1, 0.9);
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
    sweep(coverage, y, 'red', 'large', 0.1, 0.9);
    const milestone = coverage.takeMilestone();
    if (milestone) {
      assert.ok(coverage.power() >= MILESTONES[milestone.index] - 1e-9,
        `milestone ${milestone.index} at power ${coverage.power()}`);
    }
  }
});

// --- scoring ----------------------------------------------------------------

test('scoring never fails and never grades the colours chosen', () => {
  const bare = scoreRound({ coverage: 0, favouriteShare: 0, usedListenAgain: true });
  assert.equal(bare.stars, 1, 'the floor must be one star, not zero');
  const best = scoreRound({ coverage: POWER_THRESHOLD, favouriteShare: 1, usedListenAgain: false });
  assert.equal(best.stars, 3);
  // Two children who coloured the same amount in different colours must score
  // the same, unless one of them used the favourite.
  const a = scoreRound({ coverage: 0.5, favouriteShare: 0 });
  const b = scoreRound({ coverage: 0.5, favouriteShare: 0 });
  assert.equal(a.ratio, b.ratio);
});

test('listening is rewarded but never required for stars', () => {
  const listened = scoreRound({ coverage: POWER_THRESHOLD, favouriteShare: 0.4, usedListenAgain: false });
  const replayed = scoreRound({ coverage: POWER_THRESHOLD, favouriteShare: 0.4, usedListenAgain: true });
  assert.ok(listened.ratio > replayed.ratio, 'no memory bonus at all');
  assert.ok(replayed.stars >= 2, 'using Listen Again must not gut the score');
  const ignored = scoreRound({ coverage: POWER_THRESHOLD, favouriteShare: 0, usedListenAgain: false });
  assert.ok(ignored.stars >= 2, 'ignoring the colour must still be a decent round');
});
