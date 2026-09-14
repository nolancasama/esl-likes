import * as THREE from 'three';
import { LESSON_BY_ID, UI, answerFor, formatUi } from '../../config/lesson.js';
import { promptQuestion, promptAnswer } from '../../systems/speechPrompt.js';
import { createSpeechFocus } from '../../systems/speechFocus.js';
import { createTalkDwell } from '../../systems/talkDwell.js';
import { AUTO_TALK_ENABLED } from '../../config/interaction.js';
import { createListenAgain } from '../../ui/listenAgain.js';
import {
  FOOD_PREP_SECONDS,
  advanceRefusalLock,
  pickFood,
  scoreSession,
} from './scoring.js';
import { createRestaurantDirector } from './director.js';
import { RESTAURANT_OWNERS, createCustomerClaimRegistry } from './claims.js';
import { RIVAL_SHARE_CAP, RIVAL_SPEED, createRestaurantRival } from './rival.js';

const LESSON = LESSON_BY_ID.restaurant;
const STRINGS = UI.restaurant;
const MOVE_SPEED = 5;
const AUTO_SPEED = 5.7;
const CUSTOMER_RADIUS_SQ = 2.7 * 2.7;
const COUNTER_RADIUS_SQ = 1.8 * 1.8;
const HOT_SECONDS = 9;
const WARM_SECONDS = 22;
const REFUSAL_SECONDS = 5;
const EATING_SECONDS = 3.2;
const CUSTOMER_WALK_SPEED = 10;
// Click-to-walk steers past any table lying across its straight line.
const STEER_RADIUS = 1.45;
const STEER_CLEARANCE = 1.75;
const RIVAL_PASS_POSITION = Object.freeze({ x: -4.3, z: -5.05 });
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
  1: Object.freeze({ count: 3, total: 5, activeOrderLimit: 1, prepScale: 0.55, patience: 150, preOrderDrain: 0 }),
  // The budget counts a raised hand as well as a taken order, so a budget of 2
  // could never hold "one cooking, one ready, one waiting to order" at once and
  // Normal played close to one-at-a-time. Use the top of each SPEC range.
  2: Object.freeze({ count: 4, total: 7, activeOrderLimit: 3, prepScale: 0.85, patience: 130, preOrderDrain: 0.12 }),
  3: Object.freeze({ count: 5, total: 11, activeOrderLimit: 4, prepScale: 1.3, patience: 115, preOrderDrain: 0.2 }),
});

const CUSTOMER_TINTS = Object.freeze([0xff7d63, 0x54b8ff, 0xb36bff, 0x4bd596, 0xffcf45]);
const CUSTOMER_MODELS = Object.freeze(['e', 'f', 'i', 'm', 'q']);
const SLOT_X = Object.freeze([-3.15, -1.05, 1.05, 3.15]);

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
  let rivalPassAnchor = null;
  let rivalPassDish = null;
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
  let readyCue = null;
  let bellDome = null;
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
  let activeOrderLimit = 1;
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
  let movementActive = false;
  let clickTalkTargetId = null;
  let questionCommitted = false;
  let lastSpeechState = 'ready';
  let debugRootCreated = false;

  const customers = [];
  const dishes = [];
  const records = [];
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  const move = new THREE.Vector2();
  const meterPosition = new THREE.Vector3();
  const worldPoint = new THREE.Vector3();
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const steerAim = new THREE.Vector2();
  const rivalSteerAim = new THREE.Vector2();
  const focus = createSpeechFocus();
  const dwell = createTalkDwell();
  const directorTableView = TABLES.map(() => ({ occupied: false, customer: null }));
  const directorCustomerView = [];
  const dwellCandidates = [];
  const dwellCandidatePool = [];
  const dwellPlayer = { x: 0, z: 0, forwardX: 0, forwardZ: 1 };
  const dwellInput = { candidates: dwellCandidates, player: dwellPlayer, moving: false, lockedTargetId: null };
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
    targetX: RIVAL_PASS_POSITION.x,
    targetZ: RIVAL_PASS_POSITION.z,
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
    const counterMaterial = makeMaterial(0x69c6ad);
    const counterTopMaterial = makeMaterial(0xfff1c9);
    const metalMaterial = makeMaterial(0xd8edf0, { metalness: 0.2 });
    const bellMaterial = makeMaterial(0xffcf33, { emissive: 0x6b3c00 });
    const cueMaterial = makeMaterial(0xfff05a, { emissive: 0xff7b00, emissiveIntensity: 0.9 });

    addPart(world, box, floorMaterial, 0, -0.25, 0, 14, 0.5, 15);
    addPart(world, box, wallMaterial, 0, 2.35, -7.35, 14, 5.2, 0.35);
    addPart(world, box, wallMaterial, -6.85, 1.25, 0, 0.3, 3, 15);
    addPart(world, box, wallMaterial, 6.85, 1.25, 0, 0.3, 3, 15);
    addPart(world, box, trimMaterial, 0, 0.25, -7.08, 13.7, 0.35, 0.18);

    addPart(world, box, counterMaterial, 0, 0.65, -5.75, 9.2, 1.3, 1.35);
    addPart(world, box, counterTopMaterial, 0, 1.34, -5.75, 9.6, 0.16, 1.55);

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

    const bellBase = ownGeometry(new THREE.CylinderGeometry(0.28, 0.34, 0.12, 16));
    const bellTop = ownGeometry(new THREE.SphereGeometry(0.3, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2));
    addPart(world, bellBase, metalMaterial, 4, 1.48, -5.1);
    bellDome = addPart(world, bellTop, bellMaterial, 4, 1.53, -5.1);
    addPart(world, ownGeometry(new THREE.SphereGeometry(0.08, 8, 6)), bellMaterial, 4, 1.87, -5.1);
    readyCue = new THREE.Group();
    const cueGeometry = ownGeometry(new THREE.TorusGeometry(0.48, 0.055, 6, 20));
    for (let index = 0; index < 3; index += 1) {
      const ring = addPart(readyCue, cueGeometry, cueMaterial, 0, index * 0.28, 0, 1 + index * 0.28, 1 + index * 0.28, 1);
      ring.rotation.x = Math.PI / 2;
    }
    readyCue.position.set(4, 2.25, -5.1);
    readyCue.visible = false;
    world.add(readyCue);

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

    // The host stands beside the bell at the open end of the counter, never
    // behind it: from behind the counter only the top of their head showed, so
    // the turnaround question seemed to come from a sliver of hair.
    host = characters.create({ model: 'j', tint: 0xffc56d });
    host.position.set(5.5, 0, -5.6);
    host.rotation.y = -0.85; // turned toward the dining room (Kenney models face +z)
    host.scale.setScalar(0.82);
    world.add(host);

    if (difficulty === 3) {
      rivalCharacter = characters.create({ model: 'r', tint: 0x4b78c5 });
      rivalCharacter.position.set(RIVAL_PASS_POSITION.x, 0, RIVAL_PASS_POSITION.z);
      rivalCharacter.rotation.y = Math.PI;
      rivalCharacter.scale.setScalar(0.78);
      // A bright apron is readable even when the textured character ignores
      // tint, and keeps this waiter distinct from every seated customer.
      // White, not navy: the dark model plus a navy apron read as one more customer.
      addPart(rivalCharacter, box, makeMaterial(0xffffff, { emissive: 0x333333 }), 0, 1.06, 0.28, 0.56, 0.64, 0.08);
      rivalCarryAnchor = new THREE.Group();
      rivalCarryAnchor.position.set(0, 1.42, 0.58);
      rivalCharacter.add(rivalCarryAnchor);
      world.add(rivalCharacter);

      rivalPassAnchor = new THREE.Group();
      rivalPassAnchor.position.set(RIVAL_PASS_POSITION.x, 1.46, RIVAL_PASS_POSITION.z);
      world.add(rivalPassAnchor);
    }

    const meterGeometry = ownGeometry(new THREE.BoxGeometry(1.25, 0.14, 0.05));
    const meterBackMaterial = makeMaterial(0x273858);
    const hitGeometry = ownGeometry(new THREE.BoxGeometry(1.2, 2.1, 0.8));
    const hitMaterial = makeMaterial(0xffffff, { transparent: true, opacity: 0, depthWrite: false });
    const cueCanvas = document.createElement('canvas');
    cueCanvas.width = 128;
    cueCanvas.height = 128;
    const cueContext = cueCanvas.getContext('2d');
    cueContext.fillStyle = '#ffe65a';
    cueContext.strokeStyle = '#ffffff';
    cueContext.lineWidth = 10;
    cueContext.beginPath();
    cueContext.arc(64, 64, 51, 0, Math.PI * 2);
    cueContext.fill();
    cueContext.stroke();
    cueContext.fillStyle = '#273858';
    cueContext.font = '900 78px system-ui, sans-serif';
    cueContext.textAlign = 'center';
    cueContext.textBaseline = 'middle';
    cueContext.fillText('?', 64, 68);
    const orderCueTexture = ownTexture(new THREE.CanvasTexture(cueCanvas));
    orderCueTexture.colorSpace = THREE.SRGBColorSpace;
    const orderCueMaterial = ownMaterial(new THREE.SpriteMaterial({ map: orderCueTexture, transparent: true }));
    const badgeCanvas = document.createElement('canvas');
    badgeCanvas.width = 128;
    badgeCanvas.height = 128;
    const badgeContext = badgeCanvas.getContext('2d');
    badgeContext.fillStyle = '#ffffff';
    badgeContext.strokeStyle = '#273858';
    badgeContext.lineWidth = 9;
    badgeContext.beginPath();
    badgeContext.arc(64, 64, 49, 0, Math.PI * 2);
    badgeContext.fill();
    badgeContext.stroke();
    // Neutral tray-and-apron silhouette: ownership only, never food content.
    badgeContext.fillStyle = '#617188';
    badgeContext.fillRect(30, 67, 68, 10);
    badgeContext.fillRect(61, 49, 6, 18);
    badgeContext.beginPath();
    badgeContext.arc(64, 47, 8, 0, Math.PI * 2);
    badgeContext.fill();
    badgeContext.beginPath();
    badgeContext.moveTo(45, 82);
    badgeContext.lineTo(83, 82);
    badgeContext.lineTo(88, 104);
    badgeContext.lineTo(40, 104);
    badgeContext.closePath();
    badgeContext.fill();
    const badgeTexture = ownTexture(new THREE.CanvasTexture(badgeCanvas));
    badgeTexture.colorSpace = THREE.SRGBColorSpace;
    const waiterBadgeMaterial = ownMaterial(new THREE.SpriteMaterial({
      map: badgeTexture,
      transparent: true,
      depthTest: false,
    }));
    customerVisuals = {
      hitGeometry,
      hitMaterial,
      meterGeometry,
      meterBackMaterial,
      orderCueMaterial,
      waiterBadgeMaterial,
    };

    scene.add(world);
    // The whole dining room at once, not a camera that follows the waiter. With
    // the follow camera the front tables slid off the bottom edge whenever the
    // child stood at the counter, so a raised hand could be asking for service
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

  function createDwellRing() {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const context = canvas.getContext('2d');
    const texture = ownTexture(new THREE.CanvasTexture(canvas));
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = ownMaterial(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
    const sprite = new THREE.Sprite(material);
    // Large enough to read at 1366x768: the ring is the only sign that standing
    // still is about to start the conversation.
    sprite.scale.set(1.15, 1.15, 1.15);
    sprite.visible = false;
    world.add(sprite);
    return { canvas, context, texture, sprite, progress: -1 };
  }

  function drawDwellRing(customer, progress) {
    const ring = customer.dwellRing;
    const rounded = Math.round(Math.max(0, Math.min(1, progress)) * 48) / 48;
    if (ring.progress === rounded) return;
    ring.progress = rounded;
    const { context } = ring;
    context.clearRect(0, 0, 128, 128);
    context.lineCap = 'round';
    // White halo, dark track, bright progress: readable over any floor or table.
    context.lineWidth = 22;
    context.strokeStyle = 'rgba(255, 255, 255, .92)';
    context.beginPath();
    context.arc(64, 64, 46, 0, Math.PI * 2);
    context.stroke();
    context.lineWidth = 13;
    context.strokeStyle = 'rgba(39, 56, 88, .7)';
    context.beginPath();
    context.arc(64, 64, 46, 0, Math.PI * 2);
    context.stroke();
    context.strokeStyle = '#ffd43b';
    context.beginPath();
    context.arc(64, 64, 46, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * rounded);
    context.stroke();
    ring.texture.needsUpdate = true;
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

    const meter = new THREE.Group();
    const meterBack = addPart(meter, customerVisuals.meterGeometry, customerVisuals.meterBackMaterial, 0, 0, 0);
    meterBack.scale.set(1.08, 1.3, 1);
    const fillMaterial = makeMaterial(0x5bd16f, { emissive: 0x123d1b });
    const fill = addPart(meter, customerVisuals.meterGeometry, fillMaterial, 0, 0, 0.035);
    meter.visible = false;
    world.add(meter);

    const orderCue = new THREE.Sprite(customerVisuals.orderCueMaterial);
    orderCue.scale.set(0.9, 0.9, 0.9);
    orderCue.visible = false;
    world.add(orderCue);

    const ownerBadge = new THREE.Sprite(customerVisuals.waiterBadgeMaterial);
    ownerBadge.position.set(table.x, 1.72, table.z + 0.08);
    ownerBadge.scale.set(0.62, 0.62, 0.62);
    ownerBadge.visible = false;
    world.add(ownerBadge);

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
      patienceMax: configured.patience,
      patience: configured.patience,
      character,
      clickTarget,
      meter,
      fill,
      fillMaterial,
      orderCue,
      ownerBadge,
      dwellRing: createDwellRing(),
      refusalRemaining: 0,
      eatingRemaining: 0,
      walkStage: 0,
      rivalApproach: setRivalApproach({ x: 0, z: 0 }, table),
    };
    clickTarget.userData.restaurantTarget = { type: 'customer', value: customer };

    const mesh = createDish(food, sharedDish);
    const dish = {
      index,
      customerId: index,
      food,
      state: 'dormant',
      prepDuration: customer.prepDuration,
      prepRemaining: 0,
      slot: -1,
      carrySeconds: 0,
      firstTry: true,
      mesh,
    };
    mesh.userData.restaurantTarget = { type: 'dish', value: dish };
    customer.dish = dish;
    customers.push(customer);
    dishes.push(dish);
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
    if (!claimRegistry || !customer || customer.reservation !== RESTAURANT_OWNERS.PLAYER) return;
    claimRegistry.releasePlayerReservation(customer.id);
    customer.reservation = null;
  }

  function reservePlayerCustomer(customer) {
    if (!claimRegistry) return true;
    if (!customer || customer.owner === RESTAURANT_OWNERS.RIVAL || customer.state !== 'orderCue') return false;
    if (customer.owner === RESTAURANT_OWNERS.PLAYER) return true;
    if (!claimRegistry.reservePlayer(customer.id)) return false;
    for (const other of customers) {
      if (other !== customer) other.reservation = null;
    }
    customer.reservation = RESTAURANT_OWNERS.PLAYER;
    return true;
  }

  function clearQuestion(keepHud = false, outcome = 'cancelled') {
    if (!questionCustomer) return;
    const endedCustomer = questionCustomer;
    questionCustomer = null;
    if (!questionCommitted) releasePlayerReservation(endedCustomer);
    if (questionCommitted) {
      dwell.notifyEnded(endedCustomer.id, outcome);
      endFocus();
    }
    questionCommitted = false;
    speech.cancel();
    speech.clearTarget();
    if (!keepHud) hud.hide();
  }

  function showCustomerAnswer(customer) {
    const text = answerFor(LESSON, customer.food);
    dialogueCustomer = customer;
    dialogueRemaining = 2.5;
    dialogue.show({ text, anchor: customer.character, offsetY: 1.65 });
  }

  function acceptQuestion(customer) {
    if (!active || phase !== 'service' || customer.state !== 'orderCue'
      || (claimRegistry && customer.owner !== RESTAURANT_OWNERS.PLAYER)) return;
    dwell.notifyAccepted(customer.id);
    clearQuestion(true, 'accepted');
    hud.setTalkState('accepted');
    speechCooldown = 0.6;
    customer.state = 'awaiting';
    customer.orderCue.visible = false;
    const dish = customer.dish;
    dish.state = 'preparing';
    dish.prepRemaining = dish.prepDuration;
    dish.firstTry = true;
    customer.character.playAnimation?.('emote-yes');
    audio.playSfx('accept');
    showCustomerAnswer(customer);
    setInstruction(STRINGS.orderTaken);
  }

  function targetQuestion(customer) {
    if (questionCustomer === customer || speechCooldown > 0 || phase !== 'service'
      || customer.owner === RESTAURANT_OWNERS.RIVAL) return;
    // A click-to-walk passing another raised hand must not open that customer's
    // prompt: a tap on it is cancelled once the walk leaves their radius.
    if (autoTarget && autoTarget.value !== customer) return;
    if (!reservePlayerCustomer(customer)) return;
    clearQuestion();
    questionCustomer = customer;
    promptQuestion(ctx, LESSON, { isActive: () => active, onAccepted: () => acceptQuestion(customer) });
    lastSpeechState = speech.state;
    if (AUTO_TALK_ENABLED && settings.get('micFree')) {
      // The fallback belongs to the committed conversation, not mere proximity.
      hud.setMicFree(false);
      speech.setEnabled(false);
    }
    if (!AUTO_TALK_ENABLED) {
      questionCommitted = true;
      beginFocus('restaurant-order');
    }
    setInstruction(STRINGS.instruction);
  }

  function commitQuestion(customer, manual = false) {
    if (!customer || questionCustomer !== customer || questionCommitted) return;
    if (!reservePlayerCustomer(customer)) return;
    const dwellCommitted = dwell.commit();
    if (!dwellCommitted && AUTO_TALK_ENABLED && !manual) return;
    if (claimRegistry && !claimRegistry.commitPlayer(customer.id)) {
      clearQuestion();
      return;
    }
    customer.owner = RESTAURANT_OWNERS.PLAYER;
    customer.reservation = null;
    questionCommitted = true;
    beginFocus('restaurant-order');
    audio.playSfx('restaurant-talk-ready', { frequency: 660, endFrequency: 880, duration: 0.14, gain: 0.09 });
    if (settings.get('micFree')) {
      hud.setMicFree(true);
      hud.show();
      return;
    }
    speech.setEnabled(true);
    if (speech.autoListenAllowed()) speech.listenOnce();
  }

  function manualTalkStart(event) {
    if (!AUTO_TALK_ENABLED || !questionCustomer || questionCommitted || hud.talkButton.hidden) return;
    if (event.type === 'keydown' && (event.code !== 'Space' || event.repeat)) return;
    commitQuestion(questionCustomer, true);
  }

  function updateReadyCue() {
    if (!readyCue) return;
    readyCue.visible = dishes.some((dish) => dish.state === 'ready');
  }

  // A ready dish goes to a random free place on the counter. Tying the counter
  // slot to the customer let a child carry "the left plate to the left table"
  // without ever knowing which food each customer asked for.
  function pickCounterSlot() {
    const free = [];
    for (let slot = 0; slot < SLOT_X.length; slot += 1) {
      let taken = false;
      for (const other of dishes) {
        if (other.state === 'ready' && other.slot === slot) taken = true;
      }
      if (!taken) free.push(slot);
    }
    return free.length ? free[Math.floor(Math.random() * free.length)] : 0;
  }

  function makeReady(dish) {
    if (dish.state !== 'preparing') return;
    dish.state = 'ready';
    dish.mesh.visible = true;
    dish.slot = pickCounterSlot();
    dish.mesh.position.set(SLOT_X[dish.slot], 1.46, -5.05);
    dish.mesh.rotation.set(0, 0, 0);
    audio.playSfx('restaurant-bell-low', {
      frequency: 920, endFrequency: 1220, duration: 0.18, type: 'sine', gain: 0.2,
    });
    audio.playSfx('restaurant-bell-high', {
      frequency: 1320, endFrequency: 1640, duration: 0.24, type: 'sine', gain: 0.2,
    });
    setNotice(STRINGS.bellReady, 2.2);
    updateReadyCue();
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

  function collectDish(dish) {
    if (carried || dish.state !== 'ready') return;
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
    updateReadyCue();
    setInstruction(STRINGS.walkToDeliver);
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
    // A raised hand is never a wrong delivery: walking up to it with a dish in
    // hand takes their order instead (see updateContext), so a waiter carrying
    // food is never punished for answering a new customer first.
    if (!carried || customer.owner === RESTAURANT_OWNERS.RIVAL
      || !isSeated(customer.state) || customer.state === 'orderCue'
      || customer.refusalRemaining > 0) return;
    if (customer.state !== 'awaiting' || carried.food !== customer.food) {
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
    customer.eatingRemaining = EATING_SECONDS;
    customer.meter.visible = false;
    customer.orderCue.visible = false;
    carryAnchor.remove(carried.mesh);
    world.add(carried.mesh);
    carried.mesh.position.set(customer.table.x, 1.13, customer.table.z);
    carried.mesh.rotation.set(0, 0, 0);
    carried.mesh.scale.setScalar(0.78);
    for (const puff of carried.mesh.userData.steam) puff.visible = false;
    carried.state = 'delivered';
    carried.slot = -1;
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
    updateReadyCue();
    updateProgress();
    updateChallengeScore();
  }

  function discardDish(dish) {
    if (!dish || dish.state === 'delivered' || dish.state === 'discarded' || dish.state === 'dormant') return;
    if (carried === dish) {
      carryAnchor.remove(dish.mesh);
      carried = null;
      temperature.hidden = true;
      temperatureText = '';
    } else {
      world.remove(dish.mesh);
    }
    dish.mesh.visible = false;
    dish.state = 'discarded';
    dish.slot = -1;
    updateReadyCue();
  }

  function leaveCustomer(customer) {
    if (!['seated', 'orderCue', 'awaiting'].includes(customer.state)) return;
    const rivalOwned = customer.owner === RESTAURANT_OWNERS.RIVAL;
    if (questionCustomer === customer) clearQuestion();
    if (listenCustomer === customer) setListenTarget(null);
    if (customer.state === 'awaiting' && !rivalOwned) {
      const ownDish = customer.dish;
      const dish = ownDish && ['preparing', 'ready', 'carried'].includes(ownDish.state)
        ? ownDish
        : dishes.find((candidate) => candidate.food === customer.food
          && ['preparing', 'ready', 'carried'].includes(candidate.state));
      discardDish(dish);
    }
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
    customer.walkStage = 0;
    customer.meter.visible = false;
    customer.orderCue.visible = false;
    customer.character.playAnimation?.('walk');
    dialogueCustomer = customer;
    dialogueRemaining = 1.8;
    dialogue.show({ text: STRINGS.patientLeave, anchor: customer.character, offsetY: 1.65, speak: false });
    audio.playSfx('retry');
    updateReadyCue();
    updateProgress();
    updateChallengeScore();
  }

  function performAction() {
    if (!active || phase !== 'service') return;
    if (actionType === 'collect' && actionDish) collectDish(actionDish);
    else if (actionType === 'deliver' && actionCustomer) deliver(actionCustomer);
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
    return state === 'seated' || state === 'orderCue' || state === 'awaiting';
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

  function rivalCanTakeHand() {
    return Boolean(rival?.enabled) && rival.claims < RIVAL_SHARE_CAP
      && (rival.state === 'idle' || rival.state === 'choosing');
  }

  function activeOrReservedOrderCount() {
    let count = 0;
    for (const customer of customers) {
      if (claimRegistry) {
        if ((customer.owner === RESTAURANT_OWNERS.PLAYER && customer.state === 'awaiting')
          || (customer.owner === null && customer.state === 'orderCue')) count += 1;
      } else if (customer.state === 'orderCue' || customer.state === 'awaiting') count += 1;
    }
    return count;
  }

  function raiseHand(customer) {
    const handLimit = activeOrderLimit + (rivalCanTakeHand() ? 1 : 0);
    if (!customer || customer.state !== 'seated' || activeOrReservedOrderCount() >= handLimit) return;
    if (claimRegistry && !claimRegistry.raiseHand(customer.id)) return;
    customer.state = 'orderCue';
    customer.orderCue.visible = true;
    customer.meter.visible = true;
    customer.character.playAnimation?.('emote-yes');
    audio.playSfx('restaurant-hand-pop', {
      frequency: 520, endFrequency: 760, duration: 0.11, type: 'sine', gain: 0.12,
    });
    setInstruction(STRINGS.wantsToOrder);
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
      // Identical food plates are interchangeable. A dish may still be
      // cooking after its original customer was satisfied by a matching plate,
      // so readiness follows the dish, never the occupant's current state.
      view.state = customer.dish?.state === 'preparing' ? 'preparing' : customer.state;
      view.prepRemaining = customer.dish?.state === 'preparing' ? customer.dish.prepRemaining : undefined;
      if (claimRegistry) {
        view.owner = customer.owner;
        view.reservedBy = customer.reservation;
      }
      if (customer.state === 'awaiting') liveOrders += 1;
    }
    directorView.liveOrders = liveOrders;
    directorView.focusReleasedAgo = focusReleasedAgo;
    directorView.rivalAvailable = rivalCanTakeHand();
    directorView.progress.done = claimRegistry?.progress.done ?? records.length;
  }

  function applyDirectorEvents(serviceDt) {
    updateDirectorView();
    const events = serviceDirector.advance(serviceDt, directorView);
    for (const event of events) {
      if (event.type === 'seat') createCustomer(event.customer, event.table, event.food ?? pickFood());
      else if (event.type === 'raiseHand') raiseHand(customers[event.customer]);
      else if (event.type === 'ready') makeReady(customers[event.customer]?.dish);
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
        view = { id: customer.id, food: customer.food, position: { x: 0, z: 0 }, prepDuration: 0 };
        rivalCustomerView[index] = view;
      }
      view.id = customer.id;
      view.food = customer.food;
      view.position.x = customer.rivalApproach.x;
      view.position.z = customer.rivalApproach.z;
      view.prepDuration = customer.prepDuration;
    }
    rivalView.focusReleasedAgo = focusReleasedAgo;
  }

  function discardRivalDish() {
    if (!rivalPassDish) return;
    rivalCarryAnchor?.remove(rivalPassDish.mesh);
    world.remove(rivalPassDish.mesh);
    rivalPassDish.mesh.visible = false;
    rivalPassDish.state = 'discarded';
    rivalPassDish = null;
  }

  function applyRivalEvents(serviceDt) {
    if (!rival) return;
    updateRivalView();
    const events = rival.advance(serviceDt, rivalView);
    for (const event of events) {
      const customer = customers[event.customer];
      if (event.type === 'targetCustomer'
        || event.type === 'walkToPass'
        || event.type === 'deliverToCustomer') {
        beginRivalWalk(event);
      } else if (event.type === 'abandonTarget') {
        rivalWalk.active = false;
      } else if (event.type === 'claimCustomer' && customer) {
        customer.owner = RESTAURANT_OWNERS.RIVAL;
        customer.reservation = null;
        customer.state = 'awaiting';
        customer.orderCue.visible = false;
        customer.ownerBadge.visible = true;
        if (autoTarget?.type === 'customer' && autoTarget.value === customer) autoTarget = null;
        if (questionCustomer === customer) clearQuestion();
        const faceX = customer.character.position.x - rivalCharacter.position.x;
        const faceZ = customer.character.position.z - rivalCharacter.position.z;
        rivalCharacter.rotation.y = Math.atan2(faceX, faceZ);
      } else if (event.type === 'orderTaken') {
        discardRivalDish();
        const mesh = createDish(event.food, sharedDish);
        mesh.position.set(RIVAL_PASS_POSITION.x, 1.46, RIVAL_PASS_POSITION.z);
        rivalPassDish = {
          customerId: event.customer,
          food: event.food,
          state: 'preparing',
          mesh,
        };
      } else if (event.type === 'dishReady') {
        if (rivalPassDish?.customerId !== event.customer) continue;
        rivalPassDish.state = 'ready';
        rivalPassDish.mesh.visible = true;
        rivalPassDish.mesh.position.set(RIVAL_PASS_POSITION.x, 1.46, RIVAL_PASS_POSITION.z);
      } else if (event.type === 'pickUpDish') {
        if (rivalPassDish?.customerId !== event.customer) continue;
        rivalPassDish.state = 'carried';
        world.remove(rivalPassDish.mesh);
        rivalCarryAnchor.add(rivalPassDish.mesh);
        rivalPassDish.mesh.position.set(0, 0, 0);
        rivalPassDish.mesh.scale.setScalar(0.88);
      } else if (event.type === 'servedCustomer' && customer && rivalPassDish) {
        rivalCarryAnchor.remove(rivalPassDish.mesh);
        world.add(rivalPassDish.mesh);
        rivalPassDish.mesh.position.set(customer.table.x, 1.13, customer.table.z);
        rivalPassDish.mesh.scale.setScalar(0.78);
        rivalPassDish.state = 'delivered';
        customer.servedDish = rivalPassDish;
        customer.state = 'eating';
        customer.outcome = 'delivered';
        customer.eatingRemaining = EATING_SECONDS;
        customer.meter.visible = false;
        customer.ownerBadge.visible = false;
        customer.character.playAnimation?.('emote-yes');
        rivalPassDish = null;
        updateProgress();
        updateChallengeScore();
      } else if (event.type === 'abandonTask') {
        rivalWalk.active = false;
        discardRivalDish();
      }
    }
  }

  // Click-to-walk has no pathfinding. From a front table to the counter the
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
      clickTalkTargetId = null;
      movementActive = true;
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
      movementActive = false;
      player.playAnimation?.('idle');
      return;
    }

    movementActive = true;

    const destination = autoTarget.position;
    const dx = destination.x - player.position.x;
    const dz = destination.z - player.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance <= 0.2) {
      const arrived = autoTarget;
      autoTarget = null;
      movementActive = false;
      player.playAnimation?.('idle');
      if (arrived.type === 'dish') collectDish(arrived.value);
      else if (arrived.type === 'customer') {
        if (arrived.value.owner === RESTAURANT_OWNERS.RIVAL) return;
        const faceX = arrived.value.character.position.x - player.position.x;
        const faceZ = arrived.value.character.position.z - player.position.z;
        player.rotation.y = Math.atan2(faceX, faceZ);
        if (arrived.value.state === 'orderCue') clickTalkTargetId = arrived.value.id;
        else if (carried) deliver(arrived.value);
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
      customer.orderCue.visible = false;
      customer.meter.visible = false;
      customer.dwellRing.sprite.visible = false;
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
        : (customer.state === 'seated' || customer.state === 'orderCue' ? configured.preOrderDrain : 0);
      if (patienceDrain > 0) {
        customer.patience = Math.max(0, customer.patience - serviceDt * patienceDrain);
        const ratio = customer.patience / customer.patienceMax;
        customer.fill.scale.x = Math.max(0.001, ratio);
        customer.fill.position.x = -(1 - ratio) * 0.625;
        if (ratio < 0.28) customer.fillMaterial.color.setHex(0xef5350);
        else if (ratio < 0.56) customer.fillMaterial.color.setHex(0xffc847);
        else customer.fillMaterial.color.setHex(0x5bd16f);
        if (customer.patience <= 0) leaveCustomer(customer);
      }

      customer.meter.visible = customer.character.visible
        && (customer.state === 'orderCue' || customer.state === 'awaiting');
      customer.ownerBadge.visible = customer.character.visible
        && customer.owner === RESTAURANT_OWNERS.RIVAL
        && customer.state === 'awaiting';
      if (customer.character.visible) customer.character.updateAnimation?.(cosmeticDt);
      if (customer.meter.visible) {
        customer.character.getWorldPosition(meterPosition);
        customer.meter.position.copy(meterPosition);
        customer.meter.position.y += 1.75;
        customer.meter.quaternion.copy(camera.quaternion);
      }
      if (customer.orderCue.visible) {
        customer.character.getWorldPosition(meterPosition);
        customer.orderCue.position.copy(meterPosition);
        customer.orderCue.position.y += 2.35;
        const cuePulse = 0.92 + Math.sin(elapsed * 6 + customer.index) * 0.08;
        customer.orderCue.scale.setScalar(cuePulse);
      }
      if (customer.ownerBadge.visible) customer.ownerBadge.quaternion.copy(camera.quaternion);
      if (customer.dwellRing.sprite.visible) {
        customer.character.getWorldPosition(meterPosition);
        customer.dwellRing.sprite.position.copy(meterPosition);
        customer.dwellRing.sprite.position.y += 2.05;
        customer.dwellRing.sprite.quaternion.copy(camera.quaternion);
      }
    }

    for (const dish of dishes) {
      if (dish.state !== 'preparing') continue;
      dish.prepRemaining -= serviceDt;
    }
  }

  // Keep an open order prompt on its customer while the waiter is still in
  // their radius: a nearer neighbour must not steal it mid-answer, because
  // re-targeting hides the HUD and cancels a read-along tap in progress.
  function questionCustomerStillNear() {
    const customer = questionCustomer;
    if (!customer || customer.state !== 'orderCue'
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

  function nearestReadyDish() {
    let nearest = null;
    let best = COUNTER_RADIUS_SQ;
    for (const dish of dishes) {
      if (dish.state !== 'ready') continue;
      const dx = player.position.x - SLOT_X[dish.slot];
      const dz = player.position.z + 5.05;
      const distance = dx * dx + dz * dz;
      if (distance < best) {
        best = distance;
        nearest = dish;
      }
    }
    return nearest;
  }

  function updateTalkDwell(dt) {
    if (!AUTO_TALK_ENABLED) return;
    dwellCandidates.length = 0;
    for (const customer of customers) {
      if (customer.state !== 'orderCue' || customer.owner === RESTAURANT_OWNERS.RIVAL) continue;
      const poolIndex = dwellCandidates.length;
      let candidate = dwellCandidatePool[poolIndex];
      if (!candidate) {
        candidate = {};
        dwellCandidatePool[poolIndex] = candidate;
      }
      candidate.id = customer.id;
      candidate.x = customer.character.position.x;
      candidate.z = customer.character.position.z;
      candidate.radiusSq = CUSTOMER_RADIUS_SQ;
      dwellCandidates.push(candidate);
    }
    dwellPlayer.x = player.position.x;
    dwellPlayer.z = player.position.z;
    dwellPlayer.forwardX = Math.sin(player.rotation.y);
    dwellPlayer.forwardZ = Math.cos(player.rotation.y);
    dwellInput.moving = movementActive;
    dwellInput.lockedTargetId = autoTarget?.type === 'customer' ? autoTarget.value.id : clickTalkTargetId;
    dwell.update(dt, dwellInput);

    const target = dwell.targetId == null ? null : customers[dwell.targetId];
    for (const customer of customers) {
      const showing = !questionCommitted && customer === target
        && (dwell.phase === 'dwelling' || dwell.phase === 'ready');
      customer.dwellRing.sprite.visible = showing;
      if (showing) {
        drawDwellRing(customer, dwell.progress);
        const wanted = Math.atan2(
          player.position.x - customer.character.position.x,
          player.position.z - customer.character.position.z,
        );
        customer.character.rotation.y = THREE.MathUtils.clamp(wanted, -0.65, 0.65);
      } else if (!['walkingIn', 'leaving'].includes(customer.state)) {
        customer.character.rotation.y = 0;
      }
    }

    if (target && !questionCommitted && !questionCustomer) {
      if (reservePlayerCustomer(target)) targetQuestion(target);
    }
    if (questionCustomer && !questionCommitted && target !== questionCustomer) clearQuestion();

    const speechState = speech.state;
    if (questionCustomer && !questionCommitted && speechState === 'listening') commitQuestion(questionCustomer, true);
    if (!questionCommitted && target && dwell.phase === 'ready') commitQuestion(target);
    if (questionCommitted && speechState === 'try-again' && lastSpeechState !== 'try-again') {
      dwell.notifyEnded(questionCustomer?.id, 'failed');
    }
    lastSpeechState = speechState;
  }

  function updateContext() {
    if (speechCooldown > 0) {
      hideAction();
      setListenTarget(null);
      return;
    }

    const lockedQuestion = questionCustomerStillNear();
    if (questionCustomer && !lockedQuestion) clearQuestion();
    const nearbyCustomer = lockedQuestion ?? nearestSeatedCustomer();
    // The 🔊 control sits beside the main action, never in its place (SPEC 3).
    setListenTarget(nearbyCustomer && canBeReminded(nearbyCustomer.state) ? nearbyCustomer : null);
    if (carried) {
      // A raised hand can be answered with a dish in hand: "deliver this curry
      // now, or take that order first?" is the decision the room is built around.
      if (nearbyCustomer?.state === 'orderCue') {
        hideAction();
        if (!AUTO_TALK_ENABLED) targetQuestion(nearbyCustomer);
        return;
      }
      clearQuestion();
      setListenTarget(null);
      setInstruction(STRINGS.walkToDeliver);
      if (nearbyCustomer && nearbyCustomer.refusalRemaining <= 0) {
        showAction(STRINGS.deliverDish, 'deliver', nearbyCustomer);
      }
      else hideAction();
      return;
    }

    // An open conversation outranks the pickup counter. Tables 0 and 2 seat their
    // customers within the counter's pickup radius, and clearing a dwelling or
    // committed question there cancelled it and disarmed the dwell for good.
    if (lockedQuestion) {
      hideAction();
      return;
    }

    const readyDish = nearestReadyDish();
    if (readyDish) {
      clearQuestion();
      setInstruction(STRINGS.walkToCounter);
      showAction(STRINGS.collectDish, 'collect', readyDish);
      return;
    }

    if (nearbyCustomer?.state === 'orderCue') {
      hideAction();
      if (!AUTO_TALK_ENABLED) targetQuestion(nearbyCustomer);
      return;
    }

    clearQuestion();
    hideAction();

    if (dishes.some((dish) => dish.state === 'ready')) setInstruction(STRINGS.walkToCounter);
    else if (hasCustomerInState('orderCue')) setInstruction(STRINGS.wantsToOrder);
    else if (hasCustomerInState('seated')) setInstruction(STRINGS.walkToCustomer);
    else setInstruction(STRINGS.waitForBell);
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
        if (carried || target.value.state !== 'ready') continue;
        clickTalkTargetId = null;
        autoTarget = {
          type: 'dish',
          value: target.value,
          position: new THREE.Vector3(SLOT_X[target.value.slot], 0, -4.25),
        };
      } else if (target.type === 'customer') {
        if (!isSeated(target.value.state)
          || target.value.owner === RESTAURANT_OWNERS.RIVAL) continue;
        clickTalkTargetId = target.value.state === 'orderCue' ? target.value.id : null;
        autoTarget = {
          type: 'customer',
          value: target.value,
          position: new THREE.Vector3(target.value.table.seatX, 0, target.value.table.seatZ - 1.65),
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
    return {
      x: (worldPoint.x * 0.5 + 0.5) * width,
      y: (-worldPoint.y * 0.5 + 0.5) * height,
    };
  }

  function debugSnapshot() {
    const scoring = scoreSession(records);
    const counts = claimRegistry?.counts ?? {
      playerServed: records.filter((record) => record.delivered).length,
      rivalServed: 0,
    };
    const carryingFood = rival && ['carrying', 'delivering'].includes(rival.state)
      ? rival.dish?.food ?? null
      : null;
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
        cueShowing: customer.orderCue.visible,
        screen: projectObject(customer.clickTarget),
        patience: customer.patience,
        refusalRemaining: customer.refusalRemaining,
      })),
      activeOrderLimit,
      player: player ? { x: player.position.x, z: player.position.z, autoWalking: Boolean(autoTarget) } : null,
      readyDishes: dishes.filter((dish) => dish.state === 'ready').map((dish) => ({
        customer: dish.customerId,
        food: dish.food,
        slot: dish.slot,
        screen: projectObject(dish.mesh, 0.25),
      })),
      carried: carried ? {
        customer: carried.customerId,
        food: carried.food,
        firstTry: carried.firstTry,
        carrySeconds: carried.carrySeconds,
      } : null,
      rival: rival ? {
        state: rival.state,
        targetCustomer: rival.targetCustomer,
        position: rivalCharacter
          ? { x: rivalCharacter.position.x, z: rivalCharacter.position.z }
          : rival.position,
        carryingFood,
      } : null,
      rivalPass: rivalPassAnchor ? {
        position: { x: RIVAL_PASS_POSITION.x, z: RIVAL_PASS_POSITION.z },
        screen: projectObject(rivalPassAnchor),
        contents: rivalPassDish?.state === 'ready' ? {
          customer: rivalPassDish.customerId,
          food: rivalPassDish.food,
          state: rivalPassDish.state,
        } : null,
      } : null,
      playerServed: counts.playerServed,
      rivalServed: counts.rivalServed,
      scoreText: scoreText?.hidden ? null : scoreText?.textContent ?? null,
      combo,
      focusActive: focus.active,
      dwell: { phase: dwell.phase, targetId: dwell.targetId, progress: dwell.progress },
      question: { customer: questionCustomer?.id ?? null, committed: questionCommitted },
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
    dialogue.show({ text: LESSON.question, anchor: host, offsetY: 1.8 });
    setInstruction(STRINGS.turnaround);
    cameraRig
      .setTarget(host)
      // From the open aisle in front of the counter, above chair height, so neither
      // the right wall nor a chair blocks the shot; the host is turned to face it.
      .setPreset('closeup', { offset: [-3.4, 3, 3], lookOffset: [0, 0.6, 0], damping: 5.5 });
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
    activeOrderLimit = configured.activeOrderLimit;
    shiftTotal = configured.total;
    claimRegistry = difficulty === 3 ? createCustomerClaimRegistry() : null;
    rival = claimRegistry ? createRestaurantRival({
      level: difficulty,
      registry: claimRegistry,
      initialPosition: RIVAL_PASS_POSITION,
      passPosition: RIVAL_PASS_POSITION,
      prepScale: configured.prepScale,
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
    movementActive = false;
    clickTalkTargetId = null;
    questionCommitted = false;
    lastSpeechState = 'ready';
    autoTarget = null;
    cancelFocus();
    dwell.reset();
    records.length = 0;
    customers.length = 0;
    dishes.length = 0;
    directorCustomerView.length = 0;
    rivalCustomerView.length = 0;
    rivalWalk.active = false;
    rivalWalk.delayRemaining = 0;
    rivalWalk.durationRemaining = 0;
    rivalPassDish = null;
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
    hud.talkButton.addEventListener('pointerdown', manualTalkStart);
    window.addEventListener('keydown', manualTalkStart, true);
    installDebugHook();
    unsubscribeSettings = settings.subscribe((next) => {
      if (!active) return;
      speech.setEnabled(!next.micFree);
      hud.setMicFree(AUTO_TALK_ENABLED && questionCustomer && !questionCommitted ? false : next.micFree);
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
      updateTalkDwell(safeDt);
      applyRivalEvents(serviceDt);
      if (rivalCharacter) {
        if (focus.active) setRivalAnimation('idle', true);
        else if (rivalWalk.active && rivalWalk.delayRemaining <= 0) setRivalAnimation('walk');
        else setRivalAnimation('idle');
      }
      updateCarried(serviceDt);
      updateContext();
      if (actionType && input.consumeInteract()) performAction();
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
    if (readyCue?.visible) {
      readyCue.rotation.y += safeDt * 1.8;
      const pulse = 1 + Math.sin(elapsed * 7) * 0.08;
      bellDome.scale.setScalar(pulse);
    } else if (bellDome) {
      bellDome.scale.setScalar(1);
    }
  }

  function exit() {
    active = false;
    cancelFocus();
    dwell.reset();
    unsubscribeSettings?.();
    unsubscribeSettings = null;
    speech.clearTarget();
    speech.cancel();
    audio.stop();
    hud.hide();
    dialogue.hide();
    cameraRig.setTarget(null);
    canvas?.removeEventListener('pointerdown', onCanvasPointer);
    hud.talkButton.removeEventListener('pointerdown', manualTalkStart);
    window.removeEventListener('keydown', manualTalkStart, true);
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
    readyCue = null;
    bellDome = null;
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
    rivalPassAnchor = null;
    rivalPassDish = null;
    rivalCustomerView.length = 0;
    rivalWalk.active = false;
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
