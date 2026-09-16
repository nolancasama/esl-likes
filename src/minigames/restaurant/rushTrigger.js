export const RUSH_PLAYER_DELIVERIES = 3;

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
