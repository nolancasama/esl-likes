/**
 * The editor's camera.
 *
 * A host game's camera is usually not something you can edit from. This one's
 * is a fixed, world-aligned three-quarter follow with no user rotation at all,
 * so without taking it over you could only ever adjust whatever happened to be
 * standing in front of the avatar, from one angle, with half the gizmo's axes
 * pointing away from you.
 *
 * So the editor borrows the camera for as long as it is open and gives it back
 * untouched: position, quaternion, fov and far are all snapshotted on take-over
 * and restored on release. `far` matters more than it looks — a host that only
 * ever renders a few metres around a player often sets a near far-plane, and a
 * camera pulled back far enough to see a whole level will clip through it.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const DEFAULT_FAR = 4000;

export function createEditorCamera({ camera, domElement, far = DEFAULT_FAR }) {
  const controls = new OrbitControls(camera, domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.screenSpacePanning = false;
  controls.minDistance = 1.5;
  controls.maxDistance = far * 0.4;
  // Stop just short of the poles so the view never flips through vertical.
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.PAN,
  };
  controls.enabled = false;
  controls.disconnect();

  let snapshot = null;
  const box = new THREE.Box3();
  const size = new THREE.Vector3();
  const centre = new THREE.Vector3();
  const offset = new THREE.Vector3();

  /** Borrows the camera, pointing it at `lookAt` from its current direction. */
  function takeOver(lookAt = null) {
    if (snapshot) return;
    snapshot = {
      position: camera.position.clone(),
      quaternion: camera.quaternion.clone(),
      fov: camera.fov,
      far: camera.far,
      near: camera.near,
    };
    camera.far = Math.max(camera.far, far);
    camera.updateProjectionMatrix();

    if (lookAt) controls.target.copy(lookAt);
    else {
      // Keep looking where the host was looking: a point straight ahead, at
      // roughly the distance the host's own framing implied.
      controls.target.copy(camera.position).add(
        offset.set(0, 0, -1).applyQuaternion(camera.quaternion).multiplyScalar(12),
      );
      controls.target.y = 0;
    }
    controls.connect(domElement);
    controls.enabled = true;
    controls.update();
  }

  /** Gives the camera back exactly as it was found. */
  function release() {
    if (!snapshot) return;
    controls.enabled = false;
    controls.disconnect();
    camera.position.copy(snapshot.position);
    camera.quaternion.copy(snapshot.quaternion);
    camera.fov = snapshot.fov;
    camera.far = snapshot.far;
    camera.near = snapshot.near;
    camera.updateProjectionMatrix();
    snapshot = null;
  }

  /** Frames an object, or a world point, without changing the view direction. */
  function frame(target) {
    if (!target) return;
    if (target.isObject3D) {
      box.setFromObject(target);
      if (box.isEmpty()) return;
      box.getCenter(centre);
      box.getSize(size);
    } else {
      centre.set(target.x ?? 0, target.y ?? 0, target.z ?? 0);
      size.set(2, 2, 2);
    }
    const radius = Math.max(size.length() * 0.5, 0.5);
    const distance = THREE.MathUtils.clamp(
      radius / Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)) * 1.8,
      controls.minDistance,
      controls.maxDistance,
    );
    offset.copy(camera.position).sub(controls.target);
    if (offset.lengthSq() < 1e-6) offset.set(1, 1, 1);
    offset.setLength(distance);
    controls.target.copy(centre);
    camera.position.copy(centre).add(offset);
    controls.update();
  }

  /** Suspended while the gizmo is being dragged, so a drag never also orbits. */
  function setEnabled(enabled) {
    if (snapshot) controls.enabled = enabled;
  }

  function update() {
    if (snapshot) controls.update();
  }

  function dispose() {
    release();
    controls.dispose();
  }

  return {
    takeOver,
    release,
    frame,
    setEnabled,
    update,
    dispose,
    get target() { return controls.target; },
    get active() { return snapshot !== null; },
  };
}
