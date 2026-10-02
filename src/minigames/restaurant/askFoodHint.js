/**
 * Hide the ask-food hint even while a timed phase cue owns the pill. Only the
 * hint itself is hidden: a rush or round cue showing other text is left alone.
 * Returns the new shown state (always false).
 */
export function hideAskFoodHint({ pill, text }) {
  if (pill && !pill.hidden && pill.textContent === text) pill.hidden = true;
  return false;
}

/** Update the shared phase pill without repeatedly writing to its live region. */
export function updateAskFoodHint({
  pill,
  visible,
  text,
  phasePillRemaining = 0,
  lastShownState = null,
}) {
  // Timed phase cues own the pill until their full display window has elapsed.
  if (phasePillRemaining > 0) return null;

  const nextState = Boolean(visible);
  const unchanged = lastShownState === nextState
    && pill?.hidden === !nextState
    && (!nextState || pill?.textContent === text);
  if (unchanged) return nextState;
  if (!pill) return nextState;

  if (nextState && pill.textContent !== text) pill.textContent = text;
  if (pill.hidden !== !nextState) pill.hidden = !nextState;
  return nextState;
}
