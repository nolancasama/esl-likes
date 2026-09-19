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
import { chooseAction } from './actionPriority.js';
import { RESTAURANT_OWNERS, createCustomerClaimRegistry } from './claims.js';
import { RIVAL_LEVELS, RIVAL_SPEED, createRestaurantRival } from './rival.js';
import {
  RUSH_PLAYER_DELIVERIES,
  competitionOutcome,
  createCompetitionScore,
  createRushTrigger,
} from './rushTrigger.js';
import {
  RIVAL_CHALLENGE_REACTION_SECONDS,
  RIVAL_REVEAL_TIMING,
  createRivalChallenge,
} from './rivalChallenge.js';
import {
  RESULT_STAGE_LAYOUT,
  RESULT_STAGE_TIMING,
  createResultStage,
} from './resultStage.js';
import { reactionPose } from './reactionPose.js';
import {
  RIVAL_IDS,
  ROUND_TWO,
  competitiveRoundTotal,
  createRivalProgression,
} from './rivalProgression.js';
import { createTypewriter, parseFurigana } from './typewriter.js';
import {
  OWNERSHIP_BUBBLE_TEXT,
  PATIENCE_LOW,
  PATIENCE_SECONDS,
  drainPatience,
  isTalkable,
  ownershipBubble,
} from './customerState.js';

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
// The final question comes from someone already in the story: the rival once it
// has arrived, otherwise a served customer. Short approach, then a friendly nod.
const TURNAROUND_WALK_SECONDS = 1.1;
const TURNAROUND_MIN_SPEED = 4;
const TURNAROUND_MAX_SPEED = 8;
const TURNAROUND_WAVE_SECONDS = 0.7;
const RESTAURANT_DOOR = Object.freeze({ x: 0, z: 6.6 });
const HOT_SECONDS = 9;
const WARM_SECONDS = 22;
const REFUSAL_SECONDS = 5;
const EATING_SECONDS = 3.2;
const CUSTOMER_WALK_SPEED = 10;
// Click-to-walk steers past any table lying across its straight line.
const STEER_RADIUS = 1.45;
const STEER_CLEARANCE = 1.75;
const RIVAL_ENTRANCE_START = Object.freeze({ x: -2.1, z: 6.6 });
const RIVAL_ENTRANCE_END = Object.freeze({ x: -2.1, z: 2.4 });
const RIVAL_ENTRANCE_SPEED = 4;
const ROOM_CAMERA = Object.freeze({ position: [0, 11.5, 12], lookAt: [0, 0.8, 0.6], damping: 5 });
// The entrance establishes the aisle before the reveal punches in, then receives
// the returning camera before the dialogue is allowed to appear.
const ENTRANCE_CAMERA = Object.freeze({ position: [-0.8, 6.4, 9.6], lookAt: [-2.1, 1.1, 3.3], damping: 5 });
const CHALLENGE_CLOSEUP_CAMERA = Object.freeze({
  position: [-1.3, 2.0, 5.65],
  lookAt: [-2.1, 1.3, 2.4],
  damping: 9.5,
});
const CHALLENGE_CLOSEUP_HALF_WIDTH = 1.25;
const RIVAL_TITLE_FADE_SECONDS = 0.25;
const RIVAL_POSE_RETURN_SECONDS = 0.35;
// The walk carries a cautious warning into a bright rising run. The reveal
// accent is separate so BA-BAM lands on the camera punch-in, not a wall-clock guess.
const RIVAL_WALK_JINGLE = Object.freeze([
  Object.freeze({ at: 0, frequency: 196, endFrequency: 208, duration: 0.14, type: 'triangle', gain: 0.09 }),
  Object.freeze({ at: 0.2, frequency: 233, endFrequency: 247, duration: 0.14, type: 'triangle', gain: 0.09 }),
  Object.freeze({ at: 0.4, frequency: 294, endFrequency: 330, duration: 0.12, type: 'square', gain: 0.08 }),
  Object.freeze({ at: 0.57, frequency: 349, endFrequency: 392, duration: 0.12, type: 'square', gain: 0.085 }),
  Object.freeze({ at: 0.73, frequency: 440, endFrequency: 494, duration: 0.12, type: 'triangle', gain: 0.095 }),
  Object.freeze({ at: 0.89, frequency: 523, endFrequency: 587, duration: 0.15, type: 'triangle', gain: 0.1 }),
]);
const RIVAL_REVEAL_ACCENT = Object.freeze([
  Object.freeze({ at: 0, frequencies: Object.freeze([392, 523, 587]), duration: 0.17, gain: 0.12 }),
  Object.freeze({ at: 0.12, frequencies: Object.freeze([523, 659, 784]), duration: 0.28, gain: 0.15 }),
]);
// Patience strip inside the waiting bubble, in bubble-sprite units (2.0 x 1.0;
// 256 texture px per unit). Thick enough that green/amber/red reads from the
// fixed room camera; it sits inside the track drawn at y 144–188 px.
const PATIENCE_FILL_WIDTH = 1.42;
const PATIENCE_FILL_HEIGHT = 0.13;
const PATIENCE_FILL_Y = -0.148;
// Red strip: the bubble pulses gently so "almost gone" is noticed.
const PATIENCE_URGENT_PULSE = 0.07;
// Long enough for the delivery's thanks, temperature and combo to land first.
const RUSH_BEAT_SECONDS = 1.6;
const ROUND_END_SECONDS = 1.3;
// In front of the middle table's chair (seat z 0.75), so nothing sits in the foreground.
// With the stage score and label above it, the result label only reaches the sign's frame.
const RESULT_CAMERA = Object.freeze({ position: [0, 2.9, 0.4], lookAt: [0, 1.75, -4.6], damping: 5.5 });
// Frozen room beat between the final resolution and the stage.
const RESULT_STAGE_LEAD_IN_SECONDS = 0.9;
// Half the frame width, at the waiters' depth, that both staged waiters need.
const RESULT_STAGE_HALF_WIDTH = 2.2;
const RESULT_QUESTION_CAMERA = Object.freeze({ position: [0, 2.2, 0.6], lookAt: [0, 1.55, -4.2], damping: 3 });
// The rematch question has a bottom panel, not a bubble: aim lower and pull back
// so both waiters stand above the panel instead of behind it.
const REMATCH_CAMERA = Object.freeze({ position: [0, 2.4, 1.6], lookAt: [0, 0.95, -4.2], damping: 3 });
// Short note sequences (seconds, Hz); each whole sting is well under a second.
const RESULT_STINGS = Object.freeze({
  player: [[0, 523], [0.11, 659], [0.22, 784], [0.33, 1046]],
  rival: [[0, 587], [0.16, 494], [0.32, 392]],
  draw: [[0, 698], [0.18, 880]],
});
const RIVAL_MIN_SPEED = RIVAL_SPEED * 0.7;
// Round 2 Challenge's rival (5.15) must not be slowed by the walk clamp.
const RIVAL_MAX_SPEED = Math.max(RIVAL_SPEED * 1.3, ROUND_TWO[3].rival.speed * 1.15);
// Two different waiters. Kenney models ignore tint, so Waiter 2 reads as a new
// person through another face, hair and moustache (model 'k'), a black apron
// instead of the white one (a red one vanished into k's red shirt), and a gold
// bow tie. Neither model is the player's or a customer's.
const RIVAL_CAST = Object.freeze({
  [RIVAL_IDS.WAITER_1]: Object.freeze({
    model: 'r', tint: 0x4b78c5, apron: 0xffffff, apronEmissive: 0x333333, bowTie: null,
  }),
  [RIVAL_IDS.WAITER_2]: Object.freeze({
    model: 'k', tint: 0xd8563f, apron: 0x22252e, apronEmissive: 0x08090c, bowTie: 0xffcf33,
  }),
});
// After losing Round 1, Waiter 1 leaves down the aisle it arrived by.
const RIVAL_EXIT_WAYPOINTS = Object.freeze([
  Object.freeze({ x: -2.1, z: -3.3 }),
  Object.freeze({ x: -2.1, z: 7.4 }),
]);
const RIVAL_EXIT_SPEED = 6;
const REMATCH_CHOICE_GUARD_SECONDS = 0.35;
const PLAYER_START = Object.freeze({ x: 0, z: 5.7 });

const TABLES = Object.freeze([
  Object.freeze({ x: -4.2, z: -1.0, seatX: -4.2, seatZ: -2.05 }),
  Object.freeze({ x: 0, z: 1.8, seatX: 0, seatZ: 0.75 }),
  Object.freeze({ x: 4.2, z: -1.0, seatX: 4.2, seatZ: -2.05 }),
  Object.freeze({ x: -4.2, z: 3.9, seatX: -4.2, seatZ: 2.85 }),
  Object.freeze({ x: 4.2, z: 3.9, seatX: 4.2, seatZ: 2.85 }),
]);

const DIFFICULTY = Object.freeze({
  // Patience drains only once claimed (PATIENCE_SECONDS in customerState.js):
  // one or two held orders comfortable, three needs attention, claiming almost
  // everyone is risky (not yet playtested in class; tune there).
  1: Object.freeze({ count: 3, total: 5, prepScale: 0.55, patience: PATIENCE_SECONDS[1], preOrderDrain: 0 }),
  2: Object.freeze({ count: 4, total: 9, prepScale: 0.85, patience: PATIENCE_SECONDS[2], preOrderDrain: 0 }),
  3: Object.freeze({ count: 5, total: 13, prepScale: 1.3, patience: PATIENCE_SECONDS[3], preOrderDrain: 0 }),
});

const CUSTOMER_TINTS = Object.freeze([0xff7d63, 0x54b8ff, 0xb36bff, 0x4bd596, 0xffcf45]);
const CUSTOMER_MODELS = Object.freeze(['e', 'f', 'i', 'm', 'q']);
const RESTAURANT_SIGN_TEXT = 'MATSUBARA RESTAURANT';
// Two lines: compared at 1366x768 against one line, whose letters were too
// small to read from the fixed camera (DESIGN_DECISIONS 2026-09-17).
const RESTAURANT_SIGN_LINES = Object.freeze(['MATSUBARA', 'RESTAURANT']);

// Renders '{漢字|かんじ}' segments as <ruby> furigana, everything else as text.
function appendFurigana(element, text) {
  const pattern = /\{([^|}]+)\|([^}]+)\}/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) element.append(text.slice(last, match.index));
    const ruby = document.createElement('ruby');
    const reading = document.createElement('rt');
    reading.textContent = match[2];
    ruby.append(match[1], reading);
    element.append(ruby);
    last = match.index + match[0].length;
  }
  if (last < text.length) element.append(text.slice(last));
}

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
  let turnaroundPartner = null;
  const turnaroundWalk = { walking: false, targetX: 0, targetZ: 0, waveRemaining: 0 };
  const turnaroundAim = new THREE.Vector2();
  let rivalCharacter = null;
  let rivalCarryAnchor = null;
  let rivalCarriedDish = null;
  let conveyor = null;
  let conveyorSurface = null;
  let dishReturnAnchor = null;
  let dishReturnLabel = null;
  let signAnchor = null;
  let overlay = null;
  let style = null;
  let instruction = null;
  let actionButton = null;
  let notice = null;
  let temperature = null;
  let comboPop = null;
  let phasePill = null;
  let scoreText = null;
  let rivalTitle = null;
  let resultLabel = null;
  let resultOutcome = null;
  let resultStage = null;
  let resultStageStartCount = 0;
  let resultStagePendingOutcome = null;
  let resultStageBeltTravel = null;
  let resultPoseState = null;
  let resultNextNote = 0;
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
  let rushTrigger = null;
  let competitionScore = null;
  let rushBeatRemaining = 0;
  let rivalChallenge = null;
  let rivalEmoteRemaining = 0;
  let rivalEntranceLabel = null;
  let challengePanel = null;
  let challengeLine = null;
  let challengeReplies = null;
  let challengeTypewriter = null;
  let challengeLineUnits = [];
  const challengeSuppressedKeys = new Set();
  let challengePoseState = null;
  let rivalTurnStartRotation = Math.PI;
  let rivalIntroJingleElapsed = 0;
  let rivalIntroNextNote = 0;
  let rivalRevealAccentElapsed = null;
  let rivalRevealAccentNext = 0;
  let rivalCameraCloseup = false;
  let createRivalCharacter = null;
  // Rival progression (Normal/Challenge only): which waiter, which round.
  let progression = null;
  const rivalCharacters = {};
  let rematchChoiceActive = false;
  let rematchChoiceShownAt = -Infinity;
  let roundPatience = null;
  let overlayCreates = 0;
  const rivalExit = { character: null, index: 0 };
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
  const debugProjection = new THREE.Vector3();
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
    targetX: RIVAL_ENTRANCE_END.x,
    targetZ: RIVAL_ENTRANCE_END.z,
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
    syncHud();
  }

  // Cinematic moments keep the upper-left hint out of the picture. The
  // turnaround close-up keeps its "your turn" hint: the child's role flips there.
  function hintSuppressed() {
    return rivalIntroActive()
      || Boolean(resultStage?.active)
      || phase === 'round-end' || phase === 'turnaround-approach' || phase === 'finishing'
      || phase === 'round-transition';
  }

  function syncHud() {
    if (!instruction || !overlay) return;
    instruction.hidden = !instructionText || hintSuppressed();
    const modal = rivalIntroActive() || rematchChoiceActive;
    overlay.classList.toggle('restaurant-ui--modal', modal);
    // The challenge is answered with buttons, never the microphone: the Talk HUD
    // (outside this overlay) stays hidden however something tries to show it.
    const resultPrelude = resultStage?.phase === 'reaction' || resultStage?.phase === 'settling';
    if ((modal || resultPrelude) && !hud.element.hidden) hud.hide();
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
    actionDish = type === 'collect' || type === 'exchange' ? target : null;
    actionButton.textContent = text;
    actionButton.hidden = false;
  }

  function createOverlay() {
    style = document.createElement('style');
    style.textContent = `
      .restaurant-ui { position: absolute; inset: 0; pointer-events: none; }
      /* Upper-centre stack: score (persistent), phase cue, then notices. */
      .restaurant-ui__notice { position: absolute; top: 7.4rem; left: 50%; transform: translateX(-50%);
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
      .restaurant-ui__phase { position: absolute; left: 50%; top: 4.3rem; transform: translateX(-50%);
        padding: .38rem .85rem; border: .16rem solid #fff; border-radius: 999px;
        background: #ef8a17; color: #fff; box-shadow: 0 .22rem 0 rgb(35 49 71 / .24);
        font: 900 calc(.92rem * var(--ui-scale, 1)) system-ui, sans-serif; }
      /* Upper left: the current action hint only, sized to its text. The room
         name is on the wall sign; shift progress is not shown. */
      .restaurant-ui__hint { position: absolute; top: max(12px, env(safe-area-inset-top)); left: 12px;
        box-sizing: border-box; max-width: min(46vw, 22rem); margin: 0; padding: .5rem .9rem;
        border-radius: 1rem; background: rgb(255 255 255 / 92%); color: #1b2940;
        box-shadow: 0 6px 18px rgb(28 71 102 / 20%); line-height: 1.35;
        font: 800 calc(1rem * var(--ui-scale, 1)) system-ui, sans-serif; }
      /* Modal states (rival challenge): ordinary controls and notices step aside. */
      .restaurant-ui--modal .restaurant-ui__hint, .restaurant-ui--modal .restaurant-ui__action,
      .restaurant-ui--modal .restaurant-ui__notice, .restaurant-ui--modal .restaurant-ui__combo,
      .restaurant-ui--modal .restaurant-ui__temperature, .restaurant-ui--modal .listen-again { display: none; }
      .restaurant-ui__score { position: absolute; left: 50%; top: 1rem; transform: translateX(-50%);
        white-space: nowrap; padding: .48rem .8rem;
        border: .18rem solid #fff; border-radius: 999px; background: #315d92; color: #fff;
        box-shadow: 0 .25rem 0 rgb(35 49 71 / .24);
        font: 900 calc(.92rem * var(--ui-scale, 1)) system-ui, sans-serif;
        transition: top .5s ease, transform .5s ease, font-size .5s ease, padding .5s ease; }
      .restaurant-ui__title { position: absolute; left: 50%; top: 26%; white-space: nowrap;
        transform: translateX(-50%) rotate(-3deg); color: #fff; -webkit-text-stroke: .16rem #1b2233;
        paint-order: stroke fill; filter: drop-shadow(0 .35rem 0 #1b2233);
        font: 1000 calc(clamp(2.2rem, 5.5vw, 3.8rem) * var(--ui-scale, 1)) system-ui, sans-serif;
        opacity: 1; transition: opacity .25s ease; animation: restaurant-title-pop .28s ease-out; }
      .restaurant-ui__title--fading { opacity: 0; }
      @keyframes restaurant-title-pop { from { transform: translateX(-50%) rotate(-3deg) scale(.6); opacity: 0; } }
      .restaurant-ui__score--result { padding: .7rem 1.2rem; background: #273858;
        font-size: calc(1.45rem * var(--ui-scale, 1)); animation: restaurant-score-pop .3s ease-out; }
      .restaurant-ui__score--stage { top: .8rem; padding: .78rem 1.3rem; background: #273858;
        font-size: calc(2rem * var(--ui-scale, 1)); animation: restaurant-score-pop .3s ease-out; }
      .restaurant-ui__score--stage.restaurant-ui__score--compact { top: .6rem; padding: .48rem .8rem;
        font-size: calc(.92rem * var(--ui-scale, 1)); }
      @keyframes restaurant-score-pop { from { transform: translateX(-50%) scale(.7); } }
      /* Result under the enlarged score; colour follows who won, never a fail red. */
      .restaurant-ui__result { position: absolute; left: 50%; top: 5.3rem; white-space: nowrap; line-height: 1;
        transform: translateX(-50%) rotate(-3deg); color: #ffd43b; -webkit-text-stroke: .15rem #55380b;
        paint-order: stroke fill; filter: drop-shadow(0 .32rem 0 #fff);
        font: 1000 calc(clamp(2rem, 5vw, 3.4rem) * var(--ui-scale, 1)) system-ui, sans-serif;
        opacity: 1; transition: opacity .3s ease; animation: restaurant-title-pop .28s ease-out; }
      .restaurant-ui__result--fading { opacity: 0; }
      .restaurant-ui__result[data-outcome="rival"] { color: #fff; -webkit-text-stroke-color: #1b2233;
        filter: drop-shadow(0 .32rem 0 #1b2233); }
      .restaurant-ui__result[data-outcome="draw"] { color: #fff; -webkit-text-stroke-color: #315d92;
        filter: drop-shadow(0 .32rem 0 #315d92); }
      /* The rival's challenge: an RPG-style box along the bottom, below the rival. */
      /* z-index above the Talk HUD (20), Listen Again (21) and dialogue bubbles (18). */
      .restaurant-ui__challenge { position: absolute; z-index: 40; left: 50%; bottom: 1rem; transform: translateX(-50%);
        box-sizing: border-box; width: min(94vw, 52rem); padding: 1.25rem 1.3rem 1.1rem;
        pointer-events: auto;
        border: .28rem solid #273858; border-radius: 1.5rem; background: #fff; color: #1b2940;
        box-shadow: 0 .45rem 0 rgb(28 48 78 / .28); animation: restaurant-challenge-in .22s ease-out; }
      @keyframes restaurant-challenge-in { from { transform: translateX(-50%) translateY(1.2rem); opacity: 0; } }
      .restaurant-ui__challenge-line { margin: 0; white-space: pre-line; text-align: center; line-height: 1.5;
        font: 900 calc(clamp(1.35rem, 3.3vw, 1.9rem) * var(--ui-scale, 1)) system-ui, sans-serif; }
      .restaurant-ui__challenge-unit { visibility: hidden; }
      .restaurant-ui__challenge rt { font-size: .5em; font-weight: 700; color: #4d5b73; }
      .restaurant-ui__challenge-replies { display: flex; flex-wrap: wrap; justify-content: center; gap: .7rem;
        margin-top: .9rem; }
      .restaurant-ui__challenge-replies[hidden] { display: none; }
      /* #ui-layer: the global "#ui-layer button { font: inherit }" outranks a class alone.
         nowrap: when space runs out a whole reply moves to the next row instead. */
      #ui-layer .restaurant-ui__challenge-reply { flex: 1 1 12rem; min-height: 4.4rem; padding: .5rem .9rem;
        white-space: nowrap; pointer-events: auto;
        border: .25rem solid #fff; border-radius: 1.3rem; background: #ef8a17; color: #fff;
        cursor: pointer; box-shadow: 0 .38rem 0 rgb(32 49 75 / .3);
        font: 900 calc(clamp(1.25rem, 2.8vw, 1.6rem) * var(--ui-scale, 1)) / 1.3 system-ui, sans-serif;
        animation: restaurant-challenge-reply-in .2s ease-out backwards; }
      @keyframes restaurant-challenge-reply-in { from { transform: translateY(.8rem); opacity: 0; } }
      .restaurant-ui__challenge-reply rt { color: #fff3dd; }
      #ui-layer .restaurant-ui__challenge-reply:hover { background: #f59a2c; }
      #ui-layer .restaurant-ui__challenge-reply:active { transform: translateY(.2rem); box-shadow: 0 .18rem 0 rgb(32 49 75 / .3); }
      .restaurant-ui__challenge-reply:focus-visible { outline: .32rem solid #ffcf33; outline-offset: .2rem; }
      @media (max-width: 44rem) { .restaurant-ui__temperature { right: 50%; bottom: 5.9rem; transform: translateX(50%); } }
      /* Narrow screens: the stage score stays clear of the settings button. */
      @media (max-width: 30rem) { .restaurant-ui__score--stage { font-size: calc(1.15rem * var(--ui-scale, 1)); } }
    `;
    document.head.append(style);

    overlay = document.createElement('div');
    overlay.className = 'restaurant-ui';
    overlay.innerHTML = `
      <p class="restaurant-ui__hint" role="status" aria-live="polite" hidden></p>
      <div class="restaurant-ui__notice" role="status" aria-live="polite" hidden></div>
      <div class="restaurant-ui__combo" role="status" aria-live="polite" hidden></div>
      <div class="restaurant-ui__phase" role="status" aria-live="polite" hidden></div>
      <div class="restaurant-ui__score" role="status" aria-live="polite" hidden></div>
      <div class="restaurant-ui__title" role="status" aria-live="polite" hidden></div>
      <div class="restaurant-ui__result" role="status" aria-live="polite" hidden></div>
      <section class="restaurant-ui__challenge" role="dialog" aria-live="polite" hidden>
        <p class="restaurant-ui__challenge-line"></p>
        <div class="restaurant-ui__challenge-replies" hidden></div>
      </section>
      <button class="restaurant-ui__action" type="button" hidden></button>
      <div class="restaurant-ui__temperature" role="status" hidden></div>
    `;
    instruction = overlay.querySelector('.restaurant-ui__hint');
    actionButton = overlay.querySelector('.restaurant-ui__action');
    notice = overlay.querySelector('.restaurant-ui__notice');
    comboPop = overlay.querySelector('.restaurant-ui__combo');
    phasePill = overlay.querySelector('.restaurant-ui__phase');
    scoreText = overlay.querySelector('.restaurant-ui__score');
    rivalTitle = overlay.querySelector('.restaurant-ui__title');
    rivalTitle.textContent = STRINGS.rivalTitle;
    resultLabel = overlay.querySelector('.restaurant-ui__result');
    challengePanel = overlay.querySelector('.restaurant-ui__challenge');
    challengeLine = challengePanel.querySelector('.restaurant-ui__challenge-line');
    challengeReplies = challengePanel.querySelector('.restaurant-ui__challenge-replies');
    setChallengeContent(STRINGS.rivalChallenge, STRINGS.rivalChallengeReplies);
    overlayCreates += 1;
    challengeReplies.addEventListener('click', onChallengeReply);
    challengePanel.addEventListener('click', onChallengePanelClick);
    window.addEventListener('keydown', onChallengeKey, true);
    window.addEventListener('keyup', onChallengeKeyUp, true);
    // A keyup lost to a window switch must not lock the keyboard out of the replies.
    window.addEventListener('blur', onChallengeBlur);
    temperature = overlay.querySelector('.restaurant-ui__temperature');
    actionButton.addEventListener('click', performAction);
    listenAgain = createListenAgain({ root: overlay, label: UI.listenAgain, onPress: listenAgainPressed });
    document.querySelector('#ui-layer').append(overlay);
    setInstruction(STRINGS.walkToCustomer);
  }

  // One panel for every rival exchange (either waiter's challenge, the rematch
  // question). Replaces the line, its typewriter and the reply buttons in place;
  // the listeners stay on the panel and the reply container.
  function setChallengeContent(lineText, replies) {
    if (!challengeLine || !challengeReplies) return;
    challengeLineUnits = parseFurigana(lineText);
    challengeTypewriter = createTypewriter({ units: challengeLineUnits, charsPerSecond: 30 });
    challengeLine.replaceChildren();
    challengeLine.setAttribute('aria-label', challengeLineUnits
      .map((unit) => unit.kind === 'ruby' ? unit.base : unit.text)
      .join(''));
    for (const unit of challengeLineUnits) {
      const span = document.createElement('span');
      span.className = 'restaurant-ui__challenge-unit';
      if (unit.kind === 'ruby') {
        const ruby = document.createElement('ruby');
        const reading = document.createElement('rt');
        reading.textContent = unit.reading;
        ruby.append(unit.base, reading);
        span.append(ruby);
      } else {
        span.textContent = unit.text;
      }
      challengeLine.append(span);
    }
    challengeReplies.replaceChildren();
    replies.forEach((reply, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'restaurant-ui__challenge-reply';
      button.dataset.reply = String(index);
      appendFurigana(button, reply);
      challengeReplies.append(button);
    });
  }

  function encounterStrings() {
    return progression?.rivalId === RIVAL_IDS.WAITER_2
      ? { title: STRINGS.rival2Title, line: STRINGS.rival2Challenge, replies: STRINGS.rival2ChallengeReplies }
      : { title: STRINGS.rivalTitle, line: STRINGS.rivalChallenge, replies: STRINGS.rivalChallengeReplies };
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

  // A wall-mounted board, not floating letters: wood frame, cream face,
  // brick-red lettering, brass trim and a small brass picture light.
  function buildRestaurantSign(box) {
    const lines = RESTAURANT_SIGN_LINES;
    const faceWidth = lines.length === 1 ? 6.2 : 3.7;
    const faceHeight = lines.length === 1 ? 0.92 : 1.36;
    const pixelsPerUnit = 200;
    const signCanvas = document.createElement('canvas');
    signCanvas.width = Math.round(faceWidth * pixelsPerUnit);
    signCanvas.height = Math.round(faceHeight * pixelsPerUnit);
    const context = signCanvas.getContext('2d');
    const { width, height } = signCanvas;
    context.fillStyle = '#f3e3c3';
    context.fillRect(0, 0, width, height);
    context.strokeStyle = '#c89a54';
    context.lineWidth = 6;
    context.strokeRect(14, 14, width - 28, height - 28);

    // Small steam-over-bowl mark on each side of a single line; above the text
    // on two lines. Restrained: the same red as the lettering.
    const drawMark = (cx, cy, size) => {
      context.save();
      context.strokeStyle = '#8e3f32';
      context.fillStyle = '#8e3f32';
      context.lineWidth = size * 0.1;
      context.lineCap = 'round';
      context.beginPath();
      context.arc(cx, cy, size * 0.5, 0, Math.PI);
      context.closePath();
      context.fill();
      for (const offset of [-0.22, 0, 0.22]) {
        context.beginPath();
        context.moveTo(cx + offset * size, cy - size * 0.12);
        context.quadraticCurveTo(cx + offset * size + size * 0.1, cy - size * 0.4, cx + offset * size, cy - size * 0.68);
        context.stroke();
      }
      context.restore();
    };

    context.fillStyle = '#8e3f32';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    const fontFamily = 'Georgia, "Times New Roman", serif';
    const markSize = height * (lines.length === 1 ? 0.42 : 0.2);
    const textWidth = width - (lines.length === 1 ? markSize * 2 + 150 : 90);
    let fontSize = height * (lines.length === 1 ? 0.58 : 0.29);
    const fit = () => {
      context.font = `700 ${fontSize}px ${fontFamily}`;
      return lines.every((line) => context.measureText(line).width <= textWidth);
    };
    while (fontSize > 20 && !fit()) fontSize -= 2;
    if (lines.length === 1) {
      context.fillText(lines[0], width / 2, height * 0.54);
      const half = context.measureText(lines[0]).width / 2;
      drawMark(width / 2 - half - markSize * 0.95, height * 0.62, markSize);
      drawMark(width / 2 + half + markSize * 0.95, height * 0.62, markSize);
    } else {
      drawMark(width / 2, height * 0.25, markSize);
      context.fillText(lines[0], width / 2, height * 0.49);
      context.fillText(lines[1], width / 2, height * 0.77);
    }

    const texture = ownTexture(new THREE.CanvasTexture(signCanvas));
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    // A faint warm self-light, as if lit by the picture light above it.
    const faceMaterial = ownMaterial(new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 0.85,
      emissive: 0xfff0d0,
      emissiveMap: texture,
      emissiveIntensity: 0.18,
    }));
    const frameMaterial = makeMaterial(0x6b4630, { roughness: 0.7 });
    const brassMaterial = makeMaterial(0xc89a54, { metalness: 0.5, roughness: 0.4 });

    signAnchor = new THREE.Group();
    signAnchor.name = 'matsubara-restaurant-sign';
    // Low on the wall, clear of the upper-centre score pill and above the belt.
    signAnchor.position.set(0, 2.45, -7.17);
    const frame = 0.13;
    addPart(signAnchor, box, frameMaterial, 0, 0, 0, faceWidth + frame * 2, faceHeight + frame * 2, 0.12);
    const face = new THREE.Mesh(ownGeometry(new THREE.PlaneGeometry(faceWidth, faceHeight)), faceMaterial);
    face.position.z = 0.065;
    signAnchor.add(face);
    const lampY = faceHeight / 2 + frame + 0.12;
    addPart(signAnchor, box, brassMaterial, 0, lampY, 0.2, faceWidth * 0.45, 0.07, 0.09);
    for (const x of [-0.25, 0.25]) addPart(signAnchor, box, brassMaterial, x * faceWidth * 0.8, lampY - 0.02, 0.1, 0.04, 0.04, 0.2);
    world.add(signAnchor);
  }

  // A small physical label fixed to the tub's camera-facing rim. Its teal frame
  // belongs to the return station; it is intentionally not styled as a bin.
  function buildDishReturnSign(box) {
    const faceWidth = 1.2;
    const faceHeight = 0.5;
    const signCanvas = document.createElement('canvas');
    signCanvas.width = 480;
    signCanvas.height = 200;
    const context = signCanvas.getContext('2d');
    context.fillStyle = '#fff7df';
    context.fillRect(0, 0, signCanvas.width, signCanvas.height);
    context.strokeStyle = '#287b83';
    context.lineWidth = 18;
    context.strokeRect(9, 9, signCanvas.width - 18, signCanvas.height - 18);
    context.fillStyle = '#174f57';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = '900 118px system-ui, sans-serif';
    context.fillText(STRINGS.returnSign, signCanvas.width / 2, signCanvas.height * 0.51);

    const texture = ownTexture(new THREE.CanvasTexture(signCanvas));
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    const faceMaterial = ownMaterial(new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 0.82,
      emissive: 0xfff3d4,
      emissiveMap: texture,
      emissiveIntensity: 0.12,
    }));
    const frameMaterial = makeMaterial(0x287b83, { roughness: 0.62 });

    dishReturnLabel = new THREE.Group();
    dishReturnLabel.name = 'restaurant-dish-return-label';
    dishReturnLabel.position.set(0, 1.36, 0.43);
    dishReturnLabel.rotation.set(-0.54, -0.37, 0);
    addPart(dishReturnLabel, box, frameMaterial, 0, 0, -0.025, faceWidth + 0.12, faceHeight + 0.12, 0.08);
    const face = new THREE.Mesh(ownGeometry(new THREE.PlaneGeometry(faceWidth, faceHeight)), faceMaterial);
    face.position.z = 0.02;
    dishReturnLabel.add(face);
    for (const x of [-0.42, 0.42]) {
      addPart(dishReturnLabel, box, frameMaterial, x, -0.36, -0.04, 0.055, 0.3, 0.055);
    }
    dishReturnAnchor.add(dishReturnLabel);
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
    // Conveyor as family-restaurant cabinetry, not factory kit: cream enamel
    // housing, dark belt (food contrast), brushed stainless rails, a wood
    // cabinet below and one thin teal stripe.
    const metalMaterial = makeMaterial(0xb8c3c1, { metalness: 0.45, roughness: 0.35 });
    const darkMetalMaterial = makeMaterial(0x52636b, { metalness: 0.4, roughness: 0.5 });
    const housingMaterial = makeMaterial(0xe6d7bc, { roughness: 0.5 });
    const cabinetMaterial = makeMaterial(0xb5733a);
    const cabinetSeamMaterial = makeMaterial(0x7a4a2a);
    const beltMaterial = makeMaterial(0x283238, { roughness: 0.72 });
    const beltSlatMaterial = makeMaterial(0x4f5d63, { metalness: 0.25, roughness: 0.55 });
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
    // Cream housing (y 0.62–1.0) over a wood cabinet (y 0–0.62).
    addPart(world, box, housingMaterial, 0, 0.81, BELT_CENTER_Z, 15.7, 0.38, 1.34);
    addPart(world, box, trimMaterial, 0, 0.9, BELT_CENTER_Z + 0.68, 15.7, 0.06, 0.02);
    addPart(world, box, metalMaterial, 0, 0.62, BELT_CENTER_Z + 0.02, 15.7, 0.04, 1.34);
    addPart(world, box, cabinetMaterial, 0, 0.33, BELT_CENTER_Z, 15.7, 0.58, 1.2);
    addPart(world, box, cabinetSeamMaterial, 0, 0.04, BELT_CENTER_Z - 0.04, 15.7, 0.08, 1.2);
    for (const x of [-5.6, -2.8, 0, 2.8, 5.6]) {
      addPart(world, box, cabinetSeamMaterial, x, 0.36, BELT_CENTER_Z + 0.605, 0.06, 0.44, 0.02);
    }
    addPart(world, box, metalMaterial, 0, 1.22, BELT_CENTER_Z - 0.66, 15.8, 0.2, 0.12);
    addPart(world, box, metalMaterial, 0, 1.22, BELT_CENTER_Z + 0.66, 15.8, 0.2, 0.12);
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
    buildDishReturnSign(box);
    world.add(dishReturnAnchor);
    buildRestaurantSign(box);

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

    // Built on first entrance; `rivalCharacter` is always the current waiter.
    createRivalCharacter = (id, position) => {
      let character = rivalCharacters[id];
      if (!character) {
        const cast = RIVAL_CAST[id];
        character = characters.create({ model: cast.model, tint: cast.tint });
        character.name = `restaurant-rival-${id}`;
        character.position.set(position.x, 0, position.z);
        character.rotation.y = Math.PI;
        character.scale.setScalar(0.78);
        // A bright apron is readable even when the textured character ignores
        // tint, and keeps this waiter distinct from every seated customer.
        // White, not navy: the dark model plus a navy apron read as one more customer.
        const apronMaterial = makeMaterial(cast.apron, { emissive: cast.apronEmissive });
        addPart(character, box, apronMaterial, 0, 1.06, 0.28, 0.56, 0.64, 0.08);
        // The apron ties round the waist: the rival mostly walks away from the
        // fixed camera, and from behind the front panel alone read as a dark customer.
        addPart(character, box, apronMaterial, 0, 1.2, 0, 0.62, 0.14, 0.62);
        if (cast.bowTie !== null) {
          const tieMaterial = makeMaterial(cast.bowTie, { emissive: 0x3a2a00 });
          const left = addPart(character, box, tieMaterial, -0.1, 1.47, 0.3, 0.16, 0.13, 0.06);
          const right = addPart(character, box, tieMaterial, 0.1, 1.47, 0.3, 0.16, 0.13, 0.06);
          left.rotation.z = 0.35;
          right.rotation.z = -0.35;
          addPart(character, box, tieMaterial, 0, 1.47, 0.32, 0.07, 0.08, 0.06);
        }
        const anchor = new THREE.Group();
        anchor.position.set(0, 1.42, 0.58);
        character.add(anchor);
        character.userData.restaurantCarryAnchor = anchor;
        character.userData.restaurantRivalId = id;
        world.add(character);
        rivalCharacters[id] = character;
      }
      character.visible = true;
      if (rivalCharacter !== character) {
        rivalCharacter = character;
        rivalCarryAnchor = character.userData.restaurantCarryAnchor;
        rivalAnimation = '';
      }
      return character;
    };

    const hitGeometry = ownGeometry(new THREE.BoxGeometry(1.2, 2.1, 0.8));
    const hitMaterial = makeMaterial(0xffffff, { transparent: true, opacity: 0, depthWrite: false });
    function createOwnershipMaterial({ fill, text, outline, label = OWNERSHIP_BUBBLE_TEXT, fontSize = 84, track = null }) {
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
      context.font = `900 ${fontSize}px system-ui, sans-serif`;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(label, 256, track ? 90 : 112);
      if (track) {
        context.fillStyle = track;
        context.beginPath();
        context.roundRect(68, 144, 376, 44, 22);
        context.fill();
      }
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
      fill: '#ffffff', text: '#1b2940', outline: '#273858', track: '#d3d9e3',
    });
    const rivalBubbleMaterial = createOwnershipMaterial({
      fill: '#1b2233', text: '#ffffff', outline: '#ffffff', track: '#434d63',
    });
    const patienceMaterial = (color) => ownMaterial(new THREE.SpriteMaterial({
      color, transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
    }));
    const patienceMaterials = {
      high: patienceMaterial(0x35c46a),
      medium: patienceMaterial(0xf5b52e),
      low: patienceMaterial(0xe8463a),
    };
    // Entrance-only tag: from behind, the walking rival read as a dark customer.
    // Same dark style as the rival's bubbles, so the pairing carries into play.
    rivalEntranceLabel = new THREE.Sprite(createOwnershipMaterial({
      fill: '#1b2233', text: '#ffffff', outline: '#ffffff', label: STRINGS.rivalLabel,
    }));
    rivalEntranceLabel.scale.set(2.0, 1.0, 1);
    rivalEntranceLabel.visible = false;
    rivalEntranceLabel.renderOrder = 1000;
    world.add(rivalEntranceLabel);
    customerVisuals = {
      hitGeometry,
      hitMaterial,
      playerBubbleMaterial,
      rivalBubbleMaterial,
      patienceMaterials,
    };

    scene.add(world);
    // The whole dining room at once, not a camera that follows the waiter. With
    // the follow camera the front tables slid off the bottom edge whenever the
    // child stood at the back service wall, so a customer could be asking for service
    // from off-screen — fatal for a game whose mechanic is choosing who to serve
    // next. The room is small enough to frame entirely, so it is.
    cameraRig
      .setTarget(player)
      .setPreset('fixed', ROOM_CAMERA);
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
    // A child of the bubble: the bubble copies the camera's orientation, so its
    // local axes are screen right/up, and hiding the bubble hides the strip.
    const patienceFill = new THREE.Sprite(customerVisuals.patienceMaterials.high);
    patienceFill.center.set(0, 0.5);
    patienceFill.position.set(-PATIENCE_FILL_WIDTH / 4, PATIENCE_FILL_Y, 0);
    patienceFill.renderOrder = 1001;
    ownership.add(patienceFill);

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
      patienceMax: roundPatience ?? configured.patience,
      patience: roundPatience ?? configured.patience,
      character,
      clickTarget,
      ownership,
      patienceFill,
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

  function showPhaseCue(nextPhase, label = null) {
    if (!phasePill || nextPhase === 'warmup') return;
    phasePill.textContent = label ?? (nextPhase === 'rush' ? STRINGS.rush : STRINGS.finalPush);
    phasePill.hidden = false;
    phasePillRemaining = 2.2;
    audio.playSfx('restaurant-phase', { frequency: 620, endFrequency: 920, duration: 0.16, gain: 0.1 });
  }

  function updateChallengeScore() {
    // No score before the player has accepted the rival's challenge; it then
    // starts 0–0 (the solo deliveries are not in it).
    if (!scoreText || !claimRegistry || !rivalArrived()) return;
    const score = competitionScore?.score(claimRegistry.counts);
    if (!score) return;
    scoreText.textContent = formatUi(STRINGS.rivalScore, score);
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
    // Hidden during the challenge scene: patience is frozen, and the bubbles
    // would compete with the rival's dialogue (one sat over the settings button).
    customer.ownership.visible = customer.character.visible && bubble !== null && !rivalIntroActive();
    if (!customer.ownership.visible) return;
    const pulse = bubble.patienceLevel === 'low'
      ? 1 + PATIENCE_URGENT_PULSE * (0.5 + 0.5 * Math.sin(elapsed * 9))
      : 1;
    customer.ownership.scale.set(2.0 * pulse, 1.0 * pulse, 1);
    customer.ownership.material = bubble.kind === RESTAURANT_OWNERS.PLAYER
      ? customerVisuals.playerBubbleMaterial
      : customerVisuals.rivalBubbleMaterial;
    customer.character.getWorldPosition(bubblePosition);
    customer.ownership.position.copy(bubblePosition);
    customer.ownership.position.y += 2.25;
    customer.ownership.quaternion.copy(camera.quaternion);
    customer.patienceFill.material = customerVisuals.patienceMaterials[bubble.patienceLevel];
    // The parent's scale is (2, 1), so halve the width into bubble units.
    customer.patienceFill.scale.set(
      PATIENCE_FILL_WIDTH / 2 * Math.max(0.02, bubble.patience),
      PATIENCE_FILL_HEIGHT,
      1,
    );
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

  function exchangeDish(dishOrId, fallbackToNearest = false) {
    if (!carried || !conveyor) return;
    const requestedId = typeof dishOrId === 'object' ? dishOrId?.id : dishOrId;
    const requested = conveyor.snapshot().dishes.find((dish) => dish.id === requestedId);
    let target = requested && Math.abs(requested.x - player.position.x) <= BELT_ARRIVAL_WINDOW
      ? requested
      : null;
    if (!target && fallbackToNearest) {
      target = conveyor.nearestPickable(player.position.x, BELT_ARRIVAL_WINDOW);
    }
    if (!target) return;

    const takenDish = beltDishFor(target.id);
    if (!takenDish) return;
    const returnedDish = carried;
    const exchanged = conveyor.exchange(target.id, returnedDish.food);
    if (!exchanged) return;

    world.remove(takenDish.mesh);
    carryAnchor.add(takenDish.mesh);
    takenDish.state = 'carried';
    takenDish.carrySeconds = 0;
    takenDish.customerId = null;
    takenDish.firstTry = true;
    takenDish.mesh.position.set(0, 0, 0);
    takenDish.mesh.rotation.set(0, 0, 0);
    takenDish.mesh.scale.setScalar(0.88);
    for (const puff of takenDish.mesh.userData.steam) puff.visible = true;

    carryAnchor.remove(returnedDish.mesh);
    world.add(returnedDish.mesh);
    returnedDish.state = 'belt';
    returnedDish.id = exchanged.placed.id;
    returnedDish.customerId = null;
    returnedDish.carrySeconds = 0;
    returnedDish.firstTry = true;
    returnedDish.mesh.position.set(exchanged.placed.x, BELT_TOP_Y + 0.13, BELT_CENTER_Z);
    returnedDish.mesh.rotation.set(0, 0, 0);
    returnedDish.mesh.scale.setScalar(0.82);
    returnedDish.mesh.visible = Math.abs(exchanged.placed.x) < WALL_HALF_WIDTH;
    for (const puff of returnedDish.mesh.userData.steam) puff.visible = false;

    carried = takenDish;
    temperature.hidden = true;
    temperatureText = '';
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
    updateChallengeScore();
    if (rushTrigger?.recordPlayerDelivery()) rushBeatRemaining = RUSH_BEAT_SECONDS;
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
    updateChallengeScore();
  }

  function performAction() {
    if (!active || phase !== 'service') return;
    const type = actionType;
    const customer = actionCustomer;
    hideAction();
    if (type === 'collect') {
      const nearest = conveyor?.nearestPickable(player.position.x, BELT_PICKUP_WINDOW);
      if (nearest) collectDish(nearest);
    }
    else if (type === 'exchange') {
      const nearest = conveyor?.nearestPickable(player.position.x, BELT_PICKUP_WINDOW);
      if (nearest) exchangeDish(nearest);
    }
    else if (type === 'deliver' && customer) deliver(customer);
    else if (type === 'return') returnCarriedDish();
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
        if (!(event.phase === 'rush' && rushTrigger?.triggered)) showPhaseCue(event.phase);
      }
    }
    directorPhase = serviceDirector.phase;
  }

  function setRivalAnimation(next, instant = false) {
    if (!rivalCharacter || rivalAnimation === next) return;
    rivalAnimation = next;
    rivalCharacter.playAnimation?.(next, instant ? { fade: 0 } : undefined);
  }

  function activateRivalModel() {
    if (rival || !claimRegistry || !conveyor) return;
    rival = createRestaurantRival({
      level: difficulty,
      // Round 2 overrides only the tuning; movement and claim rules are shared.
      ...(progression?.round === 2 ? ROUND_TWO[difficulty]?.rival : {}),
      registry: claimRegistry,
      conveyor,
      total: Math.max(1, shiftTotal - claimRegistry.progress.done),
      initialPosition: rivalCharacter
        ? { x: rivalCharacter.position.x, z: rivalCharacter.position.z }
        : RIVAL_ENTRANCE_END,
      beltFrontZ: BELT_FRONT_Z,
      pickupWindow: BELT_PICKUP_WINDOW,
      rng: Math.random,
    });
  }

  // The tuning the current rival model was built with (debug and tests).
  function currentRivalConfig() {
    const base = RIVAL_LEVELS[difficulty];
    if (!base) return null;
    const round = progression?.round === 2 ? ROUND_TWO[difficulty]?.rival : null;
    const config = { ...base, ...(round ?? {}) };
    return {
      speed: config.speed,
      minSeatedAge: config.minSeatedAge,
      share: config.share,
      hesitationMin: config.hesitationMin,
      hesitationMax: config.hesitationMax,
      dishNoticeSeconds: config.dishNoticeSeconds,
    };
  }

  // The whole challenge scene (walk in, line, replies, reaction) pauses service.
  function rivalIntroActive() {
    return Boolean(rivalChallenge?.paused);
  }

  function rivalArrived() {
    return rivalChallenge?.phase === 'done';
  }

  function fitChallengeCloseupCamera() {
    const preset = CHALLENGE_CLOSEUP_CAMERA;
    const [px, py, pz] = preset.position;
    const [lx, ly, lz] = preset.lookAt;
    const halfTan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * (camera.aspect || 1);
    const availableDepth = Math.max(0.01, pz - lz);
    const scale = Math.max(1, (CHALLENGE_CLOSEUP_HALF_WIDTH / halfTan) / availableDepth);
    if (scale === 1) return preset;
    return {
      ...preset,
      position: [lx + (px - lx) * scale, ly + (py - ly) * scale, lz + (pz - lz) * scale],
    };
  }

  function updateRivalJingle(dt) {
    rivalIntroJingleElapsed += Math.max(0, dt);
    while (rivalIntroNextNote < RIVAL_WALK_JINGLE.length
      && rivalIntroJingleElapsed >= RIVAL_WALK_JINGLE[rivalIntroNextNote].at) {
      const note = RIVAL_WALK_JINGLE[rivalIntroNextNote];
      audio.playSfx(`restaurant-rival-walk-${rivalIntroNextNote}`, note);
      rivalIntroNextNote += 1;
    }
    if (rivalRevealAccentElapsed === null) return;
    rivalRevealAccentElapsed += Math.max(0, dt);
    while (rivalRevealAccentNext < RIVAL_REVEAL_ACCENT.length
      && rivalRevealAccentElapsed >= RIVAL_REVEAL_ACCENT[rivalRevealAccentNext].at) {
      const chordIndex = rivalRevealAccentNext;
      const chord = RIVAL_REVEAL_ACCENT[chordIndex];
      chord.frequencies.forEach((frequency, noteIndex) => {
        audio.playSfx(`restaurant-rival-reveal-${chordIndex}-${noteIndex}`, {
          type: chordIndex === 0 ? 'triangle' : 'square',
          frequency,
          endFrequency: frequency * 1.03,
          duration: chord.duration,
          gain: chord.gain,
        });
      });
      rivalRevealAccentNext += 1;
    }
  }

  function startRivalRevealAccent() {
    rivalRevealAccentElapsed = 0;
    rivalRevealAccentNext = 0;
    updateRivalJingle(0);
  }

  function renderChallengeTypewriter() {
    if (!challengeLine || !challengeTypewriter) return;
    const visible = challengeTypewriter.visibleUnitCount;
    [...challengeLine.children].forEach((span, index) => {
      span.style.visibility = index < visible ? 'visible' : 'hidden';
    });
  }

  function updateChallengeTypewriter(dt) {
    if (rivalChallenge?.phase !== 'typing' || !challengeTypewriter) return;
    challengeTypewriter.advance(dt);
    renderChallengeTypewriter();
    if (challengeTypewriter.complete) {
      processRivalChallengeEvents(rivalChallenge.completeTyping());
    }
  }

  function completeChallengeTypewriter() {
    if (rivalChallenge?.phase !== 'typing' || !challengeTypewriter) return false;
    challengeTypewriter.revealAll();
    renderChallengeTypewriter();
    processRivalChallengeEvents(rivalChallenge.completeTyping());
    return true;
  }

  function beginRivalChallenge() {
    if (!rivalChallenge?.start()) return false;
    // The scene is modal and freezes play, so no half-targeted conversation,
    // Talk control, action or notice survives it.
    clearQuestion();
    clickQuestionCustomer = null;
    autoTarget = null;
    speech.cancel();
    speech.clearTarget();
    hud.hide();
    hideAction();
    setListenTarget(null);
    noticeRemaining = 0;
    if (notice) notice.hidden = true;
    comboRemaining = 0;
    if (comboPop) comboPop.hidden = true;
    syncHud();
    if (claimRegistry) competitionScore?.capture(claimRegistry.counts);
    cameraRig.setPreset('fixed', ENTRANCE_CAMERA);
    rivalCameraCloseup = false;
    rivalIntroJingleElapsed = 0;
    rivalIntroNextNote = 0;
    rivalRevealAccentElapsed = null;
    rivalRevealAccentNext = 0;
    // Same scene for either waiter; only who walks in and what they say differ.
    const lines = encounterStrings();
    setChallengeContent(lines.line, lines.replies);
    if (rivalTitle) {
      rivalTitle.textContent = lines.title;
      rivalTitle.classList.remove('restaurant-ui__title--fading');
      rivalTitle.hidden = false;
    }
    updateRivalJingle(0);
    createRivalCharacter?.(progression?.rivalId ?? RIVAL_IDS.WAITER_1, RIVAL_ENTRANCE_START);
    setRivalAnimation('walk', true);
    updateRivalEntranceLabel();
    return true;
  }

  function showChallengePanel() {
    // The third delivery's thanks bubble must not sit over the scene.
    dialogue.hide();
    dialogueCustomer = null;
    dialogueRemaining = 0;
    if (rivalTitle) {
      rivalTitle.hidden = true;
      rivalTitle.classList.remove('restaurant-ui__title--fading');
    }
    if (!challengePanel) return;
    challengeReplies.hidden = true;
    challengePanel.hidden = false;
    restoreChallengePose();
    setRivalAnimation('idle', true);
    renderChallengeTypewriter();
  }

  function showChallengeReplies() {
    if (!challengeReplies) return;
    challengeReplies.hidden = false;
    // Keyboard players land on a reply; a mouse click works regardless.
    if (challengeSuppressedKeys.size === 0) {
      challengeReplies.querySelector('button')?.focus({ preventScroll: true });
    }
  }

  function hideChallengePanel() {
    if (!challengePanel) return;
    if (challengePanel.contains(document.activeElement)) document.activeElement.blur();
    challengePanel.hidden = true;
    challengeReplies.hidden = true;
  }

  function onChallengePanelClick(event) {
    if (!active || rivalChallenge?.phase !== 'typing') return;
    event.preventDefault();
    event.stopPropagation();
    completeChallengeTypewriter();
  }

  // Replies (either challenge) or the rematch question's two choices are showing.
  function choicesShown() {
    return Boolean(rivalChallenge?.choicesVisible || rematchChoiceActive);
  }

  function onChallengeReply(event) {
    const button = event.target instanceof Element ? event.target.closest('button[data-reply]') : null;
    if (button && active && rematchChoiceActive) {
      chooseAfterLoss(Number(button.dataset.reply));
      return;
    }
    if (!button || !active || !rivalChallenge?.choose(Number(button.dataset.reply))) return;
    // Role-play only: every reply leads to the same nod and the same rush.
    hideChallengePanel();
    rivalEmoteRemaining = RIVAL_CHALLENGE_REACTION_SECONDS;
    if (rivalCharacter) rivalCharacter.rotation.y = 0;
    audio.playSfx('restaurant-challenge-accept', { frequency: 660, endFrequency: 1320, duration: 0.2, gain: 0.12 });
  }

  // On the window, so the arrows still reach the replies after a click into the room.
  function onChallengeKey(event) {
    const activationKey = event.code === 'Space' || event.code === 'Enter';
    // A press already under way as the rematch question appears (Space mashed
    // through the result) must not pick a choice on its keyup.
    const choiceJustShown = rematchChoiceActive && elapsed - rematchChoiceShownAt < REMATCH_CHOICE_GUARD_SECONDS;
    if (active && activationKey && (rivalChallenge?.phase === 'typing' || choiceJustShown)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      challengeSuppressedKeys.add(event.code);
      completeChallengeTypewriter();
      return;
    }
    if (activationKey && challengeSuppressedKeys.has(event.code)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (activationKey && event.repeat && choicesShown()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    const step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[event.code];
    if (!step || !choicesShown() || !challengeReplies) return;
    // Arrows move between replies here; they must not also walk the avatar.
    event.preventDefault();
    event.stopPropagation();
    const buttons = [...challengeReplies.querySelectorAll('button')];
    const current = buttons.indexOf(document.activeElement);
    const next = current < 0 ? (step > 0 ? 0 : buttons.length - 1) : (current + step + buttons.length) % buttons.length;
    buttons[next]?.focus({ preventScroll: true });
  }

  function onChallengeKeyUp(event) {
    if (!challengeSuppressedKeys.has(event.code)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    challengeSuppressedKeys.delete(event.code);
    if (challengeSuppressedKeys.size === 0 && choicesShown()) {
      challengeReplies?.querySelector('button')?.focus({ preventScroll: true });
    }
  }

  function onChallengeBlur() {
    if (challengeSuppressedKeys.size === 0) return;
    challengeSuppressedKeys.clear();
    if (choicesShown()) challengeReplies?.querySelector('button')?.focus({ preventScroll: true });
  }

  function beginRivalReveal() {
    if (!rivalCharacter) return;
    rivalCharacter.rotation.y = 0;
    setRivalAnimation('static', true);
    rivalCharacter.updateAnimation?.(0);
    restoreChallengePose();
    challengePoseState = { character: rivalCharacter, nodes: captureNodePose(rivalCharacter) };
    rivalCameraCloseup = true;
    cameraRig.setPreset('fixed', fitChallengeCloseupCamera());
    startRivalRevealAccent();
  }

  function beginRivalReturn() {
    rivalCameraCloseup = false;
    cameraRig.setPreset('fixed', { ...ENTRANCE_CAMERA, damping: 3.8 });
  }

  function processRivalChallengeEvents(events) {
    for (const event of events ?? []) {
      if (event.type === 'reveal') beginRivalReveal();
      else if (event.type === 'returning') beginRivalReturn();
      else if (event.type === 'panel') showChallengePanel();
      else if (event.type === 'choices-shown') showChallengeReplies();
      else if (event.type === 'rush') beginRushGameplay();
    }
  }

  function beginRushGameplay() {
    // The belt, director and rival AI all switch together, only now.
    const roundTwo = progression?.round === 2;
    if (roundTwo) conveyor.startRoundTwo();
    else conveyor.startRush();
    serviceDirector.startRush();
    directorPhase = serviceDirector.phase;
    cameraRig.setPreset('fixed', ROOM_CAMERA);
    showPhaseCue('rush', roundTwo ? STRINGS.round2Cue : STRINGS.lunchRush);
    rivalEmoteRemaining = 0;
    setRivalAnimation('idle');
    activateRivalModel();
    updateChallengeScore();
  }

  function updateRushSequence(serviceDt) {
    if (serviceDt <= 0 || !rushTrigger?.triggered || !rivalChallenge) return;
    rivalEmoteRemaining = Math.max(0, rivalEmoteRemaining - serviceDt);
    if (rivalChallenge.phase === 'idle') {
      rushBeatRemaining = Math.max(0, rushBeatRemaining - serviceDt);
      // Never cut into a conversation: wait until Talk has finished.
      if (rushBeatRemaining === 0 && !questionCommitted && !focus.active) beginRivalChallenge();
      return;
    }
    updateRivalJingle(serviceDt);
    if (rivalChallenge.phase === 'entering' && rivalCharacter) {
      const dx = RIVAL_ENTRANCE_END.x - rivalCharacter.position.x;
      const dz = RIVAL_ENTRANCE_END.z - rivalCharacter.position.z;
      const distance = Math.hypot(dx, dz);
      const step = Math.min(distance, RIVAL_ENTRANCE_SPEED * serviceDt);
      if (distance > 1e-6) {
        rivalCharacter.position.x += dx / distance * step;
        rivalCharacter.position.z += dz / distance * step;
        rivalCharacter.rotation.y = Math.atan2(dx, dz);
      }
      if (step >= distance - 1e-6) {
        rivalCharacter.position.set(RIVAL_ENTRANCE_END.x, 0, RIVAL_ENTRANCE_END.z);
        rivalTurnStartRotation = rivalCharacter.rotation.y;
        rivalChallenge.arrive();
      }
    } else {
      const wasTyping = rivalChallenge.phase === 'typing';
      processRivalChallengeEvents(rivalChallenge.advance(serviceDt));
      if (wasTyping) updateChallengeTypewriter(serviceDt);
    }
    if (rivalChallenge.phase === 'turning' && rivalCharacter) {
      const progress = Math.min(1, rivalChallenge.phaseElapsed / RIVAL_REVEAL_TIMING.turn);
      const target = shortestAngle(rivalTurnStartRotation, 0);
      rivalCharacter.rotation.y = THREE.MathUtils.lerp(
        rivalTurnStartRotation,
        target,
        THREE.MathUtils.smoothstep(progress, 0, 1),
      );
    }
    if (rivalChallenge.phase === 'returning' && rivalTitle) {
      const fadeAt = RIVAL_REVEAL_TIMING.return - RIVAL_TITLE_FADE_SECONDS;
      rivalTitle.classList.toggle(
        'restaurant-ui__title--fading',
        rivalChallenge.phaseElapsed >= fadeAt,
      );
    }
    updateRivalEntranceLabel();
  }

  function updateRivalEntranceLabel() {
    if (!rivalEntranceLabel) return;
    const labelVisible = Boolean(rivalCharacter)
      && ['typing', 'awaiting', 'reacting'].includes(rivalChallenge?.phase);
    rivalEntranceLabel.visible = labelVisible;
    if (!labelVisible) return;
    rivalEntranceLabel.position.copy(rivalCharacter.position);
    rivalEntranceLabel.position.y += 2.35;
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
      if (arrived.type === 'dish') {
        if (carried) exchangeDish(arrived.value, true);
        else collectDish(arrived.value, true);
      }
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
          // With no rival to ask the final question, the shift's last diner
          // stays at the table to ask it instead of walking out.
          if (!rivalArrived() && isLastInRoom(customer)) {
            customer.state = 'delivered';
            customer.stayedForTurnaround = true;
            customer.character.playAnimation?.('idle');
            continue;
          }
          customer.state = 'leaving';
          customer.walkStage = 0;
          customer.character.playAnimation?.('walk');
        }
      }

      const nextPatience = drainPatience(customer, serviceDt, { preOrderDrain: configured.preOrderDrain });
      if (nextPatience !== customer.patience) {
        customer.patience = nextPatience;
        if (customer.patience <= 0) leaveCustomer(customer);
      }

      if (customer.state === 'seated' || customer.state === 'awaiting') {
        // The look-around starts with the red strip.
        const late = customer.state === 'awaiting'
          && customer.patience / customer.patienceMax < PATIENCE_LOW;
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
    const beltDish = player.position.z <= -4.0 ? nearestBeltDish() : null;
    const beltWins = Boolean(beltDish && !lockedQuestion && !clickedCustomer);
    // The tub lies inside the back-right diner's talk radius: like the belt
    // front, standing at it with a dish outranks proximity Talk (not a click).
    const nearReturn = Boolean(carried) && playerNearDishReturn();
    const returnWins = nearReturn && !lockedQuestion && !clickedCustomer;
    const questionCandidate = lockedQuestion
      ?? (!beltWins && !returnWins && isTalkable(nearbyCustomer) ? nearbyCustomer : null);

    if (!questionCommitted) {
      if (questionCandidate) targetQuestion(questionCandidate);
      else clearQuestion();
    }
    // The 🔊 control sits beside the main action, never in its place (SPEC 3).
    setListenTarget(nearbyCustomer?.owner === RESTAURANT_OWNERS.PLAYER
      && canBeReminded(nearbyCustomer.state) ? nearbyCustomer : null);
    const deliverTarget = nearbyCustomer?.owner === RESTAURANT_OWNERS.PLAYER
      && nearbyCustomer.state === 'awaiting'
      && nearbyCustomer.refusalRemaining <= 0
      ? nearbyCustomer
      : null;
    const chosenAction = chooseAction({
      carried: Boolean(carried),
      lockedQuestion,
      questionCandidate,
      nearReturn,
      beltDish: beltWins ? beltDish : null,
      deliverTarget,
    });

    if (chosenAction === 'talk') {
      hideAction();
    } else if (chosenAction === 'return') {
      setInstruction(STRINGS.returnDish);
      showAction(STRINGS.returnDish, 'return');
    } else if (chosenAction === 'exchange') {
      setInstruction(STRINGS.exchangeDish);
      showAction(STRINGS.exchangeDish, 'exchange', beltDish);
    } else if (chosenAction === 'deliver') {
      setInstruction(STRINGS.walkToDeliver);
      showAction(STRINGS.deliverDish, 'deliver', deliverTarget);
    } else if (chosenAction === 'collect') {
      setInstruction(STRINGS.walkToConveyor);
      showAction(STRINGS.collectDish, 'collect', beltDish);
    } else {
      hideAction();
      if (lockedQuestion) return;
      if (carried) setInstruction(STRINGS.walkToDeliver);
      else if (hasCustomerInState('seated')) setInstruction(STRINGS.walkToCustomer);
      else setInstruction(STRINGS.watchConveyor);
    }
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
    // A click into the room during the challenge must not queue a walk for later.
    if (!active || phase !== 'service' || rivalIntroActive()) return;
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
        if (target.value.state !== 'belt' || !conveyor) continue;
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

  function objectInCameraFrustum(object) {
    if (!object) return false;
    object.getWorldPosition(debugProjection);
    debugProjection.project(camera);
    return debugProjection.x >= -1 && debugProjection.x <= 1
      && debugProjection.y >= -1 && debugProjection.y <= 1
      && debugProjection.z >= -1 && debugProjection.z <= 1;
  }

  function debugSnapshot() {
    const scoring = scoreSession(records);
    const conveyorState = conveyor?.snapshot() ?? {
      direction: -1,
      entryX: 0,
      exitX: 0,
      visibleHalfWidth: 0,
      speed: 0,
      entryInterval: 0,
      mode: 'solo',
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
      actionType: actionType || 'none',
      progress: { done: claimRegistry?.progress.done ?? records.length, total: shiftTotal },
      level: difficulty,
      // Game time (frame-clamped), for timing checks independent of frame rate.
      elapsed,
      rush: {
        enabled: Boolean(RIVAL_LEVELS[difficulty]?.enabled),
        triggered: rushTrigger?.triggered ?? false,
        beatRemaining: rushBeatRemaining,
        entering: rivalIntroActive(),
        titleVisible: Boolean(rivalTitle && !rivalTitle.hidden),
        deliveriesToRush: RUSH_PLAYER_DELIVERIES,
        playerDeliveries: rushTrigger?.playerDeliveries ?? 0,
      },
      // What the child can see. Shift progress is data only (`progress`), never shown.
      hud: {
        hintVisible: Boolean(instruction && !instruction.hidden),
        hintText: instructionText,
        modal: Boolean(overlay?.classList.contains('restaurant-ui--modal')),
        talkVisible: Boolean(!hud.element.hidden && !hud.talkButton.hidden),
        talkEnabled: Boolean(!hud.element.hidden && !hud.talkButton.hidden && !hud.talkButton.disabled),
        actionVisible: Boolean(actionButton && !actionButton.hidden && actionButton.offsetParent),
        listenAgainVisible: Boolean(listenAgain?.element && !listenAgain.element.hidden
          && listenAgain.element.offsetParent),
        scoreVisible: Boolean(scoreText && !scoreText.hidden),
        overlayCreates,
        replyButtons: challengeReplies?.querySelectorAll('button').length ?? 0,
        overlaysInDom: document.querySelectorAll('.restaurant-ui').length,
      },
      progression: progression ? {
        round: progression.round,
        rivalId: progression.rivalId,
        attempt: progression.attempt,
        phase: progression.phase,
        awaitingChoice: progression.awaitingChoice,
        choicesVisible: Boolean(rematchChoiceActive && challengePanel && !challengePanel.hidden
          && challengeReplies && !challengeReplies.hidden),
        roundTotal: shiftTotal,
        roundDone: claimRegistry?.progress.done ?? 0,
        roundPatience: roundPatience ?? DIFFICULTY[difficulty].patience,
        exitWalking: Boolean(rivalExit.character),
        rivalCharactersBuilt: Object.keys(rivalCharacters),
        rivalCharactersVisible: Object.entries(rivalCharacters)
          .filter(([, character]) => character.visible).map(([id]) => id),
      } : null,
      rivalChallenge: {
        active: rivalIntroActive(),
        phase: rivalChallenge?.phase ?? 'idle',
        phaseElapsed: rivalChallenge?.phaseElapsed ?? 0,
        awaitingResponse: rivalChallenge?.phase === 'awaiting',
        lineVisible: Boolean(challengePanel && !challengePanel.hidden),
        titleVisible: Boolean(rivalTitle && !rivalTitle.hidden),
        labelVisible: Boolean(rivalEntranceLabel?.visible),
        panelVisible: Boolean(challengePanel && !challengePanel.hidden),
        nameBadgePresent: Boolean(challengePanel?.querySelector('.restaurant-ui__challenge-name')),
        typing: rivalChallenge?.phase === 'typing',
        lineRevealedCost: challengeTypewriter?.revealedCost ?? 0,
        lineTotalCost: challengeTypewriter?.totalCost ?? 0,
        lineComplete: challengeTypewriter?.complete ?? false,
        choicesVisible: Boolean(challengePanel && !challengePanel.hidden && challengeReplies && !challengeReplies.hidden),
        cameraCloseup: rivalCameraCloseup,
        // Base text only; furigana readings are left out.
        choices: challengeReplies
          ? [...challengeReplies.querySelectorAll('button')].map((button) => [...button.childNodes]
            .map((node) => (node.nodeName === 'RUBY' ? node.firstChild.textContent : node.textContent))
            .join(''))
          : [],
        selectedResponse: rivalChallenge?.selectedResponse ?? null,
      },
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
        patienceMax: customer.patienceMax,
        refusalRemaining: customer.refusalRemaining,
      })),
      player: player ? { x: player.position.x, z: player.position.z, autoWalking: Boolean(autoTarget) } : null,
      conveyor: {
        direction: conveyorState.direction,
        entryX: conveyorState.entryX,
        exitX: conveyorState.exitX,
        visibleHalfWidth: conveyorState.visibleHalfWidth,
        speed: conveyorState.speed,
        entryInterval: conveyorState.entryInterval,
        mode: conveyorState.mode,
        visibleCount: conveyorState.dishes.filter(
          (snapshotDish) => Math.abs(snapshotDish.x) <= conveyorState.visibleHalfWidth,
        ).length,
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
        labelText: STRINGS.returnSign,
        labelVisible: Boolean(dishReturnLabel?.visible),
      } : null,
      sign: signAnchor ? {
        text: RESTAURANT_SIGN_TEXT,
        visible: signAnchor.visible,
        screen: projectObject(signAnchor),
      } : null,
      turnaroundPartner: turnaroundPartner ? {
        type: turnaroundPartner.type,
        customerId: turnaroundPartner.customer?.id ?? null,
        walking: turnaroundWalk.walking,
        uuid: turnaroundPartner.character.uuid,
        position: { x: turnaroundPartner.character.position.x, z: turnaroundPartner.character.position.z },
        visible: turnaroundPartner.character.visible,
        cameraTarget: cameraRig.target === turnaroundPartner.character,
      } : null,
      charactersInRoom: world ? world.children.filter((child) => typeof child.playAnimation === 'function' && child.visible).length : 0,
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
        config: currentRivalConfig(),
      } : null,
      rivalCharacter: rivalCharacter ? {
        visible: rivalCharacter.parent === world && rivalCharacter.visible,
        uuid: rivalCharacter.uuid,
        id: rivalCharacter.userData.restaurantRivalId ?? null,
        model: RIVAL_CAST[rivalCharacter.userData.restaurantRivalId]?.model ?? null,
        entering: rivalIntroActive(),
        entranceLabelVisible: Boolean(rivalEntranceLabel?.visible),
        position: { x: rivalCharacter.position.x, z: rivalCharacter.position.z },
      } : null,
      playerServed: counts.playerServed,
      rivalServed: counts.rivalServed,
      competition: {
        baseline: competitionScore?.baseline ?? null,
        score: competitionScore?.score(counts) ?? null,
      },
      resultCeremony: {
        active: Boolean(resultStage?.active),
        outcome: resultOutcome,
        label: resultLabel && !resultLabel.hidden ? resultLabel.textContent : null,
        remaining: resultStage?.phase === 'reaction'
          ? Math.max(0, RESULT_STAGE_TIMING.reaction - resultStage.phaseElapsed
            + RESULT_STAGE_TIMING.labelFade + RESULT_STAGE_TIMING.scoreShrink + RESULT_STAGE_TIMING.settle)
          : (resultStage?.phase === 'settling'
            ? Math.max(0, RESULT_STAGE_TIMING.labelFade + RESULT_STAGE_TIMING.scoreShrink
              + RESULT_STAGE_TIMING.settle - resultStage.phaseElapsed)
            : 0),
      },
      resultStage: {
        active: Boolean(resultStage?.active),
        reactionSeconds: RESULT_STAGE_TIMING.reaction,
        outcome: resultStage?.outcome ?? null,
        phase: resultStage?.active ? resultStage.phase : null,
        labelVisible: Boolean(resultStage?.labelVisible),
        scoreVisible: Boolean(scoreText && !scoreText.hidden),
        scoreCompact: Boolean(resultStage?.scoreCompact),
        scoreText: scoreText && !scoreText.hidden ? scoreText.textContent : null,
        playerPosition: player ? { x: player.position.x, z: player.position.z } : null,
        rivalPosition: rivalCharacter ? { x: rivalCharacter.position.x, z: rivalCharacter.position.z } : null,
        playerReaction: resultStage?.reactions?.player ?? null,
        rivalReaction: resultStage?.reactions?.rival ?? null,
        conveyorStopped: Boolean(resultStage?.active && resultStageBeltTravel !== null
          && Math.abs((conveyor?.snapshot().beltTravel ?? resultStageBeltTravel) - resultStageBeltTravel) < 1e-9),
        cameraPreset: cameraRig.preset,
        cameraPosition: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
        signInView: objectInCameraFrustum(signAnchor),
        customersVisible: customers.filter((customer) => customer.character.visible).length,
        startCount: resultStageStartCount,
      },
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

  function isLastInRoom(customer) {
    if (customers.length !== shiftTotal) return false;
    return customers.every((other) => other === customer
      || other.state === 'delivered' || other.state === 'left' || other.state === 'leaving');
  }

  function chooseTurnaroundPartner() {
    if (rivalArrived() && rivalCharacter) return { type: 'rival', character: rivalCharacter, customer: null };
    const stayed = customers.find((customer) => customer.stayedForTurnaround);
    if (stayed) return { type: 'customer', character: stayed.character, customer: stayed };
    // The final resolution was a walk-out: the last diner served walks back in.
    const lastServed = [...records].reverse().find((record) => record.delivered);
    const customer = customers.find((candidate) => candidate.id === lastServed?.index)
      ?? customers[customers.length - 1];
    return customer ? { type: 'customer', character: customer.character, customer } : null;
  }

  // Beside the player, toward the room's centre, on open floor.
  function conversationSpot(out) {
    const side = player.position.x > 0 ? -1 : 1;
    const candidates = [[side * 1.5, -0.9], [-side * 1.5, -0.9], [side * 1.5, 0.9], [-side * 1.5, 0.9], [0, -1.6], [0, 1.6]];
    for (const [dx, dz] of candidates) {
      const x = player.position.x + dx;
      const z = player.position.z + dz;
      if (canOccupy(x, z) && z > -3.6) return out.set(x, z);
    }
    return out.set(player.position.x, Math.max(-3.6, player.position.z - 1.6));
  }

  function beginTurnaroundApproach() {
    if (!active || completed || phase !== 'round-end') return;
    phase = 'turnaround-approach';
    hideAction();
    setListenTarget(null);
    temperature.hidden = true;
    noticeRemaining = 0;
    notice.hidden = true;
    autoTarget = null;
    player.playAnimation?.('idle');
    turnaroundPartner = chooseTurnaroundPartner();
    turnaroundWalk.waveRemaining = TURNAROUND_WAVE_SECONDS;
    turnaroundWalk.walking = false;
    if (!turnaroundPartner) return;
    const { character } = turnaroundPartner;
    if (turnaroundPartner.type === 'rival' || !character.visible) {
      if (turnaroundPartner.type === 'rival') discardRivalDish();
      else {
        character.position.set(RESTAURANT_DOOR.x, 0, RESTAURANT_DOOR.z);
        character.visible = true;
      }
      conversationSpot(turnaroundAim);
      turnaroundWalk.targetX = turnaroundAim.x;
      turnaroundWalk.targetZ = turnaroundAim.y;
      turnaroundWalk.walking = true;
      playPartnerAnimation('walk');
    } else {
      greetPlayer();
    }
  }

  function playPartnerAnimation(name) {
    if (!turnaroundPartner) return;
    if (turnaroundPartner.type === 'rival') setRivalAnimation(name);
    else turnaroundPartner.character.playAnimation?.(name);
  }

  function greetPlayer() {
    const { character, type } = turnaroundPartner;
    turnaroundWalk.walking = false;
    // The rival faces the player; a seated diner keeps facing the room.
    if (type === 'rival' || !turnaroundPartner.customer?.stayedForTurnaround) {
      character.rotation.y = Math.atan2(player.position.x - character.position.x, player.position.z - character.position.z);
      player.rotation.y = Math.atan2(character.position.x - player.position.x, character.position.z - player.position.z);
    }
    playPartnerAnimation('emote-yes');
  }

  function updateTurnaroundApproach(dt) {
    if (!turnaroundPartner) {
      beginTurnaround();
      return;
    }
    const { character } = turnaroundPartner;
    if (turnaroundWalk.walking) {
      const dx = turnaroundWalk.targetX - character.position.x;
      const dz = turnaroundWalk.targetZ - character.position.z;
      const distance = Math.hypot(dx, dz);
      if (distance <= 0.05) {
        character.position.x = turnaroundWalk.targetX;
        character.position.z = turnaroundWalk.targetZ;
        greetPlayer();
        return;
      }
      setWalkAim(character.position.x, character.position.z, turnaroundWalk.targetX, turnaroundWalk.targetZ, turnaroundAim);
      const aimX = turnaroundAim.x - character.position.x;
      const aimZ = turnaroundAim.y - character.position.z;
      const aimDistance = Math.hypot(aimX, aimZ);
      const speed = THREE.MathUtils.clamp(distance / TURNAROUND_WALK_SECONDS, TURNAROUND_MIN_SPEED, TURNAROUND_MAX_SPEED);
      const step = Math.min(aimDistance, speed * dt);
      if (aimDistance > 1e-6) {
        character.position.x += aimX / aimDistance * step;
        character.position.z += aimZ / aimDistance * step;
        character.rotation.y = Math.atan2(aimX, aimZ);
      }
      return;
    }
    turnaroundWalk.waveRemaining = Math.max(0, turnaroundWalk.waveRemaining - dt);
    if (turnaroundWalk.waveRemaining === 0) beginTurnaround();
  }

  function completeTurnaround(answer) {
    if (!active || completed || phase !== 'turnaround') return;
    completed = true;
    acceptedAnswer = answer || LESSON.answers[0];
    const finishingResultStage = Boolean(resultStage?.active);
    if (finishingResultStage) resultStage.markAnswered();
    phase = 'finishing';
    endFocus();
    speech.clearTarget();
    hud.setTalkState('accepted');
    setInstruction(STRINGS.complete);
    playPartnerAnimation('emote-yes');
    if (finishingResultStage) player.playAnimation?.('emote-yes');
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
    const partner = turnaroundPartner?.character ?? player;
    // In the close-up the child is the camera: ask facing it (rotation 0), or
    // a rival who stopped in front of the player asks with its back turned.
    partner.rotation.y = 0;
    playPartnerAnimation('idle');
    dialogue.show({ text: LESSON.question, anchor: partner, offsetY: 1.8 });
    setInstruction(STRINGS.turnaround);
    cameraRig
      .setTarget(partner)
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
    clearQuestion();
    hideAction();
    setListenTarget(null);
    hud.hide();
    setInstruction(STRINGS.roundEnd);
    if (dialogueCustomer) dialogueRemaining = Math.min(dialogueRemaining, 1.1);
    // Only a shift that had a rival gets the result moment (never Easy, never a
    // shift that ended before the rush).
    phase = 'round-end';
    if (rivalArrived() && claimRegistry) {
      const outcome = competitionOutcome(competitionScore?.score(claimRegistry.counts));
      // Frozen beat in the room first, so the last delivery's thanks and combo land.
      if (outcome) {
        resultStagePendingOutcome = outcome;
        roundEndRemaining = RESULT_STAGE_LEAD_IN_SECONDS;
        return;
      }
    }
    if (scoreText && claimRegistry) scoreText.classList.add('restaurant-ui__score--result');
    roundEndRemaining = ROUND_END_SECONDS;
  }

  function captureNodePose(character) {
    const nodes = {};
    for (const name of ['root', 'leg-left', 'leg-right', 'torso', 'arm-left', 'arm-right', 'head']) {
      const node = character?.getObjectByName(name);
      if (!node) continue;
      nodes[name] = {
        node,
        rotation: node.rotation.clone(),
        position: node.position.clone(),
      };
    }
    return nodes;
  }

  function restoreChallengePose() {
    if (!challengePoseState) return;
    resetNodesToRest(challengePoseState);
    challengePoseState.character.position.y = 0;
    challengePoseState = null;
  }

  function snapshotPose(rest) {
    const nodes = {};
    for (const [name, entry] of Object.entries(rest.nodes)) {
      nodes[name] = { rotation: entry.node.rotation.clone(), position: entry.node.position.clone() };
    }
    return {
      nodes,
      positionY: rest.character.position.y,
      rotationY: rest.character.rotation.y,
    };
  }

  function restoreResultPose() {
    if (!resultPoseState) return;
    for (const rest of [resultPoseState.player, resultPoseState.rival]) {
      if (!rest) continue;
      for (const entry of Object.values(rest.nodes)) {
        entry.node.rotation.copy(entry.rotation);
        entry.node.position.copy(entry.position);
      }
      rest.character.position.y = 0;
    }
    resultPoseState = null;
  }

  function stageAllCharacters() {
    discardRivalDish();
    if (carried?.mesh) carried.mesh.visible = false;
    for (const dish of dishes) dish.mesh.visible = false;
    for (const customer of customers) {
      customer.character.visible = false;
      customer.ownership.visible = false;
      if (customer.servedDish?.mesh) customer.servedDish.mesh.visible = false;
    }
    if (rivalEntranceLabel) rivalEntranceLabel.visible = false;

    hideAction();
    setListenTarget(null);
    if (temperature) temperature.hidden = true;
    if (notice) notice.hidden = true;
    if (comboPop) comboPop.hidden = true;
    if (phasePill) phasePill.hidden = true;
    if (challengePanel) hideChallengePanel();
    noticeRemaining = 0;
    comboRemaining = 0;
    phasePillRemaining = 0;
    autoTarget = null;
    clickQuestionCustomer = null;

    player.position.set(RESULT_STAGE_LAYOUT.player.x, 0, RESULT_STAGE_LAYOUT.player.z);
    rivalCharacter.position.set(RESULT_STAGE_LAYOUT.rival.x, 0, RESULT_STAGE_LAYOUT.rival.z);
    player.rotation.set(0, 0, 0);
    rivalCharacter.rotation.set(0, 0, 0);

    player.playAnimation?.('static', { fade: 0 });
    setRivalAnimation('static', true);
    player.updateAnimation?.(0);
    rivalCharacter.updateAnimation?.(0);
    resultPoseState = {
      player: { character: player, nodes: captureNodePose(player), settlingStart: null },
      rival: { character: rivalCharacter, nodes: captureNodePose(rivalCharacter), settlingStart: null },
    };
  }

  // A narrow (portrait) viewport pulls the camera back along its view line
  // until both waiters, arms included, fit across the frame.
  function fitStageCamera(preset) {
    const [px, py, pz] = preset.position;
    const [lx, ly, lz] = preset.lookAt;
    const halfTan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * (camera.aspect || 1);
    const neededDepth = RESULT_STAGE_HALF_WIDTH / halfTan;
    const stageZ = RESULT_STAGE_LAYOUT.player.z;
    const scale = Math.max(1, (neededDepth + stageZ - lz) / (pz - lz));
    if (scale === 1) return preset;
    return {
      ...preset,
      position: [lx + (px - lx) * scale, ly + (py - ly) * scale, lz + (pz - lz) * scale],
    };
  }

  function beginResultStage(outcome) {
    if (resultStage?.active || !rivalCharacter) return false;
    const nextStage = createResultStage({ outcome });
    if (!nextStage.start()) return false;
    resultStage = nextStage;
    resultStageStartCount += 1;
    resultOutcome = outcome;
    resultNextNote = 0;
    resultStageBeltTravel = conveyor?.snapshot().beltTravel ?? null;
    phase = 'result-stage';
    updateChallengeScore();
    // The last delivery's thanks had the lead-in beat; its diner is about to vanish.
    dialogue.hide();
    dialogueCustomer = null;
    dialogueRemaining = 0;
    stageAllCharacters();
    hud.hide();
    cameraRig.setTarget(null).setPreset('fixed', fitStageCamera(RESULT_CAMERA));
    if (scoreText) {
      scoreText.classList.remove('restaurant-ui__score--result', 'restaurant-ui__score--compact');
      scoreText.classList.add('restaurant-ui__score--stage');
      scoreText.hidden = false;
    }
    if (resultLabel) {
      resultLabel.textContent = outcome === 'player'
        ? STRINGS.resultPlayer
        : (outcome === 'rival' ? STRINGS.resultRival : STRINGS.resultDraw);
      resultLabel.dataset.outcome = outcome;
      resultLabel.classList.remove('restaurant-ui__result--fading');
      resultLabel.hidden = false;
    }
    return true;
  }

  function updateResultSting() {
    const notes = RESULT_STINGS[resultOutcome];
    while (resultNextNote < notes.length && resultStage.elapsed >= notes[resultNextNote][0]) {
      const [, frequency] = notes[resultNextNote];
      const last = resultNextNote === notes.length - 1;
      audio.playSfx(`restaurant-result-${resultOutcome}-${resultNextNote}`, {
        type: 'triangle',
        frequency,
        endFrequency: resultOutcome === 'rival' && last ? frequency * 0.82 : frequency,
        duration: last ? 0.34 : 0.13,
        gain: 0.11,
      });
      resultNextNote += 1;
    }
  }

  function beginResultSettling() {
    if (!resultPoseState) return;
    resultPoseState.player.settlingStart = snapshotPose(resultPoseState.player);
    resultPoseState.rival.settlingStart = snapshotPose(resultPoseState.rival);
    if (resultLabel) resultLabel.classList.add('restaurant-ui__result--fading');
    scoreText?.classList.add('restaurant-ui__score--compact');
    player.playAnimation?.('idle');
    setRivalAnimation('idle');
  }

  function beginResultQuestion() {
    phase = 'turnaround';
    turnaroundPartner = { type: 'rival', character: rivalCharacter, customer: null };
    if (resultLabel) resultLabel.hidden = true;
    restoreResultPose();
    player.position.y = 0;
    rivalCharacter.position.y = 0;
    playPartnerAnimation('idle');
    dialogue.show({ text: LESSON.question, anchor: rivalCharacter, offsetY: 1.8 });
    setInstruction(STRINGS.turnaround);
    cameraRig.setTarget(null).setPreset('fixed', fitStageCamera(RESULT_QUESTION_CAMERA));
    beginFocus('restaurant-turnaround');
    promptAnswer(ctx, LESSON, { isActive: () => active, onAccepted: completeTurnaround });
  }

  // Where the rival would ask the final question, the progression decides:
  // Round 1 loss/draw → rematch or finish; Round 1 win → Waiter 2; Round 2 → the question.
  function beginAfterResult() {
    const decision = progression?.resolveRound(resultOutcome) ?? { next: 'final-question' };
    if (decision.next === 'choice') showRematchChoice();
    else if (decision.next === 'round2-intro') beginRoundTwoTransition();
    else beginResultQuestion();
  }

  function showRematchChoice() {
    if (resultLabel) resultLabel.hidden = true;
    restoreResultPose();
    player.position.y = 0;
    rivalCharacter.position.y = 0;
    player.playAnimation?.('idle');
    setRivalAnimation('idle');
    cameraRig.setTarget(null).setPreset('fixed', fitStageCamera(REMATCH_CAMERA));
    setChallengeContent(STRINGS.rivalRematchAsk, STRINGS.rematchChoices);
    challengeTypewriter.revealAll();
    renderChallengeTypewriter();
    rematchChoiceActive = true;
    rematchChoiceShownAt = elapsed;
    hud.hide();
    if (challengePanel) {
      challengePanel.hidden = false;
      showChallengeReplies();
    }
    syncHud();
  }

  function chooseAfterLoss(index) {
    if (!rematchChoiceActive || elapsed - rematchChoiceShownAt < REMATCH_CHOICE_GUARD_SECONDS) return;
    const decision = index === 0 ? progression?.chooseRematch() : progression?.chooseFinish();
    if (!decision) return;
    rematchChoiceActive = false;
    hideChallengePanel();
    audio.playSfx('restaurant-challenge-accept', { frequency: 660, endFrequency: 1320, duration: 0.2, gain: 0.12 });
    if (decision.next === 'round1-rematch') startRematchRound();
    else beginResultQuestion();
    syncHud();
  }

  // Everything one head-to-head leaves behind, so the next starts clean.
  // Settings, speech mode, the overlay and its listeners are untouched.
  function resetForNextRound({ total, patience = null, tables = DIFFICULTY[difficulty].count, paceScale = 1 }) {
    clearQuestion();
    cancelFocus();
    speech.cancel();
    speech.clearTarget();
    hud.hide();
    hideAction();
    setListenTarget(null);
    dialogue.hide();
    dialogueCustomer = null;
    dialogueRemaining = 0;
    questionCustomer = null;
    questionCommitted = false;
    clickQuestionCustomer = null;
    autoTarget = null;
    speechCooldown = 0;
    noticeRemaining = 0;
    if (notice) notice.hidden = true;
    combo = 0;
    comboRemaining = 0;
    if (comboPop) comboPop.hidden = true;
    phasePillRemaining = 0;
    if (phasePill) phasePill.hidden = true;
    if (temperature) temperature.hidden = true;
    temperatureText = '';

    for (const customer of customers) {
      if (customer.servedDish) removePhysicalDish(customer.servedDish, 'discarded');
      world.remove(customer.ownership);
      world.remove(customer.character);
      customer.character.disposeCharacter?.();
    }
    customers.length = 0;
    directorCustomerView.length = 0;
    rivalCustomerView.length = 0;
    for (const table of directorTableView) {
      table.occupied = false;
      table.customer = null;
    }
    if (carried) removePhysicalDish(carried, 'discarded');
    carried = null;
    // Belt dishes stay: the belt is order-blind, so they carry nothing over.
    for (const dish of [...dishes]) {
      if (dish.state !== 'belt') removePhysicalDish(dish, 'discarded');
    }
    discardRivalDish();

    rival = null;
    rivalWalk.active = false;
    rivalWalk.delayRemaining = 0;
    rivalWalk.durationRemaining = 0;
    rivalEmoteRemaining = 0;
    claimRegistry = createCustomerClaimRegistry();
    competitionScore = createCompetitionScore();
    shiftTotal = total;
    roundPatience = patience;
    serviceDirector = createRestaurantDirector({
      level: difficulty,
      tables,
      total,
      rng: Math.random,
      manualRush: true,
      paceScale,
    });
    directorPhase = serviceDirector.phase;
    focusReleasedAgo = Infinity;
    rushBeatRemaining = 0;

    restoreResultPose();
    restoreChallengePose();
    resultStage = null;
    resultOutcome = null;
    resultStagePendingOutcome = null;
    resultStageBeltTravel = null;
    resultNextNote = 0;
    if (resultLabel) {
      resultLabel.classList.remove('restaurant-ui__result--fading');
      resultLabel.hidden = true;
    }
    if (scoreText) {
      scoreText.classList.remove(
        'restaurant-ui__score--result',
        'restaurant-ui__score--stage',
        'restaurant-ui__score--compact',
      );
      scoreText.hidden = true;
    }
    hideChallengePanel();
    rematchChoiceActive = false;
    challengeSuppressedKeys.clear();
    roundEndRemaining = -1;
    turnaroundPartner = null;
    turnaroundWalk.walking = false;

    player.position.set(PLAYER_START.x, 0, PLAYER_START.z);
    player.rotation.set(0, 0, 0);
    player.playAnimation?.('idle', { fade: 0 });
    cameraRig.setTarget(player).setPreset('fixed', ROOM_CAMERA);
    setInstruction(STRINGS.walkToCustomer);
    // Belt dishes were hidden for the stage; show them where they are.
    updateConveyor(0);
  }

  // Waiter 1 again at the same difficulty: no solo phase and no entrance scene.
  function startRematchRound() {
    resetForNextRound({ total: competitiveRoundTotal(DIFFICULTY[difficulty].total) });
    phase = 'service';
    rivalCharacter.visible = true;
    rivalCharacter.position.set(RIVAL_ENTRANCE_END.x, 0, RIVAL_ENTRANCE_END.z);
    rivalCharacter.rotation.set(0, 0, 0);
    setRivalAnimation('idle', true);
    competitionScore.capture(claimRegistry.counts);
    serviceDirector.startRush();
    directorPhase = serviceDirector.phase;
    activateRivalModel();
    showPhaseCue('rush', STRINGS.rematchCue);
    updateChallengeScore();
    syncHud();
  }

  // A Round 1 win: Waiter 1 walks out, then Waiter 2 gets the full entrance.
  function beginRoundTwoTransition() {
    const settings = ROUND_TWO[difficulty];
    resetForNextRound({
      total: competitiveRoundTotal(DIFFICULTY[difficulty].total),
      patience: settings.patience,
      tables: settings.tables,
      paceScale: settings.paceScale,
    });
    phase = 'round-transition';
    rivalExit.character = rivalCharacter;
    rivalExit.index = 0;
    rivalCharacter.position.y = 0;
    setRivalAnimation('walk', true);
    syncHud();
  }

  function updateRivalExit(dt) {
    const character = rivalExit.character;
    const waypoint = RIVAL_EXIT_WAYPOINTS[rivalExit.index];
    if (!character || !waypoint) {
      beginRoundTwoIntro();
      return;
    }
    const dx = waypoint.x - character.position.x;
    const dz = waypoint.z - character.position.z;
    const distance = Math.hypot(dx, dz);
    const step = Math.min(distance, RIVAL_EXIT_SPEED * dt);
    if (distance > 1e-6) {
      character.position.x += dx / distance * step;
      character.position.z += dz / distance * step;
      character.rotation.y = Math.atan2(dx, dz);
    }
    if (step >= distance - 1e-6) rivalExit.index += 1;
  }

  function beginRoundTwoIntro() {
    if (rivalExit.character) {
      rivalExit.character.visible = false;
      rivalExit.character.playAnimation?.('idle', { fade: 0 });
    }
    rivalExit.character = null;
    if (!progression?.startRound2()) return;
    phase = 'service';
    rivalChallenge = createRivalChallenge({ enabled: true });
    rivalEmoteRemaining = 0;
    beginRivalChallenge();
  }

  function updateResultStage(dt) {
    const events = resultStage.advance(dt);
    updateResultSting();
    for (const event of events) {
      if (event.phase === 'settling') beginResultSettling();
      else if (event.phase === 'question') {
        beginAfterResult();
        if (phase !== 'result-stage') return;
      }
    }
    if (resultLabel && !resultStage.labelVisible
      && resultStage.phaseElapsed >= RESULT_STAGE_TIMING.labelFade) resultLabel.hidden = true;
  }

  function resetNodesToRest(rest) {
    for (const entry of Object.values(rest.nodes)) {
      entry.node.rotation.copy(entry.rotation);
      entry.node.position.copy(entry.position);
    }
  }

  function poseNode(rest, name, rotation = null, position = null) {
    const entry = rest.nodes[name];
    if (!entry) return;
    if (rotation) {
      entry.node.rotation.set(
        entry.rotation.x + (rotation.x ?? 0),
        entry.rotation.y + (rotation.y ?? 0),
        entry.rotation.z + (rotation.z ?? 0),
      );
    }
    if (position) {
      entry.node.position.set(
        entry.position.x + (position.x ?? 0),
        entry.position.y + (position.y ?? 0),
        entry.position.z + (position.z ?? 0),
      );
    }
  }

  function applyReactionPose(rest, reaction, seconds) {
    resetNodesToRest(rest);
    const pose = reactionPose(reaction, seconds);
    rest.character.position.y = pose.rootY;
    rest.character.rotation.y = pose.rootRotationY;
    for (const [name, rotation] of Object.entries(pose.nodes)) {
      poseNode(rest, name, rotation, pose.positions[name] ?? null);
    }
    for (const [name, position] of Object.entries(pose.positions)) {
      if (!pose.nodes[name]) poseNode(rest, name, null, position);
    }
  }

  function shortestAngle(from, to) {
    return from + Math.atan2(Math.sin(to - from), Math.cos(to - from));
  }

  function applySettlingPose(rest, targetRotationY, progress) {
    const start = rest.settlingStart;
    if (!start) return;
    const blend = THREE.MathUtils.smoothstep(progress, 0, 1);
    for (const [name, entry] of Object.entries(rest.nodes)) {
      const from = start.nodes[name];
      if (!from) continue;
      entry.node.rotation.set(
        THREE.MathUtils.lerp(from.rotation.x, entry.rotation.x, blend),
        THREE.MathUtils.lerp(from.rotation.y, entry.rotation.y, blend),
        THREE.MathUtils.lerp(from.rotation.z, entry.rotation.z, blend),
      );
      entry.node.position.lerpVectors(from.position, entry.position, blend);
    }
    rest.character.position.y = THREE.MathUtils.lerp(start.positionY, 0, blend);
    rest.character.rotation.y = THREE.MathUtils.lerp(
      start.rotationY,
      shortestAngle(start.rotationY, targetRotationY),
      blend,
    );
  }

  // The mixer owns the rest pose; result-stage offsets must be applied after it.
  function applyResultPosesAfterAnimation() {
    if (!resultStage?.active || !resultPoseState) return;
    if (resultStage.phase === 'reaction') {
      applyReactionPose(resultPoseState.player, resultStage.reactions.player, resultStage.phaseElapsed);
      applyReactionPose(resultPoseState.rival, resultStage.reactions.rival, resultStage.phaseElapsed);
    } else if (resultStage.phase === 'settling') {
      const total = RESULT_STAGE_TIMING.labelFade + RESULT_STAGE_TIMING.scoreShrink + RESULT_STAGE_TIMING.settle;
      const progress = Math.min(1, resultStage.phaseElapsed / total);
      const playerTarget = Math.atan2(
        rivalCharacter.position.x - player.position.x,
        rivalCharacter.position.z - player.position.z,
      );
      const rivalTarget = Math.atan2(
        player.position.x - rivalCharacter.position.x,
        player.position.z - rivalCharacter.position.z,
      );
      applySettlingPose(resultPoseState.player, playerTarget, progress);
      applySettlingPose(resultPoseState.rival, rivalTarget, progress);
    }
  }

  function challengerPump(seconds, start) {
    const duration = 0.32;
    if (seconds < start || seconds >= start + duration) return 0;
    const progress = (seconds - start) / duration;
    return Math.sin(progress * Math.PI) ** 0.7;
  }

  // Static mixer pose plus node offsets: planted and leaning in, with both
  // fists in front. It intentionally shares neither the result cheer's
  // sideways arms/hops nor the dejected pose's relaxed standing slump.
  function applyChallengerPoseAfterAnimation() {
    if (!challengePoseState || !rivalChallenge) return;
    const revealing = rivalChallenge.phase === 'reveal';
    const returning = rivalChallenge.phase === 'returning';
    if (!revealing && !returning) return;
    resetNodesToRest(challengePoseState);
    const seconds = revealing ? rivalChallenge.phaseElapsed : RIVAL_REVEAL_TIMING.reveal;
    const revealBlend = THREE.MathUtils.smoothstep(Math.min(1, seconds / 0.18), 0, 1);
    const returnBlend = returning
      ? 1 - THREE.MathUtils.smoothstep(
        Math.min(1, rivalChallenge.phaseElapsed / RIVAL_POSE_RETURN_SECONDS),
        0,
        1,
      )
      : 1;
    const blend = revealBlend * returnBlend;
    const pump = Math.max(challengerPump(seconds, 0.04), challengerPump(seconds, 0.43));
    const stomp = revealing && seconds < 0.24
      ? Math.sin(seconds / 0.24 * Math.PI) * 0.065
      : 0;
    challengePoseState.character.position.y = -stomp * blend;
    poseNode(challengePoseState, 'leg-left', { z: -0.2 * blend });
    poseNode(challengePoseState, 'leg-right', { z: 0.2 * blend });
    poseNode(challengePoseState, 'torso', { x: 0.27 * blend }, { z: 0.045 * blend });
    poseNode(challengePoseState, 'head', { x: 0.18 * blend }, { z: 0.035 * blend });
    // Fists up and forward in a V above the shoulders; each pump drives them higher.
    poseNode(challengePoseState, 'arm-left', {
      x: (-2.55 - pump * 0.35) * blend,
      z: 0.32 * blend,
    });
    poseNode(challengePoseState, 'arm-right', {
      x: (-2.55 - pump * 0.35) * blend,
      z: -0.32 * blend,
    });
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
    const rivalEnabled = Boolean(RIVAL_LEVELS[difficulty]?.enabled);
    claimRegistry = rivalEnabled ? createCustomerClaimRegistry() : null;
    rushTrigger = createRushTrigger({ enabled: rivalEnabled });
    competitionScore = createCompetitionScore();
    conveyor = createConveyor({
      difficulty,
      foods: LESSON.vocabulary.map((food) => food.id),
      rng: Math.random,
    });
    rival = null;
    serviceDirector = createRestaurantDirector({
      level: difficulty,
      tables: configured.count,
      total: shiftTotal,
      rng: Math.random,
      manualRush: rivalEnabled,
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
    rushBeatRemaining = 0;
    rivalChallenge = createRivalChallenge({ enabled: rivalEnabled });
    progression = rivalEnabled ? createRivalProgression() : null;
    for (const id of Object.keys(rivalCharacters)) delete rivalCharacters[id];
    rematchChoiceActive = false;
    rematchChoiceShownAt = -Infinity;
    roundPatience = null;
    rivalExit.character = null;
    rivalExit.index = 0;
    rivalEmoteRemaining = 0;
    challengeSuppressedKeys.clear();
    restoreChallengePose();
    rivalTurnStartRotation = Math.PI;
    rivalIntroJingleElapsed = 0;
    rivalIntroNextNote = 0;
    rivalRevealAccentElapsed = null;
    rivalRevealAccentNext = 0;
    rivalCameraCloseup = false;
    if (rivalEntranceLabel) rivalEntranceLabel.visible = false;
    if (rivalTitle) {
      rivalTitle.classList.remove('restaurant-ui__title--fading');
      rivalTitle.hidden = true;
    }
    turnaroundPartner = null;
    turnaroundWalk.walking = false;
    resultOutcome = null;
    resultStage = null;
    resultStageStartCount = 0;
    resultStagePendingOutcome = null;
    resultStageBeltTravel = null;
    restoreResultPose();
    resultNextNote = 0;
    if (resultLabel) {
      resultLabel.classList.remove('restaurant-ui__result--fading');
      resultLabel.hidden = true;
    }
    if (scoreText) scoreText.classList.remove(
      'restaurant-ui__score--result',
      'restaurant-ui__score--stage',
      'restaurant-ui__score--compact',
    );
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
    canvas = document.querySelector('#game-canvas');
    canvas?.addEventListener('pointerdown', onCanvasPointer);
    installDebugHook();
    unsubscribeSettings = settings.subscribe((next) => {
      if (!active) return;
      hud.setMicFree(next.micFree);
      hud.setTextSize(next.textSize);
      // setMicFree re-shows Talk; a settings change must not bring it over the challenge.
      syncHud();
    });
  }

  function update(dt) {
    if (!active) return;
    const safeDt = Math.min(Math.max(dt || 0, 0), 0.05);
    elapsed += safeDt;
    focus.update(safeDt);
    const serviceDt = focus.serviceDelta(safeDt);
    if (phase === 'service') {
      serviceElapsed += serviceDt;
      if (Number.isFinite(focusReleasedAgo)) focusReleasedAgo += serviceDt;
    }
    if (resultStage?.active) input.consumeInteract();

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
    if (!resultStage?.active && speechCooldown > 0) {
      speechCooldown -= safeDt;
      if (speechCooldown <= 0) hud.hide();
    }
    if (!resultStage?.active && comboRemaining > 0) {
      comboRemaining -= safeDt;
      if (comboRemaining <= 0) comboPop.hidden = true;
    }
    if (!resultStage?.active && phasePillRemaining > 0) {
      phasePillRemaining -= safeDt;
      if (phasePillRemaining <= 0) phasePill.hidden = true;
    }

    if (phase === 'service') {
      // The rival's challenge scene freezes everything that can cost the player,
      // however long the reply takes: movement, the belt, patience, customer
      // timers, the director and carried-dish temperature. Only the rival's
      // walk, the camera, the dialogue and cosmetic animation run.
      const introBefore = rivalIntroActive();
      if (introBefore) player.playAnimation?.('idle');
      else updateMovement(safeDt);
      updateRushSequence(introBefore ? safeDt : serviceDt);
      // Re-read after the sequence: on the frame the challenge starts, the
      // context update below must not re-target a customer and re-show Talk.
      const intro = rivalIntroActive();
      const playDt = intro ? 0 : serviceDt;
      updateRivalWalk(playDt);
      updateCustomers(playDt, safeDt);
      applyDirectorEvents(playDt);
      updateConveyor(playDt);
      updateCarried(playDt);
      if (intro) input.consumeInteract();
      else {
        updateContext();
        // First contact wins, and within one update the player's pickup resolves
        // before the rival's (SPEC §4): the player acts, then the rival advances.
        if (actionType && input.consumeInteract()) performAction();
      }
      if (rival) applyRivalEvents(playDt);
      else claimRegistry?.advance(playDt);
      if (rivalCharacter) {
        if (focus.active) setRivalAnimation('idle', true);
        else if (rivalChallenge?.phase === 'entering') setRivalAnimation('walk');
        else if (rivalChallenge?.phase === 'reveal' || rivalChallenge?.phase === 'returning') {
          setRivalAnimation('static');
        }
        else if (rivalIntroActive() && rivalEmoteRemaining > 0) setRivalAnimation('emote-yes');
        else if (rivalWalk.active && rivalWalk.delayRemaining <= 0) setRivalAnimation('walk');
        else setRivalAnimation('idle');
      }
      updateRoundEnd();
    } else if (phase === 'result-stage') {
      updateResultStage(safeDt);
    } else if (phase === 'round-transition') {
      input.consumeInteract();
      updateRivalExit(safeDt);
    } else if (phase === 'round-end') {
      player.playAnimation?.('idle');
      if (resultStagePendingOutcome) setRivalAnimation('idle');
      roundEndRemaining -= safeDt;
      if (roundEndRemaining <= 0) {
        const outcome = resultStagePendingOutcome;
        resultStagePendingOutcome = null;
        if (!outcome || !beginResultStage(outcome)) beginTurnaroundApproach();
      }
    } else if (phase === 'turnaround-approach') {
      updateTurnaroundApproach(safeDt);
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
    // Customers animate inside updateCustomers, which stops with service.
    if (phase !== 'service' && turnaroundPartner?.type === 'customer') {
      turnaroundPartner.character.updateAnimation?.(safeDt);
    }
    rivalCharacter?.updateAnimation?.(focus.active ? 0 : safeDt);
    applyChallengerPoseAfterAnimation();
    applyResultPosesAfterAnimation();
    syncHud();
  }

  function exit() {
    active = false;
    restoreChallengePose();
    restoreResultPose();
    resultStage = null;
    resultStageBeltTravel = null;
    scoreText?.classList.remove(
      'restaurant-ui__score--result',
      'restaurant-ui__score--stage',
      'restaurant-ui__score--compact',
    );
    resultLabel?.classList.remove('restaurant-ui__result--fading');
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
    window.removeEventListener('keydown', onChallengeKey, true);
    window.removeEventListener('keyup', onChallengeKeyUp, true);
    window.removeEventListener('blur', onChallengeBlur);
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
    scoreText = null;
    rivalTitle = null;
    resultLabel = null;
    player?.disposeCharacter?.();
    for (const character of Object.values(rivalCharacters)) character.disposeCharacter?.();
    for (const id of Object.keys(rivalCharacters)) delete rivalCharacters[id];
    progression = null;
    rematchChoiceActive = false;
    rivalExit.character = null;
    for (const customer of customers) customer.character.disposeCharacter?.();
    customers.length = 0;
    dishes.length = 0;
    records.length = 0;
    if (world) scene.remove(world);
    world = null;
    player = null;
    carryAnchor = null;
    turnaroundPartner = null;
    carried = null;
    autoTarget = null;
    canvas = null;
    questionCustomer = null;
    dialogueCustomer = null;
    serviceDirector = null;
    claimRegistry = null;
    rushTrigger = null;
    competitionScore = null;
    rushBeatRemaining = 0;
    rivalChallenge = null;
    rivalEmoteRemaining = 0;
    rivalEntranceLabel = null;
    challengePanel = null;
    challengeLine = null;
    challengeReplies = null;
    challengeTypewriter = null;
    challengeLineUnits = [];
    challengeSuppressedKeys.clear();
    challengePoseState = null;
    rivalCameraCloseup = false;
    createRivalCharacter = null;
    rival = null;
    rivalCharacter = null;
    rivalCarryAnchor = null;
    rivalCarriedDish = null;
    conveyor = null;
    conveyorSurface = null;
    dishReturnAnchor = null;
    dishReturnLabel = null;
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
