// The rival's arrival as a short challenge: it walks in, challenges the player
// in Japanese, waits for one of three replies, reacts, then the rush begins.
// The reply is role-play only: every choice has the same outcome.

export const RIVAL_CHALLENGE_RESPONSE_COUNT = 3;
// The replies appear a beat after the line, so a Space press or click still
// queued from the third delivery cannot answer for the player.
export const RIVAL_CHALLENGE_CHOICE_DELAY_SECONDS = 0.45;
export const RIVAL_CHALLENGE_REACTION_SECONDS = 0.55;

/**
 * Phases: idle → entering (walk in) → awaiting (line shown, waits for a reply)
 * → reacting (brief nod) → done (rush running). Service is paused from
 * entering until done. One shot per shift.
 */
export function createRivalChallenge({
  enabled,
  choiceDelaySeconds = RIVAL_CHALLENGE_CHOICE_DELAY_SECONDS,
  reactionSeconds = RIVAL_CHALLENGE_REACTION_SECONDS,
} = {}) {
  const isEnabled = enabled === true;
  let phase = 'idle';
  let choiceDelayRemaining = 0;
  let reactionRemaining = 0;
  let selectedResponse = null;

  function start() {
    if (!isEnabled || phase !== 'idle') return false;
    phase = 'entering';
    return true;
  }

  function arrive() {
    if (phase !== 'entering') return false;
    phase = 'awaiting';
    choiceDelayRemaining = choiceDelaySeconds;
    return true;
  }

  function choose(index) {
    if (phase !== 'awaiting' || choiceDelayRemaining > 0) return false;
    if (!Number.isInteger(index) || index < 0 || index >= RIVAL_CHALLENGE_RESPONSE_COUNT) return false;
    selectedResponse = index;
    phase = 'reacting';
    reactionRemaining = reactionSeconds;
    return true;
  }

  /** Returns 'choices-shown' or 'rush' on the update that crosses into it. */
  function advance(dt) {
    const step = Math.max(0, Number(dt) || 0);
    if (phase === 'awaiting' && choiceDelayRemaining > 0) {
      choiceDelayRemaining = Math.max(0, choiceDelayRemaining - step);
      return choiceDelayRemaining === 0 ? 'choices-shown' : null;
    }
    if (phase === 'reacting') {
      reactionRemaining = Math.max(0, reactionRemaining - step);
      if (reactionRemaining === 0) {
        phase = 'done';
        return 'rush';
      }
    }
    return null;
  }

  return {
    start,
    arrive,
    choose,
    advance,
    get phase() { return phase; },
    get paused() { return phase === 'entering' || phase === 'awaiting' || phase === 'reacting'; },
    get choicesVisible() { return phase === 'awaiting' && choiceDelayRemaining === 0; },
    get selectedResponse() { return selectedResponse; },
  };
}
