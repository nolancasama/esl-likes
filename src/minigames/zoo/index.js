import * as THREE from 'three';
import { LESSON_BY_ID, UI, answerFor } from '../../config/lesson.js';
import { promptQuestion, promptAnswer } from '../../systems/speechPrompt.js';
import { createListenAgain } from '../../ui/listenAgain.js';
import { measureFraming, pickAnimal, scoreSession } from './scoring.js';
import {
  PLAYER_RADIUS,
  bounds as campusBounds,
  canOccupy as canOccupyCampus,
  landmarks as campusLandmarks,
  pathEdges,
  pathNodes,
} from './layout.js';
import { createZooWorld } from './world.js';
import { AREAS, TERRITORIES } from './territories.js';
import { DEV_TOOLS_ENABLED } from '../../dev/devMode.js';
import { savedCreations } from '../coloring/coloringSession.js';
import { DEFAULT_SUBJECT_ID, subjectById } from '../coloring/subjectRegistry.js';
import { disposeSharedPaperAssets } from '../coloring/paperPuppet.js';
import { chooseCreationSlots, pickCreation } from '../../systems/creationCasting.js';
import { createPaperCharacter } from '../../systems/paperCharacter.js';

const LESSON = LESSON_BY_ID.zoo;
const STRINGS = UI.zoo;
const MOVE_SPEED = 13.5;
const VIEWFINDER_FOV = 34;
const TALK_RADIUS_SQ = 3.2 * 3.2;
const NPC_MODELS = Object.freeze('bcdefghijklmnopqr'.split(''));
const DIFFICULTY = Object.freeze({
  1: Object.freeze({ count: 3, concurrent: 1 }),
  2: Object.freeze({ count: 4, concurrent: 2 }),
  3: Object.freeze({ count: 6, concurrent: 3 }),
});
const VISITOR_SPOTS = Object.freeze([
  Object.freeze({ x: -2.4, z: 29.8 }),
  Object.freeze({ x: 0.0, z: 29.2 }),
  Object.freeze({ x: 2.0, z: 30.0 }),
  Object.freeze({ x: -1.5, z: 26.4 }),
  Object.freeze({ x: 1.5, z: 26.1 }),
  Object.freeze({ x: 0.0, z: 24.3 }),
]);

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function shuffled(values, rng = Math.random) {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = Math.floor(rng() * (index + 1));
    [copy[index], copy[other]] = [copy[other], copy[index]];
  }
  return copy;
}

function faceToward(object, x, z) {
  object.rotation.y = Math.atan2(x - object.position.x, z - object.position.z);
}

/** Zoo minigame controller for the frozen shell interface. */
export function createZoo(ctx) {
  const {
    scene,
    camera,
    cameraRig,
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
    registerEscapeGuard,
    finish,
  } = ctx;

  let zooWorld = null;
  let player = null;
  let keeper = null;
  let overlay = null;
  let style = null;
  let instruction = null;
  let notice = null;
  let cameraButton = null;
  let carriedIndicator = null;
  let viewfinder = null;
  let viewfinderGuide = null;
  let viewfinderInstruction = null;
  let shutterButton = null;
  let closeButton = null;
  let listenAgain = null;
  let unsubscribeSettings = null;
  let unregisterEscapeGuard = null;
  let active = false;
  let finishCalled = false;
  let debugRootCreated = false;
  let phase = 'inactive';
  let level = 1;
  let elapsed = 0;
  let frame = 0;
  let noticeRemaining = 0;
  let answerRemaining = 0;
  let replayRemaining = 0;
  let reactionRemaining = 0;
  let roundEndRemaining = 0;
  let finishRemaining = 0;
  let questionVisitor = null;
  let questionCommitted = false;
  let dialogueVisitor = null;
  let currentReplayVisitor = null;
  let acceptedAnswer = null;
  let carriedPhoto = null;
  let zooPhoto = null;
  let shutterReady = false;
  let framedSubject = null;
  let framingDebug = null;
  let lastGoodSubject = null;
  let lastGoodAt = 0;
  let actionVisitor = null;
  let activatedCount = 0;
  let servedCount = 0;
  // Development only. `sceneEditor` stays null in a student's session, and the
  // module behind it is never even fetched — see src/dev/devMode.js.
  let sceneEditor = null;
  let editorLoading = false;
  let editorPausedPhase = null;

  const visitors = [];
  const records = [];
  const replayQueue = [];
  const move = new THREE.Vector2();
  const projectedCenter = new THREE.Vector3();
  const projectedEdge = new THREE.Vector3();
  const worldCenter = new THREE.Vector3();
  const worldEdge = new THREE.Vector3();
  const cameraRight = new THREE.Vector3();
  const cameraUp = new THREE.Vector3();
  const viewfinderEye = new THREE.Vector3();
  const viewfinderLook = new THREE.Vector3();
  const viewfinderRay = new THREE.Vector3();

  function setInstruction(text) {
    if (instruction) instruction.textContent = text;
  }

  function showNotice(text, seconds = 1.8) {
    if (!notice) return;
    notice.textContent = text;
    notice.hidden = false;
    noticeRemaining = seconds;
  }

  function createOverlay() {
    style = document.createElement('style');
    style.textContent = `
      .zoo-ui { position: absolute; inset: 0; pointer-events: none; }
      .zoo-ui__instruction { max-width: min(68vw, 34rem); }
      .zoo-ui__notice { position: absolute; top: 1rem; left: 50%; transform: translateX(-50%);
        max-width: min(72vw, 31rem); padding: .72rem 1.2rem; border: .22rem solid #fff;
        border-radius: 999px; background: #e65b45; color: #fff; box-shadow: 0 .34rem 0 rgb(35 49 71 / .28);
        font: 900 calc(1.16rem * var(--ui-scale, 1)) system-ui, sans-serif; text-align: center; }
      .zoo-ui__camera { position: absolute; left: 50%; bottom: 1.15rem; transform: translateX(-50%);
        min-width: min(76vw, 18rem); min-height: 3.9rem; padding: .7rem 1.2rem; pointer-events: auto;
        border: .23rem solid #fff; border-radius: 1.35rem; background: #3377d5; color: #fff;
        box-shadow: 0 .36rem 0 rgb(31 50 77 / .3); font: 900 calc(1.1rem * var(--ui-scale, 1)) system-ui, sans-serif; }
      .zoo-ui__camera:focus-visible, .zoo-viewfinder button:focus-visible { outline: 4px solid #ffcf33; outline-offset: 3px; }
      .zoo-ui__carried { position: absolute; left: 1rem; bottom: 1rem; width: 14.5rem; min-height: 4.5rem;
        display: grid; grid-template-columns: 4.6rem 1fr; gap: .65rem; align-items: center; padding: .55rem;
        border: .2rem solid #fff; border-radius: 1rem; background: rgb(32 50 72 / .9); color: #fff;
        font: 800 calc(.84rem * var(--ui-scale, 1)) system-ui, sans-serif; box-shadow: 0 .3rem 0 rgb(20 32 48 / .28); }
      .zoo-ui__carried img { width: 4.6rem; height: 3.2rem; object-fit: cover; border-radius: .45rem; background: #dcecf2; }
      .zoo-ui__carried strong { display: block; word-break: keep-all; }
      .zoo-ui__carried div { min-width: 0; word-break: keep-all; }
      .zoo-viewfinder { position: absolute; inset: 0; z-index: 18; pointer-events: auto;
        background: rgb(12 24 33 / .28); }
      .zoo-viewfinder__frame { position: absolute; inset: 9% 11% 17%; border: .42rem solid rgb(255 255 255 / .96);
        border-radius: 1.2rem; box-shadow: 0 0 0 999px rgb(8 18 26 / .24), inset 0 0 0 .12rem rgb(30 48 64 / .5); }
      .zoo-viewfinder__frame::before, .zoo-viewfinder__frame::after { content: ''; position: absolute;
        left: 50%; top: 50%; transform: translate(-50%, -50%); background: rgb(255 255 255 / .72); }
      .zoo-viewfinder__frame::before { width: 34%; height: .12rem; }
      .zoo-viewfinder__frame::after { width: .12rem; height: 42%; }
      .zoo-viewfinder__frame.is-ready { border-color: #76eb8d; box-shadow: 0 0 0 999px rgb(8 18 26 / .18), 0 0 1.2rem #76eb8d; }
      .zoo-viewfinder__instruction { position: absolute; top: 1rem; left: 50%; transform: translateX(-50%);
        padding: .6rem 1.1rem; border-radius: 999px; background: rgb(25 43 58 / .92); color: #fff;
        font: 900 calc(1.08rem * var(--ui-scale, 1)) system-ui, sans-serif; text-align: center; }
      .zoo-viewfinder__controls { position: absolute; left: 50%; bottom: 1rem; transform: translateX(-50%);
        display: flex; gap: .8rem; }
      .zoo-viewfinder button { min-height: 3.5rem; padding: .65rem 1.25rem; border: .2rem solid #fff;
        border-radius: 999px; color: #fff; font: 900 calc(1.05rem * var(--ui-scale, 1)) system-ui, sans-serif; }
      .zoo-viewfinder__shutter { background: #e54f43; }
      .zoo-viewfinder__shutter:disabled { background: #71818c; color: #dbe1e4; }
      .zoo-viewfinder__close { background: #30445d; }
      .zoo-dialogue .npc-dialogue__replay { display: none; }
      @media (max-width: 48rem) { .zoo-ui__carried { width: 12.5rem; } .zoo-viewfinder__frame { inset: 12% 6% 19%; } }
    `;
    document.head.append(style);

    overlay = document.createElement('div');
    overlay.className = 'zoo-ui';
    overlay.innerHTML = `
      <div class="top-bar"><section class="scene-card"><h1></h1><p class="zoo-ui__instruction"></p></section></div>
      <div class="zoo-ui__notice" role="status" aria-live="polite" hidden></div>
      <button class="zoo-ui__camera" type="button"></button>
      <div class="zoo-ui__carried" role="status"></div>
      <section class="zoo-viewfinder" aria-label="${STRINGS.cameraOpen}" hidden>
        <div class="zoo-viewfinder__instruction" role="status"></div>
        <div class="zoo-viewfinder__frame"></div>
        <div class="zoo-viewfinder__controls">
          <button class="zoo-viewfinder__close" type="button"></button>
          <button class="zoo-viewfinder__shutter" type="button" disabled></button>
        </div>
      </section>
    `;
    overlay.querySelector('h1').textContent = STRINGS.roomName;
    instruction = overlay.querySelector('.zoo-ui__instruction');
    notice = overlay.querySelector('.zoo-ui__notice');
    cameraButton = overlay.querySelector('.zoo-ui__camera');
    carriedIndicator = overlay.querySelector('.zoo-ui__carried');
    viewfinder = overlay.querySelector('.zoo-viewfinder');
    viewfinderGuide = overlay.querySelector('.zoo-viewfinder__frame');
    viewfinderInstruction = overlay.querySelector('.zoo-viewfinder__instruction');
    shutterButton = overlay.querySelector('.zoo-viewfinder__shutter');
    closeButton = overlay.querySelector('.zoo-viewfinder__close');
    cameraButton.textContent = STRINGS.cameraButton;
    cameraButton.title = STRINGS.cameraKeyHint;
    shutterButton.textContent = STRINGS.shutter;
    closeButton.textContent = STRINGS.cameraClose;
    cameraButton.addEventListener('click', openViewfinder);
    shutterButton.addEventListener('click', takePhoto);
    closeButton.addEventListener('click', closeViewfinder);
    listenAgain = createListenAgain({ root: overlay, label: UI.listenAgain, onPress: replayWaitingVisitors });
    document.querySelector('#ui-layer').append(overlay);
    dialogue.element?.classList.add('zoo-dialogue');
    setInstruction(STRINGS.walkToVisitor);
    renderCarriedPhoto();
  }

  function buildCharacters() {
    player = characters.create({ model: characters.playerModel });
    player.position.set(0, 0.08, 33.8);
    player.rotation.y = Math.PI;
    player.scale.setScalar(0.84);
    zooWorld.group.add(player);

    keeper = characters.create({ model: 'r' });
    keeper.position.set(2.2, 0.08, 33.5);
    keeper.scale.setScalar(0.82);
    keeper.visible = false;
    zooWorld.group.add(keeper);

    const configured = DIFFICULTY[level];
    const spots = shuffled(VISITOR_SPOTS);
    const models = shuffled(NPC_MODELS);

    // The child's own creations come to the zoo as VISITORS — never as animals.
    // They are pushed into `visitors` and nothing else, so they can never reach
    // `zooWorld.habitats` and can never satisfy a photo request.
    const creationRecords = savedCreations().filter((record) => (
      subjectById(record.subjectId ?? DEFAULT_SUBJECT_ID)?.crossGame.zooVisitor
    ));
    const paperSlots = new Set(chooseCreationSlots({
      slots: configured.count,
      eligibleCount: creationRecords.length,
    }));
    const usedCreations = new Set();
    let lastCreationIndex = -1;

    for (let index = 0; index < configured.count; index += 1) {
      const spot = spots[index % spots.length];
      let character;
      if (paperSlots.has(index)) {
        const picked = pickCreation({
          records: creationRecords,
          used: usedCreations,
          lastIndex: lastCreationIndex,
        });
        usedCreations.add(picked.index);
        lastCreationIndex = picked.index;
        const subject = subjectById(picked.record.subjectId ?? DEFAULT_SUBJECT_ID);
        character = createPaperCharacter({
          subject,
          artwork: picked.record.artwork,
          presentation: subject.presentation.zoo,
        });
      } else {
        character = characters.create({ model: models[index % models.length] });
        character.scale.setScalar(0.78);
      }
      character.position.set(spot.x, character.groundY ?? 0.08, spot.z);
      faceToward(character, 0, 19);
      character.visible = false;
      zooWorld.group.add(character);
      visitors.push({
        state: 'hidden',
        asked: false,
        served: false,
        wanted: pickAnimal(Math.random),
        replayed: false,
        shows: 0,
        leaveRemaining: 0,
        character,
      });
    }
    activateVisitors(configured.concurrent);
    cameraRig.setTarget(player).setPreset('follow', {
      offset: [0, 8.6, 10.8], lookOffset: [0, 1.05, -1.7], damping: 5,
    });
  }

  function activateVisitors(count = 1) {
    let madeVisible = false;
    while (count > 0 && activatedCount < visitors.length) {
      const visitor = visitors[activatedCount++];
      visitor.state = 'waiting';
      visitor.character.visible = true;
      visitor.character.playAnimation?.('idle');
      count -= 1;
      madeVisible = true;
    }
    if (madeVisible && activatedCount > DIFFICULTY[level].concurrent) showNotice(STRINGS.nextVisitors);
  }

  function buildWorld() {
    zooWorld = createZooWorld({ labels: Object.fromEntries(LESSON.vocabulary.map((item) => [item.id, item.id.toUpperCase()])) });
    scene.background = new THREE.Color(0x9bdcff);
    scene.fog = null;
    scene.add(zooWorld.group);
    buildCharacters();
    zooWorld.loadAnimals();
    zooWorld.loadEnvironment();
  }

  function canOccupy(x, z) {
    return canOccupyCampus(x, z, PLAYER_RADIUS);
  }

  /**
   * Eases the player out of a large animal rather than blocking them.
   *
   * Only the big-bodied animals push, and they push softly: a hard collider on
   * something that walks toward you is how a child gets shoved into scenery or
   * pinned against the pool. Standing shoulder to shoulder with a giraffe is
   * fine; standing inside it is not.
   */
  const PUSH_RADIUS = Object.freeze({ giraffe: 1.5, horse: 1.3, deer: 1.2, tiger: 1.2, dog: 0.9 });
  function separateFromAnimals(dt) {
    if (!zooWorld) return;
    for (const subject of zooWorld.habitats) {
      const push = PUSH_RADIUS[subject.id];
      if (!push) continue;
      const dx = player.position.x - subject.x;
      const dz = player.position.z - subject.z;
      const distance = Math.hypot(dx, dz);
      const overlap = push + PLAYER_RADIUS * 0.5 - distance;
      if (overlap <= 0) continue;
      // Ease out over a few frames so it reads as being nudged, not bounced.
      const step = Math.min(overlap, overlap * Math.min(1, 9 * dt));
      const nx = distance > 1e-3 ? dx / distance : 1;
      const nz = distance > 1e-3 ? dz / distance : 0;
      const nextX = player.position.x + nx * step;
      const nextZ = player.position.z + nz * step;
      // Never push the player into scenery; being inside the animal is better
      // than being pushed through the fountain wall.
      if (canOccupy(nextX, player.position.z)) player.position.x = nextX;
      if (canOccupy(player.position.x, nextZ)) player.position.z = nextZ;
    }
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
    const wantedRotation = Math.atan2(move.x, -move.y);
    const turn = Math.atan2(Math.sin(wantedRotation - player.rotation.y), Math.cos(wantedRotation - player.rotation.y));
    player.rotation.y += turn * (1 - Math.exp(-12 * dt));
    separateFromAnimals(dt);
    player.playAnimation?.('walk');
  }

  function updateViewfinderMovement(dt) {
    input.getMovement(move);
    // Turning right must decrease the yaw. With the camera looking along
    // (sin y, cos y), screen-right in world is (-cos y, sin y), which is where
    // a *smaller* yaw points — so adding here swung the view the wrong way.
    if (move.x) player.rotation.y -= move.x * 1.55 * dt;
    if (move.y) {
      const distance = move.y * MOVE_SPEED * .62 * dt;
      const nextX = player.position.x + Math.sin(player.rotation.y) * distance;
      const nextZ = player.position.z + Math.cos(player.rotation.y) * distance;
      if (canOccupy(nextX, player.position.z)) player.position.x = nextX;
      if (canOccupy(player.position.x, nextZ)) player.position.z = nextZ;
      separateFromAnimals(dt);
      player.playAnimation?.('walk');
    } else {
      player.playAnimation?.('idle');
    }
    // The avatar is hidden while aiming. A distant, high, wide camera shot the
    // slim animals (penguin, chicken, cat) too small to frame from a distance.
    if (camera.fov !== VIEWFINDER_FOV) {
      followFov = camera.fov;
      camera.fov = VIEWFINDER_FOV;
      camera.updateProjectionMatrix();
    }
    const back = 3.8;
    const forwardX = Math.sin(player.rotation.y);
    const forwardZ = Math.cos(player.rotation.y);
    viewfinderEye.set(player.position.x - forwardX * back, 3.4, player.position.z - forwardZ * back);
    viewfinderLook.set(player.position.x + forwardX * 8, 1, player.position.z + forwardZ * 8);
    // A sign or building behind the player would fill the shot, so the camera
    // moves along its sightline to just in front of it.
    viewfinderRay.subVectors(viewfinderLook, viewfinderEye).normalize();
    const behind = zooWorld.occluderDistances(viewfinderEye, viewfinderRay, back);
    if (behind.length) {
      viewfinderEye.addScaledVector(viewfinderRay, Math.min(back - 0.3, Math.max(...behind) + 0.3));
    }
    cameraRig.setTarget(null).setPreset('fixed', {
      position: viewfinderEye.toArray(), lookAt: viewfinderLook.toArray(), damping: 10,
    });
  }

  function setTwoShot(npcObject, { distance = 5, height = 3.25, lookHeight = 1 } = {}) {
    let dx = player.position.x - npcObject.position.x;
    let dz = player.position.z - npcObject.position.z;
    const length = Math.hypot(dx, dz) || 1;
    dx /= length;
    dz /= length;
    const midpointX = (player.position.x + npcObject.position.x) * .5;
    const midpointZ = (player.position.z + npcObject.position.z) * .5;
    let sideX = -dz;
    let sideZ = dx;
    if (sideZ < 0) { sideX = -sideX; sideZ = -sideZ; }
    cameraRig.setTarget(null).setPreset('fixed', {
      position: [midpointX + sideX * distance + dx * 1.2, height, midpointZ + sideZ * distance + dz * 1.2],
      lookAt: [midpointX, lookHeight, midpointZ],
      damping: 7,
    });
  }

  let followFov = null;

  function restoreFov() {
    if (followFov === null) return;
    camera.fov = followFov;
    camera.updateProjectionMatrix();
    followFov = null;
  }

  function restoreFollowCamera() {
    restoreFov();
    cameraRig.setTarget(player).setPreset('follow', {
      offset: [0, 8.6, 10.8], lookOffset: [0, 1.05, -1.7], damping: 5,
    });
  }

  function separateForDialogue(npcObject) {
    let dx = player.position.x - npcObject.position.x;
    let dz = player.position.z - npcObject.position.z;
    let distance = Math.hypot(dx, dz);
    if (distance >= 1.45) return;
    if (distance < .01) { dx = 0; dz = 1; distance = 1; }
    player.position.x = npcObject.position.x + dx / distance * 1.45;
    player.position.z = npcObject.position.z + dz / distance * 1.45;
  }

  function clearQuestion(keepHud = false) {
    questionVisitor = null;
    questionCommitted = false;
    speech.clearTarget();
    if (!keepHud) hud.hide();
  }

  function acceptQuestion(visitor) {
    if (!active || phase !== 'playing' || visitor.state !== 'waiting' || visitor.asked) return;
    clearQuestion(true);
    visitor.asked = true;
    hud.setTalkState('accepted');
    visitor.character.playAnimation?.('emote-yes');
    separateForDialogue(visitor.character);
    faceToward(visitor.character, player.position.x, player.position.z);
    faceToward(player, visitor.character.position.x, visitor.character.position.z);
    dialogueVisitor = visitor;
    dialogue.show({ text: answerFor(LESSON, visitor.wanted), anchor: visitor.character, offsetY: visitor.character.dialogueOffsetY ?? 1.9 });
    audio.playSfx('accept');
    setInstruction(STRINGS.explore);
    setTwoShot(visitor.character);
    answerRemaining = 2.5;
    phase = 'answering';
  }

  function targetQuestion(visitor) {
    if (questionVisitor === visitor) return;
    if (questionCommitted) return;
    clearQuestion();
    questionVisitor = visitor;
    promptQuestion(ctx, LESSON, {
      isActive: () => active && phase === 'playing' && visitor.state === 'waiting'
        && !visitor.asked && visitorInTalkRange(visitor),
      onCommit: () => {
        if (questionVisitor === visitor && visitorInTalkRange(visitor)) questionCommitted = true;
      },
      onCancel: () => {
        if (questionVisitor === visitor) questionCommitted = false;
      },
      onAccepted: () => acceptQuestion(visitor),
    });
    setInstruction(STRINGS.askVisitor);
  }

  function visitorInTalkRange(visitor) {
    const dx = player.position.x - visitor.character.position.x;
    const dz = player.position.z - visitor.character.position.z;
    return dx * dx + dz * dz < TALK_RADIUS_SQ;
  }

  function nearestVisitor(predicate) {
    let nearest = null;
    let best = TALK_RADIUS_SQ;
    for (const visitor of visitors) {
      if (!predicate(visitor)) continue;
      const dx = player.position.x - visitor.character.position.x;
      const dz = player.position.z - visitor.character.position.z;
      const distance = dx * dx + dz * dz;
      if (distance < best) { best = distance; nearest = visitor; }
    }
    return nearest;
  }

  function openRequests() {
    return visitors.filter((visitor) => visitor.state === 'waiting' && visitor.asked && !visitor.served);
  }

  function updateContext() {
    if (questionCommitted) {
      const lockedVisitorIsEligible = questionVisitor?.state === 'waiting'
        && !questionVisitor.asked && visitorInTalkRange(questionVisitor);
      if (lockedVisitorIsEligible) {
        actionVisitor = null;
        setInstruction(STRINGS.askVisitor);
        if (openRequests().length) listenAgain?.show();
        else listenAgain?.hide();
        return;
      }
      clearQuestion();
    }
    actionVisitor = carriedPhoto
      ? nearestVisitor((visitor) => visitor.state === 'waiting' && visitor.asked)
      : null;
    const unasked = nearestVisitor((visitor) => visitor.state === 'waiting' && !visitor.asked);
    if (actionVisitor) clearQuestion();
    else if (unasked) targetQuestion(unasked);
    else if (questionVisitor) clearQuestion();
    if (actionVisitor) setInstruction(STRINGS.showPhoto);
    else if (openRequests().length && carriedPhoto) setInstruction(STRINGS.returnToVisitor);
    else if (openRequests().length) setInstruction(STRINGS.explore);
    else if (!unasked) setInstruction(STRINGS.walkToVisitor);

    if (openRequests().length) listenAgain?.show();
    else listenAgain?.hide();
  }

  function replayWaitingVisitors() {
    if (!active || phase !== 'playing') return;
    const waiting = openRequests();
    if (!waiting.length) return;
    clearQuestion();
    replayQueue.splice(0, replayQueue.length, ...waiting);
    for (const visitor of waiting) visitor.replayed = true;
    listenAgain?.hide();
    phase = 'replaying';
    playNextReplay();
  }

  function playNextReplay() {
    if (!replayQueue.length) {
      currentReplayVisitor = null;
      dialogue.hide();
      phase = 'playing';
      restoreFollowCamera();
      return;
    }
    currentReplayVisitor = replayQueue.shift();
    replayRemaining = 1.9;
    const sentence = answerFor(LESSON, currentReplayVisitor.wanted);
    dialogue.show({ text: sentence, anchor: currentReplayVisitor.character, offsetY: 1.9, speak: false });
    audio.speak(sentence);
    currentReplayVisitor.character.playAnimation?.('emote-yes');
    faceToward(currentReplayVisitor.character, player.position.x, player.position.z);
    setTwoShot(currentReplayVisitor.character);
  }

  async function openViewfinder() {
    if (!active || phase !== 'playing') return;
    clearQuestion();
    phase = 'opening-viewfinder';
    // Framing state is stale from the previous shot until the first frame of
    // this session is judged. Leaving the shutter lit through the opening wipe
    // meant an early press hit takePhoto's phase guard and did nothing at all.
    resetFraming();
    const changed = await transitions.run(() => {
      if (!active) return;
      viewfinder.hidden = false;
      cameraButton.hidden = true;
      listenAgain?.hide();
      hud.hide();
      dialogue.hide();
      input.clear();
      player.visible = false;
      updateViewfinderMovement(0);
    });
    if (changed && active && phase === 'opening-viewfinder') {
      phase = 'viewfinder';
      shutterButton.focus();
    } else if (!changed && active && phase === 'opening-viewfinder') {
      phase = 'playing';
    }
  }

  function resetFraming() {
    framedSubject = null;
    lastGoodSubject = null;
    lastGoodAt = 0;
    shutterReady = false;
    if (shutterButton) shutterButton.disabled = true;
    if (viewfinderGuide) viewfinderGuide.classList.remove('is-ready');
    if (viewfinderInstruction) viewfinderInstruction.textContent = STRINGS.frameAnimal;
  }

  async function closeViewfinder() {
    if (!active || phase !== 'viewfinder') return;
    phase = 'closing-viewfinder';
    resetFraming();
    const changed = await transitions.run(() => {
      if (!active) return;
      viewfinder.hidden = true;
      cameraButton.hidden = false;
      player.visible = true;
      input.clear();
      restoreFollowCamera();
    });
    if (changed && active && phase === 'closing-viewfinder') phase = 'playing';
    else if (!changed && active && phase === 'closing-viewfinder') phase = 'viewfinder';
  }

  function evaluateFraming() {
    camera.updateMatrixWorld();
    cameraRight.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    cameraUp.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
    let best = null;
    let blockedBest = null;
    for (const habitat of zooWorld.habitats) {
      habitat.photoTarget.getWorldPosition(worldCenter);
      projectedCenter.copy(worldCenter).project(camera);
      worldEdge.copy(worldCenter).addScaledVector(cameraUp, habitat.photoHalfHeight ?? habitat.photoRadius);
      projectedEdge.copy(worldEdge).project(camera);
      const height = Math.abs(projectedEdge.y - projectedCenter.y);
      worldEdge.copy(worldCenter).addScaledVector(cameraRight, habitat.photoRadius);
      projectedEdge.copy(worldEdge).project(camera);
      // NDC x spans 2 units over the frame width, y spans 2 over its height, so
      // a half-extent in NDC is already a full extent as a frame fraction.
      const width = Math.abs(projectedEdge.x - projectedCenter.x);
      const frame = {
        x: (projectedCenter.x + 1) * .5,
        y: (1 - projectedCenter.y) * .5,
        width,
        height,
      };
      const framing = measureFraming(frame);
      const visible = projectedCenter.z >= -1 && projectedCenter.z <= 1
        && frame.x >= .12 && frame.x <= .88 && frame.y >= .1 && frame.y <= .84
        && Math.sqrt(width * height) >= .11;
      // Prefer the animal the child is closest to. Animals roam and can pass
      // each other, so a neighbour further off can frame better than the one
      // being aimed at, and the photo comes back as the wrong animal. Distance
      // only breaks ties: a deliberately distant shot still wins if it is framed
      // considerably better. `habitat.x`/`z` track the roamer, never a pen.
      const away = Math.hypot(player.position.x - habitat.x, player.position.z - habitat.z);
      const score = framing - Math.min(.3, away * .012);
      if (!visible || (best && score <= best.score)) continue;
      // A frame hidden behind a sign or a building is not a photo of the
      // animal, however well the invisible silhouette would have been framed.
      const blocked = zooWorld.countBlockedSamples(habitat, camera);
      const visibleFraction = 1 - blocked / zooWorld.visibilitySampleCount;
      const candidate = { habitat, framing, frame, score, visibleFraction, blocked };
      if (visibleFraction >= .6) best = candidate;
      else if (!blockedBest || score > blockedBest.score) blockedBest = candidate;
    }
    framedSubject = best;
    const reported = best ?? blockedBest;
    framingDebug = reported ? {
      habitatId: reported.habitat.id,
      framing: Number(reported.framing.toFixed(3)),
      visibleFraction: reported.visibleFraction,
      blockedSampleCount: reported.blocked,
    } : null;
    // Hysteresis: the animals wander, so a frame hovering at the threshold made
    // the shutter blink on and off. Once ready it stays ready until the frame is
    // clearly bad.
    shutterReady = Boolean(best && best.framing >= (shutterReady ? .3 : .38));
    if (shutterReady && best) {
      lastGoodSubject = best;
      lastGoodAt = performance.now();
    }
    shutterButton.disabled = !shutterReady;
    viewfinderGuide.classList.toggle('is-ready', shutterReady);
    viewfinderInstruction.textContent = shutterReady ? STRINGS.readyToShoot : STRINGS.frameAnimal;
  }

  function snapshotDataUrl(animalId) {
    const source = document.querySelector('#game-canvas');
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 200;
    const context = canvas.getContext('2d');
    context.fillStyle = '#d8eef2';
    context.fillRect(0, 0, canvas.width, canvas.height);
    try {
      // Between frames the WebGL buffer is empty, which saved a blank photo. The
      // shell renders once and hands the canvas back in the same task, while the
      // pixels can still be read.
      const copy = (live) => {
        const sw = live.width * .72;
        const sh = live.height * .68;
        context.drawImage(live, (live.width - sw) * .5, live.height * .09, sw, sh, 0, 0, canvas.width, canvas.height);
      };
      if (typeof ctx.captureFrame === 'function') ctx.captureFrame(copy);
      else copy(source);
    } catch {
      // A safe background still lets the session finish if a browser refuses a WebGL canvas copy.
    }
    context.strokeStyle = '#ffffff';
    context.lineWidth = 8;
    context.strokeRect(5, 5, canvas.width - 10, canvas.height - 10);
    context.fillStyle = 'rgba(25,43,58,.82)';
    context.fillRect(0, 164, canvas.width, 36);
    context.fillStyle = '#ffffff';
    context.font = 'bold 21px system-ui, sans-serif';
    context.textAlign = 'center';
    context.fillText(animalId.toUpperCase(), canvas.width / 2, 189);
    let result = canvas.toDataURL('image/jpeg', .72);
    if (result.length > 190000) result = canvas.toDataURL('image/jpeg', .5);
    canvas.width = 0;
    canvas.height = 0;
    return result;
  }

  function takePhoto() {
    if (!active || phase !== 'viewfinder') return;
    // Honour a press that lands just after the subject drifted: pressing a lit
    // shutter must never silently do nothing.
    const subject = (shutterReady && framedSubject)
      || (performance.now() - lastGoodAt <= 600 ? lastGoodSubject : null);
    if (!subject) return;
    const id = subject.habitat.id;
    const dataUrl = snapshotDataUrl(id);
    carriedPhoto = { animal: id, framing: subject.framing, dataUrl };
    zooPhoto = dataUrl;
    renderCarriedPhoto();
    showNotice(STRINGS.photoTaken);
    audio.playSfx('interact');
    closeViewfinder();
  }

  function renderCarriedPhoto() {
    if (!carriedIndicator) return;
    carriedIndicator.replaceChildren();
    const image = document.createElement('img');
    const copy = document.createElement('div');
    const title = document.createElement('strong');
    const value = document.createElement('div');
    image.alt = '';
    title.textContent = STRINGS.carriedPhoto;
    if (carriedPhoto) {
      image.src = carriedPhoto.dataUrl;
      value.textContent = carriedPhoto.animal.toUpperCase();
    } else {
      value.textContent = STRINGS.noPhoto;
    }
    copy.append(title, value);
    carriedIndicator.append(image, copy);
  }

  function showPhotoToVisitor() {
    const visitor = actionVisitor;
    if (!visitor || !carriedPhoto || phase !== 'playing') return;
    clearQuestion();
    visitor.shows += 1;
    dialogueVisitor = visitor;
    separateForDialogue(visitor.character);
    faceToward(visitor.character, player.position.x, player.position.z);
    faceToward(player, visitor.character.position.x, visitor.character.position.z);
    setTwoShot(visitor.character);
    if (carriedPhoto.animal !== visitor.wanted) {
      dialogue.show({ text: STRINGS.wrongPhoto, anchor: visitor.character, offsetY: visitor.character.dialogueOffsetY ?? 1.9, speak: false });
      showNotice(STRINGS.wrongPhoto);
      audio.playSfx('retry');
      // SPEC: one photograph is one delivery attempt, so a wrong photo is used up.
      carriedPhoto = null;
      renderCarriedPhoto();
      reactionRemaining = 2.0;
      phase = 'reacting-wrong';
      return;
    }

    records.push({ outcome: visitor.shows === 1 ? 'first' : 'later', framing: carriedPhoto.framing, replayed: visitor.replayed });
    visitor.state = 'leaving';
    visitor.served = true;
    visitor.leaveRemaining = 1.9;
    servedCount += 1;
    dialogue.show({ text: STRINGS.thankYou, anchor: visitor.character, offsetY: visitor.character.dialogueOffsetY ?? 1.9, speak: false });
    visitor.character.playAnimation?.('emote-yes');
    player.playAnimation?.('emote-yes');
    showNotice(STRINGS.thankYou);
    audio.playSfx('accept');
    carriedPhoto = null;
    renderCarriedPhoto();
    listenAgain?.hide();
    reactionRemaining = 2.0;
    phase = 'reacting-correct';
  }

  function finishReaction(correct) {
    dialogue.hide();
    dialogueVisitor = null;
    restoreFollowCamera();
    if (!correct) { phase = 'playing'; return; }
    const outstanding = visitors.filter((visitor) => visitor.state === 'waiting').length;
    if (activatedCount < visitors.length) activateVisitors(Math.max(1, DIFFICULTY[level].concurrent - outstanding));
    if (servedCount >= visitors.length) {
      phase = 'round-end';
      roundEndRemaining = 1.25;
      setInstruction(STRINGS.everyoneHappy);
      showNotice(STRINGS.everyoneHappy);
    } else {
      phase = 'playing';
    }
  }

  function beginTurnaround() {
    if (!active || phase !== 'round-end') return;
    phase = 'turnaround';
    keeper.visible = true;
    // Out on the open plaza, clear of the entrance arch at z 32.15 and the
    // fountain at x 3.45: standing in the gateway filled the shot with striped
    // posts and hid the keeper behind the answer buttons.
    keeper.position.set(clamp(player.position.x + 1.8, -2.4, 1.9), 0.08, clamp(player.position.z - 1.1, 25.2, 28.4));
    faceToward(keeper, player.position.x, player.position.z);
    faceToward(player, keeper.position.x, keeper.position.z);
    keeper.playAnimation?.('idle');
    dialogue.show({ text: LESSON.question, anchor: keeper, offsetY: 1.9 });
    setInstruction(STRINGS.turnaround);
    // Thirteen answers fill four rows of buttons across the middle of the
    // screen, so the pair has to sit in the upper third: close in, camera near
    // head height, aimed low so the characters ride high in frame with their
    // bubble above the grid.
    setTwoShot(keeper, { distance: 4.6, height: 2.4, lookHeight: .25 });
    promptAnswer(ctx, LESSON, {
      isActive: () => active && phase === 'turnaround',
      onAccepted: completeTurnaround,
    });
  }

  function completeTurnaround(answer) {
    if (!active || phase !== 'turnaround') return;
    acceptedAnswer = answer || LESSON.answers[0];
    speech.clearTarget();
    hud.setTalkState('accepted');
    dialogue.hide();
    keeper.playAnimation?.('emote-yes');
    player.playAnimation?.('emote-yes');
    setInstruction(STRINGS.yourFavourite);
    showNotice(STRINGS.yourFavourite, 2.2);
    audio.playSfx('stamp');
    phase = 'finishing';
    finishRemaining = 2.15;
  }

  function onKeyDown(event) {
    if (!active || event.repeat || event.target instanceof HTMLButtonElement) return;
    // The editor owns its own keys once it is open; this one only toggles it.
    if (DEV_TOOLS_ENABLED && event.code === 'KeyP' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      toggleSceneEditor();
      return;
    }
    if (sceneEditor?.enabled) return;
    if ((event.key === 'c' || event.key === 'C') && phase === 'playing') {
      event.preventDefault();
      openViewfinder();
    }
  }

  /**
   * Opens the scene placement editor, loading it on first use.
   *
   * The dynamic import is the point: in a production build the editor is a
   * separate chunk that a student's browser never asks for, so it costs
   * nothing to have it. `DEV_TOOLS_ENABLED` decides whether the key works at
   * all, and this function is the only path to it.
   */
  async function toggleSceneEditor() {
    if (!DEV_TOOLS_ENABLED || editorLoading) return;
    if (sceneEditor) {
      sceneEditor.toggle();
      return;
    }
    if (!zooWorld) return;
    editorLoading = true;
    try {
      const [{ createSceneEditor }, { createZooEditorAdapter }] = await Promise.all([
        import('../../dev/scene-editor/SceneEditor.js'),
        import('./zooEditorAdapter.js'),
      ]);
      sceneEditor = createSceneEditor({
        scene,
        camera,
        domElement: renderer?.domElement ?? canvas,
        adapter: createZooEditorAdapter({ zooWorld }),
        uiRoot: overlay?.parentElement ?? document.body,
        storageKey: 'esl-likes:zoo-layout-draft',
        onEnable: () => {
          // Freeze the park: the avatar stops walking, the animals stop
          // roaming, and the follow rig lets go of the camera. Nothing about
          // the Zoo's own state changes, so closing the editor resumes play
          // exactly where it paused.
          editorPausedPhase = phase;
          phase = 'editing';
          cameraRig.setEnabled(false);
          zooWorld.setSceneryEditable(true);
          if (overlay) overlay.hidden = true;
          hud.hide();
          input.clear();
        },
        onDisable: () => {
          // The scenery deliberately STAYS expanded. Rebuilding the instanced
          // form here would re-read the frozen placements in scenery.js and
          // silently throw away every edit made to existing scenery — you
          // would close the editor to look at your work and find it undone.
          // Expanding is a one-way door within a session, and it only ever
          // happens in a session where someone opened the editor.
          cameraRig.setEnabled(true);
          if (overlay) overlay.hidden = false;
          phase = editorPausedPhase ?? 'playing';
          editorPausedPhase = null;
          input.clear();
        },
      });
      // A handle for browser checks and for driving the editor from the
      // console. Only ever set behind DEV_TOOLS_ENABLED.
      window.__zooSceneEditor = sceneEditor;
      sceneEditor.enable();
    } catch (error) {
      console.error('[zoo] The scene editor failed to load.', error);
    } finally {
      editorLoading = false;
    }
  }

  function debugSnapshot() {
    return {
      phase,
      level,
      elapsed,
      frame,
      player: {
        x: player?.position.x ?? 0,
        z: player?.position.z ?? 0,
        yaw: player?.rotation.y ?? 0,
        forward: { x: Math.sin(player?.rotation.y ?? 0), z: Math.cos(player?.rotation.y ?? 0) },
      },
      framing: framingDebug,
      visibleFraction: framingDebug?.visibleFraction ?? null,
      blockedSampleCount: framingDebug?.blockedSampleCount ?? null,
      // Live roaming state. There is no fixed habitat position any more, so
      // anything that wants to find an animal has to read where it is now.
      animals: zooWorld?.getAnimalDebug?.() ?? [],
      clips: zooWorld?.getClipState?.() ?? { status: 'idle', animals: [] },
      areas: AREAS,
      territories: TERRITORIES.map((territory) => ({
        id: territory.id,
        area: territory.area,
        centre: territory.centre,
        bounds: territory.bounds,
        speed: territory.speed,
        waypoints: territory.waypoints,
      })),
      pathGraph: { nodes: pathNodes, edges: pathEdges },
      landmarks: campusLandmarks,
      bounds: campusBounds,
      environment: zooWorld?.getEnvironmentState?.() ?? {
        status: 'loading', pending: 0, loadedUniqueModels: 0, failedAssets: [],
      },
      sceneStats: zooWorld?.getSceneStatsReport?.() ?? {
        beforeDressing: null,
        afterDressing: null,
        current: { meshes: 0, instancedMeshes: 0, triangles: 0, uniqueEnvironmentModels: 0 },
      },
      visitors: visitors.map((visitor) => ({
        state: visitor.state,
        asked: visitor.asked,
        served: visitor.served,
        x: visitor.character.position.x,
        z: visitor.character.position.z,
      })),
      carriedPhoto: carriedPhoto?.animal ?? null,
      shutterReady,
      // Null unless a developer has actually opened the editor. Building the
      // layout is not free, so a closed editor reports only that it is closed.
      editor: sceneEditor
        ? {
          enabled: sceneEditor.enabled,
          objects: sceneEditor.enabled ? sceneEditor.getLayout().objects.length : null,
          selection: sceneEditor.selection?.id ?? null,
          editableGroups: sceneEditor.enabled
            ? zooWorld?.getSceneryGroups().filter((group) => group.individual).length ?? 0
            : null,
        }
        : null,
    };
  }

  function installDebugHook() {
    if (!window.__eslDebug) {
      Object.defineProperty(window, '__eslDebug', { value: {}, configurable: true, writable: false });
      debugRootCreated = true;
    }
    Object.defineProperty(window.__eslDebug, 'zoo', { configurable: true, enumerable: true, get: debugSnapshot });
  }

  function removeDebugHook() {
    if (window.__eslDebug) delete window.__eslDebug.zoo;
    if (debugRootCreated && window.__eslDebug && Object.keys(window.__eslDebug).length === 0) delete window.__eslDebug;
    debugRootCreated = false;
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
    phase = 'playing';
    elapsed = 0;
    frame = 0;
    noticeRemaining = 0;
    answerRemaining = 0;
    replayRemaining = 0;
    reactionRemaining = 0;
    roundEndRemaining = 0;
    finishRemaining = 0;
    questionVisitor = null;
    questionCommitted = false;
    dialogueVisitor = null;
    currentReplayVisitor = null;
    acceptedAnswer = null;
    carriedPhoto = null;
    zooPhoto = null;
    shutterReady = false;
    framedSubject = null;
    actionVisitor = null;
    activatedCount = 0;
    servedCount = 0;
    createOverlay();
    buildWorld();
    installDebugHook();
    window.addEventListener('keydown', onKeyDown);
    unregisterEscapeGuard = registerEscapeGuard?.(() => {
      if (!active || phase !== 'viewfinder') return false;
      closeViewfinder();
      return true;
    }) ?? null;
    unsubscribeSettings = settings.subscribe((next) => {
      if (!active) return;
      hud.setMicFree(next.micFree);
      hud.setTextSize(next.textSize);
    });
  }

  function update(dt) {
    if (!active) return;
    // While the editor is open the park is frozen: no walking, no roaming, no
    // timers. Only the editor's own camera keeps moving.
    if (sceneEditor?.enabled) {
      sceneEditor.update(dt);
      return;
    }
    frame += 1;
    const safeDt = Math.min(Math.max(dt || 0, 0), .05);
    elapsed += safeDt;
    if (noticeRemaining > 0) {
      noticeRemaining -= safeDt;
      if (noticeRemaining <= 0 && notice) notice.hidden = true;
    }

    if (phase === 'playing') {
      updateMovement(safeDt);
      updateContext();
      if (actionVisitor && input.consumeInteract()) showPhotoToVisitor();
    } else if (phase === 'answering') {
      player.playAnimation?.('idle');
      answerRemaining -= safeDt;
      if (answerRemaining <= 0) {
        dialogue.hide();
        dialogueVisitor = null;
        hud.hide();
        restoreFollowCamera();
        phase = 'playing';
      }
    } else if (phase === 'replaying') {
      player.playAnimation?.('idle');
      replayRemaining -= safeDt;
      if (replayRemaining <= 0) playNextReplay();
    } else if (phase === 'viewfinder') {
      updateViewfinderMovement(safeDt);
      evaluateFraming();
    } else if (phase === 'reacting-wrong' || phase === 'reacting-correct') {
      player.playAnimation?.('idle');
      reactionRemaining -= safeDt;
      if (reactionRemaining <= 0) finishReaction(phase === 'reacting-correct');
    } else if (phase === 'round-end') {
      player.playAnimation?.('idle');
      roundEndRemaining -= safeDt;
      if (roundEndRemaining <= 0) beginTurnaround();
    } else if (phase === 'finishing') {
      finishRemaining -= safeDt;
      if (finishRemaining <= 0 && !finishCalled) {
        finishCalled = true;
        const result = scoreSession(records);
        hud.hide();
        finish({ stars: result.stars, detail: { category: 'animal', answer: acceptedAnswer, zooPhoto } });
      }
    }

    zooWorld?.update(safeDt);
    player?.updateAnimation?.(safeDt);
    keeper?.updateAnimation?.(safeDt);
    for (const visitor of visitors) {
      if (visitor.state === 'leaving') {
        visitor.leaveRemaining -= safeDt;
        visitor.character.position.x += 1.5 * safeDt;
        visitor.character.position.z += .6 * safeDt;
        if (visitor.leaveRemaining <= 0) {
          visitor.state = 'served';
          visitor.character.visible = false;
        }
      }
      if (visitor.character.visible) visitor.character.updateAnimation?.(safeDt);
    }
  }

  function exit() {
    restoreFov();
    // The editor holds the camera and a gizmo attached to objects that are
    // about to be disposed, so it has to let go first.
    sceneEditor?.dispose();
    sceneEditor = null;
    editorPausedPhase = null;
    cameraRig.setEnabled(true);
    active = false;
    phase = 'inactive';
    unsubscribeSettings?.();
    unsubscribeSettings = null;
    unregisterEscapeGuard?.();
    unregisterEscapeGuard = null;
    window.removeEventListener('keydown', onKeyDown);
    speech.clearTarget();
    speech.cancel();
    audio.stop();
    hud.hide();
    dialogue.hide();
    dialogue.element?.classList.remove('zoo-dialogue');
    cameraRig.setTarget(null);
    listenAgain?.dispose();
    listenAgain = null;
    removeDebugHook();
    cameraButton?.removeEventListener('click', openViewfinder);
    shutterButton?.removeEventListener('click', takePhoto);
    closeButton?.removeEventListener('click', closeViewfinder);
    player?.disposeCharacter?.();
    keeper?.disposeCharacter?.();
    for (const visitor of visitors) visitor.character.disposeCharacter?.();
    disposeSharedPaperAssets();
    visitors.length = 0;
    records.length = 0;
    replayQueue.length = 0;
    if (zooWorld) scene.remove(zooWorld.group);
    zooWorld?.dispose();
    zooWorld = null;
    overlay?.remove();
    style?.remove();
    overlay = null;
    style = null;
    instruction = null;
    notice = null;
    cameraButton = null;
    carriedIndicator = null;
    viewfinder = null;
    viewfinderGuide = null;
    viewfinderInstruction = null;
    shutterButton = null;
    closeButton = null;
    player = null;
    keeper = null;
    carriedPhoto = null;
    zooPhoto = null;
    questionVisitor = null;
    dialogueVisitor = null;
    currentReplayVisitor = null;
    scene.fog = null;
  }

  return { id: 'zoo', enter, update, exit };
}
