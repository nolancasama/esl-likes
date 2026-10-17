import { isTalkable } from './customerState.js';

const CONTEXT_ACTIONS = new Set(['return', 'exchange', 'collect']);

function available({ phase = 'service', blocked = false, customer, present = false }) {
  return phase === 'service' && !blocked && present
    && (customer?.state === 'seated' || customer?.state === 'awaiting');
}

function canDeliver(customer, carried) {
  return carried !== null && customer?.owner === 'player'
    && customer.state === 'awaiting' && customer.refusalRemaining <= 0
    && carried.food === customer.food;
}

/** Capture one explicit customer-tap action, without reserving or speaking. */
export function customerTapIntent(state) {
  if (!available(state)) return null;
  const { customer, carried = null, talkTargetAllowed = false,
    otherAction = 'none', otherDishId = null, speechCooldown = false } = state;
  let action = 'approach';
  if (canDeliver(customer, carried)) action = 'deliver';
  else if (CONTEXT_ACTIONS.has(otherAction)) action = otherAction;
  else if (carried === null && !speechCooldown && talkTargetAllowed && isTalkable(customer)) action = 'talk';
  return {
    type: 'customer', action, value: customer,
    carriedDish: carried,
    otherDishId,
  };
}

/**
 * Recheck only the captured action; never turn an obsolete delivery into Talk.
 * An arrival is a frame in range with no movement step still being applied.
 */
export function resolveCustomerTapIntent(intent, state) {
  const drop = { intent: null, action: null };
  if (!intent || state.manualMovement || !available(state)
    || intent.value !== state.customer) return drop;
  const { customer, carried = null, talkTargetAllowed = false,
    otherAction = 'none', otherDishId = null, speechCooldown = false } = state;
  let legal = intent.action === 'approach';
  if (intent.action === 'deliver') {
    legal = carried === intent.carriedDish && canDeliver(customer, carried);
  } else if (intent.action === 'talk') {
    legal = carried === null && !speechCooldown && talkTargetAllowed && isTalkable(customer);
  } else if (CONTEXT_ACTIONS.has(intent.action)) {
    legal = intent.action === otherAction && carried === intent.carriedDish
      && intent.otherDishId === otherDishId;
  }
  if (!legal) return drop;
  if (!state.arrived || !state.inRange || !state.stopped) return { intent, action: null };
  return { intent: null, action: intent.action === 'approach' ? null : intent.action };
}
