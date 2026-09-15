// Scripted Coloring playthrough, driven through the mic-free fallback. Run from this repo:
//   npm run build && npx vite preview --port 5199   (in another terminal)
//   node scripts/playthrough-coloring.mjs http://localhost:5199/ .tmp/col
//
// Session A — the listening route: ask, hear the colour, paint every region in
// that colour (so the starred region is right wherever the star is), use the 🔊
// replay once, and expect full marks; then 3D -> 2D -> 3D, give the picture,
// turnaround, stamp, re-entry.
// Session B — the anti-shortcut check: ignore the answer and paint everything in
// a colour the NPC did not name. That must NOT reach three stars.
// playwright resolves from recipe-tester/node_modules; it is not a dependency here.
import { chromium } from 'playwright';
import { openFallback } from './lib/pressTalk.mjs';

const URL = process.argv[2] || 'http://localhost:5199/';
const OUT = process.argv[3] || '.tmp/col';
const SAVE_KEY = 'esl-likes-save-v1';
const PALETTE = ['red', 'blue', 'yellow'];

// Region rectangles from src/minigames/coloring/picture.js (fractions of the picture).
const REGIONS = {
  eyes: [{ x: 0.29, y: 0.17, w: 0.42, h: 0.17 }],
  body: [{ x: 0.29, y: 0.37, w: 0.42, h: 0.43 }],
  arms: [{ x: 0.08, y: 0.43, w: 0.19, h: 0.27 }, { x: 0.73, y: 0.43, w: 0.19, h: 0.27 }],
};

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const context = await browser.newContext({ viewport: { width: 1024, height: 600 } });
await context.addInitScript((key) => {
  if (!sessionStorage.getItem('seeded')) {
    localStorage.setItem(key, JSON.stringify({ version: 1, settings: { micFree: true, difficulty: 1 } }));
    sessionStorage.setItem('seeded', '1');
  }
}, SAVE_KEY);

const results = [];
const errors = [];
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
      result: visible(q('.coloring-result')),
      stars: text('.coloring-result__stars'),
      done: q('.coloring-done') ? !q('.coloring-done').disabled : null,
      pressed: [...document.querySelectorAll('.coloring-swatch')].filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.color),
      listen: visible(q('.listen-again')),
      fallback: [...document.querySelectorAll('.lesson-hud__fallback')].filter(visible)
        .map((b) => ({ text: b.getAttribute('aria-label') || b.textContent, value: b.dataset.value ?? null })),
      greeting: q('.greeting')?.textContent.trim() ?? null,
      prompt: visible(q('.interaction-prompt')),
      talk: visible(q('.lesson-hud__talk')),
      body: document.body.innerText,
    };
  });
  const waitFor = async (pred, ms, label) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const s = await ui();
      if (pred(s)) return s;
      await sleep(120);
    }
    console.log(`  (timed out waiting for ${label})`);
    return null;
  };
  const hold = async (keys, ms) => {
    for (const k of keys) await page.keyboard.down(k);
    await sleep(ms);
    for (const k of keys) await page.keyboard.up(k);
    await sleep(80);
  };
  const pulseUntil = async (keys, pred, max, label) => {
    for (let i = 0; i < max; i += 1) {
      const s = await ui();
      if (pred(s)) return s;
      await hold(keys, 140);
    }
    const s = await ui();
    if (!pred(s)) console.log(`  (never reached ${label})`);
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
  if (!reached) return { s: null, favourite: null };
  // Standing beside the artist must open nothing until Talk is pressed.
  await h.sleep(2000);
  const standing = await h.ui();
  check('standing at the artist opens no read-along until Talk is pressed',
    standing.talk && standing.fallback.length === 0,
    JSON.stringify({ talk: standing.talk, fallback: standing.fallback.length }));
  const s = await openFallback(h);
  if (!s) return { s: null, favourite: null };
  const asked = s;
  await h.page.click('.lesson-hud__fallback');
  const a = await h.waitFor((u) => u.bubble && /^I like (red|blue|yellow)\.$/.test(u.bubble), 7000, 'answer');
  return { asked, answer: a, favourite: a?.bubble.match(/^I like (\w+)\./)?.[1] ?? null };
}

async function canvasBox(page) {
  return page.locator('.coloring-canvas').boundingBox();
}

async function selectColour(page, colour) {
  // The palette pulses until a colour is chosen, which Playwright reads as an
  // "unstable" element. A child clicks it fine, so click through the animation.
  await page.click(`.coloring-swatch[data-color="${colour}"]`, { force: true });
  await page.waitForTimeout(150);
}

async function stroke(page, box, from, to, steps = 14) {
  await page.mouse.move(box.x + from[0] * box.width, box.y + from[1] * box.height);
  await page.mouse.down();
  await page.mouse.move(box.x + to[0] * box.width, box.y + to[1] * box.height, { steps });
  await page.mouse.up();
}

async function paintEverything(page) {
  const box = await canvasBox(page);
  for (const rects of Object.values(REGIONS)) {
    for (const r of rects) {
      const rows = Math.max(3, Math.ceil(r.h / 0.05));
      for (let i = 0; i <= rows; i += 1) {
        const y = r.y + 0.02 + (r.h - 0.04) * (i / rows);
        await stroke(page, box, [r.x + 0.02, y], [r.x + r.w - 0.02, y]);
      }
    }
  }
}

// Colour of one canvas pixel at picture fractions (x, y).
async function pixelAt(page, x, y) {
  return page.evaluate(([fx, fy]) => {
    const canvas = document.querySelector('.coloring-canvas');
    const ctx = canvas.getContext('2d');
    const [r, g, b, a] = ctx.getImageData(Math.round(fx * canvas.width), Math.round(fy * canvas.height), 1, 1).data;
    return { r, g, b, a };
  }, [x, y]);
}

const starCount = (text) => (text ? (text.match(/★/g) || []).length || Number(text.match(/\d/)?.[0] || 0) : 0);

// ---- Session A: the listening route -------------------------------------
{
  const h = await openPage('A');
  const { page } = h;
  await page.screenshot({ path: `${OUT}-01-hub.png` });
  let s = await enterColoring(h);
  check('hub -> Coloring room', s?.room, s?.restaurant ? 'entered the Restaurant instead' : '');
  await h.sleep(1500);
  await page.screenshot({ path: `${OUT}-02-room.png` });

  const { asked, answer, favourite } = await askArtist(h);
  check('question offered: "What color do you like?"', asked && /what color do you like/i.test(asked.fallback[0].text), asked?.fallback[0]?.text);
  check('NPC answers with an exact vocabulary sentence', favourite, answer?.bubble);
  await page.screenshot({ path: `${OUT}-03-answer.png` });

  s = await h.waitFor((u) => u.screen, 9000, 'colouring screen');
  check('3D -> 2D: colouring screen opens', s);
  await h.sleep(700);
  s = await h.ui();
  check('no swatch is selected by default', s.pressed.length === 0, JSON.stringify(s.pressed));
  check('できた starts unavailable', s.done === false);
  check('the answer is not left on screen', !/I like/.test(s.body));
  check('🔊 listen-again is offered while painting', s.listen);
  await page.screenshot({ path: `${OUT}-04-canvas.png` });

  await page.click('.listen-again');
  s = await h.waitFor((u) => u.notice && /I like/.test(u.notice), 3000, 'replayed answer');
  check('🔊 replays the exact answer sentence', s && s.notice.includes(`I like ${favourite}.`), s?.notice);
  await h.sleep(2400);

  await selectColour(page, favourite);
  s = await h.ui();
  check('choosing a swatch selects exactly that colour', s.pressed.length === 1 && s.pressed[0] === favourite, JSON.stringify(s.pressed));

  // Trackpad check: one big jump with no intermediate samples still paints the middle.
  const box = await canvasBox(page);
  const before = await pixelAt(page, 0.5, 0.74);
  await stroke(page, box, [0.33, 0.74], [0.67, 0.74], 1);
  const after = await pixelAt(page, 0.5, 0.74);
  check('a fast single-jump stroke leaves no gap (interpolated)',
    JSON.stringify(before) !== JSON.stringify(after), `${JSON.stringify(before)} -> ${JSON.stringify(after)}`);

  await paintEverything(page);
  s = await h.ui();
  check('できた becomes available after painting', s.done === true);
  await page.screenshot({ path: `${OUT}-05-painted.png` });

  await page.click('.coloring-done');
  s = await h.waitFor((u) => u.result, 4000, 'result');
  check('listening + replay once + favourite colour = 3 stars', starCount(s?.stars) === 3, s?.stars);
  await page.screenshot({ path: `${OUT}-06-result.png` });

  await page.click('.coloring-return');
  s = await h.waitFor((u) => !u.screen && u.room, 8000, 'back in the room');
  check('2D -> 3D: back in the Art Room', s);
  s = await h.pulseUntil(['KeyW'], (u) => u.action && /わたす/.test(u.action), 30, 'give prompt');
  check('give prompt appears at the NPC', s, s?.action);
  await page.keyboard.press('Space');
  s = await h.waitFor((u) => u.bubble && /ありがとう/.test(u.bubble), 4000, 'thanks');
  check('NPC thanks the child for the picture', s, s?.bubble);
  await h.sleep(900);
  await page.screenshot({ path: `${OUT}-07-given.png` });

  s = await h.waitFor((u) => u.talk || u.fallback.length >= 3, 8000, 'turnaround');
  s = s ? await openFallback(h, 3) : s;
  const values = s?.fallback.map((f) => f.value) ?? [];
  check('turnaround offers every colour sentence', values.includes('green') && values.length === 7, s?.fallback.map((f) => f.text).join(' | '));
  await h.sleep(1500);
  await page.screenshot({ path: `${OUT}-08-turnaround.png` });
  await page.click('.lesson-hud__fallback[data-value="green"]');
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
  await page.screenshot({ path: `${OUT}-09-stamps.png` });
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '{}'), SAVE_KEY);
  check('progress persisted to the save', saved?.stamps?.coloring === true && saved?.answers?.color === 'green',
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
  check('re-entry leaves no duplicated overlays', dupes.room === 1 && dupes.screen === 0 && dupes.listen <= 1 && dupes.hud === 1, JSON.stringify(dupes));
  await page.close();
}

// ---- Session B: ignore the answer ----------------------------------------
{
  const h = await openPage('B');
  const { page } = h;
  await enterColoring(h);
  const { favourite } = await askArtist(h);
  await h.waitFor((u) => u.screen, 9000, 'colouring screen');
  await h.sleep(700);
  const wrong = PALETTE.find((c) => c !== favourite);
  await selectColour(page, wrong);
  await paintEverything(page);
  await page.click('.coloring-done');
  const s = await h.waitFor((u) => u.result, 4000, 'result');
  check(`anti-shortcut: ignoring "${favourite}" and painting ${wrong} cannot reach 3 stars`, s && starCount(s.stars) < 3, s?.stars);
  await page.screenshot({ path: `${OUT}-10-wrong-colour.png` });
  await page.close();
}

check('no console or page errors', errors.length === 0, errors.slice(0, 3).join(' || '));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
await browser.close();
