/**
 * How the paper robot moves.
 *
 * Pure maths and pure data: no three.js, no canvas, no DOM. `paperPuppet.js`
 * builds the meshes and applies what this file computes, which is what lets the
 * hop, the squash limits and the roam route be tested without a renderer.
 *
 * It hops. It does not walk — see `.ai/coloring-robot-spec.md`: nine rigid
 * flat cut-outs attempting an articulated biped walk invite a comparison they
 * lose, while the same pieces hopping read as a hand-puppeted paper toy, which
 * is what they are.
 */

import { PIECES, PIVOTS, pieceBounds } from './robotDefinition.js';

export const STATES = Object.freeze({
  IDLE: 'idle',
  STARTUP: 'startup',
  HOP: 'hop',
  CELEBRATE: 'celebrate',
});

/** Seconds per cycle. A hop has to be slow enough to read as a hop. */
export const DURATIONS = Object.freeze({
  [STATES.IDLE]: 2.6,
  [STATES.STARTUP]: 1.15,
  [STATES.HOP]: 0.92,
  [STATES.CELEBRATE]: 0.46,
});

/**
 * The squash/stretch ceiling, as a fraction either side of 1.
 *
 * A piece group is scaled non-uniformly. The quads themselves are never bent —
 * no skeleton and no vertex deformation — so this is a paper toy flexing, and
 * 0.18 is about the limit before it starts reading as rubber.
 */
export const SQUASH_LIMIT = 0.18;

/** How much the widening axis compensates the shortening one. */
const COMPENSATION = 0.85;

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const lerp = (from, to, k) => from + (to - from) * k;
const wrap = (t) => ((t % 1) + 1) % 1;
const easeOut = (k) => Math.sin(k * Math.PI / 2);
const easeInOut = (k) => 0.5 - Math.cos(k * Math.PI) / 2;

/**
 * A non-uniform scale from one signed amount: positive squashes (shorter and
 * wider), negative stretches (taller and narrower).
 *
 * Deliberately only *partly* area-preserving. True preservation would need
 * `x = 1/y`, and 1/0.82 is 1.22 — outside the band the spec fixes — so the
 * widening axis compensates by 85%. Both axes stay inside 0.82..1.18 and the
 * apparent area never moves by more than a few percent, let alone a fifth.
 */
export function squashStretch(amount) {
  const a = clamp(amount, -1, 1);
  return {
    x: clamp(1 + a * SQUASH_LIMIT * COMPENSATION, 1 - SQUASH_LIMIT, 1 + SQUASH_LIMIT),
    y: clamp(1 - a * SQUASH_LIMIT, 1 - SQUASH_LIMIT, 1 + SQUASH_LIMIT),
  };
}

/** Phase boundaries of one hop, as fractions of the cycle. */
export const HOP_STAGES = Object.freeze({ crouch: 0.18, launch: 0.3, air: 0.7, land: 0.82 });

/** Apex of a hop and the dip of a crouch, in puppet heights. */
const HOP_HEIGHT = 0.5;
const CROUCH_DROP = 0.07;
const RECOVER_HEIGHT = 0.075;

/**
 * One hop, sampled.
 *
 * `height` is 0 at t=0 and again at t=1, so a hop leaves the puppet exactly
 * where it started vertically however many times it repeats. `squash` is
 * continuous across every stage boundary — a jump there reads as a glitch
 * rather than as weight.
 */
export function hopPhase(t) {
  const p = wrap(t);
  const { crouch, launch, air, land } = HOP_STAGES;

  if (p < crouch) {
    const k = p / crouch;
    return { stage: 'crouch', height: -CROUCH_DROP * easeOut(k), squash: 0.6 * easeOut(k) };
  }
  if (p < launch) {
    const k = (p - crouch) / (launch - crouch);
    return { stage: 'launch', height: lerp(-CROUCH_DROP, 0, easeOut(k)), squash: lerp(0.6, -0.5, k) };
  }
  if (p < air) {
    const k = (p - launch) / (air - launch);
    return {
      stage: 'air',
      height: HOP_HEIGHT * Math.sin(Math.PI * k),
      // Stretched off the ground, easing back towards neutral by the apex.
      squash: lerp(-0.5, -0.35, k),
    };
  }
  if (p < land) {
    const k = (p - air) / (land - air);
    // The impact: a sharp squash a third of the way in, then back to neutral.
    return {
      stage: 'land',
      height: -CROUCH_DROP * 0.75 * Math.sin(Math.PI * k),
      squash: k < 0.35 ? lerp(-0.35, 0.7, k / 0.35) : lerp(0.7, 0, (k - 0.35) / 0.65),
    };
  }
  const k = (p - land) / (1 - land);
  return {
    stage: 'recover',
    height: RECOVER_HEIGHT * Math.sin(Math.PI * k),
    squash: -0.18 * Math.sin(Math.PI * k),
  };
}

/** How far through this hop's forward travel, 0..1. Most of it happens airborne. */
export function hopProgress(t) {
  const p = wrap(t);
  const { crouch, launch, air, land } = HOP_STAGES;
  if (p < crouch) return 0;
  if (p < launch) return 0.08 * ((p - crouch) / (launch - crouch));
  if (p < air) return lerp(0.08, 0.93, easeInOut((p - launch) / (air - launch)));
  if (p < land) return lerp(0.93, 1, (p - air) / (land - air));
  return 1;
}

/** How airborne the puppet is, 0..1 — drives the tilt and the limb flare. */
const airborneness = (height) => clamp(height / HOP_HEIGHT, 0, 1);

/** A blink, from a slow irregular-looking cycle. Closed for a tenth of a second. */
export function blinkAt(seconds) {
  const cycle = wrap(seconds / 3.7);
  return cycle > 0.972 ? 1 : 0;
}

const NO_ROTATION = Object.freeze(Object.fromEntries(PIECES.map((piece) => [piece, 0])));

/**
 * A pose: where the whole puppet sits, and how far each piece has turned.
 *
 * `root.tilt` and every rotation are radians. `scale` is the squash/stretch
 * applied to the puppet as a whole; individual limb scaling would fight the
 * shared pivots for no visible gain.
 */
function pose(overrides = {}) {
  return {
    root: { x: 0, y: 0, tilt: 0, scale: { x: 1, y: 1 }, ...overrides.root },
    rotations: { ...NO_ROTATION, ...overrides.rotations },
    blink: overrides.blink ?? 0,
    glow: overrides.glow ?? 0,
    progress: overrides.progress ?? 0,
    // Which part of a hop this is, or null when the state is not hopping.
    // Carried on the pose so the renderer can notice the touchdown and make a
    // paper-tap sound without keeping a second clock of its own.
    stage: overrides.stage ?? null,
  };
}

/**
 * Limbs during a hop, deliberately loose.
 *
 * Arms flare outward, legs spread a little in the air, and the forearms and the
 * antenna are sampled from *earlier* in the cycle so they trail the piece they
 * hang from. That lag is the whole reason this reads as a puppet rather than a
 * rigid sprite being moved up and down.
 */
function hopRotations(t, flare = 1) {
  const here = airborneness(hopPhase(t).height);
  const lagged = airborneness(hopPhase(t - 0.09).height);
  const trail = airborneness(hopPhase(t - 0.16).height);

  const arm = (0.16 + 0.95 * here) * flare;
  const forearm = (0.1 + 0.7 * lagged) * flare;
  const leg = 0.2 * here * flare;

  return {
    head: -0.05 * here,
    antenna: 0.34 * trail * flare,
    torso: 0,
    leftUpperArm: -arm,
    leftForearm: -forearm,
    rightUpperArm: arm,
    rightForearm: forearm,
    leftLeg: -leg,
    rightLeg: leg,
  };
}

/**
 * The pose for a state at time `t` seconds into it.
 *
 * One function, four states, no state-machine framework — the spec asks for
 * simple and readable over general.
 */
export function poseFor(state, t = 0) {
  const seconds = Math.max(0, t);

  if (state === STATES.IDLE) {
    const cycle = seconds / DURATIONS[STATES.IDLE];
    const bob = Math.sin(cycle * Math.PI * 2);
    return pose({
      root: {
        x: Math.sin(cycle * Math.PI) * 0.06,
        y: 0.018 * bob,
        tilt: 0.035 * Math.sin(cycle * Math.PI * 2 + 0.6),
        scale: squashStretch(-0.06 * bob),
      },
      rotations: {
        head: 0.03 * Math.sin(cycle * Math.PI * 2 + 1.1),
        antenna: 0.16 * Math.sin(cycle * Math.PI * 2 * 1.35),
        leftUpperArm: -0.07 - 0.04 * bob,
        rightUpperArm: 0.07 + 0.04 * bob,
        leftForearm: -0.05 - 0.03 * bob,
        rightForearm: 0.05 + 0.03 * bob,
      },
      blink: blinkAt(seconds),
    });
  }

  if (state === STATES.STARTUP) {
    const k = clamp(seconds / DURATIONS[STATES.STARTUP], 0, 1);
    // An anticipatory shake that tightens, then one bounce as it wakes up.
    const shake = Math.sin(seconds * 34) * 0.055 * (1 - k) ** 0.7;
    const bounce = k > 0.62 ? Math.sin((k - 0.62) / 0.38 * Math.PI) : 0;
    // A twitch, which means it returns: leaving the arms flung out at the end
    // made a visible snap the moment the roam loop's idle pose took over.
    const flare = k > 0.45 ? Math.sin(((k - 0.45) / 0.55) * Math.PI) : 0;
    return pose({
      root: {
        x: shake,
        y: 0.3 * bounce,
        tilt: shake * 0.8,
        scale: squashStretch(0.35 * (1 - k) - 0.55 * bounce),
      },
      rotations: {
        head: -0.06 * bounce,
        antenna: 0.5 * bounce + shake * 3,
        leftUpperArm: -(0.1 + 1.0 * flare),
        rightUpperArm: 0.1 + 1.0 * flare,
        leftForearm: -0.75 * flare,
        rightForearm: 0.75 * flare,
      },
      // Powering up: the glow leads the movement.
      glow: easeOut(clamp(k / 0.7, 0, 1)),
      blink: k > 0.2 && k < 0.3 ? 1 : 0,
    });
  }

  const celebrating = state === STATES.CELEBRATE;
  const duration = DURATIONS[celebrating ? STATES.CELEBRATE : STATES.HOP];
  const cycle = seconds / duration;
  const phase = hopPhase(cycle);
  const flare = celebrating ? 1.45 : 1;

  return pose({
    root: {
      y: phase.height,
      tilt: 0.24 * airborneness(phase.height) * (celebrating ? 0.4 : 1),
      scale: squashStretch(phase.squash),
    },
    rotations: hopRotations(cycle, flare),
    blink: celebrating ? 0 : blinkAt(seconds),
    glow: celebrating ? 0.6 : 0.25,
    progress: hopProgress(cycle),
    stage: phase.stage,
  });
}

/** Every rotation a pose can carry names a real puppet piece. */
export const poseRotationKeys = () => Object.keys(NO_ROTATION);

// --- where it hops ---------------------------------------------------------

/**
 * The floor the puppet is allowed onto: the open part of the atelier, well
 * clear of the walls. The obstacle discs match `canOccupy` in `index.js`, with
 * the artist added — a paper robot hopping through the NPC looks like a bug.
 */
export const SAFE_AREA = Object.freeze({ minX: -4.6, maxX: 4.6, minZ: -3.6, maxZ: 3.6 });
export const OBSTACLES = Object.freeze([
  Object.freeze({ x: 3.6, z: 1.5, radius: 1.9 }),   // the art table
  Object.freeze({ x: -3.05, z: -2.65, radius: 1.5 }), // the easel
  Object.freeze({ x: 0, z: -2.25, radius: 1.3 }),   // the artist
]);

/** A handful of authored points. No pathfinding, and no AI — the spec says so. */
export const ROAM_POINTS = Object.freeze([
  Object.freeze({ x: -1.9, z: 0.6 }),
  Object.freeze({ x: -3.4, z: 1.9 }),
  Object.freeze({ x: -1.2, z: 2.6 }),
  Object.freeze({ x: 1.3, z: 1.6 }),
  Object.freeze({ x: 2.0, z: -0.4 }),
  Object.freeze({ x: 0.6, z: 0.2 }),
]);

export function insideSafeArea(point) {
  if (point.x < SAFE_AREA.minX || point.x > SAFE_AREA.maxX) return false;
  if (point.z < SAFE_AREA.minZ || point.z > SAFE_AREA.maxZ) return false;
  return OBSTACLES.every(
    (o) => (point.x - o.x) ** 2 + (point.z - o.z) ** 2 >= o.radius ** 2,
  );
}

/** How far one hop carries the puppet, in world units. */
export const HOP_DISTANCE = 0.62;

/**
 * The roam loop: hop towards the next point, idle a moment, turn, hop again.
 *
 * A plan is plain data so the whole route can be walked in a test. `hops` is
 * rounded so a leg always ends on its point rather than part-way through a
 * tenth hop with the puppet hanging in the air.
 */
export function createRoamPlan(points = ROAM_POINTS, start = 0) {
  const usable = points.filter(insideSafeArea);
  if (usable.length < 2) throw new Error('a roam plan needs at least two safe points');
  const from = usable[start % usable.length];
  return {
    points: usable,
    index: start % usable.length,
    state: STATES.IDLE,
    stateTime: 0,
    position: { x: from.x, z: from.z },
    origin: { x: from.x, z: from.z },
    facing: 0,
    hops: 0,
    hop: 0,
  };
}

const legTarget = (plan) => plan.points[(plan.index + 1) % plan.points.length];

/** How long to pause between legs, in seconds. */
const IDLE_PAUSE = 1.5;

/**
 * Advances a roam plan. Returns the same object, mutated — this is called every
 * frame, and allocating a plan per frame for purity's sake would be silly.
 */
export function stepRoam(plan, dt) {
  const safeDt = clamp(dt || 0, 0, 0.05);
  plan.stateTime += safeDt;

  if (plan.state === STATES.IDLE) {
    if (plan.stateTime < IDLE_PAUSE) return plan;
    const target = legTarget(plan);
    const dx = target.x - plan.position.x;
    const dz = target.z - plan.position.z;
    plan.facing = Math.atan2(dx, dz);
    plan.origin = { x: plan.position.x, z: plan.position.z };
    plan.hops = Math.max(1, Math.round(Math.hypot(dx, dz) / HOP_DISTANCE));
    plan.hop = 0;
    plan.state = STATES.HOP;
    plan.stateTime = 0;
    return plan;
  }

  const duration = DURATIONS[STATES.HOP];
  plan.hop = plan.stateTime / duration;
  const target = legTarget(plan);
  // Travel is measured in whole hops plus this hop's progress, so the puppet
  // lands on its point exactly as the last hop finishes.
  const travelled = clamp(
    (Math.floor(plan.hop) + hopProgress(plan.hop)) / plan.hops, 0, 1,
  );
  plan.position = {
    x: lerp(plan.origin.x, target.x, travelled),
    z: lerp(plan.origin.z, target.z, travelled),
  };

  if (plan.hop >= plan.hops) {
    plan.position = { x: target.x, z: target.z };
    plan.index = (plan.index + 1) % plan.points.length;
    plan.state = STATES.IDLE;
    plan.stateTime = 0;
    plan.hop = 0;
  }
  return plan;
}

// --- how it is cut up ------------------------------------------------------

/**
 * The size and offset of one piece's quad, in picture units.
 *
 * `offset` is where the piece's centre sits relative to its own pivot, which is
 * what lets a piece be parented at its pivot and still draw in the right place.
 * `pivot` is where it turns. The puppet is built from these and the textures
 * `robotRenderer.drawPiece` produces, so the geometry and the artwork can never
 * disagree about where a piece is.
 */
export function pieceLayout(piece) {
  const box = pieceBounds(piece);
  if (!box) return null;
  const pivot = PIVOTS[piece];
  return {
    piece,
    width: box.maxX - box.minX,
    height: box.maxY - box.minY,
    pivot: { x: pivot.x, y: pivot.y },
    offset: { x: (box.minX + box.maxX) / 2 - pivot.x, y: (box.minY + box.maxY) / 2 - pivot.y },
  };
}

export const PIECE_LAYOUTS = Object.freeze(PIECES.map(pieceLayout));

/**
 * Which piece hangs off which, so a rotation carries its children with it.
 *
 * The torso is the root, and this is a parenting tree, not a skeleton — every
 * piece is still a rigid flat quad.
 */
export const PIECE_PARENTS = Object.freeze({
  torso: null,
  head: 'torso',
  antenna: 'head',
  leftUpperArm: 'torso',
  leftForearm: 'leftUpperArm',
  rightUpperArm: 'torso',
  rightForearm: 'rightUpperArm',
  leftLeg: 'torso',
  rightLeg: 'torso',
});

/** Depth order front to back, so the arms sit in front of the torso. */
export const PIECE_DEPTH = Object.freeze({
  leftLeg: -0.4, rightLeg: -0.4, torso: 0, head: 0.2, antenna: -0.2,
  leftUpperArm: 0.6, rightUpperArm: 0.6, leftForearm: 0.8, rightForearm: 0.8,
});

/**
 * How tall the puppet stands in world units. The picture is a unit square, so
 * this is also the scale from picture coordinates to world coordinates.
 */
export const PUPPET_HEIGHT = 1.75;
