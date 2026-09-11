export const COLORS = Object.freeze(['red', 'blue', 'yellow']);
export const REGIONS = Object.freeze(['body', 'arms', 'eyes']);

export const COLOR_VALUES = Object.freeze({
  red: 1,
  blue: 2,
  yellow: 3,
});

export const REGION_VALUES = Object.freeze({
  body: 1,
  arms: 2,
  eyes: 3,
});

const NEATNESS_MARGIN = 2;

function pick(items, rng) {
  const sample = Number(rng());
  const index = Math.min(items.length - 1, Math.max(0, Math.floor(sample * items.length)));
  return items[index];
}

/**
 * Pick the two pieces of hidden round information independently.
 * The injected RNG keeps the selection deterministic in tests.
 */
export function pickRound(rng = Math.random) {
  return {
    favourite: pick(COLORS, rng),
    starred: pick(REGIONS, rng),
  };
}

function valueFor(value, lookup, label) {
  if (Number.isInteger(value) && value > 0) return value;
  const mapped = lookup[value];
  if (mapped) return mapped;
  throw new TypeError(`Unknown ${label}: ${String(value)}`);
}

function validateGrid(grid, size, label) {
  if (!grid || typeof grid.length !== 'number' || grid.length !== size) {
    throw new RangeError(`${label} must contain exactly ${size} cells`);
  }
}

function buildForgivingArea(regionMap, width, height) {
  const forgiving = new Uint8Array(width * height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (regionMap[index] === 0) continue;

      const minY = Math.max(0, y - NEATNESS_MARGIN);
      const maxY = Math.min(height - 1, y + NEATNESS_MARGIN);
      const minX = Math.max(0, x - NEATNESS_MARGIN);
      const maxX = Math.min(width - 1, x + NEATNESS_MARGIN);

      for (let nearY = minY; nearY <= maxY; nearY += 1) {
        const row = nearY * width;
        for (let nearX = minX; nearX <= maxX; nearX += 1) {
          forgiving[row + nearX] = 1;
        }
      }
    }
  }

  return forgiving;
}

/**
 * Score the coarse paint grid. Region values are 0 for background and
 * body/arms/eyes = 1/2/3. Paint values are 0 for blank and red/blue/yellow
 * = 1/2/3.
 */
export function scorePainting({
  regionMap,
  paintGrid,
  width,
  height,
  starred,
  favourite,
  replayed,
}) {
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new RangeError('width and height must be positive integers');
  }

  const size = width * height;
  validateGrid(regionMap, size, 'regionMap');
  validateGrid(paintGrid, size, 'paintGrid');

  const starredValue = valueFor(starred, REGION_VALUES, 'starred region');
  const favouriteValue = valueFor(favourite, COLOR_VALUES, 'favourite colour');
  const forgiving = buildForgivingArea(regionMap, width, height);

  let starredCells = 0;
  let correctStarredCells = 0;
  let freeCells = 0;
  let paintedFreeCells = 0;
  let paintedCells = 0;
  let farOutsideCells = 0;

  for (let index = 0; index < size; index += 1) {
    const region = regionMap[index];
    const paint = paintGrid[index];
    const painted = paint !== 0;

    if (region === starredValue) {
      starredCells += 1;
      if (paint === favouriteValue) correctStarredCells += 1;
    } else if (region !== 0) {
      freeCells += 1;
      if (painted) paintedFreeCells += 1;
    }

    if (painted) {
      paintedCells += 1;
      if (region === 0 && forgiving[index] === 0) farOutsideCells += 1;
    }
  }

  const starCorrect = starredCells === 0 ? 0 : correctStarredCells / starredCells;
  const freeCoverage = freeCells === 0 ? 0 : paintedFreeCells / freeCells;
  const neatness = 1 - farOutsideCells / Math.max(1, paintedCells);
  const ratio = 0.55 * starCorrect
    + 0.2 * freeCoverage
    + 0.15 * neatness
    + 0.1 * (replayed ? 0 : 1);

  let stars = ratio >= 0.8 ? 3 : ratio >= 0.4 ? 2 : 1;
  if (starCorrect < 0.5 && stars === 3) stars = 2;

  return {
    starCorrect,
    freeCoverage,
    neatness,
    ratio,
    stars,
  };
}
