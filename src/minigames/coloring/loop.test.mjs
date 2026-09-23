import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';

import { LESSON_BY_ID, UI, answerFor } from '../../config/lesson.js';
import {
  buildColoringEasel,
  CAMERA,
  createCompletionReadiness,
  PAPER_CAMERA_GAP,
  PAPER_PLANE_Z,
  PAPER_SIZE,
  PUPPET_START_Z,
} from './index.js';

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
const paintingMarkup = source.match(/paintingOverlay\.innerHTML = `([\s\S]*?)`;/)?.[1] ?? '';

function between(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `could not isolate ${start}`);
  return source.slice(from, to);
}

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
  assert.ok(!source.includes('clearColoringSession'), 'controller teardown clears session robots');
});

test('finished robots are saved before teardown and rebuilt after the world', () => {
  const save = source.indexOf('saveCompletedRobot(surface.paint, pendingMember)');
  const paintTeardown = source.indexOf('disposePaintingOverlay();', save);
  assert.ok(save > 0 && paintTeardown > save,
    'the live paint canvas is torn down before the detached session copy');
  const world = source.indexOf('buildWorld();');
  const restore = source.indexOf('restoreSavedRobots();', world);
  assert.ok(world > 0 && restore > world, 'saved robots are not rebuilt after the room exists');
  assert.match(source, /createPaperPuppet\(\{ paint: record\.artwork/);
  assert.match(source, /crowd\.join\(record\.crowd\)/);
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

test('the canvas has balanced columns and hidden controls keep their space', () => {
  assert.match(source,
    /grid-template-columns: minmax\(0, 1fr\) auto minmax\(0, 1fr\)/);
  assert.match(source,
    /data-stage="asking"\] \.coloring-side,[\s\S]*?visibility: hidden;/);
  assert.match(source,
    /coloring-canvas-wrap[\s\S]*?coloring-power[\s\S]*?<\/div>\s*<\/div>\s*<div class="coloring-screen__bottom">/,
    'the vertical meter is not the third work-grid child');
  assert.doesNotMatch(source, /coloring-side-spacer/);
  assert.match(source, /\.coloring-side \{ grid-column: 1 \/ -1; grid-row: 1; \}/,
    'compact controls do not span above the balanced painting row');
  assert.match(source, /\.coloring-power \{ grid-column: 3; grid-row: 2;/,
    'the compact vertical meter is not beside the canvas');
});

test('the Coloring header has one contextual hint and no visible title', () => {
  assert.doesNotMatch(paintingMarkup, /<h1\b/);
  assert.equal([...paintingMarkup.matchAll(/coloring-screen__instruction/g)].length, 1);
  assert.match(paintingMarkup,
    /<header class="coloring-screen__top"><p class="coloring-screen__instruction"><\/p><\/header>/);
  assert.match(source, /paintingCanvas\.setAttribute\('aria-label', STRINGS\.canvasLabel\)/,
    'the title was removed without preserving the canvas accessible name');
});

test('the one hint carries the exact question and all four interaction stages', () => {
  assert.equal(STRINGS.askRobot, 'ボタンを おして、「What color do you like?」と きこう');
  assert.equal([...STRINGS.askRobot.matchAll(/What color do you like\?/g)].length, 1);
  assert.equal(STRINGS.chooseColor, 'いろを えらぼう');
  assert.equal(STRINGS.paintHint, 'すきなように ぬろう！');
  assert.equal(STRINGS.readyHint, 'できたら「できた！」を おそう');
  assert.match(source, /paintInstruction\.textContent = STRINGS\.askRobot/);
  assert.match(source, /paintInstruction\.textContent = STRINGS\.chooseColor/);
  assert.match(source, /\? STRINGS\.readyHint\s*: selectedColor \? STRINGS\.paintHint : STRINGS\.chooseColor/);
});

test('ROBOT POWER is a bottom-anchored vertical progress meter', () => {
  assert.match(source, /powerFill\.style\.height = `\$\{\(clamped \* 100\)\.toFixed\(1\)\}%`/);
  assert.doesNotMatch(source, /powerFill\.style\.width/);
  assert.match(source,
    /\.coloring-power__fill \{ position: absolute; left: 0; right: 0; bottom: 0;/);
  assert.match(source, /transition: height \.18s ease-out/);
  assert.match(paintingMarkup, /role="progressbar"[^>]*aria-valuenow="0"/);
  assert.match(source,
    /powerBar\.setAttribute\('aria-valuenow', String\(Math\.round\(clamped \* 100\)\)\)/);
});

test('full power grants and revokes Done without changing phase', () => {
  const changed = between('function onPaintChanged(info)', 'function finishArtwork()');
  assert.match(changed, /updateReadiness\(info\.power, \{ strokeActive/);
  assert.doesNotMatch(changed, /beginCharging/);
  const readiness = between('function updateReadiness(value', 'function playReadyCue(');
  assert.match(readiness, /completionReadiness\.update\(value\)/);
  assert.match(readiness, /doneButton\.disabled = !ready/);
  assert.match(readiness, /aria-disabled/, 'Done does not announce that it is unavailable');
  // The cue waits for the brush to lift rather than firing mid-drag.
  assert.match(readiness, /if \(!celebrationPending \|\| strokeActive\) return/);
  assert.match(source, /completionReadiness\.reset\(\);[\s\S]*?favourite = PALETTE/,
    'a new round does not reset the celebration state');
});

test('the finished cue waits for the child to lift the brush', () => {
  // The surface reports on every extend, so full power almost always arrives
  // mid-drag. The page must be able to tell that from a completed stroke.
  const picture = readFileSync(new URL('./picture.js', import.meta.url), 'utf8');
  assert.match(picture, /strokeActive: live !== null/,
    'the painting surface no longer says whether a stroke is in progress');
  const finish = picture.slice(picture.indexOf('function finish()'));
  assert.ok(
    finish.indexOf('live = null') < finish.indexOf('report()'),
    'finish must clear the live stroke before reporting, or the last stroke never releases the cue',
  );
});

test('Done pulses three times and then rests, and rests bright without motion', () => {
  assert.match(source, /animation: coloring-done-ready [\d.]+s [^;]*? 3;/,
    'the finished cue is not three pulses');
  assert.doesNotMatch(source, /animation: coloring-done-ready [^;]*?infinite/,
    'the finished cue must never loop');
  assert.match(source, /\.coloring-tool--done:not\(:disabled\)/,
    'Done has no distinct full-power resting state');
  const reduced = source.slice(source.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(reduced.slice(0, 700), /\.coloring-tool--ready-pulse \{ animation: none/,
    'the pulse still runs under prefers-reduced-motion');
});

test('Done celebrates each fresh arrival at full power, never a held one', () => {
  const readiness = createCompletionReadiness();
  assert.deepEqual(readiness.update(0.99), { ready: false, celebrate: false });
  assert.deepEqual(readiness.update(1), { ready: true, celebrate: true });

  // Holding at full must not replay the cue on every stroke or every frame.
  assert.deepEqual(readiness.update(1), { ready: true, celebrate: false });
  assert.deepEqual(readiness.update(1), { ready: true, celebrate: false });

  // Erasing the liked colour and painting it back finishes the picture again,
  // so the invitation is offered again. This deliberately replaces the earlier
  // once-per-round rule.
  assert.deepEqual(readiness.update(0.7), { ready: false, celebrate: false });
  assert.deepEqual(readiness.update(1), { ready: true, celebrate: true });
  assert.deepEqual(readiness.update(1), { ready: true, celebrate: false });

  readiness.reset();
  assert.deepEqual(readiness.update(1), { ready: true, celebrate: true });
});

test('Done is the guarded activation control and Reset is dev-only', () => {
  assert.match(paintingMarkup,
    /coloring-tool--undo[\s\S]*?coloring-tool--eraser[\s\S]*?coloring-tool--done/);
  assert.equal(STRINGS.tools.done, 'できた！');
  assert.match(source, /if \(phase !== 'coloring' \|\| coverage\.power\(\) < 1\) return;\s*beginCharging\(\);/);
  assert.equal([...source.matchAll(/\bbeginCharging\(\);/g)].length, 1,
    'something besides a guarded Done press starts activation');
  assert.doesNotMatch(paintingMarkup, /reset|やりなおす/);
  assert.match(source, /window\.__eslDebug\.coloringReset = resetArtwork/);
  assert.match(source, /delete window\.__eslDebug\.coloringReset/);
});

test('full power leaves painting, undo and eraser available', () => {
  assert.match(source, /locked: \(\) => phase !== 'coloring'/);
  assert.match(source, /function undo\(\) \{\s*if \(phase !== 'coloring'/);
  assert.match(source, /function toggleEraser\(\) \{\s*if \(phase !== 'coloring'/);
  assert.doesNotMatch(between('function onPaintChanged(info)', 'function finishArtwork()'),
    /phase\s*=|beginCharging/);
});

test('the persistent answer bubble owns replay and creates no duplicate notice', () => {
  assert.equal(answerFor(LESSON_BY_ID.coloring, 'blue'), 'I like blue.');
  assert.match(paintingMarkup, /coloring-bubble__answer/);
  assert.match(paintingMarkup, /<button class="coloring-bubble__speaker" type="button">🔊<\/button>/);
  assert.match(source, /bubbleAnswer\.textContent = answerSentence/);
  assert.match(source, /bubbleSpeaker\.setAttribute\('aria-label', UI\.dialogue\.replay\)/);
  assert.match(source, /bubbleSpeaker\.title = UI\.dialogue\.replay/);
  assert.equal(UI.dialogue.replay, 'もういちど きく');
  assert.match(source, /bubbleSpeaker\.addEventListener\('click', onBubbleSpeakerClick\)/);
  assert.match(source, /if \(event\.detail > 0\) event\.currentTarget\.blur\(\)/);
  const replay = between('function replayAnswer()', 'function targetQuestion()');
  assert.match(replay, /replayed = true/);
  assert.match(replay, /audio\.speak\(answerSentence\)/);
  assert.match(replay, /flash\(bubble, 'coloring-bubble--speaking'/);
  assert.doesNotMatch(between('function beginColoring()', 'function selectColor('), /bubble\.hidden/);
  assert.match(between('function beginCharging()', 'function stirOnPage()'), /bubble\.hidden = true/);
  assert.doesNotMatch(source, /answerNotice|coloring-answer-notice|createListenAgain|\.listen-again/);
});

test('the emergence retreats the player clear of the landing and holds the view', () => {
  const playerOffset = Number(source.match(/PLAYER_RETREAT_Z = EASEL\.z \+ ([\d.]+)/)?.[1]);
  const robotOffset = Number(source.match(/ROBOT_LANDING_Z = EASEL\.z \+ ([\d.]+)/)?.[1]);
  assert.ok(playerOffset - robotOffset > 1,
    `player and landed robot are only ${playerOffset - robotOffset} apart`);
  assert.match(source, /PLAYER_RETREAT_SECONDS = 0\.55/);
  assert.match(source, /retreatEase = 1 - \(1 - retreatProgress\) \*\* 3/);
  assert.match(source, /REVEAL_HOLD = 1\.2/);
  assert.match(source, /startRoaming\(member\.points, \{ \.\.\.member, from \}\)/);
});

test('room dimensions and all three wall heights come from shared constants', () => {
  for (const name of ['ROOM_WIDTH', 'ROOM_DEPTH', 'WALL_HEIGHT', 'WALL_THICKNESS',
    'DOOR_WIDTH', 'DOOR_HEIGHT']) {
    assert.match(source, new RegExp(`const ${name} =`), `${name} is missing`);
  }
  assert.equal([...source.matchAll(/wallMaterial,[^\n]*\n?[^;]*WALL_HEIGHT/g)].length, 4,
    'the full-height back and side wall pieces do not share WALL_HEIGHT');
  assert.match(source, /lintelHeight = WALL_HEIGHT - DOOR_HEIGHT/,
    'the doorway lintel does not reach the shared wall top');
  assert.ok(!source.includes('5.55'), 'the old hand-tuned back wall remains');
  assert.ok(!source.includes('3.6, 11.5'), 'the short side-wall dimensions remain');
});

test('the easel canvas planes share one leaned group', () => {
  assert.match(source, /canvasGroup\.rotation\.x = -0\.08/);
  assert.equal([...source.matchAll(/addPart\(canvasGroup, plane/g)].length, 2,
    'paper and artwork are not both parented to the leaned canvas group');
  assert.match(source, /leftFrontLeg\.rotation\.z = -0\.15/);
  assert.match(source, /rightFrontLeg\.rotation\.z = 0\.15/);
  assert.match(source, /rearLeg\.rotation\.x = 0\.28/);
});

test('built easel geometry keeps the sheet ahead of uprights and on its shelf', () => {
  const box = new THREE.BoxGeometry(1, 1, 1);
  const plane = new THREE.PlaneGeometry(1, 1);
  const material = new THREE.MeshBasicMaterial();
  const easel = buildColoringEasel({
    box,
    plane,
    easelMaterial: material,
    paperMaterial: material,
    artMaterial: material,
  });
  easel.group.updateMatrixWorld(true);

  const paperBox = new THREE.Box3().setFromObject(easel.paper);
  for (const upright of easel.uprights) {
    const uprightBox = new THREE.Box3().setFromObject(upright);
    assert.ok(paperBox.min.z > uprightBox.max.z,
      `${upright.name} crosses or sits in front of the sheet plane`);
  }

  const shelfBox = new THREE.Box3().setFromObject(easel.shelf);
  const shelfYOverlap = Math.min(paperBox.max.y, shelfBox.max.y)
    - Math.max(paperBox.min.y, shelfBox.min.y);
  const shelfZOverlap = Math.min(paperBox.max.z, shelfBox.max.z)
    - Math.max(paperBox.min.z, shelfBox.min.z);
  assert.ok(shelfYOverlap > 0, 'the paper no longer rests on the shelf');
  assert.ok(shelfYOverlap / PAPER_SIZE <= 0.04,
    `shelf covers ${(shelfYOverlap / PAPER_SIZE * 100).toFixed(2)}% of the paper`);
  assert.ok(shelfZOverlap > 0, 'the shelf moved behind or ahead of the paper');

  const paperWorld = easel.paper.getWorldPosition(new THREE.Vector3());
  const puppetWorldZ = easel.group.position.z + PUPPET_START_Z;
  assert.ok(puppetWorldZ > paperBox.max.z, 'the newborn puppet starts behind the leaned sheet');
  const cameraWorldZ = easel.group.position.z + CAMERA.paper.offset[2];
  assert.ok(Math.abs((cameraWorldZ - paperWorld.z) - PAPER_CAMERA_GAP) < 1e-12,
    'paper camera gap changed when the sheet moved');
  assert.equal(PAPER_PLANE_Z, easel.canvasGroup.position.z);

  box.dispose();
  plane.dispose();
  material.dispose();
});

test('both puppet placements derive from the paper plane', () => {
  assert.equal([...source.matchAll(/EASEL\.z \+ PUPPET_START_Z/g)].length, 3);
  assert.doesNotMatch(source, /EASEL\.z \+ 0\.2/);
  assert.equal(PUPPET_START_Z, PAPER_PLANE_Z + 0.16);
});

// --- the copy ---------------------------------------------------------------

test('the strings the new loop needs all exist', () => {
  for (const key of ['roomName', 'askRobot', 'canvasLabel', 'chooseColor', 'paintHint', 'readyHint',
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
  for (const key of ['undo', 'eraser', 'done']) {
    assert.equal(typeof STRINGS.tools[key], 'string', `tools.${key} is missing`);
  }
  for (const key of ['reset', 'resetConfirm', 'resetYes', 'resetNo']) {
    assert.equal(STRINGS.tools[key], undefined, `tools.${key} is dead gameplay copy`);
  }
});
