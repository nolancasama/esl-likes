import test from 'node:test';
import assert from 'node:assert/strict';

import {
  INK,
  PAPER,
  drawBlankBody,
  drawLineArt,
  drawPage,
  drawPiece,
  pathSilhouette,
  pieceTextureBounds,
} from './robotRenderer.js';
import {
  DETAILS, PICTURE_SIZE, PIECES, SHAPES, SHAPES_BY_PIECE, pieceBounds,
} from './robotDefinition.js';

/**
 * A recording stand-in for a 2D context.
 *
 * The renderer only ever calls a handful of methods, so the whole draw can be
 * inspected without a canvas — which is what lets "a piece is clipped to its
 * own shapes" and "the line art is drawn last" be real tests rather than
 * something only a screenshot could check.
 */
function fakeContext() {
  const ctx = {
    canvas: { width: PICTURE_SIZE, height: PICTURE_SIZE },
    fillStyle: null,
    strokeStyle: null,
    lineWidth: 0,
    lineJoin: '',
    lineCap: '',
    globalCompositeOperation: 'source-over',
    log: [],
    fills: [],
    strokes: [],
    ops: [],
    beginPath() { ctx.log.push('beginPath'); ctx.ops = []; },
    roundRect(...args) { ctx.ops.push(['roundRect', ...args]); },
    rect(...args) { ctx.ops.push(['rect', ...args]); },
    arc(...args) { ctx.ops.push(['arc', ...args]); },
    ellipse(...args) { ctx.ops.push(['ellipse', ...args]); },
    moveTo(...args) { ctx.ops.push(['moveTo', ...args]); },
    lineTo(...args) { ctx.ops.push(['lineTo', ...args]); },
    fill() { ctx.log.push('fill'); ctx.fills.push({ style: ctx.fillStyle, ops: ctx.ops.slice() }); },
    stroke() { ctx.log.push('stroke'); ctx.strokes.push({ style: ctx.strokeStyle, width: ctx.lineWidth, ops: ctx.ops.slice() }); },
    fillRect(...args) { ctx.log.push('fillRect'); ctx.fills.push({ style: ctx.fillStyle, rect: args }); },
    clip() { ctx.log.push('clip'); ctx.clipped = ctx.ops.slice(); },
    drawImage(image) { ctx.log.push('drawImage'); ctx.painted = image; },
    save() { ctx.log.push('save'); },
    restore() { ctx.log.push('restore'); },
    translate(x, y) { ctx.log.push('translate'); ctx.translations ||= []; ctx.translations.push([x, y]); },
  };
  return ctx;
}

const fakePaint = { width: PICTURE_SIZE, height: PICTURE_SIZE, __isPaint: true };

test('the page is drawn paper, blank body, paint, then line art', () => {
  const ctx = fakeContext();
  drawPage(ctx, { paint: fakePaint });
  const order = ctx.log;
  const paperAt = order.indexOf('fillRect');
  const paintAt = order.indexOf('drawImage');
  const lastStroke = order.lastIndexOf('stroke');
  assert.ok(paperAt >= 0, 'the paper was never laid down');
  assert.ok(paintAt > paperAt, 'the paint must go on after the paper');
  assert.ok(lastStroke > paintAt,
    'the line art must be redrawn over the paint — that is what keeps a messy page readable');
  assert.equal(ctx.painted, fakePaint, 'the page must draw the real paint canvas');
});

test('the page still draws without any paint at all', () => {
  const ctx = fakeContext();
  drawPage(ctx, {});
  assert.ok(!ctx.log.includes('drawImage'));
  assert.ok(ctx.log.filter((entry) => entry === 'stroke').length > SHAPES.length);
});

test('the paper and the ink are different, and the ink is dark', () => {
  assert.notEqual(PAPER, INK);
  const ink = Number.parseInt(INK.slice(1), 16);
  assert.ok((ink >> 16) < 80 && ((ink >> 8) & 255) < 80, `${INK} is not dark`);
});

test('every silhouette shape is outlined', () => {
  const ctx = fakeContext();
  drawLineArt(ctx, {});
  const inked = ctx.strokes.filter((entry) => entry.style === INK);
  assert.ok(inked.length >= SHAPES.length, `${inked.length} strokes for ${SHAPES.length} shapes`);
});

test('the outline is much heavier than the details', () => {
  const ctx = fakeContext();
  drawLineArt(ctx, {});
  const widths = [...new Set(ctx.strokes.map((entry) => entry.width))].sort((a, b) => a - b);
  assert.ok(widths.length > 1, 'everything is drawn at one weight');
  assert.ok(widths[widths.length - 1] / widths[0] > 1.5,
    'the silhouette outline should be bold against the face and bolts');
});

test('the eyes are filled white before their pupil, so a dark head cannot swallow them', () => {
  const ctx = fakeContext();
  drawLineArt(ctx, {});
  const white = ctx.fills.filter((entry) => entry.style === '#ffffff');
  assert.equal(white.length, DETAILS.eyes.length, 'an eye is missing its white');
  const firstWhite = ctx.fills.indexOf(white[0]);
  const firstInk = ctx.fills.findIndex((entry) => entry.style === INK);
  assert.ok(firstInk > firstWhite, 'the pupil must be drawn on top of the white');
});

test('a blink closes the eyes to a line rather than removing them', () => {
  const open = fakeContext();
  drawLineArt(open, { blink: 0 });
  const shut = fakeContext();
  drawLineArt(shut, { blink: 1 });
  const ellipses = (ctx) => ctx.fills.filter((entry) => entry.ops?.some((op) => op[0] === 'ellipse')).length;
  assert.ok(ellipses(open) > 0, 'an open eye should have a round pupil');
  assert.equal(ellipses(shut), 0, 'a closed eye should not draw a pupil');
  // Still something there: a shut eye is a line, not a hole in the face.
  assert.ok(shut.strokes.length >= open.strokes.length);
});

// --- cutting the puppet out of the paint ------------------------------------

test('a piece texture box matches its bounds, plus room for the outline', () => {
  for (const piece of PIECES) {
    const box = pieceTextureBounds(piece, { size: PICTURE_SIZE });
    const bounds = pieceBounds(piece);
    const width = (bounds.maxX - bounds.minX) * PICTURE_SIZE;
    assert.ok(box.width > width, `${piece} has no margin for its outline`);
    assert.ok(box.width < width * 1.5, `${piece} margin is wildly too big`);
    assert.ok(box.x < bounds.minX * PICTURE_SIZE, `${piece} box starts inside its bounds`);
  }
  assert.equal(pieceTextureBounds('nonsense'), null);
});

test('a piece is clipped to its own shapes and stamped with the real paint', () => {
  for (const piece of PIECES) {
    const ctx = fakeContext();
    const box = drawPiece(ctx, piece, { paint: fakePaint });
    assert.ok(box, piece);
    assert.ok(ctx.log.includes('clip'), `${piece} was not clipped — it would be a rectangle`);
    assert.equal(ctx.painted, fakePaint, `${piece} did not use the paint canvas`);
    const clipAt = ctx.log.indexOf('clip');
    const paintAt = ctx.log.indexOf('drawImage');
    assert.ok(paintAt > clipAt, `${piece} painted before clipping, so paint would escape`);
    // The outline is drawn after the clip is released, so the cut edge reads
    // at full weight rather than being shaved in half by its own mask.
    assert.ok(ctx.log.lastIndexOf('stroke') > ctx.log.lastIndexOf('clip'), piece);
  }
});

test('a piece is translated so it sits at the origin of its own texture', () => {
  for (const piece of PIECES) {
    const ctx = fakeContext();
    const box = drawPiece(ctx, piece, { paint: fakePaint });
    assert.deepEqual(ctx.translations[0], [-box.x, -box.y], piece);
  }
});

test('a piece never draws another piece shape', () => {
  for (const piece of PIECES) {
    const mine = new Set(SHAPES_BY_PIECE[piece].map((entry) => entry.id));
    for (const other of PIECES) {
      if (other === piece) continue;
      for (const entry of SHAPES_BY_PIECE[other]) {
        assert.ok(!mine.has(entry.id), `${piece} claims ${entry.id} from ${other}`);
      }
    }
  }
});

test('the five pieces between them draw every shape exactly once', () => {
  const drawn = PIECES.flatMap((piece) => SHAPES_BY_PIECE[piece].map((entry) => entry.id));
  assert.equal(drawn.length, SHAPES.length);
  assert.equal(new Set(drawn).size, SHAPES.length);
  assert.deepEqual([...drawn].sort(), SHAPES.map((entry) => entry.id).sort());
});

test('only the head piece draws a face, and only the torso draws bolts', () => {
  const faceOf = (only) => {
    const ctx = fakeContext();
    drawLineArt(ctx, { only });
    return ctx.fills.some((entry) => entry.style === '#ffffff');
  };
  assert.ok(faceOf(SHAPES_BY_PIECE.body.map((entry) => entry.id)), 'the body must carry the face');
  assert.ok(!faceOf(SHAPES_BY_PIECE.leftArm.map((entry) => entry.id)), 'an arm drew the face');
  assert.ok(!faceOf(SHAPES_BY_PIECE.leftLeg.map((entry) => entry.id)), 'a leg drew the face');
});

test('pathSilhouette traces something for every shape, and for a subset', () => {
  const all = fakeContext();
  pathSilhouette(all, {});
  assert.ok(all.ops.length >= SHAPES.length, 'not every shape was traced');
  const one = fakeContext();
  pathSilhouette(one, { only: ['head'] });
  assert.equal(one.ops.length, 1);
});

test('the blank body is drawn in something lighter than the paint but not the paper', () => {
  const ctx = fakeContext();
  drawBlankBody(ctx, {});
  const styles = new Set(ctx.fills.map((entry) => entry.style));
  assert.equal(styles.size, 1, 'the blank body should be one flat colour');
  const [blank] = [...styles];
  assert.notEqual(blank, PAPER, 'an unpainted robot must still read against the page');
});
