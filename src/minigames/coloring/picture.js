/**
 * The live colouring page.
 *
 * Tap to fill: a pointer lands on a region, the region takes the selected
 * colour, done. There is no brush and nothing to be neat about — see
 * `.ai/coloring-robot-spec.md` for why a neatness margin cannot survive a dozen
 * small accent regions on a Chromebook touchpad.
 *
 * This module owns only the canvas and the input. What the robot looks like
 * lives in `robotDefinition.js`, how it is drawn lives in `robotRenderer.js`,
 * and what the child has chosen lives in `colorState.js`. Nothing here decides
 * whether an answer is right.
 */

import { PICTURE_SIZE, REGIONS, regionAt, regionBounds } from './robotDefinition.js';
import { drawRobot } from './robotRenderer.js';

export { PICTURE_SIZE };

const PAPER = '#f7f4ee';

/**
 * Regions in reading order — top to bottom, then left to right.
 *
 * This is the keyboard's traversal order, so it has to be the order a child
 * would point at things in, not the order they happen to be declared in or the
 * draw order (which puts the antenna light first because it is drawn last).
 */
export function readingOrder() {
  return REGIONS
    .map((region) => {
      const box = regionBounds(region.id);
      return { id: region.id, y: (box.minY + box.maxY) / 2, x: (box.minX + box.maxX) / 2 };
    })
    // A band, so two things at roughly the same height sort left to right rather
    // than by a pixel of difference.
    .sort((a, b) => Math.round(a.y * 12) - Math.round(b.y * 12) || a.x - b.x)
    .map((entry) => entry.id);
}

/**
 * Maps a pointer event to normalised picture coordinates.
 *
 * Exported because the canvas is letterboxed by `object-fit: contain`, and
 * getting this wrong is invisible until every click lands slightly high.
 */
export function pointToPicture(rect, clientX, clientY) {
  const size = Math.min(rect.width, rect.height);
  if (size <= 0) return { x: -1, y: -1 };
  const left = rect.left + (rect.width - size) / 2;
  const top = rect.top + (rect.height - size) / 2;
  return { x: (clientX - left) / size, y: (clientY - top) / size };
}

/**
 * The colouring surface.
 *
 * @param {object} options
 * @param {HTMLCanvasElement} options.canvas
 * @param {object} options.state   a `createColorState()`
 * @param {object} options.round   for the ★ and the colour words
 * @param {(regionId: string, action: string) => void} [options.onChange]
 * @param {() => string|null} options.selectedColor  null while nothing is chosen
 * @param {() => boolean} [options.erasing]
 */
export function createColoringSurface({
  canvas,
  state,
  round,
  onChange,
  selectedColor,
  erasing = () => false,
}) {
  const order = readingOrder();
  const ctx = canvas.getContext('2d');
  let highlight = null;
  let hint = null;
  let focusIndex = -1;
  let keyboardDriven = false;
  let disposed = false;

  // The picture is authored at PICTURE_SIZE; drawing at the same size on a
  // device-pixel-scaled backing store keeps the line art crisp on a Chromebook
  // without threading a second coordinate system through the renderer.
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
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, PICTURE_SIZE, PICTURE_SIZE);
    drawRobot(ctx, { size: PICTURE_SIZE, colors: state.snapshot(), round, highlight: highlight ?? hint });
  }

  function setHighlight(regionId) {
    if (highlight === regionId) return;
    highlight = regionId;
    render();
  }

  /** Fill or erase one region, and tell the caller what actually happened. */
  function apply(regionId) {
    if (!regionId) return null;
    if (erasing()) {
      if (!state.clear(regionId)) return null;
      onChange?.(regionId, 'erase');
      render();
      return 'erase';
    }
    const color = selectedColor();
    if (!color) {
      onChange?.(regionId, 'no-color');
      return null;
    }
    if (!state.fill(regionId, color)) {
      // Re-tapping a region in the colour it already holds is not an error and
      // must not cost an undo step; the caller may still want to answer it.
      onChange?.(regionId, 'unchanged');
      return null;
    }
    onChange?.(regionId, 'fill');
    render();
    return 'fill';
  }

  function regionFor(event) {
    const point = pointToPicture(canvas.getBoundingClientRect(), event.clientX, event.clientY);
    return regionAt(point.x, point.y);
  }

  function onPointerDown(event) {
    if (event.button > 0) return;
    event.preventDefault();
    const regionId = regionFor(event);
    if (!regionId) return;
    keyboardDriven = false;
    focusIndex = order.indexOf(regionId);
    setHighlight(regionId);
    apply(regionId);
  }

  function onPointerMove(event) {
    if (keyboardDriven) return;
    setHighlight(regionFor(event));
  }

  function onPointerLeave() {
    if (!keyboardDriven) setHighlight(null);
  }

  function step(delta) {
    keyboardDriven = true;
    focusIndex = focusIndex < 0
      ? (delta > 0 ? 0 : order.length - 1)
      : (focusIndex + delta + order.length) % order.length;
    setHighlight(order[focusIndex]);
  }

  function onKeyDown(event) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') step(1);
    else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') step(-1);
    else if (event.key === 'Enter' || event.key === ' ') {
      if (focusIndex < 0) step(1);
      else apply(order[focusIndex]);
    } else return;
    event.preventDefault();
  }

  function onBlur() {
    keyboardDriven = false;
    setHighlight(null);
  }

  canvas.tabIndex = 0;
  canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerleave', onPointerLeave);
  canvas.addEventListener('keydown', onKeyDown);
  canvas.addEventListener('blur', onBlur);
  render();

  return {
    render,
    get highlight() { return highlight ?? hint; },

    /**
     * Rings a region to point at it, without moving the pointer's own
     * highlight. Used to say "this labelled one is still wrong" — never for the
     * starred region, where pointing at it would be a step towards telling.
     */
    setHint(regionId) {
      hint = regionId ?? null;
      render();
    },

    /**
     * The finished artwork with no instructions on it, for the wall frame.
     *
     * Drawn fresh rather than copied off the display canvas, so the ★ and any
     * remaining colour words are absent and the highlight cannot be baked in.
     */
    snapshot(size = PICTURE_SIZE) {
      const result = document.createElement('canvas');
      result.width = size;
      result.height = size;
      const out = result.getContext('2d');
      out.fillStyle = PAPER;
      out.fillRect(0, 0, size, size);
      drawRobot(out, { size, colors: state.snapshot(), labels: false });
      return result;
    },

    dispose() {
      disposed = true;
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('keydown', onKeyDown);
      canvas.removeEventListener('blur', onBlur);
      highlight = null;
    },
  };
}
