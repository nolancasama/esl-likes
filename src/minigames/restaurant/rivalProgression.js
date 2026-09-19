import { RUSH_PLAYER_DELIVERIES } from './rushTrigger.js';

// Rival progression after the first head-to-head (DESIGN_DECISIONS 2026-09-19
// "rival progression"). Round 1 against Waiter 1; a loss or draw offers a
// rematch or the finish; a win brings Waiter 2 for Round 2; Round 2 always ends
// in the final question. There is no Round 3.

export const RIVAL_IDS = Object.freeze({ WAITER_1: 'waiter1', WAITER_2: 'waiter2' });

// Round 2 wins on execution, not on customer share: faster feet, shorter
// hesitation and quicker dish noticing, while the share stays at or under half.
// Per level so a Normal player meets roughly the Challenge rival, not a jump
// past it. Tables: Normal gains its fifth table; Challenge already uses all five,
// so its free tables refill faster instead.
export const ROUND_TWO = Object.freeze({
  2: Object.freeze({
    rival: Object.freeze({
      speed: 4.2,
      minSeatedAge: 5,
      share: 0.45,
      hesitationMin: 0.4,
      hesitationMax: 0.8,
      dishNoticeSeconds: 0.6,
    }),
    patience: 28,
    tables: 5,
    paceScale: 1,
  }),
  3: Object.freeze({
    rival: Object.freeze({
      speed: 5.15,
      minSeatedAge: 3,
      share: 0.5,
      hesitationMin: 0.25,
      hesitationMax: 0.6,
      dishNoticeSeconds: 0.45,
    }),
    patience: 25,
    tables: 5,
    paceScale: 0.7,
  }),
});

/** Customers in a rematch or Round 2: the competitive part of the first shift. */
export function competitiveRoundTotal(shiftTotal) {
  const total = Math.floor(Number(shiftTotal) || 0);
  return Math.max(1, total - RUSH_PLAYER_DELIVERIES);
}

const OUTCOMES = new Set(['player', 'rival', 'draw']);

/**
 * Pure round-to-round state. Phases:
 *   round1        Waiter 1 battle (first attempt or a rematch)
 *   choice        after a Round 1 loss or draw: rematch or finish
 *   round2-intro  after a Round 1 win, before Waiter 2 arrives
 *   round2        Waiter 2 battle (from its introduction on)
 *   final         the final question; nothing further can start
 * Every call that is not valid for the current phase returns null and changes nothing.
 */
export function createRivalProgression() {
  let phase = 'round1';
  let round = 1;
  let rivalId = RIVAL_IDS.WAITER_1;
  let attempt = 1;

  function resolveRound(outcome) {
    if (!OUTCOMES.has(outcome)) return null;
    if (phase === 'round1') {
      // A draw does not unlock Waiter 2.
      phase = outcome === 'player' ? 'round2-intro' : 'choice';
      return { next: phase };
    }
    if (phase === 'round2') {
      phase = 'final';
      return { next: 'final-question' };
    }
    return null;
  }

  function chooseRematch() {
    if (phase !== 'choice') return null;
    phase = 'round1';
    attempt += 1;
    return { next: 'round1-rematch' };
  }

  function chooseFinish() {
    if (phase !== 'choice') return null;
    phase = 'final';
    return { next: 'final-question' };
  }

  function startRound2() {
    if (phase !== 'round2-intro') return null;
    phase = 'round2';
    round = 2;
    rivalId = RIVAL_IDS.WAITER_2;
    return { next: 'round2' };
  }

  return {
    resolveRound,
    chooseRematch,
    chooseFinish,
    startRound2,
    get phase() { return phase; },
    get round() { return round; },
    get rivalId() { return rivalId; },
    get attempt() { return attempt; },
    get awaitingChoice() { return phase === 'choice'; },
  };
}
