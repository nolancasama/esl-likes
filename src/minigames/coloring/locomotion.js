/** Roaming HOW only. No renderer, navigation, clocks or shared mutable state. */
import { STATES, poseFor, blinkAt } from './robotPuppet.js';

export const LOCOMOTION_STYLES = Object.freeze({
  hop: Object.freeze({ style: 'hop' }),
  piston: Object.freeze({ style: 'piston', speed: 0.47, period: 0.86, retract: 0.1 }),
  'swing-walk': Object.freeze({ style: 'swing-walk', speed: 0.55, period: 1.05, swing: 0.29 }),
  fly: Object.freeze({ style: 'fly', speed: 0.62, hoverHeight: 1.18, riseTime: 1.05 }),
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

export function swingWalkPose(subject, c, out = createLocomotionPose(subject)) {
  const a = c.reducedMotion ? 0.4 : 1;
  const wave = Math.sin(c.cycleTime / c.plan.locomotion.period * tau);
  const swing = c.moving ? wave * c.plan.locomotion.swing * a : 0;
  out.rotations.leftArm = swing;
  out.rotations.rightLeg = swing;
  out.rotations.rightArm = -swing;
  out.rotations.leftLeg = -swing;
  out.root.tilt = Math.sin((c.moving ? c.cycleTime : c.idleTime) * 2.2) * 0.018 * a;
  return out;
}

export function flyPose(subject, c, out = createLocomotionPose(subject)) {
  const config = c.plan.locomotion;
  const a = c.reducedMotion ? 0.4 : 1;
  const rise = smooth(c.plan.elapsed / config.riseTime);
  // root.y uses half puppet-height units in the existing renderer.
  const height = config.hoverHeight / (1.75 * subject.liveScale * 0.5);
  const swoop = c.moving && !c.reducedMotion && c.plan.leg % 3 === 2
    ? Math.sin(clamp01(c.plan.travelTime / c.plan.travelDuration) * tau) * 0.16 : 0;
  out.root.y = rise * (height + Math.sin(c.plan.elapsed * 2.3) * (c.reducedMotion ? 0.008 : 0.055) + swoop);
  const turn = smooth(c.plan.stateTime / 0.65);
  const heading = Math.sin(c.plan.previousFacing) * (1 - turn) + Math.sin(c.plan.facing) * turn;
  const settle = c.moving ? smooth(c.plan.travelTime / 0.6) * smooth((c.plan.travelDuration - c.plan.travelTime) / 0.6) : 0;
  out.root.tilt = -heading * 0.11 * settle * a;
  out.worldTilt = true; // bank in world space, independent of the paper flip
  out.rotations.leftArm = 1.65 * rise * a;
  out.rotations.rightArm = 2.05 * rise * a;
  out.rotations.leftLeg = 0.12 * rise * a;
  out.rotations.rightLeg = 0.12 * rise * a;
  out.rotations.cape = (-0.12 + Math.sin(c.plan.elapsed * 7) * 0.075) * rise * a;
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
  out.worldTilt = false; out.glow = 0; out.stage = null;
  out.blink = blinkAt(context.plan.elapsed);
  for (const piece of subject.pieces) { out.rotations[piece] = 0; out.translations[piece] = 0; }
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
      }
    }
  }
  return out;
}
