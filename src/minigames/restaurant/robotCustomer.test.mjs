import test from 'node:test';
import assert from 'node:assert/strict';

let nextCanvasId = 1;

function fakeCanvas(width = 1, height = 1) {
  const canvas = {
    __id: nextCanvasId++,
    width,
    height,
    getContext: () => context,
  };
  const context = {
    canvas,
    fillStyle: null,
    strokeStyle: null,
    lineWidth: 0,
    lineJoin: '',
    lineCap: '',
    globalCompositeOperation: 'source-over',
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
    drawImage() {},
    createRadialGradient() { return { addColorStop() {} }; },
    createLinearGradient() { return { addColorStop() {} }; },
    getImageData() { return { data: Uint8ClampedArray.from([20, 40, 60, 255]) }; },
  };
  return canvas;
}

globalThis.document ||= { createElement: (tag) => (tag === 'canvas' ? fakeCanvas() : {}) };
if (!globalThis.document.createElement) {
  globalThis.document.createElement = (tag) => (tag === 'canvas' ? fakeCanvas() : {});
}

const THREE = await import('three');
const {
  EDGE_GUARD,
  ROBOT_CUSTOMER_SCALE,
  ROBOT_SEATED_Y,
  createRobotCustomerCharacter,
} = await import('./robotCustomer.js');
const { PUPPET_HEIGHT } = await import('../coloring/robotPuppet.js');
const { disposeSharedPaperAssets, sharedPaperAssets } = await import('../coloring/paperPuppet.js');

const artwork = () => ({ width: 8, height: 8 });
const angleDelta = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const worldYaw = (character) => {
  const puppet = character.children[0];
  return character.rotation.y + puppet.rotation.y;
};

test.afterEach(() => { disposeSharedPaperAssets(); });

test('the adapter is a standard Group with a fresh puppet child and measured scale', () => {
  const first = createRobotCustomerCharacter({ artwork: artwork(), textureSize: 64 });
  const second = createRobotCustomerCharacter({ artwork: artwork(), textureSize: 64 });

  assert.ok(first instanceof THREE.Group);
  assert.equal(first.children[0].name, 'paper-robot');
  assert.notEqual(first.children[0], second.children[0]);
  assert.ok(Math.abs(ROBOT_CUSTOMER_SCALE * PUPPET_HEIGHT - 1.95 * 0.72) < 1e-12);
  assert.equal(first.groundY, 0);
  assert.equal(first.seatedY, ROBOT_SEATED_Y);

  first.disposeCharacter();
  second.disposeCharacter();
});

test('side-on headings hold steadily outside the edge guard', () => {
  const character = createRobotCustomerCharacter({ artwork: artwork(), textureSize: 64 });
  character.rotation.y = Math.PI / 2;
  character.updateAnimation(1 / 60);
  const heldYaw = worldYaw(character);

  assert.ok(Math.abs(Math.abs(heldYaw) - Math.PI / 2) >= EDGE_GUARD - 1e-9);
  for (let index = 0; index < 120; index += 1) {
    character.rotation.y = Math.PI / 2 + (index % 2 ? 0.001 : -0.001);
    character.updateAnimation(1 / 60);
    assert.ok(Math.abs(worldYaw(character) - heldYaw) < 0.01, 'the guard hunted between edges');
  }
  character.disposeCharacter();
});

test('front, back and seated look-around headings pass through untouched', () => {
  for (const heading of [0, Math.PI, -0.35, 0.35]) {
    const character = createRobotCustomerCharacter({ artwork: artwork(), textureSize: 64 });
    character.rotation.y = heading;
    character.updateAnimation(1 / 60);
    assert.ok(Math.abs(angleDelta(worldYaw(character), heading)) < 1e-9);
    character.disposeCharacter();
  }
});

test('rendered yaw eases with an approximately quarter-second time constant', () => {
  const character = createRobotCustomerCharacter({ artwork: artwork(), textureSize: 64 });
  character.rotation.y = 0;
  character.updateAnimation(0);
  character.rotation.y = 0.8;
  character.updateAnimation(0.25);

  const expected = 0.8 * (1 - Math.exp(-1));
  assert.ok(Math.abs(worldYaw(character) - expected) < 1e-9);
  character.disposeCharacter();
});

function poseSnapshot(character) {
  const body = character.getObjectByName('paper-body');
  const leftArm = character.getObjectByName('paper-leftArm');
  return [body.position.x, body.position.y, body.rotation.z, leftArm.rotation.z];
}

test('repeating walk does not restart the hop cycle', () => {
  const repeated = createRobotCustomerCharacter({ artwork: artwork(), textureSize: 64 });
  const uninterrupted = createRobotCustomerCharacter({ artwork: artwork(), textureSize: 64 });
  repeated.playAnimation('walk');
  uninterrupted.playAnimation('walk');

  for (let index = 0; index < 4; index += 1) {
    repeated.updateAnimation(0.05);
    uninterrupted.updateAnimation(0.05);
  }
  repeated.playAnimation('walk');
  repeated.updateAnimation(0.05);
  uninterrupted.updateAnimation(0.05);

  assert.deepEqual(poseSnapshot(repeated), poseSnapshot(uninterrupted));
  repeated.disposeCharacter();
  uninterrupted.disposeCharacter();
});

test('static holds an idle pose and emote-yes returns to idle', () => {
  const character = createRobotCustomerCharacter({ artwork: artwork(), textureSize: 64 });
  character.playAnimation('static');
  const held = poseSnapshot(character);
  for (let index = 0; index < 20; index += 1) character.updateAnimation(0.05);
  assert.deepEqual(poseSnapshot(character), held);

  character.playAnimation('emote-yes');
  for (let index = 0; index < 10; index += 1) character.updateAnimation(0.05);
  const afterEmote = poseSnapshot(character);
  character.updateAnimation(0);
  assert.deepEqual(poseSnapshot(character), afterEmote);
  character.disposeCharacter();
});

/**
 * The celebration has to *end*. Asserting the pose has settled is not the same
 * claim: a robot stuck mid-celebrate for the rest of the shift also settles.
 */
test('emote-yes hands the puppet back to the idle cycle', () => {
  const character = createRobotCustomerCharacter({ artwork: artwork(), textureSize: 64 });
  character.playAnimation('emote-yes');
  const puppet = character.children[0];
  for (let index = 0; index < 4; index += 1) character.updateAnimation(0.05);
  const during = poseSnapshot(character);

  // CELEBRATE runs 0.46 s; well past it the puppet must be breathing again.
  for (let index = 0; index < 20; index += 1) character.updateAnimation(0.05);
  const idling = poseSnapshot(character);
  assert.notDeepEqual(idling, during, 'the robot froze in its celebration');

  character.updateAnimation(0.05);
  assert.notDeepEqual(poseSnapshot(character), idling, 'the idle cycle is not running');
  assert.ok(puppet, 'the puppet group went missing');
  character.disposeCharacter();
});

/**
 * The invariant the whole edge-guard design exists for, stated as the thing the
 * child would actually notice: across every heading the Restaurant can hand the
 * adapter, the sheet never shrinks to an invisible sliver.
 *
 * `cos(worldYaw)` is the fraction of its own width the flat sheet still shows.
 */
test('the paper sheet never becomes invisible at any heading', () => {
  const character = createRobotCustomerCharacter({ artwork: artwork(), textureSize: 64 });
  character.playAnimation('walk');
  const floor = Math.cos(Math.PI / 2 - EDGE_GUARD);
  let narrowest = 1;

  // A full turn, the way atan2 sweeps one while a customer walks in.
  for (let step = 0; step <= 1200; step += 1) {
    character.rotation.y = -Math.PI + (step / 1200) * Math.PI * 2;
    character.updateAnimation(1 / 60);
    narrowest = Math.min(narrowest, Math.abs(Math.cos(worldYaw(character))));
  }
  assert.ok(narrowest >= floor - 1e-9, `the sheet thinned to ${narrowest} of its width`);

  // And the real case: the Restaurant snaps the heading, it does not sweep it.
  for (const target of [Math.PI, Math.PI / 2, -Math.PI / 2, 0, 1.6, 1.4]) {
    character.rotation.y = target;
    for (let step = 0; step < 40; step += 1) {
      character.updateAnimation(1 / 60);
      narrowest = Math.min(narrowest, Math.abs(Math.cos(worldYaw(character))));
    }
  }
  assert.ok(narrowest >= floor - 1e-9, `a snapped heading thinned the sheet to ${narrowest}`);
  character.disposeCharacter();
});

test('a robot leaving the Restaurant frees its own art but not the shared quad', () => {
  disposeSharedPaperAssets();
  const leaving = createRobotCustomerCharacter({ artwork: artwork(), textureSize: 64 });
  const staying = createRobotCustomerCharacter({ artwork: artwork(), textureSize: 64 });

  const freed = { count: 0 };
  leaving.traverse((node) => {
    if (!node.material) return;
    node.material.addEventListener('dispose', () => { freed.count += 1; });
    node.material.map?.addEventListener('dispose', () => { freed.count += 1; });
  });
  const quad = sharedPaperAssets().quad;
  const quadFreed = { count: 0 };
  quad.addEventListener('dispose', () => { quadFreed.count += 1; });

  leaving.disposeCharacter();
  assert.ok(freed.count > 0, 'the departing robot leaked its own textures and materials');
  assert.equal(quadFreed.count, 0, 'one robot leaving freed the quad the others still draw with');
  assert.equal(sharedPaperAssets().quad, quad, 'the shared quad was swapped out mid-shift');

  // Coloring exiting must not strip the room while a Restaurant robot is live.
  disposeSharedPaperAssets();
  assert.equal(sharedPaperAssets().quad, quad, 'a live puppet did not hold the shared assets');

  staying.disposeCharacter();
  disposeSharedPaperAssets();
  assert.equal(quadFreed.count, 1, 'the quad was never freed once every puppet had gone');
});

/**
 * A robot visiting the Restaurant is a visitor. The record it was built from is
 * Coloring's, and the child expects to find it exactly as they left it.
 */
test('the visiting robot never touches the saved Coloring record', () => {
  const record = Object.freeze({ artwork: artwork(), crowd: Object.freeze({ start: 2 }) });
  const before = { ...record.artwork };

  const character = createRobotCustomerCharacter({ artwork: record.artwork });
  character.playAnimation('walk');
  for (let step = 0; step < 30; step += 1) character.updateAnimation(1 / 60);
  character.disposeCharacter();

  assert.deepEqual({ ...record.artwork }, before, 'the visit altered the saved artwork');
  assert.equal(record.crowd.start, 2);
});

