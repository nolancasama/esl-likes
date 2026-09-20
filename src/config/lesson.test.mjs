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
  assert.equal(answerFor(LESSON_BY_ID.restaurant, 'ramen'), 'I like ramen.');
  assert.equal(answerFor(LESSON_BY_ID.zoo, 'elephant'), 'I like elephants.');
  assert.equal(answerFor(LESSON_BY_ID.zoo, 'deer'), 'I like deer.');
  assert.equal(answerFor(LESSON_BY_ID.coloring, 'blue'), 'I like blue.');
});

test('the Zoo keeps its frozen animal order and exact sentences', () => {
  assert.deepEqual(LESSON_BY_ID.zoo.vocabulary.map(({ id, answer }) => ({ id, answer })), [
    { id: 'elephant', answer: 'I like elephants.' },
    { id: 'giraffe', answer: 'I like giraffes.' },
    { id: 'penguin', answer: 'I like penguins.' },
    { id: 'tiger', answer: 'I like tigers.' },
    { id: 'deer', answer: 'I like deer.' },
    { id: 'alpaca', answer: 'I like alpacas.' },
    { id: 'horse', answer: 'I like horses.' },
    { id: 'fox', answer: 'I like foxes.' },
    { id: 'wolf', answer: 'I like wolves.' },
    { id: 'stag', answer: 'I like stags.' },
    { id: 'bull', answer: 'I like bulls.' },
    { id: 'cow', answer: 'I like cows.' },
    { id: 'donkey', answer: 'I like donkeys.' },
  ]);
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
