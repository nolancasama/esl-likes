/**
 * Drawing the robot.
 *
 * One renderer serves both halves of the minigame: the colouring page draws the
 * whole robot, and each paper-puppet piece draws only the regions it owns, with
 * the same code and the same colours. That is what guarantees the puppet looks
 * like the child's drawing rather than a reconstruction of it — there is no
 * second renderer to drift.
 *
 * Takes a 2D context rather than making one, so it can be driven by a canvas,
 * by an offscreen canvas for a puppet texture, or by a recording stub in tests.
 *
 * Order is load-bearing: fill regions by `order`, redraw the black line art over
 * every fill, then draw the eyes above everything. A child who paints the face
 * dark must still be able to see the robot's expression.
 */

import {
  PICTURE_SIZE,
  REGIONS,
  REGION_BY_ID,
  REGIONS_BY_PIECE,
  labelPlacement,
  pieceBounds,
  regionBounds,
} from './robotDefinition.js';
import { PALETTE_HEX } from './colorState.js';

const INK = '#23282f';
const BLANK = '#f7f4ee';
const HIGHLIGHT = '#ffd400';

/** Line weights, as a fraction of the picture, so they scale with it. */
const OUTLINE = 0.006;
const DETAIL = 0.004;

/** The white halo behind a label word, as a share of its font size, per side. */
const HALO = 0.14;

/** Regions drawn back to front. Panels sit on the body, eyes sit on the face. */
export function drawOrder(only = null) {
  const wanted = only ? new Set(only) : null;
  return REGIONS
    .filter((region) => !wanted || wanted.has(region.id))
    .slice()
    .sort((a, b) => a.order - b.order);
}

/** The colour a region should be filled with, or the blank paper colour. */
export function fillFor(regionId, colors = {}) {
  const chosen = colors[regionId];
  return PALETTE_HEX[chosen] ?? BLANK;
}

/**
 * The label a region shows this round, or null.
 *
 * The starred region shows a star and never a colour name — remembering the
 * friend's favourite is the whole listening task. A labelled region's word
 * disappears once it holds the right colour, so a finished robot is not
 * covered in instructions.
 */
export function labelFor(regionId, round, colors = {}) {
  if (!round) return null;
  if (regionId === round.starred) {
    return colors[regionId] === round.favourite ? null : '★';
  }
  const labelled = round.labelled?.find((entry) => entry.regionId === regionId);
  if (!labelled) return null;
  return colors[regionId] === labelled.color ? null : labelled.color.toUpperCase();
}

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
  else {
    // Older canvas implementations have no roundRect; square corners are an
    // acceptable fallback and never change which pixels belong to a region.
    ctx.rect(x, y, w, h);
  }
}

function fillRegion(ctx, region, colors, size) {
  ctx.fillStyle = fillFor(region.id, colors);
  for (const shape of region.shapes) {
    pathShape(ctx, shape, size);
    ctx.fill();
  }
}

function strokeRegion(ctx, region, size, width = OUTLINE) {
  ctx.strokeStyle = INK;
  ctx.lineWidth = width * size;
  ctx.lineJoin = 'round';
  for (const shape of region.shapes) {
    pathShape(ctx, shape, size);
    ctx.stroke();
  }
}

/** The eyes, drawn last so a dark face can never swallow them. */
function drawEyes(ctx, colors, size) {
  const box = regionBounds('eyes');
  const midY = (box.minY + box.maxY) / 2;
  const radius = (box.maxY - box.minY) * 0.3;
  for (const cx of [box.minX + (box.maxX - box.minX) * 0.28, box.minX + (box.maxX - box.minX) * 0.72]) {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(cx * size, midY * size, radius * size, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = DETAIL * size;
    ctx.stroke();
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.arc(cx * size, midY * size, radius * 0.48 * size, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Below this the line would be a smudge rather than a leader. */
const LEADER_MIN = 0.02;

const setLabelFont = (ctx, fontSize) => {
  ctx.font = `700 ${fontSize}px ui-monospace, Menlo, Consolas, monospace`;
};

/**
 * The font size a word may use in a box: capped by the box height and by a
 * share of the picture, then **measured and shrunk until it also fits the box
 * width**. Sizing from height alone let `RED` spill outside the antenna light
 * and `YELLOW` past both ends of the eye band. The halo counts as width,
 * because it is what actually crosses the outline.
 */
export function fitLabelFont(ctx, text, width, height, size) {
  let fontSize = Math.min(height * 0.62, size * 0.038);
  const usable = width * 0.9;
  setLabelFont(ctx, fontSize);
  const measured = ctx.measureText?.(text)?.width ?? 0;
  // measureText is unavailable in the recording stub; the height cap still holds.
  if (measured > 0) {
    const needed = measured + fontSize * HALO * 2;
    if (needed > usable) fontSize *= usable / needed;
  }
  return Math.max(size * 0.014, fontSize);
}

function drawLabel(ctx, region, text, size) {
  const place = labelPlacement(region.id);
  const cx = (place.minX + place.maxX) / 2 * size;
  const cy = (place.minY + place.maxY) / 2 * size;
  const fontSize = fitLabelFont(
    ctx, text, (place.maxX - place.minX) * size, (place.maxY - place.minY) * size, size,
  );

  if (place.leader && place.anchor) {
    const own = regionBounds(region.id);
    const gap = Math.max(place.minX - own.maxX, own.minX - place.maxX,
      place.minY - own.maxY, own.minY - place.maxY);
    if (gap >= LEADER_MIN) {
      ctx.save();
      ctx.strokeStyle = INK;
      ctx.lineWidth = DETAIL * 0.7 * size;
      ctx.beginPath();
      ctx.moveTo(place.anchor.x * size, place.anchor.y * size);
      ctx.lineTo(cx, cy);
      ctx.stroke();
      ctx.restore();
    }
  }

  setLabelFont(ctx, fontSize);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // A pale halo keeps the word legible over any of the seven fills, and over
  // the leader line, without shouting over the artwork.
  ctx.lineWidth = fontSize * HALO * 2;
  ctx.strokeStyle = 'rgba(255,255,255,0.88)';
  ctx.strokeText(text, cx, cy);
  ctx.fillStyle = INK;
  ctx.fillText(text, cx, cy);
}

/**
 * Draws the robot.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} options
 * @param {number} [options.size]      picture size in pixels
 * @param {object} [options.colors]    region id -> palette colour
 * @param {object} [options.round]     for the ★ and the colour labels
 * @param {string[]} [options.only]    draw only these regions (a puppet piece)
 * @param {boolean} [options.labels]   false for puppet pieces — no instructions
 * @param {string} [options.highlight] region id to outline under the pointer
 */
export function drawRobot(ctx, {
  size = PICTURE_SIZE,
  colors = {},
  round = null,
  only = null,
  labels = true,
  highlight = null,
} = {}) {
  const regions = drawOrder(only);

  for (const region of regions) fillRegion(ctx, region, colors, size);
  for (const region of regions) strokeRegion(ctx, region, size);

  if (highlight && REGION_BY_ID[highlight] && (!only || only.includes(highlight))) {
    ctx.save();
    ctx.strokeStyle = HIGHLIGHT;
    ctx.lineWidth = OUTLINE * 1.8 * size;
    for (const shape of REGION_BY_ID[highlight].shapes) {
      pathShape(ctx, shape, size);
      ctx.stroke();
    }
    ctx.restore();
  }

  if (regions.some((region) => region.id === 'eyes')) drawEyes(ctx, colors, size);

  if (labels && round) {
    for (const region of regions) {
      const text = labelFor(region.id, round, colors);
      if (text) drawLabel(ctx, region, text, size);
    }
  }
}

/**
 * The pixel box a puppet piece's texture should cover: the piece's own bounds
 * plus a margin for the outline, which straddles the edge of a shape.
 */
export function pieceTextureBounds(piece, { size = PICTURE_SIZE, margin = OUTLINE } = {}) {
  const box = pieceBounds(piece);
  if (!box) return null;
  const pad = margin * size;
  const x = box.minX * size - pad;
  const y = box.minY * size - pad;
  return {
    x,
    y,
    width: (box.maxX - box.minX) * size + pad * 2,
    height: (box.maxY - box.minY) * size + pad * 2,
  };
}

/**
 * Draws one puppet piece into its own context, translated so the piece sits at
 * the origin. The caller supplies a correctly sized transparent canvas from
 * `pieceTextureBounds`. Labels are off: instructions belong to the colouring
 * page, not to the robot that walks away from it.
 */
export function drawPiece(ctx, piece, { size = PICTURE_SIZE, colors = {} } = {}) {
  const box = pieceTextureBounds(piece, { size });
  if (!box) return null;
  ctx.save();
  ctx.translate(-box.x, -box.y);
  drawRobot(ctx, { size, colors, only: REGIONS_BY_PIECE[piece], labels: false });
  ctx.restore();
  return box;
}
