// Does a finished creation survive a refresh, and a full browser reopen?
//
// Run through scripts/playthrough-run.mjs. This harness deliberately uses a
// PERSISTENT Chromium profile: an ordinary Playwright context throws its
// IndexedDB away on close, which would make "reopen the browser" untestable and
// quietly pass a reload-only check instead.
//
// It is subject-agnostic on purpose. The room now picks one of several subjects
// at random, so nothing here may depend on the robot silhouette: it floods the
// whole canvas in the favourite colour and lets coverage count whatever shape
// is underneath.
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const TARGET_URL = process.argv[2] || 'http://localhost:5199/';
const OUT = process.argv[3] || '.tmp/persist';
const VIEW = { width: Number(process.argv[4]) || 1024, height: Number(process.argv[5]) || 600 };

const SAVE_KEY = 'esl-likes-save-v1';
const ANSWER_PATTERN = /^I like ([a-z]+)\.$/;
const results = [];
const notes = [];
const errors = [];

function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

const profileDir = path.join(os.tmpdir(), `esl-persist-${process.pid}`);

// A persistent context keeps the whole browser alive, so an escaping error
// would otherwise leave Chromium running and this process never exiting.
// Every open context is tracked and closed in the final `finally`.
let openContext = null;

/** One browser lifetime against the same on-disk profile. */
async function openBrowser(label) {
  const context = await chromium.launchPersistentContext(profileDir, {
    viewport: VIEW,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  openContext = context;
  // Mic-free mode, exactly as the coloring harness seeds it: the read-along
  // fallback only exists when the game is not waiting on a real microphone.
  // This writes only the localStorage save — creations live in IndexedDB, so
  // re-seeding it on each browser start deliberately does not touch them.
  await context.addInitScript((key) => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem(key, JSON.stringify({ version: 1, settings: { micFree: true, difficulty: 1 } }));
      sessionStorage.setItem('seeded', '1');
    }
  }, SAVE_KEY);
  const page = context.pages()[0] ?? await context.newPage();
  page.on('console', (message) => {
    const text = message.text();
    if (message.type() === 'error') errors.push(`${label}: ${text}`);
    // The persistence layer warns rather than throwing; a warning here means
    // durability silently fell back to memory, which is the failure this
    // harness exists to catch.
    if (message.type() === 'warning' && /creation/i.test(text)) {
      errors.push(`${label}: PERSISTENCE WARNING ${text}`);
    }
  });
  page.on('pageerror', (error) => errors.push(`${label}: PAGEERROR ${error.message}`));
  return { context, page };
}

const debugOf = (page) => page.evaluate(() => window.__eslDebug?.coloring ?? null);

async function waitFor(page, predicate, timeoutMs, what) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await debugOf(page);
    if (predicate(last)) return last;
    await page.waitForTimeout(40);
  }
  check(`waiting for ${what}`, false, JSON.stringify(last)?.slice(0, 200));
  return null;
}

async function hold(page, keys, ms) {
  for (const key of keys) await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  for (const key of keys) await page.keyboard.up(key);
}

/** Tap a key repeatedly until the world reports what we are walking towards. */
async function pulseUntil(page, keys, predicate, taps, what) {
  for (let i = 0; i < taps; i += 1) {
    const state = await debugOf(page);
    if (predicate(state)) return state;
    await hold(page, keys, 140);
    await page.waitForTimeout(60);
  }
  const last = await debugOf(page);
  if (predicate(last)) return last;
  check(`walking to ${what}`, false, JSON.stringify(last?.action ?? last)?.slice(0, 160));
  return null;
}

async function bootHub(page) {
  await page.goto(TARGET_URL, { waitUntil: 'load' });
  await page.waitForTimeout(2600);
}

/** Hub -> Coloring close-up. The route is the one the coloring harness uses. */
async function enterColoring(page, label) {
  await hold(page, ['KeyW', 'KeyA'], 1220);
  await hold(page, ['KeyW'], 950);
  await page.keyboard.press('Space');
  const opened = await waitFor(page, (d) => d?.phase === 'canvas-question', 9000,
    `${label} canvas-question`);
  return Boolean(opened);
}

/** Answer the colour question through the mic-free read-along fallback. */
async function answerQuestion(page, label) {
  // Press-to-talk: the read-along fallback only appears after one deliberate
  // Talk press, and Talk itself only appears once the question has been asked.
  await page.waitForSelector('.lesson-hud__talk', { state: 'visible', timeout: 15000 });
  await page.click('.lesson-hud__talk', { force: true });
  await page.waitForSelector('.lesson-hud__fallback', { state: 'visible', timeout: 8000 });
  await page.click('.lesson-hud__fallback');
  const ready = await waitFor(page, (d) => d?.phase === 'coloring' && d?.toolsVisible, 9000,
    `${label} coloring tools`);
  if (!ready) return null;
  const answer = await page.locator('.coloring-bubble__answer').first()
    .textContent().catch(() => null);
  const favourite = answer?.replace(/\s+/g, ' ').trim().match(ANSWER_PATTERN)?.[1] ?? null;
  check(`${label}: the drawing names a favourite colour`, Boolean(favourite), String(answer));
  return favourite;
}

function toScreen(box, x, y) {
  const size = Math.min(box.width, box.height);
  return {
    x: box.x + (box.width - size) / 2 + x * size,
    y: box.y + (box.height - size) / 2 + y * size,
  };
}

async function stroke(page, box, from, to) {
  const start = toScreen(box, from[0], from[1]);
  const end = toScreen(box, to[0], to[1]);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(30);
}

/** Flood the sheet in the favourite colour until the power bar is full. */
async function paintToFullPower(page, favourite, label) {
  await page.click(`.coloring-swatch[data-color="${favourite}"]`, { force: true });
  await page.waitForTimeout(70);
  await page.click('.coloring-brush[data-brush="large"]', { force: true });
  await page.waitForTimeout(70);
  const box = await page.locator('.coloring-canvas').boundingBox();
  for (let y = 0.06; y <= 0.96; y += 0.035) {
    const state = await debugOf(page);
    if ((state?.power ?? 0) >= 1 || state?.phase !== 'coloring') break;
    await stroke(page, box, [0.06, y], [0.94, y]);
  }
  const full = await waitFor(page, (d) => d?.phase === 'coloring' && d?.power >= 1, 6000,
    `${label} full power`);
  return Boolean(full);
}

/** Full power -> Done -> the creation is alive and roaming the room. */
async function finishCreation(page, label) {
  await page.waitForTimeout(1200);
  await page.click('.coloring-tool--done', { force: true });
  const room = await waitFor(page, (d) => d?.phase === 'room' && d?.canAct, 25000,
    `${label} room after Done`);
  return room;
}

/** In the room, walk back to the easel and open the next picture. */
async function openNextRound(page, label) {
  await pulseUntil(page, ['KeyW'], (d) => d?.action === 'easel', 24, 'the easel');
  const ready = await waitFor(page, (d) => d?.phase === 'room' && d?.canAct && d?.action === 'easel',
    9000, `${label} easel action`);
  if (!ready) return false;
  await page.keyboard.press('Space');
  return Boolean(await waitFor(page, (d) => d?.phase === 'canvas-question', 9000,
    `${label} next close-up`));
}

/** One complete creation, from the close-up to a living creature in the room. */
async function makeCreation(page, label) {
  const favourite = await answerQuestion(page, label);
  if (!favourite) return null;
  if (!await paintToFullPower(page, favourite, label)) return null;
  const room = await finishCreation(page, label);
  return room;
}

const artOf = (state) => (state?.robots ?? []).map((robot) => robot.art).sort();

async function readRoom(page, label) {
  const state = await waitFor(page, (d) => d?.phase === 'room' && d?.canAct, 20000,
    `${label} room`);
  return state;
}

async function main() {
  await fs.rm(profileDir, { recursive: true, force: true });

  // ---- Session 1: paint two creations -------------------------------------
  let { context, page } = await openBrowser('session-1');
  await bootHub(page);
  check('session 1: Coloring opens from the hub', await enterColoring(page, 'session 1'));

  const first = await makeCreation(page, 'creation 1');
  check('session 1: the first creation comes alive', first?.robots?.length === 1,
    `robots=${first?.robots?.length}`);

  check('session 1: a second picture opens', await openNextRound(page, 'session 1'));
  const second = await makeCreation(page, 'creation 2');
  check('session 1: the second creation comes alive', second?.robots?.length === 2,
    `robots=${second?.robots?.length}`);

  const paintedArt = artOf(second);
  const persistedStatus = await page.evaluate(async () => {
    // Give the background write queue a moment; gameplay never waits on it.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return window.__eslDebug?.coloring?.persistence ?? null;
  });
  notes.push(`after 2 creations: ${JSON.stringify(persistedStatus)}`);
  check('session 1: both creations reached durable storage',
    persistedStatus?.available === true && persistedStatus?.count === 2,
    JSON.stringify(persistedStatus));
  check('session 1: durable artwork has a real size',
    (persistedStatus?.bytes ?? 0) > 0, `${persistedStatus?.bytes} bytes`);
  await page.screenshot({ path: `${OUT}-1-two-creations.png` });

  // ---- A plain refresh, same browser --------------------------------------
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2600);
  check('refresh: Coloring opens again', await enterColoring(page, 'refresh'));
  // Leave the close-up without painting: the room behind it holds the restored
  // creations, which is what we came to count.
  const afterRefreshRoom = await (async () => {
    const favourite = await answerQuestion(page, 'refresh');
    if (!favourite) return null;
    return waitFor(page, (d) => Array.isArray(d?.robots), 5000, 'refresh room robots');
  })();
  check('refresh: both creations survived a page reload',
    afterRefreshRoom?.robots?.length === 2, `robots=${afterRefreshRoom?.robots?.length}`);
  check('refresh: the restored artwork is pixel-identical',
    JSON.stringify(artOf(afterRefreshRoom)) === JSON.stringify(paintedArt),
    `${JSON.stringify(artOf(afterRefreshRoom))} vs ${JSON.stringify(paintedArt)}`);
  await page.screenshot({ path: `${OUT}-2-after-refresh.png` });

  // ---- Close the browser completely, then reopen the same profile ---------
  await context.close();
  ({ context, page } = await openBrowser('session-2'));
  await bootHub(page);
  check('reopen: Coloring opens in a new browser session', await enterColoring(page, 'reopen'));
  const reopenFavourite = await answerQuestion(page, 'reopen');
  const reopened = await waitFor(page, (d) => Array.isArray(d?.robots), 5000, 'reopen room robots');
  check('reopen: both creations survived a full browser restart',
    reopened?.robots?.length === 2, `robots=${reopened?.robots?.length}`);
  check('reopen: artwork is still pixel-identical after a restart',
    JSON.stringify(artOf(reopened)) === JSON.stringify(paintedArt),
    `${JSON.stringify(artOf(reopened))} vs ${JSON.stringify(paintedArt)}`);

  // ---- A third creation made AFTER hydration, then Back immediately -------
  if (reopenFavourite && await paintToFullPower(page, reopenFavourite, 'creation 3')) {
    const third = await finishCreation(page, 'creation 3');
    check('reopen: a creation made after hydration joins the other two',
      third?.robots?.length === 3, `robots=${third?.robots?.length}`);
    await page.screenshot({ path: `${OUT}-3-three-creations.png` });
    // Back to the hub the instant it is finished: the durable write is owned by
    // the module, not the controller, so leaving must not cancel it.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(900);
  } else {
    check('reopen: a third creation could be painted', false);
  }

  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2600);
  check('after Back: Coloring opens once more', await enterColoring(page, 'final'));
  await answerQuestion(page, 'final');
  const finalRoom = await waitFor(page, (d) => Array.isArray(d?.robots), 5000, 'final room robots');
  check('after Back: all three creations are present, with no duplicates',
    finalRoom?.robots?.length === 3, `robots=${finalRoom?.robots?.length}`);
  const finalStatus = await page.evaluate(() => window.__eslDebug?.coloring?.persistence ?? null);
  notes.push(`final persistence: ${JSON.stringify(finalStatus)}`);
  notes.push(`approx durable bytes per creation: ${Math.round((finalStatus?.bytes ?? 0) / 3)}`);
  notes.push(`projected for 10 creations: ${Math.round(((finalStatus?.bytes ?? 0) / 3) * 10 / 1024)} KB`);
  notes.push(`projected for 20 creations: ${Math.round(((finalStatus?.bytes ?? 0) / 3) * 20 / 1024)} KB`);
  await page.screenshot({ path: `${OUT}-4-final.png` });

  await context.close();
  await fs.rm(profileDir, { recursive: true, force: true });
}

try {
  await main();
} catch (error) {
  check('the persistence run completed without throwing', false, String(error?.message ?? error));
} finally {
  await openContext?.close().catch(() => {});
  await fs.rm(profileDir, { recursive: true, force: true }).catch(() => {});
}

check('no console or page errors', errors.length === 0, errors.slice(0, 4).join(' || '));
for (const note of notes) console.log(`NOTE  ${note}`);
const failed = results.filter((result) => !result.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
if (failed > 0) process.exitCode = 1;
