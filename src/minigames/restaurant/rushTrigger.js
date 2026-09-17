export const RUSH_PLAYER_DELIVERIES = 3;

/** Result of the head-to-head score: 'player', 'rival', 'draw', or null with no competition. */
export function competitionOutcome(score) {
  if (!score) return null;
  if (score.player > score.rival) return 'player';
  if (score.rival > score.player) return 'rival';
  return 'draw';
}

/**
 * Head-to-head score that starts at 0–0 when the rival arrives. The solo
 * deliveries still count for progress and stars; only this display excludes
 * them, by subtracting the served totals captured once at rush start.
 */
export function createCompetitionScore() {
  let baseline = null;

  function capture(counts) {
    if (baseline) return false;
    baseline = {
      player: Number(counts?.playerServed) || 0,
      rival: Number(counts?.rivalServed) || 0,
    };
    return true;
  }

  function score(counts) {
    if (!baseline) return null;
    return {
      player: Math.max(0, (Number(counts?.playerServed) || 0) - baseline.player),
      rival: Math.max(0, (Number(counts?.rivalServed) || 0) - baseline.rival),
    };
  }

  return {
    capture,
    score,
    get baseline() { return baseline ? { ...baseline } : null; },
  };
}

/** Pure one-shot counter for the player-delivery rush threshold. */
export function createRushTrigger({ enabled } = {}) {
  const isEnabled = enabled === true;
  let playerDeliveries = 0;
  let triggered = false;

  function recordPlayerDelivery() {
    if (!isEnabled) return false;
    playerDeliveries += 1;
    if (!triggered && playerDeliveries === RUSH_PLAYER_DELIVERIES) {
      triggered = true;
      return true;
    }
    return false;
  }

  return {
    recordPlayerDelivery,
    get playerDeliveries() { return playerDeliveries; },
    get triggered() { return triggered; },
  };
}
