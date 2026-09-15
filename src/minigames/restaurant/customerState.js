export const OWNERSHIP_BUBBLE_TEXT = 'I like...';

export function isTalkable(customer) {
  const reservation = customer?.reservedBy ?? customer?.reservation ?? null;
  return customer?.state === 'seated'
    && customer.owner === null
    && (reservation === null || reservation === 'player');
}

export function ownershipBubble(customer, { dialogueOnCustomer = false } = {}) {
  if (dialogueOnCustomer || customer?.state !== 'awaiting') return null;
  if (customer.owner !== 'player' && customer.owner !== 'rival') return null;
  return {
    kind: customer.owner,
    text: OWNERSHIP_BUBBLE_TEXT,
  };
}
