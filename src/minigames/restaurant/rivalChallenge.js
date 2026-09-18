// The rival's arrival as a short challenge: it walks in, turns for a reveal,
// challenges the player in Japanese, waits for one of three replies, reacts,
// then the rush begins. The reply is role-play only: every choice has the same
// outcome.

export const RIVAL_CHALLENGE_RESPONSE_COUNT = 3;
export const RIVAL_CHALLENGE_REACTION_SECONDS = 0.55;
export const RIVAL_REVEAL_TIMING = Object.freeze({
  turn: 0.2,
  reveal: 2.0,
  return: 0.8,
});

/**
 * Pure timing and phase state for the rival introduction.
 *
 * The scene owns the entrance walk and calls arrive() once it is complete.
 * advance() returns every timed event crossed by the update, in order. The
 * typewriter is scene-owned, so completeTyping() is its explicit completion
 * signal and returns the choices-shown event for that same update.
 */
export function createRivalChallenge({
  enabled,
  revealTiming = RIVAL_REVEAL_TIMING,
  reactionSeconds = RIVAL_CHALLENGE_REACTION_SECONDS,
} = {}) {
  const isEnabled = enabled === true;
  const timing = {
    turn: Math.max(0, Number(revealTiming?.turn) || 0),
    reveal: Math.max(0, Number(revealTiming?.reveal) || 0),
    return: Math.max(0, Number(revealTiming?.return) || 0),
  };
  const reactionDuration = Math.max(0, Number(reactionSeconds) || 0);
  let phase = 'idle';
  let phaseElapsed = 0;
  let selectedResponse = null;

  function start() {
    if (!isEnabled || phase !== 'idle') return false;
    phase = 'entering';
    phaseElapsed = 0;
    return true;
  }

  function arrive() {
    if (phase !== 'entering') return false;
    phase = 'turning';
    phaseElapsed = 0;
    return true;
  }

  function completeTyping() {
    if (phase !== 'typing') return [];
    phase = 'awaiting';
    phaseElapsed = 0;
    return [{ type: 'choices-shown' }];
  }

  function choose(index) {
    if (phase !== 'awaiting') return false;
    if (!Number.isInteger(index) || index < 0 || index >= RIVAL_CHALLENGE_RESPONSE_COUNT) return false;
    selectedResponse = index;
    phase = 'reacting';
    phaseElapsed = 0;
    return true;
  }

  /** Returns all semantic events for phases crossed by this update, in order. */
  function advance(dt) {
    let remaining = Math.max(0, Number(dt) || 0);
    if (remaining === 0) return [];

    const events = [];
    while (remaining > 0) {
      let duration = null;
      let nextPhase = null;
      let eventType = null;

      if (phase === 'turning') {
        duration = timing.turn;
        nextPhase = 'reveal';
        eventType = 'reveal';
      } else if (phase === 'reveal') {
        duration = timing.reveal;
        nextPhase = 'returning';
        eventType = 'returning';
      } else if (phase === 'returning') {
        duration = timing.return;
        nextPhase = 'typing';
        eventType = 'panel';
      } else if (phase === 'reacting') {
        duration = reactionDuration;
        nextPhase = 'done';
        eventType = 'rush';
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
      events.push({ type: eventType });
    }

    return events;
  }

  return {
    start,
    arrive,
    completeTyping,
    choose,
    advance,
    get phase() { return phase; },
    get phaseElapsed() { return phaseElapsed; },
    get paused() { return phase !== 'idle' && phase !== 'done'; },
    get choicesVisible() { return phase === 'awaiting'; },
    get selectedResponse() { return selectedResponse; },
  };
}
