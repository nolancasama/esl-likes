import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CATEGORY,
  VARIANTS,
  ANSWERS,
  normalise,
  levenshtein,
  hasWord,
  matchQuestion,
  matchAnswer,
  matchBest,
} from './speechMatch.js';

// ---------------------------------------------------------------------------
// normalise
// ---------------------------------------------------------------------------
test('normalise lowercases text', () => {
  assert.equal(normalise('Hello World'), 'hello world');
});

test('normalise strips punctuation', () => {
  assert.equal(normalise('What?! food...'), 'what food');
});

test('normalise collapses whitespace', () => {
  assert.equal(normalise('  what   food  do  you  like  '), 'what food do you like');
});

test('normalise handles empty string', () => {
  assert.equal(normalise(''), '');
});

test('normalise preserves digits', () => {
  assert.equal(normalise('abc123'), 'abc123');
});

// ---------------------------------------------------------------------------
// levenshtein
// ---------------------------------------------------------------------------
test('levenshtein identical strings', () => {
  assert.equal(levenshtein('hello', 'hello'), 0);
});

test('levenshtein empty vs non-empty', () => {
  assert.equal(levenshtein('', 'abc'), 3);
  assert.equal(levenshtein('abc', ''), 3);
});

test('levenshtein both empty', () => {
  assert.equal(levenshtein('', ''), 0);
});

test('levenshtein one substitution', () => {
  assert.equal(levenshtein('cat', 'bat'), 1);
});

test('levenshtein one insertion', () => {
  assert.equal(levenshtein('cat', 'cats'), 1);
});

test('levenshtein one deletion', () => {
  assert.equal(levenshtein('cats', 'cat'), 1);
});

test('levenshtein like vs bike', () => {
  assert.equal(levenshtein('like', 'bike'), 1);
});

test('levenshtein tea vs sea', () => {
  assert.equal(levenshtein('tea', 'sea'), 1);
});

test('levenshtein completely different', () => {
  assert.equal(levenshtein('abc', 'xyz'), 3);
});

// ---------------------------------------------------------------------------
// hasWord
// ---------------------------------------------------------------------------
test('hasWord exact match', () => {
  assert.ok(hasWord(['what', 'food', 'like'], 'food'));
});

test('hasWord variant table match for food=foot', () => {
  assert.ok(hasWord(['foot'], 'food'));
});

test('hasWord variant table match for color=caller', () => {
  assert.ok(hasWord(['caller'], 'color'));
});

test('hasWord variant table match for color=collar', () => {
  assert.ok(hasWord(['collar'], 'color'));
});

test('hasWord variant table match for animal=anime', () => {
  assert.ok(hasWord(['anime'], 'animal'));
});

test('hasWord variant table match for sport=spot', () => {
  assert.ok(hasWord(['spot'], 'sport'));
});

test('hasWord variant table match for what=wat', () => {
  assert.ok(hasWord(['wat'], 'what'));
});

test('hasWord variant table match for what=wot', () => {
  assert.ok(hasWord(['wot'], 'what'));
});

test('hasWord "like" does NOT match "bike"', () => {
  assert.ok(!hasWord(['bike'], 'like'));
});

test('hasWord "tea" does NOT match "sea"', () => {
  assert.ok(!hasWord(['sea'], 'tea'));
});

test('hasWord "tea" does NOT match "key"', () => {
  assert.ok(!hasWord(['key'], 'tea'));
});

test('hasWord longer words get fuzz slack', () => {
  // hamburger (9 chars) should tolerate edit distance up to 2
  // "hamburgr" is dist 1 from "hamburger"
  assert.ok(hasWord(['hamburgr'], 'hamburger'));
});

test('hasWord no match returns false', () => {
  assert.ok(!hasWord(['something', 'else'], 'food'));
});

test('hasWord empty tokens', () => {
  assert.ok(!hasWord([], 'food'));
});

test('hasWord is case insensitive', () => {
  assert.ok(hasWord(['FOOD'], 'food'));
  assert.ok(hasWord(['Food'], 'food'));
});

test('hasWord variant match for like=rike', () => {
  assert.ok(hasWord(['rike'], 'like'));
});

test('hasWord variant match for drink=dring', () => {
  assert.ok(hasWord(['dring'], 'drink'));
});

// ---------------------------------------------------------------------------
// VARIANTS table sanity
// ---------------------------------------------------------------------------
test('VARIANTS table has all required keys', () => {
  assert.ok(VARIANTS.food);
  assert.ok(VARIANTS.color);
  assert.ok(VARIANTS.drink);
  assert.ok(VARIANTS.sport);
  assert.ok(VARIANTS.animal);
  assert.ok(VARIANTS.what);
  assert.ok(VARIANTS.like);
});

test('VARIANTS includes the SPEC.md verbatim entries for food', () => {
  for (const v of ['food', 'foot', 'hood', 'foods', 'fud', 'whod']) {
    assert.ok(VARIANTS.food.includes(v), `food variants should include "${v}"`);
  }
});

test('VARIANTS includes the SPEC.md verbatim entries for color', () => {
  for (const v of ['color', 'colour', 'caller', 'collar', 'cooler', 'kara']) {
    assert.ok(VARIANTS.color.includes(v), `color variants should include "${v}"`);
  }
});

test('VARIANTS includes the SPEC.md verbatim entries for what', () => {
  for (const v of ['what', 'wat', 'hwat', 'watt', 'wot', 'but']) {
    assert.ok(VARIANTS.what.includes(v), `what variants should include "${v}"`);
  }
});

// ---------------------------------------------------------------------------
// ANSWERS table sanity
// ---------------------------------------------------------------------------
test('ANSWERS has all five categories', () => {
  assert.deepEqual(Object.keys(ANSWERS).sort(), ['animal', 'color', 'drink', 'food', 'sport']);
});

test('ANSWERS food matches SPEC.md', () => {
  assert.deepEqual(ANSWERS.food, ['curry', 'pizza', 'hamburger', 'ramen', 'sushi']);
});

test('ANSWERS color matches SPEC.md', () => {
  assert.deepEqual(ANSWERS.color, ['red', 'blue', 'yellow', 'green', 'pink', 'purple', 'orange']);
});

test('ANSWERS drink matches SPEC.md', () => {
  assert.deepEqual(ANSWERS.drink, ['water', 'milk', 'orange juice', 'apple juice', 'tea', 'soda']);
});

test('ANSWERS sport matches SPEC.md', () => {
  assert.deepEqual(ANSWERS.sport, ['soccer', 'basketball', 'baseball', 'volleyball']);
});

test('ANSWERS animal matches SPEC.md', () => {
  assert.deepEqual(ANSWERS.animal, [
    'cat', 'chicken', 'dog', 'horse', 'pig', 'raccoon', 'sheep', 'wolf',
  ]);
});

// ---------------------------------------------------------------------------
// matchQuestion — accepts clean sentences for all five categories
// ---------------------------------------------------------------------------
test('matchQuestion accepts clean "What food do you like?"', () => {
  const r = matchQuestion('What food do you like?', 'food');
  assert.ok(r.ok);
  assert.ok(r.what);
  assert.ok(r.noun);
  assert.ok(r.like);
});

test('matchQuestion accepts clean "What color do you like?"', () => {
  assert.ok(matchQuestion('What color do you like?', 'color').ok);
});

test('matchQuestion accepts clean "What drink do you like?"', () => {
  assert.ok(matchQuestion('What drink do you like?', 'drink').ok);
});

test('matchQuestion accepts clean "What sport do you like?"', () => {
  assert.ok(matchQuestion('What sport do you like?', 'sport').ok);
});

test('matchQuestion accepts clean "What animal do you like?"', () => {
  assert.ok(matchQuestion('What animal do you like?', 'animal').ok);
});

// ---------------------------------------------------------------------------
// matchQuestion — accepts realistic mis-hearings
// ---------------------------------------------------------------------------
test('matchQuestion accepts "wat foot like"', () => {
  assert.ok(matchQuestion('wat foot like', 'food').ok);
});

test('matchQuestion accepts "wot caller rike"', () => {
  assert.ok(matchQuestion('wot caller rike', 'color').ok);
});

test('matchQuestion accepts "but spot like"', () => {
  assert.ok(matchQuestion('but spot like', 'sport').ok);
});

test('matchQuestion accepts "wat anime like"', () => {
  assert.ok(matchQuestion('wat anime like', 'animal').ok);
});

test('matchQuestion accepts "hwat dring rike"', () => {
  assert.ok(matchQuestion('hwat dring rike', 'drink').ok);
});

// ---------------------------------------------------------------------------
// matchQuestion — accepts sentences missing "do" and "you"
// ---------------------------------------------------------------------------
test('matchQuestion accepts "What food like?"', () => {
  assert.ok(matchQuestion('What food like?', 'food').ok);
});

test('matchQuestion accepts "what color like"', () => {
  assert.ok(matchQuestion('what color like', 'color').ok);
});

test('matchQuestion accepts "what sport like" (no do/you)', () => {
  assert.ok(matchQuestion('what sport like', 'sport').ok);
});

// ---------------------------------------------------------------------------
// matchQuestion — REJECTS bad inputs
// ---------------------------------------------------------------------------
test('matchQuestion rejects missing category noun', () => {
  const r = matchQuestion('What do you like?', 'food');
  assert.ok(!r.ok);
  assert.ok(!r.noun);
});

test('matchQuestion rejects missing "like"', () => {
  const r = matchQuestion('What food do you want?', 'food');
  assert.ok(!r.ok);
  assert.ok(!r.like);
});

test('matchQuestion rejects wrong category noun', () => {
  // asking about food category but said "color"
  const r = matchQuestion('What color do you like?', 'food');
  assert.ok(!r.ok);
  assert.ok(!r.noun); // "color" is not the "food" noun
});

test('matchQuestion rejects empty input', () => {
  const r = matchQuestion('', 'food');
  assert.ok(!r.ok);
});

test('matchQuestion rejects gibberish', () => {
  const r = matchQuestion('xyzzy plugh grork', 'food');
  assert.ok(!r.ok);
  assert.ok(!r.what);
  assert.ok(!r.noun);
  assert.ok(!r.like);
});

// ---------------------------------------------------------------------------
// matchQuestion — returns text and tokens
// ---------------------------------------------------------------------------
test('matchQuestion returns normalised text and tokens', () => {
  const r = matchQuestion('What FOOD do you LIKE?', 'food');
  assert.equal(r.text, 'what food do you like');
  assert.deepEqual(r.tokens, ['what', 'food', 'do', 'you', 'like']);
});

// ---------------------------------------------------------------------------
// matchAnswer
// ---------------------------------------------------------------------------
test('matchAnswer accepts "I like pizza" for food', () => {
  const r = matchAnswer('I like pizza', 'food');
  assert.ok(r.ok);
  assert.ok(r.like);
  assert.equal(r.answer, 'pizza');
});

test('matchAnswer accepts "I like curry" for food', () => {
  const r = matchAnswer('I like curry', 'food');
  assert.ok(r.ok);
  assert.equal(r.answer, 'curry');
});

test('matchAnswer accepts "I like red" for color', () => {
  const r = matchAnswer('I like red', 'color');
  assert.ok(r.ok);
  assert.equal(r.answer, 'red');
});

test('matchAnswer accepts multi-word "I like orange juice" for drink', () => {
  const r = matchAnswer('I like orange juice', 'drink');
  assert.ok(r.ok);
  assert.equal(r.answer, 'orange juice');
});

test('matchAnswer accepts "I like apple juice" for drink', () => {
  const r = matchAnswer('I like apple juice', 'drink');
  assert.ok(r.ok);
  assert.equal(r.answer, 'apple juice');
});

test('matchAnswer accepts "I like soccer" for sport', () => {
  const r = matchAnswer('I like soccer', 'sport');
  assert.ok(r.ok);
  assert.equal(r.answer, 'soccer');
});

test('matchAnswer accepts "I like chicken" for animal', () => {
  const r = matchAnswer('I like chicken', 'animal');
  assert.ok(r.ok);
  assert.equal(r.answer, 'chicken');
});

test('matchAnswer rejects answer with no recognised category word', () => {
  const r = matchAnswer('I like xyzzy', 'food');
  assert.ok(!r.ok);
  assert.equal(r.answer, null);
});

test('matchAnswer rejects answer without "like"', () => {
  const r = matchAnswer('pizza is good', 'food');
  assert.ok(!r.ok);
});

test('matchAnswer rejects empty input', () => {
  const r = matchAnswer('', 'food');
  assert.ok(!r.ok);
});

test('matchAnswer returns normalised text and tokens', () => {
  const r = matchAnswer('I Like Pizza!', 'food');
  assert.equal(r.text, 'i like pizza');
  assert.deepEqual(r.tokens, ['i', 'like', 'pizza']);
});

test('matchAnswer accepts single-word drink "I like tea"', () => {
  const r = matchAnswer('I like tea', 'drink');
  assert.ok(r.ok);
  assert.equal(r.answer, 'tea');
});

test('matchAnswer accepts "I like soda" for drink', () => {
  const r = matchAnswer('I like soda', 'drink');
  assert.ok(r.ok);
  assert.equal(r.answer, 'soda');
});

// ---------------------------------------------------------------------------
// matchBest
// ---------------------------------------------------------------------------
test('matchBest returns first passing alternative', () => {
  const r = matchBest(
    ['gibberish', 'What food do you like?', 'more gibberish'],
    (t) => matchQuestion(t, 'food'),
  );
  assert.ok(r.ok);
});

test('matchBest falls back to first result when none pass', () => {
  const r = matchBest(
    ['gibberish one', 'gibberish two'],
    (t) => matchQuestion(t, 'food'),
  );
  assert.ok(!r.ok);
  // Should be the result from the first alternative
  assert.equal(r.text, 'gibberish one');
});

test('matchBest prefers second passing alternative over failing first', () => {
  const r = matchBest(
    ['xyzzy plugh', 'What food do you like?'],
    (t) => matchQuestion(t, 'food'),
  );
  assert.ok(r.ok);
  assert.equal(r.text, 'what food do you like');
});

test('matchBest with empty alternatives array', () => {
  const r = matchBest([], (t) => matchQuestion(t, 'food'));
  assert.ok(!r.ok);
});

test('matchBest with single passing alternative', () => {
  const r = matchBest(
    ['What food do you like?'],
    (t) => matchQuestion(t, 'food'),
  );
  assert.ok(r.ok);
});

test('matchBest works with matchAnswer judge', () => {
  const r = matchBest(
    ['something wrong', 'I like pizza'],
    (t) => matchAnswer(t, 'food'),
  );
  assert.ok(r.ok);
  assert.equal(r.answer, 'pizza');
});

// ---------------------------------------------------------------------------
// Additional edge cases / strictness checks
// ---------------------------------------------------------------------------
test('short word "red" does not match "bed" by fuzz', () => {
  assert.ok(!hasWord(['bed'], 'red'));
});

test('short word "blue" does not match "glue" by fuzz', () => {
  assert.ok(!hasWord(['glue'], 'blue'));
});

test('hasWord matches "basketball" with small typo by fuzz', () => {
  // "basktball" is dist 2 from "basketball" (10 chars, maxDist=2)
  assert.ok(hasWord(['basktball'], 'basketball'));
});

test('hasWord matches "volleyball" with small typo by fuzz', () => {
  // "voleyball" is dist 1 from "volleyball" (10 chars, maxDist=2)
  assert.ok(hasWord(['voleyball'], 'volleyball'));
});

test('matchQuestion with mixed case and punctuation', () => {
  assert.ok(matchQuestion('WHAT FOOD DO YOU LIKE???', 'food').ok);
});

test('CATEGORY object has exactly five categories', () => {
  assert.equal(Object.keys(CATEGORY).length, 5);
  assert.equal(CATEGORY.food, 'food');
  assert.equal(CATEGORY.color, 'color');
  assert.equal(CATEGORY.drink, 'drink');
  assert.equal(CATEGORY.sport, 'sport');
  assert.equal(CATEGORY.animal, 'animal');
});

test('all functions are pure (no side effects)', () => {
  // Just verify they return values without accessing globals
  const n = normalise('test');
  const l = levenshtein('a', 'b');
  const h = hasWord(['test'], 'test');
  const q = matchQuestion('what food like', 'food');
  const a = matchAnswer('I like pizza', 'food');
  const b = matchBest(['test'], (t) => ({ ok: false }));
  assert.equal(typeof n, 'string');
  assert.equal(typeof l, 'number');
  assert.equal(typeof h, 'boolean');
  assert.equal(typeof q.ok, 'boolean');
  assert.equal(typeof a.ok, 'boolean');
  assert.equal(typeof b.ok, 'boolean');
});

// The recogniser can hand back undefined for an empty result. Judging a
// transcript must never throw mid-round.
test('normalise coerces non-string input instead of throwing', () => {
  assert.equal(normalise(undefined), '');
  assert.equal(normalise(null), '');
  assert.equal(normalise(123), '123');
});

test('matchQuestion survives a missing transcript', () => {
  for (const bad of [undefined, null, 123]) {
    assert.equal(matchQuestion(bad, CATEGORY.food).ok, false);
  }
});

test('matchAnswer survives a missing transcript', () => {
  for (const bad of [undefined, null, 123]) {
    assert.equal(matchAnswer(bad, CATEGORY.food).ok, false);
  }
});

// Vocabulary answers use natural plurals, and a child may say either form.
// Irregular plurals and short words are declared explicitly.
test('matchAnswer accepts plural answers and reports the vocabulary id', () => {
  const cases = [
    ['I like chickens', 'animal', 'chicken'],
    ['I like horses', 'animal', 'horse'],
    ['I like dogs', 'animal', 'dog'],
    ['I like cats', 'animal', 'cat'],
    ['I like pigs', 'animal', 'pig'],
    ['I like raccoons', 'animal', 'raccoon'],
    ['I like sheep', 'animal', 'sheep'],
    ['I like wolves', 'animal', 'wolf'],
    ['I like hamburgers', 'food', 'hamburger'],
  ];
  for (const [text, category, id] of cases) {
    const result = matchAnswer(text, category);
    assert.equal(result.ok, true, text);
    assert.equal(result.answer, id, text);
  }
});

test('the short animal names list their plurals and homophones explicitly', () => {
  // len <= 4 gets no fuzz slack at all, so "dogs" would never reach "dog".
  assert.deepEqual(VARIANTS.dog, ['dog', 'dogs', 'doggu', 'dogu', 'dock', 'doggy']);
  assert.deepEqual(VARIANTS.cat, ['cat', 'cats', 'kat', 'cut', 'catto', 'kyatto']);
  assert.deepEqual(VARIANTS.pig, ['pig', 'pigs', 'piggu', 'pigu']);
  assert.deepEqual(VARIANTS.sheep, ['sheep']);
  assert.deepEqual(VARIANTS.wolf, ['wolf', 'wolves']);
});

test('matchAnswer still accepts the singular form', () => {
  assert.equal(matchAnswer('I like wolf', 'animal').answer, 'wolf');
  assert.equal(matchAnswer('I like horse', 'animal').answer, 'horse');
  assert.equal(matchAnswer('I like hamburger', 'food').answer, 'hamburger');
});

test('plural stripping does not invent answers', () => {
  assert.equal(matchAnswer('I like trees', 'animal').ok, false);
  assert.equal(matchAnswer('I like buses', 'food').ok, false);
});

// Similar answers sit inside each other's fuzz range ("baseball" is two edits
// from "basketball"). The matcher must pick the closest answer, not the first.
test('matchAnswer picks the closest answer, not the first within fuzz range', () => {
  assert.equal(matchAnswer('I like baseball', 'sport').answer, 'baseball');
  assert.equal(matchAnswer('I like basketball', 'sport').answer, 'basketball');
  assert.equal(matchAnswer('I like bassball', 'sport').answer, 'baseball');
  assert.equal(matchAnswer('I like apple juice', 'drink').answer, 'apple juice');
  assert.equal(matchAnswer('I like orange juice', 'drink').answer, 'orange juice');
});
