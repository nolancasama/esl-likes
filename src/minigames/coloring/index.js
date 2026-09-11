import * as THREE from 'three';
import { LESSON_BY_ID, UI, answerFor } from '../../config/lesson.js';
import { promptQuestion, promptAnswer } from '../../systems/speechPrompt.js';
import { createListenAgain } from '../../ui/listenAgain.js';
import {
  GRID_HEIGHT,
  GRID_WIDTH,
  buildRegionMap,
  createLineArtCanvas,
  createPaintingSurface,
} from './picture.js';
import { COLORS, pickRound, scorePainting } from './scoring.js';

const LESSON = LESSON_BY_ID.coloring;
const STRINGS = UI.coloring;
const MOVE_SPEED = 5;
const NPC_RADIUS_SQ = 3 * 3;
const MIN_PAINTED_SHARE = 0.2;
const PALETTE_CSS = Object.freeze({ red: '#ef4f4f', blue: '#3a78e8', yellow: '#ffd43b' });

/** Coloring v1 controller for the frozen shell interface. */
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
  let paintingSurface = null;
  let palette = null;
  let paintInstruction = null;
  let doneButton = null;
  let resultPanel = null;
  let resultStars = null;
  let returnButton = null;
  let answerNotice = null;
  let listenAgain = null;
  let style = null;
  let lineArtCanvas = null;
  let finishedCanvas = null;
  let lineArtTexture = null;
  let finishedTexture = null;
  let unsubscribeSettings = null;
  let phase = 'inactive';
  let active = false;
  let questionTargeted = false;
  let replayed = false;
  let answerSentence = '';
  let selectedColor = null;
  let answerRemaining = 0;
  let reactionRemaining = 0;
  let finishRemaining = 0;
  let answerNoticeRemaining = 0;
  let scoreResult = null;
  let acceptedAnswer = null;
  let finishCalled = false;
  let elapsed = 0;
  let round = null;

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
        grid-template-rows: auto 1fr auto; gap: .65rem; box-sizing: border-box;
        padding: clamp(.7rem, 2vh, 1.25rem); overflow: auto; pointer-events: auto;
        background: #f7f0e8; color: #1b2940; font-family: system-ui, sans-serif; }
      .coloring-screen__top { display: flex; align-items: center; justify-content: center;
        gap: 1rem; flex-wrap: wrap; text-align: center; }
      .coloring-screen__top h1 { margin: 0; font-size: calc(clamp(1.45rem, 4vh, 2.4rem) * var(--ui-scale, 1)); }
      .coloring-screen__instruction { min-width: min(90vw, 24rem); margin: 0;
        font-size: calc(1.05rem * var(--ui-scale, 1)); font-weight: 800; }
      .coloring-screen__work { min-height: 0; display: flex; align-items: center;
        justify-content: center; gap: clamp(.8rem, 2vw, 1.5rem); }
      .coloring-palette { display: flex; flex-direction: column; gap: .8rem; padding: .65rem;
        border: .2rem solid #d9cfbf; border-radius: 1.5rem; background: rgb(255 255 255 / .78); }
      .coloring-palette--invite .coloring-swatch { animation: coloring-invite 1.55s ease-in-out infinite; }
      .coloring-palette--invite .coloring-swatch:nth-child(2) { animation-delay: .18s; }
      .coloring-palette--invite .coloring-swatch:nth-child(3) { animation-delay: .36s; }
      @keyframes coloring-invite { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.09); } }
      .coloring-swatch { width: clamp(4.1rem, 10vw, 5.6rem); height: clamp(4.1rem, 10vw, 5.6rem);
        border: .32rem solid #fff; border-radius: 50%; box-shadow: 0 0 0 .2rem #273858,
        0 .35rem 0 rgb(39 56 88 / .22); cursor: pointer; }
      .coloring-swatch[aria-pressed="true"] { outline: .38rem solid #273858; outline-offset: .28rem; }
      .coloring-swatch:focus-visible, .coloring-screen button:focus-visible {
        outline: .35rem solid #ff9f1c; outline-offset: .25rem; }
      .coloring-canvas-wrap { min-width: 0; height: 100%; max-height: min(68vh, 45rem);
        aspect-ratio: 1; display: grid; place-items: center; padding: .55rem; box-sizing: border-box;
        border: .3rem solid #273858; border-radius: 1.2rem; background: #fff;
        box-shadow: 0 .55rem 0 rgb(39 56 88 / .18); }
      .coloring-canvas { display: block; width: 100%; height: 100%; object-fit: contain;
        touch-action: none; cursor: crosshair; border-radius: .65rem; }
      .coloring-screen__bottom { display: flex; justify-content: center; }
      .coloring-done, .coloring-return { min-width: min(82vw, 18rem); min-height: 4rem;
        padding: .7rem 1.2rem; border: .25rem solid #fff; border-radius: 1.35rem;
        background: #4f9b68; color: #fff; box-shadow: 0 .35rem 0 rgb(32 49 75 / .28);
        font: 900 calc(1.2rem * var(--ui-scale, 1)) system-ui, sans-serif; cursor: pointer; }
      .coloring-done:disabled { background: #a9aea8; cursor: default; box-shadow: none; }
      .coloring-answer-notice { position: absolute; top: 5.2rem; left: 50%; z-index: 24;
        transform: translateX(-50%); width: max-content; max-width: 82vw; padding: .7rem 1.2rem;
        border: .22rem solid #273858; border-radius: 999px; background: #fff;
        box-shadow: 0 .3rem 0 rgb(39 56 88 / .2); font-size: calc(1.35rem * var(--ui-scale, 1));
        font-weight: 900; text-align: center; }
      .coloring-result { position: absolute; inset: 0; z-index: 26; display: grid;
        place-items: center; padding: 1rem; background: rgb(31 42 65 / .58); }
      .coloring-result__card { width: min(88vw, 27rem); padding: 2rem 1.5rem; box-sizing: border-box;
        border: .35rem solid #fff; border-radius: 2rem; background: #fff8df;
        box-shadow: 0 .65rem 0 rgb(30 43 68 / .35); text-align: center; }
      .coloring-result__card h2 { margin: 0 0 .6rem; font-size: calc(1.8rem * var(--ui-scale, 1));
        text-wrap: balance; word-break: keep-all; }
      .coloring-result__stars { margin: .35rem 0 1.3rem; color: #f1ae18;
        -webkit-text-stroke: .12rem #7c5410; font-size: clamp(4rem, 14vw, 7rem); letter-spacing: .1em; }
      @media (max-width: 42rem) {
        .coloring-screen__work { flex-direction: column-reverse; }
        .coloring-palette { flex-direction: row; }
        .coloring-canvas-wrap { width: min(88vw, 58vh); height: auto; }
        .coloring-swatch { width: 3.9rem; height: 3.9rem; }
      }
      @media (prefers-reduced-motion: reduce) { .coloring-palette--invite .coloring-swatch { animation: none; } }
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

    lineArtCanvas = createLineArtCanvas(round.starred, 512);
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

  function paintedRegionShare(paintGrid, regionMap) {
    let regionCells = 0;
    let paintedCells = 0;
    for (let index = 0; index < regionMap.length; index += 1) {
      if (regionMap[index] === 0) continue;
      regionCells += 1;
      if (paintGrid[index] !== 0) paintedCells += 1;
    }
    return paintedCells / Math.max(1, regionCells);
  }

  function selectColor(color) {
    if (phase !== 'painting') return;
    selectedColor = color;
    paintingSurface.setColor(color);
    palette.classList.remove('coloring-palette--invite');
    for (const button of palette.querySelectorAll('button')) {
      button.setAttribute('aria-pressed', String(button.dataset.color === color));
    }
    paintInstruction.textContent = STRINGS.paintHint;
    audio.playSfx('interact');
  }

  function onPaintingChanged(paintGrid) {
    if (!paintingSurface || phase !== 'painting') return;
    const share = paintedRegionShare(paintGrid, regionMap);
    doneButton.disabled = share < MIN_PAINTED_SHARE;
    if (!doneButton.disabled) paintInstruction.textContent = STRINGS.ready;
  }

  const regionMap = buildRegionMap();

  function createPaintingOverlay() {
    paintingOverlay = document.createElement('section');
    paintingOverlay.className = 'coloring-screen';
    paintingOverlay.innerHTML = `
      <header class="coloring-screen__top"><h1></h1><p class="coloring-screen__instruction"></p></header>
      <div class="coloring-screen__work">
        <div class="coloring-palette coloring-palette--invite" role="group"></div>
        <div class="coloring-canvas-wrap"><canvas class="coloring-canvas"></canvas></div>
      </div>
      <div class="coloring-screen__bottom"><button class="coloring-done" type="button" disabled></button></div>
      <div class="coloring-answer-notice" role="status" aria-live="polite" hidden></div>
      <div class="coloring-result" hidden>
        <section class="coloring-result__card"><h2></h2><div class="coloring-result__stars"></div>
        <button class="coloring-return" type="button"></button></section>
      </div>
    `;
    paintingOverlay.querySelector('h1').textContent = STRINGS.paintTitle;
    paintInstruction = paintingOverlay.querySelector('.coloring-screen__instruction');
    paintInstruction.textContent = STRINGS.chooseColor;
    palette = paintingOverlay.querySelector('.coloring-palette');
    palette.setAttribute('aria-label', STRINGS.paletteLabel);
    for (const color of COLORS) {
      const swatch = document.createElement('button');
      swatch.type = 'button';
      swatch.className = 'coloring-swatch';
      swatch.dataset.color = color;
      swatch.style.background = PALETTE_CSS[color];
      swatch.setAttribute('aria-pressed', 'false');
      swatch.setAttribute('aria-label', STRINGS.colors[color]);
      swatch.title = STRINGS.colors[color];
      swatch.addEventListener('click', onSwatchClick);
      palette.append(swatch);
    }
    paintingCanvas = paintingOverlay.querySelector('.coloring-canvas');
    doneButton = paintingOverlay.querySelector('.coloring-done');
    doneButton.textContent = STRINGS.done;
    doneButton.addEventListener('click', completePainting);
    answerNotice = paintingOverlay.querySelector('.coloring-answer-notice');
    resultPanel = paintingOverlay.querySelector('.coloring-result');
    resultPanel.querySelector('h2').textContent = STRINGS.resultTitle;
    resultStars = paintingOverlay.querySelector('.coloring-result__stars');
    returnButton = paintingOverlay.querySelector('.coloring-return');
    returnButton.textContent = STRINGS.takePicture;
    returnButton.addEventListener('click', returnToRoom);
    document.querySelector('#ui-layer').append(paintingOverlay);
    paintingSurface = createPaintingSurface({
      canvas: paintingCanvas,
      starred: round.starred,
      onPaint: onPaintingChanged,
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

  function completePainting() {
    if (!active || phase !== 'painting' || doneButton.disabled) return;
    scoreResult = scorePainting({
      regionMap,
      paintGrid: paintingSurface.paintGrid,
      width: GRID_WIDTH,
      height: GRID_HEIGHT,
      starred: round.starred,
      favourite: round.favourite,
      replayed,
    });
    finishedCanvas = paintingSurface.snapshot();
    phase = 'result';
    listenAgain.hide();
    resultStars.textContent = '★'.repeat(scoreResult.stars);
    resultPanel.hidden = false;
    returnButton.focus();
    audio.playSfx('stamp');
  }

  function disposePaintingOverlay() {
    listenAgain?.dispose();
    listenAgain = null;
    paintingSurface?.dispose();
    paintingSurface = null;
    for (const swatch of palette?.querySelectorAll('button') ?? []) {
      swatch.removeEventListener('click', onSwatchClick);
    }
    doneButton?.removeEventListener('click', completePainting);
    returnButton?.removeEventListener('click', returnToRoom);
    paintingOverlay?.remove();
    if (paintingCanvas) {
      paintingCanvas.width = 0;
      paintingCanvas.height = 0;
    }
    paintingOverlay = null;
    paintingCanvas = null;
    palette = null;
    paintInstruction = null;
    doneButton = null;
    resultPanel = null;
    resultStars = null;
    returnButton = null;
    answerNotice = null;
  }

  function addCarriedPicture() {
    finishedTexture = ownCanvasTexture(finishedCanvas);
    const material = makeMaterial(0xffffff, { map: finishedTexture });
    carriedPicture = new THREE.Mesh(ownGeometry(new THREE.PlaneGeometry(1, 1)), material);
    carriedPicture.position.set(0, 1.35, 0.57);
    carriedPicture.scale.setScalar(0.72);
    player.add(carriedPicture);
  }

  async function returnToRoom() {
    if (!active || phase !== 'result') return;
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
      cameraRig
        .setTarget(player)
        .setPreset('follow', { offset: [0, 8.5, 10.5], lookOffset: [0, 1.05, -2.2], damping: 5 });
      input.clear();
      phase = 'gift';
    });
    if (!changed && active && phase === 'transition-to-room') phase = 'result';
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
    dialogue.show({ text: STRINGS.thankYou, anchor: npc, offsetY: 1.75, speak: false });
    roomInstruction.textContent = STRINGS.given;
    reactionRemaining = 1.55;
  }

  function beginTurnaround() {
    if (!active || phase !== 'reaction') return;
    phase = 'turnaround';
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
    audio.playSfx('stamp');
    finishRemaining = 0.75;
  }

  function enter() {
    active = true;
    phase = 'approach';
    questionTargeted = false;
    replayed = false;
    answerSentence = '';
    selectedColor = null;
    answerRemaining = 0;
    reactionRemaining = 0;
    finishRemaining = 0;
    answerNoticeRemaining = 0;
    scoreResult = null;
    acceptedAnswer = null;
    finishCalled = false;
    elapsed = 0;
    round = pickRound();
    installStyle();
    createRoomOverlay();
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

    if (answerNoticeRemaining > 0) {
      answerNoticeRemaining -= safeDt;
      if (answerNoticeRemaining <= 0 && answerNotice) answerNotice.hidden = true;
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
    scoreResult = null;
  }

  return { id: 'coloring', enter, update, exit };
}
