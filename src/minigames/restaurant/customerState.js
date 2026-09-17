// Japanese on purpose: English is what the child must remember (the answer,
// shown only briefly), Japanese is game state. `I like...` read as a half hint.
export const OWNERSHIP_BUBBLE_TEXT = 'まってる…';

// Matches the look-around warning, which starts below 0.3.
export const PATIENCE_LOW = 0.3;
export const PATIENCE_MEDIUM = 0.6;

export function isTalkable(customer) {
  const reservation = customer?.reservedBy ?? customer?.reservation ?? null;
  return customer?.state === 'seated'
    && customer.owner === null
    && (reservation === null || reservation === 'player');
}

export function patienceLevel(ratio) {
  if (ratio < PATIENCE_LOW) return 'low';
  if (ratio < PATIENCE_MEDIUM) return 'medium';
  return 'high';
}

export function ownershipBubble(customer, { dialogueOnCustomer = false } = {}) {
  if (dialogueOnCustomer || customer?.state !== 'awaiting') return null;
  if (customer.owner !== 'player' && customer.owner !== 'rival') return null;
  const max = Number(customer.patienceMax);
  const patience = max > 0 ? Math.min(1, Math.max(0, Number(customer.patience) / max)) : 1;
  return {
    kind: customer.owner,
    text: OWNERSHIP_BUBBLE_TEXT,
    patience,
    patienceLevel: patienceLevel(patience),
  };
}
