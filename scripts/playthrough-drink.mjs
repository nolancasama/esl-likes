// Scripted Drink Stand playthrough, driven by clicks (trackpad-only route) through
// the mic-free fallback. Run from this repo:
//   npm run build && npx vite preview --port 5199   (in another terminal)
//   node scripts/playthrough-drink.mjs http://localhost:5199/ .tmp/drink
//
// Session A — the listening route: ask every customer, hear the drink, pour it,
// serve it; use 🔊 once. Expect 3 stars, the RUSH banner, the turnaround, stamp.
// Session B — the anti-shortcut check: ignore the answers and try stations in a
// fixed order until each customer accepts. That must NOT reach three stars.
// playwright resolves from recipe-tester/node_modules; it is not a dependency here.
import { chromium } from 'playwright';

const URL = process.argv[2] || 'http://localhost:5199/';
const OUT = process.argv[3] || '.tmp/drink';
const SAVE_KEY = 'esl-likes-save-v1';
const SEL = {
  ui: '.drink-stand-ui',
  action: '.drink-stand__action',
  instruction: '.drink-stand__instruction',
  rush: '.drink-stand__rush',
  combo: '.drink-stand__combo',
};
const DRINKS = { water: 'water', milk: 'milk', 'orange juice': 'orange juice', 'apple juice': 'apple juice', tea: 'tea', soda: 'soda' };

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
// Each session gets its own context, so a best-stars result never leaks across.
async function newContext() {
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  await context.addInitScript((key) => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem(key, JSON.stringify({ version: 1, settings: { micFree: true, difficulty: 1 } }));
      sessionStorage.setItem('seeded', '1');
    }
  }, SAVE_KEY);
  return context;
}

const results = [];
const errors = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

async function openPage(label) {
  const page = await (await newContext()).newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${label}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`${label}: PAGEERROR ${e.message}`));
  const sleep = (ms) => page.waitForTimeout(ms);
  const ui = () => page.evaluate((SEL) => {
    const visible = (el) => Boolean(el) && !el.hidden && !el.closest('[hidden]') && !el.closest('.is-hidden')
      && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';
    const q = (s) => document.querySelector(s);
    const text = (s) => (visible(q(s)) ? q(s).textContent.replace(/\s+/g, ' ').trim() : null);
    return {
      stand: Boolean(q(SEL.ui)),
      action: text(SEL.action),
      rush: text(SEL.rush),
      combo: text(SEL.combo),
      instruction: text(SEL.instruction),
      bubble: text('.npc-dialogue__line'),
      listen: visible(q('.listen-again')),
      fallback: [...document.querySelectorAll('.lesson-hud__fallback')].filter(visible)
        .map((b) => ({ text: b.getAttribute('aria-label') || b.textContent, value: b.dataset.value ?? null })),
      greeting: q('.greeting')?.textContent.trim() ?? null,
      prompt: visible(q('.interaction-prompt')),
      body: document.body.innerText,
      debug: window.__eslDebug?.drinkStand ? JSON.parse(JSON.stringify(
        typeof window.__eslDebug.drinkStand === 'function' ? window.__eslDebug.drinkStand() : window.__eslDebug.drinkStand,
      )) : null,
    };
  }, SEL);
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
  await page.goto(URL, { waitUntil: 'networkidle' });
  await sleep(3200);
  return { page, sleep, ui, waitFor, hold };
}

// Hub door for Drink Stand sits in the middle of the arc, straight ahead.
async function enterStand(h) {
  // The RUSH banner shows for only ~2 s; record whether it was ever visible.
  await h.page.evaluate((sel) => {
    window.__rushSeen = false;
    setInterval(() => {
      const el = document.querySelector(sel);
      if (el && !el.hidden && getComputedStyle(el).display !== 'none') window.__rushSeen = true;
    }, 100);
  }, SEL.rush);
  for (let i = 0; i < 40 && !(await h.ui()).prompt; i += 1) await h.hold(['KeyW'], 140);
  await h.page.keyboard.press('Space');
  return h.waitFor((u) => u.stand, 7000, 'drink stand');
}

const clickAt = (page, pt) => page.mouse.click(pt.x, pt.y);

// The next customer at a window that has not been asked yet.
const waitingCustomer = (s) => s?.debug?.customers.find((c) => c.window != null && !c.asked && !c.served) ?? null;
const askedCustomer = (s) => s?.debug?.customers.find((c) => c.window != null && c.asked && !c.served) ?? null;

async function askNext(h) {
  const s = await h.waitFor((u) => waitingCustomer(u), 25000, 'customer at a window');
  if (!s) return null;
  // A customer holds a window while still walking to it; clicks only count once
  // they stand there. Re-click once a second, as a child would.
  // Customers keep their array index for the whole session; windows are reused.
  const index = s.debug.customers.indexOf(waitingCustomer(s));
  let asked = null;
  for (let tries = 0; tries < 12 && !asked; tries += 1) {
    const now = await h.ui();
    await clickAt(h.page, now.debug.customers[index].screen);
    asked = await h.waitFor((u) => u.fallback.length > 0, 1000, 'ask prompt');
  }
  if (!asked) return null;
  await h.page.click('.lesson-hud__fallback');
  const a = await h.waitFor((u) => u.bubble && /^I like .+\.$/.test(u.bubble), 7000, 'answer');
  const said = a?.bubble.match(/^I like (.+)\.$/)?.[1] ?? null;
  return { asked, bubble: a?.bubble, drink: said ? DRINKS[said] ?? null : null, index };
}

async function pour(h, drink) {
  const s = await h.ui();
  const station = s.debug.stations.find((st) => st.id === drink);
  await clickAt(h.page, station.screen);
  return h.waitFor((u) => u.debug?.heldDrink === drink, 8000, `pour ${drink}`);
}

async function serve(h, index) {
  const s = await h.ui();
  const c = s.debug.customers[index];
  if (!c || c.served) return null;
  await clickAt(h.page, c.screen);
  return h.waitFor((u) => u.debug?.heldDrink == null, 8000, 'serve');
}

const starCount = (text) => (text ? (text.match(/★/g) || []).length || Number(text.match(/\d/)?.[0] || 0) : 0);

// ---- Session A: the listening route -------------------------------------
{
  const h = await openPage('A');
  const { page } = h;
  let s = await enterStand(h);
  check('hub -> Drink Stand', s?.stand);
  await h.sleep(1500);
  s = await h.ui();
  check('debug snapshot exposes six stations and no wanted drinks',
    s.debug?.stations.length === 6 && !JSON.stringify(s.debug).match(/want|order|favou?rite/i), JSON.stringify(s.debug?.stations.map((x) => x.id)));
  check('the avatar starts empty-handed', s.debug?.heldDrink == null);
  await page.screenshot({ path: `${OUT}-01-stand.png` });

  let rushSeen = false;
  let comboSeen = false;
  let served = 0;
  for (let i = 0; i < 6; i += 1) {
    const q = await askNext(h);
    if (!q) break;
    if (i === 0) {
      check('question offered: "What drink do you like?"', /what drink do you like/i.test(q.asked.fallback[0].text), q.asked.fallback[0].text);
      check('customer answers with an exact vocabulary sentence', q.drink, q.bubble);
      await page.screenshot({ path: `${OUT}-02-answer.png` });
      await h.waitFor((u) => !u.bubble, 8000, 'bubble to clear');
      s = await h.ui();
      check('the order is not left on screen', !/I like/.test(s.body));
      check('🔊 offered at the asked customer', s.listen);
    }
    if (i === 1) {
      await h.waitFor((u) => !u.bubble, 8000, 'bubble to clear');
      await page.click('.listen-again');
      s = await h.waitFor((u) => u.bubble && /I like/.test(u.bubble), 3000, 'replayed answer');
      check('🔊 replays that customer\'s exact sentence', s?.bubble === q.bubble, s?.bubble);
    }
    const poured = await pour(h, q.drink);
    if (i === 0) {
      check('clicking a station walks there and pours that drink', poured, poured?.debug?.heldDrink);
      await page.screenshot({ path: `${OUT}-03-poured.png` });
    }
    const after = await serve(h, q.index);
    if (after) served += 1;
    s = await h.ui();
    rushSeen ||= Boolean(s.rush);
    comboSeen ||= Boolean(s.combo);
    if (s.rush) await page.screenshot({ path: `${OUT}-04-rush.png` });
  }
  check('all six customers served by clicking only', served === 6, `${served}/6`);
  rushSeen ||= await page.evaluate(() => window.__rushSeen === true);
  check('RUSH banner appeared', rushSeen);
  check('combo appeared for consecutive first-try serves', comboSeen);

  s = await h.waitFor((u) => u.fallback.length >= 3, 15000, 'turnaround');
  const values = s?.fallback.map((f) => f.value) ?? [];
  check('turnaround offers all six drink sentences', values.length === 6 && values.includes('tea'), s?.fallback.map((f) => f.text).join(' | '));
  await h.sleep(1500);
  await page.screenshot({ path: `${OUT}-05-turnaround.png` });
  await page.click('.lesson-hud__fallback[data-value="tea"]');
  await h.sleep(1200);
  await page.screenshot({ path: `${OUT}-06-reaction.png` });
  s = await h.waitFor((u) => !u.stand && u.greeting !== null, 15000, 'hub');
  check('finishes back to the hub', s);
  await h.sleep(1200);
  s = await h.ui();
  check('hub greets with the drink the child chose', s.greeting?.includes('tea'), s.greeting);
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '{}'), SAVE_KEY);
  check('stamp and answer persisted', saved?.stamps?.['drink-stand'] === true && saved?.answers?.drink === 'tea',
    JSON.stringify({ stamps: saved?.stamps, answers: saved?.answers }));
  check('listening + one replay = 3 stars', saved?.bestStars?.['drink-stand'] === 3, JSON.stringify(saved?.bestStars));

  await h.sleep(1200);
  s = await enterStand(h);
  check('Drink Stand can be entered a second time', s?.stand);
  await h.sleep(1500);
  const dupes = await page.evaluate((SEL) => ({
    stand: document.querySelectorAll(SEL.ui).length,
    listen: document.querySelectorAll('.listen-again').length,
    hud: document.querySelectorAll('.lesson-hud').length,
  }), SEL);
  check('re-entry leaves no duplicated overlays', dupes.stand === 1 && dupes.listen <= 1 && dupes.hud === 1, JSON.stringify(dupes));
  await page.close();
}

// ---- Session B: ignore the answers, try stations in order -----------------
{
  const h = await openPage('B');
  const { page } = h;
  await enterStand(h);
  await h.sleep(1500);
  let wrongDeclined = null;
  for (let i = 0; i < 6; i += 1) {
    const q = await askNext(h);
    if (!q) {
      const stall = await h.ui();
      console.log(`  B stalled before customer ${i + 1}: ${JSON.stringify({ debug: stall.debug, bubble: stall.bubble, instruction: stall.instruction, action: stall.action })}`);
      await page.screenshot({ path: `${OUT}-B-stall.png` });
      break;
    }
    const order = (await h.ui()).debug.stations.map((st) => st.id);
    for (const drink of order) {
      await pour(h, drink);
      await serve(h, q.index);
      const s = await h.ui();
      if (s.debug.customers[q.index].served) break;
      if (wrongDeclined === null) {
        wrongDeclined = { bubble: s.bubble, english: /I like/.test(s.body) };
      }
    }
  }
  check('a wrong drink is declined without repeating the English', wrongDeclined && !wrongDeclined.english, JSON.stringify(wrongDeclined));
  const s = await h.waitFor((u) => u.fallback.length >= 3, 15000, 'turnaround');
  if (s) await page.click('.lesson-hud__fallback');
  await h.waitFor((u) => !u.stand, 15000, 'hub');
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '{}'), SAVE_KEY);
  const stars = saved?.bestStars?.['drink-stand'] ?? null;
  check('guessing still finishes and earns the stamp (no dead end)', saved?.stamps?.['drink-stand'] === true);
  check('anti-shortcut: guessing stations in order cannot reach 3 stars', stars !== null && stars < 3, JSON.stringify(saved?.bestStars));
  await page.close();
}

check('no console or page errors', errors.length === 0, errors.slice(0, 3).join(' || '));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
await browser.close();
