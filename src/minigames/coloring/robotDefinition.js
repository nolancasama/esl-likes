/** Shared subject geometry. Coordinates are normalised over a square page. */

/** The picture is authored at this size. Shared by every subject. */
export const PICTURE_SIZE = 720;

export function shapesForPiece(subject, piece) {
  return subject.shapes.filter((entry) => entry.piece === piece);
}

export function drawOrder(subject) {
  return [...subject.shapes].sort((a, b) => a.order - b.order);
}

export function shapeBounds(shape) {
  if (shape.kind === 'circle') {
    return {
      minX: shape.cx - shape.r,
      minY: shape.cy - shape.r,
      maxX: shape.cx + shape.r,
      maxY: shape.cy + shape.r,
    };
  }
  return {
    minX: shape.x,
    minY: shape.y,
    maxX: shape.x + shape.width,
    maxY: shape.y + shape.height,
  };
}

function mergeBounds(list) {
  if (!list.length) return null;
  return list.reduce((box, next) => ({
    minX: Math.min(box.minX, next.minX),
    minY: Math.min(box.minY, next.minY),
    maxX: Math.max(box.maxX, next.maxX),
    maxY: Math.max(box.maxY, next.maxY),
  }));
}

export function pieceBounds(subject, piece) {
  return mergeBounds(shapesForPiece(subject, piece).map((entry) => shapeBounds(entry.shape)));
}

export function silhouetteBounds(subject) {
  return mergeBounds(subject.shapes.map((entry) => shapeBounds(entry.shape)));
}

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

const insideCircle = (x, y, shape) => (
  (x - shape.cx) ** 2 + (y - shape.cy) ** 2 <= shape.r * shape.r
);

export function insideShape(x, y, shape) {
  return shape.kind === 'circle' ? insideCircle(x, y, shape) : insideRect(x, y, shape);
}

export function insideSilhouette(subject, x, y) {
  return subject.shapes.some((entry) => insideShape(x, y, entry.shape));
}

/** Which piece owns this point, or null. Front-most piece wins. */
export function pieceAt(subject, x, y) {
  const frontToBack = [...subject.shapes].sort((a, b) => b.order - a.order);
  return frontToBack.find((entry) => insideShape(x, y, entry.shape))?.piece ?? null;
}

export function silhouetteArea(subject, samples = 400) {
  let hits = 0;
  for (let iy = 0; iy < samples; iy += 1) {
    for (let ix = 0; ix < samples; ix += 1) {
      if (insideSilhouette(subject, (ix + 0.5) / samples, (iy + 0.5) / samples)) hits += 1;
    }
  }
  return hits / (samples * samples);
}
