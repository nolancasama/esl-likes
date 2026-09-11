// Scripted Restaurant playthrough, driven through the mic-free fallback
// (headless Chromium has no speech recognition). Run from this repo:
//   npm run build && npx vite preview --port 5199   (in another terminal)
//   node scripts/playthrough.mjs http://localhost:5199/ .tmp/play 1 pizza
// playwright resolves from recipe-tester/node_modules; it is not a dependency here.
import { chromium } from 'playwright';

const URL = process.argv[2] || 'http://localhost:5199/';
const OUT = process.argv[3] || 'play';
const LEVEL = Number(process.argv[4] || 1);
const CHOICE = process.argv[5] || 'pizza';
const SAVE_KEY = 'esl-likes-save-v1';

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const context = await browser.newContext({ viewport: { width: 1024, height: 600 } });
await context.addInitScript(([key, level]) => {
  if (!sessionStorage.getItem('seeded')) {
    localStorage.setItem(key, JSON.stringify({ version: 1, settings: { micFree: true, difficulty: level } }));
    sessionStorage.setItem('seeded', '1');
  }
}, [SAVE_KEY, LEVEL]);
const page = await context.newPage();

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const shot = (name) => page.screenshot({ path: `${OUT}-${name}.png` });
const sleep = (ms) => page.waitForTimeout(ms);

// Snapshot of everything the child can see or act on.
const ui = () => page.evaluate(() => {
  const visible = (el) => {
    if (!el || el.hidden || el.closest('[hidden]') || el.closest('.is-hidden')) return false;
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden';
  };
  const q = (s) => document.querySelector(s);
  const action = q('.restaurant-ui__action');
  const notice = q('.restaurant-ui__notice');
  const bubble = q('.npc-dialogue');
  return {
    prompt: visible(q('.interaction-prompt')),
    action: visible(action) ? action.textContent.trim() : null,
    notice: visible(notice) ? notice.textContent.trim() : null,
    bubble: visible(bubble) ? (q('.npc-dialogue__line')?.textContent.trim() ?? '') : null,
    fallback: [...document.querySelectorAll('.lesson-hud__fallback')]
      .filter(visible)
      .map((b) => ({ text: b.getAttribute('aria-label') || [...b.children].map((c) => c.textContent).join(' '), value: b.dataset.value ?? null })),
    inRestaurant: Boolean(q('.restaurant-ui')),
    greeting: q('.greeting')?.textContent.trim() ?? null,
    text: document.body.innerText,
  };
});

async function waitFor(pred, ms, label) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    last = await ui();
    if (pred(last)) return last;
    await sleep(120);
  }
  console.log(`  (timed out waiting for ${label})`);
  return null;
}

// Movement is dt-based but each frame is clamped to 50 ms, so on a slow
// software renderer the avatar moves less than speed * time. Measure the frame
// rate once and stretch every hold to cover the same distance.
const fps = await (async () => {
  await page.goto(URL, { waitUntil: 'networkidle' });
  await sleep(2500);
  return page.evaluate(() => new Promise((resolve) => {
    let frames = 0;
    const start = performance.now();
    const tick = () => {
      frames += 1;
      if (performance.now() - start >= 1000) resolve(frames);
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }));
})();
const scale = Math.min(1, 0.05 * fps);
console.log(`fps ≈ ${fps}, movement scale ${scale.toFixed(2)}`);

async function hold(keys, ms) {
  for (const k of keys) await page.keyboard.down(k);
  await sleep(ms / scale);
  for (const k of keys) await page.keyboard.up(k);
  await sleep(80);
}

async function pulseUntil(keys, pred, maxPulses, label) {
  for (let i = 0; i < maxPulses; i += 1) {
    const s = await ui();
    if (pred(s)) return s;
    await hold(keys, 140);
  }
  const s = await ui();
  if (!pred(s)) console.log(`  (never reached ${label})`);
  return pred(s) ? s : null;
}

// ---- Hub -> Restaurant ---------------------------------------------------
await shot('01-hub');
await hold(['KeyW', 'KeyA'], 2500);
let s = await ui();
check('hub: interaction prompt appears at the Restaurant door', s.prompt);
await page.keyboard.press('Space');
s = await waitFor((u) => u.inRestaurant, 6000, 'restaurant');
check('hub -> restaurant transition', s);
await sleep(1500);
await shot('02-restaurant');

// ---- Take the order -----------------------------------------------------
await hold(['KeyW', 'KeyA'], 550);
s = await pulseUntil(['KeyW'], (u) => u.fallback.length > 0, 14, 'customer');
check('near customer: question offered via fallback', s, s?.fallback[0]?.text);
check('question text is the target sentence', s && /what food do you like/i.test(s.fallback[0].text));
await shot('03-ask');
await page.click('.lesson-hud__fallback');
s = await waitFor((u) => u.bubble && /I like/i.test(u.bubble), 6000, 'answer bubble');
const food = s?.bubble.match(/I like (\w+)/i)?.[1]?.toLowerCase();
check('customer answers "I like ___."', s, s?.bubble);
await shot('04-answer');

// ---- The order must not stay on screen ----------------------------------
await sleep(3200);
s = await ui();
const jaNames = { curry: 'カレー', pizza: 'ピザ', hamburger: 'ハンバーガー', noodles: 'ヌードル', sushi: 'すし' };
const leaks = [food, jaNames[food]].filter((w) => w && s.text.toLowerCase().includes(w.toLowerCase()));
check('order is NOT displayed once the answer bubble is gone', leaks.length === 0 && !s.bubble,
  leaks.length ? `still visible: ${leaks.join(', ')}` : 'bubble cleared, no food text on screen');
await shot('05-waiting');

// ---- Collect the dish ---------------------------------------------------
s = await waitFor((u) => u.notice && /できた/.test(u.notice), 20000, 'bell');
check('kitchen bell announces the dish', s, s?.notice);
await hold(['KeyW'], 1100);
s = await pulseUntil(['KeyD'], (u) => u.action && /もつ/.test(u.action), 40, 'dish on counter');
check('dish can be collected at the counter', s, s?.action);
await page.keyboard.press('Space');
await sleep(400);
await shot('06-carrying');

// ---- Deliver ------------------------------------------------------------
await hold(['KeyS'], 500);
s = await pulseUntil(['KeyA'], (u) => u.action && /とどける/.test(u.action), 45, 'customer to deliver');
check('deliver action offered at the customer', s, s?.action);
await page.keyboard.press('Space');
s = await waitFor((u) => u.bubble && /ありがとう/.test(u.bubble), 4000, 'thanks');
check('customer accepts the correct dish', s, s?.bubble);
await shot('07-delivered');

// ---- Turnaround ---------------------------------------------------------
s = await waitFor((u) => u.fallback.length > 0 && /I like/i.test(u.fallback.map((f) => f.text).join(' ')), 8000, 'turnaround');
check('turnaround asks the child, offering "I like ___."', s, s?.fallback.map((f) => f.text).join(' | '));
await shot('08-turnaround');
const choiceButton = s?.fallback.find((f) => f.value === CHOICE);
check(`turnaround lets the child choose their own food (${CHOICE})`, choiceButton,
  choiceButton ? '' : `only offered: ${s?.fallback.map((f) => f.text).join(' | ')}`);
await page.click(choiceButton ? `.lesson-hud__fallback[data-value="${CHOICE}"]` : '.lesson-hud__fallback');

s = await waitFor((u) => !u.inRestaurant && u.greeting !== null, 10000, 'hub return');
check('minigame finishes back to the hub', s);
await sleep(1200);
s = await ui();
check('hub greets with the child\'s own answer', s.greeting && s.greeting.includes(CHOICE), s.greeting);
await shot('09-hub-return');

await page.click('.stamp-button');
await sleep(600);
const stamp = await page.evaluate(() => {
  const el = [...document.querySelectorAll('.stamp')].find((x) => /Restaurant/.test(x.textContent));
  return el ? { earned: el.classList.contains('is-earned'), text: el.textContent.replace(/\s+/g, ' ').trim() } : null;
});
check('Restaurant stamp earned in the stamp book', stamp?.earned, stamp?.text);
await shot('10-stampbook');

// ---- Re-enter: exit() must leave nothing behind ------------------------
await page.evaluate(() => document.querySelector('.modal-header button')?.click());
await sleep(500);
await hold(['KeyW', 'KeyA'], 2500);
await page.keyboard.press('Space');
s = await waitFor((u) => u.inRestaurant, 6000, 'restaurant again');
check('restaurant can be entered a second time', s);
await sleep(1500);
const dupes = await page.evaluate(() => ({
  restaurantUi: document.querySelectorAll('.restaurant-ui').length,
  hud: document.querySelectorAll('.lesson-hud').length,
  dialogue: document.querySelectorAll('.npc-dialogue').length,
  styles: document.querySelectorAll('style').length,
}));
check('re-entry leaves no duplicated overlays',
  dupes.restaurantUi === 1 && dupes.hud === 1 && dupes.dialogue === 1, JSON.stringify(dupes));
await hold(['KeyW', 'KeyA'], 550);
s = await pulseUntil(['KeyW'], (u) => u.fallback.length > 0, 14, 'customer again');
check('second visit: a customer takes an order again', s);
await shot('11-reentry');

check('no console or page errors', errors.length === 0, errors.slice(0, 3).join(' || '));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
await browser.close();
