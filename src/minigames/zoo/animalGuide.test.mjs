import test from 'node:test';
import assert from 'node:assert/strict';

import { LESSON_BY_ID, UI } from '../../config/lesson.js';
import { createThumbnailCache, deriveAnimalGuideEntries } from './animalGuide.js';

const EXPECTED = [
  ['cat', 'Cat', 'ねこ'],
  ['chicken', 'Chicken', 'にわとり'],
  ['dog', 'Dog', 'いぬ'],
  ['horse', 'Horse', 'うま'],
  ['pig', 'Pig', 'ぶた'],
  ['raccoon', 'Raccoon', 'あらいぐま'],
  ['sheep', 'Sheep', 'ひつじ'],
  ['wolf', 'Wolf', 'おおかみ'],
];

test('animal guide entries derive all English and Japanese names from the live roster', () => {
  const entries = deriveAnimalGuideEntries(LESSON_BY_ID.zoo.vocabulary, UI.zoo.animalNames);
  assert.equal(entries.length, 8);
  assert.deepEqual(entries.map(({ id, english, japanese }) => [id, english, japanese]), EXPECTED);
});

test('thumbnail rendering runs once across two guide opens and caches failure fallbacks', async () => {
  const entries = EXPECTED.map(([id]) => ({ id }));
  let renders = 0;
  const cache = createThumbnailCache(async (requested) => {
    renders += 1;
    return new Map(requested.map(({ id }) => [id, id === 'wolf' ? null : `data:${id}`]));
  });

  const first = await cache.load(entries);
  const second = await cache.load(entries);
  assert.equal(renders, 1);
  assert.equal(first, second);
  assert.equal(first.get('cat'), 'data:cat');
  assert.equal(first.get('wolf'), null);
});

test('a failed thumbnail batch becomes a harmless cached name-only fallback', async () => {
  let renders = 0;
  const cache = createThumbnailCache(async () => {
    renders += 1;
    throw new Error('renderer unavailable');
  });
  const entries = [{ id: 'cat' }];
  assert.equal((await cache.load(entries)).get('cat'), null);
  assert.equal((await cache.load(entries)).get('cat'), null);
  assert.equal(renders, 1);
});
