import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * A paper visitor must show the child its artwork, not its blank back.
 *
 * A flat sheet has a front and a back. The Zoo stands every visitor with
 * `faceToward(character, 0, 19)` — toward the park entrance the child walks in
 * from — and if that orientation came out reversed, the creation would wait
 * there showing cream paper. That is a one-sign mistake, it looks plausible in
 * a screenshot of a mostly-white snowman, and no other test would catch it.
 *
 * The spots are parsed from the Zoo's own source rather than copied, so moving
 * a bench moves this test with it. The module itself is never imported: it
 * pulls in three.js and the whole world builder, which this does not need.
 */
const source = readFileSync(new URL('./index.js', import.meta.url), 'utf8');

function visitorSpots() {
  const block = source.slice(
    source.indexOf('const VISITOR_SPOTS = Object.freeze(['),
    source.indexOf(']);', source.indexOf('const VISITOR_SPOTS')),
  );
  const spots = [...block.matchAll(/x:\s*(-?[\d.]+),\s*z:\s*(-?[\d.]+)/g)]
    .map(([, x, z]) => ({ x: Number(x), z: Number(z) }));
  assert.ok(spots.length >= 3, 'the visitor spots could not be read from the Zoo source');
  return spots;
}

/** The entrance the Zoo aims its visitors at, read from the same source. */
function entranceTarget() {
  const match = source.match(/faceToward\(character,\s*(-?[\d.]+),\s*(-?[\d.]+)\)/);
  assert.ok(match, 'the Zoo no longer aims its visitors with faceToward');
  return { x: Number(match[1]), z: Number(match[2]) };
}

let nextCanvasId = 1;
function fakeCanvas(width = 1, height = 1) {
  const canvas = { __id: nextCanvasId++, width, height, getContext: () => context };
  const context = {
    canvas,
    fillStyle: null, strokeStyle: null, lineWidth: 0, lineJoin: '', lineCap: '',
    globalCompositeOperation: 'source-over',
    beginPath() {}, closePath() {}, roundRect() {}, rect() {}, arc() {}, ellipse() {},
    moveTo() {}, lineTo() {}, quadraticCurveTo() {}, bezierCurveTo() {},
    fill() {}, stroke() {}, fillRect() {}, clearRect() {}, clip() {},
    save() {}, restore() {}, translate() {}, scale() {}, rotate() {}, setTransform() {},
    drawImage() {},
    createRadialGradient() { return { addColorStop() {} }; },
    createLinearGradient() { return { addColorStop() {} }; },
    getImageData() { return { data: Uint8ClampedArray.from([20, 40, 60, 255]) }; },
  };
  return canvas;
}
globalThis.document ||= { createElement: (tag) => (tag === 'canvas' ? fakeCanvas() : {}) };

const { createPaperCharacter } = await import('../../systems/paperCharacter.js');
const { SUBJECTS } = await import('../coloring/subjectRegistry.js');

test('every visitor spot shows the artwork to a child at the entrance', () => {
  const target = entranceTarget();
  for (const spot of visitorSpots()) {
    // The Zoo's own facing maths, applied at this spot.
    const yaw = Math.atan2(target.x - spot.x, target.z - spot.z);
    for (const subject of SUBJECTS) {
      const character = createPaperCharacter({
        subject,
        artwork: { width: 8, height: 8 },
        textureSize: 32,
        presentation: subject.presentation.zoo,
      });
      character.rotation.y = yaw;
      character.updateAnimation(1 / 60);
      const worldYaw = character.rotation.y + character.children[0].rotation.y;
      // The sheet's front normal is +Z. Someone at the entrance looks along +Z,
      // so the artwork faces them exactly when that normal points back at them.
      const facing = Math.cos(worldYaw);
      assert.ok(
        facing < -0.5,
        `${subject.id} at (${spot.x}, ${spot.z}) turns ${facing > 0 ? 'its blank back' : 'an edge'} to the entrance`,
      );
      character.disposeCharacter();
    }
  }
});
