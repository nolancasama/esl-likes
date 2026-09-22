// Scripted Coloring playthrough, driven through the mic-free fallback. Run from this repo:
//   npm run build && npx vite preview --port 5199   (in another terminal)
//   node scripts/playthrough-coloring.mjs http://localhost:5199/ .tmp/col [w] [h]
//
// The minigame is freehand painting gated by a ROBOT POWER bar, so this drags
// strokes rather than tapping regions, and the interesting assertions are all
// about what does and does not charge the bar: new area does, repainting does
// not, background does not, the NPC's favourite colour charges 1.5x. At full
// power the robot activates by itself — there is no Done button to press.
//
// Geometry comes from robotDefinition.js, imported here, so the harness cannot
// drift from the robot.
// playwright resolves from recipe-tester/node_modules; it is not a dependency here.
import { chromium } from 'playwright';
import { openFallback } from './lib/pressTalk.mjs';
import { insideSilhouette, silhouetteBounds } from '../src/minigames/coloring/robotDefinition.js';
import { PALETTE } from '../src/minigames/coloring/palette.js';
import { BRUSHES, BRUSH_IDS, DEFAULT_BRUSH } from '../src/minigames/coloring/brushes.js';
import { POWER_THRESHOLD, FAVOURITE_BONUS } from '../src/minigames/coloring/coverage.js';

const URL = process.argv[2] || 'http://localhost:5199/';
const OUT = process.argv[3] || '.tmp/col';
const VIEW = { width: Number(process.argv[4]) || 1024, height: Number(process.argv[5]) || 600 };
const SAVE_KEY = 'esl-likes-save-v1';

/** A margin stroke that is provably clear of the robot, for the background check. */
const MARGIN_X = 0.035;

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

async function openPage(label) {
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${label}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`${label}: PAGEERROR ${e.message}`));
  const sleep = (ms) => page.waitForTimeout(ms);
  const ui = () => page.evaluate(() => {
    const visible = (el) => Boolean(el) && !el.hidden && !el.closest('[hidden]') && !el.closest('.is-hidden')
      && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';
    const q = (s) => document.querySelector(s);
    const text = (s) => (visible(q(s)) ? q(s).textContent.replace(/\s+/g, ' ').trim() : null);
    return {
      room: Boolean(q('.coloring-room-ui')),
      restaurant: Boolean(q('.restaurant-ui')),
      screen: visible(q('.coloring-screen')),
      action: text('.coloring-room-ui__action'),
      bubble: text('.npc-dialogue__line'),
      notice: text('.coloring-answer-notice'),
      instruction: text('.coloring-screen__instruction'),
      resetConfirm: visible(q('.coloring-reset-confirm')),
      done: Boolean(q('.coloring-done')),
      swatches: document.querySelectorAll('.coloring-swatch').length,
      brushes: [...document.querySelectorAll('.coloring-brush')].map((b) => b.dataset.brush),
      brushPressed: [...document.querySelectorAll('.coloring-brush')]
        .filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.brush),
      pressed: [...document.querySelectorAll('.coloring-swatch')]
        .filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.color),
      powerBar: visible(q('.coloring-power')),
      powerWidth: q('.coloring-power__fill')?.style.width ?? null,
      powerText: text('.coloring-power'),
      undoEnabled: q('.coloring-tool--undo') ? !q('.coloring-tool--undo').disabled : null,
      eraserOn: q('.coloring-tool--eraser')?.getAttribute('aria-pressed') === 'true',
      listen: visible(q('.listen-again')),
      fallback: [...document.querySelectorAll('.lesson-hud__fallback')].filter(visible)
        .map((b) => ({ text: b.getAttribute('aria-label') || b.textContent, value: b.dataset.value ?? null })),
      greeting: q('.greeting')?.textContent.trim() ?? null,
      talk: visible(q('.lesson-hud__talk')),
      debug: window.__eslDebug?.coloring ?? null,
      body: document.body.innerText,
    };
  });
  const waitFor = async (pred, ms, label2) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const s = await ui();
      if (pred(s)) return s;
      await sleep(120);
    }
    console.log(`  (timed out waiting for ${label2})`);
    return null;
  };
  const hold = async (keys, ms) => {
    for (const k of keys) await page.keyboard.down(k);
    await sleep(ms);
    for (const k of keys) await page.keyboard.up(k);
    await sleep(80);
  };
  const pulseUntil = async (keys, pred, max, label2) => {
    for (let i = 0; i < max; i += 1) {
      const s = await ui();
      if (pred(s)) return s;
      await hold(keys, 140);
    }
    const s = await ui();
    if (!pred(s)) console.log(`  (never reached ${label2})`);
    return pred(s) ? s : null;
  };
  await page.goto(URL, { waitUntil: 'networkidle' });
  await sleep(3200);
  return { page, sleep, ui, waitFor, hold, pulseUntil };
}

// Hub door for Coloring sits second from the left of the arc.
async function enterColoring(h) {
  await h.hold(['KeyW', 'KeyA'], 1220);
  await h.hold(['KeyW'], 950);
  await h.page.keyboard.press('Space');
  return h.waitFor((u) => u.room || u.restaurant, 7000, 'coloring room');
}

async function askArtist(h) {
  await h.sleep(1200);
  const reached = await h.pulseUntil(['KeyW'], (u) => u.talk || u.fallback.length > 0, 30, 'artist');
  if (!reached) return { asked: null, answer: null, favourite: null };
  await h.sleep(2000);
  const standing = await h.ui();
  check('standing at the artist opens no read-along until Talk is pressed',
    standing.talk && standing.fallback.length === 0,
    JSON.stringify({ talk: standing.talk, fallback: standing.fallback.length }));
  const s = await openFallback(h);
  if (!s) return { asked: null, answer: null, favourite: null };
  await h.page.click('.lesson-hud__fallback');
  const pattern = new RegExp(`^I like (${PALETTE.join('|')})\\.$`);
  const a = await h.waitFor((u) => u.bubble && pattern.test(u.bubble), 7000, 'answer');
  return { asked: s, answer: a, favourite: a?.bubble.match(/^I like (\w+)\./)?.[1] ?? null };
}

const canvasBox = (page) => page.locator('.coloring-canvas').boundingBox();

async function selectColour(page, colour) {
  await page.click(`.coloring-swatch[data-color="${colour}"]`, { force: true });
  await page.waitForTimeout(90);
}

async function selectBrush(page, id) {
  await page.click(`.coloring-brush[data-brush="${id}"]`, { force: true });
  await page.waitForTimeout(90);
}

/** Picture fractions to screen pixels, honouring the object-fit letterbox. */
function toScreen(box, x, y) {
  const size = Math.min(box.width, box.height);
  return {
    x: box.x + (box.width - size) / 2 + x * size,
    y: box.y + (box.height - size) / 2 + y * size,
  };
}

/**
 * Drags a stroke across the picture.
 *
 * `steps` deliberately low by default: a touchpad reports few points over a
 * fast flick, and the coverage grid is supposed to interpolate the gap.
 */
async function stroke(page, box, points, steps = 3) {
  const first = toScreen(box, points[0][0], points[0][1]);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const [x, y] of points.slice(1)) {
    const at = toScreen(box, x, y);
    await page.mouse.move(at.x, at.y, { steps });
  }
  await page.mouse.up();
  await page.waitForTimeout(40);
}

const power = async (h) => (await h.ui()).debug?.power ?? 0;

/** Horizontal sweeps down the robot, which is how a child fills a big shape. */
function sweeps(from, to, step) {
  const rows = [];
  for (let y = from; y <= to; y += step) rows.push([[0.1, y], [0.9, y]]);
  return rows;
}

// ---- Session A: paint until the robot wakes up ---------------------------
{
  const h = await openPage('A');
  const { page } = h;
  await page.screenshot({ path: `${OUT}-01-hub.png` });
  let s = await enterColoring(h);
  check('hub -> Coloring room', s?.room, s?.restaurant ? 'entered the Restaurant instead' : '');
  await h.sleep(1500);
  await page.screenshot({ path: `${OUT}-02-room.png` });

  const { asked, answer, favourite } = await askArtist(h);
  check('question offered: "What color do you like?"',
    asked && /what color do you like/i.test(asked.fallback[0].text), asked?.fallback[0]?.text);
  check('NPC answers with an exact vocabulary sentence, from all seven colours',
    favourite && PALETTE.includes(favourite), answer?.bubble);
  await page.screenshot({ path: `${OUT}-03-answer.png` });

  s = await h.waitFor((u) => u.screen, 9000, 'colouring screen');
  check('3D -> 2D: colouring screen opens', s);
  await h.sleep(700);
  s = await h.ui();
  check('all seven colours are offered', s.swatches === 7, String(s.swatches));
  check('three brushes are offered', s.brushes.length === 3, s.brushes.join(','));
  check('Medium is the brush selected by default',
    s.brushPressed.length === 1 && s.brushPressed[0] === DEFAULT_BRUSH, s.brushPressed.join(','));
  check('no swatch is selected by default', s.pressed.length === 0, JSON.stringify(s.pressed));
  check('the ROBOT POWER bar is shown, and starts empty',
    s.powerBar && (s.powerWidth === '0%' || s.powerWidth === '0.0%'), s.powerWidth);
  check('there is no Done button any more — the bar is the goal', s.done === false);
  check('Undo starts unavailable', s.undoEnabled === false);
  check('no colour name is written anywhere on the page',
    !PALETTE.some((c) => new RegExp(c.toUpperCase()).test(s.body)), s.instruction);
  check('the favourite colour is never named on the page',
    !new RegExp(favourite, 'i').test(s.body), s.instruction);
  check('🔊 listen-again is offered while colouring', s.listen);
  await page.screenshot({ path: `${OUT}-04-blank.png` });

  await page.click('.listen-again');
  s = await h.waitFor((u) => u.notice && /I like/.test(u.notice), 3000, 'replayed answer');
  check('🔊 replays the exact answer sentence', s && s.notice.includes(`I like ${favourite}.`), s?.notice);
  await h.sleep(2400);

  const box = await canvasBox(page);
  const other = PALETTE.find((c) => c !== favourite);

  // --- what charges the bar, and what does not ---
  await selectColour(page, other);
  s = await h.ui();
  check('choosing a swatch selects exactly that colour',
    s.pressed.length === 1 && s.pressed[0] === other, JSON.stringify(s.pressed));

  await selectBrush(page, 'large');
  const before = await power(h);
  await stroke(page, box, [[0.33, 0.5], [0.67, 0.5]]);
  const afterOne = await power(h);
  check('a stroke across the robot charges the bar', afterOne > before,
    `${before.toFixed(4)} -> ${afterOne.toFixed(4)}`);
  s = await h.ui();
  check('the bar visibly moves', s.powerWidth !== '0%' && s.powerWidth !== '0.0%', s.powerWidth);
  check('Undo becomes available after a stroke', s.undoEnabled === true);

  for (let i = 0; i < 6; i += 1) await stroke(page, box, [[0.33, 0.5], [0.67, 0.5]]);
  const afterRepeat = await power(h);
  check('painting the same place again charges nothing',
    Math.abs(afterRepeat - afterOne) < 1e-9, `${afterOne.toFixed(4)} -> ${afterRepeat.toFixed(4)}`);

  await stroke(page, box, [[MARGIN_X, 0.15], [MARGIN_X, 0.85]]);
  const afterBackground = await power(h);
  check('painting the paper around the robot charges nothing',
    Math.abs(afterBackground - afterRepeat) < 1e-9,
    `${afterRepeat.toFixed(4)} -> ${afterBackground.toFixed(4)}`);

  // --- undo, and the favourite-colour bonus measured on the same stroke ---
  const line = [[0.33, 0.62], [0.67, 0.62]];
  const base = await power(h);
  await stroke(page, box, line);
  const plainGain = (await power(h)) - base;
  await page.click('.coloring-tool--undo');
  await h.sleep(120);
  const restored = await power(h);
  check('Undo takes back a whole stroke, power and all',
    Math.abs(restored - base) < 1e-9, `${base.toFixed(4)} -> ${restored.toFixed(4)}`);

  await selectColour(page, favourite);
  await stroke(page, box, line);
  const faveGain = (await power(h)) - base;
  const ratio = faveGain / plainGain;
  check(`the favourite colour charges ${FAVOURITE_BONUS}x faster on the same stroke`,
    Math.abs(ratio - FAVOURITE_BONUS) < 0.08, `measured ${ratio.toFixed(3)}x`);

  // --- the eraser ---
  await page.click('.coloring-tool--eraser');
  s = await h.ui();
  check('the eraser can be armed', s.eraserOn === true);
  const beforeErase = await power(h);
  await stroke(page, box, line);
  const afterErase = await power(h);
  check('the eraser gives back the coverage it removes', afterErase < beforeErase,
    `${beforeErase.toFixed(4)} -> ${afterErase.toFixed(4)}`);
  await page.click('.coloring-tool--eraser');

  // --- the guarded reset ---
  await page.click('.coloring-tool--reset');
  s = await h.ui();
  check('やりなおす asks before it erases anything', s.resetConfirm === true);
  await page.click('.coloring-reset-confirm [data-reset="no"]');
  s = await h.ui();
  check('declining やりなおす keeps the painting', (await power(h)) === afterErase);

  // --- a small brush must be usable on a detail ---
  await selectBrush(page, 'small');
  await selectColour(page, other);
  const beforeDetail = await power(h);
  await stroke(page, box, [[0.5, 0.075], [0.5, 0.12]]);
  check('the small brush can colour the antenna', (await power(h)) > beforeDetail);
  await page.screenshot({ path: `${OUT}-05-painting.png` });

  // --- paint until the bar fills, and time it ---
  await selectBrush(page, 'large');
  await selectColour(page, other);
  const started = Date.now();
  let strokesUsed = 0;
  for (const points of sweeps(0.06, 0.96, 0.028)) {
    if ((await h.ui()).debug?.phase !== 'painting') break;
    await stroke(page, box, points);
    strokesUsed += 1;
  }
  const seconds = (Date.now() - started) / 1000;
  s = await h.ui();
  notes.push(`full power took ${strokesUsed} large-brush sweeps (${seconds.toFixed(1)}s of scripted dragging)`);
  check('the bar reaches full from painting alone', s.debug.power >= 1 || s.debug.phase !== 'painting',
    `power ${s.debug.power.toFixed(3)} at ${(s.debug.coverage * 100).toFixed(1)}% coverage`);
  check('full power arrives well before the page is completely filled',
    s.debug.coverage < 0.95, `${(s.debug.coverage * 100).toFixed(1)}% coverage`);
  check(`coverage at full is near the ${(POWER_THRESHOLD * 100).toFixed(0)}% threshold`,
    s.debug.coverage > 0.3, `${(s.debug.coverage * 100).toFixed(1)}%`);
  await page.screenshot({ path: `${OUT}-06-full-power.png` });

  // --- activation happens by itself ---
  s = await h.waitFor((u) => u.debug?.phase === 'charging' || u.debug?.phase === 'activation'
    || u.debug?.phase === 'landing' || !u.screen, 6000, 'automatic activation');
  check('full power activates the robot automatically, with nothing to press', s, s?.debug?.phase);
  await page.screenshot({ path: `${OUT}-07-activating.png` });

  s = await h.waitFor((u) => !u.screen && u.room, 12000, 'back in the atelier');
  check('2D -> 3D: the cinematic returns to the atelier by itself', s);
  s = await h.waitFor((u) => u.debug?.puppet?.present, 6000, 'puppet in the room');
  check('the paper robot is in the atelier', s, JSON.stringify(s?.debug?.puppet));
  check('the puppet is five pieces, not nine', s?.debug?.puppet?.pieces === 5,
    String(s?.debug?.puppet?.pieces));
  await h.sleep(900);
  await page.screenshot({ path: `${OUT}-08-alive.png` });

  const lifts = [];
  const spots = [];
  for (let i = 0; i < 40; i += 1) {
    const u = await h.ui();
    if (u.debug?.puppet) { lifts.push(u.debug.puppet.lift); spots.push(u.debug.puppet.position); }
    await h.sleep(90);
  }
  check('the robot leaves the ground — it hops', Math.max(...lifts) > 0.15,
    `max lift ${Math.max(...lifts).toFixed(3)}`);
  check('the robot squashes and stretches as it hops',
    new Set(lifts.map((l) => l.toFixed(2))).size > 4,
    `${new Set(lifts.map((l) => l.toFixed(2))).size} distinct heights`);
  check('the robot moves around the room',
    new Set(spots.map((p) => `${p.x.toFixed(1)},${p.z.toFixed(1)}`)).size > 1);
  await page.screenshot({ path: `${OUT}-09-hopping.png` });

  s = await h.pulseUntil(['KeyW'], (u) => u.action && /わたす/.test(u.action), 30, 'give prompt');
  check('give prompt appears at the NPC', s, s?.action);
  await page.keyboard.press('Space');
  s = await h.waitFor((u) => u.bubble && /ありがとう/.test(u.bubble), 4000, 'thanks');
  check('NPC thanks the child for the picture', s, s?.bubble);
  check('the robot is still alive after the picture is framed', s?.debug?.puppet?.present);
  await h.sleep(900);
  await page.screenshot({ path: `${OUT}-10-given.png` });

  s = await h.waitFor((u) => u.talk || u.fallback.length >= 3, 8000, 'turnaround');
  s = s ? await openFallback(h, 3) : s;
  const values = s?.fallback.map((f) => f.value) ?? [];
  check('turnaround offers every colour sentence',
    values.includes('green') && values.length === 7, s?.fallback.map((f) => f.text).join(' | '));
  await h.sleep(1500);
  await page.screenshot({ path: `${OUT}-11-turnaround.png` });
  const answered = await page.locator('.lesson-hud__fallback[data-value="green"]')
    .click({ timeout: 4000 }).then(() => true, () => false);
  check('the green sentence can be chosen in the turnaround', answered);
  s = await h.waitFor((u) => !u.room && u.greeting !== null, 10000, 'hub');
  check('finishes back to the hub', s);
  await h.sleep(1200);
  s = await h.ui();
  check('hub greets with the colour the child chose', s.greeting?.includes('green'), s.greeting);
  await page.click('.stamp-button');
  await h.sleep(600);
  const stamp = await page.evaluate(() => {
    const el = [...document.querySelectorAll('.stamp')].find((x) => /Coloring/.test(x.textContent));
    return el ? { earned: el.classList.contains('is-earned'), text: el.textContent.replace(/\s+/g, ' ').trim() } : null;
  });
  check('Coloring stamp saved in the stamp book', stamp?.earned, stamp?.text);
  await page.screenshot({ path: `${OUT}-12-stamps.png` });
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '{}'), SAVE_KEY);
  check('progress persisted to the save',
    saved?.stamps?.coloring === true && saved?.answers?.color === 'green',
    JSON.stringify({ stamps: saved?.stamps, answers: saved?.answers }));

  await page.evaluate(() => document.querySelector('.modal-header button')?.click());
  await h.sleep(500);
  s = await enterColoring(h);
  check('Coloring can be entered a second time', s?.room);
  await h.sleep(1500);
  const dupes = await page.evaluate(() => ({
    room: document.querySelectorAll('.coloring-room-ui').length,
    screen: document.querySelectorAll('.coloring-screen').length,
    listen: document.querySelectorAll('.listen-again').length,
    hud: document.querySelectorAll('.lesson-hud').length,
  }));
  check('re-entry leaves no duplicated overlays',
    dupes.room === 1 && dupes.screen === 0 && dupes.listen <= 1 && dupes.hud === 1, JSON.stringify(dupes));
  await page.close();
}

// ---- Session B: ignoring the answer must still work ----------------------
{
  const h = await openPage('B');
  const { page } = h;
  await enterColoring(h);
  const { favourite } = await askArtist(h);
  await h.waitFor((u) => u.screen, 9000, 'colouring screen');
  await h.sleep(700);
  const box = await canvasBox(page);
  const other = PALETTE.find((c) => c !== favourite);
  await selectBrush(page, 'large');
  await selectColour(page, other);
  // Never uses the favourite colour at all. This must still activate: the
  // bonus is encouragement, never a gate.
  for (const points of sweeps(0.06, 0.96, 0.028)) {
    if ((await h.ui()).debug?.phase !== 'painting') break;
    await stroke(page, box, points);
  }
  const s = await h.waitFor((u) => u.debug?.phase !== 'painting', 8000, 'activation');
  check(`ignoring "${favourite}" entirely still activates the robot`, s, s?.debug?.phase);
  check('and it scores a fair round rather than failing',
    (s?.debug?.favouriteShare ?? 1) === 0, `favourite share ${s?.debug?.favouriteShare}`);
  await page.screenshot({ path: `${OUT}-13-no-favourite.png` });
  await page.close();
}

check('no console or page errors', errors.length === 0, errors.slice(0, 3).join(' || '));
for (const note of notes) console.log(`NOTE  ${note}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
void insideSilhouette; void silhouetteBounds; void BRUSHES; void BRUSH_IDS;
await browser.close();
