// Screenshot pass for the two changes that can only be judged by looking:
// the Zoo's entrance visitors facing the arriving child, and the Restaurant's
// contextual "ask this question" hint appearing beside an orderable customer.
//
// Deliberately light on assertions. The Zoo's facing maths already has a unit
// test; what no test can tell us is whether a child sees faces or a row of
// backs, so this exists to produce the picture.
import { chromium } from 'playwright';

const TARGET_URL = process.argv[2] || 'http://localhost:5199/';
const OUT = process.argv[3] || '.tmp/polish';
const VIEW = { width: Number(process.argv[4]) || 1024, height: Number(process.argv[5]) || 600 };

const SAVE_KEY = 'esl-likes-save-v1';
const results = [];
const notes = [];
const errors = [];
let browser = null;

function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

async function hold(page, keys, ms) {
  for (const key of keys) await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  for (const key of keys) await page.keyboard.up(key);
}

async function waitFor(page, read, predicate, timeoutMs, what) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await read();
    if (predicate(last)) return last;
    await page.waitForTimeout(60);
  }
  check(`waiting for ${what}`, false, JSON.stringify(last)?.slice(0, 160));
  return null;
}

const zooDebug = (page) => page.evaluate(() => window.__eslDebug?.zoo ?? null);
const restaurantDebug = (page) => page.evaluate(() => window.__eslDebug?.restaurant ?? null);
const pillOf = (page) => page.evaluate(() => {
  const pill = document.querySelector('.restaurant-ui__phase');
  if (!pill) return null;
  return { hidden: pill.hidden, text: pill.textContent?.trim() ?? '' };
});

async function backToHub(page) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(2200);
}

async function main() {
  browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const context = await browser.newContext({ viewport: VIEW });
  await context.addInitScript((key) => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem(key, JSON.stringify({ version: 1, settings: { micFree: true, difficulty: 1 } }));
      sessionStorage.setItem('seeded', '1');
    }
  }, SAVE_KEY);
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (error) => errors.push(`PAGEERROR ${error.message}`));

  await page.goto(TARGET_URL, { waitUntil: 'load' });
  await page.waitForTimeout(2800);

  // ---- The Zoo entrance ---------------------------------------------------
  await hold(page, ['KeyD'], 1500);
  for (let step = 0; step < 14; step += 1) {
    await hold(page, ['KeyW'], 260);
    if (await zooDebug(page)) break;
    const prompt = await page.locator('.zoo-ui__action, .hub-prompt').first()
      .isVisible().catch(() => false);
    if (prompt) await page.keyboard.press('Space');
  }
  await page.keyboard.press('Space');
  const zoo = await waitFor(page, () => zooDebug(page), (d) => Boolean(d), 12000, 'the Zoo');
  check('the Zoo opens from the hub', Boolean(zoo));
  if (zoo) {
    await page.waitForTimeout(2600);
    await page.screenshot({ path: `${OUT}-1-zoo-entrance.png` });
    // Close enough that a face is unmistakably a face and a back is a blank.
    await hold(page, ['KeyW'], 1100);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}-1b-zoo-visitors-close.png` });
    const near = await zooDebug(page);
    notes.push(`visitors: ${JSON.stringify(near?.visitors?.slice(0, 3))}`);
    notes.push(`player: ${JSON.stringify(near?.player)}`);
  }
  await backToHub(page);

  // ---- The Restaurant hint ------------------------------------------------
  await hold(page, ['KeyW', 'KeyA'], 2600);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await page.keyboard.press('Space');
    await page.waitForTimeout(700);
    if (await restaurantDebug(page)) break;
    await hold(page, ['KeyW', 'KeyA'], 220);
  }
  const restaurant = await waitFor(page, () => restaurantDebug(page), (d) => Boolean(d), 12000,
    'the Restaurant');
  check('the Restaurant opens from the hub', Boolean(restaurant));

  if (restaurant) {
    // Click-to-walk to a seated customer, the way the Restaurant harness does.
    // Walking north with KeyW just parks the player between the tables, where
    // asking is correctly NOT the contextual action.
    const seats = [
      { x: 512, y: 290 }, { x: 345, y: 210 }, { x: 680, y: 205 },
      { x: 300, y: 350 }, { x: 690, y: 345 },
    ];
    let withHint = null;
    for (const seat of seats) {
      await page.click('#game-canvas', { position: seat });
      for (let settle = 0; settle < 24; settle += 1) {
        await page.waitForTimeout(220);
        const pill = await pillOf(page);
        if (pill && !pill.hidden && /What food do you like/.test(pill.text)) {
          withHint = pill;
          break;
        }
      }
      if (withHint) break;
      const state = await restaurantDebug(page);
      notes.push(`seat ${seat.x},${seat.y}: action=${state?.actionType} talk=${state?.hud?.talkVisible}`);
    }
    check('approaching a customer shows the ask-food hint',
      Boolean(withHint), JSON.stringify(withHint ?? await pillOf(page)));
    if (withHint) notes.push(`hint text: ${withHint.text}`);
    await page.screenshot({ path: `${OUT}-2-restaurant-hint.png` });

    // Only meaningful once the hint has actually been seen; otherwise "it is
    // gone" is true for the wrong reason and reads as a pass.
    if (withHint) {
      await page.screenshot({ path: `${OUT}-3-restaurant-hint-shown.png` });
      // Walking away is not a clean test: a clicked customer stays targeted
      // while in range, so Talk — and therefore the hint — is still correct.
      // The unambiguous case is the contextual action becoming something else.
      // Standing at the belt makes it 'collect'.
      await page.click('#game-canvas', { position: { x: 512, y: 130 }, force: true });
      const busy = await waitFor(page, () => restaurantDebug(page),
        (d) => d && d.actionType !== 'none', 15000, 'a non-talk contextual action');
      const away = await pillOf(page);
      check('the hint clears once the contextual action is no longer asking',
        Boolean(busy) && Boolean(away?.hidden || !/What food do you like/.test(away?.text ?? '')),
        `action=${busy?.actionType} pill=${JSON.stringify(away)}`);
      await page.screenshot({ path: `${OUT}-4-restaurant-collecting.png` });
    }
  }

  await context.close();
}

try {
  await main();
} catch (error) {
  check('the visuals run completed without throwing', false, String(error?.message ?? error));
} finally {
  await browser?.close().catch(() => {});
}

check('no console or page errors', errors.length === 0, errors.slice(0, 4).join(' || '));
for (const note of notes) console.log(`NOTE  ${note}`);
const failed = results.filter((result) => !result.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
if (failed > 0) process.exitCode = 1;
