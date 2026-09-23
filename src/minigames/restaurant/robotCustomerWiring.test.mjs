import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { chooseCreationSlots, pickCreation } from '../../systems/creationCasting.js';

/**
 * The promise this feature is allowed to make is a narrow one: a paper
 * customer is a normal customer whose `character` happens to be paper. Nothing
 * downstream of `createCustomer` may ask what kind of customer it is.
 *
 * That is a claim about the *shape* of index.js, not about any value it
 * computes, so it is asserted against the source the way `coloring/loop.test.mjs`
 * asserts the puppet build order. A unit test cannot see a stray subject branch
 * three hundred lines into the service loop; this can.
 */
const source = readFileSync(new URL('./index.js', import.meta.url), 'utf8');

test('the casting decision is made in exactly one place', () => {
  const decisions = [...source.matchAll(/paperSlots\.has\(/g)];
  assert.equal(decisions.length, 1, 'the paper/human decision is taken in more than one place');

  const createCustomer = source.indexOf('function createCustomer(');
  const showPhaseCue = source.indexOf('function showPhaseCue(');
  assert.ok(createCustomer > 0 && showPhaseCue > createCustomer);
  const body = source.slice(createCustomer, showPhaseCue);
  assert.match(body, /paperSlots\.has\(/, 'the decision is not taken at customer creation');
});

test('no customer logic downstream of creation asks what kind of subject it is', () => {
  const afterCreation = source.slice(source.indexOf('function showPhaseCue('));
  assert.doesNotMatch(
    afterCreation,
    /isRobotCustomer|isPaperCustomer|isCreationCustomer|isRobot\b|isPaper\b|\.(?:robot|paper|subject)\b|subjectId|crossGame/,
    'the customer state machine grew a subject branch',
  );
});

test('eligibility comes from subject metadata rather than category', () => {
  const setup = source.slice(
    source.indexOf('function setupCreationCasting('),
    source.indexOf('function createCustomer('),
  );
  assert.match(setup, /crossGame\.restaurantCustomer/);
  assert.doesNotMatch(setup, /\.category\b|zooSpecies/);
  assert.match(source, /savedCreations\(\)/);
  assert.doesNotMatch(source, /savedRobots\(\)/);
});

test('the seated and ground heights come from the customer, not a literal', () => {
  const walk = source.slice(
    source.indexOf('function updateCustomerWalk('),
    source.indexOf('function updateCustomers('),
  );
  assert.match(walk, /position\.y = customer\.seatedY/, 'seating still uses a fixed human height');
  assert.match(walk, /position\.y = customer\.groundY/, 'standing still uses a fixed human height');
  assert.doesNotMatch(walk, /position\.y = 0\.34/, 'the human seated height is still hard-coded');
});

test('the speech and patience bubbles anchor per customer', () => {
  assert.doesNotMatch(
    source,
    /anchor: customer\.character,\s*offsetY: 1\.65/,
    'a customer dialogue still uses the fixed human offset',
  );
  assert.doesNotMatch(
    source,
    /ownership\.position\.y \+= 2\.25/,
    'the ownership bubble still uses the fixed human height',
  );
  assert.match(source, /ownership\.position\.y \+= customer\.bubbleOffsetY/);
});

test('the Restaurant never reaches into the Coloring controller', () => {
  assert.doesNotMatch(source, /from '\.\.\/coloring\/index\.js'/, 'a circular import was introduced');
  assert.match(source, /from '\.\.\/coloring\/coloringSession\.js'/);
});

test('the Restaurant releases shared paper assets only after its paper characters are gone', () => {
  const disposeLoop = source.indexOf("for (const customer of customers) customer.character.disposeCharacter?.();");
  const release = source.indexOf('disposeSharedPaperAssets();');
  assert.ok(disposeLoop > 0, 'the customer disposal loop has moved');
  assert.ok(release > disposeLoop, 'shared assets are released before paper characters that use them');
});

// --- the guarantee, across a whole shift ------------------------------------

/**
 * A seeded generator, so a shift can be replayed exactly.
 *
 * Scrambled and warmed on purpose. A bare LCG's first output is very nearly a
 * straight line in a small seed, so seeds 1..200 all began in the same third of
 * the range and `floor(r * 3)` was 0 every time — which would have quietly
 * turned the "not always the first arrival" assertion below into a test that
 * could never fail for the right reason.
 */
function seeded(seed) {
  let state = Math.imul(seed, 2654435761) >>> 0;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  for (let warm = 0; warm < 8; warm += 1) next();
  return next;
}

/** Casts one whole shift the way Restaurant setup does. */
function castShift({ eligibleCount, shiftLength, seed, extraChance }) {
  const paperSlots = chooseCreationSlots({
    slots: shiftLength,
    eligibleCount,
    random: seeded(seed),
    ...(extraChance === undefined ? {} : { extraChance }),
  });
  return Array.from({ length: shiftLength }, (_, index) => paperSlots.includes(index));
}

test('with nothing painted, every Restaurant customer is a human', () => {
  for (let seed = 1; seed <= 200; seed += 1) {
    const cast = castShift({ eligibleCount: 0, shiftLength: 7, seed });
    assert.ok(!cast.includes(true), `seed ${seed} produced a robot with no saved artwork`);
  }
});

test('one painted creation means every shift contains at least one, never by luck', () => {
  const early = new Set();
  for (let seed = 1; seed <= 200; seed += 1) {
    const cast = castShift({ eligibleCount: 1, shiftLength: 7, seed, extraChance: 0 });
    assert.ok(cast.includes(true), `seed ${seed} ran a whole shift with no paper customer`);
    const guaranteedSlot = cast.findIndex(Boolean);
    assert.ok(guaranteedSlot <= 2, 'the child had to wait past the third arrival to see their robot');
    early.add(guaranteedSlot);
  }
  // Early, but not the same arrival every single time.
  assert.deepEqual([...early].sort(), [0, 1, 2]);
});

test('humans stay the clear majority of a shift', () => {
  let paper = 0;
  let total = 0;
  for (let seed = 1; seed <= 400; seed += 1) {
    const cast = castShift({ eligibleCount: 3, shiftLength: 7, seed });
    paper += cast.filter(Boolean).length;
    total += cast.length;
  }
  const share = paper / total;
  assert.ok(share > 0.1, `paper characters are too rare at ${share}`);
  assert.ok(share < 0.45, `paper characters stopped being the exception at ${share}`);
});

test('paper visits use every saved record before repeats without consuming them', () => {
  const records = [{ artwork: { id: 'a' } }, { artwork: { id: 'b' } }, { artwork: { id: 'c' } }];
  const random = seeded(99);
  let lastIndex = -1;
  const used = new Set();
  const seen = new Set();

  for (let visit = 0; visit < 24; visit += 1) {
    const picked = pickCreation({ records, random, used, lastIndex });
    assert.notEqual(picked.index, lastIndex, 'the same artwork arrived twice in a row');
    assert.ok(records.includes(picked.record), 'a paper customer was handed artwork from nowhere');
    seen.add(picked.index);
    used.add(picked.index);
    lastIndex = picked.index;
  }

  assert.equal(records.length, 3, 'the Restaurant consumed a saved creation');
  assert.deepEqual([...seen].sort(), [0, 1, 2], 'some saved creations never got a visit');
});
