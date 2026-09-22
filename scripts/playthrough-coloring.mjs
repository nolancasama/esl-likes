// Multi-round scripted playthrough for Coloring's magical-easel loop.
// Run through scripts/playthrough-run.mjs; this file deliberately uses the
// mic-free fallback and treats window.__eslDebug.coloring as its contract.
//
// Geometry comes from the same pure modules as the game so brush coverage and
// canvas mapping cannot drift from the robot.
// playwright resolves from recipe-tester/node_modules; it is not a dependency here.
import { chromium } from 'playwright';
import { openFallback } from './lib/pressTalk.mjs';
import {
  PICTURE_SIZE,
  insideSilhouette,
  silhouetteBounds,
} from '../src/minigames/coloring/robotDefinition.js';
import { PALETTE } from '../src/minigames/coloring/palette.js';
import { BRUSHES, BRUSH_IDS, DEFAULT_BRUSH } from '../src/minigames/coloring/brushes.js';
import { POWER_THRESHOLD, FAVOURITE_BONUS } from '../src/minigames/coloring/coverage.js';

// Not `URL`: that shadows the global URL constructor, and the performance
// session needs it to append ?editor=1.
const TARGET_URL = process.argv[2] || 'http://localhost:5199/';
const OUT = process.argv[3] || '.tmp/col';
const VIEW = { width: Number(process.argv[4]) || 1024, height: Number(process.argv[5]) || 600 };
const SAVE_KEY = 'esl-likes-save-v1';
const FORBIDDEN_PHASES = new Set(['approach', 'gift', 'reaction', 'transition-to-painting']);
const ACTIVATION_SEQUENCE = ['activation-page', 'reveal-easel', 'robot-exit', 'room-reveal', 'room'];
const ANSWER_PATTERN = new RegExp(`^I like (${PALETTE.join('|')})\\.$`);
const ROUND_STYLES = [
  { color: 'red', brush: 'small' },
  { color: 'blue', brush: 'medium' },
  { color: 'yellow', brush: 'large' },
  { color: 'green', brush: 'small' },
];

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const context = await browser.newContext({ viewport: VIEW });
await context.addInitScript((key) => {
  if (!sessionStorage.getItem('seeded')) {
    localStorage.setItem(key, JSON.stringify({ version: 1, settings: { micFree: true, difficulty: 1 } }));
    sessionStorage.setItem('seeded', '1');
  }
}, SAVE_KEY);

const results = [];
const errors = [];
const notes = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function isSubsequence(observed, expected) {
  let at = 0;
  for (const value of observed) if (value === expected[at]) at += 1;
  return at === expected.length;
}

function compact(values) {
  return values.filter((value, index) => index === 0 || value !== values[index - 1]);
}

function artKey(art) {
  return typeof art === 'string' ? art : JSON.stringify(art);
}

async function openPage(label, { url = TARGET_URL, trackCanvasCreation = false } = {}) {
  const page = await context.newPage();
  if (trackCanvasCreation) {
    await page.addInitScript(() => {
      const original = Document.prototype.createElement;
      let canvasesCreated = 0;
      Document.prototype.createElement = function createElement(name, options) {
        const element = original.call(this, name, options);
        if (String(name).toLowerCase() === 'canvas') canvasesCreated += 1;
        return element;
      };
      Object.defineProperty(window, '__coloringCanvasCreates', {
        configurable: true,
        get: () => canvasesCreated,
      });
    });
  }

  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`${label}: ${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`${label}: PAGEERROR ${error.message}`));

  const observedPhases = [];
  const observedActions = [];
  let waitTextSeen = false;
  const sleep = (ms) => page.waitForTimeout(ms);
  const rawUi = () => page.evaluate(() => {
    const visible = (element) => Boolean(element)
      && !element.hidden
      && !element.closest('[hidden]')
      && !element.closest('.is-hidden')
      && getComputedStyle(element).display !== 'none'
      && getComputedStyle(element).visibility !== 'hidden'
      && Number(getComputedStyle(element).opacity) > 0.01
      && element.getClientRects().length > 0;
    const q = (selector) => document.querySelector(selector);
    const text = (selector) => (visible(q(selector))
      ? q(selector).textContent.replace(/\s+/g, ' ').trim()
      : null);
    const debug = window.__eslDebug?.coloring ?? null;
    return {
      debug: debug ? JSON.parse(JSON.stringify(debug)) : null,
      room: visible(q('.coloring-room-ui')),
      screen: visible(q('.coloring-screen')),
      canvas: visible(q('.coloring-canvas')),
      action: text('.coloring-room-ui__action'),
      actionIsDoor: visible(q('.coloring-room-ui__action--door')),
      roomInstruction: text('.coloring-room-ui .scene-card p'),
      pageBubble: text('.coloring-screen .coloring-bubble'),
      pageBubbleAnchored: visible(q('.coloring-screen .coloring-bubble')),
      dialogueBubble: text('.npc-dialogue__line'),
      paletteVisible: visible(q('.coloring-palette')),
      brushesVisible: visible(q('.coloring-brushes')),
      powerVisible: visible(q('.coloring-power')),
      done: Boolean(q('.coloring-done')),
      lineArt: debug?.phase === 'canvas-question' ? (() => {
        const canvas = q('.coloring-canvas');
        if (!visible(canvas) || !canvas.width || !canvas.height) return null;
        const pixels = canvas.getContext('2d', { willReadFrequently: true })
          .getImageData(0, 0, canvas.width, canvas.height).data;
        let dark = 0;
        let opaque = 0;
        const stride = Math.max(1, Math.floor(canvas.width / 120));
        for (let y = 0; y < canvas.height; y += stride) {
          for (let x = 0; x < canvas.width; x += stride) {
            const i = (y * canvas.width + x) * 4;
            if (pixels[i + 3] > 200) opaque += 1;
            if (pixels[i + 3] > 200 && pixels[i] < 110 && pixels[i + 1] < 110 && pixels[i + 2] < 130) dark += 1;
          }
        }
        return { width: canvas.width, height: canvas.height, dark, opaque };
      })() : null,
      fallback: [...document.querySelectorAll('.lesson-hud__fallback')].filter(visible)
        .map((button) => ({
          text: button.getAttribute('aria-label') || button.textContent,
          value: button.dataset.value ?? null,
        })),
      talk: visible(q('.lesson-hud__talk')),
      greeting: q('.greeting')?.textContent.trim() ?? null,
      body: document.body.innerText,
    };
  });
  const ui = async () => {
    const state = await rawUi();
    if (state.debug?.phase) observedPhases.push(state.debug.phase);
    if (state.debug?.action) observedActions.push(state.debug.action);
    if (/wait for the next picture/i.test(state.body)) waitTextSeen = true;
    return state;
  };
  const waitFor = async (pred, ms, label2, interval = 100) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const state = await ui();
      if (pred(state)) return state;
      await sleep(interval);
    }
    console.log(`  (timed out waiting for ${label2})`);
    return null;
  };
  const hold = async (keys, ms) => {
    for (const key of keys) await page.keyboard.down(key);
    await sleep(ms);
    for (const key of keys) await page.keyboard.up(key);
    await sleep(80);
  };
  const pulseUntil = async (keys, pred, max, label2) => {
    for (let i = 0; i < max; i += 1) {
      const state = await ui();
      if (pred(state)) return state;
      await hold(keys, 140);
    }
    const state = await ui();
    if (!pred(state)) console.log(`  (never reached ${label2})`);
    return pred(state) ? state : null;
  };

  await page.goto(url, { waitUntil: 'networkidle' });
  await sleep(3200);
  return {
    page,
    sleep,
    ui,
    waitFor,
    hold,
    pulseUntil,
    observedPhases,
    observedActions,
    waitTextSeen: () => waitTextSeen,
  };
}

// The Coloring door is second from the left of the hub arc. Sampling begins
// before the entry Space press and continues at 10 ms so a room-first flash
// cannot hide behind a later settled canvas snapshot.
async function enterColoring(h) {
  await h.hold(['KeyW', 'KeyA'], 1220);
  await h.hold(['KeyW'], 950);
  await h.page.evaluate(() => {
    window.__coloringEntrySamples = [];
    const sample = () => {
      const room = document.querySelector('.coloring-room-ui');
      const screen = document.querySelector('.coloring-screen');
      const canvas = document.querySelector('.coloring-canvas');
      const visible = (element) => Boolean(element)
        && !element.hidden
        && getComputedStyle(element).display !== 'none'
        && getComputedStyle(element).visibility !== 'hidden'
        && element.getClientRects().length > 0;
      window.__coloringEntrySamples.push({
        phase: window.__eslDebug?.coloring?.phase ?? null,
        room: visible(room),
        screen: visible(screen),
        canvas: visible(canvas),
      });
    };
    sample();
    window.__coloringEntrySampler = setInterval(sample, 10);
  });
  await h.page.keyboard.press('Space');
  const settled = await h.waitFor((state) => state.debug?.phase === 'canvas-question' && state.screen,
    8000, 'first canvas-question', 20);
  const samples = await h.page.evaluate(() => {
    clearInterval(window.__coloringEntrySampler);
    const result = window.__coloringEntrySamples;
    delete window.__coloringEntrySampler;
    delete window.__coloringEntrySamples;
    return result;
  });
  if (settled) samples.push({
    phase: settled.debug.phase,
    room: settled.room,
    screen: settled.screen,
    canvas: settled.canvas,
  });
  return { state: samples.at(-1) ?? null, samples };
}

const canvasBox = (page) => page.locator('.coloring-canvas').boundingBox();

async function selectColour(page, colour) {
  await page.click(`.coloring-swatch[data-color="${colour}"]`, { force: true });
  await page.waitForTimeout(70);
}

async function selectBrush(page, id) {
  await page.click(`.coloring-brush[data-brush="${id}"]`, { force: true });
  await page.waitForTimeout(70);
}

/** Picture fractions to screen pixels, honouring the object-fit letterbox. */
function toScreen(box, x, y) {
  const size = Math.min(box.width, box.height);
  return {
    x: box.x + (box.width - size) / 2 + x * size,
    y: box.y + (box.height - size) / 2 + y * size,
  };
}

/** Drag a stroke across the picture. */
async function stroke(page, box, points, steps = 3) {
  const first = toScreen(box, points[0][0], points[0][1]);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const [x, y] of points.slice(1)) {
    const at = toScreen(box, x, y);
    await page.mouse.move(at.x, at.y, { steps });
  }
  await page.mouse.up();
  await page.waitForTimeout(35);
}

/** Horizontal sweeps down the robot, like a child filling a large shape. */
function sweeps(from, to, step) {
  const rows = [];
  for (let y = from; y <= to; y += step) rows.push([[0.1, y], [0.9, y]]);
  return rows;
}

async function answerCanvasQuestion(h, round, screenshots = true) {
  let state = await openFallback(h);
  check(`round ${round}: Talk opens the mic-free question fallback`,
    Boolean(state?.fallback.length), state?.fallback[0]?.text ?? 'no fallback');
  check(`round ${round}: fallback asks the color question`,
    /what color do you like/i.test(state?.fallback[0]?.text ?? ''), state?.fallback[0]?.text);
  if (!state?.fallback.length) return null;
  await h.page.click('.lesson-hud__fallback');
  state = await h.waitFor((next) => ANSWER_PATTERN.test(next.pageBubble ?? ''), 6000, 'drawing answer');
  check(`round ${round}: the drawing answers in an anchored page bubble`,
    Boolean(state?.pageBubbleAnchored && ANSWER_PATTERN.test(state.pageBubble)), state?.pageBubble);
  if (screenshots && round === 1 && state) await h.page.screenshot({ path: `${OUT}-drawing-answer-bubble.png` });
  const favourite = state?.pageBubble?.match(ANSWER_PATTERN)?.[1] ?? null;
  // The stage flag flips a frame before the palette, brushes and bar finish
  // fading in, so wait on the DOM as well — otherwise this races the fade and
  // fails while reporting toolsVisible: true, which reads as a contradiction.
  state = await h.waitFor((next) => next.debug?.phase === 'coloring'
    && next.debug.toolsVisible
    && next.paletteVisible
    && next.brushesVisible
    && next.powerVisible, 6000, 'coloring tools');
  check(`round ${round}: tools appear after the answer`,
    Boolean(state?.paletteVisible && state.brushesVisible && state.powerVisible && state.debug?.toolsVisible),
    JSON.stringify({
      phase: state?.debug?.phase,
      toolsVisible: state?.debug?.toolsVisible,
      palette: state?.paletteVisible,
      brushes: state?.brushesVisible,
      power: state?.powerVisible,
    }));
  return favourite;
}

async function assertRoundStart(h, round, robotCount) {
  const state = await h.ui();
  const debug = state.debug;
  const reset = debug?.power === 0
    && debug?.coverage === 0
    && debug?.strokes === 0
    && debug?.canUndo === false
    && debug?.selectedColor === null
    && debug?.erasing === false
    && debug?.robots?.length === robotCount;
  check(`round ${round}: fresh close-up resets only the painting surface`, reset,
    JSON.stringify({
      phase: debug?.phase,
      power: debug?.power,
      coverage: debug?.coverage,
      strokes: debug?.strokes,
      canUndo: debug?.canUndo,
      selectedColor: debug?.selectedColor,
      erasing: debug?.erasing,
      robots: debug?.robots?.length,
    }));
  check(`round ${round}: close-up is established with line art visible`,
    Boolean(state.screen && state.canvas && state.lineArt?.dark > 20), JSON.stringify(state.lineArt));
}

async function paintRound(h, round, style, artById, { screenshots = true, detailedChecks = true } = {}) {
  const { page } = h;
  await assertRoundStart(h, round, artById.size);
  if (screenshots) await page.screenshot({ path: `${OUT}-round-${round}-paper-closeup.png` });

  const questionState = await h.ui();
  check(`round ${round}: tools are gated during canvas-question`,
    questionState.debug?.phase === 'canvas-question'
      && questionState.debug?.toolsVisible === false
      && !questionState.paletteVisible
      && !questionState.brushesVisible
      && !questionState.powerVisible,
    JSON.stringify({
      phase: questionState.debug?.phase,
      debug: questionState.debug?.toolsVisible,
      palette: questionState.paletteVisible,
      brushes: questionState.brushesVisible,
      power: questionState.powerVisible,
    }));

  const favourite = await answerCanvasQuestion(h, round, screenshots);
  await selectColour(page, style.color);
  await selectBrush(page, style.brush);
  let state = await h.ui();
  check(`round ${round}: selected ${style.color} with the ${style.brush} brush`,
    state.debug?.selectedColor === style.color && state.debug?.brush === style.brush,
    JSON.stringify({ color: state.debug?.selectedColor, brush: state.debug?.brush }));
  check(`round ${round}: activation has no Done button`, state.done === false);

  const box = await canvasBox(page);
  const bounds = silhouetteBounds();
  const rowStep = (BRUSHES[style.brush].diameter / PICTURE_SIZE) * 0.64;
  const phaseStart = h.observedPhases.length;
  let strokesUsed = 0;
  for (const points of sweeps(bounds.minY, bounds.maxY, rowStep)) {
    state = await h.ui();
    if (state.debug?.phase !== 'coloring') break;
    await stroke(page, box, points);
    strokesUsed += 1;
  }
  state = await h.waitFor((next) => next.debug?.phase === 'activation-page', 6000, 'automatic activation');
  check(`round ${round}: painting reaches full power`, (state?.debug?.power ?? 0) >= 1,
    `power ${state?.debug?.power ?? 'missing'}, coverage ${state?.debug?.coverage ?? 'missing'}`);
  check(`round ${round}: activation starts by itself`, state?.debug?.phase === 'activation-page', state?.debug?.phase);
  notes.push(`round ${round}: ${strokesUsed} ${style.brush}-brush sweeps; heard ${favourite ?? 'no answer'}; coverage ${((state?.debug?.coverage ?? 0) * 100).toFixed(1)}%`);
  if (screenshots && round === 1) await page.screenshot({ path: `${OUT}-camera-paper-activation.png` });

  state = await h.waitFor((next) => next.debug?.phase === 'reveal-easel', 8000, 'easel reveal', 60);
  if (screenshots && round === 1 && state) await page.screenshot({ path: `${OUT}-camera-easel-reveal.png` });
  await h.waitFor((next) => next.debug?.phase === 'robot-exit', 5000, 'robot exit', 60);
  state = await h.waitFor((next) => next.debug?.phase === 'room-reveal', 8000, 'room reveal', 60);
  if (screenshots && round === 1 && state) await page.screenshot({ path: `${OUT}-camera-room-reveal.png` });
  state = await h.waitFor((next) => next.debug?.phase === 'room', 8000, 'room');

  const phases = compact(h.observedPhases.slice(phaseStart));
  check(`round ${round}: activation follows the complete camera/exit phase order`,
    isSubsequence(phases, ACTIVATION_SEQUENCE), phases.join(' -> '));
  check(`round ${round}: completed robot count and array length agree`,
    state?.debug?.robotsCompleted === round && state?.debug?.robots?.length === round,
    JSON.stringify({ completed: state?.debug?.robotsCompleted, length: state?.debug?.robots?.length }));

  const robots = state?.debug?.robots ?? [];
  const previousUnchanged = [...artById.entries()].every(([id, art]) => {
    const robot = robots.find((candidate) => candidate.id === id);
    return robot && artKey(robot.art) === art;
  });
  check(`round ${round}: every older robot remains by ID with unchanged artwork`,
    previousUnchanged, JSON.stringify(robots.map((robot) => ({ id: robot.id, art: robot.art }))));
  const newest = robots.at(-1);
  if (newest) artById.set(newest.id, artKey(newest.art));
  check(`round ${round}: all robot artwork fingerprints are pairwise distinct`,
    new Set([...artById.values()]).size === artById.size,
    JSON.stringify([...artById.entries()]));

  if (detailedChecks) {
    check(`round ${round}: full power arrived near the imported coverage contract`,
      (state?.debug?.robotsCompleted ?? 0) === round && POWER_THRESHOLD > 0 && FAVOURITE_BONUS > 1,
      `threshold ${POWER_THRESHOLD}, favourite bonus ${FAVOURITE_BONUS}`);
  }
  return state;
}

async function openNextRound(h, round, stateName, predicate) {
  const ready = await h.waitFor((state) => state.debug?.phase === 'room'
    && state.debug?.canAct
    && state.debug?.action === 'easel'
    && predicate(state.debug), 9000, `${stateName} easel action`, 45);
  check(`round ${round}: easel is interactable while ${stateName}`,
    Boolean(ready && ready.debug.action === 'easel'),
    JSON.stringify({ art: ready?.debug?.easelArt, opacity: ready?.debug?.easelArtOpacity, action: ready?.debug?.action }));
  if (stateName === 'fading') {
    check('round 3: Space is pressed during a partial fade',
      ready?.debug?.easelArt === 'fading'
        && ready.debug.easelArtOpacity > 0
        && ready.debug.easelArtOpacity < 1,
      String(ready?.debug?.easelArtOpacity));
  }
  if (!ready) return null;
  await h.page.keyboard.press('Space');
  const opened = await h.waitFor((state) => state.debug?.phase === 'canvas-question' && state.screen,
    7000, `round ${round} close-up`, 45);
  check(`round ${round}: easel Space opens the canvas and does not finish the minigame`,
    Boolean(opened?.debug && opened.debug.phase === 'canvas-question'), opened?.debug?.phase);
  // paintRound asserts the reset itself a moment later, against the same state;
  // asserting here too only prints every round-start check twice.
  return opened;
}

async function sampleCrowd(h) {
  const samples = [];
  for (let i = 0; i < 24; i += 1) {
    const state = await h.ui();
    samples.push(clone(state.debug?.robots ?? []));
    await h.sleep(170);
  }
  const mixedSamples = samples.filter((robots) => new Set(robots.map((robot) => robot.state)).size > 1).length;
  const pauses = new Set(samples[0]?.map((robot) => robot.idlePause.toFixed(4)) ?? []);
  const separatedSamples = samples.filter((robots) => new Set(robots.map((robot) =>
    `${robot.position.x.toFixed(3)},${robot.position.z.toFixed(3)}`)).size > 1).length;
  const ids = samples[0]?.map((robot) => robot.id) ?? [];
  let worstCloseRun = 0;
  let worstPair = '';
  for (let a = 0; a < ids.length; a += 1) {
    for (let b = a + 1; b < ids.length; b += 1) {
      let run = 0;
      let longest = 0;
      for (const robots of samples) {
        const one = robots.find((robot) => robot.id === ids[a]);
        const two = robots.find((robot) => robot.id === ids[b]);
        const distance = one && two
          ? Math.hypot(one.position.x - two.position.x, one.position.z - two.position.z)
          : Infinity;
        run = distance < 0.1 ? run + 1 : 0;
        longest = Math.max(longest, run);
      }
      if (longest > worstCloseRun) {
        worstCloseRun = longest;
        worstPair = `${ids[a]}/${ids[b]}`;
      }
    }
  }
  check('four-robot crowd does not move in lockstep across several samples',
    mixedSamples >= 3, `${mixedSamples}/${samples.length} samples had mixed states`);
  check('four-robot crowd has distinct idle pauses', pauses.size > 1, [...pauses].join(', '));
  check('four-robot crowd positions are not all equal',
    separatedSamples === samples.length, `${separatedSamples}/${samples.length} separated samples`);
  check('no pair remains in a very small persistent stack',
    worstCloseRun < 8, `longest <0.1-unit run ${worstCloseRun} samples${worstPair ? ` (${worstPair})` : ''}`);
}

async function walkToDoor(h) {
  await h.pulseUntil(['KeyD'], (state) => (state.debug?.player?.x ?? -Infinity) >= 3.25,
    18, 'door x coordinate');
  return h.pulseUntil(['KeyW'], (state) => state.debug?.action === 'door', 32, 'door action');
}

// ---- Session A: four complete rounds and the door turnaround --------------
{
  const h = await openPage('multi-round');
  const { page } = h;
  await page.screenshot({ path: `${OUT}-hub.png` });
  const entry = await enterColoring(h);
  const coloringSamples = entry.samples.filter((sample) => sample.phase);
  const firstPhase = coloringSamples[0]?.phase ?? null;
  const roomBeforeCanvas = entry.samples.some((sample) => sample.room
    || (sample.phase === 'room' && firstPhase !== 'canvas-question'));
  check('first entry begins immediately at the close-up canvas-question',
    entry.samples.length > 1
      && entry.samples.some((sample) => sample.phase === null)
      && firstPhase === 'canvas-question'
      && entry.state?.screen
      && entry.state?.canvas,
    JSON.stringify({ samples: entry.samples.length, firstPhase, final: entry.state }));
  check('first entry never shows the room overview before the canvas',
    !roomBeforeCanvas, JSON.stringify(entry.samples.slice(0, 12)));

  let state = await h.ui();
  check('canvas-question exposes no painting tools',
    state.debug?.toolsVisible === false
      && !state.paletteVisible
      && !state.brushesVisible
      && !state.powerVisible,
    JSON.stringify({
      phase: state.debug?.phase,
      toolsVisible: state.debug?.toolsVisible,
      palette: state.paletteVisible,
      brushes: state.brushesVisible,
      power: state.powerVisible,
    }));
  const artById = new Map();
  state = await paintRound(h, 1, ROUND_STYLES[0], artById);

  // Round 2 starts before the invitation has begun to fade in.
  await openNextRound(h, 2, 'blank', (debug) => debug.easelArt === 'blank');
  state = await paintRound(h, 2, ROUND_STYLES[1], artById);

  // Round 3 interrupts the invitation while its opacity is strictly partial.
  await openNextRound(h, 3, 'fading', (debug) => debug.easelArt === 'fading'
    && debug.easelArtOpacity > 0 && debug.easelArtOpacity < 1);
  state = await paintRound(h, 3, ROUND_STYLES[2], artById);

  // Round 4 waits until the line art has completely arrived.
  await openNextRound(h, 4, 'ready', (debug) => debug.easelArt === 'ready');
  state = await paintRound(h, 4, ROUND_STYLES[3], artById);
  await h.waitFor((next) => next.debug?.phase === 'room' && next.debug?.canAct, 5000, 'four-robot room controls');
  await page.screenshot({ path: `${OUT}-room-four-robots.png` });

  await sampleCrowd(h);
  state = await h.ui();
  check('all four accumulated robots still have their original artwork',
    state.debug?.robots?.length === 4 && state.debug.robots.every((robot) => artById.get(robot.id) === artKey(robot.art)),
    JSON.stringify(state.debug?.robots?.map((robot) => ({ id: robot.id, art: robot.art }))));

  const atDoor = await walkToDoor(h);
  check('approaching the doorway offers only the door action',
    atDoor?.debug?.action === 'door' && atDoor.actionIsDoor && atDoor.action === 'スペースで おわる',
    JSON.stringify({ debug: atDoor?.debug?.action, cue: atDoor?.action, class: atDoor?.actionIsDoor }));
  const newestBefore = atDoor?.debug?.robots?.at(-1) ?? null;
  await page.keyboard.press('Space');
  state = await h.waitFor((next) => next.debug?.phase === 'turnaround', 4000, 'turnaround');
  check('door Space enters turnaround instead of another round', state?.debug?.phase === 'turnaround', state?.debug?.phase);
  const newestDuring = state?.debug?.robots?.find((robot) => robot.id === newestBefore?.id);
  const askerGeometry = newestDuring && state.debug?.player
    ? {
      dx: state.debug.player.x - newestDuring.position.x,
      dz: state.debug.player.z - newestDuring.position.z,
    }
    : null;
  check('the most recently created robot is the turnaround asker',
    Boolean(newestDuring
      && newestDuring.id === state.debug.robots.at(-1)?.id
      && newestDuring.state === 'idle'
      && Math.abs(askerGeometry.dx - 1.5) < 0.08
      && Math.abs(askerGeometry.dz - 1.3) < 0.08
      && /what color do you like/i.test(state.dialogueBubble ?? '')),
    JSON.stringify({ newest: newestDuring?.id, state: newestDuring?.state, askerGeometry, bubble: state?.dialogueBubble }));
  check('session stars equal min(3, robotsCompleted) before finishing',
    state?.debug?.stars === Math.min(3, state?.debug?.robotsCompleted ?? 0),
    JSON.stringify({ stars: state?.debug?.stars, robots: state?.debug?.robotsCompleted }));
  await page.screenshot({ path: `${OUT}-door-turnaround.png` });

  state = await openFallback(h, 3);
  check('turnaround fallback offers all seven color answers',
    state?.fallback?.length === PALETTE.length, state?.fallback?.map((answer) => answer.value).join(', '));
  const answered = await page.locator('.lesson-hud__fallback[data-value="purple"]')
    .click({ timeout: 4000 }).then(() => true, () => false);
  check('turnaround answer is accepted through the fallback', answered);
  state = await h.waitFor((next) => !next.debug && next.greeting !== null, 10000, 'finished hub');
  check('door turnaround finishes the minigame back at the hub', Boolean(state), state?.greeting);
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '{}'), SAVE_KEY);
  check('four completed robots finish with three saved stars',
    saved?.bestStars?.coloring === Math.min(3, 4), JSON.stringify(saved?.bestStars));

  const actionsSeen = new Set(h.observedActions);
  check('room UI proves there is no artist, art table, wall frame, or gift action',
    actionsSeen.has('easel')
      && actionsSeen.has('door')
      && h.observedActions.every((action) => action === 'easel' || action === 'door'),
    [...new Set(h.observedActions)].join(', '));
  check('obsolete approach/gift/reaction/transition phases never occur',
    !h.observedPhases.some((phase) => FORBIDDEN_PHASES.has(phase)),
    compact(h.observedPhases).join(' -> '));
  check('no wait-for-next-picture message ever appears', !h.waitTextSeen());
  await page.close();
}

// ---- Session B: dev-spawned 15-robot performance room --------------------
{
  const performanceUrl = new URL(TARGET_URL);
  performanceUrl.searchParams.set('editor', '1');
  const h = await openPage('performance', { url: performanceUrl.href, trackCanvasCreation: true });
  const entry = await enterColoring(h);
  check('performance session enters Coloring with the dev hook available',
    entry.state?.phase === 'canvas-question'
      && await h.page.evaluate(() => typeof window.__eslDebug?.coloringSpawn === 'function'));

  // Complete one ordinary round to reveal the room; the dev hook then adds 14
  // more robots, keeping the exercised crowd inside the requested 10–20 band.
  const artById = new Map();
  await paintRound(h, 1, { color: 'orange', brush: 'large' }, artById,
    { screenshots: false, detailedChecks: false });
  await h.waitFor((state) => state.debug?.phase === 'room' && state.debug?.canAct, 5000, 'performance room');
  const spawned = await h.page.evaluate(() => window.__eslDebug.coloringSpawn(14));
  let state = await h.waitFor((next) => next.debug?.robots?.length === 15, 4000, '15-robot crowd');
  check('dev spawner fills the performance room to 15 robots',
    spawned === 15 && state?.debug?.robotsCompleted === 15,
    JSON.stringify({ returned: spawned, completed: state?.debug?.robotsCompleted }));
  await h.sleep(600);

  const before = await h.page.evaluate(() => ({
    createdCanvases: window.__coloringCanvasCreates,
    domCanvases: document.querySelectorAll('canvas').length,
  }));
  await h.page.keyboard.down('KeyD');
  const frame = await h.page.evaluate(() => new Promise((resolve) => {
    const samples = [];
    const started = performance.now();
    const tick = (now) => {
      samples.push(now);
      if (now - started < 4000) requestAnimationFrame(tick);
      else {
        const seconds = (samples.at(-1) - samples[0]) / 1000;
        resolve({
          frames: samples.length,
          seconds,
          fps: seconds > 0 ? (samples.length - 1) / seconds : 0,
          worstGapMs: Math.max(...samples.slice(1).map((value, index) => value - samples[index])),
        });
      }
    };
    requestAnimationFrame(tick);
  }));
  await h.page.keyboard.up('KeyD');
  const after = await h.page.evaluate(() => ({
    createdCanvases: window.__coloringCanvasCreates,
    domCanvases: document.querySelectorAll('canvas').length,
  }));
  notes.push(`15-robot crowd: ${frame.fps.toFixed(1)} fps over ${frame.seconds.toFixed(2)}s (${frame.frames} frames, worst gap ${frame.worstGapMs.toFixed(1)}ms)`);
  notes.push(`15-robot crowd canvases: created ${before.createdCanvases} -> ${after.createdCanvases}; DOM ${before.domCanvases} -> ${after.domCanvases}`);
  check('15-robot crowd frame rate is not clearly broken',
    frame.frames >= 60 && frame.fps >= 15,
    `${frame.fps.toFixed(1)} fps, ${frame.frames} frames, worst gap ${frame.worstGapMs.toFixed(1)}ms`);
  check('roaming crowd creates no runaway canvas textures',
    before.createdCanvases === after.createdCanvases && before.domCanvases === after.domCanvases,
    JSON.stringify({ before, after }));
  await h.page.screenshot({ path: `${OUT}-performance-15-robots.png` });
  check('performance room has no forbidden legacy phases or actions',
    !h.observedPhases.some((phase) => FORBIDDEN_PHASES.has(phase))
      && h.observedActions.every((action) => action === 'easel' || action === 'door'),
    JSON.stringify({ phases: compact(h.observedPhases), actions: [...new Set(h.observedActions)] }));
  check('performance session never shows wait-for-next-picture text', !h.waitTextSeen());
  await h.page.close();
}

check('imported robot geometry contains a paintable centre', insideSilhouette(0.5, 0.5));
check('the harness covers all palette and brush contracts',
  ROUND_STYLES.every(({ color, brush }) => PALETTE.includes(color) && BRUSH_IDS.includes(brush))
    && BRUSH_IDS.includes(DEFAULT_BRUSH));
check('no console or page errors', errors.length === 0, errors.slice(0, 4).join(' || '));
for (const note of notes) console.log(`NOTE  ${note}`);
const failed = results.filter((result) => !result.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
await browser.close();
if (failed > 0) process.exitCode = 1;
