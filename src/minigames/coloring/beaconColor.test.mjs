import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_BEACON_COLOR, sampleBeaconColor } from './beaconColor.js';

function canvasFor(pixel) {
  return { width: 24, height: 24, getContext: () => ({ getImageData(x0, y0, width, height) {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      data.set(pixel(x + x0, y + y0), (y * width + x) * 4);
    }
    return { data };
  } }) };
}
const spec = { cx: 0.6, cy: 0.6, r: 0.25 };
const box = { x: 0, y: 0 };
test('beacon averages paint inside its own circle, ignoring ink, paper and transparency', () => {
  const canvas = canvasFor((x, y) => {
    if ((x + 0.5 - 12) ** 2 + (y + 0.5 - 12) ** 2 > 25) return [255, 0, 0, 255];
    if (x < 10) return [23, 35, 58, 255];
    if (x === 10) return [255, 253, 248, 255];
    if (x === 11) return [0, 0, 0, 0];
    return [40, 110, 220, 255];
  });
  assert.equal(sampleBeaconColor(canvas, spec, box, 20), '#286edc');
});
test('bare cream and tiny dabs fall back to the warm yellow halo', () => {
  for (const pixel of [() => [247, 244, 238, 255],
    (x, y) => x === 12 && y === 12 ? [40, 110, 220, 255] : [255, 253, 248, 255]]) {
    assert.equal(sampleBeaconColor(canvasFor(pixel), spec, box, 20), DEFAULT_BEACON_COLOR);
  }
});
test('beacon circle uses the cutout origin, rather than sampling another piece or the full page', () => {
  const canvas = canvasFor(() => [200, 50, 170, 255]);
  assert.equal(sampleBeaconColor(canvas, { cx: 0.8, cy: 0.8, r: 0.25 }, { x: 4, y: 4 }, 20), '#c832aa');
});
