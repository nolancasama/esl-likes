/**
 * ROBOT POWER: how much of the robot the child has actually coloured.
 *
 * Pure. No canvas, no DOM — the painting surface tells this module where the
 * brush went and this module decides what it was worth, which is what makes the
 * whole mechanic testable without a browser.
 *
 * Three rules do all the work:
 *
 *   1. **Current colour only.** A cell contributes to power exactly when its
 *      current paint is the robot's favourite. Repainting and erasing update
 *      that contribution, while repeating the same colour changes nothing.
 *   2. **Inside the silhouette only.** Painting the paper around the robot is
 *      allowed and charges nothing, so a child cannot power the robot by
 *      colouring the background.
 *   3. **Unique painted area stays available separately.** Coverage still
 *      measures every currently painted cell, regardless of its colour.
 *
 * Stroke count, elapsed time and brush travel are deliberately worth nothing.
 */

import { insideSilhouette } from './robotDefinition.js';

/**
 * Cells across the picture. 120 gives 6px cells at `PICTURE_SIZE`, so the 18px
 * small brush still spans three of them and a detail is not lost to rounding.
 */
export const GRID = 120;

/**
 * Full power at this share of the robot, not at 100%.
 *
 * A child should never have to hunt the last unpainted corner, and a robot that
 * only wakes when the page is perfect is a robot most of a class never sees.
 */
export const FAVOURITE_POWER_THRESHOLD = 0.28;

/** Where the bar does something playful on the way up. */
export const MILESTONES = Object.freeze([0.25, 0.5, 0.78]);

const CELL_EMPTY = 0;
const CELL_PLAIN = 1;
const CELL_FAVOURITE = 2;

/**
 * Which cells are on the robot, computed once.
 *
 * A cell counts as robot if its centre is inside the silhouette. Sampling the
 * centre rather than the whole cell keeps the mask stable and cheap; at 6px a
 * cell the edge error is invisible in a progress bar.
 */
function buildMask() {
  const mask = new Uint8Array(GRID * GRID);
  let cells = 0;
  for (let gy = 0; gy < GRID; gy += 1) {
    for (let gx = 0; gx < GRID; gx += 1) {
      if (insideSilhouette((gx + 0.5) / GRID, (gy + 0.5) / GRID)) {
        mask[gy * GRID + gx] = 1;
        cells += 1;
      }
    }
  }
  return { mask, cells };
}

let cached = null;
/** The robot mask, shared: it depends only on the definition. */
export function silhouetteMask() {
  cached ||= buildMask();
  return cached;
}

/** Cells on the robot. Exported so a test can reason about the threshold. */
export const robotCellCount = () => silhouetteMask().cells;

/**
 * Tracks what has been coloured.
 *
 * @param {object} [options]
 * @param {string|null} [options.favourite] the NPC's colour this round
 */
export function createCoverage({ favourite = null } = {}) {
  const { mask, cells: robotCells } = silhouetteMask();
  const painted = new Uint8Array(GRID * GRID);
  /** Undo is per stroke: the cells this stroke changed, and what they were. */
  const strokes = [];
  let open = null;
  let plainCells = 0;
  let favouriteCells = 0;
  let reached = -1;

  function setCell(index, next) {
    const previous = painted[index];
    if (previous === next) return;
    open ||= [];
    open.push({ index, previous });
    painted[index] = next;
    if (previous === CELL_PLAIN) plainCells -= 1;
    if (previous === CELL_FAVOURITE) favouriteCells -= 1;
    if (next === CELL_PLAIN) plainCells += 1;
    if (next === CELL_FAVOURITE) favouriteCells += 1;
  }

  /** Marks every robot cell under a disc with its current colour. */
  function dab(cx, cy, radius, value) {
    const r = radius * GRID;
    const gx = cx * GRID;
    const gy = cy * GRID;
    const minX = Math.max(0, Math.floor(gx - r));
    const maxX = Math.min(GRID - 1, Math.ceil(gx + r));
    const minY = Math.max(0, Math.floor(gy - r));
    const maxY = Math.min(GRID - 1, Math.ceil(gy + r));
    const rSq = r * r;
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const dx = x + 0.5 - gx;
        const dy = y + 0.5 - gy;
        if (dx * dx + dy * dy > rSq) continue;
        const index = y * GRID + x;
        if (!mask[index]) continue;
        setCell(index, value);
      }
    }
  }

  const api = {
    get robotCells() { return robotCells; },
    get favourite() { return favourite; },

    beginStroke() {
      open = [];
      return api;
    },

    /**
     * The brush moved from one point to another.
     *
     * Interpolated, because a touchpad flick reports two points a long way
     * apart and a gap in the coverage would be a gap the child cannot see and
     * cannot fix. `diameter` is normalised to the picture.
     */
    paintSegment(from, to, diameter, color) {
      const radius = Math.max(diameter, 1 / GRID) / 2;
      const [x1, y1] = Array.isArray(from) ? from : [from.x, from.y];
      const [x2, y2] = Array.isArray(to) ? to : [to.x, to.y];
      const value = color === null ? CELL_EMPTY
        : (favourite && color === favourite) ? CELL_FAVOURITE : CELL_PLAIN;
      const distance = Math.hypot(x2 - x1, y2 - y1);
      const steps = Math.max(1, Math.ceil(distance / (radius * 0.6)));
      for (let step = 0; step <= steps; step += 1) {
        const k = step / steps;
        dab(x1 + (x2 - x1) * k, y1 + (y2 - y1) * k, radius, value);
      }
      return api;
    },

    /** The eraser: gives back the coverage it removes. */
    eraseSegment(from, to, diameter) {
      return api.paintSegment(from, to, diameter, null);
    },

    endStroke() {
      if (open?.length) strokes.push(open);
      open = null;
      return api;
    },

    get canUndo() { return strokes.length > 0; },

    /** Reverses a whole stroke, coverage and all. Never a single cell. */
    undoStroke() {
      const stroke = strokes.pop();
      if (!stroke) return false;
      for (let i = stroke.length - 1; i >= 0; i -= 1) {
        const { index, previous } = stroke[i];
        const current = painted[index];
        painted[index] = previous;
        if (current === CELL_PLAIN) plainCells -= 1;
        if (current === CELL_FAVOURITE) favouriteCells -= 1;
        if (previous === CELL_PLAIN) plainCells += 1;
        if (previous === CELL_FAVOURITE) favouriteCells += 1;
      }
      return true;
    },

    reset() {
      painted.fill(0);
      strokes.length = 0;
      open = null;
      plainCells = 0;
      favouriteCells = 0;
      reached = -1;
      return api;
    },

    /** Plain unique share of the robot that has any paint on it, 0..1. */
    coverage() {
      return robotCells ? (plainCells + favouriteCells) / robotCells : 0;
    },

    /** Share of the painted area that used the favourite colour, 0..1. */
    favouriteShare() {
      const total = plainCells + favouriteCells;
      return total ? favouriteCells / total : 0;
    },

    /**
     * The bar, 0..1.
     *
     * Only cells currently painted in the robot's favourite colour contribute.
     * Full power arrives before the whole silhouette is filled so the child
     * does not have to hunt the final unpainted corners.
     */
    power() {
      if (!robotCells) return 0;
      return Math.min(1, favouriteCells / (robotCells * FAVOURITE_POWER_THRESHOLD));
    },

    isFull() { return api.power() >= 1; },

    /**
     * The next milestone crossed since this was last asked, or null.
     *
     * Asked once a frame, so it has to be edge-triggered — a milestone that
     * keeps firing is a robot that keeps interrupting.
     */
    takeMilestone() {
      const power = api.power();
      for (let i = MILESTONES.length - 1; i >= 0; i -= 1) {
        if (power >= MILESTONES[i] && reached < i) {
          reached = i;
          return { index: i, at: MILESTONES[i] };
        }
      }
      return null;
    },
  };

  return api;
}

/**
 * Stars for a whole session: one per robot, up to three.
 *
 * There is no per-round score any more, because there is no longer a round in
 * any meaningful sense — the child paints for as long as they like and the
 * session ends when they walk out of the door. So the stamp counts the thing
 * the loop is actually built to reward: how many robots they brought to life.
 *
 * Coverage and the favourite colour are deliberately not in here. A robot that
 * exists has already passed the favourite-colour power threshold, so coverage
 * is not information. Nothing here can fail: one robot is one star, and the
 * room is only ever reached by finishing one.
 */
export function sessionStars(robots = 0) {
  return Math.min(3, Math.max(1, Math.floor(robots)));
}
