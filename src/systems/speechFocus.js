const DEFAULT_ENTER_DURATION = 0.12;
const DEFAULT_RELEASE_DURATION = 0.35;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function duration(value, fallback) {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

/** Creates the shared service-time scale that protects open speech interactions. */
export function createSpeechFocus({
  floor: requestedFloor = 0,
  enterDuration: requestedEnterDuration = DEFAULT_ENTER_DURATION,
  releaseDuration: requestedReleaseDuration = DEFAULT_RELEASE_DURATION,
} = {}) {
  const floor = Number.isFinite(requestedFloor)
    ? clamp(requestedFloor, 0, 1)
    : 0;
  const enterDuration = duration(requestedEnterDuration, DEFAULT_ENTER_DURATION);
  const releaseDuration = duration(requestedReleaseDuration, DEFAULT_RELEASE_DURATION);

  let scale = 1;
  let focused = false;
  let transition = null;

  const startTransition = (target, seconds) => {
    if (seconds === 0 || scale === target) {
      scale = target;
      transition = null;
      return;
    }
    transition = { from: scale, target, seconds, elapsed: 0 };
  };

  return {
    begin(_reason) {
      // Prompt retries share one protected interval; duplicate opens must not nest.
      if (focused) return;
      focused = true;
      startTransition(floor, enterDuration);
    },
    end() {
      if (!focused) return;
      focused = false;
      startTransition(1, releaseDuration);
    },
    cancel() {
      focused = false;
      transition = null;
      scale = 1;
    },
    update(dt) {
      if (!transition || !Number.isFinite(dt) || dt <= 0) return;

      transition.elapsed += dt;
      const progress = clamp(transition.elapsed / transition.seconds, 0, 1);
      scale = clamp(
        transition.from + ((transition.target - transition.from) * progress),
        0,
        1,
      );
      if (progress === 1) {
        scale = transition.target;
        transition = null;
      }
    },
    serviceDelta(dt) {
      return Number.isFinite(dt) && dt > 0 ? dt * scale : 0;
    },
    get active() { return focused || transition !== null; },
    get scale() { return scale; },
  };
}
