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
const { SUBJECTS } = await import('../minigames/coloring/subjectRegistry.js');
const robot = SUBJECTS.find(({ id }) => id === 'robot');
const { disposeSharedPaperAssets, sharedPaperAssets } = await import('../minigames/coloring/paperPuppet.js');
const { EDGE_GUARD, createPaperCharacter } = await import('./paperCharacter.js');

const artwork = () => ({ width: 8, height: 8 });
const angleDelta = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const worldYaw = (character) => character.rotation.y + character.children[0].rotation.y;

test.afterEach(() => { disposeSharedPaperAssets(); });

test('every subject adapts to the character duck type with a fresh puppet', () => {
  for (const subject of SUBJECTS) {
    const first = createPaperCharacter({
      subject,
      artwork: artwork(),
      textureSize: 64,
      presentation: subject.presentation.restaurant,
    });
    const second = createPaperCharacter({
      subject,
      artwork: artwork(),
      textureSize: 64,
      presentation: subject.presentation.restaurant,
    });

    assert.ok(first instanceof THREE.Group);
    assert.equal(first.children[0].name, `paper-${subject.id}`);
    assert.notEqual(first.children[0], second.children[0]);
    for (const name of ['playAnimation', 'updateAnimation', 'disposeCharacter']) {
      assert.equal(typeof first[name], 'function');
    }
    for (const name of ['position', 'rotation', 'scale', 'visible', 'add', 'getWorldPosition']) {
      assert.ok(first[name] != null, `${subject.id} is missing ${name}`);
    }
    const presentation = subject.presentation.restaurant;
    assert.equal(first.scale.x, presentation.scale);
    for (const name of [
      'groundY', 'seatedY', 'bubbleOffsetY', 'dialogueOffsetY', 'hitTargetY', 'hitTargetScale',
    ]) assert.equal(first[name], presentation[name]);

    first.disposeCharacter();
    second.disposeCharacter();
  }
});

function poseSnapshot(character) {
  const body = character.getObjectByName('paper-body');
  const leftArm = character.getObjectByName('paper-leftArm');
  return [body.position.x, body.position.y, body.rotation.z, leftArm.rotation.z];
}

test('generic animation names work for every subject without restarting a current cycle', () => {
  for (const subject of SUBJECTS) {
    const repeated = createPaperCharacter({ subject, artwork: artwork(), textureSize: 64 });
    const uninterrupted = createPaperCharacter({ subject, artwork: artwork(), textureSize: 64 });
    repeated.playAnimation('walk', { fade: 0.5 });
    uninterrupted.playAnimation('walk');
    for (let index = 0; index < 4; index += 1) {
      repeated.updateAnimation(0.05);
      uninterrupted.updateAnimation(0.05);
    }
    repeated.playAnimation('walk');
    repeated.updateAnimation(0.05);
    uninterrupted.updateAnimation(0.05);
    assert.deepEqual(poseSnapshot(repeated), poseSnapshot(uninterrupted), `${subject.id} restarted`);

    repeated.playAnimation('unknown-name');
    repeated.updateAnimation(0);
    const idle = poseSnapshot(repeated);
    repeated.playAnimation('static');
    for (let index = 0; index < 20; index += 1) repeated.updateAnimation(0.05);
    assert.deepEqual(poseSnapshot(repeated), idle, `${subject.id} static pose advanced`);

    repeated.disposeCharacter();
    uninterrupted.disposeCharacter();
  }
});

test('emote-yes celebrates and returns to the subject idle cycle', () => {
  for (const subject of SUBJECTS) {
    const character = createPaperCharacter({ subject, artwork: artwork(), textureSize: 64 });
    character.playAnimation('emote-yes');
    for (let index = 0; index < 4; index += 1) character.updateAnimation(0.05);
    const during = poseSnapshot(character);
    for (let index = 0; index < 20; index += 1) character.updateAnimation(0.05);
    const idling = poseSnapshot(character);
    assert.notDeepEqual(idling, during, `${subject.id} froze in its celebration`);
    character.updateAnimation(0.05);
    assert.notDeepEqual(poseSnapshot(character), idling, `${subject.id} idle clock did not resume`);
    character.disposeCharacter();
  }
});

test('front, back and seated look-around headings pass through untouched', () => {
  for (const heading of [0, Math.PI, -0.35, 0.35]) {
    const character = createPaperCharacter({ subject: robot, artwork: artwork(), textureSize: 64 });
    character.rotation.y = heading;
    character.updateAnimation(1 / 60);
    assert.ok(Math.abs(angleDelta(worldYaw(character), heading)) < 1e-9);
    character.disposeCharacter();
  }
});

test('rendered yaw eases with an approximately quarter-second time constant', () => {
  const character = createPaperCharacter({ subject: robot, artwork: artwork(), textureSize: 64 });
  character.rotation.y = 0;
  character.updateAnimation(0);
  character.rotation.y = 0.8;
  character.updateAnimation(0.25);
  assert.ok(Math.abs(worldYaw(character) - 0.8 * (1 - Math.exp(-1))) < 1e-9);
  character.disposeCharacter();
});

test('every subject stays outside the edge guard through a full turn', () => {
  const floor = Math.cos(Math.PI / 2 - EDGE_GUARD);
  for (const subject of SUBJECTS) {
    const character = createPaperCharacter({ subject, artwork: artwork(), textureSize: 64 });
    let narrowest = 1;
    for (let step = 0; step <= 1200; step += 1) {
      character.rotation.y = -Math.PI + (step / 1200) * Math.PI * 2;
      character.updateAnimation(1 / 60);
      narrowest = Math.min(narrowest, Math.abs(Math.cos(worldYaw(character))));
    }
    assert.ok(narrowest >= floor - 1e-9, `${subject.id} thinned to ${narrowest}`);
    character.disposeCharacter();
  }
});

test('disposing one paper character frees its art but not another live puppet shared quad', () => {
  disposeSharedPaperAssets();
  const leaving = createPaperCharacter({ subject: robot, artwork: artwork(), textureSize: 64 });
  const staying = createPaperCharacter({ subject: robot, artwork: artwork(), textureSize: 64 });
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
  assert.ok(freed.count > 0);
  assert.equal(quadFreed.count, 0);
  disposeSharedPaperAssets();
  assert.equal(sharedPaperAssets().quad, quad);
  staying.disposeCharacter();
  disposeSharedPaperAssets();
  assert.equal(quadFreed.count, 1);
});

test('a visiting paper character never mutates its saved record', () => {
  for (const subject of SUBJECTS) {
    const record = Object.freeze({
      subjectId: subject.id,
      artwork: artwork(),
      crowd: Object.freeze({ start: 2 }),
    });
    const before = { ...record.artwork };
    const character = createPaperCharacter({ subject, artwork: record.artwork, textureSize: 64 });
    character.playAnimation('walk');
    for (let step = 0; step < 30; step += 1) character.updateAnimation(1 / 60);
    character.disposeCharacter();
    assert.deepEqual({ ...record.artwork }, before);
    assert.equal(record.crowd.start, 2);
  }
});
