// Scripted Coloring playthrough, driven through the mic-free fallback. Run from this repo:
//   npm run build && npx vite preview --port 5199   (in another terminal)
//   node scripts/playthrough-coloring.mjs http://localhost:5199/ .tmp/col [w] [h]
//
// Session A walks the whole loop and every one of the four activation outcomes:
// ask, hear the favourite colour, prove tap-to-fill and the tools, then press
// Done with the ★ wrong (NOT READY), with a label wrong (ALMOST), with nothing
// decorated (INCOMPLETE) and finally correct (FULL) — the robot comes alive,
// hops into the atelier, and the round finishes as it always did.
// Session B is the anti-shortcut check: ignore the answer entirely.
//
// Tap points come from robotDefinition.js itself, imported here, so the harness
// can never drift from the robot's real geometry.
// playwright resolves from recipe-tester/node_modules; it is not a dependency here.
import { chromium } from 'playwright';
import { openFallback } from './lib/pressTalk.mjs';
import {
  FREE_REGIONS,
  LABEL_REGIONS,
  REGIONS,
  regionBounds,
  tappablePoint,
} from '../src/minigames/coloring/robotDefinition.js';
import { COMPLETION_THRESHOLD, PALETTE } from '../src/minigames/coloring/colorState.js';

const URL = process.argv[2] || 'http://localhost:5199/';
const OUT = process.argv[3] || '.tmp/col';
// Viewport is an argument so the same run can be repeated at a real classroom
// resolution; 1024x600 stays the default because it is the tightest one that
// still has to work.
const VIEW = {
  width: Number(process.argv[4]) || 1024,
  height: Number(process.argv[5]) || 600,
};
const SAVE_KEY = 'esl-likes-save-v1';

const STARRED = REGIONS.find((r) => r.type === 'required-favorite').id;
const LABELLED = LABEL_REGIONS.map((r) => r.id);
const FREE = FREE_REGIONS.map((r) => r.id);

/**
 * Where to tap for a region, in picture fractions.
 *
 * `tappablePoint` rather than the bounding-box centre: the middle of the torso
 * belongs to the chest panel drawn over it, so aiming at centres silently
 * coloured the wrong regions and made a correct round look like a failure.
 */
const tapPoint = (regionId) => {
  const point = tappablePoint(regionId);
  if (!point) throw new Error(`no tappable point for ${regionId}`);
  return point;
};

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
      feedback: text('.coloring-feedback'),
      instruction: text('.coloring-screen__instruction'),
      resetConfirm: visible(q('.coloring-reset-confirm')),
      done: q('.coloring-done') ? !q('.coloring-done').disabled : null,
      swatches: document.querySelectorAll('.coloring-swatch').length,
      pressed: [...document.querySelectorAll('.coloring-swatch')]
        .filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.color),
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
  // Standing beside the artist must open nothing until Talk is pressed.
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
  // The palette pulses until a colour is chosen, which Playwright reads as an
  // "unstable" element. A child clicks it fine, so click through the animation.
  await page.click(`.coloring-swatch[data-color="${colour}"]`, { force: true });
  await page.waitForTimeout(120);
}

/** One tap on a region — a discrete click, as a touchpad produces. */
async function tap(page, box, regionId) {
  const point = tapPoint(regionId);
  // The canvas is letterboxed by object-fit: contain, so the picture occupies a
  // centred square inside the element's box.
  const size = Math.min(box.width, box.height);
  const left = box.x + (box.width - size) / 2;
  const top = box.y + (box.height - size) / 2;
  await page.mouse.click(left + point.x * size, top + point.y * size);
  await page.waitForTimeout(45);
}

async function fill(page, box, regionId, colour) {
  await selectColour(page, colour);
  await tap(page, box, regionId);
}

const colorsOf = async (h) => (await h.ui()).debug?.colors ?? {};

/**
 * Finds the colour a labelled region wants by trying each one and watching for
 * its instruction word to disappear — which is exactly the behaviour the spec
 * promises, so discovering it this way tests it.
 */
async function solveLabel(h, box, regionId) {
  for (const colour of PALETTE) {
    await fill(h.page, box, regionId, colour);
    const gone = await labelGone(h.page, regionId);
    if (gone) return colour;
  }
  return null;
}

/** True when no ink remains in a region's label box: the word has faded. */
function labelGone(page, regionId) {
  const region = REGIONS.find((r) => r.id === regionId);
  const b = region.labelBox ?? regionBounds(regionId);
  return page.evaluate(([minX, minY, maxX, maxY]) => {
    const canvas = document.querySelector('.coloring-canvas');
    const ctx = canvas.getContext('2d');
    const x = Math.round(minX * canvas.width);
    const y = Math.round(minY * canvas.height);
    const w = Math.max(1, Math.round((maxX - minX) * canvas.width));
    const hh = Math.max(1, Math.round((maxY - minY) * canvas.height));
    const { data } = ctx.getImageData(x, y, w, hh);
    let dark = 0;
    for (let i = 0; i < data.length; i += 4) {
      // The ink is #23282f; every palette fill and the paper are much lighter.
      if (data[i] < 90 && data[i + 1] < 95 && data[i + 2] < 105) dark += 1;
    }
    return dark < 6;
  }, [b.minX, b.minY, b.maxX, b.maxY]);
}

async function pressDone(h, expected) {
  await h.page.click('.coloring-done');
  return h.waitFor((u) => u.debug?.outcome === expected, 4000, `outcome ${expected}`);
}

/** Decorates free regions until the completion threshold is comfortably passed. */
async function decorate(h, box, wanted = COMPLETION_THRESHOLD + 0.25) {
  const needed = Math.ceil(FREE.length * wanted);
  const palette = PALETTE;
  for (let i = 0; i < needed; i += 1) {
    await fill(h.page, box, FREE[i], palette[i % palette.length]);
  }
  return needed;
}

// ---- Session A: the whole loop, and all four outcomes --------------------
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
  check('no swatch is selected by default', s.pressed.length === 0, JSON.stringify(s.pressed));
  check('できた is pressable from the start (it is an activation attempt, not a gate)', s.done === true);
  check('Undo starts unavailable', s.undoEnabled === false);
  check('the answer is not left on screen', !/I like/.test(s.body));
  check('🔊 listen-again is offered while colouring', s.listen);
  check('the favourite colour is never named on the page',
    !new RegExp(favourite, 'i').test(s.body), s.instruction);
  await page.screenshot({ path: `${OUT}-04-canvas.png` });

  await page.click('.listen-again');
  s = await h.waitFor((u) => u.notice && /I like/.test(u.notice), 3000, 'replayed answer');
  check('🔊 replays the exact answer sentence', s && s.notice.includes(`I like ${favourite}.`), s?.notice);
  await h.sleep(2400);

  const box = await canvasBox(page);

  // --- tap-to-fill and the tools ---
  await selectColour(page, favourite);
  s = await h.ui();
  check('choosing a swatch selects exactly that colour',
    s.pressed.length === 1 && s.pressed[0] === favourite, JSON.stringify(s.pressed));

  await tap(page, box, 'body');
  s = await h.ui();
  check('one tap fills a whole region', s.debug?.colors?.body === favourite,
    JSON.stringify(s.debug?.colors));
  check('Undo becomes available after a fill', s.undoEnabled === true);

  await page.click('.coloring-tool--undo');
  s = await h.ui();
  check('Undo takes back the last region', !s.debug?.colors?.body, JSON.stringify(s.debug?.colors));

  await fill(page, box, 'face', favourite);
  await page.click('.coloring-tool--eraser');
  s = await h.ui();
  check('the eraser can be armed', s.eraserOn === true);
  await tap(page, box, 'face');
  s = await h.ui();
  check('the eraser clears one region', !s.debug?.colors?.face, JSON.stringify(s.debug?.colors));

  await page.click('.coloring-tool--reset');
  s = await h.ui();
  check('やりなおす asks before it erases anything', s.resetConfirm === true);
  await page.click('.coloring-reset-confirm [data-reset="no"]');
  await fill(page, box, 'body', favourite);
  await page.click('.coloring-tool--reset');
  await page.click('.coloring-reset-confirm [data-reset="no"]');
  s = await h.ui();
  check('declining やりなおす keeps every colour', s.debug?.colors?.body === favourite,
    JSON.stringify(s.debug?.colors));

  // Keyboard: arrow through the regions and fill with Enter.
  const beforeKeys = Object.keys(await colorsOf(h)).length;
  await selectColour(page, PALETTE[0]);
  await page.locator('.coloring-canvas').focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await h.sleep(120);
  const afterKeys = Object.keys(await colorsOf(h)).length;
  check('keyboard: arrow then Enter fills a region', afterKeys > beforeKeys,
    `${beforeKeys} -> ${afterKeys}`);

  // --- outcome 1: NOT READY (the ★ is wrong) ---
  const wrongFavourite = PALETTE.find((c) => c !== favourite);
  await fill(page, box, STARRED, wrongFavourite);
  const labelColours = {};
  for (const id of LABELLED) {
    labelColours[id] = await solveLabel(h, box, id);
  }
  check('each labelled region reveals its colour by its word fading once correct',
    LABELLED.every((id) => labelColours[id]), JSON.stringify(labelColours));
  const reported = (await h.ui()).debug?.requiredLabels ?? {};
  check('the labelled colours found by watching the page match the round',
    LABELLED.every((id) => labelColours[id] === reported[id]),
    `${JSON.stringify(labelColours)} vs ${JSON.stringify(reported)}`);
  await decorate(h, box);

  const beforeFail = await colorsOf(h);
  s = await pressDone(h, 'not-ready');
  check('a wrong ★ does not bring the robot alive', s && !s.debug.puppet, s?.debug?.outcome);
  check('a wrong ★ never names the colour it wanted',
    s && !new RegExp(favourite, 'i').test(s.feedback ?? ''), s?.feedback);
  check('NOT READY shows friendly feedback and stays on the page', s?.feedback && s.screen, s?.feedback);
  check('NOT READY erases nothing', JSON.stringify(await colorsOf(h)) === JSON.stringify(beforeFail));
  await page.screenshot({ path: `${OUT}-05-not-ready.png` });
  await h.sleep(2600);

  // --- outcome 2: ALMOST (the ★ is right, one label is wrong) ---
  await fill(page, box, STARRED, favourite);
  const breakMe = LABELLED[0];
  const breakWith = PALETTE.find((c) => c !== labelColours[breakMe]);
  await fill(page, box, breakMe, breakWith);
  s = await pressDone(h, 'almost');
  check('a correct ★ with one wrong label gives ALMOST, not NOT READY', s, s?.debug?.outcome);
  check('ALMOST points at the labelled region that is wrong, never at the ★',
    s?.debug?.hint === breakMe, `hint=${s?.debug?.hint}`);
  check('ALMOST erases nothing', Object.keys(await colorsOf(h)).length > 5);
  await page.screenshot({ path: `${OUT}-06-almost.png` });
  await h.sleep(2600);

  // --- outcome 3: INCOMPLETE (everything required is right, too plain) ---
  await fill(page, box, breakMe, labelColours[breakMe]);
  await page.click('.coloring-tool--reset');
  await page.click('.coloring-reset-confirm [data-reset="yes"]');
  await fill(page, box, STARRED, favourite);
  for (const id of LABELLED) await fill(page, box, id, labelColours[id]);
  s = await h.ui();
  check('a bare robot is under the decoration threshold',
    s.debug.completion < COMPLETION_THRESHOLD, String(s.debug.completion));
  s = await pressDone(h, 'incomplete');
  check('required-but-plain gives INCOMPLETE, a separate outcome from ALMOST', s, s?.debug?.outcome);
  check('INCOMPLETE never implies a colour is wrong',
    s && !/もうすこし/.test(s.feedback ?? ''), s?.feedback);
  await page.screenshot({ path: `${OUT}-07-incomplete.png` });
  await h.sleep(2600);

  // --- outcome 4: FULL ---
  const decorated = await decorate(h, box, 0.75);
  const finalColors = await colorsOf(h);
  check('decorating passes the threshold', (await h.ui()).debug.decoratedEnough,
    `${decorated} of ${FREE.length} free regions`);
  await page.screenshot({ path: `${OUT}-08-finished-drawing.png` });

  await page.click('.coloring-done');
  s = await h.waitFor((u) => u.debug?.outcome === 'full', 4000, 'full activation');
  check('everything right and decorated = FULL activation', s, s?.debug?.outcome);
  check('the robot is built from the child\'s exact colours',
    s && JSON.stringify(s.debug.colors) === JSON.stringify(finalColors));
  check('the puppet has all nine paper pieces', s?.debug?.puppet?.pieces === 9,
    String(s?.debug?.puppet?.pieces));
  check('no generic star panel interrupts the activation', !/すてきな/.test(s?.body ?? ''));
  await page.screenshot({ path: `${OUT}-09-activating.png` });

  s = await h.waitFor((u) => !u.screen && u.room, 9000, 'back in the atelier');
  check('2D -> 3D: the cinematic returns to the atelier by itself', s);
  s = await h.waitFor((u) => u.debug?.puppet?.present, 4000, 'puppet in the room');
  check('the paper robot is in the atelier', s, JSON.stringify(s?.debug?.puppet));
  await h.sleep(900);
  await page.screenshot({ path: `${OUT}-10-alive.png` });

  // It has to actually hop: sample the height over a couple of seconds.
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
    new Set(lifts.map((l) => l.toFixed(2))).size > 4, `${new Set(lifts.map((l) => l.toFixed(2))).size} distinct heights`);
  check('the robot moves around the room',
    new Set(spots.map((p) => `${p.x.toFixed(1)},${p.z.toFixed(1)}`)).size > 1);
  await page.screenshot({ path: `${OUT}-11-hopping.png` });

  s = await h.pulseUntil(['KeyW'], (u) => u.action && /わたす/.test(u.action), 30, 'give prompt');
  check('give prompt appears at the NPC', s, s?.action);
  await page.keyboard.press('Space');
  s = await h.waitFor((u) => u.bubble && /ありがとう/.test(u.bubble), 4000, 'thanks');
  check('NPC thanks the child for the picture', s, s?.bubble);
  check('the robot is still alive after the picture is framed', s?.debug?.puppet?.present);
  await h.sleep(900);
  await page.screenshot({ path: `${OUT}-12-given.png` });

  s = await h.waitFor((u) => u.talk || u.fallback.length >= 3, 8000, 'turnaround');
  s = s ? await openFallback(h, 3) : s;
  const values = s?.fallback.map((f) => f.value) ?? [];
  check('turnaround offers every colour sentence',
    values.includes('green') && values.length === 7, s?.fallback.map((f) => f.text).join(' | '));
  await h.sleep(1500);
  await page.screenshot({ path: `${OUT}-13-turnaround.png` });
  // Reporting a missing button beats aborting the run: a crash here reads as a
  // broken harness, and the checks already gathered are the useful part.
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
  await page.screenshot({ path: `${OUT}-14-stamps.png` });
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
    puppets: document.querySelectorAll('canvas').length,
  }));
  check('re-entry leaves no duplicated overlays',
    dupes.room === 1 && dupes.screen === 0 && dupes.listen <= 1 && dupes.hud === 1, JSON.stringify(dupes));
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
  const box = await canvasBox(page);
  const wrong = PALETTE.find((c) => c !== favourite);
  // Colour the lot in one colour the NPC did not name, decoration and all.
  for (const region of REGIONS) await fill(page, box, region.id, wrong);
  await page.click('.coloring-done');
  const s = await h.waitFor((u) => u.debug?.outcome, 4000, 'outcome');
  check(`anti-shortcut: ignoring "${favourite}" and colouring everything ${wrong} never activates`,
    s && s.debug.outcome !== 'full' && !s.debug.puppet, JSON.stringify(s?.debug?.outcome));
  check('and it keeps the child on the page with their work intact',
    s?.screen && Object.keys(s.debug.colors).length === REGIONS.length);
  await page.screenshot({ path: `${OUT}-15-wrong-colour.png` });
  await page.close();
}

check('no console or page errors', errors.length === 0, errors.slice(0, 3).join(' || '));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
await browser.close();
