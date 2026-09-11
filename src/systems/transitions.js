export function createTransitions(element) {
  let running = false;
  const reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  async function animate(keyframes, options) {
    if (!element.animate) {
      element.style.transform = keyframes.at(-1).transform;
      return;
    }
    const animation = element.animate(keyframes, options);
    try {
      await animation.finished;
    } catch {
      // Cancelling a transition during teardown is harmless.
    }
    element.style.transform = keyframes.at(-1).transform;
  }

  async function run(changeScene) {
    if (running) return false;
    running = true;
    element.style.transformOrigin = 'left center';
    await animate(
      [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }],
      { duration: reducedMotion ? 1 : 280, easing: 'cubic-bezier(.55,0,.3,1)', fill: 'forwards' },
    );

    try {
      await changeScene();
    } finally {
      element.style.transformOrigin = 'right center';
      await animate(
        [{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }],
        { duration: reducedMotion ? 1 : 320, easing: 'cubic-bezier(.4,0,.15,1)', fill: 'forwards' },
      );
      running = false;
    }
    return true;
  }

  return {
    run,
    get active() { return running; },
  };
}
