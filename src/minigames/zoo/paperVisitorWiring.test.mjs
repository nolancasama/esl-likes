import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { chooseCreationSlots } from '../../systems/creationCasting.js';
import { SUBJECTS } from '../coloring/subjectRegistry.js';

/**
 * A creation that visits the zoo is a VISITOR, never an exhibit.
 *
 * This is the one thing about the feature that would be genuinely bad to get
 * wrong: a child asked "What animal do you like?" must not be able to satisfy
 * it by photographing their own ninja. The separation is structural — paper
 * characters are pushed into `visitors` and nothing else, and photo framing
 * reads only `zooWorld.habitats`, which `index.js` never writes to — so it is
 * asserted against the source, where a stray push would actually show up.
 */
const source = readFileSync(new URL('./index.js', import.meta.url), 'utf8');

test('paper creations are built in exactly one place, as visitors', () => {
  const built = [...source.matchAll(/createPaperCharacter\(/g)];
  assert.equal(built.length, 1, 'paper characters are constructed in more than one place');

  const build = source.indexOf('function buildCharacters(');
  const next = source.indexOf('function activateVisitors(');
  assert.ok(build > 0 && next > build);
  assert.match(source.slice(build, next), /createPaperCharacter\(/,
    'paper visitors are not built with the rest of the visitors');
});

test('the Zoo never adds anything to the photo-target collection', () => {
  // Photo framing iterates `zooWorld.habitats`. The controller may only READ
  // it; the moment it writes, a visitor could become photographable.
  assert.doesNotMatch(source, /habitats\s*\.\s*(?:push|splice|unshift|concat)\s*\(/,
    'the Zoo controller now writes to the photo-target collection');
  const reads = [...source.matchAll(/zooWorld\.habitats/g)];
  assert.ok(reads.length >= 2, 'photo framing no longer reads habitats the way this test assumes');
});

test('a paper creation is only ever pushed into visitors', () => {
  const build = source.slice(
    source.indexOf('function buildCharacters('),
    source.indexOf('function activateVisitors('),
  );
  const pushes = [...build.matchAll(/(\w+)\s*\.push\(/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(pushes)], ['visitors'],
    `buildCharacters pushes into ${[...new Set(pushes)].join(', ')}, not just visitors`);
});

test('eligibility for the Zoo comes from subject metadata', () => {
  const build = source.slice(
    source.indexOf('function buildCharacters('),
    source.indexOf('function activateVisitors('),
  );
  assert.match(build, /crossGame\.zooVisitor/);
  assert.doesNotMatch(build, /\.category\b|zooSpecies/,
    'eligibility is inferred rather than declared');
});

test('every subject carries a Zoo presentation, normalised to a human visitor', () => {
  for (const subject of SUBJECTS) {
    const zoo = subject.presentation.zoo;
    assert.ok(zoo, `${subject.id} has no zoo presentation`);
    assert.ok(Number.isFinite(zoo.scale) && zoo.scale > 0, `${subject.id} zoo scale`);
    assert.equal(zoo.groundY, 0.08, `${subject.id} does not stand where a zoo visitor stands`);
    assert.ok(Number.isFinite(zoo.dialogueOffsetY));
  }
});

// --- the guarantee, over a whole zoo session --------------------------------

function seeded(seed) {
  let state = Math.imul(seed, 2654435761) >>> 0;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  for (let warm = 0; warm < 8; warm += 1) next();
  return next;
}

test('with nothing painted, every zoo visitor is an ordinary NPC', () => {
  for (let seed = 1; seed <= 200; seed += 1) {
    const paper = chooseCreationSlots({ slots: 3, eligibleCount: 0, random: seeded(seed) });
    assert.equal(paper.length, 0, `seed ${seed} produced a paper visitor from nothing`);
  }
});

test('one painted creation means every zoo session shows one, and humans remain', () => {
  // Level 1 builds three visitors. A session that turned all three into paper
  // would be as wrong as one that showed none.
  let allPaper = 0;
  for (let seed = 1; seed <= 300; seed += 1) {
    const paper = chooseCreationSlots({ slots: 3, eligibleCount: 1, random: seeded(seed) });
    assert.ok(paper.length >= 1, `seed ${seed} ran a whole zoo session with no paper visitor`);
    if (paper.length === 3) allPaper += 1;
  }
  assert.ok(allPaper / 300 < 0.1, 'paper visitors crowd out the human ones too often');
});

