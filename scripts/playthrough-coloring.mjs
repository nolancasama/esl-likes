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
import { FAVOURITE_POWER_THRESHOLD } from '../src/minigames/coloring/coverage.js';

// Not `URL`: that shadows the global URL constructor, and the performance
// session needs it to append ?editor=1.
const TARGET_URL = process.argv[2] || 'http://localhost:5199/';
const OUT = process.argv[3] || '.tmp/col';
const VIEW = { width: Number(process.argv[4]) || 1024, height: Number(process.argv[5]) || 600 };
const SAVE_KEY = 'esl-likes-save-v1';
const FULL_POWER_SETTLE_MS = 1200;
const FORBIDDEN_PHASES = new Set(['approach', 'gift', 'reaction', 'transition-to-painting']);
const ACTIVATION_SEQUENCE = ['activation-page', 'reveal-easel', 'robot-exit', 'room-reveal', 'room'];
const ANSWER_PATTERN = new RegExp(`^I like (${PALETTE.join('|')})\\.$`);
/**
 * Robot id → the colour that robot was told to like, so distinctness is only
 * asserted across robots that were told different colours. Ids restart at 1
 * on each session; entries are overwritten as that session paints, so a stale
 * id from an earlier session cannot be read back.
 */
const favouriteById = new Map();

const ROUND_STYLES = [
  { colorOffset: 1, brush: 'small', fill: 'top-down', decoration: [[0.34, 0.91], [0.66, 0.91]] },
  { colorOffset: 2, brush: 'medium', fill: 'bottom-up', decoration: [[0.34, 0.23], [0.66, 0.23]] },
  { colorOffset: 3, brush: 'large', fill: 'outside-in', decoration: [[0.14, 0.57], [0.27, 0.57]] },
  { colorOffset: 4, brush: 'small', fill: 'inside-out', decoration: [[0.55, 0.91], [0.66, 0.91]] },
  { colorOffset: 5, brush: 'medium', fill: 'top-down', decoration: [[0.37, 0.79], [0.45, 0.91]] },
  { colorOffset: 6, brush: 'large', fill: 'bottom-up', decoration: [[0.39, 0.2], [0.61, 0.31]] },
];
const CENTRING_VIEWPORTS = [
  { width: 760, height: 420 },
  { width: 1024, height: 600 },
  { width: 1366, height: 768 },
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

async function openPage(label, {
  url = TARGET_URL,
  trackCanvasCreation = false,
  viewport = VIEW,
} = {}) {
  const page = await context.newPage();
  await page.setViewportSize(viewport);
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
    const screen = q('.coloring-screen');
    const done = q('.coloring-tool--done');
    const speaker = q('.coloring-bubble__speaker');
    const powerFill = q('.coloring-power__fill');
    const powerTrack = q('.coloring-power__track');
    const fillStyle = powerFill ? getComputedStyle(powerFill) : null;
    const fillRect = powerFill?.getBoundingClientRect() ?? null;
    const trackRect = powerTrack?.getBoundingClientRect() ?? null;
    const trackStyle = powerTrack ? getComputedStyle(powerTrack) : null;
    const text = (selector) => (visible(q(selector))
      ? q(selector).textContent.replace(/\s+/g, ' ').trim()
      : null);
    const debug = window.__eslDebug?.coloring ?? null;
    return {
      debug: debug ? JSON.parse(JSON.stringify(debug)) : null,
      room: visible(q('.coloring-room-ui')),
      screen: visible(screen),
      canvas: visible(q('.coloring-canvas')),
      action: text('.coloring-room-ui__action'),
      actionIsDoor: visible(q('.coloring-room-ui__action--door')),
      roomInstruction: text('.coloring-room-ui .scene-card p'),
      pageBubble: text('.coloring-screen .coloring-bubble'),
      pageBubbleAnchored: visible(q('.coloring-screen .coloring-bubble')),
      bubbleAnswer: text('.coloring-bubble__answer'),
      bubbleAnswerCount: screen?.querySelectorAll('.coloring-bubble__answer').length ?? 0,
      bubbleSpeaker: Boolean(speaker),
      bubbleSpeakerVisible: visible(speaker),
      bubbleSpeakerFocused: document.activeElement === speaker,
      bubbleSpeakerLabel: speaker?.getAttribute('aria-label') ?? null,
      bubbleSpeakerTitle: speaker?.title ?? null,
      bubbleSpeaking: q('.coloring-bubble')?.classList.contains('coloring-bubble--speaking') ?? false,
      listenAgainPresent: Boolean(screen?.querySelector('.listen-again')),
      dialogueBubble: text('.npc-dialogue__line'),
      paletteVisible: visible(q('.coloring-palette')),
      brushesVisible: visible(q('.coloring-brushes')),
      powerVisible: visible(q('.coloring-power')),
      powerIcon: visible(q('.coloring-power__icon')),
      donePresent: Boolean(done),
      doneVisible: visible(done),
      doneDisabled: done?.disabled ?? null,
      undoDisabled: q('.coloring-tool--undo')?.disabled ?? null,
      eraserDisabled: q('.coloring-tool--eraser')?.disabled ?? null,
      eraserPressed: q('.coloring-tool--eraser')?.getAttribute('aria-pressed') ?? null,
      titleAbsent: !screen?.querySelector('h1'),
      hintText: text('.coloring-screen__instruction'),
      hintCount: screen?.querySelectorAll('.coloring-screen__instruction').length ?? 0,
      bottomButtonCount: screen?.querySelectorAll('.coloring-screen__bottom button').length ?? 0,
      resetAbsent: !screen?.querySelector('.coloring-tool--reset'),
      powerFillHeight: fillStyle?.height ?? null,
      powerFillWidth: fillStyle?.width ?? null,
      powerGeometry: fillRect && trackRect && trackStyle ? {
        fill: { top: fillRect.top, right: fillRect.right, bottom: fillRect.bottom, left: fillRect.left },
        track: { top: trackRect.top, right: trackRect.right, bottom: trackRect.bottom, left: trackRect.left },
        trackInnerBottom: trackRect.bottom - parseFloat(trackStyle.borderBottomWidth || '0'),
      } : null,
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

async function artFingerprint(page) {
  return page.locator('.coloring-canvas').evaluate((canvas) => {
    const pixels = canvas.getContext('2d', { willReadFrequently: true })
      .getImageData(0, 0, canvas.width, canvas.height).data;
    let hash = 2166136261;
    for (let i = 0; i < pixels.length; i += 1) {
      hash ^= pixels[i];
      hash = Math.imul(hash, 16777619);
    }
    return `${canvas.width}x${canvas.height}:${(hash >>> 0).toString(16).padStart(8, '0')}`;
  });
}

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

function orderedSweeps(from, to, step, order) {
  const rows = sweeps(from, to, step);
  if (order === 'bottom-up') return rows.reverse();
  if (order === 'outside-in') {
    const result = [];
    while (rows.length) {
      result.push(rows.shift());
      if (rows.length) result.push(rows.pop());
    }
    return result;
  }
  if (order === 'inside-out') {
    return rows.sort((a, b) => Math.abs(a[0][1] - 0.55) - Math.abs(b[0][1] - 0.55));
  }
  return rows;
}

function nonFavouriteColour(favourite, offset = 1) {
  const favouriteIndex = Math.max(0, PALETTE.indexOf(favourite));
  return PALETTE[(favouriteIndex + Math.max(1, offset)) % PALETTE.length];
}

async function resetPainting(h) {
  const resetHookPresent = await h.page.evaluate(() =>
    typeof window.__eslDebug?.coloringReset === 'function');
  check('dev reset hook exists before the harness relies on it', resetHookPresent);
  if (!resetHookPresent) return null;
  await h.page.evaluate(() => window.__eslDebug.coloringReset());
  return h.waitFor((state) => state.debug?.phase === 'coloring'
    && state.debug.power === 0
    && state.debug.coverage === 0
    && state.debug.strokes === 0,
  3000, 'painting reset');
}

async function undoAndRead(h) {
  await h.page.click('.coloring-tool--undo', { force: true });
  await h.sleep(40);
  return h.ui();
}

async function assertPowerSemantics(h, box, favourite, ordinary) {
  const { page } = h;
  const power = async () => (await h.ui()).debug?.power ?? NaN;
  await selectBrush(page, 'large');
  await selectColour(page, ordinary);

  await stroke(page, box, [[0.36, 0.69], [0.64, 0.69]], 8);
  const afterPlain = await power();
  check('power semantics (a): a large non-favourite silhouette stroke leaves power at zero',
    afterPlain === 0, `power ${afterPlain}`);

  await selectBrush(page, 'medium');
  await selectColour(page, favourite);
  const favouriteStroke = [[0.35, 0.25], [0.65, 0.25]];
  await stroke(page, box, favouriteStroke, 8);
  const afterFavourite = await power();
  check('power semantics (b): a favourite-colour silhouette stroke raises power',
    afterFavourite > afterPlain, `${afterPlain} -> ${afterFavourite}`);

  await selectBrush(page, 'large');
  await stroke(page, box, [[0.04, 0.04], [0.2, 0.04]], 6);
  const afterBackground = await power();
  check('power semantics (c): favourite colour in the paper margin raises nothing',
    afterBackground === afterFavourite, `${afterFavourite} -> ${afterBackground}`);

  await selectBrush(page, 'medium');
  await stroke(page, box, favouriteStroke, 8);
  const afterRepeat = await power();
  check('power semantics (d): repainting the same area favourite adds nothing',
    afterRepeat === afterBackground, `${afterBackground} -> ${afterRepeat}`);

  const beforeFavouriteOverPlain = afterRepeat;
  await selectColour(page, favourite);
  await selectBrush(page, 'large');
  await stroke(page, box, [[0.36, 0.69], [0.64, 0.69]], 8);
  const afterFavouriteOverPlain = await power();
  const cellStep = 1 / (((await h.ui()).debug?.robotCells || 1) * FAVOURITE_POWER_THRESHOLD);
  check('power semantics (e): favourite over a differently painted area raises power',
    afterFavouriteOverPlain > beforeFavouriteOverPlain + cellStep / 2,
    `${beforeFavouriteOverPlain} -> ${afterFavouriteOverPlain}`);
  let restored = await undoAndRead(h);
  check('power semantics (h/e): undo exactly restores power after favourite overpaint',
    restored.debug?.power === beforeFavouriteOverPlain,
    `${afterFavouriteOverPlain} -> ${restored.debug?.power}`);

  const beforePlainOverFavourite = restored.debug?.power;
  await selectColour(page, ordinary);
  await selectBrush(page, 'medium');
  await stroke(page, box, favouriteStroke, 8);
  const afterPlainOverFavourite = await power();
  check('power semantics (f): another colour over favourite area lowers power',
    afterPlainOverFavourite < beforePlainOverFavourite - cellStep / 2,
    `${beforePlainOverFavourite} -> ${afterPlainOverFavourite}`);
  restored = await undoAndRead(h);
  check('power semantics (h/f): undo exactly restores power after non-favourite overpaint',
    restored.debug?.power === beforePlainOverFavourite,
    `${afterPlainOverFavourite} -> ${restored.debug?.power}`);

  const beforeErase = restored.debug?.power;
  await page.click('.coloring-tool--eraser', { force: true });
  await stroke(page, box, favouriteStroke, 8);
  const afterErase = await power();
  check('power semantics (g): erasing favourite area lowers power',
    afterErase < beforeErase - cellStep / 2, `${beforeErase} -> ${afterErase}`);
  restored = await undoAndRead(h);
  check('power semantics (h/g): undo exactly restores power after erasing',
    restored.debug?.power === beforeErase, `${afterErase} -> ${restored.debug?.power}`);

  await resetPainting(h);
  await selectColour(page, ordinary);
  await selectBrush(page, 'large');
  const bounds = silhouetteBounds();
  const rowStep = (BRUSHES.large.diameter / PICTURE_SIZE) * 0.58;
  for (const points of sweeps(bounds.minY, bounds.maxY, rowStep)) await stroke(page, box, points);
  const ignoredFavourite = await h.ui();
  check('ignoring the favourite colour cannot activate the robot',
    ignoredFavourite.debug?.phase === 'coloring'
      && ignoredFavourite.debug?.power === 0
      && ignoredFavourite.debug?.coverage > 0.68,
    JSON.stringify({
      phase: ignoredFavourite.debug?.phase,
      power: ignoredFavourite.debug?.power,
      coverage: ignoredFavourite.debug?.coverage,
    }));
  await resetPainting(h);
}

async function answerCanvasQuestion(h, round, screenshots = true, onAnswer = null) {
  let state = await openFallback(h);
  check(`round ${round}: Talk opens the mic-free question fallback`,
    Boolean(state?.fallback.length), state?.fallback[0]?.text ?? 'no fallback');
  check(`round ${round}: fallback asks the color question`,
    /what color do you like/i.test(state?.fallback[0]?.text ?? ''), state?.fallback[0]?.text);
  if (!state?.fallback.length) return null;
  await h.page.click('.lesson-hud__fallback');
  // Wait for the BUBBLE, not just its text. `.coloring-bubble` fades in over
  // .3s while the answer span inside it already reads as visible, so waiting on
  // the text alone races the entry animation and then fails the anchored check
  // it just satisfied. The same race cost this harness a day in a previous pass
  // on the tools fade-in.
  state = await h.waitFor((next) => ANSWER_PATTERN.test(next.bubbleAnswer ?? '')
    && next.pageBubbleAnchored, 6000, 'drawing answer');
  check(`round ${round}: the drawing answers in an anchored page bubble`,
    Boolean(state?.pageBubbleAnchored && ANSWER_PATTERN.test(state.bubbleAnswer)), state?.bubbleAnswer);
  check(`round ${round}: the answer bubble has one exact answer and a visible speaker`,
    Boolean(state?.bubbleAnswerCount === 1
      && ANSWER_PATTERN.test(state.bubbleAnswer)
      && state.bubbleSpeaker
      && state.bubbleSpeakerVisible),
    JSON.stringify({ answer: state?.bubbleAnswer, count: state?.bubbleAnswerCount,
      speaker: state?.bubbleSpeaker, visible: state?.bubbleSpeakerVisible }));
  check(`round ${round}: Coloring has no separate Listen Again control`,
    state?.listenAgainPresent === false, String(state?.listenAgainPresent));
  if (screenshots && round === 1 && state) await h.page.screenshot({ path: `${OUT}-drawing-answer-bubble.png` });
  if (state && onAnswer) await onAnswer(state);
  const favourite = state?.bubbleAnswer?.match(ANSWER_PATTERN)?.[1] ?? null;
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
  check(`round ${round}: the answer bubble persists throughout coloring without duplication`,
    Boolean(state?.debug?.phase === 'coloring'
      && state.pageBubbleAnchored
      && state.bubbleAnswerCount === 1
      && ANSWER_PATTERN.test(state.bubbleAnswer ?? '')
      && state.bubbleSpeakerVisible
      && !state.listenAgainPresent),
    JSON.stringify({ phase: state?.debug?.phase, answer: state?.bubbleAnswer,
      count: state?.bubbleAnswerCount, speaker: state?.bubbleSpeakerVisible,
      listenAgain: state?.listenAgainPresent }));
  check(`round ${round}: the post-answer hint asks the child to choose a colour`,
    state?.hintText === 'いろを えらぼう', state?.hintText);
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
  const decorationColour = nonFavouriteColour(favourite, style.colorOffset);
  const box = await canvasBox(page);
  if (detailedChecks) await assertPowerSemantics(h, box, favourite, decorationColour);

  await selectColour(page, decorationColour);
  await selectBrush(page, style.brush);
  let state = await h.ui();
  check(`round ${round}: selected decorative ${decorationColour} with the ${style.brush} brush`,
    state.debug?.selectedColor === decorationColour && state.debug?.brush === style.brush,
    JSON.stringify({ color: state.debug?.selectedColor, brush: state.debug?.brush }));
  check(`round ${round}: Done is present and disabled below full power`,
    state.donePresent && state.doneVisible && state.doneDisabled === true,
    JSON.stringify({ present: state.donePresent, visible: state.doneVisible, disabled: state.doneDisabled }));
  check(`round ${round}: choosing a colour changes the hint to free painting`,
    state.hintText === 'すきなように ぬろう！', state.hintText);

  const beforeDecoration = state.debug?.power ?? 0;
  await stroke(page, box, style.decoration, 8);
  state = await h.ui();
  check(`round ${round}: non-favourite decoration deliberately charges nothing`,
    state.debug?.power === beforeDecoration,
    `${beforeDecoration} -> ${state.debug?.power}`);

  await selectColour(page, favourite);
  const bounds = silhouetteBounds();
  const rowStep = (BRUSHES[style.brush].diameter / PICTURE_SIZE) * 0.64;
  const phaseStart = h.observedPhases.length;
  let strokesUsed = 0;
  for (const points of orderedSweeps(bounds.minY, bounds.maxY, rowStep, style.fill)) {
    state = await h.ui();
    if (state.debug?.phase !== 'coloring' || (state.debug?.power ?? 0) >= 1) break;
    await stroke(page, box, points);
    strokesUsed += 1;
  }
  state = await h.waitFor((next) => next.debug?.phase === 'coloring'
    && next.debug?.power >= 1, 6000, 'full power while still coloring');
  const fullPower = clone(state?.debug);
  const measuredFavouriteCoverage = (fullPower?.coverage ?? 0) * (fullPower?.favouriteShare ?? 0);
  check(`round ${round}: painting reaches full power`, (state?.debug?.power ?? 0) >= 1,
    `power ${state?.debug?.power ?? 'missing'}, coverage ${state?.debug?.coverage ?? 'missing'}`);
  await h.sleep(FULL_POWER_SETTLE_MS);
  state = await h.ui();
  check(`round ${round}: full power waits for Done instead of activating itself`,
    state.debug?.phase === 'coloring' && state.screen && state.canvas,
    JSON.stringify({ phase: state.debug?.phase, screen: state.screen, canvas: state.canvas }));
  check(`round ${round}: Done is enabled and the full-power hint is visible`,
    state.donePresent && state.doneVisible && state.doneDisabled === false
      && state.hintText === 'できたら「できた！」を おそう',
    JSON.stringify({ disabled: state.doneDisabled, hint: state.hintText }));
  check(`round ${round}: favourite-colour activation is well below the old 68% threshold`,
    state?.debug?.phase === 'coloring' && measuredFavouriteCoverage < 0.68,
    `${(measuredFavouriteCoverage * 100).toFixed(1)}% favourite coverage`);
  notes.push(`round ${round}: power reached 1 at ${(measuredFavouriteCoverage * 100).toFixed(1)}% favourite-colour coverage (contract ${(FAVOURITE_POWER_THRESHOLD * 100).toFixed(0)}%); ${strokesUsed} ${style.brush}-brush ${style.fill} sweeps; heard ${favourite ?? 'no answer'}; decoration ${decorationColour}`);
  if (screenshots && round === 1) await page.screenshot({ path: `${OUT}-camera-paper-full-awaiting-done.png` });
  await page.click('.coloring-tool--done');
  state = await h.waitFor((next) => next.debug?.phase === 'activation-page', 6000, 'Done activation');
  check(`round ${round}: pressing enabled Done starts activation`,
    state?.debug?.phase === 'activation-page', state?.debug?.phase);

  // One NON-BLOCKING recorder for the whole cinematic, started as early as
  // possible and read back at the end.
  //
  // Two earlier shapes both failed. Polling for robot-exit from node costs a
  // round trip per check, and on the first activation — where frames are long —
  // the 0.55s retreat was largely spent before the sampler attached, measuring
  // a 1.25-unit move as 0.09. Widening a BLOCKING sampler to cover room-reveal
  // then swallowed the whole viewing beat, so the beat checks saw zero frames.
  // A recorder that writes to a page global lets node keep taking screenshots
  // and polling while every frame is still captured.
  await page.evaluate(() => {
    window.__cinematic = [];
    let frames = 0;
    const record = () => {
      frames += 1;
      const debug = window.__eslDebug?.coloring;
      if (debug) {
        window.__cinematic.push({
          phase: debug.phase,
          player: debug.player,
          // The newborn's own position, so the no-teleport check can compare
          // where it actually landed against where roaming starts, instead of
          // inferring the landing from the player.
          robot: debug.pending ?? null,
        });
      }
      if (debug?.phase !== 'room' && frames < 1200) requestAnimationFrame(record);
    };
    record();
  });

  state = await h.waitFor((next) => next.debug?.phase === 'reveal-easel', 8000, 'easel reveal', 60);
  if (screenshots && round === 1 && state) await page.screenshot({ path: `${OUT}-camera-easel-reveal.png` });
  // Sample from reveal-easel onward, not from robot-exit. Polling for
  // robot-exit from node costs a round trip per check, and on the FIRST
  // activation — where shader compilation and texture upload make frames long —
  // most of the 0.55s retreat is already spent by the time the sampler
  // attaches. Round 1 then reports a travel of 0.09 for a move that really
  // covers 1.25. Attaching a phase early makes the measurement honest.
  state = await h.waitFor((next) => next.debug?.phase === 'room-reveal', 9000, 'room reveal', 40);
  check(`round ${round}: landing enters a distinct easel-camera viewing beat`,
    state?.debug?.phase === 'room-reveal', state?.debug?.phase);
  if (screenshots && round === 1 && state) {
    await page.screenshot({ path: `${OUT}-camera-room-reveal-beat.png` });
  }
  await h.waitFor((next) => next.debug?.phase === 'room', 9000, 'room', 40);

  const cinematic = await page.evaluate(() => window.__cinematic ?? []);
  // Every frame the recorder saw is a real observation, in order, and node was
  // making no ui() calls for part of it — so these phases belong in the record
  // the phase-order check reads, or it sees gaps that never happened.
  for (const sample of cinematic) h.observedPhases.push(sample.phase);

  const retreatZ = cinematic.map((sample) => sample.player?.z).filter(Number.isFinite);
  const retreatTravel = Math.max(0, ...retreatZ) - Math.min(...retreatZ);
  const retreatSteps = retreatZ.slice(1).map((z, index) => z - retreatZ[index]);
  check(`round ${round}: player retreats gradually during the exit`,
    retreatTravel > 0.5
      && new Set(retreatZ.map((z) => z.toFixed(3))).size >= 4
      && Math.max(0, ...retreatSteps) < retreatTravel * 0.8,
    JSON.stringify({ samples: retreatZ.length, travel: retreatTravel, largestStep: Math.max(0, ...retreatSteps) }));

  const revealFrames = cinematic.filter((sample) => sample.phase === 'room-reveal').length;
  check(`round ${round}: easel camera holds for rendered frames after landing`,
    revealFrames >= 2,
    `${revealFrames} room-reveal frames recorded`);
  state = await h.ui();

  const movementSamples = await page.evaluate(() => new Promise((resolve) => {
    const samples = [];
    let frames = 0;
    const sample = () => {
      frames += 1;
      const debug = window.__eslDebug?.coloring;
      const newest = debug?.robots?.at(-1);
      if (newest) samples.push({ position: newest.position, lift: newest.lift });
      if (samples.length >= 14 || frames >= 120) resolve(samples);
      else requestAnimationFrame(sample);
    };
    sample();
  }));
  const landing = movementSamples[0]?.position;
  const playerAtLanding = cinematic.filter((sample) => sample.phase === 'room-reveal').at(-1)?.player
    ?? cinematic.at(-1)?.player;
  // Where the robot ACTUALLY ended the cinematic, not where the player implies
  // it should be. An earlier version derived this from the retreated player's
  // position, which only held while the retreat was purely backward — the
  // moment the player also stepped aside, the check failed on a robot that had
  // not moved at all. Comparing the recorded landing with the first roaming
  // frame tests the real claim: a synchronous snap to a distant roam point
  // cannot hide between the two.
  const expectedLanding = cinematic.filter((sample) => sample.robot).at(-1)?.robot ?? null;
  const roamDisplacements = movementSamples.slice(1).map((sample, index) => Math.hypot(
    sample.position.x - movementSamples[index].position.x,
    sample.position.z - movementSamples[index].position.z,
  ));
  check(`round ${round}: first roaming movement is continuous from the landing position`,
    Boolean(landing && expectedLanding)
      && Math.hypot(landing.x - expectedLanding.x, landing.z - expectedLanding.z) <= 1
      && roamDisplacements.length > 0
      && Math.max(...roamDisplacements) <= 1,
    JSON.stringify({ expectedLanding, landing, maxFrameDisplacement: Math.max(0, ...roamDisplacements) }));
  check(`round ${round}: retreated player is outside the robot landing footprint`,
    Boolean(playerAtLanding && landing)
      && Math.hypot(playerAtLanding.x - landing.x, playerAtLanding.z - landing.z) > 0.9,
    JSON.stringify({ player: playerAtLanding, landing }));

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
  if (newest) {
    artById.set(newest.id, artKey(newest.art));
    favouriteById.set(newest.id, favourite);
  }
  // Distinctness is only asserted between robots that heard DIFFERENT
  // favourite colours. The fingerprint samples a handful of points per piece,
  // and the favourite is what fills most of the silhouette, so two robots told
  // the same colour can legitimately fingerprint alike however differently
  // they were decorated — round 6 collided with round 2 exactly this way. A
  // shared or re-read texture would instead make robots with DIFFERENT
  // favourites collide, which is what this now catches. The check that a
  // robot's own artwork never changes is above, and is the stronger one.
  const byFavourite = [...artById.entries()]
    .filter(([id]) => favouriteById.get(id))
    .map(([id, art]) => ({ favourite: favouriteById.get(id), art }));
  const crossFavouriteCollision = byFavourite.some((a, i) => byFavourite
    .slice(i + 1)
    .some((b) => a.favourite !== b.favourite && a.art === b.art));
  check(`round ${round}: robots told different colours have different artwork`,
    !crossFavouriteCollision,
    JSON.stringify(byFavourite.map(({ favourite: f, art }) => ({ favourite: f, art }))));

  return state;
}

async function openNextRound(h, round, stateName, predicate) {
  // The player now retreats to EASEL.z + 3.4 so the robot can be seen leaving
  // the page, and that is outside the easel's 2.15 interaction radius. So the
  // child walks back to the easel, and so does the harness — before the
  // correction pass the player was left standing close enough to just press
  // Space, and waiting here without walking hangs forever.
  await h.pulseUntil(['KeyW'], (state) => state.debug?.action === 'easel', 24, 'the easel');
  const ready = await h.waitFor((state) => state.debug?.phase === 'room'
    && state.debug?.canAct
    && state.debug?.action === 'easel'
    && predicate(state.debug), 9000, `${stateName} easel action`, 45);
  check(`round ${round}: easel is interactable while ${stateName}`,
    Boolean(ready && ready.debug.action === 'easel'),
    JSON.stringify({ art: ready?.debug?.easelArt, opacity: ready?.debug?.easelArtOpacity, action: ready?.debug?.action }));
  if (stateName === 'fading') {
    check(`round ${round}: Space is pressed during a partial fade`,
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
  check('multi-robot crowd does not move in lockstep across several samples',
    mixedSamples >= 3, `${mixedSamples}/${samples.length} samples had mixed states`);
  check('multi-robot crowd has distinct idle pauses', pauses.size > 1, [...pauses].join(', '));
  check('multi-robot crowd positions are not all equal',
    separatedSamples === samples.length, `${separatedSamples}/${samples.length} separated samples`);
  check('no pair remains in a very small persistent stack',
    worstCloseRun < 8, `longest <0.1-unit run ${worstCloseRun} samples${worstPair ? ` (${worstPair})` : ''}`);
}

async function walkToDoor(h) {
  await h.pulseUntil(['KeyD'], (state) => (state.debug?.player?.x ?? -Infinity) >= 3.25,
    18, 'door x coordinate');
  return h.pulseUntil(['KeyW'], (state) => state.debug?.action === 'door', 32, 'door action');
}

async function leaveThroughDoor(h, label, { screenshot = false } = {}) {
  const { page } = h;
  await h.waitFor((state) => state.debug?.phase === 'room' && state.debug?.canAct,
    5000, `${label} room controls`);
  const atDoor = await walkToDoor(h);
  check(`${label}: approaching the doorway offers only the door action`,
    atDoor?.debug?.action === 'door' && atDoor.actionIsDoor,
    JSON.stringify({ debug: atDoor?.debug?.action, cue: atDoor?.action, class: atDoor?.actionIsDoor }));
  const newestBefore = atDoor?.debug?.robots?.at(-1) ?? null;
  await page.keyboard.press('Space');
  let state = await h.waitFor((next) => next.debug?.phase === 'turnaround', 4000, `${label} turnaround`);
  check(`${label}: door Space enters turnaround instead of another round`,
    state?.debug?.phase === 'turnaround', state?.debug?.phase);
  const newestDuring = state?.debug?.robots?.find((robot) => robot.id === newestBefore?.id);
  const askerGeometry = newestDuring && state.debug?.player
    ? {
      dx: state.debug.player.x - newestDuring.position.x,
      dz: state.debug.player.z - newestDuring.position.z,
    }
    : null;
  check(`${label}: the newest robot is the turnaround asker`,
    Boolean(newestDuring
      && newestDuring.id === state.debug.robots.at(-1)?.id
      && newestDuring.state === 'idle'
      && Math.abs(askerGeometry.dx - 1.5) < 0.08
      && Math.abs(askerGeometry.dz - 1.3) < 0.08
      && /what color do you like/i.test(state.dialogueBubble ?? '')),
    JSON.stringify({ newest: newestDuring?.id, state: newestDuring?.state, askerGeometry, bubble: state?.dialogueBubble }));
  check(`${label}: session stars equal min(3, robotsCompleted) before finishing`,
    state?.debug?.stars === Math.min(3, state?.debug?.robotsCompleted ?? 0),
    JSON.stringify({ stars: state?.debug?.stars, robots: state?.debug?.robotsCompleted }));
  if (screenshot) await page.screenshot({ path: `${OUT}-door-turnaround.png` });

  state = await openFallback(h, 3);
  check(`${label}: turnaround fallback offers all seven color answers`,
    state?.fallback?.length === PALETTE.length, state?.fallback?.map((answer) => answer.value).join(', '));
  const answered = await page.locator('.lesson-hud__fallback[data-value="purple"]')
    .click({ timeout: 4000 }).then(() => true, () => false);
  check(`${label}: turnaround answer is accepted through the fallback`, answered);
  state = await h.waitFor((next) => !next.debug && next.greeting !== null, 10000, `${label} finished hub`);
  check(`${label}: door turnaround finishes the minigame back at the hub`, Boolean(state), state?.greeting);
  return state;
}

async function assertBubbleReplay(h, size) {
  const { page } = h;
  let state = await h.ui();
  check(`${size}: the bubble speaker has the shipped words-only replay name`,
    state.bubbleSpeakerLabel === 'もういちど きく'
      && state.bubbleSpeakerTitle === 'もういちど きく',
    JSON.stringify({ label: state.bubbleSpeakerLabel, title: state.bubbleSpeakerTitle }));
  await page.click('.coloring-bubble__speaker');
  state = await h.ui();
  check(`${size}: clicking the bubble speaker replays without duplicating the answer`,
    state.debug?.usedListenAgain === true
      && state.bubbleSpeaking
      && state.bubbleAnswerCount === 1
      && state.bubbleSpeakerFocused === false,
    JSON.stringify({ replayed: state.debug?.usedListenAgain, speaking: state.bubbleSpeaking,
      answers: state.bubbleAnswerCount, focused: state.bubbleSpeakerFocused }));

  await h.sleep(600);
  await page.locator('.coloring-bubble__speaker').focus();
  state = await h.ui();
  check(`${size}: the bubble speaker can receive keyboard focus`,
    state.bubbleSpeakerFocused === true && state.bubbleSpeaking === false,
    JSON.stringify({ focused: state.bubbleSpeakerFocused, speaking: state.bubbleSpeaking }));
  await page.keyboard.press('Enter');
  state = await h.ui();
  check(`${size}: Enter on the focused bubble speaker replays the answer`,
    state.bubbleSpeakerFocused === true
      && state.debug?.usedListenAgain === true
      && state.bubbleSpeaking
      && state.bubbleAnswerCount === 1,
    JSON.stringify({ focused: state.bubbleSpeakerFocused, replayed: state.debug?.usedListenAgain,
      speaking: state.bubbleSpeaking, answers: state.bubbleAnswerCount }));
}

async function fillFavouriteToFull(h, box, favourite, paths) {
  await selectColour(h.page, favourite);
  await selectBrush(h.page, 'large');
  const bounds = silhouetteBounds();
  const rowStep = (BRUSHES.large.diameter / PICTURE_SIZE) * 0.58;
  let state = await h.ui();
  for (const points of sweeps(bounds.minY, bounds.maxY, rowStep)) {
    if ((state.debug?.power ?? 0) >= 1 || state.debug?.phase !== 'coloring') break;
    await stroke(h.page, box, points);
    paths.push(points);
    state = await h.ui();
  }
  return h.waitFor((next) => next.debug?.phase === 'coloring' && next.debug?.power >= 1,
    5000, 'full power without activation');
}

async function exerciseFullPowerEditing(h, box, favourite, ordinary, favouritePaths, size) {
  const { page } = h;
  await h.sleep(FULL_POWER_SETTLE_MS);
  let state = await h.ui();
  check(`${size}: a real charging beat at full power still leaves the page in coloring`,
    state.debug?.phase === 'coloring' && state.screen && state.canvas,
    JSON.stringify({ phase: state.debug?.phase, screen: state.screen, canvas: state.canvas }));
  check(`${size}: Done is enabled at full power`,
    state.donePresent && state.doneVisible && state.doneDisabled === false,
    JSON.stringify({ present: state.donePresent, visible: state.doneVisible, disabled: state.doneDisabled }));
  check(`${size}: the full-power hint tells the child to press Done`,
    state.hintText === 'できたら「できた！」を おそう', state.hintText);

  // Let the readiness celebration's blink finish: `artFingerprint` hashes the
  // DISPLAY canvas, which `drawPage` renders with the current eye state.
  await h.sleep(320);
  await selectColour(page, ordinary);
  await selectBrush(page, 'small');
  // Prime a rebuild before taking the baseline, so the comparison is
  // like-for-like. Live painting draws each segment as its own path and
  // antialiases it against what is already on the canvas; `undo()` calls
  // `rebuildPaint()`, which replays each stroke as ONE polyline and antialiases
  // it once. Same picture, different edge pixels — so a live-drawn baseline can
  // never equal a rebuilt one, however correct undo is. This throwaway margin
  // stroke charges no power and leaves the canvas in rebuilt form.
  await stroke(page, box, [[0.04, 0.10], [0.22, 0.10]], 8);
  await page.click('.coloring-tool--undo');
  await h.sleep(320);
  const beforeExtraPaint = await artFingerprint(page);
  const strokesBeforeExtra = (await h.ui()).debug?.strokes ?? NaN;
  await stroke(page, box, [[0.04, 0.04], [0.22, 0.04]], 8);
  const afterExtraPaint = await artFingerprint(page);
  state = await h.ui();
  check(`${size}: non-favourite painting still changes the artwork at full power`,
    beforeExtraPaint !== afterExtraPaint
      && state.debug?.power === 1
      && state.debug?.phase === 'coloring',
    JSON.stringify({ before: beforeExtraPaint, after: afterExtraPaint,
      power: state.debug?.power, phase: state.debug?.phase }));
  check(`${size}: undo and eraser remain enabled at full power`,
    state.undoDisabled === false && state.eraserDisabled === false,
    JSON.stringify({ undoDisabled: state.undoDisabled, eraserDisabled: state.eraserDisabled }));

  await page.click('.coloring-tool--eraser');
  state = await h.ui();
  check(`${size}: the eraser can be activated at full power`,
    state.debug?.erasing === true && state.eraserPressed === 'true' && state.debug?.phase === 'coloring',
    JSON.stringify({ erasing: state.debug?.erasing, pressed: state.eraserPressed,
      phase: state.debug?.phase }));
  await page.click('.coloring-tool--undo');
  await h.sleep(320);
  const afterUndo = await artFingerprint(page);
  state = await h.ui();
  check(`${size}: undo works at full power without starting activation`,
    afterUndo === beforeExtraPaint
      && afterUndo !== afterExtraPaint
      && state.debug?.strokes === strokesBeforeExtra
      && state.debug?.power === 1
      && state.debug?.phase === 'coloring',
    JSON.stringify({ before: beforeExtraPaint, afterExtraPaint, afterUndo,
      strokes: `${strokesBeforeExtra} -> ${state.debug?.strokes}`,
      power: state.debug?.power, phase: state.debug?.phase }));

  await selectBrush(page, 'large');
  if (!state.debug?.erasing) await page.click('.coloring-tool--eraser');
  const erasedPaths = [];
  for (const points of favouritePaths) {
    state = await h.ui();
    if ((state.debug?.power ?? 0) < 1) break;
    await stroke(page, box, points);
    erasedPaths.push(points);
  }
  state = await h.ui();
  check(`${size}: erasing enough favourite paint disables Done again`,
    state.debug?.phase === 'coloring'
      && state.debug?.power < 1
      && state.doneDisabled === true,
    JSON.stringify({ phase: state.debug?.phase, power: state.debug?.power,
      disabled: state.doneDisabled, erased: erasedPaths.length }));

  await selectColour(page, favourite);
  for (const points of erasedPaths) {
    state = await h.ui();
    if ((state.debug?.power ?? 0) >= 1) break;
    await stroke(page, box, points);
  }
  state = await h.waitFor((next) => next.debug?.phase === 'coloring'
    && next.debug?.power >= 1, 4000, 'restored full power');
  check(`${size}: restoring favourite paint re-enables Done`,
    state?.doneDisabled === false && state?.hintText === 'できたら「できた！」を おそう',
    JSON.stringify({ power: state?.debug?.power, disabled: state?.doneDisabled, hint: state?.hintText }));
  return state;
}

async function checkCanvasCentring(viewport) {
  const size = `${viewport.width}x${viewport.height}`;
  const h = await openPage(`centring-${size}`, { viewport });
  const entry = await enterColoring(h);
  check(`${size}: centring session reaches canvas-question`,
    entry.state?.phase === 'canvas-question' && entry.state?.canvas, entry.state?.phase);
  let state = await h.ui();
  check(`${size}: opening is title-free with exactly one exact hint`,
    state.titleAbsent
      && state.hintCount === 1
      && state.hintText === 'ボタンを おして、「What color do you like?」と きこう',
    JSON.stringify({ titleAbsent: state.titleAbsent, hintCount: state.hintCount, hint: state.hintText }));
  const before = await canvasBox(h.page);
  await h.page.screenshot({ path: `${OUT}-${size}-opening-title-free-one-hint.png` });
  const favourite = await answerCanvasQuestion(h, `centring ${size}`, false, async () => {
    await h.page.screenshot({ path: `${OUT}-${size}-answer-bubble-speaker.png` });
    await assertBubbleReplay(h, size);
  });
  const after = await canvasBox(h.page);
  await h.page.screenshot({ path: `${OUT}-${size}-tools-arrived-centred.png` });
  const beforeX = before ? before.x + before.width / 2 : NaN;
  const afterX = after ? after.x + after.width / 2 : NaN;
  check(`${size}: canvas centre does not shift when tools appear`,
    Number.isFinite(beforeX) && Number.isFinite(afterX) && Math.abs(afterX - beforeX) < 0.5,
    `${beforeX.toFixed?.(2)} -> ${afterX.toFixed?.(2)} (delta ${Math.abs(afterX - beforeX).toFixed?.(2)}px)`);

  state = await h.ui();
  const meter = await h.page.locator('.coloring-power').boundingBox();
  const verticalOverlap = after && meter
    ? Math.min(after.y + after.height, meter.y + meter.height) - Math.max(after.y, meter.y)
    : NaN;
  check(`${size}: vertical ROBOT POWER sits right of and overlaps the canvas`,
    Boolean(after && meter)
      && meter.x >= after.x + after.width - 0.5
      && verticalOverlap > 0
      && state.powerIcon,
    JSON.stringify({ canvas: after, meter, verticalOverlap, icon: state.powerIcon }));
  check(`${size}: bottom row has Undo, Eraser and Done with no Reset`,
    state.bottomButtonCount === 3 && state.donePresent && state.resetAbsent,
    JSON.stringify({ buttons: state.bottomButtonCount, done: state.donePresent,
      resetAbsent: state.resetAbsent }));

  const emptyMeter = await h.ui();
  const ordinary = nonFavouriteColour(favourite, 1);
  await selectColour(h.page, favourite);
  state = await h.ui();
  check(`${size}: choosing a colour shows the free-painting hint`,
    state.hintText === 'すきなように ぬろう！', state.hintText);
  await selectBrush(h.page, 'medium');
  const box = await canvasBox(h.page);
  const favouritePaths = [];
  const partialStroke = [[0.35, 0.25], [0.65, 0.25]];
  await stroke(h.page, box, partialStroke, 8);
  favouritePaths.push(partialStroke);
  await h.sleep(260);
  const partialMeter = await h.ui();
  const emptyHeight = parseFloat(emptyMeter.powerFillHeight);
  const partialHeight = parseFloat(partialMeter.powerFillHeight);
  const emptyWidth = parseFloat(emptyMeter.powerFillWidth);
  const partialWidth = parseFloat(partialMeter.powerFillWidth);
  check(`${size}: vertical power rises in height while its width stays fixed`,
    partialMeter.debug?.power > 0
      && partialMeter.debug.power < 1
      && partialHeight > emptyHeight + 0.5
      && Math.abs(partialWidth - emptyWidth) < 0.5,
    JSON.stringify({ power: partialMeter.debug?.power, emptyHeight, partialHeight,
      emptyWidth, partialWidth }));
  const emptyGeometry = emptyMeter.powerGeometry;
  const partialGeometry = partialMeter.powerGeometry;
  check(`${size}: power fill is bottom-anchored and grows upward`,
    Boolean(emptyGeometry && partialGeometry)
      && Math.abs(partialGeometry.fill.bottom - partialGeometry.trackInnerBottom) < 0.75
      && Math.abs(emptyGeometry.fill.bottom - emptyGeometry.trackInnerBottom) < 0.75
      && partialGeometry.fill.top < emptyGeometry.fill.top - 0.5,
    JSON.stringify({ empty: emptyGeometry, partial: partialGeometry }));
  await h.page.screenshot({ path: `${OUT}-${size}-meter-part-filled-upward.png` });

  state = await fillFavouriteToFull(h, box, favourite, favouritePaths);
  check(`${size}: the meter can reach full without leaving coloring`,
    state?.debug?.power === 1 && state?.debug?.phase === 'coloring',
    JSON.stringify({ power: state?.debug?.power, phase: state?.debug?.phase }));
  await exerciseFullPowerEditing(h, box, favourite, ordinary, favouritePaths, size);
  await h.page.screenshot({ path: `${OUT}-${size}-meter-full-done-enabled-not-activated.png` });

  await h.page.click('.coloring-tool--done');
  state = await h.waitFor((next) => next.debug?.phase === 'activation-page', 4000, 'Done activation');
  check(`${size}: Done is the action that starts activation`,
    state?.debug?.phase === 'activation-page', state?.debug?.phase);
  state = await h.waitFor((next) => next.debug?.phase === 'robot-exit', 10000, 'robot leaving the sheet', 30);
  check(`${size}: activation reaches the robot-leaving-sheet moment`,
    state?.debug?.phase === 'robot-exit', state?.debug?.phase);
  if (state) {
    await h.sleep(620);
    await h.page.screenshot({ path: `${OUT}-${size}-easel-robot-leaving-sheet.png` });
  }
  await h.page.close();
}

// The layout contract is checked in isolated pages so every canonical viewport
// is exercised in this one harness invocation, regardless of argv[4]/argv[5].
for (const viewport of CENTRING_VIEWPORTS) await checkCanvasCentring(viewport);

// ---- Session A: persistence visits, six rounds, and door turnarounds ------
{
  // `?editor=1`, like the performance session: this scenario uses the dev-gated
  // `coloringReset` hook, and the harness runs against a PRODUCTION preview
  // build, where `import.meta.env.DEV` is false. The gate is right; the harness
  // opts in rather than the game loosening it for a test.
  const sessionUrl = new URL(TARGET_URL);
  sessionUrl.searchParams.set('editor', '1');
  const h = await openPage('multi-round', { url: sessionUrl.href });
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

  await leaveThroughDoor(h, 'visit 1');
  await enterColoring(h);
  // enterColoring returns entry SAMPLES ({phase, room, screen, canvas}), which
  // carry no `debug`. The restored robots have to be read from a real snapshot.
  state = await h.ui();
  check('return after first finish restores the first robot with unchanged artwork',
    state?.debug?.robots?.length === 1
      && artById.get(state.debug.robots[0].id) === artKey(state.debug.robots[0].art),
    JSON.stringify(state?.debug?.robots?.map((robot) => ({ id: robot.id, art: robot.art }))));
  state = await paintRound(h, 2, ROUND_STYLES[1], artById, { detailedChecks: false });

  await leaveThroughDoor(h, 'visit 2');
  await enterColoring(h);
  state = await h.ui();
  const returnedArts = state?.debug?.robots?.map((robot) => artKey(robot.art)) ?? [];
  check('return after second finish restores both robots with unchanged, distinct artwork',
    state?.debug?.robots?.length === 2
      && state.debug.robots.every((robot) => artById.get(robot.id) === artKey(robot.art))
      && new Set(returnedArts).size === 2,
    JSON.stringify(state?.debug?.robots?.map((robot) => ({ id: robot.id, art: robot.art }))));
  state = await paintRound(h, 3, ROUND_STYLES[2], artById, { detailedChecks: false });

  // Round 4 starts before the invitation has begun to fade in.
  await openNextRound(h, 4, 'blank', (debug) => debug.easelArt === 'blank');
  state = await paintRound(h, 4, ROUND_STYLES[3], artById, { detailedChecks: false });

  // Round 5 interrupts the invitation while its opacity is strictly partial.
  await openNextRound(h, 5, 'fading', (debug) => debug.easelArt === 'fading'
    && debug.easelArtOpacity > 0 && debug.easelArtOpacity < 1);
  state = await paintRound(h, 5, ROUND_STYLES[4], artById, { detailedChecks: false });

  // Round 6 waits until the line art has completely arrived.
  await openNextRound(h, 6, 'ready', (debug) => debug.easelArt === 'ready');
  state = await paintRound(h, 6, ROUND_STYLES[5], artById, { detailedChecks: false });
  await h.waitFor((next) => next.debug?.phase === 'room' && next.debug?.canAct, 5000, 'six-robot room controls');
  await page.screenshot({ path: `${OUT}-room-six-robots.png` });

  await sampleCrowd(h);
  state = await h.ui();
  check('all six accumulated robots still have their original artwork',
    state.debug?.robots?.length === 6 && state.debug.robots.every((robot) => artById.get(robot.id) === artKey(robot.art)),
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
  check('six completed robots finish with three saved stars',
    saved?.bestStars?.coloring === Math.min(3, 6), JSON.stringify(saved?.bestStars));

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
  await paintRound(h, 1, ROUND_STYLES[2], artById,
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
  ROUND_STYLES.every(({ colorOffset, brush, decoration }) => Number.isInteger(colorOffset)
    && colorOffset > 0
    && colorOffset < PALETTE.length
    && BRUSH_IDS.includes(brush)
    && decoration.every(([x, y]) => insideSilhouette(x, y)))
    && BRUSH_IDS.includes(DEFAULT_BRUSH));
check('no console or page errors', errors.length === 0, errors.slice(0, 4).join(' || '));
for (const note of notes) console.log(`NOTE  ${note}`);
const failed = results.filter((result) => !result.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
await browser.close();
if (failed > 0) process.exitCode = 1;
