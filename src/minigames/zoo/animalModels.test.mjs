import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import '../../../scripts/lib/dom-shim.mjs';
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { ANIMAL_MODELS } from './world.js';
import { resolveAnimalClips } from './animalAnimator.js';
import { ANIMAL_IDS } from './territories.js';

globalThis.ProgressEvent ??= class ProgressEvent {
  constructor(type, init = {}) {
    this.type = type;
    Object.assign(this, init);
  }
};

const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
const assetRoot = new URL('../../../public/assets/animals/', import.meta.url);

test('every configured Cube World animal parses, scales sanely, and supplies locomotion clips', async () => {
  assert.deepEqual(Object.keys(ANIMAL_MODELS).sort(), [...ANIMAL_IDS].sort());

  for (const id of ANIMAL_IDS) {
    const config = ANIMAL_MODELS[id];
    assert.ok(config.targetHeight > 0, `${id} has a non-positive target height`);
    assert.equal(Object.hasOwn(config, 'node'), false, `${id} still selects a shared-file node`);
    assert.match(config.file, /^cube-world\/[A-Z][A-Za-z]+\.gltf$/);

    const file = new URL(config.file, assetRoot);
    assert.ok(existsSync(file), `${config.file} does not exist`);
    const gltf = await new GLTFLoader().parseAsync(readFileSync(file, 'utf8'), assetRoot.href);
    assert.ok(gltf.scene, `${id} has no scene`);

    gltf.scene.updateMatrixWorld(true);
    const rawSize = new THREE.Box3().setFromObject(gltf.scene).getSize(new THREE.Vector3());
    const scale = config.targetHeight / rawSize.y;
    assert.ok(Number.isFinite(scale) && scale >= 0.1 && scale <= 10,
      `${id} produces an implausible scale ${scale}`);
    assert.ok(Math.abs(rawSize.y * scale - config.targetHeight) < 1e-9,
      `${id} does not normalise to its target height`);

    const clips = resolveAnimalClips(gltf.animations);
    assert.equal(clips.idle?.name, 'Idle', `${id} has no Idle clip`);
    assert.ok(clips.walk, `${id} has no Walk or Run fallback`);
    if (id === 'chicken') {
      assert.equal(clips.walk.name, 'Run');
      assert.equal(clips.walk, clips.run, 'the missing Walk must use the general Run fallback');
    } else {
      assert.equal(clips.walk.name, 'Walk');
    }

    const runtimeClone = cloneSkinned(gltf.scene);
    const mixer = new THREE.AnimationMixer(runtimeClone);
    assert.doesNotThrow(() => {
      mixer.clipAction(clips.idle).play();
      mixer.clipAction(clips.walk).play();
      mixer.update(1 / 60);
    }, `${id} clips do not bind to their own model`);
    mixer.stopAllAction();
  }
});

test('clip names resolve by case-insensitive exact match with a general Run fallback', () => {
  const idleEating = new THREE.AnimationClip('Idle_Eating', 1, []);
  const idle = new THREE.AnimationClip('iDLE', 1, []);
  const run = new THREE.AnimationClip('rUN', 1, []);
  const clips = resolveAnimalClips([idleEating, run, idle]);

  assert.equal(clips.idle, idle);
  assert.equal(clips.walk, run);
  assert.equal(clips.run, run);
});
