/** A tap records its action once; arrival only validates that same action. */
function canQueue({ active, phase, viewfinderOpen, guideOpen, sequenceRunning }) {
  return active && phase === 'playing' && !viewfinderOpen && !guideOpen && !sequenceRunning;
}

export function canShowPhoto(visitor, photo) {
  // A wrong animal is still a legal delivery attempt: the existing refusal
  // consumes the photo and records the failed first try.
  return Boolean(photo && visitor?.state === 'waiting' && visitor.asked && !visitor.served);
}

function canTalk(visitor, validSpeechTarget) {
  return validSpeechTarget && visitor?.state === 'waiting' && !visitor.asked && !visitor.served;
}

export function createTapIntent({ type, value }, context) {
  if (!canQueue(context)) return null;
  let action = 'approach';
  if (type === 'visitor' && context.visitorPresent) {
    if (canShowPhoto(value, context.carriedPhoto)) action = 'show-photo';
    else if (canTalk(value, context.validSpeechTarget)) action = 'talk';
  }
  return { type, value, action, photo: action === 'show-photo' ? context.carriedPhoto : null };
}

/** Returns the consumed intent separately so the caller clears it before firing. */
export function advanceTapIntent(intent, context) {
  if (!intent || !canQueue(context) || context.manualMovement) {
    return { pending: null, arrived: null };
  }
  if (!context.reached || !context.stopped) return { pending: intent, arrived: null };

  const legal = intent.action === 'approach' || (intent.type === 'visitor' && context.visitorPresent && (
    (intent.action === 'talk' && canTalk(intent.value, context.validSpeechTarget))
    || (intent.action === 'show-photo' && intent.photo === context.carriedPhoto
      && canShowPhoto(intent.value, context.carriedPhoto))
  ));
  return { pending: null, arrived: legal ? intent : null };
}
