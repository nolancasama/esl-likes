import { RUSH_PLAYER_DELIVERIES } from './rushTrigger.js';

// Rival progression after the first head-to-head (DESIGN_DECISIONS 2026-09-19
// "rival progression", extended 2026-09-20 "Round 3 chaos"). Round 1 against
// Waiter 1; a loss or draw offers a rematch or the finish; a win brings Waiter 2
// for Round 2. Beating Round 2 unlocks Round 3, the bonus round, against the
// same Waiter 2 — losing or drawing Round 2 goes straight to the final
// question, so a weaker player is never forced through it. Round 3 always ends
// in the final question whatever its outcome. There is no Round 4.

export const RIVAL_IDS = Object.freeze({ WAITER_1: 'waiter1', WAITER_2: 'waiter2' });

/** The rounds whose intro is gated on progression rather than the warm-up rush. */
export const PROGRESSION_ROUNDS = Object.freeze([2, 3]);

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

// Round 3 is the bonus round, and it is deliberately NOT another stat rise: the
// rival keeps Round 2's feet, hesitation and customer share, and gains exactly
// one thing — it can hold two claimed orders at once. The belt gains its
// stoppages. Patience rises a little because the belt is stopped for roughly a
// sixth of the round: holding it at the Round 2 value would quietly convert
// belt downtime into timeouts, which is difficulty from the environment rather
// than from the duel.
export const ROUND_THREE = Object.freeze({
  2: Object.freeze({
    rival: Object.freeze({
      ...ROUND_TWO[2].rival,
      maxActiveOrders: 2,
    }),
    patience: 30,
    tables: 5,
    paceScale: 1,
    beltMalfunction: true,
  }),
  3: Object.freeze({
    rival: Object.freeze({
      ...ROUND_TWO[3].rival,
      maxActiveOrders: 2,
    }),
    patience: 27,
    tables: 5,
    paceScale: 0.7,
    beltMalfunction: true,
  }),
});

/** Per-round tuning, or null for Round 1 and a rematch. */
export function roundSettings(round, difficulty) {
  if (round === 2) return ROUND_TWO[difficulty] ?? null;
  if (round === 3) return ROUND_THREE[difficulty] ?? null;
  return null;
}

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
 *   round3-intro  after a Round 2 win, before the bonus round starts
 *   round3        the bonus round, same Waiter 2, chaotic belt
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
      // Only a win unlocks the bonus round; a loss or a draw finishes normally,
      // so a weaker player is never pushed into Round 3.
      phase = outcome === 'player' ? 'round3-intro' : 'final';
      return { next: phase === 'round3-intro' ? 'round3-intro' : 'final-question' };
    }
    if (phase === 'round3') {
      // Win, loss or draw: Round 3 is the last round. There is no Round 4.
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

  // Round 3 keeps Waiter 2: the design adds no character for the bonus round.
  function startRound3() {
    if (phase !== 'round3-intro') return null;
    phase = 'round3';
    round = 3;
    return { next: 'round3' };
  }

  return {
    resolveRound,
    chooseRematch,
    chooseFinish,
    startRound2,
    startRound3,
    get phase() { return phase; },
    get round() { return round; },
    get rivalId() { return rivalId; },
    get attempt() { return attempt; },
    get awaitingChoice() { return phase === 'choice'; },
    /**
     * Whether a challenge/intro sequence may start now. Round 1 still depends
     * on the warm-up rush trigger the caller passes in; later rounds depend on
     * progression alone, so they no longer ride on that trigger staying true.
     */
    challengeGateOpen(rushTriggered) {
      if (phase === 'round1') return rushTriggered === true;
      return PROGRESSION_ROUNDS.includes(round);
    },
  };
}
