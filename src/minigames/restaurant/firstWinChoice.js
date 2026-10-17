/** The first rival win is the only result that offers the self-paced exit. */
export function canOfferFirstWinChoice({ progression, outcome, completed = false, finishCalled = false }) {
  return !completed && !finishCalled && outcome === 'player'
    && progression?.round === 1 && progression?.phase === 'round2-intro';
}

/** Single-use choice state; the scene retains its existing continuation/finish paths. */
export function createFirstWinChoice({ onContinue, onFinish }) {
  let visible = false;

  return {
    show(state) {
      if (visible || !canOfferFirstWinChoice(state)) return false;
      visible = true;
      return true;
    },
    choose(index) {
      if (!visible || (index !== 0 && index !== 1)) return false;
      // Resolve before invoking the scene: a second touch cannot run either path.
      visible = false;
      if (index === 0) onContinue();
      else onFinish();
      return true;
    },
    clear() { visible = false; },
    get visible() { return visible; },
  };
}
