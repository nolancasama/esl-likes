/**
 * The colouring page: a brush, three sizes, and an eraser.
 *
 * Freehand again. The previous version filled named regions on a tap, which
 * graded beautifully and turned the robot into a worksheet; this one lets a
 * child drag paint wherever they like, including over the lines.
 *
 * Two canvases. The **paint** canvas holds only the child's strokes and is the
 * single source of truth for both the display and the puppet's textures — that
 * is what guarantees the living robot carries the real brushwork. The
 * **display** canvas is redrawn from it every frame as paper, blank body,
 * paint, line art.
 *
 * Undo replays rather than snapshots: a list of strokes costs almost nothing to
 * keep, where a 720x720 image per stroke would cost megabytes on a Chromebook.
 */

import { PICTURE_SIZE } from './robotDefinition.js';
import { drawPage } from './robotRenderer.js';
import { PALETTE_HEX } from './palette.js';
import { BRUSHES, DEFAULT_BRUSH, brushFor } from './brushes.js';

export { PICTURE_SIZE };

/**
 * Maps a pointer to normalised picture coordinates.
 *
 * Exported because the canvas is letterboxed by `object-fit: contain`, and
 * getting this wrong is invisible until every stroke lands slightly high.
 */
export function pointToPicture(rect, clientX, clientY) {
  const size = Math.min(rect.width, rect.height);
  if (size <= 0) return { x: -1, y: -1 };
  const left = rect.left + (rect.width - size) / 2;
  const top = rect.top + (rect.height - size) / 2;
  return { x: (clientX - left) / size, y: (clientY - top) / size };
}

/**
 * Lays one stroke onto a paint context.
 *
 * Exported so undo can replay a whole list through exactly the same code that
 * drew it live — a second drawing path is a second thing to get wrong.
 */
export function replayStroke(ctx, stroke, size = PICTURE_SIZE) {
  const { color, diameter, points } = stroke;
  if (!points.length) return;
  ctx.save();
  ctx.globalCompositeOperation = color === null ? 'destination-out' : 'source-over';
  ctx.strokeStyle = color === null ? 'rgba(0,0,0,1)' : PALETTE_HEX[color];
  ctx.fillStyle = ctx.strokeStyle;
  ctx.lineWidth = diameter * size;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (points.length === 1) {
    // A tap is a dot, not nothing.
    ctx.beginPath();
    ctx.arc(points[0][0] * size, points[0][1] * size, (diameter * size) / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(points[0][0] * size, points[0][1] * size);
    for (const [x, y] of points.slice(1)) ctx.lineTo(x * size, y * size);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * The live painting surface.
 *
 * @param {object} options
 * @param {HTMLCanvasElement} options.canvas   the visible canvas
 * @param {object} options.coverage            a `createCoverage()`
 * @param {() => string} options.color         the selected palette colour
 * @param {() => string} [options.brush]       the selected brush id
 * @param {() => boolean} [options.erasing]
 * @param {() => boolean} [options.locked]     true once the robot is activating
 * @param {(info: object) => void} [options.onChange]
 */
export function createPaintingSurface({
  canvas,
  coverage,
  color,
  brush = () => DEFAULT_BRUSH,
  erasing = () => false,
  locked = () => false,
  onChange,
}) {
  const paint = document.createElement('canvas');
  paint.width = PICTURE_SIZE;
  paint.height = PICTURE_SIZE;
  const paintCtx = paint.getContext('2d');
  const ctx = canvas.getContext('2d');

  /** Every stroke so far, in order. Undo pops and replays. */
  const strokes = [];
  let live = null;
  let pointerId = null;
  let blink = 0;
  let disposed = false;

  function resize() {
    const ratio = Math.min(3, Math.max(1, globalThis.devicePixelRatio || 1));
    const pixels = Math.round(PICTURE_SIZE * ratio);
    if (canvas.width !== pixels) {
      canvas.width = pixels;
      canvas.height = pixels;
    }
    return ratio;
  }

  function render() {
    if (disposed) return;
    const ratio = resize();
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    drawPage(ctx, { size: PICTURE_SIZE, paint, blink });
  }

  function rebuildPaint() {
    paintCtx.clearRect(0, 0, PICTURE_SIZE, PICTURE_SIZE);
    for (const stroke of strokes) replayStroke(paintCtx, stroke, PICTURE_SIZE);
  }

  function report() {
    onChange?.({
      power: coverage.power(),
      coverage: coverage.coverage(),
      milestone: coverage.takeMilestone(),
      canUndo: strokes.length > 0,
    });
  }

  function begin(point) {
    const diameter = brushFor(brush()).diameter / PICTURE_SIZE;
    const chosen = erasing() ? null : color();
    if (!erasing() && !chosen) {
      onChange?.({ needsColor: true, power: coverage.power(), coverage: coverage.coverage() });
      return false;
    }
    live = { color: chosen, diameter, points: [[point.x, point.y]] };
    coverage.beginStroke();
    // A tap alone must mark something, so seed the coverage with a dot.
    coverage.paintSegment([point.x, point.y], [point.x, point.y], diameter, chosen);
    replayStroke(paintCtx, live, PICTURE_SIZE);
    render();
    report();
    return true;
  }

  function extend(point) {
    if (!live) return;
    const previous = live.points[live.points.length - 1];
    if (Math.hypot(point.x - previous[0], point.y - previous[1]) < 0.002) return;
    live.points.push([point.x, point.y]);
    // The coverage grid interpolates for itself, so a fast touchpad flick
    // leaves no gap in either the paint or the bar.
    coverage.paintSegment(previous, [point.x, point.y], live.diameter, live.color);
    // Draw only the new segment rather than the whole stroke again.
    replayStroke(paintCtx, {
      color: live.color,
      diameter: live.diameter,
      points: [previous, [point.x, point.y]],
    }, PICTURE_SIZE);
    render();
    report();
  }

  function finish() {
    if (!live) return;
    strokes.push(live);
    live = null;
    coverage.endStroke();
    report();
  }

  function onPointerDown(event) {
    if (locked() || event.button > 0 || pointerId !== null) return;
    event.preventDefault();
    canvas.setPointerCapture?.(event.pointerId);
    pointerId = event.pointerId;
    if (!begin(pointToPicture(canvas.getBoundingClientRect(), event.clientX, event.clientY))) {
      pointerId = null;
    }
  }

  function onPointerMove(event) {
    if (event.pointerId !== pointerId || locked()) return;
    event.preventDefault();
    extend(pointToPicture(canvas.getBoundingClientRect(), event.clientX, event.clientY));
  }

  function onPointerUp(event) {
    if (event.pointerId !== pointerId) return;
    event.preventDefault();
    if (canvas.hasPointerCapture?.(pointerId)) canvas.releasePointerCapture(pointerId);
    pointerId = null;
    finish();
  }

  canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  render();

  return {
    render,
    /** The child's strokes alone. The puppet's textures are cut from this. */
    get paint() { return paint; },
    get strokeCount() { return strokes.length; },
    get canUndo() { return strokes.length > 0; },

    /** Closes the eyes, for the power milestones and the wake-up. */
    setBlink(value) {
      blink = Math.min(1, Math.max(0, value));
      render();
    },

    /** Reverses the last whole stroke, paint and power together. */
    undo() {
      if (!strokes.length) return false;
      strokes.pop();
      coverage.undoStroke();
      rebuildPaint();
      render();
      report();
      return true;
    },

    /**
     * The finished page for the wall frame: paper, body, paint, line art, eyes
     * open. Drawn fresh rather than copied off the display canvas so a blink
     * or a mid-stroke frame can never be baked in.
     */
    snapshot(size = PICTURE_SIZE) {
      const result = document.createElement('canvas');
      result.width = size;
      result.height = size;
      drawPage(result.getContext('2d'), { size, paint, blink: 0 });
      return result;
    },

    dispose() {
      disposed = true;
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      strokes.length = 0;
      live = null;
      paint.width = 0;
      paint.height = 0;
    },
  };
}

export { BRUSHES, DEFAULT_BRUSH };
