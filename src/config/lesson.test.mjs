import test from 'node:test';
import assert from 'node:assert/strict';

import { LESSONS, LESSON_BY_ID, UI, answerFor, answerChoices } from './lesson.js';
import { ANSWERS, matchAnswer } from '../systems/speechMatch.js';
import { ANIMAL_IDS } from '../minigames/zoo/territories.js';
import { ANIMALS } from '../minigames/zoo/scoring.js';

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
  assert.equal(answerFor(LESSON_BY_ID.zoo, 'chicken'), 'I like chickens.');
  assert.equal(answerFor(LESSON_BY_ID.zoo, 'sheep'), 'I like sheep.');
  assert.equal(answerFor(LESSON_BY_ID.zoo, 'wolf'), 'I like wolves.');
  assert.equal(answerFor(LESSON_BY_ID.coloring, 'blue'), 'I like blue.');
});

test('the animal park keeps its frozen animal order and exact sentences', () => {
  assert.deepEqual(LESSON_BY_ID.zoo.vocabulary.map(({ id, answer }) => ({ id, answer })), [
    { id: 'cat', answer: 'I like cats.' },
    { id: 'chicken', answer: 'I like chickens.' },
    { id: 'dog', answer: 'I like dogs.' },
    { id: 'horse', answer: 'I like horses.' },
    { id: 'pig', answer: 'I like pigs.' },
    { id: 'raccoon', answer: 'I like raccoons.' },
    { id: 'sheep', answer: 'I like sheep.' },
    { id: 'wolf', answer: 'I like wolves.' },
  ]);
});

test('the removed zoo animals are gone from the vocabulary', () => {
  const ids = new Set(LESSON_BY_ID.zoo.answers);
  for (const removed of ['elephant', 'alpaca', 'fox', 'stag', 'bull', 'cow', 'donkey']) {
    assert.ok(!ids.has(removed), `${removed} is still requestable`);
  }
  assert.equal(ids.size, 8);
});

test('every Zoo roster surface exposes exactly the same species set', () => {
  const expected = [...ANIMAL_IDS].sort();
  assert.deepEqual([...ANIMALS].sort(), expected);
  assert.deepEqual([...LESSON_BY_ID.zoo.answers].sort(), expected);
  assert.deepEqual(Object.keys(UI.zoo.animalNames).sort(), expected);
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
