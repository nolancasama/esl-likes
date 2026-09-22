import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { UI } from '../../config/lesson.js';

/**
 * Guards for the easel loop.
 *
 * The loop itself is behaviour, and behaviour that needs a canvas, three.js, a
 * camera and a speech stack — so it is judged by `npm run playthrough:coloring`
 * in a real browser, not here. There is no jsdom in this project and adding one
 * to half-simulate a DOM would buy a worse test than the browser already gives.
 *
 * What is worth guarding here is the small set of invariants a playthrough
 * *cannot* see, because they are about code and copy rather than about a frame:
 * that a deleted phase has not crept back under its old name, that nothing
 * evicts a robot, that there is exactly one way out, and that the strings the
 * old design needed are gone rather than orphaned.
 */

const source = readFileSync(new URL('./index.js', import.meta.url), 'utf8');
const STRINGS = UI.coloring;

// --- the phase vocabulary ---------------------------------------------------

/** Every phase the frozen spec names, and nothing else. */
const PHASES = [
  'inactive',
  'canvas-question',
  'canvas-answer',
  'coloring',
  'activation-page',
  'reveal-easel',
  'robot-exit',
  'room-reveal',
  'room',
  'to-canvas',
  'turnaround',
  'finishing',
];

test('every phase the controller sets is one the spec names', () => {
  const assigned = [...source.matchAll(/phase = '([a-z-]+)'/g)].map((m) => m[1]);
  assert.ok(assigned.length >= PHASES.length - 2, `only ${assigned.length} phases are ever set`);
  for (const phase of new Set(assigned)) {
    assert.ok(PHASES.includes(phase), `'${phase}' is not in the frozen phase list`);
  }
});

test('the deleted phases have not crept back under their old names', () => {
  // The old single-round design. Each of these was a real phase, and the plan
  // is explicit that they are deleted rather than bypassed.
  for (const gone of ['approach', 'gift', 'reaction', 'landing', 'transition-to-painting', 'transition-to-room']) {
    assert.ok(!source.includes(`phase = '${gone}'`), `the '${gone}' phase is back`);
    assert.ok(!source.includes(`phase === '${gone}'`), `something still tests for the '${gone}' phase`);
  }
});

test('the artist, the gift and the wall frame are gone from the controller', () => {
  for (const gone of ['npcPicture', 'carriedPicture', 'framePicture', 'frameMaterial', 'givePicture', 'faceNpcToPlayer', 'playerNearNpc']) {
    assert.ok(!source.includes(gone), `${gone} survives — the old artist/gift design is still in here`);
  }
  assert.ok(!/characters\.create\(\{\s*model:\s*'b'/.test(source), 'the artist NPC is still created');
});

// --- the invariants a playthrough cannot see --------------------------------

test('nothing ever removes a robot from the room', () => {
  // "Keep every robot" is the reward. An eviction would be invisible for the
  // first few rounds and then quietly cap the room.
  for (const eviction of ['livingRobots.shift', 'livingRobots.pop', 'livingRobots.splice']) {
    assert.ok(!source.includes(eviction), `${eviction} evicts a robot the child made`);
  }
  // The only permitted clear-out is teardown.
  const clears = [...source.matchAll(/livingRobots\.length = 0/g)];
  assert.equal(clears.length, 2, 'livingRobots is emptied somewhere other than enter() and exit()');
});

test('there is exactly one call to finish, and it is the turnaround', () => {
  const calls = [...source.matchAll(/\bfinish\(\{/g)];
  assert.equal(calls.length, 1, `finish() is called ${calls.length} times`);
  assert.ok(/phase === 'finishing'|phase = 'finishing'/.test(source));
  assert.ok(source.includes('finishCalled'), 'nothing guards finish() against a second call');
});

test('stars come from the robot count, and no per-round score survives', () => {
  assert.ok(source.includes('sessionStars(livingRobots.length)'));
  assert.ok(!source.includes('scoreRound'), 'the deleted per-round scorer is still referenced');
});

test('the puppet is built from the live paint before the surface is torn down', () => {
  // Reversed, this silently produces blank robots: the paint canvas is zeroed
  // by `disposePaintingOverlay`, and a puppet built afterwards copies nothing.
  const build = source.indexOf('createPaperPuppet({ paint: surface.paint');
  const teardown = source.indexOf('disposePaintingOverlay();', build);
  assert.ok(build > 0, 'the puppet is not built from the live paint canvas');
  assert.ok(teardown > build, 'the painting surface is disposed before the puppet copies it');
});

test('the shared paper assets are freed once, on the way out', () => {
  const calls = [...source.matchAll(/disposeSharedPaperAssets\(\)/g)];
  assert.equal(calls.length, 1, 'the shared quad and gradients are freed somewhere other than exit()');
  // And after every puppet, or a puppet outlives the geometry it draws with.
  const puppets = source.indexOf('robot.puppet.dispose()');
  assert.ok(puppets > 0 && puppets < source.indexOf('disposeSharedPaperAssets()'));
});

test('the close-up sits below the HUD, so the Talk control is reachable', () => {
  // Both were z-index 20, and this overlay is appended later — so the page
  // covered the only button the child needs in order to ask the question.
  assert.match(source, /\.coloring-screen \{[^}]*z-index: 18/);
});

// --- the copy ---------------------------------------------------------------

test('the strings the new loop needs all exist', () => {
  for (const key of ['roomName', 'askRobot', 'paintTitle', 'chooseColor', 'paintHint',
    'power', 'powerFull', 'alive', 'roomHint', 'easelAction', 'doorLabel', 'doorAction',
    'turnaround', 'complete']) {
    assert.equal(typeof STRINGS[key], 'string', `UI.coloring.${key} is missing`);
    assert.ok(STRINGS[key].length > 0, `UI.coloring.${key} is empty`);
  }
});

test('the strings the old design needed are gone, not orphaned', () => {
  for (const key of ['walkToArtist', 'askArtist', 'walkToGive', 'givePicture', 'thankYou', 'given']) {
    assert.equal(STRINGS[key], undefined, `UI.coloring.${key} is dead copy`);
  }
});

test('no string tells the child to wait for the next picture', () => {
  // The canvas is interactable in every state, so a "please wait" would be a
  // lie as well as a lockout.
  for (const [key, value] of Object.entries(STRINGS)) {
    if (typeof value !== 'string') continue;
    assert.ok(!value.includes('まって'), `UI.coloring.${key} asks the child to wait: ${value}`);
  }
});

test('the seven colours and three brushes are all still named', () => {
  assert.deepEqual(Object.keys(STRINGS.colors).sort(),
    ['blue', 'green', 'orange', 'pink', 'purple', 'red', 'yellow']);
  assert.deepEqual(Object.keys(STRINGS.brushes).sort(), ['large', 'medium', 'small']);
  for (const key of ['undo', 'eraser', 'reset', 'resetConfirm', 'resetYes', 'resetNo']) {
    assert.equal(typeof STRINGS.tools[key], 'string', `tools.${key} is missing`);
  }
});
