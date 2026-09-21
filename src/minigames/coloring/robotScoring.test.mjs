import test from 'node:test';
import assert from 'node:assert/strict';

import { OUTCOMES, evaluate, pickRound, requirementsFor, scoreRound } from './robotScoring.js';
import { COMPLETION_THRESHOLD, PALETTE, createColorState } from './colorState.js';
import { FREE_REGIONS, LABEL_REGIONS } from './robotDefinition.js';

/** A deterministic RNG walking a fixed list of samples. */
const rngFrom = (samples) => {
  let index = 0;
  return () => samples[index++ % samples.length];
};

/** A round with known answers, built by hand rather than drawn. */
const round = {
  favourite: 'purple',
  starred: 'chestPanel',
  labelled: [
    { regionId: 'antennaLight', color: 'red' },
    { regionId: 'eyes', color: 'yellow' },
  ],
};

const correct = () => ({ chestPanel: 'purple', antennaLight: 'red', eyes: 'yellow' });

/** Colours enough free regions to clear the decoration threshold. */
function decorated(extra = {}) {
  const state = createColorState();
  const needed = Math.ceil(FREE_REGIONS.length * COMPLETION_THRESHOLD);
  for (const region of FREE_REGIONS.slice(0, needed)) state.fill(region.id, 'green');
  for (const [regionId, color] of Object.entries(extra)) state.fill(regionId, color);
  return { colors: state.snapshot(), completion: state.completion() };
}

test('the favourite can be any of the seven colours', () => {
  const seen = new Set();
  for (let i = 0; i < PALETTE.length; i += 1) {
    const sample = (i + 0.5) / PALETTE.length;
    seen.add(pickRound(rngFrom([sample])).favourite);
  }
  assert.equal(seen.size, PALETTE.length, 'every colour must be reachable');
});

test('a round names a starred region and one colour per labelled region', () => {
  const picked = pickRound(rngFrom([0.1, 0.9, 0.4, 0.7]));
  assert.ok(PALETTE.includes(picked.favourite));
  assert.equal(picked.starred, 'chestPanel');
  assert.equal(picked.labelled.length, LABEL_REGIONS.length);
  for (const entry of picked.labelled) assert.ok(PALETTE.includes(entry.color), entry.regionId);
});

test('the two labelled colours always differ from each other', () => {
  for (let i = 0; i < 60; i += 1) {
    const picked = pickRound(rngFrom([i / 60, ((i * 7) % 60) / 60, ((i * 7) % 60) / 60]));
    const colors = picked.labelled.map((entry) => entry.color);
    assert.equal(new Set(colors).size, colors.length, `round ${i} repeated a label colour`);
  }
});

test('requirements collapse to one colour per required region', () => {
  assert.deepEqual(requirementsFor(round), {
    chestPanel: 'purple', antennaLight: 'red', eyes: 'yellow',
  });
});

test('everything correct and decorated brings the robot fully alive', () => {
  const { colors, completion } = decorated(correct());
  const result = evaluate(round, colors, { completion });
  assert.equal(result.outcome, OUTCOMES.FULL);
  assert.equal(result.favouriteCorrect, true);
  assert.deepEqual(result.wrongLabelIds, []);
});

test('a wrong star means NOT READY, whatever else is right', () => {
  const { colors, completion } = decorated({ ...correct(), chestPanel: 'blue' });
  const result = evaluate(round, colors, { completion });
  assert.equal(result.outcome, OUTCOMES.NOT_READY);
  assert.equal(result.favouriteCorrect, false);
});

test('a blank star is NOT READY rather than a crash', () => {
  const { colors, completion } = decorated({ antennaLight: 'red', eyes: 'yellow' });
  assert.equal(evaluate(round, colors, { completion }).outcome, OUTCOMES.NOT_READY);
});

test('a correct star with a wrong label is ALMOST, and names only the label', () => {
  const { colors, completion } = decorated({ ...correct(), eyes: 'green' });
  const result = evaluate(round, colors, { completion });
  assert.equal(result.outcome, OUTCOMES.ALMOST);
  assert.deepEqual(result.wrongLabelIds, ['eyes']);
  // The starred region's expected colour must never appear in the report.
  assert.ok(!JSON.stringify(result.labelResults).includes('chestPanel'));
});

test('fixing the star turns NOT READY into full activation', () => {
  const wrong = decorated({ ...correct(), chestPanel: 'orange' });
  assert.equal(evaluate(round, wrong.colors, { completion: wrong.completion }).outcome, OUTCOMES.NOT_READY);
  const fixed = decorated(correct());
  assert.equal(evaluate(round, fixed.colors, { completion: fixed.completion }).outcome, OUTCOMES.FULL);
});

test('fixing only the wrong label turns ALMOST into full activation', () => {
  const almost = decorated({ ...correct(), antennaLight: 'pink' });
  assert.equal(evaluate(round, almost.colors, { completion: almost.completion }).outcome, OUTCOMES.ALMOST);
  const fixed = decorated(correct());
  assert.equal(evaluate(round, fixed.colors, { completion: fixed.completion }).outcome, OUTCOMES.FULL);
});

test('a bare robot with every required colour right is INCOMPLETE, not wrong', () => {
  const result = evaluate(round, correct(), { completion: 0 });
  assert.equal(result.outcome, OUTCOMES.INCOMPLETE);
  assert.equal(result.favouriteCorrect, true, 'nothing is actually miscoloured');
  assert.deepEqual(result.wrongLabelIds, []);
});

test('free regions never count as wrong, in any colour combination', () => {
  for (const color of PALETTE) {
    const state = createColorState();
    for (const region of FREE_REGIONS) state.fill(region.id, color);
    const result = evaluate(round, { ...state.snapshot(), ...correct() }, { completion: 1 });
    assert.equal(result.outcome, OUTCOMES.FULL, `all-${color} decoration should still activate`);
  }
});

test('a free region painted the favourite colour does not stand in for the star', () => {
  const { colors, completion } = decorated({ ...correct(), chestPanel: 'red', face: 'purple' });
  assert.equal(evaluate(round, colors, { completion }).outcome, OUTCOMES.NOT_READY);
});

test('Listen Again changes the score but never the outcome', () => {
  const { colors, completion } = decorated(correct());
  const quiet = scoreRound(round, colors, { completion, usedListenAgain: false });
  const replayed = scoreRound(round, colors, { completion, usedListenAgain: true });
  assert.equal(quiet.outcome, OUTCOMES.FULL);
  assert.equal(replayed.outcome, OUTCOMES.FULL, 'using the replay must not block the robot');
  assert.ok(replayed.ratio < quiet.ratio, 'but it should cost the memory bonus');
});

test('a perfect, well-decorated, unaided round earns three stars', () => {
  const state = createColorState();
  for (const region of FREE_REGIONS) state.fill(region.id, 'blue');
  const result = scoreRound(round, { ...state.snapshot(), ...correct() }, {
    completion: state.completion(), usedListenAgain: false,
  });
  assert.equal(result.stars, 3);
  assert.equal(result.requiredCorrect, 3);
  assert.equal(result.requiredTotal, 3);
});

test('a failed activation never scores above one star', () => {
  const { colors, completion } = decorated({ ...correct(), chestPanel: 'blue' });
  assert.equal(scoreRound(round, colors, { completion }).stars, 1);
});
