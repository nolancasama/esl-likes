import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const COMMON_KEYS = ['a', 'b', 'e', 'f', 'i', 'j', 'k', 'm', 'q'];
const RARE_KEYS = ['c', 'd', 'g', 'h', 'l', 'n', 'o', 'p', 'r'];
const ALL_KEYS = [...COMMON_KEYS, ...RARE_KEYS];
const REQUIRED_CLIPS = ['idle', 'walk', 'sprint', 'emote-yes', 'static'];
export const TARGET_HEIGHT = 1.95;
const RARE_CHANCE = 1 / 12;

export const CLIPS = Object.freeze([...REQUIRED_CLIPS]);
export const CLIP = Object.freeze({
  idle: 'idle',
  walk: 'walk',
  sprint: 'sprint',
  emoteYes: 'emote-yes',
  static: 'static',
  run: 'sprint',
  cheer: 'emote-yes',
});

let preloadPromise = null;
let sources = null;

const fallbackGeometry = Object.freeze({
  torso: new THREE.BoxGeometry(0.72, 0.78, 0.38),
  head: new THREE.BoxGeometry(0.54, 0.54, 0.54),
  limb: new THREE.BoxGeometry(0.2, 0.68, 0.2),
});

function publicPath(path) {
  return `${import.meta.env?.BASE_URL || './'}${path}`;
}

function pick(rng, values) {
  return rng?.pick ? rng.pick(values) : values[Math.floor(Math.random() * values.length)];
}

function range(rng, min, max) {
  return rng?.range ? rng.range(min, max) : min + Math.random() * (max - min);
}

function chance(rng, probability) {
  return Boolean(rng?.chance ? rng.chance(probability) : Math.random() < probability);
}

/** Fetch and decode the Kenney library once; resolves false on every failure. */
export function preloadCharacterModels() {
  if (preloadPromise) return preloadPromise;
  preloadPromise = (async () => {
    const loader = new GLTFLoader();
    const controller = new AbortController();
    let timeout;
    try {
      // The GLBs refer to "Textures/texture-x.png" externally. parseAsync must
      // receive this directory or every model silently renders white.
      const resourcePath = publicPath('assets/characters/');
      const load = async (key) => {
        const path = `assets/characters/character-${key}.glb`;
        const response = await fetch(publicPath(path), {
          cache: 'force-cache',
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
        return loader.parseAsync(await response.arrayBuffer(), resourcePath);
      };

      const deadline = new Promise((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new Error('Character preload timed out after 8 seconds.'));
        }, 8000);
      });
      const assets = await Promise.race([Promise.all(ALL_KEYS.map(load)), deadline]);

      const loaded = new Map();
      ALL_KEYS.forEach((key, index) => {
        const asset = assets[index];
        const clips = new Map(asset.animations.map((clip) => [clip.name, clip]));
        for (const required of REQUIRED_CLIPS) {
          if (!clips.has(required)) throw new Error(`character-${key} is missing the ${required} clip`);
        }
        const scene = asset.scene;
        scene.updateMatrixWorld(true);
        const bounds = new THREE.Box3().setFromObject(scene);
        const height = bounds.max.y - bounds.min.y;
        if (!Number.isFinite(height) || height <= 0) throw new Error(`character-${key} has invalid bounds`);
        scene.traverse((object) => {
          if (!object.isMesh) return;
          object.castShadow = false;
          object.receiveShadow = false;
        });
        loaded.set(key, { scene, clips, bounds, height });
      });
      sources = loaded;
      return true;
    } catch (error) {
      controller.abort();
      sources = null;
      console.warn('[characters] Kenney assets unavailable; using procedural people.', error);
      return false;
    } finally {
      clearTimeout(timeout);
    }
  })();
  return preloadPromise;
}

export const preload = preloadCharacterModels;

export function characterModelsReady() {
  return Boolean(sources);
}

/** The child's own avatar. One model on every screen, so they always recognise themselves. */
export const PLAYER_MODEL = 'a';

function chooseKey(rng, { model, allowRare }) {
  if (model) {
    // Accept the file-name form too: "character-a" names character-a.glb.
    const key = String(model).replace(/^character-/, '');
    if (sources?.has(key)) return key;
    // An unknown requested model used to fall through to a random pick silently,
    // which gave the child a different avatar on every screen and every session.
    console.warn(`[characters] unknown model "${model}"; using a random one`);
  }
  if (allowRare && chance(rng, RARE_CHANCE)) return pick(rng, RARE_KEYS);
  return pick(rng, COMMON_KEYS);
}

function makeTintController(root, initialTint) {
  const tintedMaterials = [];
  root.traverse((object) => {
    if (!object.isMesh) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    const cloned = materials.map((material) => {
      const copy = material.clone();
      // Textured Kenney models keep their painted colours. Multiplying a tint over
      // the whole atlas turned skin grey-green along with the clothes. The cast is
      // told apart by model, so only the untextured fallback body is tinted.
      if (copy.color && !copy.map) tintedMaterials.push({ material: copy, base: copy.color.clone() });
      return copy;
    });
    object.material = Array.isArray(object.material) ? cloned : cloned[0];
  });
  const tintColor = new THREE.Color();
  const setTint = (value = 0xffffff) => {
    tintColor.set(value);
    for (const entry of tintedMaterials) entry.material.color.copy(entry.base).multiply(tintColor);
  };
  setTint(initialTint ?? 0xffffff);
  return {
    setTint,
    disposeMaterials: () => tintedMaterials.forEach(({ material }) => material.dispose()),
  };
}

function attachCharacterApi(character, data) {
  character.name = data.name;
  character.userData = { ...character.userData, ...data.userData };
  character.playAnimation = data.play;
  character.updateAnimation = data.update;
  character.setTint = data.setTint;
  character.disposeCharacter = data.dispose;
  return character;
}

function createFallbackCharacter({ tint = 0x7fc8ff } = {}) {
  const character = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 0.9 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xffc99b, flatShading: true, roughness: 0.9 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x33415c, flatShading: true, roughness: 0.9 });

  const part = (name, geometry, partMaterial, x, y, z = 0) => {
    const mesh = new THREE.Mesh(geometry, partMaterial);
    mesh.name = name;
    mesh.position.set(x, y, z);
    character.add(mesh);
    return mesh;
  };
  const torso = part('torso', fallbackGeometry.torso, material, 0, 1.15);
  const head = part('head', fallbackGeometry.head, skin, 0, 1.82);
  const armLeft = part('arm-left', fallbackGeometry.limb, material, -0.48, 1.16);
  const armRight = part('arm-right', fallbackGeometry.limb, material, 0.48, 1.16);
  const legLeft = part('leg-left', fallbackGeometry.limb, dark, -0.2, 0.4);
  const legRight = part('leg-right', fallbackGeometry.limb, dark, 0.2, 0.4);
  const baseColor = material.color.clone();
  const tintColor = new THREE.Color();
  let currentName = CLIP.idle;
  let elapsed = 0;

  const setTint = (value = 0xffffff) => {
    tintColor.set(value);
    material.color.copy(baseColor).multiply(tintColor);
  };
  setTint(tint ?? 0xffffff);

  const play = (name) => {
    if (!REQUIRED_CLIPS.includes(name)) return false;
    currentName = name;
    return true;
  };
  const update = (dt) => {
    elapsed += Math.min(Math.max(dt || 0, 0), 0.1);
    const stride = currentName === CLIP.sprint ? 12 : 8;
    const amount = currentName === CLIP.walk || currentName === CLIP.sprint ? 0.48 : 0;
    const swing = Math.sin(elapsed * stride) * amount;
    armLeft.rotation.x = swing;
    armRight.rotation.x = -swing;
    legLeft.rotation.x = -swing;
    legRight.rotation.x = swing;
    head.rotation.z = currentName === CLIP.emoteYes ? Math.sin(elapsed * 8) * 0.08 : 0;
    torso.position.y = 1.15 + (amount ? Math.abs(Math.sin(elapsed * stride)) * 0.025 : 0);
  };
  const dispose = () => {
    material.dispose();
    skin.dispose();
    dark.dispose();
  };

  return attachCharacterApi(character, {
    name: 'procedural-character',
    play,
    update,
    setTint,
    dispose,
    userData: {
      isCharacterModel: true,
      isProceduralFallback: true,
      modelKey: null,
      head,
      armLeft,
      armRight,
      torso,
      baseY: 0,
      idleClip: CLIP.idle,
      playAnimation: play,
      updateAnimation: update,
      currentAnimation: () => currentName,
      setTint,
      dispose,
    },
  });
}

/** Create an independently animated, tintable model or a safe fallback body. */
export function createCharacterModel(rng, options = {}) {
  if (rng && typeof rng !== 'function' && !rng.pick && !rng.range) {
    options = rng;
    rng = options.rng;
  }
  const {
    model = null,
    camera = null,
    allowRare = false,
    tint = null,
  } = options;
  if (!sources) return createFallbackCharacter({ tint: tint ?? 0x7fc8ff });

  const key = chooseKey(rng, { model, allowRare });
  const source = sources.get(key);
  const character = new THREE.Group();
  const content = new THREE.Group();
  const clonedScene = source.scene.clone(true);
  const targetHeight = TARGET_HEIGHT * range(rng, 0.96, 1.04);
  const scale = targetHeight / source.height;
  const centre = source.bounds.getCenter(new THREE.Vector3());

  content.scale.setScalar(scale);
  content.position.x = -centre.x * scale;
  content.position.y = -source.bounds.min.y * scale;
  content.position.z = -centre.z * scale;
  content.add(clonedScene);
  character.add(content);

  const tintController = makeTintController(clonedScene, tint);
  const mixer = new THREE.AnimationMixer(character);
  const actions = new Map();
  let currentAction = null;
  let currentName = null;
  let animationAccumulator = 0;
  const actionFor = (name) => {
    if (!actions.has(name)) actions.set(name, mixer.clipAction(source.clips.get(name)));
    return actions.get(name);
  };
  const play = (name, { fade = 0.18, timeScale = 1 } = {}) => {
    if (!source.clips.has(name)) return false;
    if (currentName === name) {
      currentAction.setEffectiveTimeScale(timeScale);
      return true;
    }
    const next = actionFor(name);
    next.reset().setEffectiveTimeScale(timeScale).play();
    if (currentAction && fade > 0) currentAction.crossFadeTo(next, fade, false);
    else currentAction?.stop();
    currentAction = next;
    currentName = name;
    return true;
  };

  const rootNode = clonedScene.getObjectByName('root');
  const rootRest = rootNode?.position.clone() ?? null;
  const animationPoint = new THREE.Vector3();
  const update = (dt) => {
    animationAccumulator = Math.min(0.2, animationAccumulator + Math.max(0, dt || 0));
    if (camera) {
      camera.updateMatrixWorld();
      character.getWorldPosition(animationPoint);
      animationPoint.y += 1;
      const far = camera.position.distanceToSquared(animationPoint) > 45 * 45;
      animationPoint.project(camera);
      const onScreen = animationPoint.z >= -1 && animationPoint.z <= 1
        && Math.abs(animationPoint.x) <= 1.05 && Math.abs(animationPoint.y) <= 1.05;
      if (!onScreen || (far && animationAccumulator < 0.1)) return;
    }
    mixer.update(animationAccumulator);
    if (rootRest) rootNode.position.copy(rootRest);
    animationAccumulator = 0;
  };
  const dispose = () => {
    mixer.stopAllAction();
    mixer.uncacheRoot(character);
    tintController.disposeMaterials();
  };

  play(CLIP.idle, { fade: 0 });
  mixer.update(0);
  if (rootRest) rootNode.position.copy(rootRest);
  return attachCharacterApi(character, {
    name: `kenney-character-${key}`,
    play,
    update,
    setTint: tintController.setTint,
    dispose,
    userData: {
      isCharacterModel: true,
      isProceduralFallback: false,
      modelKey: key,
      isRareCharacter: RARE_KEYS.includes(key),
      mixer,
      head: clonedScene.getObjectByName('head'),
      armLeft: clonedScene.getObjectByName('arm-left'),
      armRight: clonedScene.getObjectByName('arm-right'),
      torso: clonedScene.getObjectByName('torso'),
      baseY: 0.3,
      idleClip: CLIP.idle,
      playAnimation: play,
      updateAnimation: update,
      currentAnimation: () => currentName,
      setTint: tintController.setTint,
      dispose,
    },
  });
}

export function createCharacterSystem(camera = null) {
  return {
    preload: preloadCharacterModels,
    playerModel: PLAYER_MODEL,
    create(options = {}) {
      return createCharacterModel(options.rng, { ...options, camera: options.camera ?? camera });
    },
    get ready() { return characterModelsReady(); },
    clips: CLIP,
    clipNames: CLIPS,
  };
}

export const CHARACTER_MODEL_KEYS = ALL_KEYS;
export const COMMON_MODEL_KEYS = COMMON_KEYS;
export const RARE_MODEL_KEYS = RARE_KEYS;
