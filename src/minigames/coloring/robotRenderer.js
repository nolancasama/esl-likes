/**
 * Drawing the robot.
 *
 * Three layers, always in this order:
 *
 *   1. the paper
 *   2. the child's paint, clipped to nothing — it may spill past the lines
 *   3. the black line art, redrawn over everything, plus the face
 *
 * Layer 3 is what keeps a messy page readable, and it is the one idea worth
 * carrying over from the original v1 robot: paint first, outline after, so no
 * amount of scribbling can lose the robot.
 *
 * Takes a 2D context rather than making one, so the same code serves the live
 * canvas, an offscreen canvas for a puppet texture, and a recording stub in
 * tests.
 */

import {
  PICTURE_SIZE,
  drawOrder,
  pieceAt,
  pieceBounds,
  shapesForPiece,
} from './robotDefinition.js';

export const INK = '#17233a';
export const PAPER = '#f7f4ee';
/** Unpainted robot, a shade off the paper so the silhouette reads when blank. */
const BLANK = '#fffdf8';

/** Line weights as a fraction of the picture, so they scale with it. */
const OUTLINE = 0.017;
const DETAIL = 0.008;

function appendShapePath(ctx, shape, size) {
  if (shape.kind === 'circle') {
    ctx.moveTo((shape.cx + shape.r) * size, shape.cy * size);
    ctx.arc(shape.cx * size, shape.cy * size, shape.r * size, 0, Math.PI * 2);
    return;
  }
  const x = shape.x * size;
  const y = shape.y * size;
  const w = shape.width * size;
  const h = shape.height * size;
  const r = Math.min((shape.radius ?? 0) * size, w / 2, h / 2);
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

function pathShape(ctx, shape, size) {
  ctx.beginPath();
  appendShapePath(ctx, shape, size);
}

/**
 * The robot's blank body, back to front.
 *
 * Also the mask: calling this and then `ctx.clip()` is how a puppet piece keeps
 * only the paint that belongs to it.
 */
export function pathSilhouette(ctx, { subject, size = PICTURE_SIZE, only = null } = {}) {
  const entries = only
    ? subject.shapes.filter((entry) => only.includes(entry.id))
    : drawOrder(subject);
  ctx.beginPath();
  for (const entry of entries) {
    appendShapePath(ctx, entry.shape, size);
  }
}

/** The unpainted robot: a pale body, so the shape reads before any paint. */
export function drawBlankBody(ctx, { subject, size = PICTURE_SIZE, only = null } = {}) {
  const entries = only
    ? subject.shapes.filter((entry) => only.includes(entry.id))
    : drawOrder(subject);
  ctx.fillStyle = BLANK;
  for (const entry of entries) {
    pathShape(ctx, entry.shape, size);
    ctx.fill();
  }
}

/**
 * The line art: every silhouette outline, then the face and the small details.
 *
 * Drawn last, so it survives any paint. The eyes are filled white first so a
 * child who scribbles the head dark can still see the robot looking back.
 */
export function drawLineArt(ctx, { subject, size = PICTURE_SIZE, only = null, blink = 0 } = {}) {
  const entries = only
    ? subject.shapes.filter((entry) => only.includes(entry.id))
    : drawOrder(subject);
  const selectedPieces = new Set(entries.map((entry) => entry.piece));

  ctx.save();
  ctx.strokeStyle = INK;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.lineWidth = OUTLINE * size;
  for (const [index, entry] of entries.entries()) {
    ctx.save();
    const occluders = entries.slice(index + 1).filter((later) => later.occludesOutline);
    if (occluders.length) {
      ctx.beginPath();
      ctx.rect(0, 0, size, size);
      for (const occluder of occluders) appendShapePath(ctx, occluder.shape, size);
      ctx.clip('evenodd');
    }
    pathShape(ctx, entry.shape, size);
    ctx.stroke();
    ctx.restore();
  }

  ctx.lineWidth = DETAIL * size;
  for (const eye of subject.details.eyes) {
    const eyePiece = pieceAt(subject, eye.cx, eye.cy) ?? subject.pieces[0];
    if (only && !selectedPieces.has(eyePiece)) continue;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(eye.cx * size, eye.cy * size, eye.r * size, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.stroke();
    // A blink closes the eye to a line rather than hiding it.
    const open = 1 - Math.min(1, Math.max(0, blink));
    ctx.fillStyle = INK;
    ctx.beginPath();
    if (open > 0.15) {
      ctx.ellipse(eye.cx * size, eye.cy * size, eye.r * subject.details.pupilRatio * size,
        eye.r * subject.details.pupilRatio * open * size, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.lineWidth = DETAIL * 1.6 * size;
      ctx.moveTo((eye.cx - eye.r * 0.7) * size, eye.cy * size);
      ctx.lineTo((eye.cx + eye.r * 0.7) * size, eye.cy * size);
      ctx.stroke();
      ctx.lineWidth = DETAIL * size;
    }
  }

  for (const mark of subject.details.marks) {
    if (only && !selectedPieces.has(mark.piece)) continue;
    drawMark(ctx, mark, size);
  }
  ctx.restore();
}

function drawMark(ctx, mark, size) {
  ctx.strokeStyle = mark.stroke || INK;
  ctx.fillStyle = typeof mark.fill === 'string' ? mark.fill : INK;
  ctx.lineWidth = DETAIL * (mark.lineWidth ?? 1) * size;
  ctx.beginPath();
  if (mark.type === 'line') {
    ctx.moveTo(mark.x1 * size, mark.y1 * size);
    ctx.lineTo(mark.x2 * size, mark.y2 * size);
  } else if (mark.type === 'circle') {
    ctx.arc(mark.cx * size, mark.cy * size, mark.r * size, 0, Math.PI * 2);
  } else if (mark.type === 'arc') {
    ctx.arc(mark.cx * size, mark.cy * size, mark.r * size,
      mark.startAngle ?? 0, mark.endAngle ?? Math.PI * 2, mark.counterclockwise ?? false);
  } else if (mark.type === 'polygon' || mark.type === 'triangle') {
    const points = mark.points ?? [];
    if (!points.length) return;
    ctx.moveTo(points[0].x * size, points[0].y * size);
    for (const point of points.slice(1)) ctx.lineTo(point.x * size, point.y * size);
    ctx.lineTo(points[0].x * size, points[0].y * size);
  } else {
    return;
  }
  if (mark.fill) ctx.fill();
  if (mark.stroke !== false) ctx.stroke();
}

/**
 * The whole colouring page: paper, the blank body, the child's paint clipped to
 * nothing, then the line art.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} options
 * @param {HTMLCanvasElement} [options.paint] the child's strokes, same size
 */
export function drawPage(ctx, { subject, size = PICTURE_SIZE, paint = null, blink = 0 } = {}) {
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, size, size);
  drawBlankBody(ctx, { subject, size });
  if (paint) ctx.drawImage(paint, 0, 0, size, size);
  drawLineArt(ctx, { subject, size, blink });
}

/**
 * The pixel box a puppet piece's texture covers: the piece's bounds plus a
 * margin for the outline, which straddles the edge of a shape.
 */
export function pieceTextureBounds(piece, { subject, size = PICTURE_SIZE, margin = OUTLINE } = {}) {
  const box = pieceBounds(subject, piece);
  if (!box) return null;
  const pad = margin * size;
  return {
    x: box.minX * size - pad,
    y: box.minY * size - pad,
    width: (box.maxX - box.minX) * size + pad * 2,
    height: (box.maxY - box.minY) * size + pad * 2,
  };
}

/**
 * Cuts one puppet piece out of the finished page.
 *
 * This is the whole reason the puppet looks like the child's work: the paint
 * canvas is the source, clipped to this piece's own silhouette shapes, so every
 * brush stroke, every gap and every spill inside the lines comes with it.
 * A spill *outside* the lines does not, which is why painting over the edge is
 * allowed on the page and invisible on the robot.
 *
 * The caller supplies a correctly sized transparent canvas from
 * `pieceTextureBounds`.
 */
export function drawPiece(ctx, piece, { subject, size = PICTURE_SIZE, paint = null } = {}) {
  const box = pieceTextureBounds(piece, { subject, size });
  if (!box) return null;
  const ids = shapesForPiece(subject, piece).map((entry) => entry.id);

  ctx.save();
  ctx.translate(-box.x, -box.y);

  ctx.save();
  pathSilhouette(ctx, { subject, size, only: ids });
  ctx.clip();
  drawBlankBody(ctx, { subject, size, only: ids });
  if (paint) ctx.drawImage(paint, 0, 0, size, size);
  ctx.restore();

  // Outside the clip, so the outline reads at full weight on the cut edge.
  drawLineArt(ctx, { subject, size, only: ids });
  ctx.restore();
  return box;
}
