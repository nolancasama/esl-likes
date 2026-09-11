import * as THREE from 'three';
import './styles.css';

import { LESSONS, LESSON_BY_ID, UI } from './config/lesson.js';
import { updateTweens } from './core/tween.js';
import { createAudio } from './systems/audio.js';
import { createCameraRig } from './systems/cameraRig.js';
import { createCharacterSystem } from './systems/characters.js';
import { createDialogue } from './systems/dialogue.js';
import { createInput } from './systems/input.js';
import { createProgression } from './systems/progression.js';
import { createSettings } from './systems/settings.js';
import { createSpeechSystem } from './systems/speech.js';
import { createTransitions } from './systems/transitions.js';
import { createHud } from './ui/hud.js';
import { createStampBook } from './ui/stampBook.js';
import { createHub } from './scenes/hub.js';
import { createRestaurant } from './minigames/restaurant/index.js';

document.title = UI.appTitle;

const canvas = document.querySelector('#game-canvas');
const uiRoot = document.querySelector('#ui-layer');
const wipe = document.querySelector('#scene-wipe');
wipe.setAttribute('aria-label', UI.transition.label);

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch {
  const error = document.createElement('div');
  error.className = 'fatal-message';
  error.textContent = UI.errors.webgl;
  uiRoot.append(error);
  throw new Error('WebGL renderer unavailable');
}

renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 100);
camera.position.set(7.5, 7.5, 10);

const progression = createProgression();
const settings = createSettings({ root: uiRoot, progression });
const audio = createAudio(settings);
const input = createInput(window);
const cameraRig = createCameraRig(camera);
const characters = createCharacterSystem(camera);
const speech = createSpeechSystem();
const hud = createHud({ root: uiRoot, strings: UI.speech, audio, settings });
const dialogue = createDialogue({ root: uiRoot, camera, audio, strings: UI.dialogue });
const stampBook = createStampBook({ root: uiRoot, progression, lessons: LESSONS, strings: UI.stampBook });
const transitions = createTransitions(wipe);
const unbindSpeech = speech.bind(hud.talkButton);

// Character assets get a short head start before the first hub is built, so the
// child's avatar is the same model on every screen. The wait is capped: on a slow
// classroom connection the game still starts on the procedural fallback body
// instead of hanging, which is why preloading was first kept off the startup path.
const CHARACTER_HEAD_START_MS = 2500;
const charactersReady = Promise.race([
  characters.preload(),
  new Promise((resolve) => setTimeout(resolve, CHARACTER_HEAD_START_MS)),
]);

const minigames = new Map([
  ['restaurant', createRestaurant],
]);

let controller = null;
let routing = false;
let finishing = false;
let disposed = false;
let animationFrame = 0;
let lastTime = performance.now();

function applyTextSize(value) {
  const scale = value === 'extraLarge' ? 1.3 : value === 'large' ? 1.15 : 1;
  document.documentElement.style.setProperty('--ui-scale', String(scale));
  hud.setTextSize(value);
  dialogue.setTextScale(scale);
}

applyTextSize(settings.get('textSize'));
const unsubscribeSettings = settings.subscribe((next) => {
  applyTextSize(next.textSize);
  audio.syncVolume();
});

async function replaceController(makeController, enterArgument) {
  controller?.exit();
  dialogue.hide();
  hud.hide();
  input.clear();
  controller = makeController();
  await controller.enter(enterArgument);
  input.clear();
}

function makeHub() {
  return createHub({
    scene,
    camera,
    cameraRig,
    input,
    characters,
    progression,
    stampBook,
    settings,
    uiRoot,
    onEnterMinigame: enterMinigame,
  });
}

async function returnToHub() {
  if (routing) return;
  routing = true;
  try {
    await transitions.run(() => replaceController(makeHub));
  } finally {
    routing = false;
    finishing = false;
  }
}

function handleFinish(gameId, result = {}) {
  if (finishing) return;
  finishing = true;
  const stars = THREE.MathUtils.clamp(Math.round(Number(result.stars) || 1), 1, 3);
  progression.awardStamp(gameId, stars);
  const detail = result.detail || {};
  if (detail.category && detail.answer) progression.setAnswer(detail.category, detail.answer);
  if (detail.zooPhoto) progression.setZooPhoto(gameId, detail.zooPhoto);
  audio.playSfx('complete');
  returnToHub();
}

async function enterMinigame(id) {
  if (routing || !LESSON_BY_ID[id]?.available) return;
  const factory = minigames.get(id);
  if (!factory) return;
  routing = true;
  finishing = false;
  try {
    await transitions.run(() => replaceController(() => {
      // This is the frozen plug-in surface for all five minigames. `transitions`
      // lets a minigame wipe between its own screens (Coloring: 3D -> 2D -> 3D).
      const ctx = {
        scene,
        camera,
        cameraRig,
        input,
        speech,
        audio,
        dialogue,
        characters,
        hud,
        settings,
        transitions,
        finish: (result) => handleFinish(id, result),
      };
      return factory(ctx);
    }, settings.get('difficulty')));
  } finally {
    routing = false;
  }
}

function resize() {
  const width = Math.max(1, window.innerWidth);
  const height = Math.max(1, window.innerHeight);
  renderer.setSize(width, height, false);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function frame(now) {
  if (disposed) return;
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  controller?.update(dt);
  cameraRig.update(dt);
  dialogue.update();
  updateTweens(dt);
  renderer.render(scene, camera);
  input.endFrame();
  animationFrame = requestAnimationFrame(frame);
}

function dispose() {
  if (disposed) return;
  disposed = true;
  cancelAnimationFrame(animationFrame);
  window.removeEventListener('resize', resize);
  controller?.exit();
  unsubscribeSettings();
  unbindSpeech();
  speech.dispose();
  dialogue.dispose();
  hud.dispose();
  stampBook.destroy();
  settings.destroy();
  audio.destroy();
  input.destroy();
  cameraRig.destroy();
  renderer.dispose();
}

window.addEventListener('resize', resize);
window.addEventListener('pagehide', dispose, { once: true });

resize();
charactersReady.then(() => replaceController(makeHub)).then(() => {
  cameraRig.update(1);
  animationFrame = requestAnimationFrame(frame);
});
