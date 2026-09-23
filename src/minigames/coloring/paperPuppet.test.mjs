import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * The room now keeps every robot the child makes, which creates two failures
 * that nothing else in this suite can see and that a screenshot would not
 * reliably show either:
 *
 *   1. **A puppet disposing something its neighbours are still drawing with.**
 *      The unit quad and the two radial gradients are shared between every
 *      puppet ever built, so one `dispose()` freeing them turns the rest of the
 *      room into white rectangles — possibly several rounds later.
 *   2. **A robot quietly wearing another robot's paint.** Each puppet must copy
 *      the artwork at construction. Sharing one mutable canvas would make every
 *      robot in the room repaint itself every time the child starts a new page.
 *
 * Neither needs a GPU, only a canvas — so this file stubs the 2D context the
 * same way `robotRenderer.test.mjs` does, and asserts on three.js's own
 * `dispose` events rather than on anything rendered.
 */

let nextCanvasId = 1;

function fakeCanvas(width = 1, height = 1) {
  const canvas = {
    __id: nextCanvasId,
    width,
    height,
    getContext: () => context,
  };
  nextCanvasId += 1;
  const context = {
    canvas,
    fillStyle: null,
    strokeStyle: null,
    lineWidth: 0,
    lineJoin: '',
    lineCap: '',
    globalCompositeOperation: 'source-over',
    /**
     * What was stamped through this context, newest last — recorded as the
     * value at draw time, because a real `drawImage` copies pixels. Reading the
     * source lazily would make even a correct puppet look as though it were
     * still watching the live paint canvas.
     */
    drawn: [],
    beginPath() {},
    closePath() {},
    roundRect() {},
    rect() {},
    arc() {},
    ellipse() {},
    moveTo() {},
    lineTo() {},
    quadraticCurveTo() {},
    bezierCurveTo() {},
    fill() {},
    stroke() {},
    fillRect() {},
    clearRect() {},
    clip() {},
    save() {},
    restore() {},
    translate() {},
    scale() {},
    rotate() {},
    setTransform() {},
    drawImage(image) { context.drawn.push(image?.__id ?? 0); },
    createRadialGradient() { return { addColorStop() {} }; },
    createLinearGradient() { return { addColorStop() {} }; },
    /**
     * Derived from whatever was last drawn into this canvas, so a fingerprint
     * genuinely reflects *this* puppet's own artwork rather than a constant.
     */
    getImageData(x = 0, y = 0) {
      const seed = (context.drawn.at(-1) ?? 0) * 37 + canvas.__id + x * 3 + y * 5;
      return { data: Uint8ClampedArray.from([seed % 256, (seed * 7) % 256, (seed * 13) % 256, 255]) };
    },
  };
  return canvas;
}

globalThis.document ||= { createElement: (tag) => (tag === 'canvas' ? fakeCanvas() : {}) };
if (!globalThis.document.createElement) {
  globalThis.document.createElement = (tag) => (tag === 'canvas' ? fakeCanvas() : {});
}

const {
  PUPPET_TEXTURE_SIZE, STATES, createPaperPuppet, disposeSharedPaperAssets, sharedPaperAssets,
} = await import('./paperPuppet.js');
const { PIECES, silhouetteBounds } = await import('./robotDefinition.js');
const { PUPPET_HEIGHT, pieceLayout } = await import('./robotPuppet.js');
const THREE = await import('three');
const { readFileSync } = await import('node:fs');
const puppetSource = readFileSync(new URL('./paperPuppet.js', import.meta.url), 'utf8');

/** Counts three.js `dispose` events, which is how a real disposal is observable. */
function watch(target) {
  const seen = { count: 0 };
  target.addEventListener('dispose', () => { seen.count += 1; });
  return seen;
}

const paint = (id) => ({ __id: id, width: 8, height: 8 });

test.afterEach(() => { disposeSharedPaperAssets(); });

test('the quad and both gradients are built once and shared', () => {
  disposeSharedPaperAssets();
  const first = createPaperPuppet({ paint: paint(101) });
  const shared = sharedPaperAssets();
  assert.ok(shared.quad, 'no shared quad was built');
  assert.ok(shared.glow && shared.shadow, 'the gradients were not shared');

  const second = createPaperPuppet({ paint: paint(102) });
  const again = sharedPaperAssets();
  assert.equal(again.quad, shared.quad, 'the second puppet built its own quad');
  assert.equal(again.glow, shared.glow, 'the second puppet built its own glow');
  assert.equal(again.shadow, shared.shadow, 'the second puppet built its own shadow');

  first.dispose();
  second.dispose();
});

test('a puppet disposing itself never frees what the room is still using', () => {
  disposeSharedPaperAssets();
  const first = createPaperPuppet({ paint: paint(201) });
  const shared = sharedPaperAssets();
  const quad = watch(shared.quad);
  const glow = watch(shared.glow);
  const shadow = watch(shared.shadow);
  const second = createPaperPuppet({ paint: paint(202) });

  first.dispose();

  assert.equal(quad.count, 0, 'the shared quad was disposed — the rest of the room loses its geometry');
  assert.equal(glow.count, 0, 'the shared glow was disposed');
  assert.equal(shadow.count, 0, 'the shared shadow was disposed');
  // And the survivor is still intact.
  assert.equal(second.pieces.body.mesh.geometry, shared.quad);
  second.dispose();
});

test('a puppet does dispose its own piece textures', () => {
  disposeSharedPaperAssets();
  const puppet = createPaperPuppet({ paint: paint(301) });
  const own = PIECES.map((piece) => watch(puppet.pieces[piece].mesh.material.map));
  puppet.dispose();
  for (const [index, seen] of own.entries()) {
    assert.equal(seen.count, 1, `${PIECES[index]} leaked its own texture`);
  }
});

test('only disposeSharedPaperAssets frees the shared assets, and then they rebuild', () => {
  disposeSharedPaperAssets();
  const puppet = createPaperPuppet({ paint: paint(401) });
  const shared = sharedPaperAssets();
  const quad = watch(shared.quad);
  const glow = watch(shared.glow);
  puppet.dispose();
  assert.equal(quad.count, 0);

  disposeSharedPaperAssets();
  assert.equal(quad.count, 1, 'the shared quad was never freed');
  assert.equal(glow.count, 1, 'the shared glow was never freed');
  assert.deepEqual(sharedPaperAssets(), { quad: null, glow: null, shadow: null });

  // A later session starts clean rather than reusing a disposed object.
  const later = createPaperPuppet({ paint: paint(402) });
  const rebuilt = sharedPaperAssets();
  assert.ok(rebuilt.quad && rebuilt.quad !== shared.quad, 'a disposed quad was handed out again');
  later.dispose();
});

// --- the puppet stands on the floor -----------------------------------------

/**
 * Where the lowest paint on the puppet actually is, in world units.
 *
 * The piece meshes only: the backing quad oversteps the artwork by a few
 * percent by design, and the shadow is a separate flat quad. This is the paint
 * the child sees, which is the thing that was sinking.
 */
function lowestPaintY(puppet) {
  puppet.group.updateMatrixWorld(true);
  let lowest = Infinity;
  for (const piece of PIECES) {
    const box = new THREE.Box3().setFromObject(puppet.pieces[piece].mesh);
    lowest = Math.min(lowest, box.min.y);
  }
  return lowest;
}

test('the lowest point of the robot silhouette stands on world Y=0', () => {
  disposeSharedPaperAssets();
  const puppet = createPaperPuppet({ paint: paint(901) });
  const lowest = lowestPaintY(puppet);

  // The newborn pose has a slight tilt, so a foot corner dips a few
  // millimetres. What must never come back is the eighth of a unit the stale
  // 0.875 baseline buried the feet by.
  assert.ok(Math.abs(lowest) < 0.02, `the feet sit at ${lowest}, not on the floor`);
  puppet.dispose();
});

test('the ground baseline is derived from the silhouette, not typed', () => {
  assert.match(
    puppetSource,
    /const FEET = silhouetteBounds\(\)\.maxY;/,
    'the standing baseline is not derived from the robot definition',
  );
  assert.doesNotMatch(
    puppetSource,
    /const FEET = [\d.]+;/,
    'a hard-coded standing baseline is back, and it goes stale the next time the robot changes',
  );
});

test('a change to the robot proportions moves the ground with it', () => {
  disposeSharedPaperAssets();
  const puppet = createPaperPuppet({ paint: paint(902) });

  // The torso is the root piece, so its world y *is* the baseline in use.
  // Asserting the mapping rather than a number is what makes a later change to
  // the definition carry the floor with it instead of stranding it.
  const expected = (silhouetteBounds().maxY - pieceLayout('body').pivot.y) * PUPPET_HEIGHT;
  assert.ok(
    Math.abs(puppet.pieces.body.group.position.y - expected) < 1e-9,
    'the torso is not placed from the current silhouette bottom',
  );
  puppet.dispose();
});

test('the idle puppet does not start below the floor', () => {
  disposeSharedPaperAssets();
  const puppet = createPaperPuppet({ paint: paint(903) });
  puppet.setState(STATES.IDLE);
  puppet.update(0);
  assert.ok(lowestPaintY(puppet) > -0.02, 'the idle robot starts underground');
  puppet.dispose();
});

// --- each robot keeps its own artwork ---------------------------------------

test('two puppets never share a texture, a canvas or a material', () => {
  disposeSharedPaperAssets();
  const first = createPaperPuppet({ paint: paint(501) });
  const second = createPaperPuppet({ paint: paint(502) });
  for (const piece of PIECES) {
    const a = first.pieces[piece];
    const b = second.pieces[piece];
    assert.notEqual(a.mesh.material, b.mesh.material, `${piece} shares a material`);
    assert.notEqual(a.mesh.material.map, b.mesh.material.map, `${piece} shares a texture`);
    assert.notEqual(a.artwork, b.artwork, `${piece} shares a canvas`);
    assert.notEqual(a.edge.material.map, b.edge.material.map, `${piece} shares a cut edge`);
  }
  first.dispose();
  second.dispose();
});

test('a puppet reads the paint once, at construction, and never again', () => {
  disposeSharedPaperAssets();
  const puppet = createPaperPuppet({ paint: paint(601) });
  const artwork = puppet.pieces.body.artwork.getContext('2d');
  const stampsAtBuild = artwork.drawn.length;
  assert.ok(stampsAtBuild > 0, 'the puppet never stamped the paint at all');
  const before = puppet.fingerprint();

  // A second of animation, and a round of hopping.
  puppet.startRoaming();
  for (let i = 0; i < 60; i += 1) puppet.update(1 / 60);

  assert.equal(artwork.drawn.length, stampsAtBuild,
    'the puppet redrew its artwork after construction — that is both a per-frame '
    + 'canvas cost and a live link to a paint canvas the next round will overwrite');
  assert.deepEqual(puppet.fingerprint(), before, 'the artwork changed while it was hopping');
  puppet.dispose();
});

test('a fingerprint tells two differently coloured robots apart', () => {
  disposeSharedPaperAssets();
  const first = createPaperPuppet({ paint: paint(701) });
  const second = createPaperPuppet({ paint: paint(702) });
  const a = first.fingerprint();
  const b = second.fingerprint();
  assert.ok(a.length > 0, 'a fingerprint must actually sample something');
  assert.notDeepEqual(a, b, 'two robots with different paint fingerprint the same');
  assert.deepEqual(first.fingerprint(), a, 'a fingerprint must be stable');
  first.dispose();
  second.dispose();
});

test('the texture size is small enough for a roomful of robots', () => {
  // 900 was sized for a close-up that no longer happens. Five cropped pieces
  // plus five cream silhouettes at 900 is about 4 MB of canvas per robot.
  assert.ok(PUPPET_TEXTURE_SIZE <= 700, `${PUPPET_TEXTURE_SIZE} is close-up sizing`);
  assert.ok(PUPPET_TEXTURE_SIZE >= 480, `${PUPPET_TEXTURE_SIZE} is too coarse to read`);
});

// --- the crowd's variation actually reaches the puppet ----------------------

test('startRoaming takes the crowd variation through to the plan', () => {
  disposeSharedPaperAssets();
  const puppet = createPaperPuppet({ paint: paint(801) });
  puppet.startRoaming(undefined, { start: 2, idlePause: 1.9, stateTime: 0.7 });
  const plan = puppet.roamPlan;
  assert.equal(plan.index, 2, 'the start index was dropped');
  assert.equal(plan.idlePause, 1.9, 'the idle pause was dropped, so hops stay in unison');
  assert.equal(plan.stateTime, 0.7, 'the phase offset was dropped');
  assert.equal(puppet.stateTime, 0.7);
  puppet.dispose();
});

test('startRoaming with from leaves the landed puppet in place', () => {
  disposeSharedPaperAssets();
  const puppet = createPaperPuppet({ paint: paint(803) });
  puppet.placeAt(0.35, -1.4, 0.25);
  const before = { x: puppet.group.position.x, z: puppet.group.position.z };
  puppet.startRoaming(undefined, { start: 2, from: before });
  const after = { x: puppet.group.position.x, z: puppet.group.position.z };
  assert.ok(Math.abs(after.x - before.x) < 1e-9);
  assert.ok(Math.abs(after.z - before.z) < 1e-9);
  assert.deepEqual(puppet.roamPlan.position, before);
  assert.deepEqual(puppet.roamPlan.origin, before);
  puppet.dispose();
});

test('startRoaming with no variation still behaves as it always did', () => {
  disposeSharedPaperAssets();
  const puppet = createPaperPuppet({ paint: paint(802) });
  puppet.placeAt(0.35, -1.4);
  puppet.startRoaming();
  assert.equal(puppet.roamPlan.index, 0);
  assert.equal(puppet.roamPlan.stateTime, 0);
  assert.equal(puppet.roamPlan.idlePause, 1.5);
  assert.equal(puppet.group.position.x, puppet.roamPlan.points[0].x);
  assert.equal(puppet.group.position.z, puppet.roamPlan.points[0].z);
  puppet.dispose();
});
