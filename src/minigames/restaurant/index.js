import * as THREE from 'three';
import { LESSON_BY_ID, UI, formatUi } from '../../config/lesson.js';

const LESSON = LESSON_BY_ID.restaurant;
const STRINGS = UI.restaurant;
const MOVE_SPEED = 5;
const CUSTOMER_RADIUS_SQ = 2.7 * 2.7;
const COUNTER_RADIUS_SQ = 1.8 * 1.8;
const HOT_SECONDS = 9;
const WARM_SECONDS = 22;

const TABLES = Object.freeze([
  Object.freeze({ x: -4.2, z: -1.0, seatX: -4.2, seatZ: -2.05 }),
  Object.freeze({ x: 0, z: 1.8, seatX: 0, seatZ: 0.75 }),
  Object.freeze({ x: 4.2, z: -1.0, seatX: 4.2, seatZ: -2.05 }),
  Object.freeze({ x: -4.2, z: 3.9, seatX: -4.2, seatZ: 2.85 }),
  Object.freeze({ x: 4.2, z: 3.9, seatX: 4.2, seatZ: 2.85 }),
]);

const DIFFICULTY = Object.freeze({
  1: Object.freeze({ count: 1, spawns: [0], prep: [4], patience: 100 }),
  2: Object.freeze({ count: 2, spawns: [0, 4], prep: [6, 8], patience: 110 }),
  3: Object.freeze({ count: 4, spawns: [0, 4, 9, 14], prep: [10, 15, 12, 18], patience: 125 }),
});

const CUSTOMER_TINTS = Object.freeze([0xff9f7a, 0x86c9ff, 0xb99cff, 0x75d5a4]);
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
  let readyCue = null;
  let bellDome = null;
  let active = false;
  let completed = false;
  let finishCalled = false;
  let phase = 'service';
  let difficulty = 1;
  let elapsed = 0;
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
  let actionDishCustomer = null;
  let instructionText = '';
  let temperatureText = '';
  let reminders = 0;
  let acceptedAnswer = null;
  let unsubscribeSettings = null;

  const customers = [];
  const geometries = new Set();
  const materials = new Set();
  const move = new THREE.Vector2();
  const meterPosition = new THREE.Vector3();

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
    actionDishCustomer = null;
    if (actionButton) actionButton.hidden = true;
  }

  function showAction(text, type, customer = null) {
    actionType = type;
    actionCustomer = customer;
    actionDishCustomer = type === 'collect' ? customer : null;
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
      <button class="restaurant-ui__action" type="button" hidden></button>
      <div class="restaurant-ui__temperature" role="status" hidden></div>
    `;
    overlay.querySelector('h1').textContent = STRINGS.roomName;
    instruction = overlay.querySelector('p');
    actionButton = overlay.querySelector('.restaurant-ui__action');
    notice = overlay.querySelector('.restaurant-ui__notice');
    temperature = overlay.querySelector('.restaurant-ui__temperature');
    actionButton.addEventListener('click', performAction);
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
      addPart(world, box, chairMaterial, table.seatX, 1.05, table.seatZ + 0.35, 0.9, 1.05, 0.15);
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
      riceMaterial: makeMaterial(0xfff4d6),
      curryMaterial: makeMaterial(0xd68c23),
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

    player = characters.create({ model: 'a', tint: 0x77c8f2 });
    player.position.set(0, 0, 5.7);
    player.scale.setScalar(0.82);
    carryAnchor = new THREE.Group();
    carryAnchor.position.set(0, 1.45, 0.58);
    player.add(carryAnchor);
    world.add(player);

    host = characters.create({ model: 'j', tint: 0xffc56d });
    host.position.set(0, 0, -6.25);
    host.rotation.y = Math.PI;
    host.scale.setScalar(0.82);
    world.add(host);

    const meterGeometry = ownGeometry(new THREE.BoxGeometry(1.25, 0.14, 0.05));
    const meterBackMaterial = makeMaterial(0x273858);
    const configured = DIFFICULTY[difficulty];
    const foodOffset = Math.floor(Math.random() * LESSON.answers.length);
    for (let index = 0; index < configured.count; index += 1) {
      const table = TABLES[index];
      const character = characters.create({
        model: ['e', 'f', 'i', 'm'][index],
        tint: CUSTOMER_TINTS[index],
      });
      character.position.set(table.seatX, 0.34, table.seatZ);
      character.rotation.y = Math.PI;
      character.scale.setScalar(0.72);
      character.visible = false;
      world.add(character);

      const meter = new THREE.Group();
      const meterBack = addPart(meter, meterGeometry, meterBackMaterial, 0, 0, 0);
      meterBack.scale.set(1.08, 1.3, 1);
      const fillMaterial = makeMaterial(0x5bd16f, { emissive: 0x123d1b });
      const fill = addPart(meter, meterGeometry, fillMaterial, 0, 0, 0.035);
      meter.visible = false;
      world.add(meter);

      const food = LESSON.answers[(foodOffset + index) % LESSON.answers.length];
      const customer = {
        index,
        table,
        food,
        state: 'scheduled',
        spawnAt: configured.spawns[index],
        prepDuration: configured.prep[index],
        prepRemaining: 0,
        patienceMax: configured.patience,
        patience: configured.patience,
        character,
        meter,
        fill,
        fillMaterial,
        dish: null,
        carrySeconds: 0,
        temperatureScore: 0,
        patienceAtDelivery: 0,
        leaveSeconds: 0,
      };
      customer.dish = createDish(food, sharedDish);
      customers.push(customer);
    }

    scene.add(world);
    cameraRig
      .setTarget(player)
      .setPreset('follow', { offset: [0, 8.5, 10.5], lookOffset: [0, 1.05, -2.2], damping: 5 });
  }

  function configureSpeech({ mode, sentence, fallbackAnswer, onAccepted }) {
    const micFree = Boolean(settings.get('micFree'));
    hud.configureTalk({
      targetSentence: sentence,
      micFree,
      onFallbackContinue: () => {
        if (active) onAccepted(fallbackAnswer);
      },
    });
    hud.show();
    speech.setEnabled(!micFree);
    speech.setTarget({
      mode,
      category: LESSON.category,
      onState: (state) => hud.setTalkState(state),
      onAccepted: (result) => onAccepted(result.answer || fallbackAnswer),
      onFailure: () => hud.recordFailure(),
      onUnavailable: () => {
        speech.setEnabled(false);
        hud.setMicFree(true);
      },
    });
  }

  function clearQuestion(keepHud = false) {
    if (!questionCustomer) return;
    questionCustomer = null;
    speech.clearTarget();
    if (!keepHud) hud.hide();
  }

  function showCustomerAnswer(customer) {
    const text = formatUi(STRINGS.npcAnswer, { food: customer.food });
    dialogueCustomer = customer;
    dialogueRemaining = 2.5;
    dialogue.show({ text, anchor: customer.character, offsetY: 1.65 });
  }

  function acceptQuestion(customer) {
    if (!active || phase !== 'service' || customer.state !== 'waiting') return;
    clearQuestion(true);
    hud.setTalkState('accepted');
    speechCooldown = 0.6;
    customer.state = 'preparing';
    customer.prepRemaining = customer.prepDuration;
    customer.character.playAnimation?.('emote-yes');
    audio.playSfx('accept');
    showCustomerAnswer(customer);
    setInstruction(STRINGS.waitForBell);
  }

  function targetQuestion(customer) {
    if (questionCustomer === customer || speechCooldown > 0 || phase !== 'service') return;
    clearQuestion();
    questionCustomer = customer;
    configureSpeech({
      mode: 'question',
      sentence: LESSON.question,
      fallbackAnswer: null,
      onAccepted: () => acceptQuestion(customer),
    });
    setInstruction(STRINGS.instruction);
  }

  function updateReadyCue() {
    if (!readyCue) return;
    readyCue.visible = false;
    for (const customer of customers) {
      if (customer.state === 'ready') {
        readyCue.visible = true;
        break;
      }
    }
  }

  function makeReady(customer) {
    if (customer.state !== 'preparing') return;
    customer.state = 'ready';
    customer.dish.visible = true;
    customer.dish.position.set(SLOT_X[customer.index], 1.46, -5.05);
    customer.dish.rotation.set(0, 0, 0);
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

  function collectDish(customer) {
    if (carried || customer.state !== 'ready') return;
    customer.state = 'carried';
    customer.carrySeconds = 0;
    carried = customer;
    world.remove(customer.dish);
    carryAnchor.add(customer.dish);
    customer.dish.position.set(0, 0, 0);
    customer.dish.rotation.set(0, 0, 0);
    customer.dish.scale.setScalar(0.88);
    for (const puff of customer.dish.userData.steam) puff.visible = true;
    audio.playSfx('interact');
    hideAction();
    updateReadyCue();
    setInstruction(STRINGS.walkToDeliver);
  }

  function remind(customer) {
    if (!['preparing', 'ready'].includes(customer.state)) return;
    reminders += 1;
    audio.playSfx('interact');
    customer.character.playAnimation?.('emote-yes');
    showCustomerAnswer(customer);
    setNotice(STRINGS.remindCost, 1.5);
  }

  function deliver(customer) {
    if (!carried || !['waiting', 'preparing', 'ready', 'carried'].includes(customer.state)) return;
    if (carried !== customer) {
      audio.playSfx('retry');
      dialogueCustomer = customer;
      dialogueRemaining = 1.8;
      dialogue.show({ text: STRINGS.wrongDish, anchor: customer.character, offsetY: 1.65, speak: false });
      return;
    }

    const temperatureScore = temperatureScoreFor(customer.carrySeconds);
    const temperatureLabel = temperatureLabelFor(temperatureScore);
    customer.temperatureScore = temperatureScore;
    customer.patienceAtDelivery = customer.patience / customer.patienceMax;
    customer.state = 'delivered';
    customer.meter.visible = false;
    carryAnchor.remove(customer.dish);
    world.add(customer.dish);
    customer.dish.position.set(customer.table.x, 1.13, customer.table.z);
    customer.dish.rotation.set(0, 0, 0);
    customer.dish.scale.setScalar(0.78);
    for (const puff of customer.dish.userData.steam) puff.visible = false;
    carried = null;
    temperature.hidden = true;
    temperatureText = '';
    customer.character.playAnimation?.('emote-yes');
    audio.playSfx('accept');
    dialogueCustomer = customer;
    dialogueRemaining = 1.8;
    dialogue.show({ text: STRINGS.delivered, anchor: customer.character, offsetY: 1.65, speak: false });
    setNotice(temperatureLabel, 1.8);
    hideAction();
  }

  function leaveCustomer(customer) {
    if (!['waiting', 'preparing', 'ready'].includes(customer.state)) return;
    if (questionCustomer === customer) clearQuestion();
    customer.state = 'leaving';
    customer.leaveSeconds = 0;
    customer.meter.visible = false;
    customer.dish.visible = false;
    customer.character.playAnimation?.('walk');
    dialogueCustomer = customer;
    dialogueRemaining = 1.8;
    dialogue.show({ text: STRINGS.patientLeave, anchor: customer.character, offsetY: 1.65, speak: false });
    audio.playSfx('retry');
    updateReadyCue();
  }

  function performAction() {
    if (!active || phase !== 'service') return;
    if (actionType === 'collect' && actionDishCustomer) collectDish(actionDishCustomer);
    else if (actionType === 'deliver' && actionCustomer) deliver(actionCustomer);
    else if (actionType === 'remind' && actionCustomer) remind(actionCustomer);
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

  function losesPatience(state) {
    return state === 'waiting' || state === 'preparing' || state === 'ready';
  }

  function isSeated(state) {
    return state === 'waiting' || state === 'preparing' || state === 'ready' || state === 'carried';
  }

  function canBeReminded(state) {
    return state === 'preparing' || state === 'ready';
  }

  function hasCustomerInState(state) {
    for (const customer of customers) {
      if (customer.state === state) return true;
    }
    return false;
  }

  function updateMovement(dt) {
    input.getMovement(move);
    if (move.lengthSq() === 0) {
      player.playAnimation?.('idle');
      return;
    }
    const nextX = player.position.x + move.x * MOVE_SPEED * dt;
    const nextZ = player.position.z - move.y * MOVE_SPEED * dt;
    if (canOccupy(nextX, player.position.z)) player.position.x = nextX;
    if (canOccupy(player.position.x, nextZ)) player.position.z = nextZ;
    const wantedRotation = Math.atan2(move.x, move.y);
    player.rotation.y = THREE.MathUtils.lerp(player.rotation.y, wantedRotation, 1 - Math.exp(-12 * dt));
    player.playAnimation?.('walk');
  }

  function updateCustomers(dt) {
    for (const customer of customers) {
      if (customer.state === 'scheduled' && elapsed >= customer.spawnAt) {
        customer.state = 'waiting';
        customer.character.visible = true;
        customer.meter.visible = true;
        customer.character.playAnimation?.('idle');
      }

      if (losesPatience(customer.state)) {
        customer.patience = Math.max(0, customer.patience - dt);
        const ratio = customer.patience / customer.patienceMax;
        customer.fill.scale.x = Math.max(0.001, ratio);
        customer.fill.position.x = -(1 - ratio) * 0.625;
        if (ratio < 0.28) customer.fillMaterial.color.setHex(0xef5350);
        else if (ratio < 0.56) customer.fillMaterial.color.setHex(0xffc847);
        else customer.fillMaterial.color.setHex(0x5bd16f);
        if (customer.patience <= 0) leaveCustomer(customer);
      }

      if (customer.state === 'preparing') {
        customer.prepRemaining -= dt;
        if (customer.prepRemaining <= 0) makeReady(customer);
      } else if (customer.state === 'leaving') {
        customer.leaveSeconds += dt;
        customer.character.position.x += 1.75 * dt;
        customer.character.position.z += 0.45 * dt;
        if (customer.leaveSeconds >= 3.2) {
          customer.state = 'left';
          customer.character.visible = false;
        }
      }

      if (customer.character.visible) customer.character.updateAnimation?.(dt);
      if (customer.meter.visible) {
        customer.character.getWorldPosition(meterPosition);
        customer.meter.position.copy(meterPosition);
        customer.meter.position.y += 1.75;
        customer.meter.quaternion.copy(camera.quaternion);
      }
    }
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
    for (const customer of customers) {
      if (customer.state !== 'ready') continue;
      const dx = player.position.x - SLOT_X[customer.index];
      const dz = player.position.z + 5.05;
      const distance = dx * dx + dz * dz;
      if (distance < best) {
        best = distance;
        nearest = customer;
      }
    }
    return nearest;
  }

  function updateContext() {
    if (speechCooldown > 0) {
      hideAction();
      return;
    }

    const nearbyCustomer = nearestSeatedCustomer();
    if (carried) {
      clearQuestion();
      setInstruction(STRINGS.walkToDeliver);
      if (nearbyCustomer) showAction(STRINGS.deliverDish, 'deliver', nearbyCustomer);
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

    if (nearbyCustomer?.state === 'waiting') {
      hideAction();
      targetQuestion(nearbyCustomer);
      return;
    }

    clearQuestion();
    if (nearbyCustomer && canBeReminded(nearbyCustomer.state)) {
      showAction(STRINGS.remindCost, 'remind', nearbyCustomer);
      return;
    }
    hideAction();

    if (hasCustomerInState('ready')) setInstruction(STRINGS.walkToCounter);
    else if (hasCustomerInState('waiting')) setInstruction(STRINGS.walkToCustomer);
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
    const puffs = carried.dish.userData.steam;
    for (let index = 0; index < puffs.length; index += 1) {
      const puff = puffs[index];
      puff.visible = steamVisible;
      puff.position.y = 0.64 + ((elapsed * 0.24 + index * 0.21) % 0.42);
      puff.position.x = (index - 1) * 0.17 + Math.sin(elapsed * 2.4 + index) * 0.035;
    }
  }

  function calculateStars() {
    let score = -reminders * 0.5;
    for (const customer of customers) {
      if (customer.state !== 'delivered') continue;
      score += 4 + customer.temperatureScore + customer.patienceAtDelivery * 2;
    }
    const ratio = Math.max(0, score) / (customers.length * 9);
    if (ratio >= 0.78) return 3;
    if (ratio >= 0.45) return 2;
    return 1;
  }

  function completeTurnaround(answer) {
    if (!active || completed || phase !== 'turnaround') return;
    completed = true;
    acceptedAnswer = answer || LESSON.answers[0];
    phase = 'finishing';
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
    temperature.hidden = true;
    dialogue.show({ text: LESSON.question, anchor: host, offsetY: 1.8 });
    setInstruction(STRINGS.turnaround);
    cameraRig
      .setTarget(host)
      .setPreset('closeup', { offset: [3.2, 3.1, 4.8], lookOffset: [0, 1.2, 0], damping: 5.5 });
    configureSpeech({
      mode: 'answer',
      sentence: LESSON.answerExample,
      fallbackAnswer: LESSON.answers[0],
      onAccepted: completeTurnaround,
    });
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
    actionDishCustomer = null;
    instructionText = '';
    temperatureText = '';
    reminders = 0;
    acceptedAnswer = null;
    createOverlay();
    buildWorld();
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

    if (phase === 'service') {
      updateMovement(safeDt);
      updateCustomers(safeDt);
      updateCarried(safeDt);
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
    unsubscribeSettings?.();
    unsubscribeSettings = null;
    speech.clearTarget();
    speech.cancel();
    audio.stop();
    hud.hide();
    dialogue.hide();
    cameraRig.setTarget(null);
    actionButton?.removeEventListener('click', performAction);
    overlay?.remove();
    style?.remove();
    overlay = null;
    style = null;
    instruction = null;
    actionButton = null;
    notice = null;
    temperature = null;
    player?.disposeCharacter?.();
    host?.disposeCharacter?.();
    for (const customer of customers) customer.character.disposeCharacter?.();
    customers.length = 0;
    if (world) scene.remove(world);
    world = null;
    player = null;
    carryAnchor = null;
    host = null;
    readyCue = null;
    bellDome = null;
    carried = null;
    questionCustomer = null;
    dialogueCustomer = null;
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    geometries.clear();
    materials.clear();
  }

  return { id: 'restaurant', enter, update, exit };
}
