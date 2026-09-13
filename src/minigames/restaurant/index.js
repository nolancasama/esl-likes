import * as THREE from 'three';
import { LESSON_BY_ID, UI, answerFor, formatUi } from '../../config/lesson.js';
import { promptQuestion, promptAnswer } from '../../systems/speechPrompt.js';
import { createSpeechFocus } from '../../systems/speechFocus.js';
import { createListenAgain } from '../../ui/listenAgain.js';
import { advanceRefusalLock, pickFood, scoreSession } from './scoring.js';

const LESSON = LESSON_BY_ID.restaurant;
const STRINGS = UI.restaurant;
const MOVE_SPEED = 5;
const AUTO_SPEED = 5.7;
const CUSTOMER_RADIUS_SQ = 2.7 * 2.7;
const COUNTER_RADIUS_SQ = 1.8 * 1.8;
const HOT_SECONDS = 9;
const WARM_SECONDS = 22;
const REFUSAL_SECONDS = 5;
// Click-to-walk steers past any table lying across its straight line.
const STEER_RADIUS = 1.45;
const STEER_CLEARANCE = 1.75;

const TABLES = Object.freeze([
  Object.freeze({ x: -4.2, z: -1.0, seatX: -4.2, seatZ: -2.05 }),
  Object.freeze({ x: 0, z: 1.8, seatX: 0, seatZ: 0.75 }),
  Object.freeze({ x: 4.2, z: -1.0, seatX: 4.2, seatZ: -2.05 }),
  Object.freeze({ x: -4.2, z: 3.9, seatX: -4.2, seatZ: 2.85 }),
  Object.freeze({ x: 4.2, z: 3.9, seatX: 4.2, seatZ: 2.85 }),
]);

// Cooking time belongs to the dish, not to the table or to the order it was
// taken in. With fixed per-slot times the bells always rang in the order the
// child asked, so "first bell, first customer" beat listening to the food.
const FOOD_PREP_SECONDS = Object.freeze({ curry: 11, pizza: 9, hamburger: 7.5, noodles: 6, sushi: 4.5 });

const DIFFICULTY = Object.freeze({
  1: Object.freeze({ count: 3, activeOrders: [1, 1], prepScale: 0.55, patience: 150, preOrderDrain: 0 }),
  // The budget counts a raised hand as well as a taken order, so a budget of 2
  // could never hold "one cooking, one ready, one waiting to order" at once and
  // Normal played close to one-at-a-time. Use the top of each SPEC range.
  2: Object.freeze({ count: 4, activeOrders: [3, 3], prepScale: 0.85, patience: 130, preOrderDrain: 0.12 }),
  3: Object.freeze({ count: 5, activeOrders: [4, 4], prepScale: 1.3, patience: 115, preOrderDrain: 0.2 }),
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
  let overlay = null;
  let style = null;
  let instruction = null;
  let actionButton = null;
  let notice = null;
  let temperature = null;
  let comboPop = null;
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
  let activeOrderLimit = 1;
  let nextOrderCueAt = 0;
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
  const focus = createSpeechFocus();

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
      @media (max-width: 44rem) { .restaurant-ui__temperature { right: 50%; bottom: 5.9rem; transform: translateX(50%); } }
    `;
    document.head.append(style);

    overlay = document.createElement('div');
    overlay.className = 'restaurant-ui';
    overlay.innerHTML = `
      <div class="top-bar">
        <section class="scene-card"><h1></h1><p></p></section>
      </div>
      <div class="restaurant-ui__notice" role="status" aria-live="polite" hidden></div>
      <div class="restaurant-ui__combo" role="status" aria-live="polite" hidden></div>
      <button class="restaurant-ui__action" type="button" hidden></button>
      <div class="restaurant-ui__temperature" role="status" hidden></div>
    `;
    overlay.querySelector('h1').textContent = STRINGS.roomName;
    instruction = overlay.querySelector('p');
    actionButton = overlay.querySelector('.restaurant-ui__action');
    notice = overlay.querySelector('.restaurant-ui__notice');
    comboPop = overlay.querySelector('.restaurant-ui__combo');
    temperature = overlay.querySelector('.restaurant-ui__temperature');
    actionButton.addEventListener('click', performAction);
    listenAgain = createListenAgain({ root: overlay, label: UI.listenAgain, onPress: listenAgainPressed });
    document.querySelector('#ui-layer').append(overlay);
    setInstruction(STRINGS.walkToCustomer);
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

    const sharedDish = {
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
    const configured = DIFFICULTY[difficulty];
    for (let index = 0; index < configured.count; index += 1) {
      const table = TABLES[index];
      const character = characters.create({
        model: CUSTOMER_MODELS[index],
        tint: CUSTOMER_TINTS[index],
      });
      character.position.set(table.seatX, 0.34, table.seatZ);
      character.rotation.y = 0; // face their table and the room: Kenney models face +z
      character.scale.setScalar(0.72);
      character.visible = false;
      world.add(character);

      const clickTarget = new THREE.Mesh(hitGeometry, hitMaterial);
      clickTarget.position.set(0, 1.05, 0);
      character.add(clickTarget);

      const meter = new THREE.Group();
      const meterBack = addPart(meter, meterGeometry, meterBackMaterial, 0, 0, 0);
      meterBack.scale.set(1.08, 1.3, 1);
      const fillMaterial = makeMaterial(0x5bd16f, { emissive: 0x123d1b });
      const fill = addPart(meter, meterGeometry, fillMaterial, 0, 0, 0.035);
      meter.visible = false;
      world.add(meter);

      const orderCue = new THREE.Sprite(orderCueMaterial);
      orderCue.scale.set(0.9, 0.9, 0.9);
      orderCue.visible = false;
      world.add(orderCue);

      const food = pickFood();
      const customer = {
        index,
        table,
        food,
        listenedAgain: false,
        state: 'scheduled',
        spawnAt: 0,
        prepDuration: (FOOD_PREP_SECONDS[food] ?? 8) * configured.prepScale,
        patienceMax: configured.patience,
        patience: configured.patience,
        character,
        clickTarget,
        meter,
        fill,
        fillMaterial,
        orderCue,
        refusalRemaining: 0,
        leaveSeconds: 0,
      };
      clickTarget.userData.restaurantTarget = { type: 'customer', value: customer };
      const mesh = createDish(food, sharedDish);
      const dish = {
        index,
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
      customers.push(customer);
      dishes.push(dish);
    }

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

  function clearQuestion(keepHud = false) {
    if (!questionCustomer) return;
    questionCustomer = null;
    focus.end();
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
    if (!active || phase !== 'service' || customer.state !== 'orderCue') return;
    clearQuestion(true);
    hud.setTalkState('accepted');
    speechCooldown = 0.6;
    customer.state = 'awaiting';
    customer.orderCue.visible = false;
    const dish = dishes[customer.index];
    dish.state = 'preparing';
    dish.prepRemaining = dish.prepDuration;
    dish.firstTry = true;
    customer.character.playAnimation?.('emote-yes');
    audio.playSfx('accept');
    showCustomerAnswer(customer);
    setInstruction(STRINGS.orderTaken);
  }

  function targetQuestion(customer) {
    if (questionCustomer === customer || speechCooldown > 0 || phase !== 'service') return;
    // A click-to-walk passing another raised hand must not open that customer's
    // prompt: a tap on it is cancelled once the walk leaves their radius.
    if (autoTarget && autoTarget.value !== customer) return;
    clearQuestion();
    questionCustomer = customer;
    focus.begin('restaurant-order');
    promptQuestion(ctx, LESSON, { isActive: () => active, onAccepted: () => acceptQuestion(customer) });
    setInstruction(STRINGS.instruction);
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
    audio.playSfx('bell', {
      frequency: 820,
      endFrequency: 1320,
      duration: 0.34,
      type: 'sine',
      gain: 0.15,
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
    if (!carried || !isSeated(customer.state) || customer.state === 'orderCue'
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
      delivered: true,
      firstTry,
      temperatureScore,
      patienceAtDelivery: customer.patience / customer.patienceMax,
      listenedAgain: customer.listenedAgain,
    });
    customer.state = 'delivered';
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
    if (questionCustomer === customer) clearQuestion();
    if (listenCustomer === customer) setListenTarget(null);
    if (customer.state === 'awaiting') {
      const ownDish = dishes[customer.index];
      const dish = ownDish && ['preparing', 'ready', 'carried'].includes(ownDish.state)
        ? ownDish
        : dishes.find((candidate) => candidate.food === customer.food
          && ['preparing', 'ready', 'carried'].includes(candidate.state));
      discardDish(dish);
    }
    records.push({
      delivered: false,
      firstTry: false,
      temperatureScore: 0,
      patienceAtDelivery: 0,
      listenedAgain: customer.listenedAgain,
    });
    customer.state = 'leaving';
    customer.leaveSeconds = 0;
    customer.meter.visible = false;
    customer.orderCue.visible = false;
    customer.character.playAnimation?.('walk');
    dialogueCustomer = customer;
    dialogueRemaining = 1.8;
    dialogue.show({ text: STRINGS.patientLeave, anchor: customer.character, offsetY: 1.65, speak: false });
    audio.playSfx('retry');
    updateReadyCue();
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
    return state === 'seated' || state === 'orderCue' || state === 'awaiting' || state === 'delivered';
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

  function activeOrReservedOrderCount() {
    let count = 0;
    for (const customer of customers) {
      if (customer.state === 'orderCue' || customer.state === 'awaiting') count += 1;
    }
    return count;
  }

  function promoteOrderCues() {
    let occupied = activeOrReservedOrderCount();
    while (occupied < activeOrderLimit && serviceElapsed >= nextOrderCueAt) {
      let customer = null;
      for (const candidate of customers) {
        if (candidate.state === 'seated') {
          customer = candidate;
          break;
        }
      }
      if (!customer) return;
      customer.state = 'orderCue';
      customer.orderCue.visible = true;
      customer.meter.visible = true;
      customer.character.playAnimation?.('emote-yes');
      nextOrderCueAt += 0.8;
      occupied += 1;
      setInstruction(STRINGS.wantsToOrder);
    }
  }

  // Click-to-walk has no pathfinding. From a front table to the counter the
  // straight line runs through a back table, and sliding along the one free axis
  // stalled the avatar against it for good — a trackpad-only child simply stopped.
  // Aim past the side of the first table across the path; once clear, the line
  // to the destination no longer touches it and the walk continues straight.
  function autoWalkAim(toX, toZ) {
    const fromX = player.position.x;
    const fromZ = player.position.z;
    const segX = toX - fromX;
    const segZ = toZ - fromZ;
    const lengthSq = segX * segX + segZ * segZ;
    steerAim.set(toX, toZ);
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
      steerAim.set(table.x + sideX * STEER_CLEARANCE, table.z + sideZ * STEER_CLEARANCE);
    }
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
    if (distance <= 0.2) {
      const arrived = autoTarget;
      autoTarget = null;
      player.playAnimation?.('idle');
      if (arrived.type === 'dish') collectDish(arrived.value);
      else if (arrived.type === 'customer') {
        if (arrived.value.state === 'orderCue') targetQuestion(arrived.value);
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

  function updateCustomers(serviceDt, cosmeticDt) {
    const configured = DIFFICULTY[difficulty];
    for (const customer of customers) {
      if (customer.state === 'scheduled' && serviceElapsed >= customer.spawnAt) {
        customer.state = 'seated';
        customer.character.visible = true;
        customer.character.playAnimation?.('idle');
      }

      customer.refusalRemaining = advanceRefusalLock(customer.refusalRemaining, serviceDt);

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

      if (customer.state === 'leaving') {
        customer.leaveSeconds += cosmeticDt;
        customer.character.position.x += 1.75 * cosmeticDt;
        customer.character.position.z += 0.45 * cosmeticDt;
        if (customer.leaveSeconds >= 3.2) {
          customer.state = 'left';
          customer.character.visible = false;
        }
      }

      customer.meter.visible = customer.character.visible
        && (customer.state === 'orderCue' || customer.state === 'awaiting');
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
    }

    for (const dish of dishes) {
      if (dish.state !== 'preparing') continue;
      dish.prepRemaining -= serviceDt;
      if (dish.prepRemaining <= 0) makeReady(dish);
    }

    promoteOrderCues();
  }

  // Keep an open order prompt on its customer while the waiter is still in
  // their radius: a nearer neighbour must not steal it mid-answer, because
  // re-targeting hides the HUD and cancels a read-along tap in progress.
  function questionCustomerStillNear() {
    const customer = questionCustomer;
    if (!customer || customer.state !== 'orderCue') return null;
    const dx = player.position.x - customer.character.position.x;
    const dz = player.position.z - customer.character.position.z;
    return dx * dx + dz * dz < CUSTOMER_RADIUS_SQ ? customer : null;
  }

  function nearestSeatedCustomer() {
    let nearest = null;
    let best = CUSTOMER_RADIUS_SQ;
    for (const customer of customers) {
      if (!isSeated(customer.state)) continue;
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

  function updateContext() {
    if (speechCooldown > 0) {
      hideAction();
      setListenTarget(null);
      return;
    }

    const nearbyCustomer = questionCustomerStillNear() ?? nearestSeatedCustomer();
    // The 🔊 control sits beside the main action, never in its place (SPEC 3).
    setListenTarget(nearbyCustomer && canBeReminded(nearbyCustomer.state) ? nearbyCustomer : null);
    if (carried) {
      // A raised hand can be answered with a dish in hand: "deliver this curry
      // now, or take that order first?" is the decision the room is built around.
      if (nearbyCustomer?.state === 'orderCue') {
        hideAction();
        targetQuestion(nearbyCustomer);
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

    const readyDish = nearestReadyDish();
    if (readyDish) {
      clearQuestion();
      setInstruction(STRINGS.walkToCounter);
      showAction(STRINGS.collectDish, 'collect', readyDish);
      return;
    }

    if (nearbyCustomer?.state === 'orderCue') {
      hideAction();
      targetQuestion(nearbyCustomer);
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
        autoTarget = {
          type: 'dish',
          value: target.value,
          position: new THREE.Vector3(SLOT_X[target.value.slot], 0, -4.25),
        };
      } else if (target.type === 'customer') {
        if (!isSeated(target.value.state)) continue;
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
    return {
      phase,
      level: difficulty,
      customers: customers.map((customer) => ({
        index: customer.index,
        state: customer.state,
        food: customer.food,
        cueShowing: customer.orderCue.visible,
        screen: projectObject(customer.clickTarget),
        patience: customer.patience,
        refusalRemaining: customer.refusalRemaining,
      })),
      activeOrderLimit,
      player: player ? { x: player.position.x, z: player.position.z, autoWalking: Boolean(autoTarget) } : null,
      readyDishes: dishes.filter((dish) => dish.state === 'ready').map((dish) => ({
        food: dish.food,
        slot: dish.slot,
        screen: projectObject(dish.mesh, 0.25),
      })),
      carried: carried ? { food: carried.food, firstTry: carried.firstTry, carrySeconds: carried.carrySeconds } : null,
      combo,
      focusActive: focus.active,
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
    focus.end();
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
    focus.begin('restaurant-turnaround');
    promptAnswer(ctx, LESSON, { isActive: () => active, onAccepted: completeTurnaround });
  }

  function updateRoundEnd() {
    if (phase !== 'service') return;
    let resolved = customers.length > 0;
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
    const [minimumOrders, maximumOrders] = DIFFICULTY[difficulty].activeOrders;
    activeOrderLimit = minimumOrders + Math.floor(Math.random() * (maximumOrders - minimumOrders + 1));
    nextOrderCueAt = 0.35;
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
    autoTarget = null;
    focus.cancel();
    records.length = 0;
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

    if (phase === 'service') {
      updateMovement(safeDt);
      updateCustomers(serviceDt, safeDt);
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
    focus.cancel();
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
    player?.disposeCharacter?.();
    host?.disposeCharacter?.();
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
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    for (const texture of textures) texture.dispose();
    geometries.clear();
    materials.clear();
    textures.clear();
  }

  return { id: 'restaurant', enter, update, exit };
}
