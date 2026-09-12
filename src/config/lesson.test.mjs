import test from 'node:test';
import assert from 'node:assert/strict';

import { LESSONS, LESSON_BY_ID, answerFor, answerChoices } from './lesson.js';
import { ANSWERS, matchAnswer } from '../systems/speechMatch.js';

test('every lesson defines vocabulary with unique ids and exact answer sentences', () => {
  for (const lesson of LESSONS) {
    assert.ok(lesson.vocabulary.length >= 3, lesson.id);
    const ids = lesson.vocabulary.map((item) => item.id);
    assert.equal(new Set(ids).size, ids.length, `${lesson.id}: duplicate ids`);
    for (const item of lesson.vocabulary) {
      assert.match(item.answer, /^I like .+\.$/, `${lesson.id}/${item.id}`);
    }
    assert.deepEqual([...lesson.answers], ids);
    assert.equal(lesson.answerExample, lesson.vocabulary[0].answer);
  }
});

test('natural plurals are defined per item, never inferred from the label', () => {
  assert.equal(answerFor(LESSON_BY_ID.restaurant, 'hamburger'), 'I like hamburgers.');
  assert.equal(answerFor(LESSON_BY_ID.restaurant, 'curry'), 'I like curry.');
  assert.equal(answerFor(LESSON_BY_ID.restaurant, 'noodles'), 'I like noodles.');
  assert.equal(answerFor(LESSON_BY_ID.zoo, 'elephant'), 'I like elephants.');
  assert.equal(answerFor(LESSON_BY_ID.zoo, 'cat'), 'I like cats.');
  assert.equal(answerFor(LESSON_BY_ID.coloring, 'blue'), 'I like blue.');
});

test('the matcher answer tables match the lesson vocabulary', () => {
  for (const lesson of LESSONS) {
    assert.deepEqual(ANSWERS[lesson.category], [...lesson.answers], lesson.category);
  }
});

test('every NPC answer sentence round-trips through the matcher to its own id', () => {
  for (const lesson of LESSONS) {
    for (const item of lesson.vocabulary) {
      const result = matchAnswer(item.answer, lesson.category);
      assert.equal(result.ok, true, item.answer);
      assert.equal(result.answer, item.id, item.answer);
    }
  }
});

test('answerFor refuses an unknown id instead of inventing a sentence', () => {
  assert.throws(() => answerFor(LESSON_BY_ID.zoo, 'dragon'), /No vocabulary item/);
});

test('answerChoices offers one exact sentence per item, optionally a subset', () => {
  const all = answerChoices(LESSON_BY_ID.restaurant);
  assert.equal(all.length, 5);
  assert.deepEqual(all[2], { sentence: 'I like hamburgers.', value: 'hamburger' });
  const some = answerChoices(LESSON_BY_ID.coloring, ['red', 'yellow']);
  assert.deepEqual(some.map((choice) => choice.value), ['red', 'yellow']);
});
