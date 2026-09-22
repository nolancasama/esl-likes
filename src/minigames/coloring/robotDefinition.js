/**
 * The robot, defined once.
 *
 * Both the colouring page and the paper puppet read this file, so there is one
 * robot rather than two that drift apart. Pure data and pure maths: no canvas,
 * no three.js, no DOM, so the whole shape of the robot is testable.
 *
 * Coordinates are normalised 0..1 over a square picture, with y increasing
 * downward, matching the convention `picture.js` already draws in.
 *
 * See `.ai/coloring-robot-spec.md` for the contract this implements.
 */

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/** The picture is authored at this size; the touch-target floor is measured in it. */
export const PICTURE_SIZE = 720;

/**
 * The smallest a region's *hit area* may be, in CSS pixels at `PICTURE_SIZE`.
 * 44px is the usual touch-target floor, and a Chromebook touchpad is no more
 * accurate than a finger. Thin details still *draw* thin — `hitPad` grows only
 * the area you can click, which is why a decorative stripe stays a stripe.
 */
export const MIN_HIT_PX = 44;
export const MIN_HIT = MIN_HIT_PX / PICTURE_SIZE;

/** The nine rigid pieces the paper puppet is cut into. */
export const PIECES = Object.freeze([
  'head', 'antenna', 'torso',
  'leftUpperArm', 'leftForearm', 'rightUpperArm', 'rightForearm',
  'leftLeg', 'rightLeg',
]);

/**
 * Where each piece turns when the puppet walks, in the same normalised space.
 * A piece rotates about its own pivot; nothing deforms.
 */
export const PIVOTS = deepFreeze({
  head: { x: 0.5, y: 0.345 },
  antenna: { x: 0.5, y: 0.155 },
  torso: { x: 0.5, y: 0.5 },
  leftUpperArm: { x: 0.226, y: 0.408 },
  leftForearm: { x: 0.226, y: 0.538 },
  rightUpperArm: { x: 0.774, y: 0.408 },
  rightForearm: { x: 0.774, y: 0.538 },
  leftLeg: { x: 0.4025, y: 0.628 },
  rightLeg: { x: 0.5975, y: 0.628 },
});

const rect = (x, y, width, height, radius = 0.03) => ({ kind: 'rect', x, y, width, height, radius });
const circle = (cx, cy, r) => ({ kind: 'circle', cx, cy, r });
const box = (x, y, width, height) => ({ minX: x, minY: y, maxX: x + width, maxY: y + height });

/**
 * Eighteen regions: one `required-favorite`, two `required-label`, fifteen free.
 *
 * `type` is the whole of the correctness model — nothing downstream hard-codes
 * a region id. Adding a required region is a data change.
 */
export const REGIONS = deepFreeze([
  // --- antenna ------------------------------------------------------------
  {
    id: 'antennaLight', piece: 'antenna', type: 'required-label', order: 90,
    shapes: [circle(0.5, 0.045, 0.038)],
    // A 55px circle cannot hold `ORANGE` at a legible size, so the word sits on
    // clear paper beside the light with a leader line back to it.
    labelBox: box(0.565, 0.018, 0.2, 0.054),
  },
  {
    id: 'antennaStalk', piece: 'antenna', type: 'free', order: 10,
    // Drawn as a thin stalk, clicked as a comfortable target.
    shapes: [rect(0.486, 0.083, 0.028, 0.072, 0.012)], hitPad: 0.022,
  },

  // --- head ---------------------------------------------------------------
  { id: 'face', piece: 'head', type: 'free', order: 20, shapes: [rect(0.315, 0.155, 0.37, 0.19, 0.05)] },
  {
    id: 'ears', piece: 'head', type: 'free', order: 21,
    shapes: [rect(0.255, 0.215, 0.06, 0.07, 0.025), rect(0.685, 0.215, 0.06, 0.07, 0.025)],
    hitPad: 0.012,
  },
  {
    id: 'eyes', piece: 'head', type: 'required-label', order: 91,
    shapes: [rect(0.375, 0.195, 0.25, 0.075, 0.035)],
    // The band is occupied by the pupils, so the word sits under it on the face,
    // far enough clear to carry a leader — without one it read as an
    // instruction for the face rather than for the eyes.
    labelBox: box(0.375, 0.292, 0.25, 0.048),
  },

  // --- torso --------------------------------------------------------------
  {
    // Two caps rather than one bar. A single bar across the whole width read as
    // a plank laid over the robot as soon as it was coloured differently from
    // the body; a cap per side reads as a shoulder and bridges torso to arm.
    id: 'shoulders', piece: 'torso', type: 'free', order: 35,
    shapes: [rect(0.226, 0.362, 0.145, 0.062, 0.031), rect(0.629, 0.362, 0.145, 0.062, 0.031)],
    hitPad: 0.008,
  },
  { id: 'body', piece: 'torso', type: 'free', order: 31, shapes: [rect(0.3, 0.41, 0.4, 0.215, 0.045)] },
  {
    id: 'chestPanel', piece: 'torso', type: 'required-favorite', order: 92,
    shapes: [rect(0.395, 0.435, 0.21, 0.105, 0.025)],
  },
  {
    // Three studs, not one pill: `buttons` should look like buttons. Each is
    // well under the touch floor on its own, which `hitBounds` grows for free.
    id: 'buttons', piece: 'torso', type: 'free', order: 33,
    shapes: [circle(0.44, 0.582, 0.022), circle(0.5, 0.582, 0.022), circle(0.56, 0.582, 0.022)],
    hitPad: 0.012,
  },
  {
    id: 'sidePanels', piece: 'torso', type: 'free', order: 32,
    shapes: [rect(0.3, 0.44, 0.055, 0.15, 0.02), rect(0.645, 0.44, 0.055, 0.15, 0.02)],
    hitPad: 0.012,
  },

  // --- arms ---------------------------------------------------------------
  // Slim and long: at 0.105 wide for 0.27 of length these read as two blobs
  // beside the torso. 0.072 wide for 0.30, held off the body by a gap the
  // shoulder cap bridges, gives the silhouette a shoulder and an elbow.
  { id: 'leftUpperArm', piece: 'leftUpperArm', type: 'free', order: 40, shapes: [rect(0.19, 0.4, 0.072, 0.135, 0.03)] },
  { id: 'leftForearm', piece: 'leftForearm', type: 'free', order: 41, shapes: [rect(0.19, 0.535, 0.072, 0.165, 0.03)] },
  { id: 'rightUpperArm', piece: 'rightUpperArm', type: 'free', order: 42, shapes: [rect(0.738, 0.4, 0.072, 0.135, 0.03)] },
  { id: 'rightForearm', piece: 'rightForearm', type: 'free', order: 43, shapes: [rect(0.738, 0.535, 0.072, 0.165, 0.03)] },

  // --- legs ---------------------------------------------------------------
  // Tucked up under the torso rather than floating 0.01 below it.
  { id: 'leftLeg', piece: 'leftLeg', type: 'free', order: 50, shapes: [rect(0.345, 0.618, 0.115, 0.187, 0.035)] },
  { id: 'leftFoot', piece: 'leftLeg', type: 'free', order: 51, shapes: [rect(0.325, 0.805, 0.155, 0.07, 0.03)] },
  { id: 'rightLeg', piece: 'rightLeg', type: 'free', order: 52, shapes: [rect(0.54, 0.618, 0.115, 0.187, 0.035)] },
  { id: 'rightFoot', piece: 'rightLeg', type: 'free', order: 53, shapes: [rect(0.52, 0.805, 0.155, 0.07, 0.03)] },
]);

export const REGION_BY_ID = deepFreeze(Object.fromEntries(REGIONS.map((region) => [region.id, region])));
export const REGION_IDS = Object.freeze(REGIONS.map((region) => region.id));

export const REQUIRED_REGIONS = Object.freeze(
  REGIONS.filter((region) => region.type !== 'free'),
);
export const FREE_REGIONS = Object.freeze(REGIONS.filter((region) => region.type === 'free'));
export const FAVORITE_REGIONS = Object.freeze(
  REGIONS.filter((region) => region.type === 'required-favorite'),
);
export const LABEL_REGIONS = Object.freeze(
  REGIONS.filter((region) => region.type === 'required-label'),
);

/** `{ head: ['face', 'ears', 'eyes'], ... }` — what each puppet piece is cut from. */
export const REGIONS_BY_PIECE = deepFreeze(Object.fromEntries(
  PIECES.map((piece) => [piece, REGIONS.filter((region) => region.piece === piece).map((r) => r.id)]),
));

/** The bounding box of one shape, as `{ minX, minY, maxX, maxY }`. */
export function shapeBounds(shape) {
  if (shape.kind === 'circle') {
    return { minX: shape.cx - shape.r, minY: shape.cy - shape.r, maxX: shape.cx + shape.r, maxY: shape.cy + shape.r };
  }
  return { minX: shape.x, minY: shape.y, maxX: shape.x + shape.width, maxY: shape.y + shape.height };
}

/** The bounding box of a whole region, or of a whole piece. */
export function regionBounds(regionId) {
  const region = REGION_BY_ID[regionId];
  if (!region) return null;
  return mergeBounds(region.shapes.map(shapeBounds));
}

export function pieceBounds(piece) {
  const ids = REGIONS_BY_PIECE[piece];
  if (!ids?.length) return null;
  return mergeBounds(ids.map(regionBounds));
}

function mergeBounds(list) {
  return list.reduce((box, next) => ({
    minX: Math.min(box.minX, next.minX),
    minY: Math.min(box.minY, next.minY),
    maxX: Math.max(box.maxX, next.maxX),
    maxY: Math.max(box.maxY, next.maxY),
  }));
}

/**
 * Where a region's instruction word is drawn.
 *
 * Its own bounds by default. A region may author a `labelBox` instead when its
 * shape cannot hold a legible word — a small circle, or a band already occupied
 * by the pupils. `leader` says the box sits outside the region, so the renderer
 * should draw a thin line from one to the other.
 */
export function labelPlacement(regionId) {
  const region = REGION_BY_ID[regionId];
  if (!region) return null;
  const own = regionBounds(regionId);
  if (!region.labelBox) return { ...own, leader: false, anchor: null };
  const b = region.labelBox;
  const overlaps = b.minX < own.maxX && b.maxX > own.minX && b.minY < own.maxY && b.maxY > own.minY;
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  return {
    ...b,
    leader: !overlaps,
    // Clamped to the region's edge rather than its centre, so the line meets
    // the shape it points at instead of being drawn across its fill.
    anchor: {
      x: Math.min(Math.max(cx, own.minX), own.maxX),
      y: Math.min(Math.max(cy, own.minY), own.maxY),
    },
  };
}

/**
 * The clickable box of a region: its drawn bounds grown by `hitPad`, then
 * grown again if either side is still under the touch floor. Drawing is
 * unaffected — this is only what the pointer has to hit.
 */
export function hitBounds(regionId) {
  const region = REGION_BY_ID[regionId];
  if (!region) return null;
  const pad = region.hitPad ?? 0;
  const box = regionBounds(regionId);
  let { minX, minY, maxX, maxY } = {
    minX: box.minX - pad, minY: box.minY - pad, maxX: box.maxX + pad, maxY: box.maxY + pad,
  };
  const growX = Math.max(0, MIN_HIT - (maxX - minX)) / 2;
  const growY = Math.max(0, MIN_HIT - (maxY - minY)) / 2;
  minX -= growX; maxX += growX;
  minY -= growY; maxY += growY;
  return { minX, minY, maxX, maxY };
}

const insideRect = (x, y, shape) => {
  const { x: left, y: top, width, height, radius } = shape;
  const right = left + width;
  const bottom = top + height;
  if (x < left || x > right || y < top || y > bottom) return false;
  const r = Math.min(radius ?? 0, width / 2, height / 2);
  if (r <= 0) return true;
  // Only the four corner squares need the rounded test.
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
 * Which region a point belongs to, or null.
 *
 * Regions are tested by descending `order`, so a required panel drawn on top of
 * the body claims the click rather than the body underneath it. The drawn
 * shapes are tried first across every region, and only then the padded hit
 * boxes — otherwise a thin stalk's generous padding would swallow clicks meant
 * for the face beside it.
 */
export function regionAt(x, y) {
  const ordered = [...REGIONS].sort((a, b) => b.order - a.order);
  for (const region of ordered) {
    for (const shape of region.shapes) if (insideShape(x, y, shape)) return region.id;
  }
  for (const region of ordered) {
    const box = hitBounds(region.id);
    if (x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY) return region.id;
  }
  return null;
}

/**
 * A point inside a region that `regionAt` really attributes to it, or null.
 *
 * Not the bounding-box centre. Regions overlap on purpose — the chest panel is
 * drawn over the body, the shoulder cap over both body and arm — so the centre
 * of the torso's box belongs to the panel. Anything aiming at a region (a test,
 * a playthrough, a future keyboard hint arrow) needs the point that actually
 * colours it, and every region having one is an invariant worth asserting:
 * a region nothing can hit is decoration a child can never use.
 */
export function tappablePoint(regionId) {
  const region = REGION_BY_ID[regionId];
  if (!region) return null;
  const steps = 11;
  for (const shape of region.shapes) {
    const box = shapeBounds(shape);
    for (let iy = 1; iy < steps; iy += 1) {
      for (let ix = 1; ix < steps; ix += 1) {
        const x = box.minX + (box.maxX - box.minX) * (ix / steps);
        const y = box.minY + (box.maxY - box.minY) * (iy / steps);
        if (regionAt(x, y) === regionId) return { x, y };
      }
    }
  }
  return null;
}
