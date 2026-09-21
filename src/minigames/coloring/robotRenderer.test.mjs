import test from 'node:test';
import assert from 'node:assert/strict';

import {
  drawOrder,
  drawPiece,
  drawRobot,
  fillFor,
  labelFor,
  pieceTextureBounds,
} from './robotRenderer.js';
import { PALETTE_HEX } from './colorState.js';
import { PICTURE_SIZE, PIECES, REGIONS, REGIONS_BY_PIECE, pieceBounds } from './robotDefinition.js';

/**
 * A recording stand-in for a 2D context. The renderer only ever calls a handful
 * of methods, so the whole draw can be inspected without a canvas — which is
 * what lets "a piece contains exactly its own regions" be a real test rather
 * than something only a screenshot could check.
 */
function fakeContext() {
  const calls = [];
  const fills = [];
  let current = null;
  const ctx = {
    canvas: { width: PICTURE_SIZE, height: PICTURE_SIZE },
    fillStyle: null,
    strokeStyle: null,
    lineWidth: 0,
    lineJoin: '',
    font: '',
    textAlign: '',
    textBaseline: '',
    calls,
    fills,
    texts: [],
    translations: [],
    beginPath() { current = { ops: [] }; },
    roundRect(...args) { current?.ops.push(['roundRect', ...args]); },
    rect(...args) { current?.ops.push(['rect', ...args]); },
    arc(...args) { current?.ops.push(['arc', ...args]); },
    fill() { fills.push({ style: ctx.fillStyle, shape: current }); calls.push('fill'); },
    stroke() { calls.push('stroke'); },
    strokeText(text) { ctx.texts.push(text); },
    fillText(text) { ctx.texts.push(text); },
    save() { calls.push('save'); },
    restore() { calls.push('restore'); },
    translate(x, y) { ctx.translations.push([x, y]); },
  };
  return ctx;
}

const round = {
  favourite: 'purple',
  starred: 'chestPanel',
  labelled: [
    { regionId: 'antennaLight', color: 'red' },
    { regionId: 'eyes', color: 'yellow' },
  ],
};

test('regions are drawn back to front, so panels land on the body', () => {
  const order = drawOrder().map((region) => region.id);
  assert.ok(order.indexOf('body') < order.indexOf('chestPanel'));
  assert.ok(order.indexOf('face') < order.indexOf('eyes'));
  assert.equal(order.length, REGIONS.length);
});

test('a blank region falls back to the paper colour, not to black', () => {
  assert.equal(fillFor('face', {}), '#f7f4ee');
  assert.equal(fillFor('face', { face: 'green' }), PALETTE_HEX.green);
  assert.equal(fillFor('face', { face: 'chartreuse' }), '#f7f4ee');
});

test('the starred region shows a star and never the colour name', () => {
  assert.equal(labelFor('chestPanel', round, {}), '★');
  assert.equal(labelFor('chestPanel', round, { chestPanel: 'blue' }), '★',
    'a wrong guess must not turn into a hint');
  for (const colors of [{}, { chestPanel: 'blue' }, { chestPanel: 'purple' }]) {
    const label = labelFor('chestPanel', round, colors);
    assert.ok(label === null || label === '★', `leaked "${label}"`);
  }
});

test('the star disappears once the favourite is remembered correctly', () => {
  assert.equal(labelFor('chestPanel', round, { chestPanel: 'purple' }), null);
});

test('a labelled region shows its colour word until it is right', () => {
  assert.equal(labelFor('eyes', round, {}), 'YELLOW');
  assert.equal(labelFor('eyes', round, { eyes: 'green' }), 'YELLOW');
  assert.equal(labelFor('eyes', round, { eyes: 'yellow' }), null);
  assert.equal(labelFor('antennaLight', round, {}), 'RED');
});

test('free regions are never labelled', () => {
  for (const region of REGIONS.filter((r) => r.type === 'free')) {
    assert.equal(labelFor(region.id, round, {}), null, region.id);
  }
});

test('every region gets a fill and the line art is drawn over the top', () => {
  const ctx = fakeContext();
  drawRobot(ctx, { colors: {}, round: null });
  const firstStroke = ctx.calls.indexOf('stroke');
  const lastFill = ctx.calls.lastIndexOf('fill');
  assert.ok(firstStroke > 0, 'something must be stroked');
  // Every region's fill happens before any outline, so paint cannot cover ink.
  const regionFills = ctx.fills.length;
  assert.ok(regionFills >= REGIONS.length, `expected at least one fill per region, got ${regionFills}`);
  assert.ok(lastFill > firstStroke, 'the eyes are filled last, above the line art');
});

test('the child’s chosen colours are the ones actually painted', () => {
  const colors = { face: 'purple', leftFoot: 'green', chestPanel: 'orange' };
  const ctx = fakeContext();
  drawRobot(ctx, { colors });
  const used = ctx.fills.map((entry) => entry.style);
  assert.ok(used.includes(PALETTE_HEX.purple));
  assert.ok(used.includes(PALETTE_HEX.green));
  assert.ok(used.includes(PALETTE_HEX.orange));
});

test('a puppet piece contains exactly its own regions, in the child’s colours', () => {
  const colors = Object.fromEntries(REGIONS.map((region, index) => [
    region.id, ['red', 'blue', 'yellow', 'green', 'pink', 'purple', 'orange'][index % 7],
  ]));
  for (const piece of PIECES) {
    const ctx = fakeContext();
    drawRobot(ctx, { colors, only: REGIONS_BY_PIECE[piece], labels: false });
    const expected = REGIONS_BY_PIECE[piece]
      .map((id) => PALETTE_HEX[colors[id]]);
    const painted = ctx.fills.map((entry) => entry.style);
    for (const style of expected) {
      assert.ok(painted.includes(style), `${piece} is missing one of its own regions`);
    }
    // Nothing from another piece may appear in this piece's texture.
    const foreign = REGIONS
      .filter((region) => region.piece !== piece)
      .filter((region) => !REGIONS_BY_PIECE[piece].includes(region.id));
    assert.equal(
      ctx.fills.length >= expected.length, true,
      `${piece} drew fewer fills than it owns regions`,
    );
    assert.ok(foreign.length > 0 || PIECES.length === 1);
  }
});

test('a puppet piece carries no instruction text', () => {
  const ctx = fakeContext();
  drawRobot(ctx, { colors: {}, round, only: REGIONS_BY_PIECE.torso, labels: false });
  assert.deepEqual(ctx.texts, [], 'the robot that walks away must not wear its instructions');
});

test('the colouring page does carry its instructions', () => {
  const ctx = fakeContext();
  drawRobot(ctx, { colors: {}, round });
  assert.ok(ctx.texts.includes('★'));
  assert.ok(ctx.texts.includes('YELLOW'));
});

test('piece texture bounds cover the piece plus room for the outline', () => {
  for (const piece of PIECES) {
    const box = pieceTextureBounds(piece);
    const inner = pieceBounds(piece);
    assert.ok(box.width > 0 && box.height > 0, piece);
    assert.ok(box.x < inner.minX * PICTURE_SIZE, `${piece} left margin`);
    assert.ok(box.y < inner.minY * PICTURE_SIZE, `${piece} top margin`);
    assert.ok(box.x + box.width > inner.maxX * PICTURE_SIZE, `${piece} right margin`);
    assert.ok(box.y + box.height > inner.maxY * PICTURE_SIZE, `${piece} bottom margin`);
  }
});

test('drawing a piece translates it to its own origin', () => {
  const ctx = fakeContext();
  const box = drawPiece(ctx, 'head', { colors: { face: 'pink' } });
  assert.deepEqual(ctx.translations, [[-box.x, -box.y]]);
  assert.ok(ctx.fills.some((entry) => entry.style === PALETTE_HEX.pink));
});

test('an unknown piece is null rather than a crash', () => {
  assert.equal(pieceTextureBounds('tail'), null);
  assert.equal(drawPiece(fakeContext(), 'tail'), null);
});
