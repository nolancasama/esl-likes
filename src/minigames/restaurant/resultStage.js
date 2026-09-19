export const RESULT_STAGE_TIMING = Object.freeze({
  reaction: 3.6,
  labelFade: 0.3,
  scoreShrink: 0.5,
  settle: 0.6,
});

export const RESULT_STAGE_LAYOUT = Object.freeze({
  player: Object.freeze({ x: -1.35, z: -3.75 }),
  rival: Object.freeze({ x: 1.35, z: -3.75 }),
});

const REACTIONS = Object.freeze({
  player: Object.freeze({ player: 'celebrate', rival: 'dejected' }),
  rival: Object.freeze({ player: 'dejected', rival: 'celebrate' }),
  draw: Object.freeze({ player: 'shrug', rival: 'shrug' }),
});

const SETTLING_SECONDS = RESULT_STAGE_TIMING.labelFade
  + RESULT_STAGE_TIMING.scoreShrink
  + RESULT_STAGE_TIMING.settle;

export function reactionsFor(outcome) {
  return REACTIONS[outcome];
}

/**
 * Pure timing and phase state for the rival result presentation.
 * The scene owns all rendering and animation responses to transition events.
 */
export function createResultStage({ outcome } = {}) {
  const reactions = reactionsFor(outcome);
  let phase = 'idle';
  let elapsed = 0;
  let phaseElapsed = 0;

  function start() {
    if (phase !== 'idle') return false;
    phase = 'reaction';
    elapsed = 0;
    phaseElapsed = 0;
    return true;
  }

  function advance(dt) {
    if (phase === 'idle') return [];

    let remaining = Math.max(0, Number(dt) || 0);
    if (remaining === 0) return [];

    const events = [];
    elapsed += remaining;

    while (remaining > 0) {
      let duration = null;
      let nextPhase = null;

      if (phase === 'reaction') {
        duration = RESULT_STAGE_TIMING.reaction;
        nextPhase = 'settling';
      } else if (phase === 'settling') {
        duration = SETTLING_SECONDS;
        nextPhase = 'question';
      }

      if (duration === null) {
        phaseElapsed += remaining;
        break;
      }

      const untilTransition = Math.max(0, duration - phaseElapsed);
      if (remaining < untilTransition && untilTransition - remaining > 1e-10) {
        phaseElapsed += remaining;
        break;
      }

      remaining = Math.max(0, remaining - untilTransition);
      phase = nextPhase;
      phaseElapsed = 0;
      events.push({ type: 'phase', phase });
    }

    return events;
  }

  function markAnswered() {
    if (phase !== 'question') return false;
    phase = 'answered';
    phaseElapsed = 0;
    return true;
  }

  return {
    start,
    advance,
    markAnswered,
    get active() { return phase !== 'idle'; },
    get outcome() { return outcome; },
    get phase() { return phase; },
    get elapsed() { return elapsed; },
    get phaseElapsed() { return phaseElapsed; },
    get labelVisible() { return phase === 'reaction'; },
    get scoreCompact() { return phase === 'settling' || phase === 'question' || phase === 'answered'; },
    get reactions() { return reactions; },
  };
}
