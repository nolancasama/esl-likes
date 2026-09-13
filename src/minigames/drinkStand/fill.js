export const VALID_FILL_LEVEL = 0.35;

function clampLevel(value) {
  return Math.min(1, Math.max(0, Number(value) || 0));
}

/** Create the serializable state for the cup. */
export function emptyFill() {
  return { drink: null, level: 0, overflowed: false };
}

/**
 * Start (or resume) a dispenser. Returning to the same station preserves the
 * cup; choosing another station empties it before the new liquid starts.
 */
export function selectDrink(state, drink) {
  if (!drink) return emptyFill();
  if (state?.drink === drink) {
    return {
      drink,
      level: clampLevel(state.level),
      overflowed: Boolean(state.overflowed),
    };
  }
  return { drink, level: 0, overflowed: false };
}

/** Advance by a normalized amount. Liquid caps at full; extra fill overflows. */
export function advanceFill(state, amount, out = {}) {
  if (!state?.drink) return emptyFill();
  const level = clampLevel(state.level);
  const added = Math.max(0, Number(amount) || 0);
  const nextLevel = Math.min(1, level + added);
  const overflowed = Boolean(state.overflowed) || level + added > 1;
  out.drink = state.drink;
  out.level = nextLevel;
  out.overflowed = overflowed;
  return out;
}

export function isServable(state) {
  return Boolean(state?.drink) && clampLevel(state.level) >= VALID_FILL_LEVEL;
}
