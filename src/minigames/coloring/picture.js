import { COLOR_VALUES, REGION_VALUES } from './scoring.js';

export const PICTURE_SIZE = 720;
export const GRID_WIDTH = 72;
export const GRID_HEIGHT = 72;

const BRUSH_RADIUS = 34;

const SHAPES = Object.freeze({
  body: Object.freeze([{ x: 0.29, y: 0.37, width: 0.42, height: 0.43, radius: 0.055 }]),
  arms: Object.freeze([
    { x: 0.08, y: 0.43, width: 0.19, height: 0.27, radius: 0.045 },
    { x: 0.73, y: 0.43, width: 0.19, height: 0.27, radius: 0.045 },
  ]),
  eyes: Object.freeze([{ x: 0.29, y: 0.17, width: 0.42, height: 0.17, radius: 0.07 }]),
});

const STAR_POSITIONS = Object.freeze({
  body: Object.freeze([{ x: 0.5, y: 0.58 }]),
  arms: Object.freeze([{ x: 0.175, y: 0.565 }, { x: 0.825, y: 0.565 }]),
  eyes: Object.freeze([{ x: 0.5, y: 0.255 }]),
});

function insideRoundedRect(px, py, shape) {
  const { x, y, width, height, radius } = shape;
  if (px < x || px > x + width || py < y || py > y + height) return false;
  const innerLeft = x + radius;
  const innerRight = x + width - radius;
  const innerTop = y + radius;
  const innerBottom = y + height - radius;
  if (px >= innerLeft && px <= innerRight) return true;
  if (py >= innerTop && py <= innerBottom) return true;
  const cx = px < innerLeft ? innerLeft : innerRight;
  const cy = py < innerTop ? innerTop : innerBottom;
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= radius * radius;
}

function regionAt(x, y) {
  for (const shape of SHAPES.eyes) if (insideRoundedRect(x, y, shape)) return REGION_VALUES.eyes;
  for (const shape of SHAPES.body) if (insideRoundedRect(x, y, shape)) return REGION_VALUES.body;
  for (const shape of SHAPES.arms) if (insideRoundedRect(x, y, shape)) return REGION_VALUES.arms;
  return 0;
}

export function buildRegionMap(width = GRID_WIDTH, height = GRID_HEIGHT) {
  const map = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      map[y * width + x] = regionAt((x + 0.5) / width, (y + 0.5) / height);
    }
  }
  return map;
}

function roundedRectPath(context, shape, size) {
  const x = shape.x * size;
  const y = shape.y * size;
  const width = shape.width * size;
  const height = shape.height * size;
  const radius = shape.radius * size;
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}

function drawStar(context, x, y, radius) {
  context.save();
  context.beginPath();
  for (let point = 0; point < 10; point += 1) {
    const angle = -Math.PI / 2 + point * Math.PI / 5;
    const distance = point % 2 === 0 ? radius : radius * 0.46;
    const px = x + Math.cos(angle) * distance;
    const py = y + Math.sin(angle) * distance;
    if (point === 0) context.moveTo(px, py);
    else context.lineTo(px, py);
  }
  context.closePath();
  context.fillStyle = '#ffffff';
  context.strokeStyle = '#17233a';
  context.lineWidth = Math.max(7, radius * 0.22);
  context.lineJoin = 'round';
  context.fill();
  context.stroke();
  context.restore();
}

/** Draw the robot's bold line art after paint so every boundary stays crisp. */
export function drawLineArt(context, { size = PICTURE_SIZE, starred = null } = {}) {
  context.save();
  context.strokeStyle = '#17233a';
  context.lineWidth = size * 0.018;
  context.lineJoin = 'round';
  context.lineCap = 'round';

  for (const region of ['body', 'arms', 'eyes']) {
    for (const shape of SHAPES[region]) {
      roundedRectPath(context, shape, size);
      context.stroke();
    }
  }

  // Open decorative lines add robot character without creating extra paint regions.
  context.beginPath();
  context.moveTo(size * 0.5, size * 0.17);
  context.lineTo(size * 0.5, size * 0.09);
  context.lineTo(size * 0.46, size * 0.055);
  context.moveTo(size * 0.4, size * 0.8);
  context.lineTo(size * 0.38, size * 0.91);
  context.moveTo(size * 0.6, size * 0.8);
  context.lineTo(size * 0.62, size * 0.91);
  context.moveTo(size * 0.12, size * 0.7);
  context.lineTo(size * 0.1, size * 0.77);
  context.moveTo(size * 0.88, size * 0.7);
  context.lineTo(size * 0.9, size * 0.77);
  context.stroke();

  context.fillStyle = '#17233a';
  context.beginPath();
  context.arc(size * 0.41, size * 0.255, size * 0.022, 0, Math.PI * 2);
  context.arc(size * 0.59, size * 0.255, size * 0.022, 0, Math.PI * 2);
  context.fill();

  if (STAR_POSITIONS[starred]) {
    for (const position of STAR_POSITIONS[starred]) {
      drawStar(context, position.x * size, position.y * size, size * 0.047);
    }
  }
  context.restore();
}

export function createLineArtCanvas(starred = null, size = PICTURE_SIZE) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, size, size);
  drawLineArt(context, { size, starred });
  return canvas;
}

function paintGridDisk(grid, width, height, cx, cy, radius, colorValue) {
  const minX = Math.max(0, Math.floor(cx - radius));
  const maxX = Math.min(width - 1, Math.ceil(cx + radius));
  const minY = Math.max(0, Math.floor(cy - radius));
  const maxY = Math.min(height - 1, Math.ceil(cy + radius));
  const radiusSq = radius * radius;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (dx * dx + dy * dy <= radiusSq) grid[y * width + x] = colorValue;
    }
  }
}

function paintGridSegment(grid, width, height, from, to, radius, colorValue) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(distance / Math.max(0.5, radius * 0.35)));
  for (let step = 0; step <= steps; step += 1) {
    const amount = step / steps;
    paintGridDisk(
      grid,
      width,
      height,
      from.x + dx * amount,
      from.y + dy * amount,
      radius,
      colorValue,
    );
  }
}

/**
 * Pointer-driven brush surface. The visible stroke and coarse score grid use
 * the same round, interpolated segment geometry.
 */
export function createPaintingSurface({ canvas, starred, onPaint }) {
  const paintCanvas = document.createElement('canvas');
  paintCanvas.width = PICTURE_SIZE;
  paintCanvas.height = PICTURE_SIZE;
  const paintContext = paintCanvas.getContext('2d');
  const displayContext = canvas.getContext('2d');
  const paintGrid = new Uint8Array(GRID_WIDTH * GRID_HEIGHT);
  let selected = null;
  let pointerId = null;
  let previous = null;

  canvas.width = PICTURE_SIZE;
  canvas.height = PICTURE_SIZE;

  function render() {
    displayContext.fillStyle = '#ffffff';
    displayContext.fillRect(0, 0, PICTURE_SIZE, PICTURE_SIZE);
    displayContext.drawImage(paintCanvas, 0, 0);
    drawLineArt(displayContext, { starred });
  }

  function pointFor(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * PICTURE_SIZE / Math.max(1, rect.width),
      y: (event.clientY - rect.top) * PICTURE_SIZE / Math.max(1, rect.height),
    };
  }

  function paint(from, to) {
    if (!selected) return;
    paintContext.strokeStyle = selected.css;
    paintContext.fillStyle = selected.css;
    paintContext.lineWidth = BRUSH_RADIUS * 2;
    paintContext.lineCap = 'round';
    paintContext.lineJoin = 'round';
    paintContext.beginPath();
    paintContext.moveTo(from.x, from.y);
    paintContext.lineTo(to.x, to.y);
    paintContext.stroke();
    paintContext.beginPath();
    paintContext.arc(to.x, to.y, BRUSH_RADIUS, 0, Math.PI * 2);
    paintContext.fill();

    const gridFrom = { x: from.x * GRID_WIDTH / PICTURE_SIZE, y: from.y * GRID_HEIGHT / PICTURE_SIZE };
    const gridTo = { x: to.x * GRID_WIDTH / PICTURE_SIZE, y: to.y * GRID_HEIGHT / PICTURE_SIZE };
    paintGridSegment(
      paintGrid,
      GRID_WIDTH,
      GRID_HEIGHT,
      gridFrom,
      gridTo,
      BRUSH_RADIUS * GRID_WIDTH / PICTURE_SIZE,
      selected.value,
    );
    render();
    onPaint?.(paintGrid);
  }

  function pointerDown(event) {
    if (!selected || pointerId !== null || event.button > 0) return;
    event.preventDefault();
    pointerId = event.pointerId;
    previous = pointFor(event);
    canvas.setPointerCapture?.(pointerId);
    paint(previous, previous);
  }

  function pointerMove(event) {
    if (event.pointerId !== pointerId || !previous) return;
    event.preventDefault();
    const next = pointFor(event);
    paint(previous, next);
    previous = next;
  }

  function endPointer(event) {
    if (event.pointerId !== pointerId) return;
    event.preventDefault();
    if (canvas.hasPointerCapture?.(pointerId)) canvas.releasePointerCapture(pointerId);
    pointerId = null;
    previous = null;
  }

  canvas.addEventListener('pointerdown', pointerDown);
  canvas.addEventListener('pointermove', pointerMove);
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  render();

  return {
    paintGrid,
    setColor(color) {
      const value = COLOR_VALUES[color];
      selected = value ? { value, css: { red: '#ef4f4f', blue: '#3a78e8', yellow: '#ffd43b' }[color] } : null;
    },
    snapshot() {
      const result = document.createElement('canvas');
      result.width = PICTURE_SIZE;
      result.height = PICTURE_SIZE;
      result.getContext('2d').drawImage(canvas, 0, 0);
      return result;
    },
    dispose() {
      canvas.removeEventListener('pointerdown', pointerDown);
      canvas.removeEventListener('pointermove', pointerMove);
      canvas.removeEventListener('pointerup', endPointer);
      canvas.removeEventListener('pointercancel', endPointer);
      pointerId = null;
      previous = null;
      selected = null;
      paintCanvas.width = 0;
      paintCanvas.height = 0;
    },
  };
}
