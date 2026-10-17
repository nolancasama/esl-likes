/** Pure onboarding policy. Round identity and favourite stay with the controller. */
export function coloringInstruction({ ready = false, selectedColor = null }, strings) {
  return ready ? strings.readyHint : selectedColor ? strings.paintHint : strings.chooseColor;
}

export function favouriteGuidance({ roundsStarted, answered, powerStarted, favourite }) {
  return {
    tutorialRound: roundsStarted === 1,
    emphasise: roundsStarted === 1 && answered && !powerStarted,
    reminderText: answered && favourite ? `すきないろ: ${favourite.toUpperCase()}` : '',
  };
}

export const initialTutorialHistory = () => ({
  powerStarted: false,
  selectionHinted: false,
  wrongStrokeColors: [],
});

/** Each selection is one event; stroke samples are deduplicated by colour. */
export function advanceFavouriteTutorial(history, {
  roundsStarted, favourite, power, event, color, meaningful = false,
}) {
  const next = { ...history, powerStarted: history.powerStarted || power > 0 };
  if (roundsStarted !== 1 || next.powerStarted) return { history: next, hint: '' };
  const wrong = color && color !== favourite;
  let fire = false;
  if (event === 'selection') {
    fire = Boolean(wrong);
    next.selectionHinted = fire;
  } else if (event === 'stroke' && meaningful && wrong
      && !history.wrongStrokeColors.includes(color)) {
    next.wrongStrokeColors = [...history.wrongStrokeColors, color];
    fire = !history.selectionHinted;
  }
  return { history: next, hint: fire ? `ロボットは ${favourite.toUpperCase()} が すきだよ！` : '' };
}
