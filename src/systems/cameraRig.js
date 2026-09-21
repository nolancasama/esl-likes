import * as THREE from 'three';
import { dampVector } from '../core/tween.js';

export const CAMERA_PRESETS = Object.freeze({
  follow: Object.freeze({ offset: Object.freeze([7, 7, 9]), lookOffset: Object.freeze([0, 1, 0]), damping: 4.5 }),
  closeup: Object.freeze({ offset: Object.freeze([2.8, 2.6, 4]), lookOffset: Object.freeze([0, 1.25, 0]), damping: 5.5 }),
  fixed: Object.freeze({ offset: Object.freeze([8, 7, 10]), lookOffset: Object.freeze([0, 1, 0]), damping: 4 }),
});

const readVector = (value, fallback, out) => {
  if (value?.isVector3) return out.copy(value);
  if (Array.isArray(value)) return out.set(value[0] ?? 0, value[1] ?? 0, value[2] ?? 0);
  if (value && typeof value === 'object') return out.set(value.x ?? 0, value.y ?? 0, value.z ?? 0);
  return out.copy(fallback);
};

/** Gentle, world-aligned three-quarter follow camera with no user rotation. */
export function createCameraRig(camera) {
  let target = null;
  let presetName = 'follow';
  let damping = CAMERA_PRESETS.follow.damping;
  let fixedPosition = null;
  let fixedLookAt = null;
  // The main loop drives this rig every frame. A development tool that borrows
  // the camera has to be able to stop it, or the two fight for the transform.
  let enabled = true;

  const anchor = new THREE.Vector3();
  const offset = new THREE.Vector3(...CAMERA_PRESETS.follow.offset);
  const lookOffset = new THREE.Vector3(...CAMERA_PRESETS.follow.lookOffset);
  const desiredPosition = new THREE.Vector3();
  const desiredLookAt = new THREE.Vector3();
  const smoothedLookAt = new THREE.Vector3(0, 1, 0);
  const defaultVector = new THREE.Vector3();

  function setTarget(nextTarget) {
    target = nextTarget ?? null;
    return api;
  }

  function setPreset(name, options = {}) {
    const preset = CAMERA_PRESETS[name];
    if (!preset) throw new Error(`Unknown camera preset: ${name}`);
    presetName = name;
    damping = Number.isFinite(options.damping) ? Math.max(0.01, options.damping) : preset.damping;
    readVector(options.offset, new THREE.Vector3(...preset.offset), offset);
    readVector(options.lookOffset, new THREE.Vector3(...preset.lookOffset), lookOffset);

    if (name === 'fixed') {
      fixedPosition ||= new THREE.Vector3();
      fixedLookAt ||= new THREE.Vector3();
      readVector(options.position, camera.position, fixedPosition);
      readVector(options.lookAt, smoothedLookAt, fixedLookAt);
    } else {
      fixedPosition = null;
      fixedLookAt = null;
    }
    return api;
  }

  function setEnabled(value) {
    enabled = Boolean(value);
    return api;
  }

  function update(dt) {
    if (!enabled) return;
    const safeDt = Math.min(Math.max(dt || 0, 0), 0.1);
    if (presetName === 'fixed' && fixedPosition && fixedLookAt) {
      desiredPosition.copy(fixedPosition);
      desiredLookAt.copy(fixedLookAt);
    } else {
      if (target?.isObject3D) target.getWorldPosition(anchor);
      else readVector(target, defaultVector.set(0, 0, 0), anchor);
      desiredPosition.copy(anchor).add(offset);
      desiredLookAt.copy(anchor).add(lookOffset);
    }

    dampVector(camera.position, desiredPosition, damping, safeDt);
    dampVector(smoothedLookAt, desiredLookAt, damping + 1, safeDt);
    camera.lookAt(smoothedLookAt);
  }

  function destroy() {
    target = null;
  }

  const api = {
    setTarget,
    setPreset,
    setEnabled,
    requestPreset: setPreset,
    update,
    destroy,
    get preset() { return presetName; },
    get target() { return target; },
    get enabled() { return enabled; },
  };
  return api;
}
