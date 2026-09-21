import * as THREE from 'three';
import { retargetClip } from './animalClips.js';

/**
 * Drives one animal's idle/walk clips off its roaming state.
 *
 * The rule it exists to enforce: what the animal is doing and what it looks
 * like must agree. An animal that is travelling plays its walk cycle; an animal
 * that has stopped plays its idle. Nothing slides across the grass with frozen
 * legs, which is what the park looked like when the models had no clips at all.
 *
 * Tolerates a missing clip. The giraffe has no run cycle, and if the clip bundle
 * ever fails to load the animal simply stands still rather than throwing.
 */

const CROSSFADE = 0.2;

export function createAnimalAnimator(model, clips, { clipSpeed = 1.5 } = {}) {
  const mixer = new THREE.AnimationMixer(model);
  const actions = {};

  for (const [role, clip] of Object.entries(clips ?? {})) {
    if (!clip) continue;
    // Track names in the bundle are the source pack's bone names; the loaded
    // model may have suffixed duplicates. See animalClips.retargetClip.
    const action = mixer.clipAction(retargetClip(clip, model));
    action.setLoop(THREE.LoopRepeat, Infinity);
    action.clampWhenFinished = false;
    actions[role] = action;
  }

  let current = null;

  function play(role) {
    const next = actions[role] ?? actions.idle ?? null;
    if (!next || next === current) return;
    next.reset();
    next.enabled = true;
    next.setEffectiveWeight(1);
    if (current) {
      // Crossfade rather than cut, so a stop or a start is not a visible snap.
      next.crossFadeFrom(current, CROSSFADE, false);
    }
    next.play();
    current = next;
  }

  const animator = {
    playIdle() { play('idle'); },
    playWalk() { play('walk'); },
    /** Kept for future use. Nothing in normal roaming runs. */
    playRun() { play('run'); },

    /**
     * Matches the walk cycle's cadence to how fast the animal is actually
     * travelling, so the feet do not skate. `clipSpeed` is the speed the clip
     * was authored to look right at.
     */
    setTravelSpeed(speed) {
      const walk = actions.walk;
      if (!walk) return;
      walk.timeScale = Math.max(0.55, Math.min(1.75, speed / clipSpeed));
    },

    update(dt) {
      mixer.update(dt);
    },

    /** Applies a roaming state directly. */
    syncTo(state, speed) {
      if (state === 'walking') {
        animator.setTravelSpeed(speed);
        animator.playWalk();
      } else {
        animator.playIdle();
      }
    },

    get currentClip() {
      return current?.getClip?.().name ?? null;
    },

    get availableClips() {
      return Object.keys(actions);
    },

    dispose() {
      mixer.stopAllAction();
      mixer.uncacheRoot(model);
      current = null;
    },
  };

  return animator;
}
