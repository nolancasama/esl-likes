import * as THREE from 'three';
import './styles.css';

import { LESSON_BY_ID, UI } from './config/lesson.js';
import { updateTweens } from './core/tween.js';
import { createAudio } from './systems/audio.js';
import { createCameraRig } from './systems/cameraRig.js';
import { createCharacterSystem } from './systems/characters.js';
import { createDialogue } from './systems/dialogue.js';
import {
  COMPLETE_STAGE,
  GAME_SEQUENCE,
  HUB_STAGE,
  activeLessons,
  createShellNavigator,
  shellModeFromSearch,
} from './systems/gameSequence.js';
import { createInput } from './systems/input.js';
import { createProgression } from './systems/progression.js';
import { createSettings } from './systems/settings.js';
import { createSpeechSystem } from './systems/speech.js';
import { createTransitions } from './systems/transitions.js';
import { createBackControl } from './ui/backControl.js';
import { createHud } from './ui/hud.js';
import { createSequenceComplete } from './ui/sequenceComplete.js';
import { createStampBook } from './ui/stampBook.js';
import { createHub } from './scenes/hub.js';
import { createRestaurant } from './minigames/restaurant/index.js';
import { createColoring } from './minigames/coloring/index.js';
import { createDrinkStand } from './minigames/drinkStand/index.js';
import { createSports } from './minigames/sports/index.js';
import { createZoo } from './minigames/zoo/index.js';
import { hydrateCreations } from './minigames/coloring/coloringSession.js';

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

// Only the stages of the run are shown to the student. Drink Stand and Sports
// stay registered below and keep their saved records; they are simply off.
const ACTIVE_LESSONS = activeLessons(LESSON_BY_ID, GAME_SEQUENCE);

const progression = createProgression();
const backControl = createBackControl({ root: uiRoot, label: UI.back, onBack: () => shellRoute.back() });
const settings = createSettings({
  root: uiRoot,
  progression,
  registerEscapeGuard: backControl.registerEscapeGuard,
});
const audio = createAudio(settings);
const input = createInput(window);
const cameraRig = createCameraRig(camera);
const characters = createCharacterSystem(camera);
const speech = createSpeechSystem();
const hud = createHud({ root: uiRoot, strings: UI.speech, audio, settings });
const dialogue = createDialogue({ root: uiRoot, camera, audio, strings: UI.dialogue });
const stampBook = createStampBook({
  root: uiRoot,
  progression,
  lessons: ACTIVE_LESSONS,
  strings: UI.stampBook,
  registerEscapeGuard: backControl.registerEscapeGuard,
});
const transitions = createTransitions(wipe);
const unbindSpeech = speech.bind(hud.talkButton);

// Character assets get a short head start before the first screen is built, so
// the child's avatar is the same model on every screen. The wait is capped: on a
// slow classroom connection the game still starts on the procedural fallback body
// instead of hanging, which is why preloading was first kept off the startup path.
const CHARACTER_HEAD_START_MS = 2500;
const charactersReady = Promise.race([
  characters.preload(),
  new Promise((resolve) => setTimeout(resolve, CHARACTER_HEAD_START_MS)),
]);

// Saved artwork gets a short head start so creations are present on the first
// screen. The wait is capped: on school Chromebooks a blocked database must
// never mean a blank screen, and hydration continues after the timer wins.
const CREATION_HYDRATE_HEAD_START_MS = 1500;
const creationsReady = Promise.race([
  hydrateCreations(),
  new Promise((resolve) => setTimeout(resolve, CREATION_HYDRATE_HEAD_START_MS)),
]);

// All five stay registered. Drink Stand and Sports are switched off by
// `available: false` in the lesson config, so turning one back on is one line.
const minigames = new Map([
  ['restaurant', createRestaurant],
  ['coloring', createColoring],
  ['drink-stand', createDrinkStand],
  ['sports', createSports],
  ['zoo', createZoo],
]);

let controller = null;
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
    onEnterMinigame: (id) => shellRoute.enter(id),
  });
}

function recordFinish(gameId, result = {}) {
  const stars = THREE.MathUtils.clamp(Math.round(Number(result.stars) || 1), 1, 3);
  progression.awardStamp(gameId, stars);
  const detail = result.detail || {};
  if (detail.category && detail.answer) progression.setAnswer(detail.category, detail.answer);
  if (detail.zooPhoto) progression.setZooPhoto(gameId, detail.zooPhoto);
  audio.playSfx('complete');
}

// Minigames whose difficulty is fixed by their own design.
const FIXED_DIFFICULTY_GAMES = new Set(['restaurant']);

function makeMinigame(id) {
  // This is the frozen plug-in surface for all five minigames. `transitions`
  // lets a minigame wipe between its own screens (Coloring: 3D -> 2D -> 3D).
  // `registerEscapeGuard` deliberately extends that surface so a temporary
  // local UI can consume Escape before the shell takes the Back route.
  const ctx = {
    scene,
    camera,
    cameraRig,
    // The renderer and its canvas are here for development tools that need
    // a DOM element to attach pointer controls to — the scene placement
    // editor's gizmo, for one. Gameplay code uses `captureFrame` instead.
    renderer,
    canvas,
    input,
    speech,
    audio,
    dialogue,
    characters,
    hud,
    settings,
    transitions,
    registerEscapeGuard: backControl.registerEscapeGuard,
    // The WebGL buffer is empty between frames, so a minigame reading the
    // canvas from an event handler gets a blank image (the Zoo's photos).
    // Render once and hand the canvas over in the same task instead, which
    // keeps the cost where it is used rather than on every frame.
    captureFrame: (draw) => {
      renderer.render(scene, camera);
      draw(canvas);
    },
    // Where a finished game goes next is the shell's business, not the game's.
    finish: (result) => shellRoute.finish(id, result),
  };
  return minigames.get(id)(ctx);
}

function makeStage(stage) {
  if (stage === HUB_STAGE) return makeHub();
  if (stage === COMPLETE_STAGE) {
    return createSequenceComplete({
      root: uiRoot,
      progression,
      lessons: ACTIVE_LESSONS,
      strings: UI.sequenceComplete,
      onReplay: () => shellRoute.restart(),
    });
  }
  return makeMinigame(stage);
}

async function showStage(stage, { backAvailable, transition }) {
  const build = () => replaceController(() => {
    backControl.setAvailable(backAvailable);
    // The Restaurant has one fixed baseline and ignores this setting, so the
    // control is hidden while it is open rather than lying to the student.
    settings.setDifficultyAvailable?.(!FIXED_DIFFICULTY_GAMES.has(stage));
    return makeStage(stage);
  }, settings.get('difficulty'));
  if (!transition) {
    await build();
    return true;
  }
  return transitions.run(build);
}

// Students get the fixed run Coloring -> Restaurant -> Zoo. `?hub=1` opens the
// old five-door room instead, where every finish and Back returns to the hub:
// free play for a teacher, and the route the playthrough harnesses walk.
const shellRoute = createShellNavigator({
  mode: shellModeFromSearch(window.location.search),
  sequence: GAME_SEQUENCE,
  isPlayable: (id) => Boolean(LESSON_BY_ID[id]?.available && minigames.has(id)),
  show: showStage,
  record: recordFinish,
});

// Read-only, for the playthrough harnesses: which stage the shell is on.
if (!window.__eslDebug) {
  Object.defineProperty(window, '__eslDebug', { value: {}, configurable: true, writable: false });
}
Object.defineProperty(window.__eslDebug, 'shell', {
  configurable: true,
  enumerable: true,
  get: () => ({ mode: shellRoute.mode, stage: shellRoute.current, routing: shellRoute.routing }),
});
// Dev only: finish the open game as if it had called `ctx.finish`, so the
// sequence harness need not play a whole Restaurant and Zoo. Gated exactly as
// Coloring's dev hooks are, so a student's browser can never reach it.
if (import.meta.env?.DEV || new URLSearchParams(window.location.search).has('editor')) {
  window.__eslDebug.shellFinish = (stars = 3) => shellRoute.finish(shellRoute.current, { stars });
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
  backControl.destroy();
  audio.destroy();
  input.destroy();
  cameraRig.destroy();
  renderer.dispose();
}

window.addEventListener('resize', resize);
window.addEventListener('pagehide', dispose, { once: true });

resize();
Promise.all([charactersReady, creationsReady]).then(() => shellRoute.start()).then(() => {
  cameraRig.update(1);
  animationFrame = requestAnimationFrame(frame);
});
