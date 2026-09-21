import test from 'node:test';
import assert from 'node:assert/strict';

import { COMPLETION_THRESHOLD, PALETTE, PALETTE_HEX, createColorState } from './colorState.js';
import { FREE_REGIONS } from './robotDefinition.js';

test('all seven lesson colours are available', () => {
  assert.deepEqual([...PALETTE].sort(), ['blue', 'green', 'orange', 'pink', 'purple', 'red', 'yellow']);
  for (const color of PALETTE) assert.match(PALETTE_HEX[color], /^#[0-9a-f]{6}$/i, color);
});

test('filling a region records the colour', () => {
  const state = createColorState();
  assert.equal(state.fill('face', 'green'), true);
  assert.equal(state.get('face'), 'green');
  assert.equal(state.size, 1);
});

test('an unknown region or a colour outside the palette is refused', () => {
  const state = createColorState();
  assert.equal(state.fill('nose', 'red'), false);
  assert.equal(state.fill('face', 'turquoise'), false);
  assert.equal(state.size, 0);
});

test('re-tapping a region in its current colour costs nothing', () => {
  const state = createColorState();
  state.fill('face', 'red');
  assert.equal(state.fill('face', 'red'), false, 'no change, so no new state');
  assert.equal(state.canUndo, true);
  state.undo();
  assert.equal(state.get('face'), null, 'one undo is enough to take the fill back');
});

test('undo restores the previous colour, not blank', () => {
  const state = createColorState();
  state.fill('body', 'blue');
  state.fill('body', 'pink');
  state.undo();
  assert.equal(state.get('body'), 'blue');
  state.undo();
  assert.equal(state.get('body'), null);
  assert.equal(state.canUndo, false);
});

test('undo on an untouched picture is harmless', () => {
  const state = createColorState();
  assert.equal(state.undo(), null);
  assert.equal(state.size, 0);
});

test('the eraser clears one region and is undoable', () => {
  const state = createColorState();
  state.fill('ears', 'orange');
  assert.equal(state.clear('ears'), true);
  assert.equal(state.get('ears'), null);
  state.undo();
  assert.equal(state.get('ears'), 'orange');
});

test('clearing an already blank region does nothing', () => {
  const state = createColorState();
  assert.equal(state.clear('ears'), false);
  assert.equal(state.canUndo, false);
});

test('reset clears everything and can itself be undone', () => {
  const state = createColorState();
  state.fill('face', 'red');
  state.fill('body', 'blue');
  state.reset();
  assert.equal(state.size, 0);
  state.undo();
  assert.equal(state.get('face'), 'red');
  assert.equal(state.get('body'), 'blue');
});

test('a snapshot round-trips the child’s exact choices', () => {
  const state = createColorState();
  state.fill('face', 'purple');
  state.fill('leftFoot', 'green');
  state.fill('buttons', 'pink');
  const snapshot = state.snapshot();

  const restored = createColorState();
  restored.restore(snapshot);
  assert.deepEqual(restored.snapshot(), snapshot);
  assert.equal(restored.get('leftFoot'), 'green');
});

test('a snapshot drops anything that is not a real region or colour', () => {
  const state = createColorState({ face: 'red', nose: 'blue', body: 'chartreuse' });
  assert.deepEqual(state.snapshot(), { face: 'red' });
});

test('completion counts only the free regions', () => {
  const state = createColorState();
  assert.equal(state.completion(), 0);
  // Required regions are not decoration and must not move the number.
  state.fill('chestPanel', 'red');
  state.fill('eyes', 'yellow');
  state.fill('antennaLight', 'green');
  assert.equal(state.completion(), 0);
});

test('the decoration threshold is reached partway, not at the end', () => {
  const state = createColorState();
  const needed = Math.ceil(FREE_REGIONS.length * COMPLETION_THRESHOLD);
  for (const region of FREE_REGIONS.slice(0, needed - 1)) state.fill(region.id, 'blue');
  assert.equal(state.isDecoratedEnough(), false);
  state.fill(FREE_REGIONS[needed - 1].id, 'blue');
  assert.equal(state.isDecoratedEnough(), true);
  assert.ok(state.completion() < 1, 'the child should not have to colour every last detail');
});

test('unpainted lists what is still blank', () => {
  const state = createColorState();
  state.fill('face', 'red');
  const blank = state.unpainted();
  assert.ok(!blank.includes('face'));
  assert.ok(blank.includes('body'));
});
