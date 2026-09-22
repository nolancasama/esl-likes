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
  DETAILS,
  PICTURE_SIZE,
  SHAPES,
  SHAPES_BY_PIECE,
  drawOrder,
  pieceBounds,
} from './robotDefinition.js';

export const INK = '#17233a';
export const PAPER = '#f7f4ee';
/** Unpainted robot, a shade off the paper so the silhouette reads when blank. */
const BLANK = '#fffdf8';

/** Line weights as a fraction of the picture, so they scale with it. */
const OUTLINE = 0.017;
const DETAIL = 0.008;

function pathShape(ctx, shape, size) {
  ctx.beginPath();
  if (shape.kind === 'circle') {
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

/**
 * The robot's blank body, back to front.
 *
 * Also the mask: calling this and then `ctx.clip()` is how a puppet piece keeps
 * only the paint that belongs to it.
 */
export function pathSilhouette(ctx, { size = PICTURE_SIZE, only = null } = {}) {
  const entries = only
    ? SHAPES.filter((entry) => only.includes(entry.id))
    : drawOrder();
  ctx.beginPath();
  for (const entry of entries) {
    const shape = entry.shape;
    if (shape.kind === 'circle') {
      ctx.moveTo((shape.cx + shape.r) * size, shape.cy * size);
      ctx.arc(shape.cx * size, shape.cy * size, shape.r * size, 0, Math.PI * 2);
      continue;
    }
    const x = shape.x * size;
    const y = shape.y * size;
    const w = shape.width * size;
    const h = shape.height * size;
    const r = Math.min((shape.radius ?? 0) * size, w / 2, h / 2);
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else ctx.rect(x, y, w, h);
  }
}

/** The unpainted robot: a pale body, so the shape reads before any paint. */
export function drawBlankBody(ctx, { size = PICTURE_SIZE, only = null } = {}) {
  const entries = only ? SHAPES.filter((e) => only.includes(e.id)) : drawOrder();
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
export function drawLineArt(ctx, { size = PICTURE_SIZE, only = null, blink = 0 } = {}) {
  const entries = only ? SHAPES.filter((e) => only.includes(e.id)) : drawOrder();
  const showsFace = entries.some((entry) => entry.id === 'head');

  ctx.save();
  ctx.strokeStyle = INK;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.lineWidth = OUTLINE * size;
  for (const entry of entries) {
    pathShape(ctx, entry.shape, size);
    ctx.stroke();
  }

  if (showsFace) {
    ctx.lineWidth = DETAIL * size;
    for (const eye of DETAILS.eyes) {
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
        ctx.ellipse(eye.cx * size, eye.cy * size, eye.r * DETAILS.pupilRatio * size,
          eye.r * DETAILS.pupilRatio * open * size, 0, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.lineWidth = DETAIL * 1.6 * size;
        ctx.moveTo((eye.cx - eye.r * 0.7) * size, eye.cy * size);
        ctx.lineTo((eye.cx + eye.r * 0.7) * size, eye.cy * size);
        ctx.stroke();
        ctx.lineWidth = DETAIL * size;
      }
    }
    ctx.strokeStyle = INK;
    ctx.lineWidth = DETAIL * 1.3 * size;
    ctx.beginPath();
    ctx.moveTo(DETAILS.mouth.x1 * size, DETAILS.mouth.y * size);
    ctx.lineTo(DETAILS.mouth.x2 * size, DETAILS.mouth.y * size);
    ctx.stroke();
  }

  ctx.strokeStyle = INK;
  ctx.lineWidth = DETAIL * size;
  if (entries.some((entry) => entry.id === 'torso')) {
    for (const bolt of DETAILS.bolts) {
      ctx.beginPath();
      ctx.arc(bolt.cx * size, bolt.cy * size, bolt.r * size, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  // Cuffs and knees, kept with whichever piece their line sits on.
  const box = only ? null : undefined;
  for (const line of DETAILS.lines) {
    if (only && !lineBelongsTo(line, only)) continue;
    ctx.beginPath();
    ctx.moveTo(line.x1 * size, line.y * size);
    ctx.lineTo(line.x2 * size, line.y * size);
    ctx.stroke();
  }
  void box;
  ctx.restore();
}

/** A cuff or knee line belongs to whichever shape it is drawn across. */
function lineBelongsTo(line, only) {
  const midX = (line.x1 + line.x2) / 2;
  return SHAPES.some((entry) => {
    if (!only.includes(entry.id)) return false;
    const bounds = entry.shape.kind === 'circle'
      ? null
      : { minX: entry.shape.x, maxX: entry.shape.x + entry.shape.width, minY: entry.shape.y, maxY: entry.shape.y + entry.shape.height };
    if (!bounds) return false;
    return midX >= bounds.minX && midX <= bounds.maxX && line.y >= bounds.minY && line.y <= bounds.maxY;
  });
}

/**
 * The whole colouring page: paper, the blank body, the child's paint clipped to
 * nothing, then the line art.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} options
 * @param {HTMLCanvasElement} [options.paint] the child's strokes, same size
 */
export function drawPage(ctx, { size = PICTURE_SIZE, paint = null, blink = 0 } = {}) {
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, size, size);
  drawBlankBody(ctx, { size });
  if (paint) ctx.drawImage(paint, 0, 0, size, size);
  drawLineArt(ctx, { size, blink });
}

/**
 * The pixel box a puppet piece's texture covers: the piece's bounds plus a
 * margin for the outline, which straddles the edge of a shape.
 */
export function pieceTextureBounds(piece, { size = PICTURE_SIZE, margin = OUTLINE } = {}) {
  const box = pieceBounds(piece);
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
export function drawPiece(ctx, piece, { size = PICTURE_SIZE, paint = null } = {}) {
  const box = pieceTextureBounds(piece, { size });
  if (!box) return null;
  const ids = SHAPES_BY_PIECE[piece].map((entry) => entry.id);

  ctx.save();
  ctx.translate(-box.x, -box.y);

  ctx.save();
  pathSilhouette(ctx, { size, only: ids });
  ctx.clip();
  drawBlankBody(ctx, { size, only: ids });
  if (paint) ctx.drawImage(paint, 0, 0, size, size);
  ctx.restore();

  // Outside the clip, so the outline reads at full weight on the cut edge.
  drawLineArt(ctx, { size, only: ids });
  ctx.restore();
  return box;
}
