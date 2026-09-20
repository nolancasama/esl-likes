import { RUSH_PLAYER_DELIVERIES } from './rushTrigger.js';

// Rival progression after the first head-to-head (DESIGN_DECISIONS 2026-09-19
// "rival progression", 2026-09-20 "Round 3 chaos", 2026-09-21 "one fixed
// Restaurant, three waiters"). Round 1 against Waiter 1; a loss or draw offers
// a rematch or the finish; a win brings Waiter 2 for Round 2. Beating Round 2
// unlocks Round 3 against Waiter 3 — losing or drawing Round 2 goes straight to
// the final question, so a weaker player is never forced through it. Round 3
// always ends in the final question whatever its outcome. There is no Round 4.
//
// The Restaurant has one fixed baseline, so each round's tuning is one object
// rather than a per-difficulty table.

export const RIVAL_IDS = Object.freeze({
  WAITER_1: 'waiter1', WAITER_2: 'waiter2', WAITER_3: 'waiter3',
});

/** The rounds whose intro is gated on progression rather than the warm-up rush. */
export const PROGRESSION_ROUNDS = Object.freeze([2, 3]);

// The Restaurant has one fixed baseline and ignores the global difficulty
// setting. This is the competitive level the rival ladder was tuned against —
// deliberately NOT the old Easy default, which predates the ladder entirely.
export const RESTAURANT_LEVEL = 2;

// The one fixed Restaurant baseline the rounds build from.
export const BASELINE = Object.freeze({ patience: 38, tables: 4, paceScale: 1 });

// Round 2 wins on execution alone: faster feet, shorter hesitation and quicker
// dish noticing. Patience, tables, customer share and the director all stay at
// the baseline — Waiter 2 is harder because it beats you to dishes, not because
// the room was tilted while you were not looking.
export const ROUND_TWO = Object.freeze({
  rival: Object.freeze({
    speed: 4.2,
    minSeatedAge: 5,
    hesitationMin: 0.4,
    hesitationMax: 0.8,
    dishNoticeSeconds: 0.6,
  }),
  patience: BASELINE.patience,
  tables: BASELINE.tables,
  paceScale: BASELINE.paceScale,
});

// Round 3 is the last round and the only one that shortens patience. One
// explicit scale, applied once here, so the value can never drift apart from
// the baseline it is derived from.
export const ROUND_THREE_PATIENCE_SCALE = 0.76;
export const ROUND_THREE_PATIENCE = Math.round(BASELINE.patience * ROUND_THREE_PATIENCE_SCALE);

// Waiter 3 keeps Waiter 2's feet and adds the one thing that makes it feel
// like a different opponent: it can hold two claimed orders at once. The belt
// gains its fast bursts (beltTempo.js).
export const ROUND_THREE = Object.freeze({
  rival: Object.freeze({
    ...ROUND_TWO.rival,
    maxActiveOrders: 2,
  }),
  patience: ROUND_THREE_PATIENCE,
  tables: BASELINE.tables,
  paceScale: BASELINE.paceScale,
  beltTempo: true,
});

/** Per-round tuning, or null for Round 1 and a rematch (both baseline). */
export function roundSettings(round) {
  if (round === 2) return ROUND_TWO;
  if (round === 3) return ROUND_THREE;
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
 *   round3        the last round, Waiter 3, fast belt bursts
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

  function startRound3() {
    if (phase !== 'round3-intro') return null;
    phase = 'round3';
    round = 3;
    rivalId = RIVAL_IDS.WAITER_3;
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
