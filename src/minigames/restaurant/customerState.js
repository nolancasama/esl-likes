// Japanese on purpose: English is what the child must remember (the answer,
// shown only briefly), Japanese is game state. `I like...` read as a half hint.
export const OWNERSHIP_BUBBLE_TEXT = 'まってる…';

// Service seconds from order to walking out, per level (DESIGN_DECISIONS
// 2026-09-17 sixth pass). Service time, so speech recognition never drains it.
export const PATIENCE_SECONDS = Object.freeze({ 1: 48, 2: 38, 3: 28 });

// Strip colour steps: green down to 50%, amber to 20%, red below. Red also
// starts the look-around warning.
export const PATIENCE_LOW = 0.2;
export const PATIENCE_MEDIUM = 0.5;

/**
 * Patience after one update. Only service time drains it, and only while the
 * customer waits for food (or before ordering, at `preOrderDrain`). Nothing
 * refills it: approaching, a wrong delivery or a colour change leave it alone.
 */
export function drainPatience(customer, serviceDt, { preOrderDrain = 0 } = {}) {
  const patience = Math.max(0, Number(customer?.patience) || 0);
  const dt = Number.isFinite(serviceDt) && serviceDt > 0 ? serviceDt : 0;
  const rate = customer?.state === 'awaiting' ? 1 : (customer?.state === 'seated' ? preOrderDrain : 0);
  return rate > 0 ? Math.max(0, patience - dt * rate) : patience;
}

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
