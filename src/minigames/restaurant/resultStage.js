export const RESULT_STAGE_TIMING = Object.freeze({
  reaction: 3.6,
  labelFade: 0.3,
  scoreShrink: 0.5,
  settle: 0.6,
  // Ceiling on the walk to the marks. Both waiters normally arrive inside
  // ~1.2 s; this only exists so a blocked route can never stall the game.
  stagingTimeout: 1.8,
});

// The walk from wherever the round ended to the result marks: quick and
// energetic, not a cinematic (DESIGN_DECISIONS 2026-09-20 "no teleport").
// 8.0 rather than 7.5: from the far corner of the room the slower speed took
// 1.67 s, close enough to `stagingTimeout` that the deadlock guard could fire
// on an honest walk. At 8.0 the worst case is ~1.56 s, inside the guard.
export const RESULT_STAGE_MOVEMENT = Object.freeze({
  speed: 8.0,
  arriveEpsilon: 0.06,
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
 *
 * `staging: true` inserts a leading phase in which both waiters walk from
 * wherever the round left them to their result marks; the reaction only begins
 * once the scene calls `markStaged()` or `stagingTimeout` elapses. It is opt-in
 * so that callers and tests that only care about the reaction are unaffected.
 */
export function createResultStage({ outcome, staging = false } = {}) {
  const reactions = reactionsFor(outcome);
  const staged = staging === true;
  let phase = 'idle';
  let elapsed = 0;
  let phaseElapsed = 0;

  function start() {
    if (phase !== 'idle') return false;
    phase = staged ? 'staging' : 'reaction';
    elapsed = 0;
    phaseElapsed = 0;
    return true;
  }

  /**
   * Both waiters have reached their marks: begin the reaction now rather than
   * waiting out the safety timeout. Returns the same event shape `advance`
   * does, so the scene can process either through one path.
   */
  function markStaged() {
    if (phase !== 'staging') return [];
    phase = 'reaction';
    phaseElapsed = 0;
    return [{ type: 'phase', phase }];
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

      if (phase === 'staging') {
        // The walk normally ends with markStaged(); this is the deadlock guard.
        duration = RESULT_STAGE_TIMING.stagingTimeout;
        nextPhase = 'reaction';
      } else if (phase === 'reaction') {
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
    markStaged,
    markAnswered,
    get active() { return phase !== 'idle'; },
    /** True while the waiters are still walking to their marks. */
    get staging() { return phase === 'staging'; },
    get usesStaging() { return staged; },
    get outcome() { return outcome; },
    get phase() { return phase; },
    get elapsed() { return elapsed; },
    get phaseElapsed() { return phaseElapsed; },
    get labelVisible() { return phase === 'reaction'; },
    get scoreCompact() { return phase === 'settling' || phase === 'question' || phase === 'answered'; },
    get reactions() { return reactions; },
  };
}
