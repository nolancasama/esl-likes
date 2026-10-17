import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { UI, LESSON_BY_ID } from '../../config/lesson.js';
import { canOfferFirstWinChoice, createFirstWinChoice } from './firstWinChoice.js';
import { createRivalProgression } from './rivalProgression.js';
import { scoreSession } from './scoring.js';

const source = readFileSync(new URL('./index.js', import.meta.url), 'utf8');
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));

test('a resolved Round 1 win offers exactly the two kana choices', () => {
  const progression = createRivalProgression();
  assert.equal(canOfferFirstWinChoice({ progression, outcome: 'player' }), false);
  progression.resolveRound('player');
  assert.equal(canOfferFirstWinChoice({ progression, outcome: 'player' }), true);
  assert.deepEqual(UI.restaurant.firstWinChoices, ['つづける', 'どうぶつえんへ']);
  assert.equal(canOfferFirstWinChoice({ progression, outcome: 'player', completed: true }), false);
  assert.equal(canOfferFirstWinChoice({ progression, outcome: 'player', finishCalled: true }), false);
});

test('loss, draw, interruption and later wins cannot offer the first-win choice', () => {
  for (const outcome of ['rival', 'draw', null]) {
    const progression = createRivalProgression();
    progression.resolveRound(outcome);
    assert.equal(canOfferFirstWinChoice({ progression, outcome }), false);
    assert.equal(progression.finishAfterFirstWin(), null);
  }
  const progression = createRivalProgression();
  progression.resolveRound('player');
  progression.startRound2();
  progression.resolveRound('player');
  assert.equal(canOfferFirstWinChoice({ progression, outcome: 'player' }), false);
  assert.equal(progression.finishAfterFirstWin(), null);
});

test('Continue invokes the existing next-round path once and later progression stays intact', () => {
  const progression = createRivalProgression();
  progression.resolveRound('rival');
  progression.chooseRematch();
  progression.resolveRound('player');
  let continued = 0;
  const choice = createFirstWinChoice({
    onContinue: () => { continued += 1; progression.startRound2(); },
    onFinish: () => assert.fail('Continue finished the Restaurant'),
  });
  assert.equal(choice.show({ progression, outcome: 'player' }), true);
  assert.equal(choice.choose(0), true);
  assert.equal(choice.visible, false);
  assert.equal(choice.choose(0), false);
  assert.equal(choice.choose(1), false);
  assert.equal(continued, 1);
  assert.equal(progression.round, 2);
  assert.deepEqual(progression.resolveRound('player'), { next: 'round3-intro' });
  progression.startRound3();
  assert.deepEqual(progression.resolveRound('draw'), { next: 'final-question' });
  assert.match(source, /onContinue: \(\) => beginNextRivalTransition\(2\)/);
});

test('Zoo exit uses normal completion data once and cancels the next round', () => {
  const progression = createRivalProgression();
  progression.resolveRound('player');
  const records = [
    { delivered: true, firstTry: true, temperatureScore: 3, patienceAtDelivery: 1 },
    { delivered: false },
  ];
  const finished = [];
  const noop = () => {};
  const context = {
    active: true, finishCalled: false, completed: false, phase: 'result-stage',
    pendingRound: 2, rematchChoiceActive: false,
    rivalExit: { character: {} }, returnWalk: { active: true, onArrive: noop },
    resultWalk: { active: true }, rivalWalk: { active: true }, turnaroundWalk: { walking: true },
    resultStagePendingOutcome: 'player', autoTarget: {}, clickQuestionCustomer: {},
    challengeSuppressedKeys: new Set(['Space']),
    hideChallengePanel: noop, clearQuestion: noop, cancelFocus: noop,
    speech: { cancel: noop, clearTarget: noop }, setListenTarget: noop, hideAction: noop,
    hud: { hide: noop }, dialogue: { hide: noop },
    calculateStars: () => scoreSession(records).stars,
    LESSON: LESSON_BY_ID.restaurant, acceptedAnswer: null,
    finish: (result) => finished.push(JSON.parse(JSON.stringify(result))),
  };
  runInNewContext(section('  function finishRestaurant()', '  function exit()'), context);
  context.firstWinChoice = createFirstWinChoice({
    onContinue: () => assert.fail('Zoo exit started Round 2'),
    onFinish: () => {
      assert.deepEqual(progression.finishAfterFirstWin(), { next: 'completion' });
      context.finishRestaurant();
    },
  });
  context.firstWinChoice.show({ progression, outcome: 'player' });
  assert.equal(context.firstWinChoice.choose(1), true);
  assert.equal(context.firstWinChoice.choose(1), false);
  context.finishRestaurant();
  assert.deepEqual(finished, [{
    stars: scoreSession(records).stars,
    detail: { category: LESSON_BY_ID.restaurant.category, answer: null },
  }]);
  assert.equal(progression.startRound2(), null);
  assert.equal(context.pendingRound, null);
  assert.equal(context.returnWalk.onArrive, null);
  assert.equal(context.autoTarget, null);
  assert.equal(context.clickQuestionCustomer, null);
  assert.equal(context.rivalExit.character, null);
  assert.equal(context.resultWalk.active, false);
  assert.equal(context.rivalWalk.active, false);
  assert.match(source, /if \(finishRemaining <= 0 && !finishCalled\) \{\s*finishRestaurant\(\);/);
});

test('clearing the choice on teardown prevents either callback', () => {
  const progression = createRivalProgression();
  progression.resolveRound('player');
  const choice = createFirstWinChoice({ onContinue: assert.fail, onFinish: assert.fail });
  choice.show({ progression, outcome: 'player' });
  assert.equal(choice.choose(-1), false);
  choice.clear();
  assert.equal(choice.visible, false);
  assert.equal(choice.choose(0), false);
  assert.equal(choice.choose(1), false);
});

test('both result choices share arrows, click and activation guards; Escape stays with the shell', () => {
  let selected = null;
  class Element {
    closest() { return this; }
    constructor(index) { this.dataset = { reply: String(index) }; }
  }
  const document = { activeElement: null };
  const buttons = [0, 1].map((index) => {
    const button = new Element(index);
    button.focus = () => { document.activeElement = button; };
    return button;
  });
  const context = {
    active: true, elapsed: 1, rematchChoiceActive: true, rematchChoiceShownAt: 0,
    REMATCH_CHOICE_GUARD_SECONDS: 0.35, rivalChallenge: null,
    challengeSuppressedKeys: new Set(), document, Element,
    challengeReplies: { querySelectorAll: () => buttons, querySelector: () => buttons[0] },
    chooseAfterLoss: (index) => { selected = `rematch-${index}`; },
    completeChallengeTypewriter: () => assert.fail('Unexpected typewriter activation'),
  };
  const progression = createRivalProgression();
  progression.resolveRound('player');
  context.firstWinChoice = createFirstWinChoice({
    onContinue: () => { selected = 'continue'; },
    onFinish: () => { selected = 'zoo'; },
  });
  runInNewContext(section('  function choicesShown()', '  function beginRivalReveal()'), context);
  const key = (code) => ({ code, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} });
  context.onChallengeKey(key('ArrowRight'));
  assert.equal(document.activeElement, buttons[0]);
  context.onChallengeKey(key('ArrowRight'));
  assert.equal(document.activeElement, buttons[1]);
  context.onChallengeReply({ target: buttons[0] });
  assert.equal(selected, 'rematch-0', 'existing rematch routing still works');
  context.rematchChoiceActive = false;
  context.firstWinChoice.show({ progression, outcome: 'player' });
  context.onChallengeKey(key('Escape'));
  assert.equal(context.firstWinChoice.visible, true);
  context.onChallengeReply({ target: buttons[1] });
  assert.equal(selected, 'zoo');
  assert.equal(context.firstWinChoice.visible, false);
});

test('result panel contains no explanatory line and removes its shared listeners on exit', () => {
  const show = section('  function showFirstWinChoice()', '  function showRematchChoice()');
  assert.match(show, /setChallengeContent\('', STRINGS.firstWinChoices\)/);
  assert.match(source, /challenge--first-win \.restaurant-ui__challenge-line \{ display: none; \}/);
  assert.match(source, /min-height: 72px/);
  assert.match(source, /min-height: 80px/);
  const exit = source.slice(source.indexOf('  function exit()'));
  for (const [event, listener] of [['keydown', 'onChallengeKey'], ['keyup', 'onChallengeKeyUp'], ['blur', 'onChallengeBlur']]) {
    assert.ok(exit.includes(`removeEventListener('${event}', ${listener}`));
  }
  assert.match(exit, /challengeReplies\?\.removeEventListener\('click', onChallengeReply\)/);
  assert.match(exit, /challengePanel\?\.removeEventListener\('click', onChallengePanelClick\)/);
  assert.match(exit, /firstWinChoice\.clear\(\)/);
});
