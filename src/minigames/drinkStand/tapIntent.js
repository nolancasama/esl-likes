/** A tap records its action once; arrival only validates that same action. */
function canQueue({ active, phase, fillMode }) {
  return active && phase === 'service' && !fillMode;
}

function canServe(customer, { heldDrink, servable }) {
  // A wrong drink is still a legal serve: serve() owns the wrong-drink reply.
  return Boolean(heldDrink && servable && customer?.state === 'atWindow'
    && customer.asked && !customer.served);
}

function canTalk(customer, { speechCooldown }) {
  // An unasked customer can never be served, so a held cup does not block Talk.
  return customer?.state === 'atWindow' && !customer.asked && !speechCooldown;
}

export function createTapIntent({ type, value = null }, context) {
  if (!canQueue(context)) return null;
  if (type === 'floor') return { type, value: null, action: 'approach' };
  if (type === 'station') return { type, value, action: 'pour' };
  if (type !== 'customer' || value?.state !== 'atWindow') return null;
  let action = 'approach';
  if (canServe(value, context)) action = 'serve';
  else if (canTalk(value, context)) action = 'talk';
  return { type, value, action, drink: action === 'serve' ? context.heldDrink : null };
}

/** Returns the consumed intent separately so the caller clears it before firing. */
export function advanceTapIntent(intent, context) {
  if (!intent || !canQueue(context) || context.manualMovement) {
    return { pending: null, arrived: null };
  }
  if (!context.reached) return { pending: intent, arrived: null };
  let legal = intent.action === 'approach' || intent.action === 'pour';
  if (intent.type === 'customer' && intent.value?.state !== 'atWindow') legal = false;
  else if (intent.action === 'talk') legal = canTalk(intent.value, context);
  else if (intent.action === 'serve') {
    legal = intent.drink === context.heldDrink && canServe(intent.value, context);
  }
  return { pending: null, arrived: legal ? intent : null };
}
