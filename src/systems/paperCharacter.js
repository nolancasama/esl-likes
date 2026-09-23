import * as THREE from 'three';

import { createPaperPuppet } from '../minigames/coloring/paperPuppet.js';
import { STATES } from '../minigames/coloring/robotPuppet.js';

/** Keep a flat puppet this far from either edge-on heading. */
export const EDGE_GUARD = 0.44;

const YAW_TIME_CONSTANT = 0.25;
const HALF_PI = Math.PI / 2;
const TWO_PI = Math.PI * 2;

function wrapAngle(angle) {
  let wrapped = (angle + Math.PI) % TWO_PI;
  if (wrapped < 0) wrapped += TWO_PI;
  return wrapped - Math.PI;
}

function angularDistance(from, to) {
  return wrapAngle(to - from);
}

/**
 * Holds a sustained side-on heading on one stable side of the guard band.
 * Using the rendered heading to choose the side gives the clamp hysteresis:
 * tiny atan2 changes around PI/2 cannot make the sheet flicker between edges.
 */
function readableYaw(target, renderedYaw) {
  const yaw = wrapAngle(target);
  const edge = yaw < 0 ? -HALF_PI : HALF_PI;
  if (Math.abs(yaw - edge) >= EDGE_GUARD) return yaw;

  const towardZero = edge - Math.sign(edge) * EDGE_GUARD;
  const awayFromZero = edge + Math.sign(edge) * EDGE_GUARD;
  return Math.abs(angularDistance(renderedYaw, towardZero))
    <= Math.abs(angularDistance(renderedYaw, awayFromZero))
    ? towardZero
    : awayFromZero;
}

function readableStep(yaw, destination, previous) {
  const candidate = wrapAngle(yaw);
  for (const edge of [-HALF_PI, HALF_PI]) {
    if (Math.abs(candidate - edge) >= EDGE_GUARD) continue;
    const lower = edge - EDGE_GUARD;
    const upper = edge + EDGE_GUARD;
    if (destination <= lower) return lower;
    if (destination >= upper) return upper;
    return Math.abs(angularDistance(previous, lower))
      <= Math.abs(angularDistance(previous, upper)) ? lower : upper;
  }
  return candidate;
}

/**
 * Adapts a fresh Coloring paper puppet to the shared character contract.
 * The host owns the outer group's heading; the inner group smooths the visible
 * sheet independently while still arriving at that heading.
 */
export function createPaperCharacter({
  subject,
  artwork,
  textureSize,
  presentation = {},
} = {}) {
  const puppet = createPaperPuppet({ subject, paint: artwork, textureSize });
  const character = new THREE.Group();
  character.name = `paper-character-${subject.id}`;
  character.add(puppet.group);
  character.scale.setScalar(presentation.scale ?? 1);

  for (const [name, value] of Object.entries(presentation)) {
    if (name !== 'scale') character[name] = value;
  }
  character.userData.isPaperCharacter = true;

  let animationName = 'idle';
  let renderedYaw = 0;
  let yawInitialized = false;
  let disposed = false;

  character.playAnimation = (name, _options) => {
    const nextName = ['walk', 'idle', 'emote-yes', 'static'].includes(name) ? name : 'idle';
    if (nextName === animationName) return true;

    animationName = nextName;
    if (nextName === 'walk') puppet.setState(STATES.HOP);
    else if (nextName === 'emote-yes') puppet.setState(STATES.CELEBRATE);
    else puppet.setState(STATES.IDLE);
    puppet.update(0);
    return true;
  };

  character.updateAnimation = (dt) => {
    const safeDt = Math.max(0, Number.isFinite(dt) ? dt : 0);
    const targetYaw = readableYaw(character.rotation.y, renderedYaw);
    const previousYaw = renderedYaw;
    if (!yawInitialized) {
      renderedYaw = targetYaw;
      yawInitialized = true;
    } else {
      const alpha = 1 - Math.exp(-safeDt / YAW_TIME_CONSTANT);
      const stepped = renderedYaw + angularDistance(renderedYaw, targetYaw) * alpha;
      // Do not let interpolation itself cross through an unreadable edge.
      renderedYaw = readableStep(stepped, targetYaw, previousYaw);
    }
    puppet.group.rotation.y = wrapAngle(renderedYaw - character.rotation.y);

    if (animationName !== 'static') puppet.update(safeDt);
    if (animationName === 'emote-yes' && puppet.isFinished()) {
      animationName = 'idle';
      puppet.setState(STATES.IDLE);
      puppet.update(0);
    }
  };

  character.disposeCharacter = () => {
    if (disposed) return;
    disposed = true;
    puppet.dispose();
  };

  return character;
}
