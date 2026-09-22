import * as THREE from 'three';
import { LESSON_BY_ID, UI, answerFor } from '../../config/lesson.js';
import { promptQuestion, promptAnswer } from '../../systems/speechPrompt.js';
import { createListenAgain } from '../../ui/listenAgain.js';
import { createColoringSurface } from './picture.js';
import { PALETTE, PALETTE_HEX, createColorState } from './colorState.js';
import { PICTURE_SIZE } from './robotDefinition.js';
import { drawRobot } from './robotRenderer.js';
import { OUTCOMES, pickRound, scoreRound } from './robotScoring.js';
import { createPaperPuppet } from './paperPuppet.js';
import { STATES } from './robotPuppet.js';

const LESSON = LESSON_BY_ID.coloring;
const STRINGS = UI.coloring;
const MOVE_SPEED = 5;
const NPC_RADIUS_SQ = 3 * 3;

/**
 * The two sounds the shared table does not already have.
 *
 * `audio.playSfx` falls back to its second argument when the name is unknown,
 * so an ad-hoc tone needs no new dependency and no edit to the shared SFX
 * table, which the other four minigames also read.
 *
 * The four Done outcomes used to play the same cheerful blip, which told a
 * child who cannot read the Japanese quickly nothing at all. Now: a low buzz
 * for ALMOST, the existing falling `retry` for a failed start-up, the ordinary
 * tap for INCOMPLETE (it is not a mistake), and rising `complete` for success.
 */
const SOUNDS = Object.freeze({
  partialBuzz: { frequency: 190, endFrequency: 130, duration: 0.22, type: 'square', gain: 0.06 },
  // A sheet of paper landing on a wooden floor: short, low, and almost quiet.
  paperTap: { frequency: 220, endFrequency: 120, duration: 0.05, type: 'triangle', gain: 0.045 },
});

/** The on-page half of the activation: glow, wiggle, a hop, then peel away. */
const PEEL_SECONDS = 1.65;
/** The puppet falls to the floor, then plays its startup, then roams. */
const DROP_SECONDS = 0.55;

/** Coloring v2 controller: tap-to-fill colouring, then the drawing comes alive. */
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
  let npc = null;
  let npcPicture = null;
  let carriedPicture = null;
  let framePicture = null;
  let frameMaterial = null;
  let roomOverlay = null;
  let roomInstruction = null;
  let actionButton = null;
  let paintingOverlay = null;
  let paintingCanvas = null;
  let canvasWrap = null;
  let surface = null;
  let palette = null;
  let paintInstruction = null;
  let doneButton = null;
  let undoButton = null;
  let eraserButton = null;
  let resetButton = null;
  let resetConfirm = null;
  let feedback = null;
  let answerNotice = null;
  let listenAgain = null;
  let style = null;
  let lineArtCanvas = null;
  let finishedCanvas = null;
  let lineArtTexture = null;
  let finishedTexture = null;
  let unsubscribeSettings = null;
  let puppet = null;
  let phase = 'inactive';
  let active = false;
  let questionTargeted = false;
  let replayed = false;
  let answerSentence = '';
  let selectedColor = null;
  let erasing = false;
  let answerRemaining = 0;
  let reactionRemaining = 0;
  let finishRemaining = 0;
  let answerNoticeRemaining = 0;
  let feedbackRemaining = 0;
  let hintRemaining = 0;
  let peelRemaining = 0;
  let dropRemaining = 0;
  let scoreResult = null;
  let acceptedAnswer = null;
  let finishCalled = false;
  let elapsed = 0;
  let round = null;
  let colors = null;
  let lastOutcome = null;
  let debugRootCreated = false;

  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  const move = new THREE.Vector2();

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
      .coloring-screen { position: absolute; inset: 0; z-index: 20; display: grid;
        grid-template-rows: auto 1fr auto; gap: .5rem; box-sizing: border-box;
        padding: clamp(.6rem, 1.8vh, 1.1rem); overflow: auto; pointer-events: auto;
        background: #f7f0e8; color: #1b2940; font-family: system-ui, sans-serif; }
      .coloring-screen__top { display: flex; align-items: center; justify-content: center;
        gap: 1rem; flex-wrap: wrap; text-align: center; }
      .coloring-screen__top h1 { margin: 0; font-size: calc(clamp(1.2rem, 3.2vh, 1.9rem) * var(--ui-scale, 1)); }
      .coloring-screen__instruction { min-width: min(90vw, 24rem); margin: 0;
        font-size: calc(1.05rem * var(--ui-scale, 1)); font-weight: 800; }
      /* A grid, not a flex row. A flex line shorter than its content overflows
         both ways, which put the tool buttons on top of the title at 760x420
         and, worse, slid the lower palette rows under the できた button so a tap
         meant for a colour pressed Done. */
      .coloring-screen__work { min-height: 0; min-width: 0; overflow: hidden;
        display: grid; grid-template-columns: auto minmax(0, 1fr);
        align-items: center; justify-items: center; gap: clamp(.6rem, 1.6vw, 1.2rem); }
      /* Seven swatches no longer fit in one column, so the palette wraps in a
         two-wide grid beside the picture and reflows to a row when it is short. */
      .coloring-palette { display: grid; grid-template-columns: repeat(2, auto); gap: .5rem;
        padding: .55rem; border: .2rem solid #d9cfbf; border-radius: 1.3rem;
        background: rgb(255 255 255 / .78); }
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
      .coloring-canvas-wrap { min-width: 0; min-height: 0; height: 100%; width: auto;
        max-height: min(78vh, 46rem); max-width: 100%;
        aspect-ratio: 1; display: grid; place-items: center; padding: .5rem; box-sizing: border-box;
        border: .3rem solid #273858; border-radius: 1.2rem; background: #fff;
        box-shadow: 0 .55rem 0 rgb(39 56 88 / .18); }
      .coloring-canvas { display: block; width: 100%; height: 100%; object-fit: contain;
        touch-action: none; cursor: pointer; border-radius: .65rem; }
      .coloring-screen__bottom { display: flex; justify-content: center; align-items: center;
        flex-wrap: wrap; gap: .5rem clamp(.5rem, 2vw, 1.4rem); }
      .coloring-done { min-width: min(82vw, 18rem); min-height: 3.6rem;
        padding: .6rem 1.2rem; border: .25rem solid #fff; border-radius: 1.35rem;
        background: #4f9b68; color: #fff; box-shadow: 0 .35rem 0 rgb(32 49 75 / .28);
        font: 900 calc(1.2rem * var(--ui-scale, 1)) system-ui, sans-serif; cursor: pointer; }
      .coloring-answer-notice { position: absolute; top: 4.6rem; left: 50%; z-index: 24;
        transform: translateX(-50%); width: max-content; max-width: 82vw; padding: .6rem 1.1rem;
        border: .22rem solid #273858; border-radius: 999px; background: #fff;
        box-shadow: 0 .3rem 0 rgb(39 56 88 / .2); font-size: calc(1.3rem * var(--ui-scale, 1));
        font-weight: 900; text-align: center; }
      .coloring-feedback { position: absolute; top: 50%; left: 50%; z-index: 25;
        transform: translate(-50%, -50%); width: max-content; max-width: 86vw;
        padding: .9rem 1.5rem; border: .28rem solid #273858; border-radius: 1.4rem;
        background: #fff6d8; box-shadow: 0 .45rem 0 rgb(39 56 88 / .28); text-align: center;
        font-size: calc(1.5rem * var(--ui-scale, 1)); font-weight: 900; }
      .coloring-feedback small { display: block; margin-top: .35rem;
        font-size: calc(1rem * var(--ui-scale, 1)); font-weight: 700; }
      .coloring-reset-confirm { position: absolute; inset: 0; z-index: 26; display: grid;
        place-items: center; padding: 1rem; background: rgb(31 42 65 / .6); }
      .coloring-reset-confirm__card { width: min(88vw, 24rem); padding: 1.6rem 1.3rem;
        box-sizing: border-box; border: .32rem solid #fff; border-radius: 1.8rem;
        background: #fff8df; box-shadow: 0 .6rem 0 rgb(30 43 68 / .35); text-align: center; }
      .coloring-reset-confirm__card p { margin: 0 0 1.1rem;
        font-size: calc(1.3rem * var(--ui-scale, 1)); font-weight: 900; }
      .coloring-reset-confirm__row { display: flex; gap: .8rem; justify-content: center; }
      /* Activation on the page: it glows, it wiggles, it hops, it lifts away. The
         cut to the room happens while it is off the paper. */
      .coloring-canvas-wrap--alive { animation: coloring-wake ${PEEL_SECONDS}s ease-in-out forwards; }
      @keyframes coloring-wake {
        0% { transform: none; box-shadow: 0 .55rem 0 rgb(39 56 88 / .18); }
        18% { transform: rotate(-2.5deg) translateY(.1rem) scale(.985);
              box-shadow: 0 0 2.5rem .6rem rgb(255 231 140 / .95); }
        30% { transform: rotate(2.5deg) translateY(.1rem) scale(.985); }
        42% { transform: rotate(-1.6deg) scale(1.01); }
        58% { transform: translateY(-2.2rem) rotate(1.2deg) scale(1.03);
              box-shadow: 0 2.4rem 1.6rem rgb(39 56 88 / .22), 0 0 2.5rem .6rem rgb(255 231 140 / .9); }
        70% { transform: translateY(.2rem) rotate(-.8deg) scale(.99); }
        100% { transform: translateY(-11rem) rotate(7deg) scale(1.16); opacity: 0;
               box-shadow: 0 0 3rem .8rem rgb(255 231 140 / .6); }
      }
      /* Short or narrow: one column — palette, picture, tools — in DOM order, so
         nothing can end up behind anything else. All seven swatches go in one
         row; they stay above the 44px touch floor. */
      @media (max-width: 46rem), (max-height: 34rem) {
        .coloring-screen__work { grid-template-columns: minmax(0, 1fr);
          grid-template-rows: auto minmax(0, 1fr); gap: .45rem; }
        .coloring-palette { grid-template-columns: repeat(7, auto); gap: .35rem; padding: .35rem; }
        .coloring-swatch { width: 2.8rem; height: 2.8rem; border-width: .22rem; }
        .coloring-tool { min-width: 4.4rem; min-height: 2.6rem; }
        /* Stacked, and out from under the settings button: on one line the
           title and the hint ran off the right edge at 760px. */
        .coloring-screen__top { flex-direction: column; gap: .1rem; padding-right: 6.5rem; }
        .coloring-screen__top h1 { font-size: calc(1rem * var(--ui-scale, 1)); }
        .coloring-screen__instruction { font-size: calc(.9rem * var(--ui-scale, 1)); }
        .coloring-done { min-height: 3rem; min-width: min(50vw, 11rem); }
      }
      @media (prefers-reduced-motion: reduce) {
        .coloring-palette--invite .coloring-swatch { animation: none; }
        .coloring-canvas-wrap--alive { animation-duration: .4s; }
      }
    `;
    document.head.append(style);
  }

  function createRoomOverlay() {
    roomOverlay = document.createElement('div');
    roomOverlay.className = 'coloring-room-ui';
    roomOverlay.innerHTML = `
      <div class="top-bar"><section class="scene-card"><h1></h1><p></p></section></div>
      <button class="coloring-room-ui__action" type="button" hidden></button>
    `;
    roomOverlay.querySelector('h1').textContent = STRINGS.roomName;
    roomInstruction = roomOverlay.querySelector('p');
    roomInstruction.textContent = STRINGS.walkToArtist;
    actionButton = roomOverlay.querySelector('.coloring-room-ui__action');
    actionButton.textContent = STRINGS.givePicture;
    actionButton.addEventListener('click', givePicture);
    document.querySelector('#ui-layer').append(roomOverlay);
  }

  /** The blank picture the artist is holding: line art, the ★ and the two words. */
  function createLineArtCanvas(size = 512) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    context.fillStyle = '#f7f4ee';
    context.fillRect(0, 0, size, size);
    drawRobot(context, { size, colors: {}, round });
    return canvas;
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
    const cylinder = ownGeometry(new THREE.CylinderGeometry(0.5, 0.5, 1, 16));
    const plane = ownGeometry(new THREE.PlaneGeometry(1, 1));
    const floorMaterial = makeMaterial(0xf1e5d1);
    const wallMaterial = makeMaterial(0xcbb8d9);
    const trimMaterial = makeMaterial(0x75b6a1);
    const woodMaterial = makeMaterial(0x9b6946);
    const easelMaterial = makeMaterial(0xd49362);
    const paperMaterial = makeMaterial(0xffffff);
    const potMaterial = makeMaterial(0x5b8f83);

    addPart(world, box, floorMaterial, 0, -0.25, 0, 12.5, 0.5, 11.5);
    addPart(world, box, wallMaterial, 0, 2.35, -5.55, 12.5, 5.2, 0.3);
    addPart(world, box, wallMaterial, -6.1, 1.55, 0, 0.3, 3.6, 11.5);
    addPart(world, box, wallMaterial, 6.1, 1.55, 0, 0.3, 3.6, 11.5);
    addPart(world, box, trimMaterial, 0, 0.2, -5.34, 12.2, 0.34, 0.12);

    // A compact easel and art table establish the room without using a round-linked colour cue.
    addPart(world, box, easelMaterial, -3.75, 1.22, -2.75, 0.18, 2.7, 0.18).rotation.z = 0.16;
    addPart(world, box, easelMaterial, -2.35, 1.22, -2.75, 0.18, 2.7, 0.18).rotation.z = -0.16;
    addPart(world, box, easelMaterial, -3.05, 1.02, -2.7, 1.75, 0.14, 0.18);
    addPart(world, plane, paperMaterial, -3.05, 1.85, -2.58, 1.65, 1.8, 1);
    addPart(world, box, woodMaterial, 3.6, 0.72, 1.5, 2.8, 1.35, 1.3);
    addPart(world, box, floorMaterial, 3.6, 1.45, 1.5, 3.05, 0.16, 1.5);
    for (let index = 0; index < 3; index += 1) {
      addPart(world, cylinder, potMaterial, 2.9 + index * 0.7, 1.68, 1.5, 0.34, 0.46, 0.34);
    }

    // The wall frame starts blank and receives the CanvasTexture only after the gift.
    frameMaterial = makeMaterial(0xfffdf5);
    framePicture = addPart(world, plane, frameMaterial, 3.35, 2.45, -5.35, 2.45, 2.45, 1);
    addPart(world, box, woodMaterial, 3.35, 3.75, -5.25, 2.8, 0.18, 0.14);
    addPart(world, box, woodMaterial, 3.35, 1.15, -5.25, 2.8, 0.18, 0.14);
    addPart(world, box, woodMaterial, 2.0, 2.45, -5.25, 0.18, 2.78, 0.14);
    addPart(world, box, woodMaterial, 4.7, 2.45, -5.25, 0.18, 2.78, 0.14);

    player = characters.create({ model: characters.playerModel });
    player.position.set(0, 0, 4.25);
    player.scale.setScalar(0.82);
    world.add(player);

    npc = characters.create({ model: 'b' });
    npc.position.set(0, 0, -2.25);
    npc.rotation.y = 0;
    npc.scale.setScalar(0.82);
    world.add(npc);

    lineArtCanvas = createLineArtCanvas(512);
    lineArtTexture = ownCanvasTexture(lineArtCanvas);
    const pictureMaterial = makeMaterial(0xffffff, { map: lineArtTexture });
    npcPicture = addPart(npc, plane, pictureMaterial, 0, 1.42, 0.58, 0.9, 0.9, 1);

    scene.add(world);
    cameraRig
      .setTarget(player)
      .setPreset('follow', { offset: [0, 8.5, 10.5], lookOffset: [0, 1.05, -2.2], damping: 5 });
  }

  function canOccupy(x, z) {
    if (x < -5.45 || x > 5.45 || z < -4.8 || z > 4.85) return false;
    const tableDx = x - 3.6;
    const tableDz = z - 1.5;
    if (tableDx * tableDx + tableDz * tableDz < 1.75 * 1.75) return false;
    const easelDx = x + 3.05;
    const easelDz = z + 2.65;
    if (easelDx * easelDx + easelDz * easelDz < 1.25 * 1.25) return false;
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

  function faceNpcToPlayer(dt) {
    const dx = player.position.x - npc.position.x;
    const dz = player.position.z - npc.position.z;
    const wantedRotation = Math.atan2(dx, dz);
    const turn = Math.atan2(Math.sin(wantedRotation - npc.rotation.y), Math.cos(wantedRotation - npc.rotation.y));
    npc.rotation.y += turn * (1 - Math.exp(-10 * dt));
  }

  function playerNearNpc() {
    const dx = player.position.x - npc.position.x;
    const dz = player.position.z - npc.position.z;
    return dx * dx + dz * dz <= NPC_RADIUS_SQ;
  }

  function clearQuestion() {
    if (!questionTargeted) return;
    questionTargeted = false;
    speech.clearTarget();
    hud.hide();
  }

  function targetQuestion() {
    if (questionTargeted || phase !== 'approach') return;
    questionTargeted = true;
    roomInstruction.textContent = STRINGS.askArtist;
    promptQuestion(ctx, LESSON, { isActive: () => active && phase === 'approach', onAccepted: acceptQuestion });
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

  function acceptQuestion() {
    if (!active || phase !== 'approach') return;
    phase = 'answer';
    questionTargeted = false;
    speech.clearTarget();
    hud.setTalkState('accepted');
    audio.playSfx('accept');
    npc.playAnimation?.('emote-yes');
    answerSentence = answerFor(LESSON, round.favourite);
    // The first playback is manual. Only an actual press of the bubble replay
    // counts as listening again and forfeits the memory bonus.
    dialogue.show({ text: answerSentence, anchor: npc, offsetY: 1.75, speak: false, onReplay: replayAnswer });
    audio.speak(answerSentence);
    answerRemaining = 2.25;
  }

  // --- the colouring screen ------------------------------------------------

  function selectColor(color) {
    if (phase !== 'painting') return;
    selectedColor = color;
    erasing = false;
    palette.classList.remove('coloring-palette--invite');
    refreshTools();
    paintInstruction.textContent = STRINGS.tapHint;
    audio.playSfx('interact');
  }

  function refreshTools() {
    for (const button of palette.querySelectorAll('button')) {
      button.setAttribute('aria-pressed', String(!erasing && button.dataset.color === selectedColor));
    }
    eraserButton.setAttribute('aria-pressed', String(erasing));
    undoButton.disabled = !colors.canUndo;
  }

  function toggleEraser() {
    if (phase !== 'painting') return;
    erasing = !erasing;
    palette.classList.remove('coloring-palette--invite');
    refreshTools();
    audio.playSfx('interact');
  }

  function undo() {
    if (phase !== 'painting' || !colors.canUndo) return;
    colors.undo();
    surface.render();
    refreshTools();
    audio.playSfx('interact');
  }

  function askReset() {
    if (phase !== 'painting') return;
    resetConfirm.hidden = false;
    resetConfirm.querySelector('[data-reset="no"]').focus();
  }

  function closeReset() {
    resetConfirm.hidden = true;
    resetButton.focus();
  }

  function confirmReset() {
    colors.reset();
    surface.render();
    refreshTools();
    closeReset();
    audio.playSfx('interact');
  }

  function showFeedback(text, hint = '') {
    feedback.innerHTML = '';
    feedback.append(document.createTextNode(text));
    if (hint) {
      const small = document.createElement('small');
      small.textContent = hint;
      feedback.append(small);
    }
    feedback.hidden = false;
    feedbackRemaining = 2.4;
  }

  /**
   * Answers a tap. Nothing here can be wrong — correctness is only ever
   * evaluated when Done is pressed, and only for the required regions.
   */
  function onRegionChanged(regionId, action) {
    if (phase !== 'painting') return;
    if (action === 'no-color') {
      paintInstruction.textContent = STRINGS.chooseColor;
      return;
    }
    if (action === 'fill' || action === 'erase') {
      if (hintRemaining > 0) { hintRemaining = 0; surface.setHint(null); }
      audio.playSfx('interact');
      refreshTools();
      paintInstruction.textContent = colors.isDecoratedEnough() ? STRINGS.ready : STRINGS.tapHint;
    }
  }

  function createPaintingOverlay() {
    paintingOverlay = document.createElement('section');
    paintingOverlay.className = 'coloring-screen';
    paintingOverlay.innerHTML = `
      <header class="coloring-screen__top"><h1></h1><p class="coloring-screen__instruction"></p></header>
      <div class="coloring-screen__work">
        <div class="coloring-palette coloring-palette--invite" role="group"></div>
        <div class="coloring-canvas-wrap"><canvas class="coloring-canvas"></canvas></div>
      </div>
      <div class="coloring-screen__bottom">
        <div class="coloring-tools">
          <button class="coloring-tool coloring-tool--undo" type="button" disabled></button>
          <button class="coloring-tool coloring-tool--eraser" type="button" aria-pressed="false"></button>
          <button class="coloring-tool coloring-tool--reset" type="button"></button>
        </div>
        <button class="coloring-done" type="button"></button>
      </div>
      <div class="coloring-answer-notice" role="status" aria-live="polite" hidden></div>
      <div class="coloring-feedback" role="status" aria-live="polite" hidden></div>
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
    paintInstruction.textContent = STRINGS.chooseColor;

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

    canvasWrap = paintingOverlay.querySelector('.coloring-canvas-wrap');
    paintingCanvas = paintingOverlay.querySelector('.coloring-canvas');
    paintingCanvas.setAttribute('aria-label', STRINGS.paintTitle);

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

    doneButton = paintingOverlay.querySelector('.coloring-done');
    doneButton.textContent = STRINGS.done;
    doneButton.addEventListener('click', attemptActivation);
    answerNotice = paintingOverlay.querySelector('.coloring-answer-notice');
    feedback = paintingOverlay.querySelector('.coloring-feedback');

    document.querySelector('#ui-layer').append(paintingOverlay);
    surface = createColoringSurface({
      canvas: paintingCanvas,
      state: colors,
      round,
      onChange: onRegionChanged,
      selectedColor: () => selectedColor,
      erasing: () => erasing,
    });
    listenAgain = createListenAgain({ root: paintingOverlay, label: UI.listenAgain, onPress: replayAnswer });
    listenAgain.show();
  }

  function onSwatchClick(event) {
    selectColor(event.currentTarget.dataset.color);
    if (event.detail > 0) event.currentTarget.blur();
  }

  async function openPainting() {
    if (!active || phase !== 'transition-to-painting') return;
    const changed = await transitions.run(() => {
      if (!active) return;
      createPaintingOverlay();
      world.visible = false;
      roomOverlay.hidden = true;
      hud.hide();
      dialogue.hide();
      speech.clearTarget();
      speech.cancel();
      input.clear();
      phase = 'painting';
    });
    if (!changed && active && phase === 'transition-to-painting') phase = 'answer';
  }

  /**
   * Done is an activation attempt, not a submission.
   *
   * Three of the four outcomes return the child to the page with every colour
   * they chose still there. NOT_READY deliberately says nothing about the
   * starred region — naming it would hand over the listening task.
   */
  function attemptActivation() {
    if (!active || phase !== 'painting') return;
    const snapshot = colors.snapshot();
    const result = scoreRound(round, snapshot, {
      completion: colors.completion(),
      usedListenAgain: replayed,
    });
    scoreResult = result;
    lastOutcome = result.outcome;

    if (result.outcome === OUTCOMES.FULL) {
      activate(snapshot);
      return;
    }

    if (result.outcome === OUTCOMES.ALMOST) {
      audio.playSfx('almost', SOUNDS.partialBuzz);
      showFeedback(STRINGS.almost, STRINGS.almostHint);
      // Only labelled regions may be pointed at. The child can read the word.
      flashWrongLabels(result.wrongLabelIds);
    } else if (result.outcome === OUTCOMES.NOT_READY) {
      // `retry` is the existing falling tone: a power-down, not a buzzer.
      audio.playSfx('retry');
      showFeedback(STRINGS.notReady);
      sputter();
    } else {
      // Deliberately the ordinary tap sound. INCOMPLETE is not a mistake, and a
      // failure noise here would send a child hunting for a wrong colour.
      audio.playSfx('interact');
      showFeedback(STRINGS.incomplete);
    }
  }

  /** A weak failed start-up: a small shake of the page, nothing destructive. */
  function sputter() {
    if (!canvasWrap) return;
    canvasWrap.animate?.(
      [
        { transform: 'translateX(0)' },
        { transform: 'translateX(-.35rem) rotate(-1deg)' },
        { transform: 'translateX(.35rem) rotate(1deg)' },
        { transform: 'translateX(-.2rem)' },
        { transform: 'translateX(0)' },
      ],
      { duration: 340, easing: 'ease-out' },
    );
  }

  /**
   * Rings a labelled region that is still the wrong colour. Its English colour
   * word is already on the page, so pointing at it tells the child nothing they
   * were supposed to remember. `wrongLabelIds` from `robotScoring` never
   * contains the starred region, which is the whole reason it exists.
   */
  function flashWrongLabels(regionIds) {
    if (!regionIds?.length || !surface) return;
    surface.setHint(regionIds[0]);
    hintRemaining = 2.4;
  }

  /** FULL: the page half of the cinematic, then the cut into the room. */
  function activate(snapshot) {
    phase = 'activation';
    listenAgain.hide();
    feedback.hidden = true;
    doneButton.disabled = true;
    finishedCanvas = surface.snapshot(PICTURE_SIZE);
    paintInstruction.textContent = STRINGS.alive;
    canvasWrap.classList.add('coloring-canvas-wrap--alive');
    // The rising sparkle, not the stamp thud: this is the robot powering up.
    audio.playSfx('complete');
    puppet = createPaperPuppet({
      colors: snapshot,
      // A paper tap on every touchdown. The puppet reports the landing rather
      // than index.js re-deriving the hop clock.
      onLand: () => audio.playSfx('land', SOUNDS.paperTap),
    });
    peelRemaining = PEEL_SECONDS;
  }

  function disposePaintingOverlay() {
    listenAgain?.dispose();
    listenAgain = null;
    surface?.dispose();
    surface = null;
    for (const swatch of palette?.querySelectorAll('button') ?? []) {
      swatch.removeEventListener('click', onSwatchClick);
    }
    undoButton?.removeEventListener('click', undo);
    eraserButton?.removeEventListener('click', toggleEraser);
    resetButton?.removeEventListener('click', askReset);
    resetConfirm?.querySelector('[data-reset="no"]')?.removeEventListener('click', closeReset);
    resetConfirm?.querySelector('[data-reset="yes"]')?.removeEventListener('click', confirmReset);
    doneButton?.removeEventListener('click', attemptActivation);
    paintingOverlay?.remove();
    if (paintingCanvas) {
      paintingCanvas.width = 0;
      paintingCanvas.height = 0;
    }
    paintingOverlay = null;
    paintingCanvas = null;
    canvasWrap = null;
    palette = null;
    paintInstruction = null;
    doneButton = null;
    undoButton = null;
    eraserButton = null;
    resetButton = null;
    resetConfirm = null;
    feedback = null;
    answerNotice = null;
  }

  function addCarriedPicture() {
    finishedTexture = ownCanvasTexture(finishedCanvas);
    const material = makeMaterial(0xffffff, { map: finishedTexture });
    carriedPicture = new THREE.Mesh(ownGeometry(new THREE.PlaneGeometry(1, 1)), material);
    // Held so the *camera* can read it. On the player's front, facing the NPC,
    // it is physically right and completely invisible: the camera is a fixed
    // rear three-quarter follow and the child walks away from it to deliver.
    // This is the artwork the whole minigame is about, so it faces the viewer.
    carriedPicture.position.set(0, 1.35, -0.57);
    carriedPicture.rotation.y = Math.PI;
    carriedPicture.scale.setScalar(0.72);
    player.add(carriedPicture);
  }

  /**
   * The cut: the puppet drops onto the atelier floor and wakes up there.
   *
   * The child keeps the finished artwork as well (the spec's option A), so the
   * wall frame will show the picture while the paper robot hops about — the
   * robot reads as a magical copy rather than as the drawing having vanished.
   */
  async function returnToRoom() {
    if (!active || phase !== 'activation') return;
    phase = 'transition-to-room';
    const changed = await transitions.run(() => {
      if (!active) return;
      addCarriedPicture();
      disposePaintingOverlay();
      npcPicture.visible = false;
      player.position.set(0, 0, 3.45);
      player.rotation.y = Math.PI;
      world.visible = true;
      roomOverlay.hidden = false;
      roomInstruction.textContent = STRINGS.walkToGive;
      world.add(puppet.group);
      puppet.placeAt(-1.9, 1.35, 0);
      puppet.setState(STATES.STARTUP);
      puppet.setGlowFloor(0.35);
      puppet.setLift(1.3);
      cameraRig
        .setTarget(player)
        .setPreset('follow', { offset: [0, 8.5, 10.5], lookOffset: [0, 1.05, -2.2], damping: 5 });
      input.clear();
      dropRemaining = DROP_SECONDS;
      phase = 'landing';
    });
    if (!changed && active && phase === 'transition-to-room') phase = 'activation';
  }

  function showGiftAction(show) {
    if (!actionButton) return;
    actionButton.hidden = !show;
  }

  function givePicture() {
    if (!active || phase !== 'gift' || !playerNearNpc()) return;
    phase = 'reaction';
    showGiftAction(false);
    const dx = npc.position.x - player.position.x;
    const dz = npc.position.z - player.position.z;
    player.rotation.y = Math.atan2(dx, dz);
    player.playAnimation?.('idle');
    carriedPicture.visible = false;
    frameMaterial.map = finishedTexture;
    frameMaterial.color.setHex(0xffffff);
    frameMaterial.needsUpdate = true;
    framePicture.visible = true;
    npc.playAnimation?.('emote-yes');
    audio.playSfx('accept');
    // The robot is pleased with itself too.
    puppet?.stopRoaming().setState(STATES.CELEBRATE);
    dialogue.show({ text: STRINGS.thankYou, anchor: npc, offsetY: 1.75, speak: false });
    roomInstruction.textContent = STRINGS.given;
    reactionRemaining = 1.55;
  }

  function beginTurnaround() {
    if (!active || phase !== 'reaction') return;
    phase = 'turnaround';
    puppet?.startRoaming();
    dialogue.show({ text: LESSON.question, anchor: npc, offsetY: 1.75 });
    roomInstruction.textContent = STRINGS.turnaround;
    // Two-shot: the child steps beside the NPC, and the close-up looks at the NPC
    // from the front. After the gift the child stands where the old three-quarter
    // camera was, so their avatar filled the foreground, clipped by the camera.
    player.position.set(npc.position.x + 1.45, 0, npc.position.z + 0.35);
    player.rotation.y = Math.atan2(npc.position.x - player.position.x, npc.position.z - player.position.z);
    cameraRig
      .setTarget(npc)
      .setPreset('closeup', { offset: [0, 2.8, 4.2], lookOffset: [0, 0.8, 0], damping: 5.5 });
    promptAnswer(ctx, LESSON, { isActive: () => active && phase === 'turnaround', onAccepted: completeTurnaround });
  }

  function completeTurnaround(answer) {
    if (!active || phase !== 'turnaround') return;
    acceptedAnswer = answer || LESSON.answers[0];
    phase = 'finishing';
    speech.clearTarget();
    hud.setTalkState('accepted');
    roomInstruction.textContent = STRINGS.complete;
    npc.playAnimation?.('emote-yes');
    puppet?.stopRoaming().setState(STATES.CELEBRATE);
    audio.playSfx('stamp');
    finishRemaining = 0.75;
  }

  /**
   * The harness window, following the same `__eslDebug` convention the
   * Restaurant, Drink Stand and Zoo already use.
   *
   * It deliberately does NOT expose the favourite colour. The two labelled
   * colours are printed on the page anyway, so a harness reading them back is
   * only reading the screen; the favourite is the one thing a child is meant to
   * have remembered, and a playthrough can hear it in the dialogue like they do.
   */
  function debugSnapshot() {
    return {
      phase,
      outcome: lastOutcome,
      stars: scoreResult?.stars ?? null,
      usedListenAgain: replayed,
      starredRegion: round?.starred ?? null,
      requiredLabels: Object.fromEntries((round?.labelled ?? []).map((e) => [e.regionId, e.color])),
      colors: colors?.snapshot() ?? {},
      completion: colors?.completion() ?? 0,
      decoratedEnough: colors?.isDecoratedEnough() ?? false,
      canUndo: Boolean(colors?.canUndo),
      erasing,
      selectedColor,
      hint: surface?.highlight ?? null,
      puppet: puppet
        ? {
          present: Boolean(puppet.group.parent),
          state: puppet.state,
          pieces: Object.keys(puppet.pieces).length,
          position: { x: puppet.group.position.x, y: puppet.group.position.y, z: puppet.group.position.z },
          lift: puppet.pose.root.y,
          scale: { ...puppet.pose.root.scale },
        }
        : null,
    };
  }

  function installDebugHook() {
    if (!window.__eslDebug) {
      Object.defineProperty(window, '__eslDebug', { value: {}, configurable: true, writable: false });
      debugRootCreated = true;
    }
    Object.defineProperty(window.__eslDebug, 'coloring', { configurable: true, enumerable: true, get: debugSnapshot });
  }

  function removeDebugHook() {
    if (window.__eslDebug) delete window.__eslDebug.coloring;
    if (debugRootCreated && window.__eslDebug && Object.keys(window.__eslDebug).length === 0) delete window.__eslDebug;
    debugRootCreated = false;
  }

  function enter() {
    active = true;
    phase = 'approach';
    questionTargeted = false;
    replayed = false;
    answerSentence = '';
    selectedColor = null;
    erasing = false;
    answerRemaining = 0;
    reactionRemaining = 0;
    finishRemaining = 0;
    answerNoticeRemaining = 0;
    feedbackRemaining = 0;
    hintRemaining = 0;
    peelRemaining = 0;
    dropRemaining = 0;
    scoreResult = null;
    acceptedAnswer = null;
    finishCalled = false;
    elapsed = 0;
    round = pickRound();
    colors = createColorState();
    lastOutcome = null;
    installStyle();
    createRoomOverlay();
    buildWorld();
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

    if (answerNoticeRemaining > 0) {
      answerNoticeRemaining -= safeDt;
      if (answerNoticeRemaining <= 0 && answerNotice) answerNotice.hidden = true;
    }
    if (feedbackRemaining > 0) {
      feedbackRemaining -= safeDt;
      if (feedbackRemaining <= 0 && feedback) feedback.hidden = true;
    }
    if (hintRemaining > 0) {
      hintRemaining -= safeDt;
      if (hintRemaining <= 0) surface?.setHint(null);
    }

    if (phase === 'approach') {
      updateMovement(safeDt);
      faceNpcToPlayer(safeDt);
      if (playerNearNpc()) targetQuestion();
      else {
        clearQuestion();
        roomInstruction.textContent = STRINGS.walkToArtist;
      }
    } else if (phase === 'answer') {
      player.playAnimation?.('idle');
      faceNpcToPlayer(safeDt);
      answerRemaining -= safeDt;
      if (answerRemaining <= 0) {
        hud.hide();
        phase = 'transition-to-painting';
        void openPainting();
      }
    } else if (phase === 'activation') {
      peelRemaining -= safeDt;
      if (peelRemaining <= 0) void returnToRoom();
    } else if (phase === 'landing') {
      dropRemaining -= safeDt;
      // It falls the last of the way onto the floor, then the startup plays out.
      const fall = Math.max(0, dropRemaining / DROP_SECONDS);
      puppet.setLift(1.3 * fall * fall);
      if (dropRemaining <= 0) {
        puppet.setLift(0);
        if (puppet.state !== STATES.STARTUP) puppet.setState(STATES.STARTUP);
        if (puppet.isFinished()) {
          puppet.setGlowFloor(0.12);
          puppet.startRoaming();
          phase = 'gift';
        }
      }
    } else if (phase === 'gift') {
      updateMovement(safeDt);
      faceNpcToPlayer(safeDt);
      const nearby = playerNearNpc();
      showGiftAction(nearby);
      roomInstruction.textContent = nearby ? STRINGS.givePicture : STRINGS.walkToGive;
      if (nearby && input.consumeInteract()) givePicture();
    } else if (phase === 'reaction') {
      player.playAnimation?.('idle');
      faceNpcToPlayer(safeDt);
      reactionRemaining -= safeDt;
      if (reactionRemaining <= 0) beginTurnaround();
    } else if (phase === 'finishing') {
      finishRemaining -= safeDt;
      if (finishRemaining <= 0 && !finishCalled) {
        finishCalled = true;
        hud.hide();
        finish({
          stars: scoreResult?.stars ?? 1,
          detail: { category: LESSON.category, answer: acceptedAnswer },
        });
      }
    }

    // The paper robot keeps moving through every room phase once it is alive.
    if (puppet && world?.visible) puppet.update(safeDt);

    if (world?.visible) {
      player?.updateAnimation?.(safeDt);
      npc?.updateAnimation?.(safeDt);
      if (npcPicture?.visible) {
        const pulse = 1 + Math.sin(elapsed * 2.2) * 0.015;
        npcPicture.scale.setScalar(0.9 * pulse);
      }
    }
  }

  function exit() {
    active = false;
    phase = 'inactive';
    removeDebugHook();
    unsubscribeSettings?.();
    unsubscribeSettings = null;
    speech.clearTarget();
    speech.cancel();
    audio.stop();
    hud.hide();
    dialogue.hide();
    cameraRig.setTarget(null);
    actionButton?.removeEventListener('click', givePicture);
    disposePaintingOverlay();
    roomOverlay?.remove();
    style?.remove();
    puppet?.dispose();
    puppet = null;
    player?.disposeCharacter?.();
    npc?.disposeCharacter?.();
    if (world) scene.remove(world);
    if (carriedPicture?.parent) carriedPicture.parent.remove(carriedPicture);
    for (const texture of textures) texture.dispose();
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    textures.clear();
    geometries.clear();
    materials.clear();
    if (lineArtCanvas) {
      lineArtCanvas.width = 0;
      lineArtCanvas.height = 0;
    }
    if (finishedCanvas) {
      finishedCanvas.width = 0;
      finishedCanvas.height = 0;
    }
    world = null;
    player = null;
    npc = null;
    npcPicture = null;
    carriedPicture = null;
    framePicture = null;
    frameMaterial = null;
    roomOverlay = null;
    roomInstruction = null;
    actionButton = null;
    style = null;
    lineArtCanvas = null;
    finishedCanvas = null;
    lineArtTexture = null;
    finishedTexture = null;
    round = null;
    colors = null;
    scoreResult = null;
    lastOutcome = null;
  }

  return { id: 'coloring', enter, update, exit };
}
