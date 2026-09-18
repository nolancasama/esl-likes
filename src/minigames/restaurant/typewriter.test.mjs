import test from 'node:test';
import assert from 'node:assert/strict';

import { UI } from '../../config/lesson.js';
import { createTypewriter, parseFurigana } from './typewriter.js';

function visibleText(units) {
  return units.map((unit) => {
    if (unit.kind === 'ruby') return unit.base;
    return unit.text;
  }).join('');
}

test('parseFurigana creates one unit per plain character and preserves newlines', () => {
  const units = parseFurigana('あA！\nい');
  assert.deepEqual(units, [
    { kind: 'text', text: 'あ', cost: 1 },
    { kind: 'text', text: 'A', cost: 1 },
    { kind: 'text', text: '！', cost: 1 },
    { kind: 'line-break', text: '\n', cost: 0 },
    { kind: 'text', text: 'い', cost: 1 },
  ]);
});

test('parseFurigana makes ruby indivisible and costs it by base length', () => {
  const units = parseFurigana('{勝負|しょうぶ}だ');
  assert.deepEqual(units, [
    { kind: 'ruby', base: '勝負', reading: 'しょうぶ', cost: 2 },
    { kind: 'text', text: 'だ', cost: 1 },
  ]);
});

test('the real rival challenge parses to valid ruby units and its plain sentence', () => {
  const units = parseFurigana(UI.restaurant.rivalChallenge);
  assert.equal(visibleText(units), '勝負しよう！\nどっちがたくさん料理を運べるかな？');
  assert.deepEqual(
    units.filter(({ kind }) => kind === 'ruby').map(({ base, reading, cost }) => ({ base, reading, cost })),
    [
      { base: '勝負', reading: 'しょうぶ', cost: 2 },
      { base: '料理', reading: 'りょうり', cost: 2 },
      { base: '運', reading: 'はこ', cost: 1 },
    ],
  );
  assert.equal(units.filter(({ kind }) => kind === 'line-break').length, 1);
  assert.equal(createTypewriter({ units }).totalCost, 23);
});

test('a short update partially reveals plain text', () => {
  const writer = createTypewriter({ units: parseFurigana('abcdef') });
  assert.equal(writer.visibleUnitCount, 0);
  writer.advance(0.05);
  assert.equal(writer.visibleUnitCount, 1);
  assert.equal(writer.revealedCost, 1);
  assert.equal(writer.complete, false);
});

test('the default reveal rate is about 30 cost units per second', () => {
  const writer = createTypewriter({ units: parseFurigana('abcdefghijklmnopqrstuvwxyz1234567890') });
  writer.advance(0.5);
  assert.equal(writer.revealedCost, 15);
  writer.advance(0.5);
  assert.equal(writer.revealedCost, 30);
  assert.equal(writer.charsPerSecond, 30);
});

test('revealAll completes the line immediately', () => {
  const units = parseFurigana('はじめ\n{料理|りょうり}');
  const writer = createTypewriter({ units });
  assert.equal(writer.revealAll(), units.length);
  assert.equal(writer.visibleUnitCount, units.length);
  assert.equal(writer.revealedCost, writer.totalCost);
  assert.equal(writer.complete, true);
});

test('advance never splits a ruby unit', () => {
  const writer = createTypewriter({ units: parseFurigana('{勝負|しょうぶ}しよう') });
  writer.advance(0.05); // 1.5 cost units: not enough for the two-cost ruby.
  assert.equal(writer.visibleUnitCount, 0);
  assert.equal(writer.revealedCost, 0);
  writer.advance(0.02);
  assert.equal(writer.visibleUnitCount, 1);
  assert.equal(writer.revealedCost, 2);
  assert.equal(writer.units[0].kind, 'ruby');
});

test('a zero-cost line break becomes visible with the preceding character', () => {
  const writer = createTypewriter({ units: parseFurigana('a\nb') });
  writer.advance(1 / 30);
  assert.equal(writer.visibleUnitCount, 2);
  assert.equal(writer.revealedCost, 1);
});
