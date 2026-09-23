import * as THREE from 'three';
import { LESSON_BY_ID, UI, answerFor } from '../../config/lesson.js';
import { promptQuestion, promptAnswer } from '../../systems/speechPrompt.js';
import { createPaintingSurface } from './picture.js';
import { PALETTE, PALETTE_HEX } from './palette.js';
import { BRUSHES, BRUSH_IDS, DEFAULT_BRUSH } from './brushes.js';
import { drawBlankBody, drawLineArt, PAPER } from './robotRenderer.js';
import { createCoverage, sessionStars } from './coverage.js';
import { createPaperPuppet, disposeSharedPaperAssets } from './paperPuppet.js';
import { STATES } from './robotPuppet.js';
import { createCrowd } from './robotCrowd.js';
import { creationPersistenceStatus, saveCompletedCreation, savedCreations } from './coloringSession.js';
import { DEFAULT_SUBJECT_ID, SUBJECTS, subjectById } from './subjectRegistry.js';

const LESSON = LESSON_BY_ID.coloring;
const STRINGS = UI.coloring;
const MOVE_SPEED = 5;

const ROOM_WIDTH = 12.5;
const ROOM_DEPTH = 11.5;
const WALL_HEIGHT = 5.2;
const WALL_THICKNESS = 0.3;
const DOOR_WIDTH = 1.7;
const DOOR_HEIGHT = 3.1;
const FLOOR_THICKNESS = WALL_THICKNESS * (5 / 3);
const TRIM_HEIGHT = WALL_THICKNESS * 1.13;
const TRIM_DEPTH = WALL_THICKNESS * 0.4;
const DOOR_JAMB_WIDTH = WALL_THICKNESS * 0.6;
const DOOR_FRAME_DEPTH = WALL_THICKNESS * 0.87;

/**
 * The room is one easel and a door, and both are Space.
 *
 * They are far enough apart that no position is inside both radii, so no
 * priority rule is needed — which matters, because one of them ends the
 * session and the other does not.
 */
const EASEL = Object.freeze({ x: 0, z: -1.6 });
const EASEL_RADIUS_SQ = 2.15 * 2.15;
const DOOR = Object.freeze({ x: 3.6, z: -ROOM_DEPTH / 2 + 1.2 });
const DOOR_RADIUS_SQ = 1.5 * 1.5;
const PLAYER_REVEAL_Z = EASEL.z + 2.15;
const PLAYER_RETREAT_Z = EASEL.z + 3.4;
/**
 * The retreat steps ASIDE as well as back, and the sideways part is the part
 * that matters. The camera sits behind the player, so a purely backward step
 * moves them towards the lens: they grow on screen and keep the newborn robot
 * behind a shoulder even though the world-space gap is opening. Stepping wide
 * clears the robot in the only space the child is looking at.
 */
const PLAYER_RETREAT_X = EASEL.x - 1.85;
const ROBOT_LANDING_Z = EASEL.z + 1.95;
const PLAYER_RETREAT_SECONDS = 0.55;

/** The paper on the easel: a square, because the picture is a square. */
export const PAPER_SIZE = 1.7;
const PAPER_CENTRE_Y = 1.78;
/** Local z of the paper plane on the easel. Everything else follows it. */
export const PAPER_PLANE_Z = 0.24;
/** Camera-to-sheet distance. Fixed by the cross-fade, not by taste. */
export const PAPER_CAMERA_GAP = 2.55;
/** The newborn starts far enough forward to clear the leaned sheet's bottom. */
export const PUPPET_START_Z = PAPER_PLANE_Z + 0.16;

/**
 * The three camera stages (see .ai/coloring-easel-loop-spec.md section 4).
 *
 * The rig damps towards whatever preset it is given, so a staged pull-back is
 * three `setPreset` calls and no tween. The two cinematic stages use a low
 * damping so the move reads as a deliberate reveal.
 *
 * `paper`'s distance is not a guess: the camera is 48 degrees vertical, so the
 * visible height at distance d is 0.8905 d. At 2.55 in front of the sheet a
 * 1.7-unit page fills about 78% of the screen — which is what the DOM canvas
 * fills, and the cross-fade between them only works if they match.
 */
export const CAMERA = Object.freeze({
  paper: Object.freeze({ offset: [0, PAPER_CENTRE_Y, PAPER_PLANE_Z + PAPER_CAMERA_GAP], lookOffset: [0, PAPER_CENTRE_Y, 0], damping: 2.4 }),
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
const EXIT_SECONDS = 1.3;
/** A beat at the easel after the landing, before the room opens up. */
const REVEAL_HOLD = 1.2;
/** A beat after the pull-back before the child has the keys. */
const ROOM_HOLD = 1.1;
/** How long the blank sheet stays blank before the next drawing appears. */
const BLANK_DELAY_MIN = 2.5;
const BLANK_DELAY_SPAN = 1.5;
/** The new drawing fades in over this long. Visual invitation, never a gate. */
const PICTURE_FADE_SECONDS = 1.2;

function addPart(parent, geometry, material, x, y, z, sx = 1, sy = 1, sz = 1) {
  const part = new THREE.Mesh(geometry, material);
  part.position.set(x, y, z);
  part.scale.set(sx, sy, sz);
  parent.add(part);
  return part;
}

/**
 * The production easel assembly, exported so geometry tests inspect the same
 * transformed meshes that the room renders rather than a second set of maths.
 */
export function buildColoringEasel({ box, plane, easelMaterial, paperMaterial, artMaterial }) {
  const group = new THREE.Group();
  group.name = 'coloring-easel';
  group.position.set(EASEL.x, 0, EASEL.z);

  const leftFrontLeg = addPart(group, box, easelMaterial,
    -0.66, 1.25, 0.02, 0.18, 2.9, 0.18);
  leftFrontLeg.name = 'coloring-easel-upright-left';
  leftFrontLeg.rotation.z = -0.15;
  const rightFrontLeg = addPart(group, box, easelMaterial,
    0.66, 1.25, 0.02, 0.18, 2.9, 0.18);
  rightFrontLeg.name = 'coloring-easel-upright-right';
  rightFrontLeg.rotation.z = 0.15;
  const rearLeg = addPart(group, box, easelMaterial,
    0, 1.17, -0.55, 0.18, 2.72, 0.18);
  rearLeg.name = 'coloring-easel-upright-rear';
  rearLeg.rotation.x = 0.28;

  // The shelf keeps the same 1% overlap at the lower edge, but follows the
  // sheet forward so it still reads as the support rather than a rail behind it.
  const shelf = addPart(group, box, easelMaterial,
    0, 0.86, PAPER_PLANE_Z + 0.09, 1.95, 0.18, 0.38);
  shelf.name = 'coloring-easel-shelf';

  // The paper and its painted line-art overlay share one tilted frame. Their
  // tiny local depth separation avoids z-fighting without ever changing the
  // plane angle independently.
  const canvasGroup = new THREE.Group();
  canvasGroup.name = 'coloring-easel-canvas';
  canvasGroup.position.set(0, PAPER_CENTRE_Y, PAPER_PLANE_Z);
  canvasGroup.rotation.x = -0.08;
  group.add(canvasGroup);
  const paper = addPart(canvasGroup, plane, paperMaterial, 0, 0, 0, PAPER_SIZE, PAPER_SIZE, 1);
  paper.name = 'coloring-easel-paper';
  const art = addPart(canvasGroup, plane, artMaterial, 0, 0, 0.015, PAPER_SIZE, PAPER_SIZE, 1);
  art.name = 'coloring-easel-art';

  return { group, canvasGroup, paper, art, shelf, uprights: [leftFrontLeg, rightFrontLeg, rearLeg] };
}

/**
 * Readiness may come and go with the paint, and so may its celebration.
 *
 * Edge-triggered on below-full -> full, so holding at full power cannot replay
 * the cue every stroke or every frame. It re-arms the moment readiness is lost:
 * a child who erases their liked colour and paints it back has finished the
 * picture a second time, and the invitation to press Done should say so again.
 * (This reverses the earlier once-per-round rule — see DESIGN_DECISIONS.)
 */
export function createCompletionReadiness() {
  let celebrated = false;
  return {
    update(value) {
      const ready = value >= 1;
      if (!ready) celebrated = false;
      const celebrate = ready && !celebrated;
      if (celebrate) celebrated = true;
      return { ready, celebrate };
    },
    reset() { celebrated = false; },
  };
}

/** Registry order is the easel's order, so newly registered subjects join automatically. */
export function subjectAfter(subject) {
  const index = SUBJECTS.indexOf(subject);
  return SUBJECTS[index < 0 || index === SUBJECTS.length - 1 ? 0 : index + 1] ?? null;
}

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
  /**
   * The close-up and the room preview deliberately have separate identities.
   *
   * Both start on the familiar default; after a creation comes alive, the room
   * pages forward while the completed subject remains available to its puppet.
   */
  let activeSubject = subjectById(DEFAULT_SUBJECT_ID);
  let previewSubject = subjectById(DEFAULT_SUBJECT_ID);
  let roundsStarted = 0;

  let world = null;
  let player = null;
  let easelGroup = null;
  let easelArtCanvas = null;
  let easelArtTexture = null;
  let easelArtMaterial = null;
  let roomOverlay = null;
  let roomInstruction = null;
  let actionButton = null;
  let nextButton = null;
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
  let doneButton = null;
  let bubble = null;
  let bubbleAnswer = null;
  let bubbleSpeaker = null;
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
  let pendingMember = null;
  let lastLandAt = -Infinity;

  /** The sheet on the easel: 'blank' | 'fading' | 'ready' | 'finished'. */
  let easelArt = 'ready';
  let easelArtTimer = 0;
  /** Rolled once per blank sheet, so the room does not feel metronomic. */
  let blankDelay = BLANK_DELAY_MIN;

  let answerRemaining = 0;
  let chargeRemaining = 0;
  let stirRemaining = 0;
  let exitElapsed = 0;
  let holdRemaining = 0;
  let finishRemaining = 0;
  let acceptedAnswer = null;
  let finishCalled = false;
  /** Three pulses at about half a second each, then Done rests bright. */
  const READY_PULSE_MS = 1600;
  const completionReadiness = createCompletionReadiness();
  /** Set when full power arrives mid-drag; spent the moment the brush lifts. */
  let celebrationPending = false;
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
      .coloring-room-ui__next { position: absolute; left: 50%; bottom: 6.25rem;
        transform: translateX(-50%); min-width: calc(8rem * var(--ui-scale, 1));
        min-height: calc(3.2rem * var(--ui-scale, 1)); padding: .55rem 1rem;
        pointer-events: auto; border: .22rem solid #fff; border-radius: 1.2rem;
        background: #ed9b4a; color: #fff; box-shadow: 0 .32rem 0 rgb(32 49 75 / .28);
        font: 900 calc(1.05rem * var(--ui-scale, 1)) system-ui, sans-serif; cursor: pointer; }
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
        padding-inline: 6.5rem; text-align: center; }
      .coloring-screen__instruction { min-width: min(90vw, 24rem); margin: 0;
        font-size: calc(1.05rem * var(--ui-scale, 1)); font-weight: 800; }
      /* A grid, not a flex row. A flex line shorter than its content overflows
         both ways, which put the tool buttons on top of the title at 760x420
         and slid the lower palette rows under the bottom bar. */
      .coloring-screen__work { min-height: 0; min-width: 0; overflow: hidden;
        display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
        align-items: center; justify-items: center; gap: clamp(.6rem, 1.6vw, 1.2rem); }
      .coloring-side { display: flex; flex-direction: column; gap: .5rem; align-items: center; }
      /* Nothing but the drawing until the robot has spoken. The tools are a
         distraction from the one thing the child is here to say. */
      .coloring-screen[data-stage="asking"] .coloring-side,
      .coloring-screen[data-stage="asking"] .coloring-power,
      .coloring-screen[data-stage="asking"] .coloring-tools { visibility: hidden; }
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
      .coloring-tool--done { min-width: 7rem; background: #248a68; font-weight: 950;
        box-shadow: 0 .28rem 0 rgb(18 85 63 / .35); }
      /* Below full power Done must look plainly unavailable — no glow, no
         pulse, nothing to tease a child into pressing what cannot work yet. */
      .coloring-tool--done:disabled { background: #9eb5ac; color: #edf2ef; box-shadow: none; }
      /* Done is only ever enabled at full power, so this IS the full-power
         state: brighter, ringed in gold, lifted and a little larger than the
         two utility buttons beside it. Transform only, so Undo and the eraser
         never shift under the child's hand. */
      .coloring-tool--done:not(:disabled) {
        background: #16a06f; border-color: #ffe9a8;
        box-shadow: 0 .3rem 0 rgb(14 74 54 / .45), 0 0 0 .22rem rgb(255 191 47 / .85);
        transform: scale(1.06); }
      /* A star, not an emoji: ✨ renders as a dark monochrome glyph on this
         green and reads as a smudge at tool size. */
      .coloring-tool--done:not(:disabled)::after {
        content: '★'; margin-left: .38rem; color: #ffd166; }
      /* Three clear pulses, then it settles. Never a loop: an invitation that
         never stops asking becomes noise the child paints straight past. */
      .coloring-tool--ready-pulse {
        animation: coloring-done-ready .52s cubic-bezier(.2,.9,.3,1.25) 3; }
      @keyframes coloring-done-ready {
        0%, 100% { transform: scale(1.06); }
        45% { transform: translateY(-.3rem) scale(1.14); filter: brightness(1.15); }
      }
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
        display: flex; align-items: center; justify-content: center; gap: .35rem;
        font-size: calc(1.15rem * var(--ui-scale, 1)); font-weight: 900; text-align: center;
        animation: coloring-bubble-in .3s cubic-bezier(.2,.9,.3,1.3) 1; }
      .coloring-bubble[hidden] { display: none; }
      /* The bubble sits ON the picture and now stays there for the whole of
         coloring, so it must not eat the brush. It used to vanish after 2.35s,
         before painting even began; persistent, it silently made the paper
         under it unpaintable — and at 760x420 that includes part of the head. */
      .coloring-bubble { pointer-events: none; }
      .coloring-bubble__speaker { pointer-events: auto;
        flex: 0 0 auto; width: 2rem; height: 2rem; padding: 0;
        border: .14rem solid #273858; border-radius: 50%; background: #fff2c9;
        font-size: 1rem; line-height: 1; cursor: pointer; }
      .coloring-bubble--speaking { animation: coloring-speak .5s ease-in-out 1; }
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
      .coloring-screen__bottom { display: flex; justify-content: center; align-items: center; }
      /* ROBOT POWER. No number on it: a child reads a filling bar, and a
         percentage invites them to treat it as a mark. */
      .coloring-power { justify-self: start; width: 4.8rem; height: min(78%, 24rem);
        min-height: 10rem; display: flex; flex-direction: column; align-items: center; gap: .2rem; }
      .coloring-power__icon { font-size: 1.35rem; line-height: 1; }
      .coloring-power__label { font: 900 calc(.95rem * var(--ui-scale, 1)) system-ui, sans-serif;
        letter-spacing: .04em; text-align: center; line-height: 1.05; }
      .coloring-power__track { position: relative; display: block; flex: 1 1 auto;
        width: 2rem; min-height: 5rem; overflow: hidden; box-sizing: border-box;
        border: .2rem solid #273858; border-radius: 999px;
        background: #e7dfd0; box-shadow: inset 0 .12rem .3rem rgb(39 56 88 / .18); }
      .coloring-power__fill { position: absolute; left: 0; right: 0; bottom: 0; display: block;
        height: 0; border-radius: 999px; background: linear-gradient(0deg, #62c46b, #f2c53d 65%, #ffae2e);
        transition: height .18s ease-out; }
      .coloring-power--full .coloring-power__fill {
        background: linear-gradient(0deg, #ffd34d, #fff2b0, #ffd34d); }
      .coloring-power--pulse { animation: coloring-power-pulse .6s ease-out 1; }
      @keyframes coloring-power-pulse {
        0%, 100% { transform: none; filter: none; }
        45% { transform: scale(1.035); filter: brightness(1.22); }
      }
      /* The robot stirring as it charges: one short warm flare on the page. */
      .coloring-canvas-wrap--spark { animation: coloring-spark .7s ease-out 1; }
      @keyframes coloring-spark {
        0%, 100% { box-shadow: 0 .55rem 0 rgb(39 56 88 / .18); }
        40% { box-shadow: 0 .55rem 0 rgb(39 56 88 / .18), 0 0 2rem .5rem rgb(255 231 140 / .9); }
      }
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
      @media (max-width: 46rem) {
        .coloring-screen__instruction { font-size: calc(.9rem * var(--ui-scale, 1)); }
      }
      /* Short or narrow: controls span a compact first row, while the canvas and
         vertical meter keep the same balanced painting row. Collapsing all three
         into one column put ROBOT POWER below the picture at 760x420; positioning
         it absolutely could not follow a canvas whose size comes from height. */
      @media (max-width: 46rem), (max-height: 34rem) {
        .coloring-screen { padding: .45rem; gap: .35rem; }
        .coloring-screen__work { grid-template-rows: auto minmax(0, 1fr); gap: .35rem; }
        .coloring-side { grid-column: 1 / -1; grid-row: 1; }
        .coloring-canvas-wrap { grid-column: 2; grid-row: 2; }
        .coloring-power { grid-column: 3; grid-row: 2; height: min(100%, 14rem);
          min-height: 7rem; }
        .coloring-side { flex-direction: row; gap: .35rem; }
        .coloring-palette { grid-template-columns: repeat(7, auto); gap: .3rem; padding: .3rem; }
        .coloring-brushes { padding: .28rem; gap: .25rem; }
        .coloring-brush { width: 2.3rem; height: 2.3rem; }
        .coloring-swatch { width: 2.8rem; height: 2.8rem; border-width: .22rem; }
        .coloring-tool { min-width: 4.2rem; min-height: 2.5rem; font-size: calc(.85rem * var(--ui-scale, 1)); }
        .coloring-canvas-wrap { padding: .3rem; border-width: .22rem; }
        .coloring-bubble { font-size: calc(.95rem * var(--ui-scale, 1)); padding: .35rem .6rem; }
        /* Wrapping, not nowrap. The label was ロボットパワー, which is wider than
           the 4.8rem column: holding it on one line overflowed both sides and
           clipped the leading ロ off under the picture. It reads POWER now that
           the page is not always a robot, which fits — but the wrap stays,
           because the label is translatable and the next one may not. */
        .coloring-power__label { font-size: calc(.8rem * var(--ui-scale, 1)); }
        .coloring-power__track { width: 1.6rem; }
      }
      @media (prefers-reduced-motion: reduce) {
        .coloring-palette--invite .coloring-swatch { animation: none; }
        .coloring-canvas-wrap--alive { animation-duration: .5s; }
        .coloring-canvas-wrap--spark, .coloring-power--pulse,
        .coloring-canvas-wrap--speaking, .coloring-bubble { animation: none; }
        /* No three pulses here. Done still arrives bright, ringed and raised —
           that state is plain CSS, so the invitation survives without motion. */
        .coloring-tool--ready-pulse { animation: none; }
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
      <button class="coloring-room-ui__next" type="button">つぎ ▶</button>
      <button class="coloring-room-ui__action" type="button" hidden></button>
    `;
    roomOverlay.querySelector('h1').textContent = STRINGS.roomName;
    roomInstruction = roomOverlay.querySelector('p');
    roomInstruction.textContent = STRINGS.roomHint;
    nextButton = roomOverlay.querySelector('.coloring-room-ui__next');
    nextButton.addEventListener('pointerdown', preventNextFocus);
    nextButton.addEventListener('click', pressNextSubject);
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
  function drawEaselArt(subject, paint = null) {
    if (!subject) return;
    const size = easelArtCanvas.width;
    const art = easelArtCanvas.getContext('2d');
    art.clearRect(0, 0, size, size);
    drawBlankBody(art, { subject, size });
    if (paint) art.drawImage(paint, 0, 0, size, size);
    drawLineArt(art, { subject, size });
    easelArtTexture.needsUpdate = true;
  }

  function setEaselArt(state, { paint = null, subject = null } = {}) {
    easelArt = state;
    easelArtTimer = 0;
    if (state === 'blank') {
      blankDelay = BLANK_DELAY_MIN + Math.random() * BLANK_DELAY_SPAN;
      easelArtMaterial.opacity = 0;
      return;
    }
    const easelSubject = subject ?? (state === 'finished'
      ? activeSubject
      : previewSubject ?? activeSubject);
    drawEaselArt(easelSubject, paint);
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

    const roomLeft = -ROOM_WIDTH / 2;
    const roomRight = ROOM_WIDTH / 2;
    const backWallZ = -ROOM_DEPTH / 2 + WALL_THICKNESS / 2;
    const wallCentreY = WALL_HEIGHT / 2;
    const sideWallX = ROOM_WIDTH / 2 - WALL_THICKNESS / 2;
    const doorLeft = DOOR.x - DOOR_WIDTH / 2;
    const doorRight = DOOR.x + DOOR_WIDTH / 2;
    const leftWallWidth = doorLeft - roomLeft;
    const rightWallWidth = roomRight - doorRight;
    const leftWallX = roomLeft + leftWallWidth / 2;
    const rightWallX = doorRight + rightWallWidth / 2;
    const lintelHeight = WALL_HEIGHT - DOOR_HEIGHT;
    const trimY = TRIM_HEIGHT / 2;
    const backTrimZ = backWallZ + WALL_THICKNESS / 2 + TRIM_DEPTH / 2;
    const sideTrimX = sideWallX - WALL_THICKNESS / 2 - TRIM_DEPTH / 2;

    addPart(world, box, floorMaterial, 0, -FLOOR_THICKNESS / 2, 0,
      ROOM_WIDTH, FLOOR_THICKNESS, ROOM_DEPTH);
    // One shared top height, with the back wall split around the doorway. The
    // full-width back span overlaps both side walls by WALL_THICKNESS.
    addPart(world, box, wallMaterial, leftWallX, wallCentreY, backWallZ,
      leftWallWidth, WALL_HEIGHT, WALL_THICKNESS);
    addPart(world, box, wallMaterial, rightWallX, wallCentreY, backWallZ,
      rightWallWidth, WALL_HEIGHT, WALL_THICKNESS);
    // The lintel overlaps both spans instead of abutting them. Meeting exactly
    // at doorLeft/doorRight left a hairline seam running from the door's head
    // to the ceiling on each side — two faint vertical lines, clearly visible
    // in a room screenshot and invisible to every test. It sits above the
    // opening, so widening it costs the doorway nothing.
    addPart(world, box, wallMaterial, DOOR.x, DOOR_HEIGHT + lintelHeight / 2, backWallZ,
      DOOR_WIDTH + WALL_THICKNESS, lintelHeight, WALL_THICKNESS);
    addPart(world, box, wallMaterial, -sideWallX, wallCentreY, 0,
      WALL_THICKNESS, WALL_HEIGHT, ROOM_DEPTH);
    addPart(world, box, wallMaterial, sideWallX, wallCentreY, 0,
      WALL_THICKNESS, WALL_HEIGHT, ROOM_DEPTH);
    addPart(world, box, trimMaterial, leftWallX, trimY, backTrimZ,
      leftWallWidth, TRIM_HEIGHT, TRIM_DEPTH);
    addPart(world, box, trimMaterial, rightWallX, trimY, backTrimZ,
      rightWallWidth, TRIM_HEIGHT, TRIM_DEPTH);
    addPart(world, box, trimMaterial, -sideTrimX, trimY, 0,
      TRIM_DEPTH, TRIM_HEIGHT, ROOM_DEPTH - WALL_THICKNESS * 2);
    addPart(world, box, trimMaterial, sideTrimX, trimY, 0,
      TRIM_DEPTH, TRIM_HEIGHT, ROOM_DEPTH - WALL_THICKNESS * 2);

    // The way out: a plain doorway in the back wall with dark beyond it. This
    // is the only thing in the room that is not the easel, and the only action
    // that ends the session.
    const doorwayZ = backWallZ - WALL_THICKNESS / 4;
    const frameZ = backWallZ + WALL_THICKNESS / 2 + DOOR_FRAME_DEPTH / 2;
    addPart(world, box, makeMaterial(0x2b2334), DOOR.x, DOOR_HEIGHT / 2, doorwayZ,
      DOOR_WIDTH, DOOR_HEIGHT, WALL_THICKNESS / 2);
    addPart(world, box, woodMaterial, DOOR.x,
      DOOR_HEIGHT + DOOR_JAMB_WIDTH / 2, frameZ,
      DOOR_WIDTH + DOOR_JAMB_WIDTH * 2, DOOR_JAMB_WIDTH, DOOR_FRAME_DEPTH);
    addPart(world, box, woodMaterial, doorLeft - DOOR_JAMB_WIDTH / 2,
      DOOR_HEIGHT / 2, frameZ,
      DOOR_JAMB_WIDTH, DOOR_HEIGHT, DOOR_FRAME_DEPTH);
    addPart(world, box, woodMaterial, doorRight + DOOR_JAMB_WIDTH / 2,
      DOOR_HEIGHT / 2, frameZ,
      DOOR_JAMB_WIDTH, DOOR_HEIGHT, DOOR_FRAME_DEPTH);

    // ONE easel, in the middle of the room, and the room is built around it.
    easelArtCanvas = document.createElement('canvas');
    easelArtCanvas.width = 700;
    easelArtCanvas.height = 700;
    easelArtTexture = ownCanvasTexture(easelArtCanvas);
    easelArtMaterial = ownMaterial(new THREE.MeshBasicMaterial({
      map: easelArtTexture, transparent: true, opacity: 1, depthWrite: false,
    }));
    const easel = buildColoringEasel({
      box,
      plane,
      easelMaterial,
      paperMaterial,
      artMaterial: easelArtMaterial,
    });
    easelGroup = easel.group;
    world.add(easelGroup);
    setEaselArt('ready');

    player = characters.create({ model: characters.playerModel });
    player.position.set(EASEL.x, 0, PLAYER_REVEAL_Z);
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

  function preventNextFocus(event) {
    event.preventDefault();
  }

  function pressNextSubject() {
    if (active && phase === 'room') {
      previewSubject = subjectAfter(previewSubject ?? activeSubject);
      setEaselArt('ready', { subject: previewSubject });
      audio.playSfx('interact');
    }
    // Space belongs to the easel action, even immediately after a pointer click.
    nextButton?.blur();
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
    flash(bubble, 'coloring-bubble--speaking', 520);
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
    bubbleAnswer.textContent = answerSentence;
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
    updateReadiness(coverage.power());
  }

  function selectColor(color) {
    if (phase !== 'coloring') return;
    selectedColor = color;
    erasing = false;
    palette.classList.remove('coloring-palette--invite');
    refreshTools();
    updateReadiness(coverage.power());
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

  function resetArtwork() {
    // Undo every stroke rather than clearing two things separately: the paint
    // and the coverage grid must never disagree about what has been coloured.
    while (surface?.canUndo) surface.undo();
    coverage?.reset();
    setPower(0);
    refreshTools();
    updateReadiness(0);
  }

  /** The ⚡ meter. No number: a child reads a filling battery, not a percentage. */
  function setPower(value) {
    if (!powerFill) return;
    const clamped = Math.min(1, Math.max(0, value));
    powerFill.style.height = `${(clamped * 100).toFixed(1)}%`;
    powerBar.setAttribute('aria-valuenow', String(Math.round(clamped * 100)));
    powerBar.classList.toggle('coloring-power--full', clamped >= 1);
  }

  /** Readiness follows the live artwork; each fresh arrival at full is celebrated. */
  function updateReadiness(value, { strokeActive = false } = {}) {
    if (!doneButton) return;
    const { ready, celebrate } = completionReadiness.update(value);
    doneButton.disabled = !ready;
    // `disabled` already stops the press; `aria-disabled` is what a screen
    // reader announces while the button stays in the tab order's shape.
    doneButton.setAttribute('aria-disabled', String(!ready));
    if (phase === 'coloring') {
      paintInstruction.textContent = ready
        ? STRINGS.readyHint
        : selectedColor ? STRINGS.paintHint : STRINGS.chooseColor;
    }
    if (celebrate) celebrationPending = true;
    // Full power almost always arrives in the middle of a drag, and a button
    // jumping about under a moving brush is exactly the distraction a child
    // painting does not need. Hold the cue until the brush lifts.
    if (!celebrationPending || strokeActive) return;
    celebrationPending = false;
    playReadyCue();
  }

  /**
   * The moment the picture is finished: the meter flares, the robot blinks, and
   * Done pulses three times before settling into its bright resting state.
   *
   * About 1.6s in total. It is an invitation, not a transition — nothing is
   * locked, and the child may keep painting straight through it.
   */
  function playReadyCue() {
    flash(powerBar, 'coloring-power--pulse', 620);
    flash(doneButton, 'coloring-tool--ready-pulse', READY_PULSE_MS);
    blinkOnce(1);
    audio.playSfx('spark', SOUNDS.spark);
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

  /** Answers the surface after every stroke: the meter, tools and live readiness. */
  function onPaintChanged(info) {
    setPower(info.power);
    updateReadiness(info.power, { strokeActive: info.strokeActive === true });
    if (info.needsColor) {
      paintInstruction.textContent = STRINGS.chooseColor;
      flash(palette, 'coloring-palette--invite', 1600);
      return;
    }
    if (undoButton) undoButton.disabled = !info.canUndo;
    if (info.milestone) fireMilestone(info.milestone);
  }

  function finishArtwork() {
    if (phase !== 'coloring' || coverage.power() < 1) return;
    beginCharging();
  }

  function onBubbleSpeakerClick(event) {
    replayAnswer();
    if (event.detail > 0) event.currentTarget.blur();
  }

  function createPaintingOverlay() {
    paintingOverlay = document.createElement('section');
    paintingOverlay.className = 'coloring-screen';
    // Nothing but the drawing and the question until the robot has answered.
    paintingOverlay.dataset.stage = 'asking';
    paintingOverlay.innerHTML = `
      <header class="coloring-screen__top"><p class="coloring-screen__instruction"></p></header>
      <div class="coloring-screen__work">
        <div class="coloring-side">
          <div class="coloring-palette" role="group"></div>
          <div class="coloring-brushes" role="group"></div>
        </div>
        <div class="coloring-canvas-wrap">
          <canvas class="coloring-canvas"></canvas>
          <div class="coloring-bubble" role="status" aria-live="polite" hidden>
            <span class="coloring-bubble__answer"></span>
            <button class="coloring-bubble__speaker" type="button">🔊</button>
          </div>
        </div>
        <div class="coloring-power" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
          <span class="coloring-power__icon" aria-hidden="true">⚡</span>
          <span class="coloring-power__track"><span class="coloring-power__fill"></span></span>
          <span class="coloring-power__label"></span>
        </div>
      </div>
      <div class="coloring-screen__bottom">
        <div class="coloring-tools">
          <button class="coloring-tool coloring-tool--undo" type="button" disabled></button>
          <button class="coloring-tool coloring-tool--eraser" type="button" aria-pressed="false"></button>
          <button class="coloring-tool coloring-tool--done" type="button" disabled></button>
        </div>
      </div>
    `;
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
    paintingCanvas.setAttribute('aria-label', STRINGS.canvasLabel);
    bubble = paintingOverlay.querySelector('.coloring-bubble');
    bubbleAnswer = paintingOverlay.querySelector('.coloring-bubble__answer');
    bubbleSpeaker = paintingOverlay.querySelector('.coloring-bubble__speaker');
    // Words only, not `UI.listenAgain`: that string leads with a 🔊 the button
    // already shows, so a screen reader announced the speaker twice.
    bubbleSpeaker.setAttribute('aria-label', UI.dialogue.replay);
    bubbleSpeaker.title = UI.dialogue.replay;
    bubbleSpeaker.addEventListener('click', onBubbleSpeakerClick);

    powerBar = paintingOverlay.querySelector('.coloring-power');
    powerBar.querySelector('.coloring-power__label').textContent = STRINGS.power;
    powerFill = paintingOverlay.querySelector('.coloring-power__fill');

    undoButton = paintingOverlay.querySelector('.coloring-tool--undo');
    undoButton.textContent = STRINGS.tools.undo;
    undoButton.addEventListener('click', undo);
    eraserButton = paintingOverlay.querySelector('.coloring-tool--eraser');
    eraserButton.textContent = STRINGS.tools.eraser;
    eraserButton.setAttribute('aria-label', STRINGS.tools.eraserLabel);
    eraserButton.addEventListener('click', toggleEraser);
    doneButton = paintingOverlay.querySelector('.coloring-tool--done');
    doneButton.textContent = STRINGS.tools.done;
    doneButton.addEventListener('click', finishArtwork);

    document.querySelector('#ui-layer').append(paintingOverlay);
    surface = createPaintingSurface({
      subject: activeSubject,
      canvas: paintingCanvas,
      coverage,
      color: () => selectedColor,
      brush: () => brushId,
      erasing: () => erasing,
      // Full power is permission, not a lock: only leaving `coloring` freezes
      // the surface, so the child can keep decorating until they choose Done.
      locked: () => phase !== 'coloring',
      onChange: onPaintChanged,
    });
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
  function startRound(subject = activeSubject) {
    activeSubject = subject ?? subjectById(DEFAULT_SUBJECT_ID);
    roundsStarted += 1;
    replayed = false;
    answerSentence = '';
    selectedColor = null;
    erasing = false;
    answerRemaining = 0;
    chargeRemaining = 0;
    stirRemaining = 0;
    exitElapsed = 0;
    completionReadiness.reset();
    celebrationPending = false;
    favourite = PALETTE[Math.floor(Math.random() * PALETTE.length)];
    coverage = createCoverage({ subject: activeSubject, favourite });
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
      const subject = previewSubject ?? activeSubject ?? subjectById(DEFAULT_SUBJECT_ID);
      activeSubject = subject;
      setEaselArt('ready', { subject });
      startRound(subject);
    });
    if (!changed && active && phase === 'to-canvas') phase = 'room';
  }

  /**
   * The child has declared the page finished after earning full power.
   *
   * The charging beat comes first: a strong pulse, a couple of blinks and a
   * spark on the page, so the child sees the robot stirring before anything
   * moves.
   */
  function beginCharging() {
    if (phase !== 'coloring') return;
    phase = 'activation-page';
    bubble.hidden = true;
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

    // Both consumers copy the live paint before teardown: the puppet into its
    // piece textures, and the session store into one detached canvas.
    pendingMember = crowd.join();
    pendingPuppet = createPaperPuppet({ subject: activeSubject, paint: surface.paint, onLand: landTap });
    saveCompletedCreation({
      subjectId: activeSubject.id,
      artwork: surface.paint,
      crowd: pendingMember,
    });
    setEaselArt('finished', { paint: surface.paint });

    world.visible = true;
    roomOverlay.hidden = true;
    player.position.set(EASEL.x, 0, PLAYER_REVEAL_Z);
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
    pendingPuppet.placeAt(EASEL.x, EASEL.z + PUPPET_START_Z, 0);
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
   * 1.30       lands and taps; room-reveal then holds this framing for 1.2s
   */
  function updateRobotExit(dt) {
    exitElapsed += dt;
    const puppet = pendingPuppet;
    const startLift = PAPER_CENTRE_Y - PAPER_SIZE / 2;
    const retreatProgress = Math.min(1, exitElapsed / PLAYER_RETREAT_SECONDS);
    const retreatEase = 1 - (1 - retreatProgress) ** 3;
    player.position.z = PLAYER_REVEAL_Z
      + (PLAYER_RETREAT_Z - PLAYER_REVEAL_Z) * retreatEase;
    player.position.x = EASEL.x + (PLAYER_RETREAT_X - EASEL.x) * retreatEase;
    // Turn to watch it happen, rather than stepping aside still facing the wall.
    player.rotation.y = Math.PI - 0.5 * retreatEase;

    if (exitElapsed < 0.45) {
      // The page loses its drawing while the puppet is still against it.
      easelArtMaterial.opacity = Math.max(0, 1 - exitElapsed / 0.4);
    } else if (exitElapsed < 1.3) {
      if (easelArt !== 'blank') setEaselArt('blank');
      const k = (exitElapsed - 0.45) / 0.85;
      const arc = Math.sin(k * Math.PI) * 0.45;
      puppet.placeAt(EASEL.x, EASEL.z + PUPPET_START_Z
        + k * (ROBOT_LANDING_Z - (EASEL.z + PUPPET_START_Z)), 0);
      puppet.setLift(startLift * (1 - k) + arc);
    } else {
      puppet.setLift(0);
      if (puppet.state === STATES.STARTUP) {
        puppet.placeAt(EASEL.x, ROBOT_LANDING_Z, 0);
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
    const member = pendingMember;
    const from = {
      x: pendingPuppet.group.position.x,
      z: pendingPuppet.group.position.z,
    };
    pendingPuppet.startRoaming(member.points, { ...member, from });
    livingRobots.push({ id: member.id, puppet: pendingPuppet, member });
    pendingPuppet = null;
    pendingMember = null;

    cameraRig.setTarget(player).setPreset('follow', CAMERA.room);
    roomOverlay.hidden = false;
    roomInstruction.textContent = STRINGS.roomHint;
    // Force the label to be rewritten next frame, whatever it said last round.
    roomAction = undefined;
    setRoomAction(null);
    // The sheet is blank; a fresh drawing drifts onto it shortly, and the child
    // may interrupt that at any point.
    previewSubject = subjectAfter(activeSubject);
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
    doneButton?.removeEventListener('click', finishArtwork);
    bubbleSpeaker?.removeEventListener('click', onBubbleSpeakerClick);
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
    doneButton = null;
    bubble = null;
    bubbleAnswer = null;
    bubbleSpeaker = null;
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
      persistence: creationPersistenceStatus(),
      robotsCompleted: livingRobots.length,
      // The newborn during the cinematic, before it joins livingRobots. Without
      // it the hand-off from the authored landing to roaming is the one moment
      // no observer can see — which is precisely where a snap to a roam point
      // would hide.
      pending: pendingPuppet ? {
        x: pendingPuppet.group.position.x,
        y: pendingPuppet.group.position.y,
        z: pendingPuppet.group.position.z,
      } : null,
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
      previewSubjectId: previewSubject?.id ?? null,
      activeSubjectId: activeSubject?.id ?? null,
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
        // 24, not the default 6. Six points across the body catch a decoration
        // dab and little else on a sparsely painted robot, so two robots told
        // DIFFERENT colours collided on their shared red decoration alone and
        // the distinctness check cried wolf. Resolution, not semantics: this is
        // read only by the harness.
        art: robot.puppet.fingerprint(24),
      })),
    };
  }

  /** Dev tool. Fills the room without painting twenty robots by hand. */
  function spawnRobots(count = 10, paint = null) {
    if (!world) return 0;
    for (let i = 0; i < count; i += 1) {
      const member = crowd.join();
      const puppet = createPaperPuppet({
        subject: activeSubject,
        paint: paint ?? surface?.paint ?? null,
        onLand: landTap,
      });
      world.add(puppet.group);
      puppet.startRoaming(member.points, member);
      livingRobots.push({ id: member.id, puppet, member });
    }
    return livingRobots.length;
  }

  /** Rebuilds session robots from plain records after the room exists. */
  function restoreSavedRobots() {
    for (const record of savedCreations()) {
      const subject = subjectById(record.subjectId ?? DEFAULT_SUBJECT_ID);
      if (!subject) continue;
      const member = crowd.join(record.crowd);
      const puppet = createPaperPuppet({ subject, paint: record.artwork, onLand: landTap });
      world.add(puppet.group);
      puppet.startRoaming(member.points, member);
      livingRobots.push({ id: member.id, puppet, member });
    }
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
    if (devTools) {
      window.__eslDebug.coloringSpawn = spawnRobots;
      window.__eslDebug.coloringReset = resetArtwork;
    }
  }

  function removeDebugHook() {
    if (window.__eslDebug) {
      delete window.__eslDebug.coloring;
      delete window.__eslDebug.coloringSpawn;
      delete window.__eslDebug.coloringReset;
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
    pendingMember = null;
    crowd = createCrowd();
    installStyle();
    createRoomOverlay();
    // The room is built now so that the pull-back has something to reveal, but
    // it is not shown: the first thing the child sees is the drawing.
    buildWorld();
    restoreSavedRobots();
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
    nextButton?.removeEventListener('pointerdown', preventNextFocus);
    nextButton?.removeEventListener('click', pressNextSubject);
    disposePaintingOverlay();
    roomOverlay?.remove();
    style?.remove();

    // Every accumulated robot, and then the assets they were sharing. The
    // order matters: a puppet must not outlive the quad it draws with.
    for (const robot of livingRobots) robot.puppet.dispose();
    livingRobots.length = 0;
    pendingPuppet?.dispose();
    pendingPuppet = null;
    pendingMember = null;
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
    nextButton = null;
    roomAction = null;
    style = null;
    favourite = null;
    coverage = null;
  }

  return { id: 'coloring', enter, update, exit };
}
