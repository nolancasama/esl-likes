import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DETAILS,
  PICTURE_SIZE,
  PIECES,
  PIVOTS,
  SHAPES,
  SHAPES_BY_PIECE,
  insideShape,
  insideSilhouette,
  pieceAt,
  pieceBounds,
  shapeBounds,
  silhouetteArea,
  silhouetteBounds,
} from './robotDefinition.js';

test('the robot is five pieces, and every shape belongs to exactly one', () => {
  assert.deepEqual(PIECES, ['body', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg']);
  for (const entry of SHAPES) {
    assert.ok(PIECES.includes(entry.piece), `${entry.id} names no piece`);
  }
  const counted = PIECES.flatMap((piece) => SHAPES_BY_PIECE[piece]);
  assert.equal(counted.length, SHAPES.length, 'a shape is owned twice or not at all');
  for (const piece of PIECES) assert.ok(SHAPES_BY_PIECE[piece].length > 0, piece);
});

test('shape ids are unique and every piece has bounds and a pivot', () => {
  assert.equal(new Set(SHAPES.map((entry) => entry.id)).size, SHAPES.length);
  for (const piece of PIECES) {
    const box = pieceBounds(piece);
    assert.ok(box && box.maxX > box.minX && box.maxY > box.minY, piece);
    assert.ok(PIVOTS[piece], piece);
  }
  assert.deepEqual(Object.keys(PIVOTS).sort(), [...PIECES].sort());
});

test('the body is head, neck, torso and antenna together — one central cutout', () => {
  const ids = SHAPES_BY_PIECE.body.map((entry) => entry.id).sort();
  assert.deepEqual(ids, ['antennaBall', 'antennaStalk', 'head', 'neck', 'torso']);
  // The old design had separate head and antenna pieces. Five means these are
  // one continuous shape, so there is no seam across the robot's face or neck.
  assert.equal(SHAPES_BY_PIECE.body.every((entry) => entry.piece === 'body'), true);
});

test('there are no separate forearm or antenna pieces any more', () => {
  for (const gone of ['leftForearm', 'rightForearm', 'leftUpperArm', 'rightUpperArm', 'head', 'antenna', 'torso']) {
    assert.ok(!PIECES.includes(gone), `${gone} is still a piece`);
  }
});

test('nothing on the robot carries a colour instruction any more', () => {
  for (const entry of SHAPES) {
    // A `type` was what made a region required; a `label` was what printed a
    // colour word on it. Neither may come back: the page is a colouring book.
    assert.equal(entry.type, undefined, entry.id);
    assert.equal(entry.label, undefined, entry.id);
    assert.equal(entry.labelBox, undefined, entry.id);
  }
  assert.equal(DETAILS.label, undefined);
  assert.equal(DETAILS.star, undefined);
});

test('every limb overlaps the body, so the puppet shows no seam at rest', () => {
  const bodyShapes = SHAPES_BY_PIECE.body.map((entry) => entry.shape);
  for (const piece of ['leftArm', 'rightArm', 'leftLeg', 'rightLeg']) {
    let shared = 0;
    for (const entry of SHAPES_BY_PIECE[piece]) {
      const box = shapeBounds(entry.shape);
      // Sample the limb and count points that are also on the body.
      for (let iy = 0; iy <= 40; iy += 1) {
        for (let ix = 0; ix <= 40; ix += 1) {
          const x = box.minX + (box.maxX - box.minX) * (ix / 40);
          const y = box.minY + (box.maxY - box.minY) * (iy / 40);
          if (!insideShape(x, y, entry.shape)) continue;
          if (bodyShapes.some((shape) => insideShape(x, y, shape))) shared += 1;
        }
      }
    }
    assert.ok(shared > 0, `${piece} does not touch the body — the joint would show`);
  }
});

test('the whole robot is one connected silhouette', () => {
  // Flood fill the silhouette on a coarse grid: a robot in two halves would
  // read as loose construction pieces, which is the thing being fixed.
  const N = 90;
  const inside = [];
  for (let gy = 0; gy < N; gy += 1) {
    for (let gx = 0; gx < N; gx += 1) {
      inside.push(insideSilhouette((gx + 0.5) / N, (gy + 0.5) / N));
    }
  }
  const total = inside.filter(Boolean).length;
  assert.ok(total > 0);
  const seen = new Uint8Array(N * N);
  const start = inside.indexOf(true);
  const queue = [start];
  seen[start] = 1;
  let reached = 0;
  while (queue.length) {
    const index = queue.pop();
    reached += 1;
    const gx = index % N;
    const gy = Math.floor(index / N);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = gx + dx;
      const ny = gy + dy;
      if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
      const next = ny * N + nx;
      if (seen[next] || !inside[next]) continue;
      seen[next] = 1;
      queue.push(next);
    }
  }
  assert.equal(reached, total, `${total - reached} of ${total} cells are an island`);
});

test('the robot fills a useful share of the page', () => {
  const area = silhouetteArea(150);
  assert.ok(area > 0.3 && area < 0.6, `${(area * 100).toFixed(1)}%`);
  const box = silhouetteBounds();
  assert.ok(box.minY < 0.06 && box.maxY > 0.9, 'the robot should nearly fill the page vertically');
  assert.ok(box.minX > 0.05 && box.maxX < 0.95, 'the robot must not touch the side edges');
});

test('the background is not the robot, and the middle of the robot is', () => {
  for (const [x, y] of [[0.02, 0.02], [0.98, 0.5], [0.5, 0.99], [0.05, 0.5]]) {
    assert.equal(insideSilhouette(x, y), false, `${x},${y}`);
  }
  for (const [x, y] of [[0.5, 0.25], [0.5, 0.5], [0.2, 0.55], [0.8, 0.55], [0.4, 0.8]]) {
    assert.equal(insideSilhouette(x, y), true, `${x},${y}`);
  }
});

test('pieceAt names the front-most piece, and nothing off the robot', () => {
  assert.equal(pieceAt(0.02, 0.02), null);
  assert.equal(pieceAt(0.5, 0.5), 'body');
  assert.equal(pieceAt(0.17, 0.55), 'leftArm');
  assert.equal(pieceAt(0.83, 0.55), 'rightArm');
  assert.equal(pieceAt(0.4, 0.85), 'leftLeg');
  assert.equal(pieceAt(0.6, 0.85), 'rightLeg');
  // Where an arm overlaps the torso the body wins, because the body draws in
  // front — the same rule the puppet uses to hide the joint.
  assert.equal(pieceAt(0.292, 0.5), 'body');
});

test('the face and the details sit on the head and the torso', () => {
  const head = SHAPES.find((entry) => entry.id === 'head').shape;
  for (const eye of DETAILS.eyes) {
    assert.ok(insideShape(eye.cx, eye.cy, head), 'an eye is off the head');
    assert.ok(eye.r * PICTURE_SIZE > 14, 'the eyes must be big enough to read');
  }
  assert.ok(insideShape(DETAILS.mouth.x1, DETAILS.mouth.y, head));
  assert.ok(insideShape(DETAILS.mouth.x2, DETAILS.mouth.y, head));
  const torso = SHAPES.find((entry) => entry.id === 'torso').shape;
  for (const bolt of DETAILS.bolts) {
    assert.ok(insideShape(bolt.cx, bolt.cy, torso), 'a bolt is off the torso');
  }
  for (const line of DETAILS.lines) {
    assert.ok(insideSilhouette((line.x1 + line.x2) / 2, line.y), 'a detail line is off the robot');
  }
});

test('a pivot sits inside the piece it turns', () => {
  for (const piece of PIECES) {
    const box = pieceBounds(piece);
    const pivot = PIVOTS[piece];
    assert.ok(pivot.x >= box.minX && pivot.x <= box.maxX, `${piece} x`);
    assert.ok(pivot.y >= box.minY && pivot.y <= box.maxY, `${piece} y`);
  }
});

test('the shoulders and hips are at the top of their limbs, not the middle', () => {
  // A limb that rotates about its centre scissors; one that rotates about its
  // joint swings.
  for (const [piece, shapeId] of [['leftArm', 'leftArm'], ['rightArm', 'rightArm']]) {
    const box = shapeBounds(SHAPES.find((entry) => entry.id === shapeId).shape);
    const pivot = PIVOTS[piece];
    assert.ok(pivot.y < box.minY + (box.maxY - box.minY) * 0.35, `${piece} pivot is too low`);
  }
  for (const piece of ['leftLeg', 'rightLeg']) {
    const box = pieceBounds(piece);
    const pivot = PIVOTS[piece];
    assert.ok(pivot.y < box.minY + (box.maxY - box.minY) * 0.35, `${piece} pivot is too low`);
  }
});
