import * as THREE from 'three';
import { LESSON_BY_ID, UI, answerFor, formatUi } from '../../config/lesson.js';
import { promptQuestion, promptAnswer } from '../../systems/speechPrompt.js';
import { createSpeechFocus } from '../../systems/speechFocus.js';
import { createListenAgain } from '../../ui/listenAgain.js';
import { advanceFill, emptyFill, isServable, selectDrink } from './fill.js';
import { pickDrink, scoreSession, shuffleStations } from './scoring.js';

const LESSON = LESSON_BY_ID['drink-stand'];
const STRINGS = UI.drinkStand;
const MOVE_SPEED = 5;
const AUTO_SPEED = 5.7;
const FILL_PER_SECOND = 0.72;
const SHORT_TAP_MS = 150;
const STATION_RADIUS_SQ = 1.65 * 1.65;
const CUSTOMER_RADIUS_SQ = 2.15 * 2.15;
const CUSTOMER_FLOOR_Y = 0.64;
const CUSTOMER_DIALOGUE_Y = 3.65;
const WORK_BOUNDS = Object.freeze({ minX: -5.9, maxX: 5.9, minZ: -2.55, maxZ: 2.55 });
const STATION_X = Object.freeze([-5.25, -3.15, -1.05, 1.05, 3.15, 5.25]);
const WINDOWS = Object.freeze([
  Object.freeze({ x: -4.15, z: -4.3, approachX: -5.8, approachZ: -2.35 }),
  Object.freeze({ x: 0, z: -4.3, approachX: -1.65, approachZ: -2.35 }),
  Object.freeze({ x: 4.15, z: -4.3, approachX: 2.5, approachZ: -2.35 }),
]);
const DIFFICULTY = Object.freeze({
  1: Object.freeze({ count: 5, maxWindows: 1, patience: 70 }),
  2: Object.freeze({ count: 5, maxWindows: 2, patience: 65 }),
  3: Object.freeze({ count: 5, maxWindows: 3, patience: 60 }),
});
const CUSTOMER_MODELS = Object.freeze(['c', 'd', 'g', 'h', 'k', 'l', 'n', 'o', 'p', 'q', 'r']);
const DRINK_STYLE = Object.freeze({
  water: Object.freeze({ color: 0x9de5f5, css: '#9de5f5', accent: '#e8fbff', opacity: 0.62, width: 0.055,
    sound: Object.freeze({ frequency: 510, endFrequency: 430, duration: 0.18, type: 'sine', gain: 0.08 }) }),
  milk: Object.freeze({ color: 0xfffdf2, css: '#fffdf2', accent: '#8ccbed', opacity: 0.96, width: 0.115,
    sound: Object.freeze({ frequency: 230, endFrequency: 185, duration: 0.22, type: 'sine', gain: 0.07 }) }),
  'orange juice': Object.freeze({ color: 0xff922b, css: '#ff922b', accent: '#ffe066', opacity: 1, width: 0.085,
    sound: Object.freeze({ frequency: 390, endFrequency: 310, duration: 0.2, type: 'triangle', gain: 0.09 }) }),
  'apple juice': Object.freeze({ color: 0xf6d56a, css: '#f6d56a', accent: '#ef5350', opacity: 0.88, width: 0.075,
    sound: Object.freeze({ frequency: 450, endFrequency: 350, duration: 0.2, type: 'sine', gain: 0.08 }) }),
  tea: Object.freeze({ color: 0xb96522, css: '#b96522', accent: '#fff1c1', opacity: 0.9, width: 0.07,
    sound: Object.freeze({ frequency: 330, endFrequency: 270, duration: 0.24, type: 'sine', gain: 0.07 }) }),
  soda: Object.freeze({ color: 0x55df64, css: '#55df64', accent: '#d8ffd8', opacity: 0.9, width: 0.075,
    sound: Object.freeze({ frequency: 720, endFrequency: 980, duration: 0.2, type: 'square', gain: 0.055 }) }),
});

function shuffle(values, rng = Math.random) {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(rng() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

/** Drink Stand controller for the frozen minigame interface. */
export function createDrinkStand(ctx) {
  const {
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
    finish,
  } = ctx;

  let world = null;
  let player = null;
  let carryAnchor = null;
  let cup = null;
  let cupLiquid = null;
  let cupOverflow = null;
  let cupOverflowMaterial = null;
  let overlay = null;
  let style = null;
  let instruction = null;
  let actionButton = null;
  let rushBanner = null;
  let comboPop = null;
  let notice = null;
  let cupGauge = null;
  let cupGaugeLiquid = null;
  let cupGaugeLabel = null;
  let cupGaugeDrink = null;
  let cupLiquidDrink = null;
  let listenAgain = null;
  let listenCustomer = null;
  let questionCustomer = null;
  let dialogueCustomer = null;
  let lastResolvedCustomer = null;
  let pouringStation = null;
  let autoTarget = null;
  let unsubscribeSettings = null;
  let canvas = null;
  let active = false;
  let finishCalled = false;
  let phase = 'inactive';
  let level = 1;
  let elapsed = 0;
  let serviceElapsed = 0;
  let heldDrink = null;
  let fillState = emptyFill();
  let fillMode = null;
  let fillPointerId = null;
  let fillPointerStartedAt = 0;
  let fullAnnounced = false;
  let overflowAnnounced = false;
  let overflowRemaining = 0;
  let dialogueRemaining = 0;
  let speechCooldown = 0;
  let noticeRemaining = 0;
  let rushRemaining = 0;
  let comboRemaining = 0;
  let roundEndRemaining = 0;
  let finishRemaining = 0;
  let actionType = '';
  let actionTarget = null;
  let currentStreak = 0;
  let acceptedAnswer = null;
  let rushShown = false;
  let rushStart = 0;
  let debugRootCreated = false;

  const stations = [];
  const customers = [];
  const records = [];
  const windowOccupants = [null, null, null];
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  const canvases = new Set();
  const move = new THREE.Vector2();
  const worldPoint = new THREE.Vector3();
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const focus = createSpeechFocus();

  const ownGeometry = (geometry) => {
    geometries.add(geometry);
    return geometry;
  };
  const ownMaterial = (material) => {
    materials.add(material);
    return material;
  };
  const makeMaterial = (color, options = {}) => ownMaterial(new THREE.MeshStandardMaterial({
    color,
    flatShading: true,
    roughness: 0.84,
    ...options,
  }));

  function addPart(parent, geometry, material, x, y, z, sx = 1, sy = 1, sz = 1) {
    const part = new THREE.Mesh(geometry, material);
    part.position.set(x, y, z);
    part.scale.set(sx, sy, sz);
    parent.add(part);
    return part;
  }

  function createOverlay() {
    style = document.createElement('style');
    style.textContent = `
      .drink-stand-ui { position: absolute; inset: 0; pointer-events: none; }
      .drink-stand__action { position: absolute; left: 50%; bottom: 1rem; transform: translateX(-50%);
        min-width: min(78vw, 19rem); min-height: 3.7rem; padding: .65rem 1.15rem; pointer-events: auto;
        border: .24rem solid #fff; border-radius: 1.3rem; background: #3182ce; color: #fff;
        box-shadow: 0 .36rem 0 rgb(32 49 75 / .3); touch-action: none; user-select: none;
        font: 900 calc(1.1rem * var(--ui-scale, 1)) system-ui, sans-serif; }
      .drink-stand__notice { position: absolute; top: 5.3rem; left: 50%; transform: translateX(-50%);
        width: max-content; max-width: 76vw; padding: .55rem 1rem; border: .2rem solid #fff;
        border-radius: 999px; background: #ef5b47; color: #fff; box-shadow: 0 .3rem 0 rgb(35 49 71 / .25);
        font: 900 calc(1.05rem * var(--ui-scale, 1)) system-ui, sans-serif; text-align: center; }
      /* Over the floor band, not the windows: at 17% the banner covered the
         customers and their patience meters, the one thing to watch in a rush. */
      .drink-stand__rush { position: absolute; inset: 40% 0 auto; z-index: 23; text-align: center;
        color: #ff334f; -webkit-text-stroke: .18rem #fff; filter: drop-shadow(0 .45rem 0 #273858);
        font: 1000 calc(clamp(3.3rem, 9vw, 7rem) * var(--ui-scale, 1)) system-ui, sans-serif;
        animation: drink-rush .42s cubic-bezier(.2,1.8,.4,1) both; }
      .drink-stand__combo { position: absolute; left: 50%; top: 31%; transform: translateX(-50%) rotate(-4deg);
        color: #ffd43b; -webkit-text-stroke: .13rem #55380b; filter: drop-shadow(0 .3rem 0 #fff);
        font: 1000 calc(clamp(1.8rem, 4vw, 3rem) * var(--ui-scale, 1)) system-ui, sans-serif; }
      .drink-stand__patience { position: absolute; z-index: 15; width: clamp(4.5rem, 7vw, 6.1rem); height: .72rem;
        transform: translate(-50%, -50%); border: .16rem solid #fff; border-radius: 999px;
        overflow: hidden; background: #273858; box-shadow: 0 .16rem 0 rgb(28 48 78 / .25); }
      .drink-stand__patience-fill { width: 100%; height: 100%; transform-origin: left center; background: #5bd16f; }
      .drink-stand__notice[data-tone="happy"] { background: #2f9e44; }
      .drink-stand__notice[data-tone="info"] { background: #3182ce; }
      .drink-stand__cup { position: absolute; left: 1rem; bottom: 1rem; display: grid; justify-items: center; gap: .35rem;
        padding: .8rem .8rem .5rem; border: .2rem solid #fff; border-radius: 1.1rem; background: rgb(39 56 88 / .8);
        box-shadow: 0 .3rem 0 rgb(32 49 75 / .25); color: #fff;
        font: 900 calc(.95rem * var(--ui-scale, 1)) system-ui, sans-serif; }
      .drink-stand__cup-glass { position: relative; width: calc(3.4rem * var(--ui-scale, 1)); height: calc(4.6rem * var(--ui-scale, 1));
        border: .24rem solid #fff; border-top: 0; border-radius: 0 0 .8rem .8rem; background: rgb(255 255 255 / .2); }
      .drink-stand__cup-liquid { position: absolute; inset: auto 0 0; height: 0; border-radius: 0 0 .55rem .55rem;
        background: var(--drink, #9de5f5); }
      .drink-stand__cup-ok { position: absolute; left: -.55rem; right: -.55rem; bottom: 35%; border-top: .18rem dashed #fff; }
      .drink-stand__cup-check { position: absolute; top: -.75rem; right: -1rem; width: 1.55rem; height: 1.55rem;
        display: grid; place-items: center; border: .15rem solid #fff; border-radius: 50%; background: #2f9e44;
        font-size: .85rem; opacity: 0; transform: scale(.4); transition: opacity .15s, transform .22s cubic-bezier(.2,1.8,.4,1); }
      .drink-stand__cup.is-valid .drink-stand__cup-check { opacity: 1; transform: scale(1); }
      .drink-stand__cup.is-full .drink-stand__cup-glass { box-shadow: 0 0 0 .22rem #ffd43b; }
      .drink-stand__cup-spill { position: absolute; left: 50%; top: -.4rem; width: 125%; height: .65rem;
        transform: translateX(-50%); border-radius: 999px; background: var(--drink, #9de5f5); opacity: 0; }
      .drink-stand__cup.is-overflow .drink-stand__cup-spill { opacity: 1; animation: drink-spill .45s ease-in-out infinite alternate; }
      .drink-stand__cup-label { max-width: 6rem; text-align: center; line-height: 1.05; }
      .npc-dialogue.drink-stand-dialogue .npc-dialogue__replay { display: none; }
      @keyframes drink-rush { from { transform: scale(.2) rotate(-10deg); opacity: 0; } to { transform: scale(1) rotate(-2deg); opacity: 1; } }
      @keyframes drink-spill { from { transform: translateX(-50%) scaleX(.9); } to { transform: translateX(-50%) translateY(-.2rem) scaleX(1.18); } }
      @media (prefers-reduced-motion: reduce) { .drink-stand__rush, .drink-stand__cup-spill { animation: none !important; } }
    `;
    document.head.append(style);

    overlay = document.createElement('div');
    overlay.className = 'drink-stand-ui';
    overlay.innerHTML = `
      <div class="top-bar"><section class="scene-card"><h1></h1><p class="drink-stand__instruction"></p></section></div>
      <div class="drink-stand__notice" role="status" aria-live="polite" hidden></div>
      <div class="drink-stand__rush" role="status" hidden></div>
      <div class="drink-stand__combo" role="status" aria-live="polite" hidden></div>
      <button class="drink-stand__action" type="button" hidden></button>
      <div class="drink-stand__cup" aria-hidden="true" hidden>
        <div class="drink-stand__cup-glass">
          <div class="drink-stand__cup-liquid"></div>
          <div class="drink-stand__cup-spill"></div>
          <div class="drink-stand__cup-ok"></div>
          <div class="drink-stand__cup-check">✔</div>
        </div>
        <span class="drink-stand__cup-label"></span>
      </div>
    `;
    cupGauge = overlay.querySelector('.drink-stand__cup');
    cupGaugeLiquid = overlay.querySelector('.drink-stand__cup-liquid');
    cupGaugeLabel = overlay.querySelector('.drink-stand__cup-label');
    cupGaugeDrink = null;
    overlay.querySelector('h1').textContent = STRINGS.roomName;
    instruction = overlay.querySelector('.drink-stand__instruction');
    actionButton = overlay.querySelector('.drink-stand__action');
    notice = overlay.querySelector('.drink-stand__notice');
    rushBanner = overlay.querySelector('.drink-stand__rush');
    comboPop = overlay.querySelector('.drink-stand__combo');
    rushBanner.textContent = STRINGS.rush;
    actionButton.addEventListener('click', onActionClick);
    actionButton.addEventListener('pointerdown', onActionPointerDown);
    actionButton.addEventListener('pointerup', onActionPointerUp);
    actionButton.addEventListener('pointercancel', onActionPointerCancel);
    listenAgain = createListenAgain({ root: overlay, label: UI.listenAgain, onPress: replayAnswer });
    document.querySelector('#ui-layer').append(overlay);
    dialogue.element?.classList.add('drink-stand-dialogue');
    setInstruction(STRINGS.walkToCustomer);
  }

  function setInstruction(text) {
    if (instruction) instruction.textContent = text;
  }

  // Tone keeps good news from wearing the red of a problem: a full or even
  // overflowing cup is a success, and "a little more fits" is only a hint.
  function showNotice(text, seconds = 1.65, tone = '') {
    if (!notice) return;
    notice.textContent = text;
    notice.dataset.tone = tone;
    notice.hidden = false;
    noticeRemaining = seconds;
  }

  function hideAction() {
    actionType = '';
    actionTarget = null;
    if (actionButton) actionButton.hidden = true;
  }

  function showAction(text, type, target) {
    actionType = type;
    actionTarget = target;
    actionButton.textContent = text;
    actionButton.hidden = false;
  }

  function makeSignCanvas(drink) {
    const signCanvas = document.createElement('canvas');
    signCanvas.width = 384;
    signCanvas.height = 240;
    canvases.add(signCanvas);
    const context = signCanvas.getContext('2d');
    const visual = DRINK_STYLE[drink];
    context.fillStyle = '#fffaf0';
    context.fillRect(0, 0, signCanvas.width, signCanvas.height);
    context.strokeStyle = '#273858';
    context.lineWidth = 14;
    context.strokeRect(7, 7, signCanvas.width - 14, signCanvas.height - 14);
    context.save();
    context.translate(81, 2);
    context.scale(0.58, 0.58);
    context.fillStyle = visual.css;
    context.beginPath();
    if (drink === 'milk') {
      context.moveTo(135, 28); context.lineTo(249, 28); context.lineTo(270, 58); context.lineTo(257, 143); context.lineTo(127, 143); context.lineTo(114, 58); context.closePath();
    } else if (drink === 'tea') {
      context.roundRect(128, 48, 120, 82, 14);
      context.moveTo(247, 65); context.arc(262, 88, 25, -Math.PI / 2, Math.PI / 2);
    } else if (drink === 'apple juice') {
      context.arc(192, 84, 49, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = visual.accent;
      context.beginPath(); context.arc(192, 84, 25, 0, Math.PI * 2);
    } else {
      context.roundRect(143, 29, 98, 114, 20);
    }
    context.fill();
    if (drink === 'soda') {
      context.fillStyle = '#fff';
      for (const [x, y, radius] of [[165, 55, 8], [214, 72, 6], [181, 105, 5]]) {
        context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2); context.fill();
      }
    }
    if (drink === 'orange juice') {
      context.fillStyle = '#ffe066'; context.beginPath(); context.arc(192, 83, 30, 0, Math.PI * 2); context.fill();
    }
    if (drink === 'water') {
      context.fillStyle = '#e8fbff'; context.beginPath(); context.arc(192, 81, 29, 0, Math.PI * 2); context.fill();
    }
    context.restore();
    context.fillStyle = '#1b2940';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    const label = answerFor(LESSON, drink).replace(/^I like /, '').replace(/\.$/, '');
    const words = label.split(' ');
    if (words.length > 1) {
      context.font = '900 86px system-ui, sans-serif';
      context.fillText(words[0], 192, 128, 350);
      context.fillText(words.slice(1).join(' '), 192, 176, 350);
    } else {
      context.font = '900 100px system-ui, sans-serif';
      context.fillText(label, 192, 184, 350);
    }
    return signCanvas;
  }

  function ownCanvasTexture(signCanvas) {
    const texture = new THREE.CanvasTexture(signCanvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    textures.add(texture);
    return texture;
  }

  function markClickable(root, target) {
    root.traverse((object) => { object.userData.drinkStandTarget = target; });
  }

  function createStation(drink, index, shared) {
    const station = {
      id: drink,
      index,
      group: new THREE.Group(),
      stream: null,
      steam: [],
      bubbles: [],
      interaction: new THREE.Vector3(STATION_X[index], 0, 2.15),
    };
    station.group.position.set(STATION_X[index], 0, 3.75);
    const visual = DRINK_STYLE[drink];
    const bodyMaterial = makeMaterial(visual.color, drink === 'water' ? { transparent: true, opacity: 0.7 } : {});
    const paleMaterial = makeMaterial(visual.accent);
    addPart(station.group, shared.box, shared.baseMaterial, 0, 0.42, 0, 1.72, 0.78, 1.35);
    addPart(station.group, shared.box, bodyMaterial, 0, 1.05, 0.05, 1.08, 0.78, 0.75);
    addPart(station.group, shared.cylinder, shared.metalMaterial, 0, 1.57, -0.12, 0.2, 0.35, 0.2);
    addPart(station.group, shared.box, shared.metalMaterial, 0, 1.67, 0.08, 0.62, 0.14, 0.14);
    if (drink === 'milk') {
      const roof = addPart(station.group, shared.cone, paleMaterial, 0, 1.48, 0.05, 0.62, 0.42, 0.62);
      roof.rotation.y = Math.PI / 4;
    } else if (drink === 'orange juice') {
      addPart(station.group, shared.sphere, paleMaterial, 0, 1.25, 0.35, 0.34, 0.34, 0.16);
    } else if (drink === 'apple juice') {
      addPart(station.group, shared.sphere, makeMaterial(0xe94242), 0, 1.25, 0.36, 0.3, 0.3, 0.16);
      addPart(station.group, shared.box, makeMaterial(0x4a9e52), 0.12, 1.51, 0.38, 0.12, 0.22, 0.08).rotation.z = -0.45;
    } else if (drink === 'tea') {
      const handle = addPart(station.group, shared.torus, paleMaterial, 0.45, 1.23, 0.37, 0.38, 0.38, 0.18);
      handle.rotation.y = Math.PI / 2;
    } else if (drink === 'soda') {
      for (const [x, y] of [[-0.3, 1.2], [0.08, 1.4], [0.32, 1.12]]) addPart(station.group, shared.sphereSmall, paleMaterial, x, y, 0.42);
    } else {
      addPart(station.group, shared.drop, paleMaterial, 0, 1.27, 0.38, 0.28, 0.38, 0.16).rotation.z = Math.PI;
    }
    const streamMaterial = makeMaterial(visual.color, { transparent: true, opacity: visual.opacity });
    station.stream = addPart(
      station.group,
      shared.cylinder,
      streamMaterial,
      0,
      1.2,
      -0.42,
      visual.width,
      0.85,
      visual.width,
    );
    station.stream.visible = false;
    if (drink === 'tea') {
      const steamMaterial = makeMaterial(0xfff4d6, { transparent: true, opacity: 0.62, depthWrite: false });
      for (let index = 0; index < 2; index += 1) {
        const wisp = addPart(station.group, shared.torus, steamMaterial, 0, 1.68, -0.48, 0.13, 0.2, 0.13);
        wisp.rotation.x = Math.PI / 2;
        wisp.visible = false;
        station.steam.push(wisp);
      }
    }
    if (drink === 'soda') {
      const bubbleMaterial = makeMaterial(0xeaffef, { transparent: true, opacity: 0.82, depthWrite: false });
      for (let index = 0; index < 4; index += 1) {
        const bubble = addPart(station.group, shared.sphereSmall, bubbleMaterial, 0, 1.15, -0.48, 0.65, 0.65, 0.65);
        bubble.visible = false;
        station.bubbles.push(bubble);
      }
    }

    const signTexture = ownCanvasTexture(makeSignCanvas(drink));
    const signMaterial = makeMaterial(0xffffff, { map: signTexture });
    addPart(station.group, shared.plane, signMaterial, 0, 0.72, 0.7, 1.82, 1.5, 1);
    markClickable(station.group, { type: 'station', value: station });
    return station;
  }

  function createHeldCup(shared) {
    cup = new THREE.Group();
    const cupMaterial = makeMaterial(0xffffff, { transparent: true, opacity: 0.52, side: THREE.DoubleSide });
    addPart(cup, shared.cylinderOpen, cupMaterial, 0, 0, 0, 0.34, 0.62, 0.34);
    cupLiquid = addPart(cup, shared.cylinder, makeMaterial(0xffffff), 0, -0.27, 0, 0.3, 0.015, 0.3);
    cupOverflow = new THREE.Group();
    cupOverflowMaterial = makeMaterial(0xffffff, { transparent: true, opacity: 0.9, depthWrite: false });
    const rim = addPart(cupOverflow, shared.torus, cupOverflowMaterial, 0, 0.31, 0, 0.34, 0.1, 0.34);
    rim.rotation.x = Math.PI / 2;
    for (const [x, z, scale] of [[-0.34, 0.02, 0.75], [0.31, 0.1, 0.62], [-0.18, 0.31, 0.55], [0.22, -0.27, 0.68]]) {
      addPart(cupOverflow, shared.sphereSmall, cupOverflowMaterial, x, 0.2, z, scale, scale * 1.8, scale);
    }
    cupOverflow.visible = false;
    cup.add(cupOverflow);
    cup.scale.setScalar(0.9);
    cup.rotation.x = 0.06;
    cup.visible = false;
    carryAnchor.add(cup);
  }

  function createPatienceMeter(customer) {
    const meter = document.createElement('div');
    meter.className = 'drink-stand__patience';
    meter.hidden = true;
    const fillElement = document.createElement('div');
    fillElement.className = 'drink-stand__patience-fill';
    meter.append(fillElement);
    overlay.append(meter);
    customer.meter = meter;
    customer.meterFill = fillElement;
  }

  function buildWorld() {
    world = new THREE.Group();
    world.name = 'drink-stand-minigame';
    scene.background = new THREE.Color(0x8eddf2);
    scene.fog = null;
    world.add(new THREE.HemisphereLight(0xffffff, 0x5e88a1, 2.5));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(7, 12, 9);
    world.add(sun);

    const shared = {
      box: ownGeometry(new THREE.BoxGeometry(1, 1, 1)),
      cylinder: ownGeometry(new THREE.CylinderGeometry(0.5, 0.5, 1, 16)),
      cylinderOpen: ownGeometry(new THREE.CylinderGeometry(0.5, 0.42, 1, 18, 1, true)),
      sphere: ownGeometry(new THREE.SphereGeometry(0.5, 14, 9)),
      sphereSmall: ownGeometry(new THREE.SphereGeometry(0.09, 8, 6)),
      cone: ownGeometry(new THREE.ConeGeometry(0.7, 0.7, 4)),
      torus: ownGeometry(new THREE.TorusGeometry(0.5, 0.12, 8, 16)),
      drop: ownGeometry(new THREE.ConeGeometry(0.42, 0.75, 12)),
      plane: ownGeometry(new THREE.PlaneGeometry(1, 1)),
      baseMaterial: makeMaterial(0xffd166),
      metalMaterial: makeMaterial(0xd9eef2, { metalness: 0.18 }),
    };
    const floorMaterial = makeMaterial(0xffedb5);
    const wallMaterial = makeMaterial(0xff6f61);
    const counterMaterial = makeMaterial(0x38b6a5);
    const trimMaterial = makeMaterial(0xffffff);
    const darkMaterial = makeMaterial(0x273858);
    addPart(world, shared.box, floorMaterial, 0, -0.2, 0, 15, 0.4, 13);
    addPart(world, shared.box, floorMaterial, 0, 0.3, -5.25, 18, 0.6, 2.3);
    addPart(world, shared.box, wallMaterial, 0, 2.2, -6.55, 14.7, 4.8, 0.28);
    addPart(world, shared.box, counterMaterial, 0, 0.36, -3.58, 13.6, 0.72, 1.05);
    addPart(world, shared.box, trimMaterial, 0, 0.79, -3.58, 14, 0.14, 1.2);
    for (const windowInfo of WINDOWS) {
      addPart(world, shared.box, darkMaterial, windowInfo.x, 3.17, -6.38, 3.25, 0.18, 0.2);
      addPart(world, shared.box, darkMaterial, windowInfo.x - 1.52, 2.35, -6.38, 0.16, 1.8, 0.2);
      addPart(world, shared.box, darkMaterial, windowInfo.x + 1.52, 2.35, -6.38, 0.16, 1.8, 0.2);
    }

    const stationOrder = shuffleStations(Math.random);
    stationOrder.forEach((drink, index) => {
      const station = createStation(drink, index, shared);
      stations.push(station);
      world.add(station.group);
    });

    player = characters.create({ model: characters.playerModel });
    player.position.set(0, 0, 0.35);
    player.scale.setScalar(0.78);
    carryAnchor = new THREE.Group();
    carryAnchor.position.set(0, 1.22, 0.64);
    player.add(carryAnchor);
    world.add(player);
    createHeldCup(shared);

    const configured = DIFFICULTY[level];
    const modelOrder = shuffle(CUSTOMER_MODELS);
    rushStart = (configured.count - 3) * 3.5;
    const customerHitMaterial = makeMaterial(0xffffff, { transparent: true, opacity: 0, depthWrite: false });
    for (let index = 0; index < configured.count; index += 1) {
      const character = characters.create({ model: modelOrder[index % modelOrder.length] });
      character.scale.setScalar(1.68);
      character.position.set(8.15, CUSTOMER_FLOOR_Y, -6.05);
      character.rotation.y = 0;
      character.visible = false;
      const clickTarget = addPart(character, shared.box, customerHitMaterial, 0, 0.45, 0, 0.65, 0.65, 0.45);
      world.add(character);
      const isRush = index >= configured.count - 3;
      const customer = {
        index,
        wanted: pickDrink(Math.random),
        character,
        clickTarget,
        state: 'scheduled',
        spawnAt: isRush ? rushStart + (index - (configured.count - 3)) * 0.68 : index * 3.5,
        isRush,
        window: null,
        asked: false,
        served: false,
        replayed: false,
        wrongAttempts: 0,
        patience: configured.patience,
        patienceMax: configured.patience,
        leaveDelay: 0,
        meter: null,
        meterFill: null,
      };
      createPatienceMeter(customer);
      markClickable(character, { type: 'customer', value: customer });
      customers.push(customer);
    }

    scene.add(world);
    cameraRig
      .setTarget(null)
      .setPreset('fixed', { position: [0, 10.4, 13.4], lookAt: [0, 0.8, -1.05], damping: 8 });
  }

  function syncCupVisual() {
    heldDrink = fillState.drink;
    const showing = Boolean(heldDrink) && (fillState.level > 0 || Boolean(fillMode));
    syncCupGauge(showing);
    if (!cup) return;
    cup.visible = showing;
    cupLiquid.visible = Boolean(heldDrink) && fillState.level > 0;
    if (!heldDrink) return;
    const visual = DRINK_STYLE[heldDrink];
    // This runs every frame of a pour; recompile the material only when the
    // drink actually changes.
    if (cupLiquidDrink !== heldDrink) {
      cupLiquidDrink = heldDrink;
      cupLiquid.material.color.setHex(visual.color);
      cupLiquid.material.transparent = visual.opacity < 1;
      cupLiquid.material.opacity = visual.opacity;
      cupLiquid.material.needsUpdate = true;
      cupOverflowMaterial?.color.setHex(visual.color);
    }
    cupLiquid.scale.y = Math.max(0.015, fillState.level * 0.52);
    cupLiquid.position.y = -0.28 + fillState.level * 0.26;
  }

  // The 3D cup sits in a small avatar's hands and its level is a few pixels at
  // 1366x768, so the fill is also shown as a large glass by the controls: the
  // drink's colour rising, a line where the cup becomes a valid drink, a gold rim
  // when full and a wobbling spill past it. Feedback only; fill is never scored.
  function syncCupGauge(showing) {
    if (!cupGauge) return;
    cupGauge.hidden = !showing;
    if (!showing) return;
    if (cupGaugeDrink !== heldDrink) {
      cupGaugeDrink = heldDrink;
      cupGauge.style.setProperty('--drink', DRINK_STYLE[heldDrink].css);
      cupGaugeLabel.textContent = heldDrink;
    }
    cupGaugeLiquid.style.height = `${Math.round(fillState.level * 100)}%`;
    cupGauge.classList.toggle('is-valid', isServable(fillState));
    cupGauge.classList.toggle('is-full', fillState.level >= 1);
    cupGauge.classList.toggle('is-overflow', Boolean(fillState.overflowed));
  }

  function setHeldDrink(drink, levelValue = drink ? 1 : 0) {
    fillState = drink
      ? advanceFill(selectDrink(emptyFill(), drink), levelValue)
      : emptyFill();
    fullAnnounced = fillState.level >= 1;
    overflowAnnounced = false;
    overflowRemaining = 0;
    if (cupOverflow) cupOverflow.visible = false;
    syncCupVisual();
  }

  function setStationEffects(station, visible) {
    if (!station) return;
    station.stream.visible = visible;
    for (const wisp of station.steam) wisp.visible = visible;
    for (const bubble of station.bubbles) bubble.visible = visible;
  }

  function beginFill(station, mode) {
    if (!active || phase !== 'service' || !station || fillMode || questionCustomer || focus.active) return;
    clearQuestion();
    setListenTarget(null);
    fillState = selectDrink(fillState, station.id);
    pouringStation = station;
    fillMode = mode;
    fullAnnounced = fillState.level >= 1;
    overflowAnnounced = fillState.overflowed;
    autoTarget = null;
    setStationEffects(station, true);
    syncCupVisual();
    setInstruction(STRINGS.pouring);
    audio.playSfx('drink-pour', DRINK_STYLE[station.id].sound);
  }

  function endFill() {
    if (!pouringStation) return;
    setStationEffects(pouringStation, false);
    pouringStation = null;
    fillMode = null;
    if (fillState.overflowed) showNotice(STRINGS.overflow, 1.8, 'happy');
    else if (fillState.level >= 1) showNotice(STRINGS.fullCup, 1.65, 'happy');
    else if (isServable(fillState)) showNotice(STRINGS.poured, 1.65, 'happy');
    else showNotice(STRINGS.topUp, 1.65, 'info');
    syncCupVisual();
  }

  function advanceDispenser(serviceDt) {
    if (!pouringStation || !fillMode || serviceDt <= 0) return;
    const before = fillState;
    const amount = fillMode === 'latched'
      ? Math.min(FILL_PER_SECOND * serviceDt, Math.max(0, 1 - before.level))
      : FILL_PER_SECOND * serviceDt;
    advanceFill(before, amount, fillState);
    syncCupVisual();
    if (!fullAnnounced && fillState.level >= 1) {
      fullAnnounced = true;
      showNotice(STRINGS.fullCup, 1.65, 'happy');
      audio.playSfx('complete');
    }
    if (!overflowAnnounced && fillState.overflowed) {
      overflowAnnounced = true;
      overflowRemaining = 1.1;
      cupOverflow.visible = true;
      showNotice(STRINGS.overflow, 1.8, 'happy');
      audio.playSfx('drink-overflow', {
        frequency: pouringStation.id === 'soda' ? 980 : 620,
        endFrequency: pouringStation.id === 'soda' ? 1220 : 360,
        duration: 0.34,
        type: pouringStation.id === 'soda' ? 'square' : 'triangle',
        gain: 0.075,
      });
    }
    if (fillMode === 'latched' && fillState.level >= 1) endFill();
  }

  function updateFillCosmetics(dt) {
    if (pouringStation) {
      pouringStation.stream.scale.y = 0.82 + Math.sin(elapsed * 24) * 0.12;
      for (let index = 0; index < pouringStation.steam.length; index += 1) {
        const wisp = pouringStation.steam[index];
        const cycle = (elapsed * 0.7 + index * 0.48) % 1;
        wisp.position.x = Math.sin(elapsed * 3 + index * 2.4) * 0.12;
        wisp.position.y = 1.48 + cycle * 0.68;
        wisp.scale.setScalar(0.65 + cycle * 0.75);
        wisp.material.opacity = (1 - cycle) * 0.62;
      }
      for (let index = 0; index < pouringStation.bubbles.length; index += 1) {
        const bubble = pouringStation.bubbles[index];
        const cycle = (elapsed * 2.2 + index * 0.24) % 1;
        bubble.position.x = Math.sin(elapsed * 8 + index * 1.7) * 0.13;
        bubble.position.y = 0.78 + cycle * 0.88;
        bubble.scale.setScalar(0.42 + cycle * 0.48);
        bubble.material.opacity = (1 - cycle) * 0.82;
      }
    }
    if (overflowRemaining > 0) {
      overflowRemaining -= dt;
      const pulse = 1 + Math.sin(elapsed * 17) * 0.13;
      cupOverflow.scale.setScalar(pulse);
      cupOverflow.rotation.y += dt * 4.2;
      if (overflowRemaining <= 0) {
        cupOverflow.visible = false;
        cupOverflow.scale.setScalar(1);
      }
    }
  }

  function clearQuestion(keepHud = false) {
    if (!questionCustomer) return;
    questionCustomer = null;
    focus.end();
    speech.clearTarget();
    if (!keepHud) hud.hide();
  }

  function acceptQuestion(customer) {
    if (!active || phase !== 'service' || customer.state !== 'atWindow' || customer.asked) return;
    clearQuestion(true);
    customer.asked = true;
    hud.setTalkState('accepted');
    speechCooldown = 0.65;
    customer.character.playAnimation?.('emote-yes');
    audio.playSfx('accept');
    dialogueCustomer = customer;
    dialogueRemaining = 2.35;
    dialogue.show({ text: answerFor(LESSON, customer.wanted), anchor: customer.character, offsetY: CUSTOMER_DIALOGUE_Y });
    setInstruction(STRINGS.walkToStation);
  }

  function targetQuestion(customer) {
    if (questionCustomer === customer || speechCooldown > 0 || customer.asked || customer.state !== 'atWindow') return;
    // A click-to-walk passing a neighbouring window must not open that
    // neighbour's prompt: a tap on it is cancelled as soon as the walk carries
    // the child out of range and the prompt moves to the customer they chose.
    if (autoTarget && autoTarget.value !== customer) return;
    clearQuestion();
    questionCustomer = customer;
    focus.begin('drink-stand-question');
    promptQuestion(ctx, LESSON, {
      isActive: () => active && phase === 'service' && customer.state === 'atWindow',
      onAccepted: () => acceptQuestion(customer),
    });
    setInstruction(STRINGS.askCustomer);
  }

  function replayAnswer() {
    const customer = listenCustomer;
    if (!active || phase !== 'service' || !customer?.asked || customer.served || customer.state !== 'atWindow') return;
    customer.replayed = true;
    dialogueCustomer = customer;
    dialogueRemaining = 2.2;
    const sentence = answerFor(LESSON, customer.wanted);
    dialogue.show({ text: sentence, anchor: customer.character, offsetY: CUSTOMER_DIALOGUE_Y, speak: false });
    audio.speak(sentence);
    customer.character.playAnimation?.('emote-yes');
  }

  function setListenTarget(customer) {
    listenCustomer = customer;
    if (customer) listenAgain?.show();
    else listenAgain?.hide();
  }

  function recordResolution(customer, outcome, patienceLeft) {
    records.push({ outcome, patienceLeft, replayed: customer.replayed });
    lastResolvedCustomer = customer;
    if (outcome === 'first') {
      currentStreak += 1;
      if (currentStreak >= 2) {
        comboPop.textContent = formatUi(STRINGS.combo, { count: currentStreak });
        comboPop.hidden = false;
        comboRemaining = 1.45;
      }
    } else {
      currentStreak = 0;
    }
  }

  function beginLeaving(customer, outcome) {
    if (questionCustomer === customer) clearQuestion();
    if (listenCustomer === customer) setListenTarget(null);
    customer.meter.hidden = true;
    customer.state = 'reacting';
    customer.leaveDelay = 0.72;
    customer.character.playAnimation?.('emote-yes');
    recordResolution(customer, outcome, outcome === 'left' ? 0 : customer.patience / customer.patienceMax);
  }

  function serve(customer) {
    if (!heldDrink || !isServable(fillState) || !customer.asked || customer.state !== 'atWindow') return;
    autoTarget = null;
    if (heldDrink !== customer.wanted) {
      customer.wrongAttempts += 1;
      setHeldDrink(null);
      audio.playSfx('retry');
      dialogueCustomer = customer;
      dialogueRemaining = 1.75;
      dialogue.show({ text: STRINGS.wrongDrink, anchor: customer.character, offsetY: CUSTOMER_DIALOGUE_Y, speak: false });
      showNotice(STRINGS.emptyCup);
      return;
    }
    customer.served = true;
    setHeldDrink(null);
    audio.playSfx('accept');
    dialogueCustomer = customer;
    dialogueRemaining = 1.7;
    dialogue.show({ text: STRINGS.thankYou, anchor: customer.character, offsetY: CUSTOMER_DIALOGUE_Y, speak: false });
    beginLeaving(customer, customer.wrongAttempts === 0 ? 'first' : 'later');
  }

  function patienceExpired(customer) {
    if (customer.state !== 'atWindow') return;
    customer.patience = 0;
    audio.playSfx('retry');
    dialogueCustomer = customer;
    dialogueRemaining = 1.7;
    dialogue.show({ text: STRINGS.patientLeave, anchor: customer.character, offsetY: CUSTOMER_DIALOGUE_Y, speak: false });
    beginLeaving(customer, 'left');
  }

  function stationNearPlayer() {
    let nearest = null;
    let best = STATION_RADIUS_SQ;
    for (const station of stations) {
      const dx = player.position.x - station.interaction.x;
      const dz = player.position.z - station.interaction.z;
      const distance = dx * dx + dz * dz;
      if (distance < best) { best = distance; nearest = station; }
    }
    return nearest;
  }

  // Keep an open question on its customer while the child is still at that
  // window. Between two neighbouring windows the nearest customer could flip
  // frame to frame; each flip re-targeted the prompt, which hid the HUD and
  // cancelled a read-along tap already in progress, so the answer was lost.
  function questionCustomerStillNear() {
    const customer = questionCustomer;
    if (!customer || customer.asked || customer.state !== 'atWindow') return null;
    const windowInfo = WINDOWS[customer.window];
    const dx = player.position.x - windowInfo.approachX;
    const dz = player.position.z - windowInfo.approachZ;
    return dx * dx + dz * dz < CUSTOMER_RADIUS_SQ ? customer : null;
  }

  function customerNearPlayer() {
    let nearest = null;
    let best = CUSTOMER_RADIUS_SQ;
    for (const customer of customers) {
      if (customer.state !== 'atWindow') continue;
      const windowInfo = WINDOWS[customer.window];
      const dx = player.position.x - windowInfo.approachX;
      const dz = player.position.z - windowInfo.approachZ;
      const distance = dx * dx + dz * dz;
      if (distance < best) { best = distance; nearest = customer; }
    }
    return nearest;
  }

  function updateContext() {
    if (fillMode) {
      setListenTarget(null);
      setInstruction(STRINGS.pouring);
      showAction(STRINGS.pouring, 'pour', pouringStation);
      return;
    }
    if (speechCooldown > 0) {
      hideAction();
      setListenTarget(null);
      return;
    }
    const nearbyCustomer = questionCustomerStillNear() ?? customerNearPlayer();
    const nearbyStation = stationNearPlayer();
    setListenTarget(nearbyCustomer?.asked && !nearbyCustomer.served ? nearbyCustomer : null);
    if (nearbyCustomer) {
      if (!nearbyCustomer.asked) {
        hideAction();
        targetQuestion(nearbyCustomer);
      } else {
        clearQuestion();
        if (heldDrink && isServable(fillState)) {
          setInstruction(STRINGS.serveHint);
          showAction(STRINGS.serveDrink, 'serve', nearbyCustomer);
        } else {
          setInstruction(heldDrink ? STRINGS.topUp : STRINGS.walkToStation);
          hideAction();
        }
      }
      return;
    }
    clearQuestion();
    if (nearbyStation) {
      setListenTarget(null);
      setInstruction(heldDrink === nearbyStation.id && !isServable(fillState) ? STRINGS.topUp : STRINGS.pourHint);
      showAction(STRINGS.pourDrink, 'pour', nearbyStation);
      return;
    }
    hideAction();
    if (heldDrink) setInstruction(STRINGS.walkToServe);
    else if (customers.some((customer) => customer.state === 'atWindow' && customer.asked)) setInstruction(STRINGS.walkToStation);
    else setInstruction(STRINGS.walkToCustomer);
  }

  function performAction(type = actionType, target = actionTarget) {
    if (!active || phase !== 'service') return;
    if (type === 'pour' && target) beginFill(target, 'keyboard');
    else if (type === 'serve' && target) serve(target);
  }

  function onActionClick(event) {
    if (actionType === 'pour') {
      event.preventDefault();
      return;
    }
    performAction();
    if (event.detail > 0) actionButton.blur();
  }

  function onActionPointerDown(event) {
    if (event.button !== undefined && event.button !== 0) return;
    if (actionType !== 'pour' || !actionTarget || fillMode) return;
    event.preventDefault();
    fillPointerId = event.pointerId;
    fillPointerStartedAt = performance.now();
    try { actionButton.setPointerCapture(event.pointerId); } catch { /* best effort */ }
    beginFill(actionTarget, 'pointer');
    actionButton.blur();
  }

  function onActionPointerUp(event) {
    if (fillPointerId === null || event.pointerId !== fillPointerId) return;
    event.preventDefault();
    const duration = performance.now() - fillPointerStartedAt;
    fillPointerId = null;
    try { actionButton.releasePointerCapture(event.pointerId); } catch { /* best effort */ }
    if (fillMode !== 'pointer') return;
    if (duration <= SHORT_TAP_MS) fillMode = 'latched';
    else endFill();
  }

  function onActionPointerCancel(event) {
    if (fillPointerId === null || event.pointerId !== fillPointerId) return;
    fillPointerId = null;
    if (fillMode === 'pointer') endFill();
  }

  function canOccupy(x, z) {
    return x >= WORK_BOUNDS.minX && x <= WORK_BOUNDS.maxX && z >= WORK_BOUNDS.minZ && z <= WORK_BOUNDS.maxZ;
  }

  function turnPlayer(dx, dz, dt) {
    if (dx * dx + dz * dz < 0.0001) return;
    const wantedRotation = Math.atan2(dx, dz);
    const turn = Math.atan2(Math.sin(wantedRotation - player.rotation.y), Math.cos(wantedRotation - player.rotation.y));
    player.rotation.y += turn * (1 - Math.exp(-12 * dt));
  }

  function updateMovement(dt) {
    input.getMovement(move);
    if (move.lengthSq() > 0) {
      autoTarget = null;
      const nextX = player.position.x + move.x * MOVE_SPEED * dt;
      const nextZ = player.position.z - move.y * MOVE_SPEED * dt;
      if (canOccupy(nextX, player.position.z)) player.position.x = nextX;
      if (canOccupy(player.position.x, nextZ)) player.position.z = nextZ;
      const wantedRotation = Math.atan2(move.x, -move.y);
      const turn = Math.atan2(Math.sin(wantedRotation - player.rotation.y), Math.cos(wantedRotation - player.rotation.y));
      player.rotation.y += turn * (1 - Math.exp(-12 * dt));
      player.playAnimation?.('walk');
      return;
    }
    if (!autoTarget) {
      player.playAnimation?.('idle');
      return;
    }
    const destination = autoTarget.position;
    const dx = destination.x - player.position.x;
    const dz = destination.z - player.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance <= 0.18) {
      const arrived = autoTarget;
      autoTarget = null;
      player.playAnimation?.('idle');
      if (arrived.type === 'station') beginFill(arrived.value, 'latched');
      else if (arrived.type === 'customer') {
        if (arrived.value.state !== 'atWindow') return;
        if (!arrived.value.asked) targetQuestion(arrived.value);
        else if (heldDrink) serve(arrived.value);
      }
      return;
    }
    const step = Math.min(distance, AUTO_SPEED * dt);
    const nx = player.position.x + (dx / distance) * step;
    const nz = player.position.z + (dz / distance) * step;
    if (canOccupy(nx, player.position.z)) player.position.x = nx;
    if (canOccupy(player.position.x, nz)) player.position.z = nz;
    turnPlayer(dx, dz, dt);
    player.playAnimation?.('walk');
  }

  function freeWindowIndex() {
    const configured = DIFFICULTY[level];
    const activeAtWindows = windowOccupants.filter(Boolean).length;
    if (activeAtWindows >= configured.maxWindows) return -1;
    const free = windowOccupants.map((value, index) => value ? -1 : index).filter((index) => index >= 0);
    return free[Math.floor(Math.random() * free.length)] ?? -1;
  }

  function queuePosition(customer) {
    const queued = customers.filter((entry) => entry.state === 'queueing' || entry.state === 'queued');
    const slot = Math.max(0, queued.indexOf(customer));
    return {
      x: 7.25 + (slot % 2) * 0.9,
      z: -4.45 - Math.floor(slot / 2) * 0.78,
    };
  }

  function promoteQueue() {
    let freeIndex = freeWindowIndex();
    while (freeIndex >= 0) {
      const next = customers.find((customer) => customer.state === 'queued');
      if (!next) break;
      next.state = 'arriving';
      next.window = freeIndex;
      windowOccupants[freeIndex] = next;
      next.character.playAnimation?.('walk');
      freeIndex = freeWindowIndex();
    }
  }

  function moveCharacterToward(customer, x, z, speed, dt) {
    const dx = x - customer.character.position.x;
    const dz = z - customer.character.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance <= 0.06) {
      customer.character.position.set(x, CUSTOMER_FLOOR_Y, z);
      return true;
    }
    const step = Math.min(distance, speed * dt);
    customer.character.position.x += dx / distance * step;
    customer.character.position.z += dz / distance * step;
    customer.character.rotation.y = Math.atan2(dx, dz);
    return false;
  }

  function releaseWindow(customer) {
    if (customer.window !== null && windowOccupants[customer.window] === customer) windowOccupants[customer.window] = null;
  }

  function updatePatienceMeter(customer) {
    const visible = customer.state === 'atWindow';
    customer.meter.hidden = !visible;
    if (!visible) return;
    const ratio = Math.max(0, customer.patience / customer.patienceMax);
    customer.meterFill.style.transform = `scaleX(${ratio})`;
    customer.meterFill.style.background = ratio < 0.28 ? '#ef5350' : ratio < 0.56 ? '#ffc847' : '#5bd16f';
    customer.character.getWorldPosition(worldPoint);
    worldPoint.y += 1.77;
    worldPoint.project(camera);
    const root = overlay.parentElement;
    const width = root?.clientWidth || window.innerWidth;
    const height = root?.clientHeight || window.innerHeight;
    customer.meter.style.left = `${(worldPoint.x * 0.5 + 0.5) * width}px`;
    customer.meter.style.top = `${(-worldPoint.y * 0.5 + 0.5) * height}px`;
  }

  function updateCustomers(serviceDt, cosmeticDt) {
    for (const customer of customers) {
      if (serviceDt > 0 && customer.state === 'scheduled' && serviceElapsed >= customer.spawnAt) {
        customer.state = 'queueing';
        customer.character.visible = true;
        customer.character.playAnimation?.('walk');
        if (customer.isRush && !rushShown) {
          rushShown = true;
          rushBanner.hidden = false;
          rushRemaining = 2.3;
          audio.playSfx('complete');
        }
      }
      if (serviceDt > 0 && customer.state === 'queueing') {
        const target = queuePosition(customer);
        if (moveCharacterToward(customer, target.x, target.z, 3.4, serviceDt)) {
          customer.state = 'queued';
          customer.character.rotation.y = 0;
          customer.character.playAnimation?.('idle');
        }
      } else if (serviceDt > 0 && customer.state === 'arriving') {
        const target = WINDOWS[customer.window];
        if (moveCharacterToward(customer, target.x, target.z, 3.8, serviceDt)) {
          customer.state = 'atWindow';
          customer.character.rotation.y = 0;
          customer.character.playAnimation?.('idle');
        }
      } else if (serviceDt > 0 && customer.state === 'atWindow') {
        customer.patience = Math.max(0, customer.patience - serviceDt);
        if (customer.patience <= 0) patienceExpired(customer);
      } else if (serviceDt > 0 && customer.state === 'reacting') {
        customer.leaveDelay -= serviceDt;
        if (customer.leaveDelay <= 0) {
          customer.state = 'leaving';
          releaseWindow(customer);
          customer.character.rotation.y = Math.PI;
          customer.character.playAnimation?.('walk');
        }
      } else if (serviceDt > 0 && customer.state === 'leaving') {
        if (moveCharacterToward(customer, -8.15, -4.45, 3.2, serviceDt)) {
          customer.state = 'left';
          customer.character.visible = false;
        }
      }
      updatePatienceMeter(customer);
      if (customer.character.visible) customer.character.updateAnimation?.(cosmeticDt);
    }
    if (serviceDt > 0) promoteQueue();
  }

  function onCanvasPointer(event) {
    if (!active || phase !== 'service' || fillMode) return;
    const rect = canvas.getBoundingClientRect();
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const intersections = raycaster.intersectObject(world, true);
    for (const intersection of intersections) {
      let object = intersection.object;
      let target = null;
      while (object && object !== world) {
        if (object.userData.drinkStandTarget) { target = object.userData.drinkStandTarget; break; }
        object = object.parent;
      }
      if (!target) continue;
      if (target.type === 'customer' && target.value.state !== 'atWindow') continue;
      if (target.type === 'station') {
        autoTarget = { type: 'station', value: target.value, position: target.value.interaction };
      } else if (target.type === 'customer' && target.value.state === 'atWindow') {
        const windowInfo = WINDOWS[target.value.window];
        autoTarget = {
          type: 'customer',
          value: target.value,
          position: new THREE.Vector3(windowInfo.approachX, 0, windowInfo.approachZ),
        };
      }
      if (target) {
        clearQuestion();
        setListenTarget(null);
        audio.playSfx('interact');
        break;
      }
    }
  }

  function projectObject(object, offsetY = 0) {
    object.getWorldPosition(worldPoint);
    worldPoint.y += offsetY;
    worldPoint.project(camera);
    const root = overlay?.parentElement;
    const width = root?.clientWidth || window.innerWidth;
    const height = root?.clientHeight || window.innerHeight;
    return { x: (worldPoint.x * 0.5 + 0.5) * width, y: (-worldPoint.y * 0.5 + 0.5) * height };
  }

  function debugSnapshot() {
    const configured = DIFFICULTY[level];
    return {
      phase,
      level,
      heldDrink,
      serviceElapsed,
      focusActive: focus.active,
      focusScale: focus.scale,
      rushShown,
      rushStart,
      configuredCount: configured.count,
      maxWindows: configured.maxWindows,
      player: player ? { x: player.position.x, z: player.position.z } : null,
      questionIndex: questionCustomer?.index ?? null,
      autoTarget: autoTarget ? { type: autoTarget.type, target: autoTarget.value?.index ?? autoTarget.value?.id ?? null } : null,
      cup: {
        drink: fillState.drink,
        level: fillState.level,
        servable: isServable(fillState),
        overflowed: fillState.overflowed,
      },
      fillActive: Boolean(fillMode),
      fillMode,
      overflowActive: Boolean(cupOverflow?.visible),
      stations: stations.map((station) => ({
        id: station.id,
        screen: projectObject(station.group, 0.72),
        interaction: { x: station.interaction.x, z: station.interaction.z },
      })),
      customers: customers.map((customer) => ({
        index: customer.index,
        state: customer.state,
        window: customer.window,
        asked: customer.asked,
        served: customer.served,
        patience: customer.patience,
        patienceMax: customer.patienceMax,
        spawnAt: customer.spawnAt,
        isRush: customer.isRush,
        screen: projectObject(customer.clickTarget),
      })),
    };
  }

  function installDebugHook() {
    if (!window.__eslDebug) {
      Object.defineProperty(window, '__eslDebug', { value: {}, configurable: true, writable: false });
      debugRootCreated = true;
    }
    Object.defineProperty(window.__eslDebug, 'drinkStand', { configurable: true, enumerable: true, get: debugSnapshot });
  }

  function removeDebugHook() {
    if (window.__eslDebug) delete window.__eslDebug.drinkStand;
    if (debugRootCreated && window.__eslDebug && Object.keys(window.__eslDebug).length === 0) delete window.__eslDebug;
    debugRootCreated = false;
  }

  function updateRoundEnd() {
    if (phase !== 'service' || records.length !== customers.length) return;
    phase = 'round-end';
    clearQuestion();
    setListenTarget(null);
    hideAction();
    hud.hide();
    setInstruction(STRINGS.roundEnd);
    roundEndRemaining = 1.25;
  }

  function beginTurnaround() {
    if (!active || phase !== 'round-end') return;
    phase = 'turnaround';
    const npc = lastResolvedCustomer || customers[customers.length - 1];
    npc.character.visible = true;
    npc.character.scale.setScalar(1.05);
    npc.character.position.set(-1.25, CUSTOMER_FLOOR_Y, -4.3);
    npc.character.rotation.y = 0;
    npc.character.playAnimation?.('idle');
    player.position.set(1.25, 0, -2.15);
    player.rotation.y = Math.atan2(npc.character.position.x - player.position.x, npc.character.position.z - player.position.z);
    setHeldDrink(null);
    dialogue.show({ text: LESSON.question, anchor: npc.character, offsetY: 2.5 });
    setInstruction(STRINGS.turnaround);
    cameraRig
      .setTarget(null)
      .setPreset('fixed', { position: [0, 3.65, 6.15], lookAt: [0, 1.15, -3.15], damping: 6.5 });
    focus.begin('drink-stand-turnaround');
    promptAnswer(ctx, LESSON, {
      isActive: () => active && phase === 'turnaround',
      onAccepted: completeTurnaround,
    });
  }

  function completeTurnaround(answer) {
    if (!active || phase !== 'turnaround') return;
    acceptedAnswer = answer || LESSON.answers[0];
    phase = 'finishing';
    focus.end();
    speech.clearTarget();
    hud.setTalkState('accepted');
    setHeldDrink(acceptedAnswer);
    setInstruction(STRINGS.complete);
    lastResolvedCustomer?.character.playAnimation?.('emote-yes');
    player.playAnimation?.('emote-yes');
    showNotice(STRINGS.yourDrink, 1.5);
    audio.playSfx('stamp');
    finishRemaining = 0.9;
  }

  function enter(requestedLevel) {
    const configuredLevel = Number(settings.get('difficulty'));
    const numericLevel = Number(requestedLevel);
    level = THREE.MathUtils.clamp(
      Math.round(Number.isFinite(numericLevel) && numericLevel > 0 ? numericLevel : configuredLevel || 1),
      1,
      3,
    );
    active = true;
    finishCalled = false;
    phase = 'service';
    elapsed = 0;
    serviceElapsed = 0;
    heldDrink = null;
    cupLiquidDrink = null;
    fillState = emptyFill();
    fillMode = null;
    fillPointerId = null;
    fillPointerStartedAt = 0;
    fullAnnounced = false;
    overflowAnnounced = false;
    overflowRemaining = 0;
    dialogueRemaining = 0;
    speechCooldown = 0;
    noticeRemaining = 0;
    rushRemaining = 0;
    comboRemaining = 0;
    roundEndRemaining = 0;
    finishRemaining = 0;
    actionType = '';
    actionTarget = null;
    currentStreak = 0;
    acceptedAnswer = null;
    rushShown = false;
    rushStart = 0;
    focus.cancel();
    createOverlay();
    buildWorld();
    canvas = document.querySelector('#game-canvas');
    canvas?.addEventListener('pointerdown', onCanvasPointer);
    installDebugHook();
    unsubscribeSettings = settings.subscribe((next) => {
      if (!active) return;
      speech.setEnabled(!next.micFree);
      hud.setMicFree(next.micFree);
      hud.setTextSize(next.textSize);
    });
  }

  function update(dt) {
    if (!active) return;
    const safeDt = Math.min(Math.max(dt || 0, 0), 0.05);
    elapsed += safeDt;
    focus.update(safeDt);
    const serviceDt = focus.serviceDelta(safeDt);
    serviceElapsed += serviceDt;
    if (noticeRemaining > 0) {
      noticeRemaining -= safeDt;
      if (noticeRemaining <= 0) notice.hidden = true;
    }
    if (rushRemaining > 0) {
      rushRemaining -= safeDt;
      if (rushRemaining <= 0) rushBanner.hidden = true;
    }
    if (comboRemaining > 0) {
      comboRemaining -= safeDt;
      if (comboRemaining <= 0) comboPop.hidden = true;
    }
    if (dialogueRemaining > 0) {
      dialogueRemaining -= safeDt;
      if (dialogueRemaining <= 0 && phase === 'service') {
        dialogue.hide();
        dialogueCustomer = null;
      }
    }
    if (speechCooldown > 0) {
      speechCooldown -= safeDt;
      if (speechCooldown <= 0) hud.hide();
    }
    updateFillCosmetics(safeDt);

    if (phase === 'service') {
      if (fillMode) {
        player.playAnimation?.('idle');
        advanceDispenser(serviceDt);
        if (fillMode === 'keyboard' && !input.isDown('interact')) endFill();
      } else {
        updateMovement(safeDt);
        updateContext();
        if (actionType && input.consumeInteract()) performAction();
      }
      updateCustomers(serviceDt, safeDt);
      updateRoundEnd();
    } else if (phase === 'round-end') {
      player.playAnimation?.('idle');
      updateCustomers(serviceDt, safeDt);
      roundEndRemaining -= safeDt;
      if (roundEndRemaining <= 0) beginTurnaround();
    } else if (phase === 'finishing') {
      finishRemaining -= safeDt;
      if (finishRemaining <= 0 && !finishCalled) {
        finishCalled = true;
        const result = scoreSession(records);
        hud.hide();
        finish({ stars: result.stars, detail: { category: LESSON.category, answer: acceptedAnswer } });
      }
    }
    player?.updateAnimation?.(safeDt);
  }

  function exit() {
    active = false;
    phase = 'inactive';
    focus.cancel();
    setStationEffects(pouringStation, false);
    fillMode = null;
    fillPointerId = null;
    unsubscribeSettings?.();
    unsubscribeSettings = null;
    speech.clearTarget();
    speech.cancel();
    audio.stop();
    hud.hide();
    dialogue.hide();
    dialogue.element?.classList.remove('drink-stand-dialogue');
    cameraRig.setTarget(null);
    canvas?.removeEventListener('pointerdown', onCanvasPointer);
    actionButton?.removeEventListener('click', onActionClick);
    actionButton?.removeEventListener('pointerdown', onActionPointerDown);
    actionButton?.removeEventListener('pointerup', onActionPointerUp);
    actionButton?.removeEventListener('pointercancel', onActionPointerCancel);
    listenAgain?.dispose();
    removeDebugHook();
    for (const customer of customers) {
      customer.meter?.remove();
      customer.character.disposeCharacter?.();
    }
    player?.disposeCharacter?.();
    if (world) scene.remove(world);
    for (const texture of textures) texture.dispose();
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    for (const ownedCanvas of canvases) { ownedCanvas.width = 0; ownedCanvas.height = 0; }
    textures.clear();
    geometries.clear();
    materials.clear();
    canvases.clear();
    stations.length = 0;
    customers.length = 0;
    records.length = 0;
    windowOccupants.fill(null);
    overlay?.remove();
    style?.remove();
    world = null;
    player = null;
    carryAnchor = null;
    cup = null;
    cupLiquid = null;
    cupOverflow = null;
    cupOverflowMaterial = null;
    overlay = null;
    style = null;
    instruction = null;
    actionButton = null;
    rushBanner = null;
    comboPop = null;
    notice = null;
    cupGauge = null;
    cupGaugeLiquid = null;
    cupGaugeLabel = null;
    cupGaugeDrink = null;
    listenAgain = null;
    listenCustomer = null;
    questionCustomer = null;
    dialogueCustomer = null;
    lastResolvedCustomer = null;
    pouringStation = null;
    autoTarget = null;
    canvas = null;
    heldDrink = null;
    fillState = emptyFill();
  }

  return { id: 'drink-stand', enter, update, exit };
}
