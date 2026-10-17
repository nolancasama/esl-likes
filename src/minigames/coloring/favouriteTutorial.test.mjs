import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { UI, LESSON_BY_ID, answerFor } from '../../config/lesson.js';
import { PALETTE, PALETTE_HEX } from './palette.js';
import {
  advanceFavouriteTutorial, coloringInstruction, favouriteGuidance, initialTutorialHistory,
} from './favouriteTutorial.js';

const source = readFileSync(new URL('./index.js', import.meta.url), 'utf8');
const strings = UI.coloring;
const context = { roundsStarted: 1, favourite: 'purple', power: 0 };
const step = (history, event) => advanceFavouriteTutorial(history, { ...context, ...event });

test('first-round instruction and painting hint explicitly name the robot’s preference', () => {
  assert.equal(coloringInstruction({}, strings), 'ロボットの すきな いろを えらぼう！');
  assert.equal(coloringInstruction({ selectedColor: 'red' }, strings), 'ロボットの すきな いろで ぬろう！');
  assert.equal(coloringInstruction({ ready: true, selectedColor: 'red' }, strings), strings.readyHint);
});

test('only the first round emphasises the favourite after the answer', () => {
  for (const favourite of PALETTE) {
    const args = { roundsStarted: 1, answered: true, powerStarted: false, favourite };
    assert.equal(favouriteGuidance(args).emphasise, true);
    assert.equal(favouriteGuidance({ ...args, answered: false }).emphasise, false);
    assert.equal(favouriteGuidance({ ...args, roundsStarted: 2 }).emphasise, false);
  }
  assert.match(source, /button\.toggleAttribute\('data-tutorial-favourite',[\s\S]*?guidance\.emphasise && button\.dataset\.color === favourite\)/);
  assert.match(source, /const guidance = favouriteGuidance\(\{ roundsStarted, favourite,/);
});

test('the reminder follows the actual spoken favourite on every round', () => {
  for (const favourite of PALETTE) {
    for (const roundsStarted of [1, 2, 3]) {
      const args = { roundsStarted, answered: true, powerStarted: false, favourite };
      const text = favouriteGuidance(args).reminderText;
      assert.equal(text, `すきないろ: ${favourite.toUpperCase()}`);
      assert.equal(answerFor(LESSON_BY_ID.coloring, favourite), `I like ${favourite}.`);
      assert.equal(favouriteGuidance({ ...args, answered: false }).reminderText, '');
      assert.ok(PALETTE_HEX[favourite]);
    }
  }
  assert.match(source, /data-favourite-reminder hidden/);
  assert.match(source, /favouriteReminder\.hidden = !guidance\.reminderText \|\| phase !== 'coloring'/);
  assert.match(source, /__swatch'\)\.style\.background = PALETTE_HEX\[favourite\]/);
});

test('wrong selection names the actual favourite once, without a second hint on stroke samples', () => {
  for (const favourite of PALETTE) {
    const color = PALETTE.find((entry) => entry !== favourite);
    let result = step(initialTutorialHistory(), { event: 'selection', favourite, color });
    assert.equal(result.hint, `ロボットは ${favourite.toUpperCase()} が すきだよ！`);
    for (let sample = 0; sample < 4; sample += 1) {
      result = step(result.history, { event: 'stroke', favourite, color, meaningful: true });
      assert.equal(result.hint, '');
    }
    // A fresh palette selection can ask for help again, without blocking input.
    assert.ok(step(result.history, { event: 'selection', favourite, color }).hint);
    assert.equal(step(result.history, { event: 'selection', favourite, color: favourite }).hint, '');
  }
});

test('stroke fallback fires once per wrong colour and ignores non-meaningful marks', () => {
  let result = step(initialTutorialHistory(), { event: 'stroke', color: 'red', meaningful: false });
  assert.equal(result.hint, '');
  result = step(result.history, { event: 'stroke', color: 'red', meaningful: true });
  assert.equal(result.hint, 'ロボットは PURPLE が すきだよ！');
  for (const color of ['red', 'red', null, 'purple']) {
    result = step(result.history, { event: 'stroke', color, meaningful: true });
    assert.equal(result.hint, '');
  }
  result = step(result.history, { event: 'stroke', color: 'blue', meaningful: true });
  assert.ok(result.hint);
  assert.deepEqual(result.history.wrongStrokeColors, ['red', 'blue']);
});

test('round two never corrects, and any power increase ends strong guidance for the round', () => {
  for (const event of ['selection', 'stroke']) {
    assert.equal(step(initialTutorialHistory(), {
      event, color: 'red', meaningful: true, roundsStarted: 2,
    }).hint, '');
  }
  const initial = initialTutorialHistory();
  let result = step(initial, { event: 'stroke', color: 'purple', power: 0.001, meaningful: true });
  assert.equal(initial.powerStarted, false, 'the reducer must not mutate its input');
  assert.equal(result.history.powerStarted, true);
  // Undo/erase may lower power; guidance stays retired.
  for (const event of ['selection', 'stroke']) {
    result = step(result.history, { event, color: 'red', power: 0, meaningful: true });
    assert.equal(result.hint, '');
    assert.equal(favouriteGuidance({ ...context, answered: true,
      powerStarted: result.history.powerStarted }).emphasise, false);
  }
});

test('reduced motion retains a static tutorial ring, glow and downward arrow', () => {
  const reducedMotion = source.slice(source.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(reducedMotion, /\.coloring-swatch\[data-tutorial-favourite\] \{ animation: none;\s*outline: [^;]+;[\s\S]*?box-shadow:/);
  assert.match(reducedMotion, /\.coloring-swatch\[data-tutorial-favourite\]::after \{ content: '▼'; \}/);
  assert.match(source, /animation: coloring-favourite-pulse 1\.2s ease-in-out infinite/);
});

test('the answer bubble persists, corrective hints expire, and debug details use the dev/editor gate', () => {
  const begin = source.slice(source.indexOf('function beginColoring()'), source.indexOf('function selectColor('));
  assert.doesNotMatch(begin, /bubble\.hidden = true/);
  assert.match(source, /tutorialHintTimer = setTimeout\([\s\S]*?2500\)/);
  assert.match(source, /import\.meta\.env\?\.DEV\)[\s\S]*?has\('editor'\)\) \? \{\s*tutorialRound:/);
  assert.match(source, /tutorialEmphasisVisible:/);
  assert.match(source, /favouriteReminderText:/);
});
