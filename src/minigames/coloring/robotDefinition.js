/**
 * The robot, defined once.
 *
 * Pure data and pure maths: no canvas, no three.js, no DOM, so the whole shape
 * of the robot is testable. Both the colouring page and the paper puppet read
 * this file, so there is one robot rather than two that drift apart.
 *
 * Coordinates are normalised 0..1 over a square picture, y increasing downward.
 *
 * ## Why this robot is simple
 *
 * The previous robot had eighteen separately fillable regions, a starred
 * chest panel, shoulder caps and side panels. It graded well and it read as a
 * worksheet — the owner's word was "disconnected construction pieces". This is
 * a colouring book page instead: a handful of big connected shapes, painted
 * freehand, with every detail drawn as line art *over* the paint so nothing
 * subdivides the robot into things that must be coloured separately.
 *
 * The proportions come from the original v1 robot (commit `720d86d`): one large
 * head panel, one large torso, two chunky arms, feet indicated below, an
 * antenna. v1's shapes did not actually touch — head to body and body to arms
 * both had gaps — so the silhouette here closes them with a neck and with limbs
 * that overlap the torso. That overlap is load-bearing twice over: it is what
 * makes the drawing read as one robot, and it is what hides the seams when the
 * puppet's arms and legs swing.
 */

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/** The picture is authored at this size. */
export const PICTURE_SIZE = 720;

/**
 * The five pieces the paper puppet is cut into.
 *
 * `body` is head, neck, torso and antenna together — one continuous central
 * cutout. Nine pieces was too segmented for a flat paper toy: every extra joint
 * is another seam that can show.
 */
export const PIECES = Object.freeze(['body', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg']);

/** Where each piece turns. `body` is the root and does not rotate. */
export const PIVOTS = deepFreeze({
  body: { x: 0.5, y: 0.5 },
  leftArm: { x: 0.2125, y: 0.45 },
  rightArm: { x: 0.7875, y: 0.45 },
  leftLeg: { x: 0.4, y: 0.765 },
  rightLeg: { x: 0.6, y: 0.765 },
});

const rect = (x, y, width, height, radius = 0.03) => ({ kind: 'rect', x, y, width, height, radius });
const circle = (cx, cy, r) => ({ kind: 'circle', cx, cy, r });

/**
 * The robot's silhouette: where the robot *is*.
 *
 * This is the whole geometry model now. There are no colourable regions —
 * paint goes wherever the brush goes — so a shape's only jobs are to say what
 * counts as robot (for power and for cutting the puppet out), which piece owns
 * it, and where to stroke the outline.
 *
 * `order` is back to front. Limbs are drawn behind the body so the overlap at
 * each joint is hidden under the torso rather than sitting on top of it.
 */
export const SHAPES = deepFreeze([
  { id: 'leftArm', piece: 'leftArm', order: 10, shape: rect(0.125, 0.425, 0.175, 0.285, 0.05) },
  { id: 'rightArm', piece: 'rightArm', order: 11, shape: rect(0.7, 0.425, 0.175, 0.285, 0.05) },
  { id: 'leftLeg', piece: 'leftLeg', order: 12, shape: rect(0.335, 0.75, 0.13, 0.155, 0.04) },
  { id: 'rightLeg', piece: 'rightLeg', order: 13, shape: rect(0.535, 0.75, 0.13, 0.155, 0.04) },
  { id: 'leftFoot', piece: 'leftLeg', order: 14, shape: rect(0.305, 0.885, 0.185, 0.062, 0.03) },
  { id: 'rightFoot', piece: 'rightLeg', order: 15, shape: rect(0.51, 0.885, 0.185, 0.062, 0.03) },

  { id: 'antennaBall', piece: 'body', order: 20, shape: circle(0.5, 0.065, 0.036) },
  { id: 'antennaStalk', piece: 'body', order: 21, shape: rect(0.484, 0.09, 0.032, 0.075, 0.012) },
  { id: 'neck', piece: 'body', order: 22, shape: rect(0.435, 0.345, 0.13, 0.055, 0.012) },
  { id: 'head', piece: 'body', order: 23, shape: rect(0.285, 0.155, 0.43, 0.205, 0.062) },
  { id: 'torso', piece: 'body', order: 24, shape: rect(0.285, 0.385, 0.43, 0.395, 0.055) },
]);

export const SHAPES_BY_PIECE = deepFreeze(Object.fromEntries(
  PIECES.map((piece) => [piece, SHAPES.filter((entry) => entry.piece === piece)]),
));

/** Shapes back to front, for both filling and stroking. */
export const drawOrder = () => [...SHAPES].sort((a, b) => a.order - b.order);

/**
 * Line art drawn ON TOP of the paint: a face, a few bolts, a cuff and a knee.
 *
 * These are deliberately not shapes. A detail that could be filled separately
 * is a region, and regions are what made the last robot a worksheet. Paint
 * flows underneath all of this.
 */
export const DETAILS = deepFreeze({
  eyes: [{ cx: 0.415, cy: 0.25, r: 0.032 }, { cx: 0.585, cy: 0.25, r: 0.032 }],
  pupilRatio: 0.46,
  mouth: { x1: 0.452, x2: 0.548, y: 0.305 },
  bolts: [{ cx: 0.44, cy: 0.6, r: 0.018 }, { cx: 0.5, cy: 0.6, r: 0.018 }, { cx: 0.56, cy: 0.6, r: 0.018 }],
  // Open lines: a cuff across each arm and a knee across each leg.
  lines: [
    { x1: 0.133, x2: 0.292, y: 0.632 },
    { x1: 0.708, x2: 0.867, y: 0.632 },
    { x1: 0.343, x2: 0.457, y: 0.832 },
    { x1: 0.543, x2: 0.657, y: 0.832 },
  ],
});

// --- geometry ---------------------------------------------------------------

export function shapeBounds(shape) {
  if (shape.kind === 'circle') {
    return { minX: shape.cx - shape.r, minY: shape.cy - shape.r, maxX: shape.cx + shape.r, maxY: shape.cy + shape.r };
  }
  return { minX: shape.x, minY: shape.y, maxX: shape.x + shape.width, maxY: shape.y + shape.height };
}

function mergeBounds(list) {
  return list.reduce((box, next) => ({
    minX: Math.min(box.minX, next.minX),
    minY: Math.min(box.minY, next.minY),
    maxX: Math.max(box.maxX, next.maxX),
    maxY: Math.max(box.maxY, next.maxY),
  }));
}

export function pieceBounds(piece) {
  const entries = SHAPES_BY_PIECE[piece];
  if (!entries?.length) return null;
  return mergeBounds(entries.map((entry) => shapeBounds(entry.shape)));
}

export const silhouetteBounds = () => mergeBounds(SHAPES.map((entry) => shapeBounds(entry.shape)));

const insideRect = (x, y, shape) => {
  const { x: left, y: top, width, height, radius } = shape;
  const right = left + width;
  const bottom = top + height;
  if (x < left || x > right || y < top || y > bottom) return false;
  const r = Math.min(radius ?? 0, width / 2, height / 2);
  if (r <= 0) return true;
  const nearX = x < left + r ? left + r : x > right - r ? right - r : x;
  const nearY = y < top + r ? top + r : y > bottom - r ? bottom - r : y;
  if (nearX === x || nearY === y) return true;
  return (x - nearX) ** 2 + (y - nearY) ** 2 <= r * r;
};

const insideCircle = (x, y, shape) => (x - shape.cx) ** 2 + (y - shape.cy) ** 2 <= shape.r * shape.r;

export function insideShape(x, y, shape) {
  return shape.kind === 'circle' ? insideCircle(x, y, shape) : insideRect(x, y, shape);
}

/**
 * Is this point on the robot?
 *
 * The one question the coverage grid asks. Painting the paper around the robot
 * is allowed and charges nothing, so this is what separates the two.
 */
export function insideSilhouette(x, y) {
  for (const entry of SHAPES) if (insideShape(x, y, entry.shape)) return true;
  return false;
}

/** Which piece owns this point, or null. Front-most piece wins. */
export function pieceAt(x, y) {
  for (const entry of [...SHAPES].sort((a, b) => b.order - a.order)) {
    if (insideShape(x, y, entry.shape)) return entry.piece;
  }
  return null;
}

/**
 * How much of the picture the robot occupies, by sampling.
 *
 * Used to sanity-check the power threshold: it only means anything relative to
 * the robot's own area, not to the canvas.
 */
export function silhouetteArea(samples = 400) {
  let hits = 0;
  for (let iy = 0; iy < samples; iy += 1) {
    for (let ix = 0; ix < samples; ix += 1) {
      if (insideSilhouette((ix + 0.5) / samples, (iy + 0.5) / samples)) hits += 1;
    }
  }
  return hits / (samples * samples);
}
