import test from 'node:test';
import assert from 'node:assert/strict';

import {
  COLOR_VALUES,
  REGION_VALUES,
  pickRound,
  scorePainting,
} from './scoring.js';

const WIDTH = 9;
const HEIGHT = 3;

function threeRegionMap() {
  return Uint8Array.from({ length: WIDTH * HEIGHT }, (_, index) => {
    const x = index % WIDTH;
    if (x < 3) return REGION_VALUES.body;
    if (x < 6) return REGION_VALUES.arms;
    return REGION_VALUES.eyes;
  });
}

function score(paintGrid, overrides = {}) {
  return scorePainting({
    regionMap: threeRegionMap(),
    paintGrid,
    width: WIDTH,
    height: HEIGHT,
    starred: 'body',
    favourite: 'blue',
    replayed: false,
    ...overrides,
  });
}

test('a perfect picture in the favourite colour scores three stars', () => {
  const paintGrid = new Uint8Array(WIDTH * HEIGHT).fill(COLOR_VALUES.blue);
  const result = score(paintGrid);

  assert.equal(result.starCorrect, 1);
  assert.equal(result.freeCoverage, 1);
  assert.equal(result.neatness, 1);
  assert.equal(result.ratio, 1);
  assert.equal(result.stars, 3);
});

test('a wrong colour in the starred region cannot score three stars', () => {
  const regionMap = threeRegionMap();
  const paintGrid = Uint8Array.from(regionMap, (region) => (
    region === REGION_VALUES.body ? COLOR_VALUES.red : COLOR_VALUES.blue
  ));
  const result = score(paintGrid);

  assert.equal(result.starCorrect, 0);
  assert.ok(result.stars < 3);
});

test('scribbling all three colours evenly over the starred region scores fewer than three stars', () => {
  const regionMap = threeRegionMap();
  let starredCell = 0;
  const colours = [COLOR_VALUES.red, COLOR_VALUES.blue, COLOR_VALUES.yellow];
  const paintGrid = Uint8Array.from(regionMap, (region) => {
    if (region !== REGION_VALUES.body) return COLOR_VALUES.blue;
    const colour = colours[starredCell % colours.length];
    starredCell += 1;
    return colour;
  });
  const result = score(paintGrid);

  assert.equal(result.starCorrect, 1 / 3);
  assert.ok(result.stars < 3);
});

test('replaying an otherwise perfect picture still scores three stars', () => {
  const paintGrid = new Uint8Array(WIDTH * HEIGHT).fill(COLOR_VALUES.blue);
  const result = score(paintGrid, { replayed: true });

  assert.equal(result.ratio, 0.9);
  assert.equal(result.stars, 3);
});

test('overshoot within two grid cells is forgiven while farther paint lowers neatness', () => {
  const width = 9;
  const height = 9;
  const regionMap = new Uint8Array(width * height);
  regionMap[4 * width + 4] = REGION_VALUES.body;

  const nearPaint = new Uint8Array(width * height);
  nearPaint[4 * width + 4] = COLOR_VALUES.blue;
  nearPaint[4 * width + 6] = COLOR_VALUES.blue;
  const near = scorePainting({
    regionMap,
    paintGrid: nearPaint,
    width,
    height,
    starred: 'body',
    favourite: 'blue',
    replayed: false,
  });

  const farPaint = nearPaint.slice();
  farPaint[4 * width + 7] = COLOR_VALUES.blue;
  const far = scorePainting({
    regionMap,
    paintGrid: farPaint,
    width,
    height,
    starred: 'body',
    favourite: 'blue',
    replayed: false,
  });

  assert.equal(near.neatness, 1);
  assert.ok(Math.abs(far.neatness - 2 / 3) < Number.EPSILON);
  assert.ok(far.neatness < near.neatness);
});

test('seeded draws produce every favourite and starred-region combination', () => {
  let state = 0x12345678;
  const rng = () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  const combinations = new Set();

  for (let draw = 0; draw < 900; draw += 1) {
    const round = pickRound(rng);
    combinations.add(`${round.favourite}:${round.starred}`);
  }

  assert.equal(combinations.size, 9);
});

test('an empty painting scores one star', () => {
  const result = score(new Uint8Array(WIDTH * HEIGHT));

  assert.equal(result.starCorrect, 0);
  assert.equal(result.freeCoverage, 0);
  assert.equal(result.neatness, 1);
  assert.equal(result.stars, 1);
});
