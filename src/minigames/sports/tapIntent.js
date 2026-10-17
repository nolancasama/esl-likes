/** A tap records its action once; arrival only validates that same action. */
function canQueue({ active, phase }) {
  return active && phase === 'playing';
}

function canTalk(npc, { npcs }) {
  return npc?.state === 'waiting' && !npc.asked && npcs.includes(npc);
}

/**
 * Floor and zone taps only walk: checkZones() still decides who joins once the
 * child is physically inside. Only a waiting friend captures Talk; a follower
 * (already asked) is just walked toward.
 */
export function createTapIntent({ type, value = null }, context) {
  if (!canQueue(context)) return null;
  if (type === 'floor') return { type, value: null, action: 'approach' };
  if (type === 'zone') return { type, value, action: 'approach' };
  if (type !== 'npc' || !value || value.state === 'hidden') return null;
  return { type, value, action: canTalk(value, context) ? 'talk' : 'approach' };
}

/** Returns the consumed intent separately so the caller clears it before firing. */
export function advanceTapIntent(intent, context) {
  if (!intent || !canQueue(context) || context.manualMovement) {
    return { pending: null, arrived: null };
  }
  if (!context.reached || !context.inRange) return { pending: intent, arrived: null };
  const legal = intent.action === 'approach'
    || (intent.action === 'talk' && canTalk(intent.value, context));
  return { pending: null, arrived: legal ? intent : null };
}
