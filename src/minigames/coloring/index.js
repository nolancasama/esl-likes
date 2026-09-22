import * as THREE from 'three';
import { LESSON_BY_ID, UI, answerFor } from '../../config/lesson.js';
import { promptQuestion, promptAnswer } from '../../systems/speechPrompt.js';
import { createListenAgain } from '../../ui/listenAgain.js';
import { createPaintingSurface } from './picture.js';
import { PALETTE, PALETTE_HEX } from './palette.js';
import { BRUSHES, BRUSH_IDS, DEFAULT_BRUSH } from './brushes.js';
import { drawBlankBody, drawLineArt, PAPER } from './robotRenderer.js';
import { createCoverage, sessionStars } from './coverage.js';
import { createPaperPuppet, disposeSharedPaperAssets } from './paperPuppet.js';
import { STATES } from './robotPuppet.js';
import { createCrowd } from './robotCrowd.js';

const LESSON = LESSON_BY_ID.coloring;
const STRINGS = UI.coloring;
const MOVE_SPEED = 5;

/**
 * The room is one easel and a door, and both are Space.
 *
 * They are far enough apart that no position is inside both radii, so no
 * priority rule is needed — which matters, because one of them ends the
 * session and the other does not.
 */
const EASEL = Object.freeze({ x: 0, z: -1.6 });
const EASEL_RADIUS_SQ = 2.15 * 2.15;
const DOOR = Object.freeze({ x: 3.6, z: -4.55 });
const DOOR_RADIUS_SQ = 1.5 * 1.5;

/** The paper on the easel: a square, because the picture is a square. */
const PAPER_SIZE = 1.7;
const PAPER_CENTRE_Y = 1.78;

/**
 * The three camera stages (see .ai/coloring-easel-loop-spec.md section 4).
 *
 * The rig damps towards whatever preset it is given, so a staged pull-back is
 * three `setPreset` calls and no tween. The two cinematic stages use a low
 * damping so the move reads as a deliberate reveal.
 *
 * `paper`'s distance is not a guess: the camera is 48 degrees vertical, so the
 * visible height at distance d is 0.8905 d. At 2.45 in front of the sheet a
 * 1.7-unit page fills about 78% of the screen — which is what the DOM canvas
 * fills, and the cross-fade between them only works if they match.
 */
const CAMERA = Object.freeze({
  paper: Object.freeze({ offset: [0, PAPER_CENTRE_Y, 2.59], lookOffset: [0, PAPER_CENTRE_Y, 0], damping: 2.4 }),
  easel: Object.freeze({ offset: [1.5, 2.75, 5.9], lookOffset: [0, 1.15, 0.9], damping: 2.1 }),
  room: Object.freeze({ offset: [0, 8.5, 10.5], lookOffset: [0, 1.05, -2.2], damping: 5 }),
});

/**
 * The two sounds the shared table does not already have.
 *
 * `audio.playSfx` falls back to its second argument when the name is unknown,
 * so an ad-hoc tone needs no new dependency and no edit to the shared SFX
 * table, which the other four minigames also read.
 */
const SOUNDS = Object.freeze({
  // A power milestone: a short rising ping, quiet enough to be a hint.
  spark: { frequency: 620, endFrequency: 960, duration: 0.12, type: 'triangle', gain: 0.055 },
  // A sheet of paper landing on a wooden floor: short, low, and almost quiet.
  paperTap: { frequency: 220, endFrequency: 120, duration: 0.05, type: 'triangle', gain: 0.045 },
});

/**
 * One landing tap at a time, across the whole room.
 *
 * Twenty robots hopping is twenty paper-taps a second, which turns a quiet
 * flourish into a rattle. The cap is on the crowd, not on each robot.
 */
const LAND_SFX_GAP = 0.35;

/** The charging beat: full bar, blinks and a spark before anything moves. */
const CHARGE_SECONDS = 1.1;
/** The on-page half: glow, wiggle, one anticipatory hop. */
const STIR_SECONDS = 1.5;
/** How long the DOM page takes to dissolve into the 3D easel. */
const FADE_SECONDS = 0.55;
/** The puppet leaves the paper, hops off the easel and drops to the floor. */
const EXIT_SECONDS = 2;
/** A beat at the easel after the landing, before the room opens up. */
const REVEAL_HOLD = 1;
/** A beat after the pull-back before the child has the keys. */
const ROOM_HOLD = 1.1;
/** How long the blank sheet stays blank before the next drawing appears. */
const BLANK_DELAY_MIN = 2.5;
const BLANK_DELAY_SPAN = 1.5;
/** The new drawing fades in over this long. Visual invitation, never a gate. */
const PICTURE_FADE_SECONDS = 1.2;

/** Coloring v3: the magical easel. One page, one robot, then another, forever. */
export function createColoring(ctx) {
  const {
    scene,
    cameraRig,
    input,
    speech,
    audio,
    dialogue,
    characters,
    hud,
    settings,
    transitions,
    finish,
  } = ctx;

  let world = null;
  let player = null;
  let easelGroup = null;
  let easelArtCanvas = null;
  let easelArtTexture = null;
  let easelArtMaterial = null;
  let roomOverlay = null;
  let roomInstruction = null;
  let actionButton = null;
  let roomAction = null;
  let paintingOverlay = null;
  let paintingCanvas = null;
  let canvasWrap = null;
  let surface = null;
  let palette = null;
  let paintInstruction = null;
  let brushBar = null;
  let powerBar = null;
  let powerFill = null;
  let undoButton = null;
  let eraserButton = null;
  let resetButton = null;
  let resetConfirm = null;
  let bubble = null;
  let answerNotice = null;
  let listenAgain = null;
  let style = null;
  let unsubscribeSettings = null;

  let phase = 'inactive';
  let active = false;
  let questionTargeted = false;
  let replayed = false;
  let answerSentence = '';
  let selectedColor = null;
  let brushId = DEFAULT_BRUSH;
  let erasing = false;
  let favourite = null;
  let coverage = null;

  /** Every robot the child has made, in the order they made them. Never pruned. */
  const livingRobots = [];
  let crowd = null;
  let pendingPuppet = null;
  let lastLandAt = -Infinity;

  /** The sheet on the easel: 'blank' | 'fading' | 'ready' | 'finished'. */
  let easelArt = 'ready';
  let easelArtTimer = 0;
  /** Rolled once per blank sheet, so the room does not feel metronomic. */
  let blankDelay = BLANK_DELAY_MIN;

  let answerRemaining = 0;
  let answerNoticeRemaining = 0;
  let chargeRemaining = 0;
  let stirRemaining = 0;
  let exitElapsed = 0;
  let holdRemaining = 0;
  let finishRemaining = 0;
  let acceptedAnswer = null;
  let finishCalled = false;
  let elapsed = 0;
  let debugRootCreated = false;

  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  const move = new THREE.Vector2();

  const ownGeometry = (geometry) => { geometries.add(geometry); return geometry; };
  const ownMaterial = (material) => { materials.add(material); return material; };
  const makeMaterial = (color, options = {}) => ownMaterial(new THREE.MeshStandardMaterial({
    color,
    flatShading: true,
    roughness: 0.86,
    ...options,
  }));

  function addPart(parent, geometry, material, x, y, z, sx = 1, sy = 1, sz = 1) {
    const part = new THREE.Mesh(geometry, material);
    part.position.set(x, y, z);
    part.scale.set(sx, sy, sz);
    parent.add(part);
    return part;
  }

  function ownCanvasTexture(canvas) {
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    textures.add(texture);
    return texture;
  }

  function installStyle() {
    style = document.createElement('style');
    style.textContent = `
      .coloring-room-ui { position: absolute; inset: 0; pointer-events: none; }
      .coloring-room-ui__action { position: absolute; left: 50%; bottom: 1.25rem;
        transform: translateX(-50%); min-width: min(82vw, 21rem); min-height: 4rem;
        padding: .75rem 1.25rem; pointer-events: auto; border: .25rem solid #fff;
        border-radius: 1.4rem; background: #5b67c8; color: #fff;
        box-shadow: 0 .38rem 0 rgb(32 49 75 / .3);
        font: 900 calc(1.15rem * var(--ui-scale, 1)) system-ui, sans-serif; cursor: pointer; }
      .coloring-room-ui__action--door { background: #b4785f; }
      /* z-index 18, deliberately BELOW the HUD's 20. The question is asked on
         this screen now, so the Talk control has to be reachable — and the HUD
         is appended before this overlay, so an equal z-index puts the page on
         top of the only button the child needs. */
      .coloring-screen { position: absolute; inset: 0; z-index: 18; display: grid;
        grid-template-rows: auto 1fr auto; gap: .5rem; box-sizing: border-box;
        padding: clamp(.6rem, 1.8vh, 1.1rem); overflow: hidden; pointer-events: auto;
        background: #f7f0e8; color: #1b2940; font-family: system-ui, sans-serif;
        opacity: 1; transition: opacity ${FADE_SECONDS}s ease-in; }
      /* The cross-fade into the easel. The 3D room is already framed behind
         this at the same size, so dissolving rather than wiping is what keeps
         "the coloring screen WAS the canvas on this easel" believable. */
      .coloring-screen--leaving { opacity: 0; pointer-events: none; }
      .coloring-screen__top { display: flex; align-items: center; justify-content: center;
        gap: 1rem; flex-wrap: wrap; text-align: center; }
      .coloring-screen__top h1 { margin: 0; font-size: calc(clamp(1.2rem, 3.2vh, 1.9rem) * var(--ui-scale, 1)); }
      .coloring-screen__instruction { min-width: min(90vw, 24rem); margin: 0;
        font-size: calc(1.05rem * var(--ui-scale, 1)); font-weight: 800; }
      /* A grid, not a flex row. A flex line shorter than its content overflows
         both ways, which put the tool buttons on top of the title at 760x420
         and slid the lower palette rows under the bottom bar. */
      .coloring-screen__work { min-height: 0; min-width: 0; overflow: hidden;
        display: grid; grid-template-columns: auto minmax(0, 1fr);
        align-items: center; justify-items: center; gap: clamp(.6rem, 1.6vw, 1.2rem); }
      .coloring-side { display: flex; flex-direction: column; gap: .5rem; align-items: center; }
      /* Nothing but the drawing until the robot has spoken. The tools are a
         distraction from the one thing the child is here to say. */
      .coloring-screen[data-stage="asking"] .coloring-side,
      .coloring-screen[data-stage="asking"] .coloring-power,
      .coloring-screen[data-stage="asking"] .coloring-tools { display: none; }
      .coloring-screen[data-stage="painting"] .coloring-side,
      .coloring-screen[data-stage="painting"] .coloring-power,
      .coloring-screen[data-stage="painting"] .coloring-tools {
        animation: coloring-tools-in .45s cubic-bezier(.2,.9,.3,1.2) 1; }
      @keyframes coloring-tools-in {
        from { opacity: 0; transform: scale(.88); }
        to { opacity: 1; transform: none; }
      }
      /* Seven swatches no longer fit in one column, so the palette wraps in a
         two-wide grid beside the picture and reflows to a row when it is short. */
      .coloring-palette { display: grid; grid-template-columns: repeat(2, auto); gap: .5rem;
        padding: .55rem; border: .2rem solid #d9cfbf; border-radius: 1.3rem;
        background: rgb(255 255 255 / .78); }
      /* Three brushes, shown as three dots at their true relative size. */
      .coloring-brushes { display: grid; grid-template-columns: repeat(3, auto); gap: .3rem;
        padding: .4rem; border: .2rem solid #d9cfbf; border-radius: 1.1rem;
        background: rgb(255 255 255 / .78); }
      .coloring-brush { width: 2.6rem; height: 2.6rem; display: grid; place-items: center;
        padding: 0; border: .18rem solid #fff; border-radius: .8rem; background: #efe8db;
        box-shadow: 0 0 0 .14rem #273858; cursor: pointer; }
      .coloring-brush__dot { display: block; border-radius: 50%; background: #273858; }
      .coloring-brush[aria-pressed="true"] { background: #fff2c9;
        outline: .3rem solid #273858; outline-offset: .2rem; }
      .coloring-palette--invite .coloring-swatch { animation: coloring-invite 1.55s ease-in-out infinite; }
      .coloring-palette--invite .coloring-swatch:nth-child(2n) { animation-delay: .18s; }
      .coloring-palette--invite .coloring-swatch:nth-child(3n) { animation-delay: .36s; }
      @keyframes coloring-invite { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.09); } }
      .coloring-swatch { width: clamp(2.9rem, 6.4vh, 4rem); height: clamp(2.9rem, 6.4vh, 4rem);
        border: .3rem solid #fff; border-radius: 50%; box-shadow: 0 0 0 .18rem #273858,
        0 .3rem 0 rgb(39 56 88 / .22); cursor: pointer; }
      .coloring-swatch[aria-pressed="true"] { outline: .34rem solid #273858; outline-offset: .24rem; }
      .coloring-swatch:focus-visible, .coloring-screen button:focus-visible,
      .coloring-canvas:focus-visible {
        outline: .35rem solid #ff9f1c; outline-offset: .25rem; }
      /* Every button lives in one bottom bar. Giving the tools their own column
         beside the picture, then their own row on a short screen, cost the
         picture the space it most needs — and the picture is the game. */
      .coloring-tools { display: flex; gap: .5rem; flex-wrap: wrap; justify-content: center; }
      .coloring-tool { min-width: 5.4rem; min-height: 3rem; padding: .4rem .7rem;
        border: .2rem solid #fff; border-radius: 1rem; background: #6f7d96; color: #fff;
        box-shadow: 0 .28rem 0 rgb(32 49 75 / .28);
        font: 800 calc(.95rem * var(--ui-scale, 1)) system-ui, sans-serif; cursor: pointer; }
      .coloring-tool:disabled { background: #bdc0c4; box-shadow: none; cursor: default; }
      .coloring-tool[aria-pressed="true"] { background: #273858; outline: .28rem solid #ff9f1c;
        outline-offset: .18rem; }
      .coloring-tool--reset { background: #b4785f; }
      .coloring-canvas-wrap { position: relative; min-width: 0; min-height: 0;
        height: 100%; width: auto; max-height: min(78vh, 46rem); max-width: 100%;
        aspect-ratio: 1; display: grid; place-items: center; padding: .5rem; box-sizing: border-box;
        border: .3rem solid #273858; border-radius: 1.2rem; background: #fff;
        box-shadow: 0 .55rem 0 rgb(39 56 88 / .18); }
      .coloring-canvas { display: block; width: 100%; height: 100%; object-fit: contain;
        touch-action: none; cursor: pointer; border-radius: .65rem; }
      /* The drawing speaks for itself. Anchored in the page's empty upper right,
         beside the robot's head (the head spans x .285-.715, y .155-.36 of the
         picture), so it points at the speaker without covering it. */
      .coloring-bubble { position: absolute; left: 57%; top: 3%; z-index: 2;
        max-width: 40%; padding: .5rem .85rem; border: .22rem solid #273858;
        border-radius: 1.1rem 1.1rem 1.1rem .2rem; background: #fff;
        box-shadow: 0 .28rem 0 rgb(39 56 88 / .22);
        font-size: calc(1.15rem * var(--ui-scale, 1)); font-weight: 900; text-align: center;
        animation: coloring-bubble-in .3s cubic-bezier(.2,.9,.3,1.3) 1; }
      @keyframes coloring-bubble-in {
        from { opacity: 0; transform: scale(.7) translateY(.4rem); }
        to { opacity: 1; transform: none; }
      }
      .coloring-canvas-wrap--speaking { animation: coloring-speak .5s ease-in-out 1; }
      @keyframes coloring-speak {
        0%, 100% { transform: none; }
        30% { transform: rotate(-1.2deg); }
        70% { transform: rotate(1.2deg); }
      }
      .coloring-screen__bottom { display: flex; justify-content: center; align-items: center;
        flex-wrap: wrap; gap: .5rem clamp(.5rem, 2vw, 1.4rem); }
      /* ROBOT POWER. No number on it: a child reads a filling bar, and a
         percentage invites them to treat it as a mark. */
      .coloring-power { flex: 1 1 18rem; min-width: min(72vw, 16rem); max-width: 34rem;
        display: flex; flex-direction: column; gap: .15rem; }
      .coloring-power__label { font: 900 calc(.95rem * var(--ui-scale, 1)) system-ui, sans-serif;
        letter-spacing: .04em; }
      .coloring-power__track { display: block; height: 1.6rem; padding: .18rem;
        box-sizing: border-box; border: .2rem solid #273858; border-radius: 999px;
        background: #e7dfd0; box-shadow: inset 0 .12rem .3rem rgb(39 56 88 / .18); }
      .coloring-power__fill { display: block; width: 0; height: 100%; border-radius: 999px;
        background: linear-gradient(90deg, #62c46b, #f2c53d 65%, #ffae2e);
        transition: width .18s ease-out; }
      .coloring-power--full .coloring-power__fill {
        background: linear-gradient(90deg, #ffd34d, #fff2b0, #ffd34d); }
      .coloring-power--pulse { animation: coloring-power-pulse .6s ease-out 1; }
      @keyframes coloring-power-pulse {
        0%, 100% { transform: none; filter: none; }
        45% { transform: scale(1.035); filter: brightness(1.22); }
      }
      .coloring-answer-notice { position: absolute; top: 4.6rem; left: 50%; z-index: 24;
        transform: translateX(-50%); width: max-content; max-width: 82vw; padding: .6rem 1.1rem;
        border: .22rem solid #273858; border-radius: 999px; background: #fff;
        box-shadow: 0 .3rem 0 rgb(39 56 88 / .2); font-size: calc(1.3rem * var(--ui-scale, 1));
        font-weight: 900; text-align: center; }
      /* The robot stirring as it charges: one short warm flare on the page. */
      .coloring-canvas-wrap--spark { animation: coloring-spark .7s ease-out 1; }
      @keyframes coloring-spark {
        0%, 100% { box-shadow: 0 .55rem 0 rgb(39 56 88 / .18); }
        40% { box-shadow: 0 .55rem 0 rgb(39 56 88 / .18), 0 0 2rem .5rem rgb(255 231 140 / .9); }
      }
      .coloring-reset-confirm { position: absolute; inset: 0; z-index: 26; display: grid;
        place-items: center; padding: 1rem; background: rgb(31 42 65 / .6); }
      .coloring-reset-confirm__card { width: min(88vw, 24rem); padding: 1.6rem 1.3rem;
        box-sizing: border-box; border: .32rem solid #fff; border-radius: 1.8rem;
        background: #fff8df; box-shadow: 0 .6rem 0 rgb(30 43 68 / .35); text-align: center; }
      .coloring-reset-confirm__card p { margin: 0 0 1.1rem;
        font-size: calc(1.3rem * var(--ui-scale, 1)); font-weight: 900; }
      .coloring-reset-confirm__row { display: flex; gap: .8rem; justify-content: center; }
      /* Activation, still on the paper: it glows, it wiggles, it blinks, it
         gives one small hop. The page is NOT taken away here — the child keeps
         watching the same sheet, and the camera does the rest. */
      .coloring-canvas-wrap--alive { animation: coloring-wake ${STIR_SECONDS}s ease-in-out 1; }
      @keyframes coloring-wake {
        0% { transform: none; box-shadow: 0 .55rem 0 rgb(39 56 88 / .18); }
        16% { transform: rotate(-2.5deg) scale(.985);
              box-shadow: 0 0 2.5rem .6rem rgb(255 231 140 / .95); }
        28% { transform: rotate(2.5deg) scale(.985); }
        40% { transform: rotate(-1.6deg) scale(1.01); }
        60% { transform: translateY(-2.4rem) rotate(1.2deg) scale(1.04);
              box-shadow: 0 2.4rem 1.6rem rgb(39 56 88 / .22), 0 0 2.5rem .6rem rgb(255 231 140 / .9); }
        76% { transform: translateY(.2rem) rotate(-.8deg) scale(.99); }
        100% { transform: none; box-shadow: 0 0 2.5rem .6rem rgb(255 231 140 / .85); }
      }
      /* Narrow only: the title and the hint cannot share a line. Keyed to width
         alone — stacking them on a merely *short* screen cost the picture 30px
         it needed more. */
      @media (max-width: 46rem) {
        .coloring-screen__top { flex-direction: column; gap: .1rem; padding-right: 6.5rem; }
        .coloring-screen__top h1 { font-size: calc(1rem * var(--ui-scale, 1)); }
        .coloring-screen__instruction { font-size: calc(.9rem * var(--ui-scale, 1)); }
      }
      /* Short or narrow: one column of work, and everything else as tight as it
         goes, because the picture is the game. At 760x420 the palette, the power
         bar and the tools each took a row of their own and left the canvas
         130px — too small to paint a robot on. */
      @media (max-width: 46rem), (max-height: 34rem) {
        .coloring-screen { padding: .45rem; gap: .35rem; }
        /* The shell's せってい button floats top-right over this screen, and at
           760px the hint ran underneath it. Reserved here rather than in the
           narrow-only rule, because the collision is with a fixed button and so
           happens at any width once the header is this close to the top. */
        .coloring-screen__top { padding-right: 6.5rem; }
        .coloring-screen__work { grid-template-columns: minmax(0, 1fr);
          grid-template-rows: auto minmax(0, 1fr); gap: .35rem; }
        .coloring-side { flex-direction: row; gap: .35rem; }
        .coloring-palette { grid-template-columns: repeat(7, auto); gap: .3rem; padding: .3rem; }
        .coloring-brushes { padding: .28rem; gap: .25rem; }
        .coloring-brush { width: 2.3rem; height: 2.3rem; }
        .coloring-swatch { width: 2.8rem; height: 2.8rem; border-width: .22rem; }
        .coloring-tool { min-width: 4.2rem; min-height: 2.5rem; font-size: calc(.85rem * var(--ui-scale, 1)); }
        .coloring-canvas-wrap { padding: .3rem; border-width: .22rem; }
        .coloring-bubble { font-size: calc(.95rem * var(--ui-scale, 1)); padding: .35rem .6rem; }
        /* The bar's label moves beside its track, and the tools stay on the
           same line, so the whole bottom is one row instead of three. */
        .coloring-screen__bottom { flex-wrap: nowrap; gap: .5rem; }
        .coloring-power { flex: 1 1 10rem; min-width: 0; flex-direction: row;
          align-items: center; gap: .45rem; }
        .coloring-power__label { white-space: nowrap; font-size: calc(.8rem * var(--ui-scale, 1)); }
        .coloring-power__track { flex: 1 1 auto; height: 1.2rem; }
      }
      @media (prefers-reduced-motion: reduce) {
        .coloring-palette--invite .coloring-swatch { animation: none; }
        .coloring-canvas-wrap--alive { animation-duration: .5s; }
        .coloring-canvas-wrap--spark, .coloring-power--pulse,
        .coloring-canvas-wrap--speaking, .coloring-bubble { animation: none; }
        .coloring-screen[data-stage="painting"] .coloring-side,
        .coloring-screen[data-stage="painting"] .coloring-power,
        .coloring-screen[data-stage="painting"] .coloring-tools { animation: none; }
        .coloring-power__fill { transition: none; }
      }
    `;
    document.head.append(style);
  }

  // --- the room ------------------------------------------------------------

  function createRoomOverlay() {
    roomOverlay = document.createElement('div');
    roomOverlay.className = 'coloring-room-ui';
    roomOverlay.innerHTML = `
      <div class="top-bar"><section class="scene-card"><h1></h1><p></p></section></div>
      <button class="coloring-room-ui__action" type="button" hidden></button>
    `;
    roomOverlay.querySelector('h1').textContent = STRINGS.roomName;
    roomInstruction = roomOverlay.querySelector('p');
    roomInstruction.textContent = STRINGS.roomHint;
    actionButton = roomOverlay.querySelector('.coloring-room-ui__action');
    actionButton.addEventListener('click', pressRoomAction);
    roomOverlay.hidden = true;
    document.querySelector('#ui-layer').append(roomOverlay);
  }

  /**
   * The sheet on the easel, as a transparent overlay on the paper plane.
   *
   * No paper fill of its own: the easel's own paper plane provides that, so a
   * fade from nothing to line art reads as ink appearing on a sheet rather
   * than a second sheet materialising. The composition is otherwise exactly
   * `drawPage`'s — blank body, then paint, then line art over the top.
   */
  function drawEaselArt(paint = null) {
    const size = easelArtCanvas.width;
    const art = easelArtCanvas.getContext('2d');
    art.clearRect(0, 0, size, size);
    drawBlankBody(art, { size });
    if (paint) art.drawImage(paint, 0, 0, size, size);
    drawLineArt(art, { size });
    easelArtTexture.needsUpdate = true;
  }

  function setEaselArt(state, { paint = null } = {}) {
    easelArt = state;
    easelArtTimer = 0;
    if (state === 'blank') {
      blankDelay = BLANK_DELAY_MIN + Math.random() * BLANK_DELAY_SPAN;
      easelArtMaterial.opacity = 0;
      return;
    }
    drawEaselArt(paint);
    easelArtMaterial.opacity = state === 'fading' ? 0 : 1;
  }

  function buildWorld() {
    world = new THREE.Group();
    world.name = 'coloring-minigame';
    scene.background = new THREE.Color(0xf5cfc4);
    scene.fog = null;
    world.add(new THREE.HemisphereLight(0xffffff, 0x8b7190, 2.4));
    const sun = new THREE.DirectionalLight(0xffffff, 2.1);
    sun.position.set(6, 10, 7);
    world.add(sun);

    const box = ownGeometry(new THREE.BoxGeometry(1, 1, 1));
    const plane = ownGeometry(new THREE.PlaneGeometry(1, 1));
    const floorMaterial = makeMaterial(0xf1e5d1);
    const wallMaterial = makeMaterial(0xcbb8d9);
    const trimMaterial = makeMaterial(0x75b6a1);
    const woodMaterial = makeMaterial(0x9b6946);
    const easelMaterial = makeMaterial(0xd49362);
    const paperMaterial = makeMaterial(PAPER);

    addPart(world, box, floorMaterial, 0, -0.25, 0, 12.5, 0.5, 11.5);
    // The back wall, in two pieces with the doorway between them.
    addPart(world, box, wallMaterial, -2.6, 2.35, -5.55, 7.3, 5.2, 0.3);
    addPart(world, box, wallMaterial, 5.05, 2.35, -5.55, 2.4, 5.2, 0.3);
    addPart(world, box, wallMaterial, DOOR.x, 4.05, -5.55, 2.1, 1.8, 0.3);
    addPart(world, box, wallMaterial, -6.1, 1.55, 0, 0.3, 3.6, 11.5);
    addPart(world, box, wallMaterial, 6.1, 1.55, 0, 0.3, 3.6, 11.5);
    addPart(world, box, trimMaterial, -2.6, 0.2, -5.34, 7.3, 0.34, 0.12);
    addPart(world, box, trimMaterial, 5.05, 0.2, -5.34, 2.4, 0.34, 0.12);

    // The way out: a plain doorway in the back wall with dark beyond it. This
    // is the only thing in the room that is not the easel, and the only action
    // that ends the session.
    addPart(world, box, makeMaterial(0x2b2334), DOOR.x, 1.55, -5.62, 1.7, 3.1, 0.14);
    addPart(world, box, woodMaterial, DOOR.x, 3.16, -5.46, 2.05, 0.22, 0.26);
    addPart(world, box, woodMaterial, DOOR.x - 0.96, 1.55, -5.46, 0.18, 3.2, 0.26);
    addPart(world, box, woodMaterial, DOOR.x + 0.96, 1.55, -5.46, 0.18, 3.2, 0.26);

    // ONE easel, in the middle of the room, and the room is built around it.
    easelGroup = new THREE.Group();
    easelGroup.name = 'coloring-easel';
    easelGroup.position.set(EASEL.x, 0, EASEL.z);
    world.add(easelGroup);

    addPart(easelGroup, box, easelMaterial, -0.82, 1.26, -0.1, 0.18, 2.9, 0.18).rotation.z = 0.15;
    addPart(easelGroup, box, easelMaterial, 0.82, 1.26, -0.1, 0.18, 2.9, 0.18).rotation.z = -0.15;
    addPart(easelGroup, box, easelMaterial, 0, 1.3, -0.44, 0.16, 2.7, 0.16).rotation.x = -0.18;
    addPart(easelGroup, box, easelMaterial, 0, 0.86, -0.02, 1.95, 0.16, 0.2);
    addPart(easelGroup, plane, paperMaterial, 0, PAPER_CENTRE_Y, 0.02, PAPER_SIZE, PAPER_SIZE, 1);

    easelArtCanvas = document.createElement('canvas');
    easelArtCanvas.width = 700;
    easelArtCanvas.height = 700;
    easelArtTexture = ownCanvasTexture(easelArtCanvas);
    easelArtMaterial = ownMaterial(new THREE.MeshBasicMaterial({
      map: easelArtTexture, transparent: true, opacity: 1, depthWrite: false,
    }));
    addPart(easelGroup, plane, easelArtMaterial, 0, PAPER_CENTRE_Y, 0.035, PAPER_SIZE, PAPER_SIZE, 1);
    setEaselArt('ready');

    player = characters.create({ model: characters.playerModel });
    player.position.set(EASEL.x, 0, EASEL.z + 2.15);
    player.rotation.y = Math.PI;
    player.scale.setScalar(0.82);
    world.add(player);

    scene.add(world);
    // Built, but not shown. The first thing the child sees is the drawing.
    world.visible = false;
  }

  function canOccupy(x, z) {
    if (x < -5.45 || x > 5.45 || z < -4.8 || z > 4.85) return false;
    const easelDx = x - EASEL.x;
    const easelDz = z - EASEL.z;
    if (easelDx * easelDx + easelDz * easelDz < 1.15 * 1.15) return false;
    return true;
  }

  // Copied from Restaurant: same movement feel and verified Kenney +z facing convention.
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
    const wantedRotation = Math.atan2(move.x, -move.y);
    const turn = Math.atan2(Math.sin(wantedRotation - player.rotation.y), Math.cos(wantedRotation - player.rotation.y));
    player.rotation.y += turn * (1 - Math.exp(-12 * dt));
    player.playAnimation?.('walk');
  }

  const nearEasel = () => {
    const dx = player.position.x - EASEL.x;
    const dz = player.position.z - EASEL.z;
    return dx * dx + dz * dz <= EASEL_RADIUS_SQ;
  };

  const nearDoor = () => {
    const dx = player.position.x - DOOR.x;
    const dz = player.position.z - DOOR.z;
    return dx * dx + dz * dz <= DOOR_RADIUS_SQ;
  };

  /** Which Space action is offered right now, if any. */
  function setRoomAction(next) {
    if (roomAction === next) return;
    roomAction = next;
    if (!actionButton) return;
    actionButton.hidden = next === null;
    actionButton.classList.toggle('coloring-room-ui__action--door', next === 'door');
    if (next === 'easel') actionButton.textContent = STRINGS.easelAction;
    else if (next === 'door') actionButton.textContent = STRINGS.doorAction;
  }

  function pressRoomAction() {
    if (!active || phase !== 'room' || holdRemaining > 0) return;
    if (roomAction === 'easel') void openCanvas();
    else if (roomAction === 'door') beginTurnaround();
  }

  // --- the page ------------------------------------------------------------

  function clearQuestion() {
    if (!questionTargeted) return;
    questionTargeted = false;
    speech.clearTarget();
    hud.hide();
  }

  function replayAnswer() {
    if (!active || !answerSentence) return;
    replayed = true;
    audio.speak(answerSentence);
    if (answerNotice) {
      answerNotice.textContent = answerSentence;
      answerNotice.hidden = false;
      answerNoticeRemaining = 2.1;
    }
  }

  function targetQuestion() {
    questionTargeted = true;
    promptQuestion(ctx, LESSON, {
      isActive: () => active && phase === 'canvas-question',
      onAccepted: acceptQuestion,
    });
  }

  /**
   * The drawing answers.
   *
   * There is no artist any more: the thing on the page is the thing that
   * speaks, so the bubble belongs to the page and not to the 3D dialogue
   * system, whose anchors are Object3Ds in a world that is not even visible.
   */
  function acceptQuestion() {
    if (!active || phase !== 'canvas-question') return;
    phase = 'canvas-answer';
    questionTargeted = false;
    speech.clearTarget();
    hud.setTalkState('accepted');
    audio.playSfx('accept');
    answerSentence = answerFor(LESSON, favourite);
    bubble.textContent = answerSentence;
    bubble.hidden = false;
    flash(canvasWrap, 'coloring-canvas-wrap--speaking', 520);
    blinkOnce(1);
    // The first playback is manual. Only an actual press of the bubble replay
    // counts as listening again and forfeits the memory bonus.
    audio.speak(answerSentence);
    answerRemaining = 2.35;
  }

  /** The answer is over: the tools arrive and the child may paint. */
  function beginColoring() {
    if (!active || phase !== 'canvas-answer') return;
    phase = 'coloring';
    hud.hide();
    paintingOverlay.dataset.stage = 'painting';
    paintInstruction.textContent = STRINGS.chooseColor;
    palette.classList.add('coloring-palette--invite');
    refreshTools();
    setPower(coverage.power());
    listenAgain.show();
  }

  function selectColor(color) {
    if (phase !== 'coloring') return;
    selectedColor = color;
    erasing = false;
    palette.classList.remove('coloring-palette--invite');
    refreshTools();
    paintInstruction.textContent = STRINGS.paintHint;
    audio.playSfx('interact');
  }

  function selectBrush(id) {
    if (phase !== 'coloring') return;
    brushId = id;
    refreshTools();
    audio.playSfx('interact');
  }

  function refreshTools() {
    for (const button of palette.querySelectorAll('button')) {
      button.setAttribute('aria-pressed', String(!erasing && button.dataset.color === selectedColor));
    }
    for (const button of brushBar.querySelectorAll('button')) {
      button.setAttribute('aria-pressed', String(button.dataset.brush === brushId));
    }
    eraserButton.setAttribute('aria-pressed', String(erasing));
    undoButton.disabled = !surface?.canUndo;
  }

  function toggleEraser() {
    if (phase !== 'coloring') return;
    erasing = !erasing;
    palette.classList.remove('coloring-palette--invite');
    refreshTools();
    audio.playSfx('interact');
  }

  function undo() {
    if (phase !== 'coloring' || !surface?.canUndo) return;
    surface.undo();
    refreshTools();
    audio.playSfx('interact');
  }

  function askReset() {
    if (phase !== 'coloring') return;
    resetConfirm.hidden = false;
    resetConfirm.querySelector('[data-reset="no"]').focus();
  }

  function closeReset() {
    resetConfirm.hidden = true;
    resetButton.focus();
  }

  function confirmReset() {
    // Undo every stroke rather than clearing two things separately: the paint
    // and the coverage grid must never disagree about what has been coloured.
    while (surface.canUndo) surface.undo();
    coverage.reset();
    setPower(0);
    refreshTools();
    closeReset();
    audio.playSfx('interact');
  }

  /** The ⚡ bar. No number: a child reads a filling bar, not a percentage. */
  function setPower(value) {
    if (!powerFill) return;
    const clamped = Math.min(1, Math.max(0, value));
    powerFill.style.width = `${(clamped * 100).toFixed(1)}%`;
    powerBar.setAttribute('aria-valuenow', String(Math.round(clamped * 100)));
    powerBar.classList.toggle('coloring-power--full', clamped >= 1);
  }

  /** A brief, playful flash on an element, without keeping a timer per element. */
  function flash(element, className, ms) {
    if (!element) return;
    element.classList.add(className);
    setTimeout(() => element?.classList.remove(className), ms);
  }

  /**
   * The robot stirring as it charges.
   *
   * Brief on purpose: a child painting should not be interrupted, so each
   * milestone is one short flicker and nothing blocks the brush. `takeMilestone`
   * is edge-triggered, so none of these can repeat.
   */
  function fireMilestone(milestone) {
    if (milestone.index === 0) {
      flash(powerBar, 'coloring-power--pulse', 620);
      audio.playSfx('spark', SOUNDS.spark);
    } else if (milestone.index === 1) {
      flash(canvasWrap, 'coloring-canvas-wrap--spark', 700);
      audio.playSfx('spark', SOUNDS.spark);
    } else {
      blinkOnce(2);
      flash(powerBar, 'coloring-power--pulse', 620);
      audio.playSfx('accept');
    }
  }

  /** Closes and opens the robot's eyes, `times` times. */
  function blinkOnce(times = 1) {
    if (!surface) return;
    let left = times;
    const shut = () => {
      if (!surface) return;
      surface.setBlink(1);
      setTimeout(() => {
        if (!surface) return;
        surface.setBlink(0);
        left -= 1;
        if (left > 0) setTimeout(shut, 130);
      }, 140);
    };
    shut();
  }

  /** Answers the surface after every stroke: the bar, the tools, activation. */
  function onPaintChanged(info) {
    if (info.needsColor) {
      paintInstruction.textContent = STRINGS.chooseColor;
      flash(palette, 'coloring-palette--invite', 1600);
      return;
    }
    setPower(info.power);
    if (undoButton) undoButton.disabled = !info.canUndo;
    if (info.milestone) fireMilestone(info.milestone);
    if (info.power >= 1 && phase === 'coloring') beginCharging();
  }

  function createPaintingOverlay() {
    paintingOverlay = document.createElement('section');
    paintingOverlay.className = 'coloring-screen';
    // Nothing but the drawing and the question until the robot has answered.
    paintingOverlay.dataset.stage = 'asking';
    paintingOverlay.innerHTML = `
      <header class="coloring-screen__top"><h1></h1><p class="coloring-screen__instruction"></p></header>
      <div class="coloring-screen__work">
        <div class="coloring-side">
          <div class="coloring-palette" role="group"></div>
          <div class="coloring-brushes" role="group"></div>
        </div>
        <div class="coloring-canvas-wrap">
          <canvas class="coloring-canvas"></canvas>
          <div class="coloring-bubble" role="status" aria-live="polite" hidden></div>
        </div>
      </div>
      <div class="coloring-screen__bottom">
        <div class="coloring-power" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
          <span class="coloring-power__label"></span>
          <span class="coloring-power__track"><span class="coloring-power__fill"></span></span>
        </div>
        <div class="coloring-tools">
          <button class="coloring-tool coloring-tool--undo" type="button" disabled></button>
          <button class="coloring-tool coloring-tool--eraser" type="button" aria-pressed="false"></button>
          <button class="coloring-tool coloring-tool--reset" type="button"></button>
        </div>
      </div>
      <div class="coloring-answer-notice" role="status" aria-live="polite" hidden></div>
      <div class="coloring-reset-confirm" hidden>
        <section class="coloring-reset-confirm__card">
          <p></p>
          <div class="coloring-reset-confirm__row">
            <button class="coloring-tool" type="button" data-reset="no"></button>
            <button class="coloring-tool coloring-tool--reset" type="button" data-reset="yes"></button>
          </div>
        </section>
      </div>
    `;
    paintingOverlay.querySelector('h1').textContent = STRINGS.paintTitle;
    paintInstruction = paintingOverlay.querySelector('.coloring-screen__instruction');
    paintInstruction.textContent = STRINGS.askRobot;

    palette = paintingOverlay.querySelector('.coloring-palette');
    palette.setAttribute('aria-label', STRINGS.paletteLabel);
    for (const color of PALETTE) {
      const swatch = document.createElement('button');
      swatch.type = 'button';
      swatch.className = 'coloring-swatch';
      swatch.dataset.color = color;
      swatch.style.background = PALETTE_HEX[color];
      swatch.setAttribute('aria-pressed', 'false');
      swatch.setAttribute('aria-label', STRINGS.colors[color]);
      swatch.title = STRINGS.colors[color];
      swatch.addEventListener('click', onSwatchClick);
      palette.append(swatch);
    }

    // Three brushes shown as three dots at their real relative size, so the
    // choice needs no reading at all.
    brushBar = paintingOverlay.querySelector('.coloring-brushes');
    brushBar.setAttribute('aria-label', STRINGS.brushLabel);
    for (const id of BRUSH_IDS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'coloring-brush';
      button.dataset.brush = id;
      button.setAttribute('aria-pressed', String(id === brushId));
      button.setAttribute('aria-label', STRINGS.brushes[id]);
      button.title = STRINGS.brushes[id];
      const dot = document.createElement('span');
      dot.className = 'coloring-brush__dot';
      // Shown at a third of true size, which keeps Large inside the button.
      dot.style.width = `${BRUSHES[id].diameter / 3}px`;
      dot.style.height = `${BRUSHES[id].diameter / 3}px`;
      button.append(dot);
      button.addEventListener('click', onBrushClick);
      brushBar.append(button);
    }

    canvasWrap = paintingOverlay.querySelector('.coloring-canvas-wrap');
    paintingCanvas = paintingOverlay.querySelector('.coloring-canvas');
    paintingCanvas.setAttribute('aria-label', STRINGS.paintTitle);
    bubble = paintingOverlay.querySelector('.coloring-bubble');

    powerBar = paintingOverlay.querySelector('.coloring-power');
    powerBar.querySelector('.coloring-power__label').textContent = `⚡ ${STRINGS.power}`;
    powerFill = paintingOverlay.querySelector('.coloring-power__fill');

    undoButton = paintingOverlay.querySelector('.coloring-tool--undo');
    undoButton.textContent = STRINGS.tools.undo;
    undoButton.addEventListener('click', undo);
    eraserButton = paintingOverlay.querySelector('.coloring-tool--eraser');
    eraserButton.textContent = STRINGS.tools.eraser;
    eraserButton.setAttribute('aria-label', STRINGS.tools.eraserLabel);
    eraserButton.addEventListener('click', toggleEraser);
    resetButton = paintingOverlay.querySelector('.coloring-tools .coloring-tool--reset');
    resetButton.textContent = STRINGS.tools.reset;
    resetButton.addEventListener('click', askReset);

    resetConfirm = paintingOverlay.querySelector('.coloring-reset-confirm');
    resetConfirm.querySelector('p').textContent = STRINGS.tools.resetConfirm;
    const resetNo = resetConfirm.querySelector('[data-reset="no"]');
    resetNo.textContent = STRINGS.tools.resetNo;
    resetNo.addEventListener('click', closeReset);
    const resetYes = resetConfirm.querySelector('[data-reset="yes"]');
    resetYes.textContent = STRINGS.tools.resetYes;
    resetYes.addEventListener('click', confirmReset);

    answerNotice = paintingOverlay.querySelector('.coloring-answer-notice');

    document.querySelector('#ui-layer').append(paintingOverlay);
    surface = createPaintingSurface({
      canvas: paintingCanvas,
      coverage,
      color: () => selectedColor,
      brush: () => brushId,
      erasing: () => erasing,
      // Paint stops the instant the bar fills; the robot is waking up. It is
      // also locked before the answer, so the page cannot be coloured while
      // the child is meant to be asking.
      locked: () => phase !== 'coloring',
      onChange: onPaintChanged,
    });
    listenAgain = createListenAgain({ root: paintingOverlay, label: UI.listenAgain, onPress: replayAnswer });
  }

  function onSwatchClick(event) {
    selectColor(event.currentTarget.dataset.color);
    if (event.detail > 0) event.currentTarget.blur();
  }

  function onBrushClick(event) {
    selectBrush(event.currentTarget.dataset.brush);
    if (event.detail > 0) event.currentTarget.blur();
  }

  // --- a round -------------------------------------------------------------

  /**
   * Everything a new round resets, and nothing else.
   *
   * The player, the room, the easel and every living robot are session state
   * and survive this untouched — in particular, disposing the painting surface
   * must not disturb a puppet's textures, which each puppet copied for itself
   * when it was built.
   */
  function startRound() {
    replayed = false;
    answerSentence = '';
    selectedColor = null;
    erasing = false;
    answerRemaining = 0;
    answerNoticeRemaining = 0;
    chargeRemaining = 0;
    stirRemaining = 0;
    exitElapsed = 0;
    favourite = PALETTE[Math.floor(Math.random() * PALETTE.length)];
    coverage = createCoverage({ favourite });
    createPaintingOverlay();
    phase = 'canvas-question';
    targetQuestion();
  }

  /** Room → close-up. Space works in every canvas state, so this never refuses. */
  async function openCanvas() {
    if (!active || phase !== 'room') return;
    phase = 'to-canvas';
    setRoomAction(null);
    const changed = await transitions.run(() => {
      if (!active) return;
      world.visible = false;
      roomOverlay.hidden = true;
      dialogue.hide();
      speech.clearTarget();
      speech.cancel();
      input.clear();
      // Whatever the sheet was doing out there, the close-up starts on a fresh
      // drawing — which is what makes "press Space while it is still fading"
      // legal rather than a special case.
      setEaselArt('ready');
      startRound();
    });
    if (!changed && active && phase === 'to-canvas') phase = 'room';
  }

  /**
   * Full power. There is no Done button and no way to fail — the bar filling
   * *is* the win, so activation starts by itself.
   *
   * The charging beat comes first: a strong pulse, a couple of blinks and a
   * spark on the page, so the child sees the robot stirring before anything
   * moves.
   */
  function beginCharging() {
    if (phase !== 'coloring') return;
    phase = 'activation-page';
    listenAgain.hide();
    paintInstruction.textContent = STRINGS.powerFull;
    setPower(1);
    flash(powerBar, 'coloring-power--pulse', 900);
    flash(canvasWrap, 'coloring-canvas-wrap--spark', 900);
    audio.playSfx('complete');
    blinkOnce(2);
    chargeRemaining = CHARGE_SECONDS;
  }

  /** Still on the paper: it glows, wiggles, blinks and gives one small hop. */
  function stirOnPage() {
    paintInstruction.textContent = STRINGS.alive;
    canvasWrap.classList.add('coloring-canvas-wrap--alive');
    blinkOnce(2);
    audio.playSfx('spark', SOUNDS.spark);
    stirRemaining = STIR_SECONDS;
  }

  /** One landing tap for the whole room, however many robots are hopping. */
  function landTap() {
    if (elapsed - lastLandAt < LAND_SFX_GAP) return;
    lastLandAt = elapsed;
    audio.playSfx('land', SOUNDS.paperTap);
  }

  /**
   * STAGE 1 → 2: the reveal.
   *
   * The finished page goes onto the easel, the camera is already framing it,
   * and then the DOM screen dissolves. The wipe `transitions.run` provides is
   * a hard cut, and a hard cut here would throw away the whole illusion the
   * pull-back exists to create: that the coloring screen was this sheet, on
   * this easel, in front of this child, the entire time.
   */
  async function revealEasel() {
    if (!active || phase !== 'activation-page') return;
    phase = 'reveal-easel';

    // The puppet is built from the live paint canvas, so it has to exist
    // before the painting surface is torn down.
    pendingPuppet = createPaperPuppet({ paint: surface.paint, onLand: landTap });
    setEaselArt('finished', { paint: surface.paint });

    world.visible = true;
    roomOverlay.hidden = true;
    player.position.set(EASEL.x, 0, EASEL.z + 2.15);
    player.rotation.y = Math.PI;
    player.playAnimation?.('idle');
    cameraRig.setTarget(easelGroup).setPreset('follow', CAMERA.paper);

    paintingOverlay.classList.add('coloring-screen--leaving');
    await new Promise((resolve) => { setTimeout(resolve, FADE_SECONDS * 1000); });
    if (!active || phase !== 'reveal-easel') return;

    disposePaintingOverlay();
    cameraRig.setPreset('follow', CAMERA.easel);
    beginRobotExit();
  }

  /**
   * The drawing leaves the page.
   *
   * The sheet goes blank the moment the puppet lifts off it. The same robot may
   * never be visible both alive and printed, and there is no longer any copy of
   * the artwork anywhere in the room — the wall frame and the carried picture
   * are gone. The drawing really left.
   */
  function beginRobotExit() {
    phase = 'robot-exit';
    exitElapsed = 0;
    world.add(pendingPuppet.group);
    pendingPuppet.placeAt(EASEL.x, EASEL.z + 0.2, 0);
    pendingPuppet.setState(STATES.STARTUP);
    pendingPuppet.setGlowFloor(0.4);
    // Standing on the lower edge of the sheet, not on the floor.
    pendingPuppet.setLift(PAPER_CENTRE_Y - PAPER_SIZE / 2);
  }

  /**
   * The exit timeline, in one place so the beats can be read at a glance.
   *
   * 0.00-0.45  on the sheet, shaking itself awake; the ink drains from the page
   * 0.45-1.30  peels forward and hops off the easel in an arc
   * 1.30-2.00  lands, taps, and has a moment about it
   */
  function updateRobotExit(dt) {
    exitElapsed += dt;
    const puppet = pendingPuppet;
    const startLift = PAPER_CENTRE_Y - PAPER_SIZE / 2;

    if (exitElapsed < 0.45) {
      // The page loses its drawing while the puppet is still against it.
      easelArtMaterial.opacity = Math.max(0, 1 - exitElapsed / 0.4);
    } else if (exitElapsed < 1.3) {
      if (easelArt !== 'blank') setEaselArt('blank');
      const k = (exitElapsed - 0.45) / 0.85;
      const arc = Math.sin(k * Math.PI) * 0.45;
      puppet.placeAt(EASEL.x, EASEL.z + 0.2 + k * 1.75, 0);
      puppet.setLift(startLift * (1 - k) + arc);
    } else {
      puppet.setLift(0);
      if (puppet.state === STATES.STARTUP) {
        landTap();
        puppet.setState(STATES.CELEBRATE);
        puppet.setGlowFloor(0.12);
      }
      if (exitElapsed >= EXIT_SECONDS) {
        holdRemaining = REVEAL_HOLD;
        phase = 'room-reveal';
      }
    }
  }

  /** STAGE 2 → 3: the whole room, and every robot in it. */
  function revealRoom() {
    const member = crowd.join();
    pendingPuppet.startRoaming(member.points, member);
    livingRobots.push({ id: member.id, puppet: pendingPuppet, member });
    pendingPuppet = null;

    cameraRig.setTarget(player).setPreset('follow', CAMERA.room);
    roomOverlay.hidden = false;
    roomInstruction.textContent = STRINGS.roomHint;
    // Force the label to be rewritten next frame, whatever it said last round.
    roomAction = undefined;
    setRoomAction(null);
    // The sheet is blank; a fresh drawing drifts onto it shortly, and the child
    // may interrupt that at any point.
    setEaselArt('blank');
    holdRemaining = ROOM_HOLD;
    phase = 'room';
    input.clear();
  }

  /** blank → fading → ready. A visual invitation, and never a lockout. */
  function updateEaselArt(dt) {
    easelArtTimer += dt;
    if (easelArt === 'blank') {
      if (easelArtTimer >= blankDelay) setEaselArt('fading');
      return;
    }
    if (easelArt === 'fading') {
      const k = Math.min(1, easelArtTimer / PICTURE_FADE_SECONDS);
      easelArtMaterial.opacity = k;
      if (k >= 1) setEaselArt('ready');
    }
  }

  // --- the turnaround, and the way out -------------------------------------

  /**
   * The child's newest robot turns the question around.
   *
   * `finish()` is the only exit from a minigame, and SPEC freezes one
   * turnaround per minigame, so the door carries both. The robot asking is the
   * child's own creation, which is a better fiction than the artist NPC this
   * replaces.
   */
  function beginTurnaround() {
    if (!active || phase !== 'room') return;
    phase = 'turnaround';
    setRoomAction(null);
    const newest = livingRobots.at(-1);
    if (newest) {
      newest.puppet.stopRoaming().setState(STATES.IDLE);
      // The child stands beside it rather than between it and the camera.
      const target = newest.puppet.group.position;
      player.position.set(target.x + 1.5, 0, target.z + 1.3);
      player.rotation.y = Math.atan2(target.x - player.position.x, target.z - player.position.z);
      player.playAnimation?.('idle');
      newest.puppet.setHeading(Math.atan2(player.position.x - target.x, player.position.z - target.z));
      cameraRig
        .setTarget(newest.puppet.group)
        .setPreset('closeup', { offset: [0, 2.2, 3.6], lookOffset: [0, 1, 0], damping: 4 });
      dialogue.show({ text: LESSON.question, anchor: newest.puppet.group, offsetY: 2.1 });
    } else {
      dialogue.show({ text: LESSON.question, anchor: player, offsetY: 1.8 });
    }
    roomInstruction.textContent = STRINGS.turnaround;
    promptAnswer(ctx, LESSON, { isActive: () => active && phase === 'turnaround', onAccepted: completeTurnaround });
  }

  function completeTurnaround(answer) {
    if (!active || phase !== 'turnaround') return;
    acceptedAnswer = answer || LESSON.answers[0];
    phase = 'finishing';
    speech.clearTarget();
    hud.setTalkState('accepted');
    roomInstruction.textContent = STRINGS.complete;
    audio.playSfx('stamp');
    // Everybody celebrates. This is the last thing the child sees of the room.
    for (const robot of livingRobots) robot.puppet.stopRoaming().setState(STATES.CELEBRATE);
    finishRemaining = 1.1;
  }

  // --- teardown ------------------------------------------------------------

  function disposePaintingOverlay() {
    listenAgain?.dispose();
    listenAgain = null;
    surface?.dispose();
    surface = null;
    for (const swatch of palette?.querySelectorAll('button') ?? []) {
      swatch.removeEventListener('click', onSwatchClick);
    }
    for (const button of brushBar?.querySelectorAll('button') ?? []) {
      button.removeEventListener('click', onBrushClick);
    }
    undoButton?.removeEventListener('click', undo);
    eraserButton?.removeEventListener('click', toggleEraser);
    resetButton?.removeEventListener('click', askReset);
    resetConfirm?.querySelector('[data-reset="no"]')?.removeEventListener('click', closeReset);
    resetConfirm?.querySelector('[data-reset="yes"]')?.removeEventListener('click', confirmReset);
    paintingOverlay?.remove();
    if (paintingCanvas) {
      paintingCanvas.width = 0;
      paintingCanvas.height = 0;
    }
    paintingOverlay = null;
    paintingCanvas = null;
    canvasWrap = null;
    palette = null;
    brushBar = null;
    paintInstruction = null;
    powerBar = null;
    powerFill = null;
    undoButton = null;
    eraserButton = null;
    resetButton = null;
    resetConfirm = null;
    bubble = null;
    answerNotice = null;
  }

  /**
   * The harness window, following the same `__eslDebug` convention the
   * Restaurant, Drink Stand and Zoo already use.
   *
   * It deliberately does NOT expose the favourite colour. That is the one thing
   * a child is meant to have remembered, and a playthrough can hear it in the
   * dialogue exactly as they do.
   *
   * `art` is a fingerprint of each robot's own texture. The failure that would
   * matter most here is silent — robot 1 quietly drawing robot 2's paint — and
   * no unit test can see it, so the harness is given something to compare.
   */
  function debugSnapshot() {
    return {
      phase,
      robotsCompleted: livingRobots.length,
      stars: sessionStars(livingRobots.length),
      usedListenAgain: replayed,
      power: coverage?.power() ?? 0,
      coverage: coverage?.coverage() ?? 0,
      favouriteShare: coverage?.favouriteShare() ?? 0,
      robotCells: coverage?.robotCells ?? 0,
      strokes: surface?.strokeCount ?? 0,
      canUndo: Boolean(surface?.canUndo),
      erasing,
      selectedColor,
      brush: brushId,
      toolsVisible: paintingOverlay?.dataset.stage === 'painting',
      easelArt,
      easelArtOpacity: easelArtMaterial?.opacity ?? 0,
      action: roomAction ?? null,
      canAct: phase === 'room' && holdRemaining <= 0,
      nearEasel: player && phase === 'room' ? nearEasel() : false,
      nearDoor: player && phase === 'room' ? nearDoor() : false,
      player: player ? { x: player.position.x, z: player.position.z } : null,
      robots: livingRobots.map((robot) => ({
        id: robot.id,
        state: robot.puppet.state,
        idlePause: robot.member.idlePause,
        position: {
          x: robot.puppet.group.position.x,
          y: robot.puppet.group.position.y,
          z: robot.puppet.group.position.z,
        },
        lift: robot.puppet.pose.root.y,
        art: robot.puppet.fingerprint(),
      })),
    };
  }

  /** Dev tool. Fills the room without painting twenty robots by hand. */
  function spawnRobots(count = 10, paint = null) {
    if (!world) return 0;
    for (let i = 0; i < count; i += 1) {
      const member = crowd.join();
      const puppet = createPaperPuppet({ paint: paint ?? surface?.paint ?? null, onLand: landTap });
      world.add(puppet.group);
      puppet.startRoaming(member.points, member);
      livingRobots.push({ id: member.id, puppet, member });
    }
    return livingRobots.length;
  }

  function installDebugHook() {
    if (!window.__eslDebug) {
      Object.defineProperty(window, '__eslDebug', { value: {}, configurable: true, writable: false });
      debugRootCreated = true;
    }
    Object.defineProperty(window.__eslDebug, 'coloring', { configurable: true, enumerable: true, get: debugSnapshot });
    // Dev only: filling a room by hand takes twenty rounds. Gated exactly as
    // the scene editor is, so a student's browser can never reach it.
    const devTools = Boolean(import.meta.env?.DEV)
      || new URLSearchParams(window.location.search).has('editor');
    if (devTools) window.__eslDebug.coloringSpawn = spawnRobots;
  }

  function removeDebugHook() {
    if (window.__eslDebug) {
      delete window.__eslDebug.coloring;
      delete window.__eslDebug.coloringSpawn;
    }
    if (debugRootCreated && window.__eslDebug && Object.keys(window.__eslDebug).length === 0) delete window.__eslDebug;
    debugRootCreated = false;
  }

  function enter() {
    active = true;
    phase = 'inactive';
    questionTargeted = false;
    acceptedAnswer = null;
    finishCalled = false;
    finishRemaining = 0;
    holdRemaining = 0;
    elapsed = 0;
    lastLandAt = -Infinity;
    brushId = DEFAULT_BRUSH;
    livingRobots.length = 0;
    pendingPuppet = null;
    crowd = createCrowd();
    installStyle();
    createRoomOverlay();
    // The room is built now so that the pull-back has something to reveal, but
    // it is not shown: the first thing the child sees is the drawing.
    buildWorld();
    installDebugHook();
    unsubscribeSettings = settings.subscribe((next) => {
      if (!active) return;
      hud.setMicFree(next.micFree);
      hud.setTextSize(next.textSize);
    });
    startRound();
  }

  function update(dt) {
    if (!active) return;
    const safeDt = Math.min(Math.max(dt || 0, 0), 0.05);
    elapsed += safeDt;

    if (answerNoticeRemaining > 0) {
      answerNoticeRemaining -= safeDt;
      if (answerNoticeRemaining <= 0 && answerNotice) answerNotice.hidden = true;
    }

    if (phase === 'canvas-answer') {
      answerRemaining -= safeDt;
      if (answerRemaining <= 0) beginColoring();
    } else if (phase === 'activation-page') {
      if (chargeRemaining > 0) {
        chargeRemaining -= safeDt;
        if (chargeRemaining <= 0) stirOnPage();
      } else if (stirRemaining > 0) {
        stirRemaining -= safeDt;
        if (stirRemaining <= 0) void revealEasel();
      }
    } else if (phase === 'robot-exit') {
      updateRobotExit(safeDt);
    } else if (phase === 'room-reveal') {
      holdRemaining -= safeDt;
      if (holdRemaining <= 0) revealRoom();
    } else if (phase === 'room') {
      // A beat after the reveal before the child has the keys, so the camera
      // finishes its move without being fought.
      if (holdRemaining > 0) {
        holdRemaining -= safeDt;
        player.playAnimation?.('idle');
      } else {
        updateMovement(safeDt);
        const easel = nearEasel();
        const door = !easel && nearDoor();
        setRoomAction(easel ? 'easel' : door ? 'door' : null);
        if (roomAction && input.consumeInteract()) pressRoomAction();
      }
      updateEaselArt(safeDt);
    } else if (phase === 'turnaround') {
      player.playAnimation?.('idle');
    } else if (phase === 'finishing') {
      finishRemaining -= safeDt;
      if (finishRemaining <= 0 && !finishCalled) {
        finishCalled = true;
        hud.hide();
        finish({
          stars: sessionStars(livingRobots.length),
          detail: { category: LESSON.category, answer: acceptedAnswer },
        });
      }
    }

    // Every robot the child has made keeps living, through every room phase.
    // The close-up pauses them, which is both cheaper and invisible.
    if (world?.visible) {
      for (const robot of livingRobots) robot.puppet.update(safeDt);
      pendingPuppet?.update(safeDt);
      player?.updateAnimation?.(safeDt);
    }
  }

  function exit() {
    active = false;
    phase = 'inactive';
    removeDebugHook();
    unsubscribeSettings?.();
    unsubscribeSettings = null;
    clearQuestion();
    speech.clearTarget();
    speech.cancel();
    audio.stop();
    hud.hide();
    dialogue.hide();
    cameraRig.setTarget(null);
    actionButton?.removeEventListener('click', pressRoomAction);
    disposePaintingOverlay();
    roomOverlay?.remove();
    style?.remove();

    // Every accumulated robot, and then the assets they were sharing. The
    // order matters: a puppet must not outlive the quad it draws with.
    for (const robot of livingRobots) robot.puppet.dispose();
    livingRobots.length = 0;
    pendingPuppet?.dispose();
    pendingPuppet = null;
    crowd = null;
    disposeSharedPaperAssets();

    player?.disposeCharacter?.();
    if (world) scene.remove(world);
    for (const texture of textures) texture.dispose();
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    textures.clear();
    geometries.clear();
    materials.clear();
    if (easelArtCanvas) {
      easelArtCanvas.width = 0;
      easelArtCanvas.height = 0;
    }
    world = null;
    player = null;
    easelGroup = null;
    easelArtCanvas = null;
    easelArtTexture = null;
    easelArtMaterial = null;
    roomOverlay = null;
    roomInstruction = null;
    actionButton = null;
    roomAction = null;
    style = null;
    favourite = null;
    coverage = null;
  }

  return { id: 'coloring', enter, update, exit };
}
