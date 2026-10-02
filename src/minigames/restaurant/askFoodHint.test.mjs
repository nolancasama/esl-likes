import test from 'node:test';
import assert from 'node:assert/strict';

import { UI } from '../../config/lesson.js';
import { chooseAction } from './actionPriority.js';
import { hideAskFoodHint, updateAskFoodHint } from './askFoodHint.js';

const HINT = UI.restaurant.askFoodHint;

function trackedPill({ textContent = '', hidden = true } = {}) {
  let text = textContent;
  let isHidden = hidden;
  const writes = { textContent: 0, hidden: 0 };
  return {
    writes,
    get textContent() { return text; },
    set textContent(value) { text = value; writes.textContent += 1; },
    get hidden() { return isHidden; },
    set hidden(value) { isHidden = value; writes.hidden += 1; },
  };
}

function update(pill, visible, lastShownState, phasePillRemaining = 0) {
  return updateAskFoodHint({
    pill,
    visible,
    text: HINT,
    phasePillRemaining,
    lastShownState,
  });
}

test('the Talk action shows the ask-food hint and every other action hides it', () => {
  const pill = trackedPill();
  const talkAction = chooseAction({ questionCandidate: {} });
  let state = update(pill, talkAction === 'talk', null);
  assert.equal(pill.textContent, HINT);
  assert.equal(pill.hidden, false);

  for (const chosenAction of ['return', 'exchange', 'deliver', 'collect', 'none']) {
    state = update(pill, chosenAction === 'talk', state);
    assert.equal(pill.hidden, true, chosenAction);
  }
});

test('a live phase cue is not overwritten and the hint returns after it expires', () => {
  const pill = trackedPill({ textContent: 'ラッシュ！', hidden: false });
  let state = update(pill, true, true, 1.2);
  assert.equal(state, null);
  assert.equal(pill.textContent, 'ラッシュ！');
  assert.equal(pill.hidden, false);

  state = update(pill, true, state, 0);
  assert.equal(state, true);
  assert.equal(pill.textContent, HINT);
  assert.equal(pill.hidden, false);
});

test('an unchanged hint state does not rewrite the live region', () => {
  const pill = trackedPill();
  let state = update(pill, true, null);
  assert.deepEqual(pill.writes, { textContent: 1, hidden: 1 });

  state = update(pill, true, state);
  assert.equal(state, true);
  assert.deepEqual(pill.writes, { textContent: 1, hidden: 1 });
});

test('hiding removes a stale ask-food hint even while a phase cue timer runs', () => {
  const pill = trackedPill({ textContent: HINT, hidden: false });
  assert.equal(hideAskFoodHint({ pill, text: HINT }), false);
  assert.equal(pill.hidden, true);
});

test('hiding the ask-food hint never hides a live phase cue', () => {
  for (const cue of ['ランチラッシュ！', 'ラウンド 2！', 'ラストスパート！']) {
    const pill = trackedPill({ textContent: cue, hidden: false });
    hideAskFoodHint({ pill, text: HINT });
    assert.equal(pill.hidden, false, cue);
    assert.equal(pill.textContent, cue);
  }
});

test('the hint can come back after it was force-hidden', () => {
  const pill = trackedPill({ textContent: HINT, hidden: false });
  const state = hideAskFoodHint({ pill, text: HINT });
  assert.equal(update(pill, true, state), true);
  assert.equal(pill.hidden, false);
  assert.equal(pill.textContent, HINT);
});

test('hiding an already hidden hint does not rewrite the live region', () => {
  const pill = trackedPill({ textContent: HINT, hidden: true });
  hideAskFoodHint({ pill, text: HINT });
  assert.equal(pill.writes.hidden, 0);
});
