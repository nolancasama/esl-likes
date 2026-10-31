/** Roaming HOW only. No renderer, navigation, clocks or shared mutable state. */
import { STATES, poseFor, blinkAt } from './robotPuppet.js';

export const LOCOMOTION_STYLES = Object.freeze({
  hop: Object.freeze({ style: 'hop' }),
  piston: Object.freeze({ style: 'piston', speed: 0.47, period: 0.86, retract: 0.1 }),
  'swing-walk': Object.freeze({ style: 'swing-walk', speed: 0.55, period: 1.05, armSwing: 0.6, legSwing: 0.45 }),
  fly: Object.freeze({ style: 'fly', speed: 0.62, hoverHeight: 2.6, riseTime: 1.6 }),
  tiptoe: Object.freeze({ style: 'tiptoe', speed: 0.38, period: 1.45, checkEvery: 3, checkDuration: 0.85 }),
});

export function locomotionConfigFor(subject) {
  const style = subject.locomotion?.style ?? 'hop';
  return { ...(LOCOMOTION_STYLES[style] ?? LOCOMOTION_STYLES.hop), ...subject.locomotion };
}

const tau = Math.PI * 2;
const clamp01 = (n) => Math.max(0, Math.min(1, n));
const smooth = (n) => { const k = clamp01(n); return k * k * (3 - 2 * k); };

/** Optional caller-owned output avoids allocations in the continuous hot path. */
export function createLocomotionPose(subject) {
  return {
    root: { x: 0, y: 0, tilt: 0, scale: { x: 1, y: 1 } },
    rotations: Object.fromEntries(subject.pieces.map((piece) => [piece, 0])),
    translations: Object.fromEntries(subject.pieces.map((piece) => [piece, 0])),
    // Local X turns: a limb swinging toward/away from the camera. Rotations on
    // Z stay in the picture plane, which on a camera-facing sheet is a flap.
    pitches: Object.fromEntries(subject.pieces.map((piece) => [piece, 0])),
    // Flight attitude targets, read by the renderer: 0 upright .. 1 level flight.
    flat: 0, climb: 0,
    blink: 0, glow: 0, stage: null, progress: 0, worldTilt: false,
  };
}

export function hopPose(subject, context) {
  const result = poseFor(subject, context.moving ? STATES.HOP : STATES.IDLE,
    context.moving ? context.plan.stateTime * context.plan.speed : context.idleTime * context.plan.speed);
  if (context.reducedMotion) {
    result.root.x *= 0.4;
    result.root.y *= 0.4;
    result.root.tilt *= 0.4;
    result.root.scale.x = 1 + (result.root.scale.x - 1) * 0.4;
    result.root.scale.y = 1 + (result.root.scale.y - 1) * 0.4;
    for (const piece of subject.pieces) result.rotations[piece] *= 0.4;
  }
  return result;
}

// Fast retract, eased extension. Offsets are positive only: full extension is
// the authored rest position, retaining the leg/torso overlap behind the body.
const piston = (phase) => phase < 0.18 ? smooth(phase / 0.18)
  : phase < 0.48 ? 1 : phase < 0.88 ? 1 - smooth((phase - 0.48) / 0.4) : 0;

export function pistonPose(subject, c, out = createLocomotionPose(subject)) {
  const a = c.reducedMotion ? 0.4 : 1;
  if (c.moving) {
    const phase = (c.cycleTime / c.plan.locomotion.period) % 1;
    out.translations.leftLeg = piston(phase) * c.plan.locomotion.retract * a;
    out.translations.rightLeg = piston((phase + 0.5) % 1) * c.plan.locomotion.retract * a;
    out.rotations.leftArm = 0.045 * Math.sin(phase * tau) * a;
    out.rotations.rightArm = -out.rotations.leftArm;
    out.glow = 0.32 + 0.1 * Math.sin(c.plan.elapsed * 2.8);
  } else {
    const tick = Math.sin(Math.floor(c.idleTime * 2.5) * 1.7);
    out.rotations.leftArm = tick * 0.018 * a;
    out.rotations.rightArm = -tick * 0.014 * a;
    out.root.tilt = tick * 0.003 * a;
    out.glow = 0.16;
  }
  return out;
}

/**
 * A toy walk: rigid limbs pitch forward and back about shoulders and hips,
 * opposite arm with opposite leg. Pitch, not roll — the sheet faces the
 * camera, so turning a limb on Z flaps it up and down like a jumping jack.
 */
export function swingWalkPose(subject, c, out = createLocomotionPose(subject)) {
  const a = c.reducedMotion ? 0.4 : 1;
  const config = c.plan.locomotion;
  const wave = c.moving ? Math.sin(c.cycleTime / config.period * tau) * a : 0;
  out.pitches.leftArm = wave * config.armSwing;
  out.pitches.rightLeg = wave * config.legSwing;
  out.pitches.rightArm = -wave * config.armSwing;
  out.pitches.leftLeg = -wave * config.legSwing;
  // A small bob at each footfall, twice per stride.
  out.root.y = c.moving ? Math.abs(wave) * 0.025 : 0;
  out.root.tilt = Math.sin((c.moving ? c.cycleTime : c.idleTime) * 2.2) * 0.018 * a;
  return out;
}

/**
 * Flight. The pose only says how level the hero should be and what its limbs
 * do; the renderer turns `flat` into an attitude (yaw to the heading, laid
 * along it, rolled into turns), because that needs a clock and a heading
 * history this pure function does not keep.
 */
export function flyPose(subject, c, out = createLocomotionPose(subject)) {
  const config = c.plan.locomotion;
  const a = c.reducedMotion ? 0.4 : 1;
  const rise = smooth(c.plan.elapsed / config.riseTime);
  // root.y uses half puppet-height units in the existing renderer.
  const height = config.hoverHeight / (1.75 * subject.liveScale * 0.5);
  const legT = c.moving ? clamp01(c.plan.travelTime / c.plan.travelDuration) : 0;
  // A gentle dip-and-climb on every other leg, never on the first.
  const swooping = c.moving && !c.reducedMotion && c.plan.leg % 2 === 0;
  const swoop = swooping ? -Math.sin(legT * Math.PI) * 0.3 : 0;
  const drift = Math.sin(c.plan.elapsed * 0.9) * (c.reducedMotion ? 0.02 : 0.12);
  const bob = Math.sin(c.plan.elapsed * 2.3) * (c.reducedMotion ? 0.008 : 0.05);
  out.root.y = rise * (height + drift + bob + swoop);
  out.climb = swooping ? -Math.cos(legT * Math.PI) * 0.35 : Math.cos(c.plan.elapsed * 0.9) * 0.1 * a;
  const settle = c.moving
    ? smooth(c.plan.travelTime / 0.7) * smooth((c.plan.travelDuration - c.plan.travelTime) / 0.7) : 0;
  out.flat = settle * rise;
  const flap = Math.sin(c.plan.elapsed * 15);
  if (settle > 0) {
    // One fist forward overhead, the other arm along the side, legs together.
    // Raised and slid up the shoulder so the fist clears the head: straight
    // overhead, the arm hides entirely behind it.
    out.rotations.rightArm = 2.72 * settle * rise;
    out.translations.rightArm = 0.11 * settle * rise;
    out.rotations.leftArm = 0.12 * settle * rise;
    out.rotations.leftLeg = 0.05 * settle;
    out.rotations.rightLeg = -0.05 * settle;
    out.pitches.leftLeg = Math.sin(c.plan.elapsed * 5) * 0.12 * a * settle;
    out.pitches.rightLeg = -out.pitches.leftLeg;
  }
  // Relaxed hover: arms a little out, the cape hanging with a light wave.
  out.rotations.leftArm += -0.28 * (1 - settle) * rise;
  out.rotations.rightArm += 0.28 * (1 - settle) * rise;
  // The cape billows off the back and ripples; harder in flight.
  out.pitches.cape = (0.18 + 0.32 * settle + flap * (0.05 + 0.1 * settle)) * rise * a;
  out.rotations.cape = Math.sin(c.plan.elapsed * 6.2) * (0.04 + 0.07 * settle) * rise * a;
  return out;
}

export function tiptoePose(subject, c, out = createLocomotionPose(subject)) {
  const a = c.reducedMotion ? 0.4 : 1;
  const wave = Math.sin(c.cycleTime / c.plan.locomotion.period * tau);
  const step = c.moving ? wave * a : 0;
  // Crouched, weight shifting over each careful step, arms held up and out
  // for balance and lifting with the step: the cartoon tiptoe silhouette.
  out.root.scale.x = 1 + 0.05 * a;
  out.root.scale.y = 1 - 0.08 * a;
  out.root.x = step * 0.035;
  out.root.tilt = step * 0.04;
  out.rotations.leftArm = (-1.05 - Math.max(0, step) * 0.18) * a;
  out.rotations.rightArm = (1.15 + Math.max(0, -step) * 0.18) * a;
  out.rotations.leftLeg = -0.08 * a + step * 0.24;
  out.rotations.rightLeg = 0.08 * a - step * 0.24;
  out.translations.leftLeg = Math.max(0, step) * 0.04;
  out.translations.rightLeg = Math.max(0, -step) * 0.04;
  // Hood and head are one rigid body cutout: a small alert tilt is the glance.
  const glance = c.plan.checking ? Math.sin(clamp01(c.plan.checkTime / c.plan.locomotion.checkDuration) * Math.PI)
    : !c.moving ? Math.max(0, Math.sin(c.idleTime * 2.4 - 1)) ** 6 : 0;
  out.rotations.body = glance * 0.065 * a;
  return out;
}

export const STYLE_POSES = Object.freeze({ hop: hopPose, piston: pistonPose,
  'swing-walk': swingWalkPose, fly: flyPose, tiptoe: tiptoePose });

export function locomotionPose(subject, context, out = createLocomotionPose(subject)) {
  const style = context.plan.locomotion.style;
  if (style === 'hop' || !STYLE_POSES[style]) return hopPose(subject, context);
  out.root.x = 0; out.root.y = 0; out.root.tilt = 0;
  out.root.scale.x = 1; out.root.scale.y = 1;
  out.worldTilt = false; out.glow = 0; out.stage = null; out.flat = 0; out.climb = 0;
  out.blink = blinkAt(context.plan.elapsed);
  for (const piece of subject.pieces) {
    out.rotations[piece] = 0; out.translations[piece] = 0; out.pitches[piece] = 0;
  }
  STYLE_POSES[style](subject, context, out);
  // Plant the rigid limbs at either end of a leg, rather than cutting a
  // stride off when navigation enters its idle pause. Flight keeps its pose.
  if (style !== 'fly' && context.moving) {
    const plan = context.plan;
    let weight = smooth(plan.travelTime / 0.22) * smooth((plan.travelDuration - plan.travelTime) / 0.22);
    if (plan.locomotion.checkEvery && plan.leg % plan.locomotion.checkEvery === 0) {
      const toCheck = plan.travelDuration * 0.46 - plan.travelTime;
      weight *= smooth((plan.checked ? -toCheck : toCheck) / 0.22);
    }
    for (const piece of subject.pieces) {
      if (piece !== 'body') {
        // The ninja's crouch/held arms remain while its steps settle.
        if (style !== 'tiptoe' || piece.endsWith('Leg')) out.rotations[piece] *= weight;
        out.translations[piece] *= weight;
        out.pitches[piece] *= weight;
      }
    }
  }
  return out;
}
