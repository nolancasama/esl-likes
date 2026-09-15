import * as THREE from 'three';
import { LESSON_BY_ID, UI, answerFor, formatUi } from '../../config/lesson.js';
import { promptQuestion, promptAnswer } from '../../systems/speechPrompt.js';
import { createSpeechFocus } from '../../systems/speechFocus.js';
import { createListenAgain } from '../../ui/listenAgain.js';
import {
  FOOD_PREP_SECONDS,
  advanceRefusalLock,
  pickFood,
  scoreSession,
} from './scoring.js';
import { createRestaurantDirector } from './director.js';
import { createConveyor } from './conveyor.js';
import { RESTAURANT_OWNERS, createCustomerClaimRegistry } from './claims.js';
import { RIVAL_LEVELS, RIVAL_SPEED, createRestaurantRival } from './rival.js';
import { OWNERSHIP_BUBBLE_TEXT, isTalkable, ownershipBubble } from './customerState.js';

const LESSON = LESSON_BY_ID.restaurant;
const STRINGS = UI.restaurant;
const MOVE_SPEED = 5;
const AUTO_SPEED = 5.7;
const CUSTOMER_RADIUS_SQ = 2.7 * 2.7;
const WALL_HALF_WIDTH = 6.85;
const BELT_CENTER_Z = -6.35;
const BELT_TOP_Y = 1.1;
const BELT_FRONT_Z = -4.4;
const BELT_FRONT_BAND = 1.15;
const BELT_PICKUP_WINDOW = 1.4;
const BELT_ARRIVAL_WINDOW = 1.6;
// Beside the entry opening, clear of the back-right table's talk spot
// (seatZ - 1.65): the return radius must never cover a customer approach.
const DISH_RETURN_POSITION = Object.freeze({ x: 6.0, z: -3.95 });
const DISH_RETURN_RADIUS_SQ = 1.4 * 1.4;
const HOST_TURNAROUND_POSITION = Object.freeze({ x: 0, z: -3.15 });
const HOT_SECONDS = 9;
const WARM_SECONDS = 22;
const REFUSAL_SECONDS = 5;
const EATING_SECONDS = 3.2;
const CUSTOMER_WALK_SPEED = 10;
// Click-to-walk steers past any table lying across its straight line.
const STEER_RADIUS = 1.45;
const STEER_CLEARANCE = 1.75;
// The rival starts beside the left wall; it has no hatch and shares the belt.
const RIVAL_START_POSITION = Object.freeze({ x: -5.95, z: 1.45 });
const RIVAL_MIN_SPEED = RIVAL_SPEED * 0.7;
const RIVAL_MAX_SPEED = RIVAL_SPEED * 1.3;

const TABLES = Object.freeze([
  Object.freeze({ x: -4.2, z: -1.0, seatX: -4.2, seatZ: -2.05 }),
  Object.freeze({ x: 0, z: 1.8, seatX: 0, seatZ: 0.75 }),
  Object.freeze({ x: 4.2, z: -1.0, seatX: 4.2, seatZ: -2.05 }),
  Object.freeze({ x: -4.2, z: 3.9, seatX: -4.2, seatZ: 2.85 }),
  Object.freeze({ x: 4.2, z: 3.9, seatX: 4.2, seatZ: 2.85 }),
]);

const DIFFICULTY = Object.freeze({
  1: Object.freeze({ count: 3, total: 5, prepScale: 0.55, patience: 150, preOrderDrain: 0 }),
  2: Object.freeze({ count: 4, total: 7, prepScale: 0.85, patience: 140, preOrderDrain: 0.12 }),
  3: Object.freeze({ count: 5, total: 11, prepScale: 1.3, patience: 130, preOrderDrain: 0.2 }),
});

const CUSTOMER_TINTS = Object.freeze([0xff7d63, 0x54b8ff, 0xb36bff, 0x4bd596, 0xffcf45]);
const CUSTOMER_MODELS = Object.freeze(['e', 'f', 'i', 'm', 'q']);
const RESTAURANT_SIGN_TEXT = 'MATSUBARA RESTAURANT';

/** Restaurant minigame controller for the frozen shell interface. */
export function createRestaurant(ctx) {
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
  let host = null;
  let rivalCharacter = null;
  let rivalCarryAnchor = null;
  let rivalCarriedDish = null;
  let conveyor = null;
  let conveyorSurface = null;
  let dishReturnAnchor = null;
  let signAnchor = null;
  let overlay = null;
  let style = null;
  let instruction = null;
  let actionButton = null;
  let notice = null;
  let temperature = null;
  let comboPop = null;
  let phasePill = null;
  let progressText = null;
  let scoreText = null;
  let canvas = null;
  let autoTarget = null;
  let active = false;
  let completed = false;
  let finishCalled = false;
  let phase = 'service';
  let difficulty = 1;
  let elapsed = 0;
  let serviceElapsed = 0;
  let serviceDirector = null;
  let claimRegistry = null;
  let rival = null;
  let directorPhase = 'warmup';
  let shiftTotal = 0;
  let focusReleasedAgo = Infinity;
  let speechCooldown = 0;
  let noticeRemaining = 0;
  let dialogueRemaining = 0;
  let roundEndRemaining = -1;
  let finishRemaining = -1;
  let questionCustomer = null;
  let dialogueCustomer = null;
  let carried = null;
  let actionType = '';
  let actionCustomer = null;
  let actionDish = null;
  let instructionText = '';
  let temperatureText = '';
  let listenAgain = null;
  let listenCustomer = null;
  let acceptedAnswer = null;
  let unsubscribeSettings = null;
  let combo = 0;
  let comboRemaining = 0;
  let phasePillRemaining = 0;
  let clickQuestionCustomer = null;
  let questionCommitted = false;
  let debugRootCreated = false;

  const customers = [];
  const dishes = [];
  const beltSlats = [];
  const records = [];
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  const move = new THREE.Vector2();
  const bubblePosition = new THREE.Vector3();
  const worldPoint = new THREE.Vector3();
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const steerAim = new THREE.Vector2();
  const rivalSteerAim = new THREE.Vector2();
  const focus = createSpeechFocus();
  const directorTableView = TABLES.map(() => ({ occupied: false, customer: null }));
  const directorCustomerView = [];
  const directorView = {
    tables: directorTableView,
    customers: directorCustomerView,
    liveOrders: 0,
    focusReleasedAgo: Infinity,
    progress: { done: 0 },
  };
  const rivalCustomerView = [];
  const rivalView = { customers: rivalCustomerView, focusReleasedAgo: Infinity };
  const rivalWalk = {
    active: false,
    delayRemaining: 0,
    durationRemaining: 0,
    targetX: RIVAL_START_POSITION.x,
    targetZ: RIVAL_START_POSITION.z,
  };
  let sharedDish = null;
  let customerVisuals = null;
  let rivalAnimation = '';

  const ownGeometry = (geometry) => {
    geometries.add(geometry);
    return geometry;
  };
  const ownMaterial = (material) => {
    materials.add(material);
    return material;
  };
  const ownTexture = (texture) => {
    textures.add(texture);
    return texture;
  };
  const makeMaterial = (color, options = {}) => ownMaterial(new THREE.MeshStandardMaterial({
    color,
    flatShading: true,
    roughness: 0.82,
    ...options,
  }));

  function addPart(parent, geometry, material, x, y, z, sx = 1, sy = 1, sz = 1) {
    const part = new THREE.Mesh(geometry, material);
    part.position.set(x, y, z);
    part.scale.set(sx, sy, sz);
    parent.add(part);
    return part;
  }

  function setInstruction(text) {
    if (!instruction || instructionText === text) return;
    instructionText = text;
    instruction.textContent = text;
  }

  function setNotice(text, seconds = 1.8) {
    if (!notice) return;
    notice.textContent = text;
    notice.hidden = false;
    noticeRemaining = seconds;
  }

  function hideAction() {
    actionType = '';
    actionCustomer = null;
    actionDish = null;
    if (actionButton) actionButton.hidden = true;
  }

  function showAction(text, type, target = null) {
    actionType = type;
    actionCustomer = type === 'deliver' ? target : null;
    actionDish = type === 'collect' ? target : null;
    actionButton.textContent = text;
    actionButton.hidden = false;
  }

  function createOverlay() {
    style = document.createElement('style');
    style.textContent = `
      .restaurant-ui { position: absolute; inset: 0; pointer-events: none; }
      .restaurant-ui__notice { position: absolute; top: 1rem; left: 50%; transform: translateX(-50%);
        max-width: min(72vw, 28rem); padding: .7rem 1.1rem; border: .22rem solid #fff;
        border-radius: 999px; background: #ef5b47; color: #fff; box-shadow: 0 .35rem 0 rgb(35 49 71 / .28);
        font: 900 calc(1.15rem * var(--ui-scale, 1)) system-ui, sans-serif; text-align: center; }
      .restaurant-ui__action { position: absolute; left: 50%; bottom: 1.25rem; transform: translateX(-50%);
        min-width: min(82vw, 20rem); min-height: 4rem; padding: .75rem 1.2rem; pointer-events: auto;
        border: .25rem solid #fff; border-radius: 1.4rem; background: #3a86ff; color: #fff;
        box-shadow: 0 .38rem 0 rgb(32 49 75 / .3); font: 900 calc(1.15rem * var(--ui-scale, 1)) system-ui, sans-serif; }
      .restaurant-ui__temperature { position: absolute; right: 1rem; bottom: 1.25rem;
        padding: .65rem 1rem; border: .2rem solid #fff; border-radius: 999px; background: #f28738;
        color: #fff; box-shadow: 0 .3rem 0 rgb(32 49 75 / .25);
        font: 900 calc(1rem * var(--ui-scale, 1)) system-ui, sans-serif; }
      .restaurant-ui__combo { position: absolute; left: 50%; top: 31%; transform: translateX(-50%) rotate(-4deg);
        color: #ffd43b; -webkit-text-stroke: .13rem #55380b; filter: drop-shadow(0 .3rem 0 #fff);
        font: 1000 calc(clamp(1.8rem, 4vw, 3rem) * var(--ui-scale, 1)) system-ui, sans-serif; }
      .restaurant-ui__phase { position: absolute; left: 50%; top: 5.25rem; transform: translateX(-50%);
        padding: .38rem .85rem; border: .16rem solid #fff; border-radius: 999px;
        background: #ef8a17; color: #fff; box-shadow: 0 .22rem 0 rgb(35 49 71 / .24);
        font: 900 calc(.92rem * var(--ui-scale, 1)) system-ui, sans-serif; }
      .restaurant-ui__progress { display: inline-block; margin-top: .38rem; padding: .28rem .62rem;
        border-radius: 999px; background: #273858; color: #fff;
        font: 800 calc(.88rem * var(--ui-scale, 1)) system-ui, sans-serif; }
      .restaurant-ui__score { position: absolute; right: 1rem; top: 5rem; padding: .48rem .8rem;
        border: .18rem solid #fff; border-radius: 999px; background: #315d92; color: #fff;
        box-shadow: 0 .25rem 0 rgb(35 49 71 / .24);
        font: 900 calc(.92rem * var(--ui-scale, 1)) system-ui, sans-serif; }
      .restaurant-ui__score--result { padding: .7rem 1.2rem; background: #273858;
        font-size: calc(1.25rem * var(--ui-scale, 1)); }
      @media (max-width: 44rem) { .restaurant-ui__temperature { right: 50%; bottom: 5.9rem; transform: translateX(50%); } }
    `;
    document.head.append(style);

    overlay = document.createElement('div');
    overlay.className = 'restaurant-ui';
    overlay.innerHTML = `
      <div class="top-bar">
        <section class="scene-card"><h1></h1><p></p><div class="restaurant-ui__progress" role="status"></div></section>
      </div>
      <div class="restaurant-ui__notice" role="status" aria-live="polite" hidden></div>
      <div class="restaurant-ui__combo" role="status" aria-live="polite" hidden></div>
      <div class="restaurant-ui__phase" role="status" aria-live="polite" hidden></div>
      <div class="restaurant-ui__score" role="status" aria-live="polite" hidden></div>
      <button class="restaurant-ui__action" type="button" hidden></button>
      <div class="restaurant-ui__temperature" role="status" hidden></div>
    `;
    overlay.querySelector('h1').textContent = STRINGS.roomName;
    instruction = overlay.querySelector('p');
    actionButton = overlay.querySelector('.restaurant-ui__action');
    notice = overlay.querySelector('.restaurant-ui__notice');
    comboPop = overlay.querySelector('.restaurant-ui__combo');
    phasePill = overlay.querySelector('.restaurant-ui__phase');
    progressText = overlay.querySelector('.restaurant-ui__progress');
    scoreText = overlay.querySelector('.restaurant-ui__score');
    temperature = overlay.querySelector('.restaurant-ui__temperature');
    actionButton.addEventListener('click', performAction);
    listenAgain = createListenAgain({ root: overlay, label: UI.listenAgain, onPress: listenAgainPressed });
    document.querySelector('#ui-layer').append(overlay);
    setInstruction(STRINGS.walkToCustomer);
    progressText.textContent = formatUi(STRINGS.progress, { done: 0, total: shiftTotal });
  }

  function createDish(food, shared) {
    const dish = new THREE.Group();
    dish.name = `restaurant-dish-${food}`;
    addPart(dish, shared.plateGeometry, shared.plateMaterial, 0, 0, 0, 1, 1, 1);

    if (food === 'curry') {
      addPart(dish, shared.sphereGeometry, shared.riceMaterial, -0.2, 0.16, 0, 0.28, 0.16, 0.28);
      addPart(dish, shared.sphereGeometry, shared.curryMaterial, 0.18, 0.15, 0, 0.32, 0.13, 0.28);
    } else if (food === 'pizza') {
      const slice = addPart(dish, shared.pizzaGeometry, shared.pizzaMaterial, 0, 0.17, 0, 1, 1, 1.18);
      slice.rotation.y = Math.PI / 6;
      addPart(dish, shared.pepperoniGeometry, shared.tomatoMaterial, -0.1, 0.25, 0.05, 1, 1, 1);
    } else if (food === 'hamburger') {
      addPart(dish, shared.bunGeometry, shared.bunMaterial, 0, 0.2, 0, 1, 0.5, 1);
      addPart(dish, shared.pattyGeometry, shared.pattyMaterial, 0, 0.25, 0, 1, 1, 1);
      addPart(dish, shared.cheeseGeometry, shared.cheeseMaterial, 0, 0.31, 0, 1, 1, 1);
      addPart(dish, shared.bunGeometry, shared.bunMaterial, 0, 0.4, 0, 1, 0.65, 1);
    } else if (food === 'noodles') {
      addPart(dish, shared.bowlGeometry, shared.bowlMaterial, 0, 0.2, 0, 1, 1, 1);
      for (let index = 0; index < 3; index += 1) {
        const noodle = addPart(
          dish,
          shared.noodleGeometry,
          shared.noodleMaterial,
          0,
          0.36 + index * 0.035,
          0,
          0.8 - index * 0.12,
          0.8 - index * 0.12,
          0.8 - index * 0.12,
        );
        noodle.rotation.x = Math.PI / 2;
      }
    } else {
      for (let index = -1; index <= 1; index += 1) {
        addPart(dish, shared.sushiGeometry, shared.seaweedMaterial, index * 0.3, 0.24, 0, 1, 1, 1);
        addPart(dish, shared.sushiTopGeometry, shared.salmonMaterial, index * 0.3, 0.4, 0, 1, 1, 1);
      }
    }

    dish.userData.steam = [];
    for (let index = 0; index < 3; index += 1) {
      const puff = addPart(dish, shared.steamGeometry, shared.steamMaterial, (index - 1) * 0.17, 0.67, 0, 1, 1, 1);
      puff.visible = false;
      dish.userData.steam.push(puff);
    }
    dish.visible = false;
    world.add(dish);
    return dish;
  }

  function buildRestaurantSign() {
    const signCanvas = document.createElement('canvas');
    signCanvas.width = 1024;
    signCanvas.height = 160;
    const context = signCanvas.getContext('2d');
    context.clearRect(0, 0, signCanvas.width, signCanvas.height);
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    // Fit the text to the canvas: the fallback font is wider than Arial Narrow.
    let fontSize = 76;
    context.font = `900 ${fontSize}px Arial Narrow, Arial, sans-serif`;
    while (fontSize > 32 && context.measureText(RESTAURANT_SIGN_TEXT).width > signCanvas.width - 64) {
      fontSize -= 2;
      context.font = `900 ${fontSize}px Arial Narrow, Arial, sans-serif`;
    }
    context.lineJoin = 'round';
    context.strokeStyle = 'rgba(39, 56, 88, .48)';
    context.lineWidth = 13;
    context.strokeText(RESTAURANT_SIGN_TEXT, 518, 86);
    context.strokeStyle = '#fff7dd';
    context.lineWidth = 5;
    context.strokeText(RESTAURANT_SIGN_TEXT, 512, 78);
    context.fillStyle = '#273858';
    context.fillText(RESTAURANT_SIGN_TEXT, 512, 78);

    const texture = ownTexture(new THREE.CanvasTexture(signCanvas));
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    const material = ownMaterial(new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
    }));
    const letters = new THREE.Mesh(ownGeometry(new THREE.PlaneGeometry(7.15, 1.12)), material);
    signAnchor = new THREE.Group();
    signAnchor.name = 'matsubara-restaurant-sign';
    signAnchor.position.set(0, 3.62, -7.14);
    signAnchor.add(letters);
    world.add(signAnchor);
  }

  function buildWorld() {
    world = new THREE.Group();
    world.name = 'restaurant-minigame';
    scene.background = new THREE.Color(0xffc985);
    scene.fog = null;

    world.add(new THREE.HemisphereLight(0xffffff, 0xb86f55, 2.35));
    const sun = new THREE.DirectionalLight(0xffffff, 2.15);
    sun.position.set(7, 11, 8);
    world.add(sun);

    const box = ownGeometry(new THREE.BoxGeometry(1, 1, 1));
    const cylinder = ownGeometry(new THREE.CylinderGeometry(0.5, 0.5, 1, 16));
    const floorMaterial = makeMaterial(0xffe0a3);
    const wallMaterial = makeMaterial(0xf47f6b);
    const trimMaterial = makeMaterial(0x4db7ba);
    const woodMaterial = makeMaterial(0xd98b43);
    const chairMaterial = makeMaterial(0x55a8cf);
    const metalMaterial = makeMaterial(0xc8d5d8, { metalness: 0.55, roughness: 0.42 });
    const darkMetalMaterial = makeMaterial(0x52636b, { metalness: 0.4, roughness: 0.5 });
    const beltMaterial = makeMaterial(0x202b33, { roughness: 0.72 });
    const beltSlatMaterial = makeMaterial(0x65757c, { metalness: 0.35, roughness: 0.5 });
    const recessMaterial = makeMaterial(0x17232c, { roughness: 0.95 });
    const kitchenLightMaterial = makeMaterial(0xffe9a8, { emissive: 0xffc85b, emissiveIntensity: 0.8 });
    const returnMaterial = makeMaterial(0x4d9da5, { metalness: 0.18 });

    addPart(world, box, floorMaterial, 0, -0.25, 0, 14, 0.5, 15);
    addPart(world, box, wallMaterial, 0, 2.35, -7.35, 14, 5.2, 0.35);
    addPart(world, box, wallMaterial, -6.85, 1.25, 0, 0.3, 3, 15);
    addPart(world, box, wallMaterial, 6.85, 1.25, 0, 0.3, 3, 15);
    addPart(world, box, trimMaterial, 0, 0.25, -7.08, 13.7, 0.35, 0.18);

    conveyorSurface = addPart(world, box, beltMaterial, 0, 1.03, BELT_CENTER_Z, 15.6, 0.14, 1.2);
    conveyorSurface.name = 'restaurant-conveyor-surface';
    conveyorSurface.userData.restaurantTarget = { type: 'belt' };
    addPart(world, box, darkMetalMaterial, 0, 0.65, BELT_CENTER_Z, 15.7, 0.68, 1.08);
    addPart(world, box, metalMaterial, 0, 1.22, BELT_CENTER_Z - 0.66, 15.8, 0.2, 0.12);
    addPart(world, box, metalMaterial, 0, 1.22, BELT_CENTER_Z + 0.66, 15.8, 0.2, 0.12);
    for (const x of [-5.6, -2.8, 0, 2.8, 5.6]) {
      addPart(world, box, darkMetalMaterial, x, 0.3, BELT_CENTER_Z, 0.24, 0.72, 0.86);
    }
    const slatCount = 25;
    for (let index = 0; index < slatCount; index += 1) {
      const slat = addPart(world, box, beltSlatMaterial, 0, BELT_TOP_Y + 0.015, BELT_CENTER_Z, 0.055, 0.025, 0.96);
      slat.userData.beltIndex = index;
      slat.userData.beltCount = slatCount;
      slat.userData.restaurantTarget = { type: 'belt' };
      beltSlats.push(slat);
    }

    for (const side of [-1, 1]) {
      const x = side * 6.67;
      addPart(world, box, recessMaterial, x, 1.4, BELT_CENTER_Z, 0.08, 2.65, 2.25);
      addPart(world, box, metalMaterial, x - side * 0.035, 2.78, BELT_CENTER_Z, 0.18, 0.16, 2.5);
      addPart(world, box, metalMaterial, x - side * 0.035, 0.18, BELT_CENTER_Z, 0.18, 0.16, 2.5);
      addPart(world, box, metalMaterial, x - side * 0.035, 1.48, BELT_CENTER_Z - 1.18, 0.18, 2.45, 0.16);
      addPart(world, box, metalMaterial, x - side * 0.035, 1.48, BELT_CENTER_Z + 1.18, 0.18, 2.45, 0.16);
      addPart(world, box, kitchenLightMaterial, x - side * 0.09, 2.34, BELT_CENTER_Z, 0.05, 0.12, 1.45);
      addPart(world, box, metalMaterial, x - side * 0.1, 1.84, BELT_CENTER_Z, 0.06, 0.07, 1.42);
    }

    dishReturnAnchor = new THREE.Group();
    dishReturnAnchor.name = 'restaurant-dish-return';
    dishReturnAnchor.position.set(DISH_RETURN_POSITION.x, 0, DISH_RETURN_POSITION.z);
    addPart(dishReturnAnchor, box, darkMetalMaterial, 0, 0.48, 0, 1.45, 0.18, 1.05);
    addPart(dishReturnAnchor, box, returnMaterial, 0, 0.66, 0, 1.25, 0.16, 0.85);
    addPart(dishReturnAnchor, box, returnMaterial, -0.57, 0.91, 0, 0.12, 0.5, 0.86);
    addPart(dishReturnAnchor, box, returnMaterial, 0.57, 0.91, 0, 0.12, 0.5, 0.86);
    addPart(dishReturnAnchor, box, returnMaterial, 0, 0.91, -0.37, 1.25, 0.5, 0.12);
    addPart(dishReturnAnchor, box, returnMaterial, 0, 0.91, 0.37, 1.25, 0.5, 0.12);
    world.add(dishReturnAnchor);
    buildRestaurantSign();

    const tableTop = ownGeometry(new THREE.CylinderGeometry(1, 1, 0.18, 16));
    for (const table of TABLES) {
      addPart(world, tableTop, woodMaterial, table.x, 0.95, table.z);
      addPart(world, cylinder, woodMaterial, table.x, 0.48, table.z, 0.38, 0.85, 0.38);
      addPart(world, cylinder, woodMaterial, table.x, 0.08, table.z, 0.75, 0.12, 0.75);
      addPart(world, box, chairMaterial, table.seatX, 0.47, table.seatZ, 0.9, 0.16, 0.82);
      // Backrest behind the seated customer, not between them and their table.
      addPart(world, box, chairMaterial, table.seatX, 1.05, table.seatZ - 0.35, 0.9, 1.05, 0.15);
      addPart(world, box, chairMaterial, table.x, 0.47, table.z + 1.25, 0.9, 0.16, 0.82);
      addPart(world, box, chairMaterial, table.x, 1.05, table.z + 1.62, 0.9, 1.05, 0.15);
    }

    sharedDish = {
      plateGeometry: ownGeometry(new THREE.CylinderGeometry(0.58, 0.58, 0.08, 20)),
      plateMaterial: makeMaterial(0xf7fbff),
      sphereGeometry: ownGeometry(new THREE.SphereGeometry(1, 12, 8)),
      // Japanese curry: dark brown roux beside white rice. The earlier light
      // orange on cream read as an omelette, and the child has to recognise
      // which food they are carrying.
      riceMaterial: makeMaterial(0xfffdf6),
      curryMaterial: makeMaterial(0x8a4a1c),
      pizzaGeometry: ownGeometry(new THREE.CylinderGeometry(0.48, 0.48, 0.11, 3)),
      pizzaMaterial: makeMaterial(0xf3b941),
      pepperoniGeometry: ownGeometry(new THREE.CylinderGeometry(0.08, 0.08, 0.025, 10)),
      tomatoMaterial: makeMaterial(0xd9443f),
      bunGeometry: ownGeometry(new THREE.SphereGeometry(0.42, 14, 8)),
      bunMaterial: makeMaterial(0xe7a64b),
      pattyGeometry: ownGeometry(new THREE.CylinderGeometry(0.4, 0.4, 0.12, 14)),
      pattyMaterial: makeMaterial(0x633821),
      cheeseGeometry: ownGeometry(new THREE.BoxGeometry(0.62, 0.035, 0.62)),
      cheeseMaterial: makeMaterial(0xffd532),
      bowlGeometry: ownGeometry(new THREE.CylinderGeometry(0.48, 0.3, 0.32, 16)),
      bowlMaterial: makeMaterial(0xe9534f),
      noodleGeometry: ownGeometry(new THREE.TorusGeometry(0.37, 0.035, 5, 18)),
      noodleMaterial: makeMaterial(0xffd96b),
      sushiGeometry: ownGeometry(new THREE.CylinderGeometry(0.15, 0.15, 0.3, 12)),
      sushiTopGeometry: ownGeometry(new THREE.CylinderGeometry(0.11, 0.11, 0.025, 12)),
      seaweedMaterial: makeMaterial(0x183f37),
      salmonMaterial: makeMaterial(0xff7e73),
      steamGeometry: ownGeometry(new THREE.SphereGeometry(0.055, 7, 5)),
      steamMaterial: makeMaterial(0xffffff, { transparent: true, opacity: 0.65 }),
    };

    player = characters.create({ model: characters.playerModel });
    player.position.set(0, 0, 5.7);
    player.scale.setScalar(0.82);
    carryAnchor = new THREE.Group();
    carryAnchor.position.set(0, 1.45, 0.58);
    player.add(carryAnchor);
    world.add(player);

    host = characters.create({ model: 'j', tint: 0xffc56d });
    host.position.set(HOST_TURNAROUND_POSITION.x, 0, HOST_TURNAROUND_POSITION.z);
    host.rotation.y = 0;
    host.scale.setScalar(0.82);

    if (RIVAL_LEVELS[difficulty]?.enabled) {
      rivalCharacter = characters.create({ model: 'r', tint: 0x4b78c5 });
      rivalCharacter.position.set(RIVAL_START_POSITION.x, 0, RIVAL_START_POSITION.z);
      rivalCharacter.rotation.y = Math.PI;
      rivalCharacter.scale.setScalar(0.78);
      // A bright apron is readable even when the textured character ignores
      // tint, and keeps this waiter distinct from every seated customer.
      // White, not navy: the dark model plus a navy apron read as one more customer.
      const apronMaterial = makeMaterial(0xffffff, { emissive: 0x333333 });
      addPart(rivalCharacter, box, apronMaterial, 0, 1.06, 0.28, 0.56, 0.64, 0.08);
      // The apron ties round the waist: the rival mostly walks away from the
      // fixed camera, and from behind the front panel alone read as a dark customer.
      addPart(rivalCharacter, box, apronMaterial, 0, 1.2, 0, 0.62, 0.14, 0.62);
      rivalCarryAnchor = new THREE.Group();
      rivalCarryAnchor.position.set(0, 1.42, 0.58);
      rivalCharacter.add(rivalCarryAnchor);
      world.add(rivalCharacter);
    }

    const hitGeometry = ownGeometry(new THREE.BoxGeometry(1.2, 2.1, 0.8));
    const hitMaterial = makeMaterial(0xffffff, { transparent: true, opacity: 0, depthWrite: false });
    function createOwnershipMaterial({ fill, text, outline }) {
      const bubbleCanvas = document.createElement('canvas');
      bubbleCanvas.width = 512;
      bubbleCanvas.height = 256;
      const context = bubbleCanvas.getContext('2d');
      context.fillStyle = fill;
      context.strokeStyle = outline;
      context.lineWidth = 14;
      context.lineJoin = 'round';
      context.beginPath();
      context.roundRect(14, 14, 484, 190, 48);
      context.moveTo(212, 203);
      context.lineTo(256, 244);
      context.lineTo(300, 203);
      context.closePath();
      context.fill();
      context.stroke();
      context.fillStyle = text;
      context.font = '900 92px system-ui, sans-serif';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(OWNERSHIP_BUBBLE_TEXT, 256, 112);
      const texture = ownTexture(new THREE.CanvasTexture(bubbleCanvas));
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 4;
      // Not tone mapped: the player's bubble must read as true white, not the
      // pale grey the scene's tone mapping made of it beside the dark rival one.
      return ownMaterial(new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }));
    }

    const playerBubbleMaterial = createOwnershipMaterial({
      fill: '#ffffff', text: '#1b2940', outline: '#273858',
    });
    const rivalBubbleMaterial = createOwnershipMaterial({
      fill: '#1b2233', text: '#ffffff', outline: '#ffffff',
    });
    customerVisuals = {
      hitGeometry,
      hitMaterial,
      playerBubbleMaterial,
      rivalBubbleMaterial,
    };

    scene.add(world);
    // The whole dining room at once, not a camera that follows the waiter. With
    // the follow camera the front tables slid off the bottom edge whenever the
    // child stood at the back service wall, so a customer could be asking for service
    // from off-screen — fatal for a game whose mechanic is choosing who to serve
    // next. The room is small enough to frame entirely, so it is.
    cameraRig
      .setTarget(player)
      .setPreset('fixed', { position: [0, 11.5, 12], lookAt: [0, 0.8, 0.6], damping: 5 });
  }

  function beginFocus(reason) {
    focus.begin(reason);
    focusReleasedAgo = 0;
    audio.setFocusDuck(true);
  }

  function endFocus() {
    focus.end();
    focusReleasedAgo = 0;
    audio.setFocusDuck(false);
  }

  function cancelFocus() {
    focus.cancel();
    focusReleasedAgo = Infinity;
    audio.setFocusDuck(false);
  }

  function appearanceFor(index) {
    return {
      model: CUSTOMER_MODELS[index % CUSTOMER_MODELS.length],
      tint: CUSTOMER_TINTS[(index + Math.floor(index / CUSTOMER_MODELS.length)) % CUSTOMER_TINTS.length],
    };
  }

  function setRivalApproach(position, table) {
    const side = table.x < -0.1 ? 1 : -1;
    position.x = table.x + side * 1.55;
    position.z = table.z;
    return position;
  }

  function createCustomer(index, tableIndex, food) {
    const configured = DIFFICULTY[difficulty];
    const table = TABLES[tableIndex];
    const appearance = appearanceFor(index);
    const character = characters.create(appearance);
    character.position.set(0, 0, 6.7);
    character.rotation.y = Math.PI;
    character.scale.setScalar(0.72);
    character.playAnimation?.('walk');
    world.add(character);

    const clickTarget = new THREE.Mesh(customerVisuals.hitGeometry, customerVisuals.hitMaterial);
    clickTarget.position.set(0, 1.05, 0);
    character.add(clickTarget);

    const ownership = new THREE.Sprite(customerVisuals.playerBubbleMaterial);
    ownership.scale.set(2.0, 1.0, 1);
    ownership.visible = false;
    ownership.renderOrder = 1000;
    world.add(ownership);

    const customer = {
      id: index,
      index,
      tableIndex,
      table,
      food,
      listenedAgain: false,
      owner: null,
      reservation: null,
      state: 'walkingIn',
      outcome: null,
      recorded: false,
      prepDuration: (FOOD_PREP_SECONDS[food] ?? 8) * configured.prepScale,
      prepRemaining: 0,
      readyFired: false,
      patienceMax: configured.patience,
      patience: configured.patience,
      character,
      clickTarget,
      ownership,
      refusalRemaining: 0,
      eatingRemaining: 0,
      walkStage: 0,
      rivalApproach: setRivalApproach({ x: 0, z: 0 }, table),
    };
    clickTarget.userData.restaurantTarget = { type: 'customer', value: customer };

    customers.push(customer);
    claimRegistry?.registerCustomer({
      id: customer.id,
      food: customer.food,
      position: customer.rivalApproach,
    });
    return customer;
  }

  function showPhaseCue(nextPhase) {
    if (!phasePill || nextPhase === 'warmup') return;
    phasePill.textContent = nextPhase === 'rush' ? STRINGS.rush : STRINGS.finalPush;
    phasePill.hidden = false;
    phasePillRemaining = 2.2;
    audio.playSfx('restaurant-phase', { frequency: 620, endFrequency: 920, duration: 0.16, gain: 0.1 });
  }

  function updateProgress() {
    const done = claimRegistry?.progress.done ?? records.length;
    if (progressText) progressText.textContent = formatUi(STRINGS.progress, { done, total: shiftTotal });
  }

  function updateChallengeScore() {
    if (!scoreText || !claimRegistry) return;
    const counts = claimRegistry.counts;
    scoreText.textContent = formatUi(STRINGS.rivalScore, {
      player: counts.playerServed,
      rival: counts.rivalServed,
    });
    scoreText.hidden = false;
  }

  function releasePlayerReservation(customer) {
    if (!customer || customer.reservation !== RESTAURANT_OWNERS.PLAYER) return;
    claimRegistry?.releasePlayerReservation(customer.id);
    customer.reservation = null;
  }

  function reservePlayerCustomer(customer) {
    if (!isTalkable(customer)) return false;
    if (customer.reservation === RESTAURANT_OWNERS.PLAYER) return true;
    if (claimRegistry && !claimRegistry.reservePlayer(customer.id)) return false;
    for (const other of customers) {
      if (other !== customer) other.reservation = null;
    }
    customer.reservation = RESTAURANT_OWNERS.PLAYER;
    return true;
  }

  function clearQuestion(keepHud = false) {
    if (!questionCustomer) return;
    const endedCustomer = questionCustomer;
    questionCustomer = null;
    if (clickQuestionCustomer === endedCustomer) clickQuestionCustomer = null;
    releasePlayerReservation(endedCustomer);
    if (questionCommitted) endFocus();
    questionCommitted = false;
    speech.cancel();
    speech.clearTarget();
    if (!keepHud) hud.hide();
  }

  function cancelQuestion(customer) {
    if (!customer || questionCustomer !== customer || !questionCommitted) return;
    questionCommitted = false;
    releasePlayerReservation(customer);
    endFocus();
  }

  function showCustomerAnswer(customer) {
    const text = answerFor(LESSON, customer.food);
    dialogueCustomer = customer;
    dialogueRemaining = 2.5;
    customer.ownership.visible = false;
    dialogue.show({ text, anchor: customer.character, offsetY: 1.65 });
  }

  function refreshOwnership(customer) {
    const bubble = ownershipBubble(customer, {
      dialogueOnCustomer: dialogueCustomer === customer && dialogueRemaining > 0,
    });
    customer.ownership.visible = customer.character.visible && bubble !== null;
    if (!bubble) return;
    customer.ownership.material = bubble.kind === RESTAURANT_OWNERS.PLAYER
      ? customerVisuals.playerBubbleMaterial
      : customerVisuals.rivalBubbleMaterial;
    customer.character.getWorldPosition(bubblePosition);
    customer.ownership.position.copy(bubblePosition);
    customer.ownership.position.y += 2.25;
    customer.ownership.quaternion.copy(camera.quaternion);
  }

  function acceptQuestion(customer) {
    if (!active || phase !== 'service' || !isTalkable(customer)
      || questionCustomer !== customer || !questionCommitted) return;
    if (claimRegistry && !claimRegistry.commitPlayer(customer.id)) {
      clearQuestion();
      return;
    }
    customer.owner = RESTAURANT_OWNERS.PLAYER;
    customer.reservation = null;
    clearQuestion(true);
    hud.setTalkState('accepted');
    speechCooldown = 0.6;
    customer.state = 'awaiting';
    customer.prepRemaining = customer.prepDuration;
    customer.readyFired = false;
    customer.character.playAnimation?.('emote-yes');
    audio.playSfx('accept');
    showCustomerAnswer(customer);
    setInstruction(STRINGS.orderTaken);
  }

  function targetQuestion(customer) {
    if (questionCustomer === customer || speechCooldown > 0 || phase !== 'service'
      || questionCommitted || !isTalkable(customer)) return;
    clearQuestion();
    questionCustomer = customer;
    promptQuestion(ctx, LESSON, {
      isActive: () => active,
      onCommit: () => commitQuestion(customer),
      onCancel: () => cancelQuestion(customer),
      onAccepted: () => acceptQuestion(customer),
    });
    setInstruction(STRINGS.instruction);
  }

  // Returns false when the press must not open the microphone: the reservation
  // is made before recognition starts, so a refused customer never hears a mic.
  function commitQuestion(customer) {
    if (!customer || questionCustomer !== customer || !isTalkable(customer)) return false;
    if (questionCommitted) return true;
    if (!reservePlayerCustomer(customer)) {
      clearQuestion();
      return false;
    }
    questionCommitted = true;
    beginFocus('restaurant-order');
    audio.playSfx('restaurant-talk-ready', { frequency: 660, endFrequency: 880, duration: 0.14, gain: 0.09 });
    return true;
  }

  function createBeltDish(snapshotDish) {
    const mesh = createDish(snapshotDish.food, sharedDish);
    const dish = {
      id: snapshotDish.id,
      customerId: null,
      food: snapshotDish.food,
      state: 'belt',
      carrySeconds: 0,
      firstTry: true,
      mesh,
    };
    mesh.userData.restaurantTarget = { type: 'dish', value: dish };
    dishes.push(dish);
    return dish;
  }

  function removePhysicalDish(dish, state = 'discarded') {
    if (!dish) return;
    carryAnchor?.remove(dish.mesh);
    world?.remove(dish.mesh);
    dish.mesh.visible = false;
    dish.state = state;
    const index = dishes.indexOf(dish);
    if (index >= 0) dishes.splice(index, 1);
  }

  function beltDishFor(id) {
    return dishes.find((dish) => dish.id === id && dish.state === 'belt') ?? null;
  }

  function updateBeltSlats(snapshot) {
    const span = 15.6;
    for (let index = 0; index < beltSlats.length; index += 1) {
      const phase = ((index * span / beltSlats.length)
        + snapshot.direction * snapshot.beltTravel) % span;
      beltSlats[index].position.x = -span / 2 + ((phase + span) % span);
    }
  }

  function updateConveyor(serviceDt) {
    if (!conveyor) return;
    // The belt is order-blind (SPEC §4): nothing about orders reaches it.
    const events = conveyor.advance(serviceDt);
    for (const event of events) {
      if (event.type === 'enter') createBeltDish(event.dish);
      else if (event.type === 'exit') removePhysicalDish(beltDishFor(event.dish.id), 'exited');
    }

    const snapshot = conveyor.snapshot();
    updateBeltSlats(snapshot);
    for (const snapshotDish of snapshot.dishes) {
      const dish = beltDishFor(snapshotDish.id);
      if (!dish) continue;
      dish.mesh.position.set(snapshotDish.x, BELT_TOP_Y + 0.13, BELT_CENTER_Z);
      dish.mesh.rotation.set(0, 0, 0);
      dish.mesh.scale.setScalar(0.82);
      dish.mesh.visible = Math.abs(snapshotDish.x) < WALL_HALF_WIDTH;
    }
  }

  function temperatureScoreFor(seconds) {
    if (seconds <= HOT_SECONDS) return 3;
    if (seconds <= WARM_SECONDS) return 2;
    return 1;
  }

  function temperatureLabelFor(score) {
    if (score === 3) return STRINGS.tempHot;
    if (score === 2) return STRINGS.tempWarm;
    return STRINGS.tempCold;
  }

  function collectDish(dishOrId, fallbackToNearest = false) {
    if (carried || !conveyor) return;
    const requestedId = typeof dishOrId === 'object' ? dishOrId?.id : dishOrId;
    const requested = conveyor.snapshot().dishes.find((dish) => dish.id === requestedId);
    let picked = requested && Math.abs(requested.x - player.position.x) <= BELT_ARRIVAL_WINDOW
      ? conveyor.take(requestedId)
      : null;
    if (!picked && fallbackToNearest) {
      const nearest = conveyor.nearestPickable(player.position.x, BELT_ARRIVAL_WINDOW);
      if (nearest) picked = conveyor.take(nearest.id);
    }
    if (!picked) return;
    const dish = beltDishFor(picked.id);
    if (!dish) return;
    dish.state = 'carried';
    dish.carrySeconds = 0;
    carried = dish;
    world.remove(dish.mesh);
    carryAnchor.add(dish.mesh);
    dish.mesh.position.set(0, 0, 0);
    dish.mesh.rotation.set(0, 0, 0);
    dish.mesh.scale.setScalar(0.88);
    for (const puff of dish.mesh.userData.steam) puff.visible = true;
    audio.playSfx('interact');
    hideAction();
    setInstruction(STRINGS.walkToDeliver);
  }

  function returnCarriedDish() {
    if (!carried) return;
    const returned = carried;
    carried = null;
    removePhysicalDish(returned, 'returned');
    temperature.hidden = true;
    temperatureText = '';
    hideAction();
    audio.playSfx('interact');
  }

  // Hearing the order again is listening support, not failure: it forfeits only
  // this customer's memory bonus and never costs normal credit (SPEC 3).
  function remind(customer) {
    if (!canBeReminded(customer.state)) return;
    customer.listenedAgain = true;
    audio.playSfx('interact');
    customer.character.playAnimation?.('emote-yes');
    showCustomerAnswer(customer);
  }

  function setListenTarget(customer) {
    listenCustomer = customer;
    if (customer) listenAgain?.show();
    else listenAgain?.hide();
  }

  function listenAgainPressed() {
    if (active && phase === 'service' && listenCustomer) remind(listenCustomer);
  }

  function deliver(customer) {
    if (!carried || customer.owner !== RESTAURANT_OWNERS.PLAYER
      || customer.state !== 'awaiting'
      || customer.refusalRemaining > 0) return;
    if (carried.food !== customer.food) {
      carried.firstTry = false;
      combo = 0;
      comboRemaining = 0;
      if (comboPop) comboPop.hidden = true;
      customer.refusalRemaining = REFUSAL_SECONDS;
      autoTarget = null;
      audio.playSfx('retry');
      dialogueCustomer = customer;
      dialogueRemaining = 1.8;
      dialogue.show({ text: STRINGS.wrongDish, anchor: customer.character, offsetY: 1.65, speak: false });
      setInstruction(STRINGS.thinkAgain);
      return;
    }

    const temperatureScore = temperatureScoreFor(carried.carrySeconds);
    const temperatureLabel = temperatureLabelFor(temperatureScore);
    const firstTry = carried.firstTry;
    records.push({
      index: customer.id,
      table: customer.tableIndex,
      delivered: true,
      firstTry,
      temperatureScore,
      patienceAtDelivery: customer.patience / customer.patienceMax,
      listenedAgain: customer.listenedAgain,
    });
    claimRegistry?.resolveCustomer(customer.id, { outcome: 'served' });
    customer.recorded = true;
    customer.outcome = 'delivered';
    customer.state = 'eating';
    customer.ownership.visible = false;
    customer.eatingRemaining = EATING_SECONDS;
    carryAnchor.remove(carried.mesh);
    world.add(carried.mesh);
    carried.mesh.position.set(customer.table.x, 1.13, customer.table.z);
    carried.mesh.rotation.set(0, 0, 0);
    carried.mesh.scale.setScalar(0.78);
    for (const puff of carried.mesh.userData.steam) puff.visible = false;
    carried.state = 'delivered';
    customer.servedDish = carried;
    carried = null;
    temperature.hidden = true;
    temperatureText = '';
    customer.character.playAnimation?.('emote-yes');
    audio.playSfx('accept');
    dialogueCustomer = customer;
    dialogueRemaining = 1.8;
    dialogue.show({ text: STRINGS.delivered, anchor: customer.character, offsetY: 1.65, speak: false });
    setNotice(temperatureLabel, 1.8);
    if (firstTry) {
      combo += 1;
      if (combo >= 2) {
        comboPop.textContent = formatUi(STRINGS.combo, { count: combo });
        comboPop.hidden = false;
        comboRemaining = 1.45;
      }
    }
    hideAction();
    updateProgress();
    updateChallengeScore();
  }

  function leaveCustomer(customer) {
    if (!['seated', 'awaiting'].includes(customer.state)) return;
    const rivalOwned = customer.owner === RESTAURANT_OWNERS.RIVAL;
    if (questionCustomer === customer) clearQuestion();
    if (listenCustomer === customer) setListenTarget(null);
    claimRegistry?.resolveCustomer(customer.id, { outcome: 'left' });
    if (!rivalOwned) {
      records.push({
        index: customer.id,
        table: customer.tableIndex,
        delivered: false,
        firstTry: false,
        temperatureScore: 0,
        patienceAtDelivery: 0,
        listenedAgain: customer.listenedAgain,
      });
      customer.recorded = true;
    }
    customer.outcome = 'left';
    customer.state = 'leaving';
    customer.ownership.visible = false;
    customer.walkStage = 0;
    customer.character.playAnimation?.('walk');
    dialogueCustomer = customer;
    dialogueRemaining = 1.8;
    dialogue.show({ text: STRINGS.patientLeave, anchor: customer.character, offsetY: 1.65, speak: false });
    audio.playSfx('retry');
    updateProgress();
    updateChallengeScore();
  }

  function performAction() {
    if (!active || phase !== 'service') return;
    if (actionType === 'collect') {
      const nearest = conveyor?.nearestPickable(player.position.x, BELT_PICKUP_WINDOW);
      if (nearest) collectDish(nearest);
    }
    else if (actionType === 'deliver' && actionCustomer) deliver(actionCustomer);
    else if (actionType === 'return') returnCarriedDish();
  }

  function canOccupy(x, z) {
    if (x < -6.25 || x > 6.25 || z < -4.45 || z > 6.65) return false;
    for (const table of TABLES) {
      const dx = x - table.x;
      const dz = z - table.z;
      if (dx * dx + dz * dz < 1.12 * 1.12) return false;
    }
    return true;
  }

  function isSeated(state) {
    return state === 'seated' || state === 'awaiting';
  }

  function canBeReminded(state) {
    return state === 'awaiting';
  }

  function hasCustomerInState(state) {
    for (const customer of customers) {
      if (customer.state === state) return true;
    }
    return false;
  }

  function updateDirectorView() {
    for (let index = 0; index < directorTableView.length; index += 1) {
      const tableView = directorTableView[index];
      const occupant = customers.find((customer) => customer.tableIndex === index
        && customer.state !== 'delivered' && customer.state !== 'left');
      tableView.occupied = Boolean(occupant);
      tableView.customer = occupant?.id ?? null;
    }
    directorCustomerView.length = customers.length;
    let liveOrders = 0;
    for (let index = 0; index < customers.length; index += 1) {
      const customer = customers[index];
      let view = directorCustomerView[index];
      if (!view) {
        view = { id: customer.id, state: customer.state, prepRemaining: 0 };
        directorCustomerView[index] = view;
      }
      view.id = customer.id;
      const playerPreparation = customer.state === 'awaiting'
        && (!claimRegistry || customer.owner === RESTAURANT_OWNERS.PLAYER)
        && !customer.readyFired;
      view.state = playerPreparation ? 'preparing' : customer.state;
      view.prepRemaining = playerPreparation ? customer.prepRemaining : undefined;
      if (claimRegistry) {
        view.owner = customer.owner;
        view.reservedBy = customer.reservation;
      }
      if (customer.state === 'awaiting') liveOrders += 1;
    }
    directorView.liveOrders = liveOrders;
    directorView.focusReleasedAgo = focusReleasedAgo;
    directorView.progress.done = claimRegistry?.progress.done ?? records.length;
  }

  function applyDirectorEvents(serviceDt) {
    updateDirectorView();
    const events = serviceDirector.advance(serviceDt, directorView);
    for (const event of events) {
      if (event.type === 'seat') createCustomer(event.customer, event.table, event.food ?? pickFood());
      else if (event.type === 'ready' && customers[event.customer]) {
        customers[event.customer].readyFired = true;
        customers[event.customer].prepRemaining = 0;
      }
      else if (event.type === 'phase') {
        directorPhase = event.phase;
        showPhaseCue(event.phase);
      }
    }
    directorPhase = serviceDirector.phase;
  }

  function setRivalAnimation(next, instant = false) {
    if (!rivalCharacter || rivalAnimation === next) return;
    rivalAnimation = next;
    rivalCharacter.playAnimation?.(next, instant ? { fade: 0 } : undefined);
  }

  function beginRivalWalk(event) {
    if (!rivalCharacter || !event?.position) return;
    rivalWalk.active = true;
    rivalWalk.delayRemaining = Math.max(0, Number(event.delay) || 0);
    rivalWalk.durationRemaining = Math.max(0, Number(event.duration) || 0);
    rivalWalk.targetX = event.position.x;
    rivalWalk.targetZ = event.position.z;
    if (rivalWalk.durationRemaining === 0 && rivalWalk.delayRemaining === 0) {
      rivalCharacter.position.x = rivalWalk.targetX;
      rivalCharacter.position.z = rivalWalk.targetZ;
      rivalWalk.active = false;
    }
  }

  function setWalkAim(fromX, fromZ, toX, toZ, result) {
    const segX = toX - fromX;
    const segZ = toZ - fromZ;
    const lengthSq = segX * segX + segZ * segZ;
    result.set(toX, toZ);
    if (lengthSq < 1e-6) return;
    const length = Math.sqrt(lengthSq);
    let nearestAlong = Infinity;
    for (const table of TABLES) {
      const t = ((table.x - fromX) * segX + (table.z - fromZ) * segZ) / lengthSq;
      if (t <= 0 || t >= 1) continue;
      const offX = fromX + segX * t - table.x;
      const offZ = fromZ + segZ * t - table.z;
      if (offX * offX + offZ * offZ >= STEER_RADIUS * STEER_RADIUS || t >= nearestAlong) continue;
      nearestAlong = t;
      let sideX = -segZ / length;
      let sideZ = segX / length;
      if (offX * sideX + offZ * sideZ < 0) {
        sideX = -sideX;
        sideZ = -sideZ;
      }
      result.set(table.x + sideX * STEER_CLEARANCE, table.z + sideZ * STEER_CLEARANCE);
    }
  }

  function updateRivalWalk(serviceDt) {
    if (!rivalCharacter || !rivalWalk.active || serviceDt <= 0) return;
    let moveDt = serviceDt;
    if (rivalWalk.delayRemaining > 0) {
      const consumed = Math.min(moveDt, rivalWalk.delayRemaining);
      rivalWalk.delayRemaining -= consumed;
      moveDt -= consumed;
      if (moveDt <= 0) return;
    }

    const timeBefore = rivalWalk.durationRemaining;
    if (timeBefore <= moveDt) {
      rivalCharacter.position.x = rivalWalk.targetX;
      rivalCharacter.position.z = rivalWalk.targetZ;
      rivalWalk.durationRemaining = 0;
      rivalWalk.active = false;
      return;
    }

    setWalkAim(
      rivalCharacter.position.x,
      rivalCharacter.position.z,
      rivalWalk.targetX,
      rivalWalk.targetZ,
      rivalSteerAim,
    );
    const aimX = rivalSteerAim.x - rivalCharacter.position.x;
    const aimZ = rivalSteerAim.y - rivalCharacter.position.z;
    const aimDistance = Math.hypot(aimX, aimZ);
    const remainingX = rivalWalk.targetX - rivalSteerAim.x;
    const remainingZ = rivalWalk.targetZ - rivalSteerAim.y;
    const estimatedDistance = aimDistance + Math.hypot(remainingX, remainingZ);
    const requiredSpeed = estimatedDistance / timeBefore;
    const speed = THREE.MathUtils.clamp(requiredSpeed, RIVAL_MIN_SPEED, RIVAL_MAX_SPEED);
    const step = Math.min(aimDistance, speed * moveDt);
    if (aimDistance > 1e-6) {
      rivalCharacter.position.x += aimX / aimDistance * step;
      rivalCharacter.position.z += aimZ / aimDistance * step;
      rivalCharacter.rotation.y = Math.atan2(aimX, aimZ);
    }
    rivalWalk.durationRemaining = Math.max(0, timeBefore - moveDt);
  }

  function updateRivalView() {
    rivalCustomerView.length = customers.length;
    for (let index = 0; index < customers.length; index += 1) {
      const customer = customers[index];
      let view = rivalCustomerView[index];
      if (!view) {
        view = { id: customer.id, food: customer.food, position: { x: 0, z: 0 } };
        rivalCustomerView[index] = view;
      }
      view.id = customer.id;
      view.food = customer.food;
      view.position.x = customer.rivalApproach.x;
      view.position.z = customer.rivalApproach.z;
    }
    rivalView.focusReleasedAgo = focusReleasedAgo;
  }

  function discardRivalDish() {
    if (!rivalCarriedDish) return;
    rivalCarryAnchor?.remove(rivalCarriedDish.mesh);
    world.remove(rivalCarriedDish.mesh);
    rivalCarriedDish.mesh.visible = false;
    rivalCarriedDish.state = 'discarded';
    rivalCarriedDish = null;
  }

  // The pure model has already taken the dish off the belt (conveyor.take); the
  // scene moves that same dish mesh from the belt into the rival's hands, where
  // the player can no longer click or collect it.
  function giveBeltDishToRival(event) {
    discardRivalDish();
    let dish = beltDishFor(event.dishId);
    if (dish) {
      const index = dishes.indexOf(dish);
      if (index >= 0) dishes.splice(index, 1);
      world.remove(dish.mesh);
      dish.mesh.userData.restaurantTarget = null;
    } else {
      dish = { id: event.dishId, food: event.food, mesh: createDish(event.food, sharedDish) };
    }
    dish.customerId = event.customer;
    dish.state = 'carried';
    dish.mesh.visible = true;
    rivalCarryAnchor.add(dish.mesh);
    dish.mesh.position.set(0, 0, 0);
    dish.mesh.scale.setScalar(0.88);
    rivalCarriedDish = dish;
  }

  function applyRivalEvents(serviceDt) {
    if (!rival) return;
    updateRivalView();
    const events = rival.advance(serviceDt, rivalView);
    for (const event of events) {
      const customer = customers[event.customer];
      if (event.type === 'targetCustomer'
        || event.type === 'targetDish'
        || event.type === 'deliverToCustomer') {
        beginRivalWalk(event);
      } else if (event.type === 'abandonTarget' || event.type === 'abandonDish') {
        rivalWalk.active = false;
      } else if (event.type === 'claimCustomer' && customer) {
        customer.owner = RESTAURANT_OWNERS.RIVAL;
        customer.reservation = null;
        customer.state = 'awaiting';
        refreshOwnership(customer);
        if (autoTarget?.type === 'customer' && autoTarget.value === customer) autoTarget = null;
        if (clickQuestionCustomer === customer) clickQuestionCustomer = null;
        if (questionCustomer === customer) clearQuestion();
        const faceX = customer.character.position.x - rivalCharacter.position.x;
        const faceZ = customer.character.position.z - rivalCharacter.position.z;
        rivalCharacter.rotation.y = Math.atan2(faceX, faceZ);
      } else if (event.type === 'pickUpDish') {
        giveBeltDishToRival(event);
      } else if (event.type === 'servedCustomer' && customer && rivalCarriedDish) {
        rivalCarryAnchor.remove(rivalCarriedDish.mesh);
        world.add(rivalCarriedDish.mesh);
        rivalCarriedDish.mesh.position.set(customer.table.x, 1.13, customer.table.z);
        rivalCarriedDish.mesh.scale.setScalar(0.78);
        rivalCarriedDish.state = 'delivered';
        customer.servedDish = rivalCarriedDish;
        customer.state = 'eating';
        customer.ownership.visible = false;
        customer.outcome = 'delivered';
        customer.eatingRemaining = EATING_SECONDS;
        customer.character.playAnimation?.('emote-yes');
        rivalCarriedDish = null;
        updateProgress();
        updateChallengeScore();
      } else if (event.type === 'abandonTask') {
        rivalWalk.active = false;
        discardRivalDish();
      }
    }
  }

  // Click-to-walk has no pathfinding. From a front table to the service wall the
  // straight line runs through a back table, and sliding along the one free axis
  // stalled the avatar against it for good — a trackpad-only child simply stopped.
  // Aim past the side of the first table across the path; once clear, the line
  // to the destination no longer touches it and the walk continues straight.
  function autoWalkAim(toX, toZ) {
    setWalkAim(player.position.x, player.position.z, toX, toZ, steerAim);
  }

  function updateMovement(dt) {
    input.getMovement(move);
    if (move.lengthSq() > 0) {
      autoTarget = null;
      clickQuestionCustomer = null;
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
    const arrivalRadius = autoTarget.type === 'dish' || autoTarget.type === 'belt' ? 0.45 : 0.2;
    if (distance <= arrivalRadius) {
      const arrived = autoTarget;
      autoTarget = null;
      player.playAnimation?.('idle');
      if (arrived.type === 'dish') collectDish(arrived.value, true);
      else if (arrived.type === 'customer') {
        const faceX = arrived.value.character.position.x - player.position.x;
        const faceZ = arrived.value.character.position.z - player.position.z;
        player.rotation.y = Math.atan2(faceX, faceZ);
        if (carried && arrived.value.owner === RESTAURANT_OWNERS.PLAYER
          && arrived.value.state === 'awaiting') deliver(arrived.value);
      }
      return;
    }
    const step = Math.min(distance, AUTO_SPEED * dt);
    autoWalkAim(destination.x, destination.z);
    const aimX = steerAim.x - player.position.x;
    const aimZ = steerAim.y - player.position.z;
    const aimDistance = Math.hypot(aimX, aimZ) || 1;
    const nextX = player.position.x + aimX / aimDistance * step;
    const nextZ = player.position.z + aimZ / aimDistance * step;
    if (canOccupy(nextX, player.position.z)) player.position.x = nextX;
    if (canOccupy(player.position.x, nextZ)) player.position.z = nextZ;
    const wantedRotation = Math.atan2(aimX, aimZ);
    const turn = Math.atan2(Math.sin(wantedRotation - player.rotation.y), Math.cos(wantedRotation - player.rotation.y));
    player.rotation.y += turn * (1 - Math.exp(-12 * dt));
    player.playAnimation?.('walk');
  }

  function moveCustomerToward(customer, targetX, targetZ, serviceDt) {
    const dx = targetX - customer.character.position.x;
    const dz = targetZ - customer.character.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance <= 0.08) {
      customer.character.position.x = targetX;
      customer.character.position.z = targetZ;
      return true;
    }
    const step = Math.min(distance, CUSTOMER_WALK_SPEED * serviceDt);
    customer.character.position.x += dx / distance * step;
    customer.character.position.z += dz / distance * step;
    customer.character.rotation.y = Math.atan2(dx, dz);
    return step >= distance;
  }

  function updateCustomerWalk(customer, serviceDt) {
    const side = customer.table.x <= 0 ? 1 : -1;
    const aisleX = customer.table.seatX + side * 1.45;
    const aisleZ = customer.table.seatZ;
    if (customer.state === 'walkingIn') {
      if (customer.walkStage === 0 && moveCustomerToward(customer, aisleX, aisleZ, serviceDt)) customer.walkStage = 1;
      if (customer.walkStage === 1 && moveCustomerToward(customer, customer.table.seatX, customer.table.seatZ, serviceDt)) {
        customer.state = 'seated';
        claimRegistry?.markSeated(customer.id);
        customer.character.position.y = 0.34;
        customer.character.rotation.y = 0;
        customer.character.playAnimation?.('idle');
      }
      return;
    }
    if (customer.state !== 'leaving') return;
    customer.character.position.y = 0;
    if (customer.walkStage === 0 && moveCustomerToward(customer, aisleX, aisleZ, serviceDt)) customer.walkStage = 1;
    if (customer.walkStage === 1 && moveCustomerToward(customer, 0, 6.85, serviceDt)) {
      customer.state = customer.outcome === 'delivered' ? 'delivered' : 'left';
      customer.character.visible = false;
    }
  }

  function updateCustomers(serviceDt, cosmeticDt) {
    const configured = DIFFICULTY[difficulty];
    for (const customer of customers) {
      customer.refusalRemaining = advanceRefusalLock(customer.refusalRemaining, serviceDt);

      if (customer.state === 'walkingIn' || customer.state === 'leaving') updateCustomerWalk(customer, serviceDt);

      if (customer.state === 'eating') {
        customer.eatingRemaining = Math.max(0, customer.eatingRemaining - serviceDt);
        if (customer.eatingRemaining <= 0) {
          if (customer.servedDish) {
            customer.servedDish.mesh.visible = false;
            customer.servedDish.state = 'delivered';
          }
          customer.state = 'leaving';
          customer.walkStage = 0;
          customer.character.playAnimation?.('walk');
        }
      }

      const patienceDrain = customer.state === 'awaiting'
        ? 1
        : (customer.state === 'seated' ? configured.preOrderDrain : 0);
      if (patienceDrain > 0) {
        customer.patience = Math.max(0, customer.patience - serviceDt * patienceDrain);
        if (customer.patience <= 0) leaveCustomer(customer);
      }

      if (customer.state === 'seated' || customer.state === 'awaiting') {
        const late = customer.state === 'awaiting'
          && customer.patience / customer.patienceMax < 0.3;
        customer.character.rotation.y = late
          ? Math.sin(serviceElapsed * 2.2 + customer.index) * 0.35
          : 0;
      }

      refreshOwnership(customer);
      if (customer.character.visible) customer.character.updateAnimation?.(cosmeticDt);
    }

    for (const customer of customers) {
      if (customer.state !== 'awaiting' || customer.readyFired
        || (claimRegistry && customer.owner !== RESTAURANT_OWNERS.PLAYER)) continue;
      customer.prepRemaining -= serviceDt;
    }
  }

  function customerStillNear(customer) {
    if (!isTalkable(customer)) return null;
    const dx = player.position.x - customer.character.position.x;
    const dz = player.position.z - customer.character.position.z;
    return dx * dx + dz * dz < CUSTOMER_RADIUS_SQ ? customer : null;
  }

  function customerWithinRange(customer) {
    if (!customer || !isSeated(customer.state)
      || customer.owner === RESTAURANT_OWNERS.RIVAL) return null;
    const dx = player.position.x - customer.character.position.x;
    const dz = player.position.z - customer.character.position.z;
    return dx * dx + dz * dz < CUSTOMER_RADIUS_SQ ? customer : null;
  }

  function nearestSeatedCustomer() {
    let nearest = null;
    let best = CUSTOMER_RADIUS_SQ;
    for (const customer of customers) {
      if (!isSeated(customer.state) || customer.owner === RESTAURANT_OWNERS.RIVAL) continue;
      const dx = player.position.x - customer.character.position.x;
      const dz = player.position.z - customer.character.position.z;
      const distance = dx * dx + dz * dz;
      if (distance < best) {
        best = distance;
        nearest = customer;
      }
    }
    return nearest;
  }

  function nearestBeltDish() {
    if (!conveyor || Math.abs(player.position.z - BELT_FRONT_Z) > BELT_FRONT_BAND) return null;
    return conveyor.nearestPickable(player.position.x, BELT_PICKUP_WINDOW);
  }

  function playerNearDishReturn() {
    const dx = player.position.x - DISH_RETURN_POSITION.x;
    const dz = player.position.z - DISH_RETURN_POSITION.z;
    return dx * dx + dz * dz <= DISH_RETURN_RADIUS_SQ;
  }

  function updateContext() {
    if (speechCooldown > 0) {
      hideAction();
      setListenTarget(null);
      return;
    }

    // Once Talk is pressed, keep this customer locked through recognition and
    // retries. Mere proximity remains free to retarget before that commitment.
    const lockedQuestion = questionCommitted ? customerStillNear(questionCustomer) : null;
    if (questionCommitted && !lockedQuestion) clearQuestion();

    if (clickQuestionCustomer
      && (!isSeated(clickQuestionCustomer.state)
        || clickQuestionCustomer.owner === RESTAURANT_OWNERS.RIVAL)) {
      clickQuestionCustomer = null;
    }
    const clickedCustomer = customerWithinRange(clickQuestionCustomer);
    const nearbyCustomer = lockedQuestion ?? clickedCustomer ?? nearestSeatedCustomer();
    const beltDish = !carried && player.position.z <= -4.0 ? nearestBeltDish() : null;
    const beltWins = Boolean(beltDish && !lockedQuestion && !clickedCustomer);
    const questionCandidate = lockedQuestion
      ?? (!beltWins && isTalkable(nearbyCustomer) ? nearbyCustomer : null);

    if (!questionCommitted) {
      if (questionCandidate) targetQuestion(questionCandidate);
      else clearQuestion();
    }
    // The 🔊 control sits beside the main action, never in its place (SPEC 3).
    setListenTarget(nearbyCustomer?.owner === RESTAURANT_OWNERS.PLAYER
      && canBeReminded(nearbyCustomer.state) ? nearbyCustomer : null);
    if (carried) {
      // A talkable customer keeps Space dedicated to Talk even with a dish in
      // hand; otherwise the nearby return tub still outranks delivery.
      if (questionCandidate) {
        hideAction();
        return;
      }
      if (playerNearDishReturn()) {
        setInstruction(STRINGS.returnDish);
        showAction(STRINGS.returnDish, 'return');
        return;
      }
      setInstruction(STRINGS.walkToDeliver);
      if (nearbyCustomer?.owner === RESTAURANT_OWNERS.PLAYER
        && nearbyCustomer.state === 'awaiting'
        && nearbyCustomer.refusalRemaining <= 0) {
        showAction(STRINGS.deliverDish, 'deliver', nearbyCustomer);
      }
      else hideAction();
      return;
    }

    // A committed conversation outranks belt pickup so another world action
    // cannot displace an active recognition attempt or read-along.
    if (lockedQuestion) {
      hideAction();
      return;
    }

    if (beltWins) {
      setInstruction(STRINGS.walkToConveyor);
      showAction(STRINGS.collectDish, 'collect', beltDish);
      return;
    }

    if (questionCandidate) {
      hideAction();
      return;
    }

    hideAction();

    if (hasCustomerInState('seated')) setInstruction(STRINGS.walkToCustomer);
    else setInstruction(STRINGS.watchConveyor);
  }

  function updateCarried(dt) {
    if (!carried) return;
    carried.carrySeconds += dt;
    const score = temperatureScoreFor(carried.carrySeconds);
    const label = temperatureLabelFor(score);
    if (temperatureText !== label) {
      temperatureText = label;
      temperature.textContent = label;
      temperature.hidden = false;
    }
    const steamVisible = score > 1;
    const puffs = carried.mesh.userData.steam;
    for (let index = 0; index < puffs.length; index += 1) {
      const puff = puffs[index];
      puff.visible = steamVisible;
      puff.position.y = 0.64 + ((elapsed * 0.24 + index * 0.21) % 0.42);
      puff.position.x = (index - 1) * 0.17 + Math.sin(elapsed * 2.4 + index) * 0.035;
    }
  }

  function onCanvasPointer(event) {
    if (!active || phase !== 'service') return;
    const rect = canvas.getBoundingClientRect();
    pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
    const intersections = raycaster.intersectObject(world, true);
    for (const intersection of intersections) {
      let object = intersection.object;
      let target = null;
      while (object && object !== world) {
        if (object.userData.restaurantTarget) {
          target = object.userData.restaurantTarget;
          break;
        }
        object = object.parent;
      }
      if (!target) continue;
      if (target.type === 'dish') {
        if (carried || target.value.state !== 'belt' || !conveyor) continue;
        const snapshotDish = conveyor.snapshot().dishes.find((dish) => dish.id === target.value.id);
        if (!snapshotDish) continue;
        const estimatedWalkSeconds = Math.hypot(
          player.position.x - snapshotDish.x,
          player.position.z - BELT_FRONT_Z,
        ) / AUTO_SPEED;
        const predictedX = conveyor.predictX(snapshotDish.id, estimatedWalkSeconds);
        if (!Number.isFinite(predictedX)) continue;
        const { visibleHalfWidth } = conveyor.snapshot();
        if (!questionCommitted) clickQuestionCustomer = null;
        autoTarget = {
          type: 'dish',
          value: snapshotDish.id,
          position: new THREE.Vector3(
            THREE.MathUtils.clamp(predictedX, -visibleHalfWidth, visibleHalfWidth),
            0,
            BELT_FRONT_Z,
          ),
        };
      } else if (target.type === 'belt' && conveyor) {
        const { visibleHalfWidth } = conveyor.snapshot();
        if (!questionCommitted) clickQuestionCustomer = null;
        autoTarget = {
          type: 'belt',
          value: null,
          position: new THREE.Vector3(
            THREE.MathUtils.clamp(intersection.point.x, -visibleHalfWidth, visibleHalfWidth),
            0,
            BELT_FRONT_Z,
          ),
        };
      } else if (target.type === 'customer') {
        const playerOrder = target.value.owner === RESTAURANT_OWNERS.PLAYER
          && target.value.state === 'awaiting';
        if (!isTalkable(target.value) && !playerOrder) continue;
        if (!questionCommitted) {
          clickQuestionCustomer = target.value;
        }
        autoTarget = {
          type: 'customer',
          value: target.value,
          position: new THREE.Vector3(target.value.table.seatX, 0, target.value.table.seatZ - 1.65),
        };
      }
      if (target) {
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
    return {
      x: (worldPoint.x * 0.5 + 0.5) * width,
      y: (-worldPoint.y * 0.5 + 0.5) * height,
    };
  }

  function debugSnapshot() {
    const scoring = scoreSession(records);
    const conveyorState = conveyor?.snapshot() ?? {
      direction: -1,
      entryX: 0,
      exitX: 0,
      visibleHalfWidth: 0,
      speed: 0,
      beltTravel: 0,
      dishes: [],
      pending: [],
    };
    const counts = claimRegistry?.counts ?? {
      playerServed: records.filter((record) => record.delivered).length,
      rivalServed: 0,
    };
    const carryingFood = rival?.carriedDish?.food ?? null;
    return {
      phase: phase === 'service' ? directorPhase : phase,
      lifecycle: phase,
      directorPhase,
      progress: { done: claimRegistry?.progress.done ?? records.length, total: shiftTotal },
      level: difficulty,
      customers: customers.map((customer) => ({
        id: customer.id,
        index: customer.index,
        table: customer.tableIndex,
        state: customer.state,
        food: customer.food,
        owner: customer.owner,
        reservation: customer.reservation,
        talkable: isTalkable(customer),
        bubble: ownershipBubble(customer, {
          dialogueOnCustomer: dialogueCustomer === customer && dialogueRemaining > 0,
        }),
        answerShowing: dialogueCustomer === customer && dialogueRemaining > 0,
        screen: projectObject(customer.clickTarget),
        patience: customer.patience,
        refusalRemaining: customer.refusalRemaining,
      })),
      player: player ? { x: player.position.x, z: player.position.z, autoWalking: Boolean(autoTarget) } : null,
      conveyor: {
        direction: conveyorState.direction,
        entryX: conveyorState.entryX,
        exitX: conveyorState.exitX,
        visibleHalfWidth: conveyorState.visibleHalfWidth,
        speed: conveyorState.speed,
        beltTravel: conveyorState.beltTravel,
        dishes: conveyorState.dishes.map((snapshotDish) => {
          const dish = beltDishFor(snapshotDish.id);
          return {
            id: snapshotDish.id,
            food: snapshotDish.food,
            x: snapshotDish.x,
            screen: dish ? projectObject(dish.mesh, 0.25) : null,
          };
        }),
        pending: conveyorState.pending.map(({ food, dueAt, reentry }) => ({ food, dueAt, reentry })),
      },
      dishReturn: dishReturnAnchor ? {
        position: { x: DISH_RETURN_POSITION.x, z: DISH_RETURN_POSITION.z },
        screen: projectObject(dishReturnAnchor, 0.75),
      } : null,
      sign: signAnchor ? {
        text: RESTAURANT_SIGN_TEXT,
        visible: signAnchor.visible,
        screen: projectObject(signAnchor),
      } : null,
      host: host ? {
        inRoom: host.parent === world && host.visible,
        position: { x: host.position.x, z: host.position.z },
      } : null,
      legacy: { bell: false, readyCue: false, counter: false },
      carried: carried ? {
        dishId: carried.id,
        customer: carried.customerId,
        food: carried.food,
        firstTry: carried.firstTry,
        carrySeconds: carried.carrySeconds,
      } : null,
      rival: rival ? {
        state: rival.state,
        claims: rival.claims,
        claimLimit: rival.claimLimit,
        targetCustomer: rival.targetCustomer,
        targetDishId: rival.targetDishId,
        carriedDish: rival.carriedDish,
        position: rivalCharacter
          ? { x: rivalCharacter.position.x, z: rivalCharacter.position.z }
          : rival.position,
        carryingFood,
      } : null,
      playerServed: counts.playerServed,
      rivalServed: counts.rivalServed,
      scoreText: scoreText?.hidden ? null : scoreText?.textContent ?? null,
      combo,
      focusActive: focus.active,
      question: {
        customer: questionCustomer?.id ?? null,
        committed: questionCommitted,
        reservedCustomer: claimRegistry?.reservation ?? null,
      },
      records: records.map((record) => ({ ...record })),
      scoring,
    };
  }

  function installDebugHook() {
    if (!window.__eslDebug) {
      Object.defineProperty(window, '__eslDebug', { value: {}, configurable: true, writable: false });
      debugRootCreated = true;
    }
    Object.defineProperty(window.__eslDebug, 'restaurant', {
      configurable: true,
      enumerable: true,
      get: debugSnapshot,
    });
  }

  function removeDebugHook() {
    if (window.__eslDebug) delete window.__eslDebug.restaurant;
    if (debugRootCreated && window.__eslDebug && Object.keys(window.__eslDebug).length === 0) {
      delete window.__eslDebug;
    }
    debugRootCreated = false;
  }

  function calculateStars() {
    return scoreSession(records).stars;
  }

  function completeTurnaround(answer) {
    if (!active || completed || phase !== 'turnaround') return;
    completed = true;
    acceptedAnswer = answer || LESSON.answers[0];
    phase = 'finishing';
    endFocus();
    speech.clearTarget();
    hud.setTalkState('accepted');
    setInstruction(STRINGS.complete);
    host.playAnimation?.('emote-yes');
    audio.playSfx('stamp');
    finishRemaining = 0.75;
  }

  function beginTurnaround() {
    if (!active || phase === 'turnaround' || completed) return;
    phase = 'turnaround';
    hideAction();
    setListenTarget(null);
    temperature.hidden = true;
    noticeRemaining = 0;
    notice.hidden = true;
    host.position.set(HOST_TURNAROUND_POSITION.x, 0, HOST_TURNAROUND_POSITION.z);
    host.rotation.y = 0;
    host.visible = true;
    world.add(host);
    dialogue.show({ text: LESSON.question, anchor: host, offsetY: 1.8 });
    setInstruction(STRINGS.turnaround);
    cameraRig
      .setTarget(host)
      .setPreset('closeup', { offset: [0, 2.8, 4.2], lookOffset: [0, 0.72, 0], damping: 5.5 });
    beginFocus('restaurant-turnaround');
    promptAnswer(ctx, LESSON, { isActive: () => active, onAccepted: completeTurnaround });
  }

  function updateRoundEnd() {
    if (phase !== 'service') return;
    const done = claimRegistry?.progress.done ?? records.length;
    if (done !== shiftTotal || customers.length !== shiftTotal) return;
    let resolved = true;
    for (const customer of customers) {
      if (customer.state !== 'delivered' && customer.state !== 'left') {
        resolved = false;
        break;
      }
    }
    if (!resolved) return;
    phase = 'round-end';
    clearQuestion();
    hideAction();
    setListenTarget(null);
    hud.hide();
    setInstruction(STRINGS.roundEnd);
    if (scoreText && claimRegistry) scoreText.classList.add('restaurant-ui__score--result');
    roundEndRemaining = 1.3;
    if (dialogueCustomer) dialogueRemaining = Math.min(dialogueRemaining, 1.1);
  }

  function enter(level) {
    const configuredLevel = Number(settings.get('difficulty'));
    const requestedLevel = Number(level);
    difficulty = THREE.MathUtils.clamp(
      Math.round(Number.isFinite(requestedLevel) && requestedLevel > 0 ? requestedLevel : configuredLevel || 1),
      1,
      3,
    );
    active = true;
    completed = false;
    finishCalled = false;
    phase = 'service';
    elapsed = 0;
    serviceElapsed = 0;
    const configured = DIFFICULTY[difficulty];
    shiftTotal = configured.total;
    claimRegistry = RIVAL_LEVELS[difficulty]?.enabled ? createCustomerClaimRegistry() : null;
    conveyor = createConveyor({
      difficulty,
      foods: LESSON.vocabulary.map((food) => food.id),
      rng: Math.random,
    });
    // The rival races the player for the same physical dishes on this belt.
    rival = claimRegistry ? createRestaurantRival({
      level: difficulty,
      total: shiftTotal,
      registry: claimRegistry,
      conveyor,
      initialPosition: RIVAL_START_POSITION,
      beltFrontZ: BELT_FRONT_Z,
      pickupWindow: BELT_PICKUP_WINDOW,
      rng: Math.random,
    }) : null;
    serviceDirector = createRestaurantDirector({
      level: difficulty,
      tables: configured.count,
      total: shiftTotal,
      rng: Math.random,
    });
    directorPhase = serviceDirector.phase;
    focusReleasedAgo = Infinity;
    speechCooldown = 0;
    noticeRemaining = 0;
    dialogueRemaining = 0;
    roundEndRemaining = -1;
    finishRemaining = -1;
    questionCustomer = null;
    dialogueCustomer = null;
    carried = null;
    actionType = '';
    actionCustomer = null;
    actionDish = null;
    instructionText = '';
    temperatureText = '';
    listenCustomer = null;
    acceptedAnswer = null;
    combo = 0;
    comboRemaining = 0;
    phasePillRemaining = 0;
    clickQuestionCustomer = null;
    questionCommitted = false;
    autoTarget = null;
    cancelFocus();
    records.length = 0;
    customers.length = 0;
    dishes.length = 0;
    directorCustomerView.length = 0;
    rivalCustomerView.length = 0;
    rivalWalk.active = false;
    rivalWalk.delayRemaining = 0;
    rivalWalk.durationRemaining = 0;
    rivalCarriedDish = null;
    rivalAnimation = '';
    createOverlay();
    buildWorld();
    if (claimRegistry) {
      updateChallengeScore();
      phasePill.textContent = STRINGS.lunchRush;
      phasePill.hidden = false;
      phasePillRemaining = 2.2;
    }
    canvas = document.querySelector('#game-canvas');
    canvas?.addEventListener('pointerdown', onCanvasPointer);
    installDebugHook();
    unsubscribeSettings = settings.subscribe((next) => {
      if (!active) return;
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
    if (Number.isFinite(focusReleasedAgo)) focusReleasedAgo += serviceDt;

    if (noticeRemaining > 0) {
      noticeRemaining -= safeDt;
      if (noticeRemaining <= 0) notice.hidden = true;
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
    if (comboRemaining > 0) {
      comboRemaining -= safeDt;
      if (comboRemaining <= 0) comboPop.hidden = true;
    }
    if (phasePillRemaining > 0) {
      phasePillRemaining -= safeDt;
      if (phasePillRemaining <= 0) phasePill.hidden = true;
    }

    if (phase === 'service') {
      updateMovement(safeDt);
      updateRivalWalk(serviceDt);
      updateCustomers(serviceDt, safeDt);
      applyDirectorEvents(serviceDt);
      updateConveyor(serviceDt);
      updateCarried(serviceDt);
      updateContext();
      // First contact wins, and within one update the player's pickup resolves
      // before the rival's (SPEC §4): the player acts, then the rival advances.
      if (actionType && input.consumeInteract()) performAction();
      applyRivalEvents(serviceDt);
      if (rivalCharacter) {
        if (focus.active) setRivalAnimation('idle', true);
        else if (rivalWalk.active && rivalWalk.delayRemaining <= 0) setRivalAnimation('walk');
        else setRivalAnimation('idle');
      }
      updateRoundEnd();
    } else if (phase === 'round-end') {
      player.playAnimation?.('idle');
      roundEndRemaining -= safeDt;
      if (roundEndRemaining <= 0) beginTurnaround();
    } else if (phase === 'finishing') {
      finishRemaining -= safeDt;
      if (finishRemaining <= 0 && !finishCalled) {
        finishCalled = true;
        hud.hide();
        finish({
          stars: calculateStars(),
          detail: { category: LESSON.category, answer: acceptedAnswer },
        });
      }
    }

    player?.updateAnimation?.(safeDt);
    host?.updateAnimation?.(safeDt);
    rivalCharacter?.updateAnimation?.(focus.active ? 0 : safeDt);
  }

  function exit() {
    active = false;
    cancelFocus();
    unsubscribeSettings?.();
    unsubscribeSettings = null;
    speech.clearTarget();
    speech.cancel();
    audio.stop();
    hud.hide();
    dialogue.hide();
    cameraRig.setTarget(null);
    canvas?.removeEventListener('pointerdown', onCanvasPointer);
    removeDebugHook();
    actionButton?.removeEventListener('click', performAction);
    listenAgain?.dispose();
    listenAgain = null;
    listenCustomer = null;
    overlay?.remove();
    style?.remove();
    overlay = null;
    style = null;
    instruction = null;
    actionButton = null;
    notice = null;
    temperature = null;
    comboPop = null;
    phasePill = null;
    progressText = null;
    scoreText = null;
    player?.disposeCharacter?.();
    host?.disposeCharacter?.();
    rivalCharacter?.disposeCharacter?.();
    for (const customer of customers) customer.character.disposeCharacter?.();
    customers.length = 0;
    dishes.length = 0;
    records.length = 0;
    if (world) scene.remove(world);
    world = null;
    player = null;
    carryAnchor = null;
    host = null;
    carried = null;
    autoTarget = null;
    canvas = null;
    questionCustomer = null;
    dialogueCustomer = null;
    serviceDirector = null;
    claimRegistry = null;
    rival = null;
    rivalCharacter = null;
    rivalCarryAnchor = null;
    rivalCarriedDish = null;
    conveyor = null;
    conveyorSurface = null;
    dishReturnAnchor = null;
    signAnchor = null;
    rivalCustomerView.length = 0;
    rivalWalk.active = false;
    beltSlats.length = 0;
    sharedDish = null;
    customerVisuals = null;
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    for (const texture of textures) texture.dispose();
    geometries.clear();
    materials.clear();
    textures.clear();
  }

  return { id: 'restaurant', enter, update, exit };
}
