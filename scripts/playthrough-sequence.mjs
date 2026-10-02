// The student run: Coloring -> Restaurant -> Zoo -> completion.
//
// Run through scripts/playthrough-run.mjs (`npm run playthrough -- sequence`).
// Coloring is finished for real, through its own Restaurant-button turnaround, so the
// minigame's `ctx.finish` is what moves the run on. The Restaurant and Zoo are
// finished through the dev-gated `shellFinish` hook (`?editor=1`), which calls
// the same shell route; their own harnesses cover playing them to the end.
import { chromium } from 'playwright';

const BASE_URL = process.argv[2] || 'http://localhost:5199/';
const OUT = process.argv[3] || '.tmp/sequence';
const VIEW = { width: Number(process.argv[4]) || 1024, height: Number(process.argv[5]) || 600 };

const SAVE_KEY = 'esl-likes-save-v1';
const results = [];
const errors = [];
let browser = null;

function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

const shellOf = (page) => page.evaluate(() => window.__eslDebug?.shell ?? null);
const coloringOf = (page) => page.evaluate(() => window.__eslDebug?.coloring ?? null);
const backVisible = (page) => page.locator('.shell-back-control').isVisible();
const saved = (page, key) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || '{}'), key);

async function poll(read, predicate, timeoutMs, what) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await read();
    if (predicate(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  check(`waiting for ${what}`, false, JSON.stringify(last)?.slice(0, 200));
  return null;
}

const waitStage = (page, stage, what = stage) => poll(() => shellOf(page),
  (shell) => shell?.stage === stage && !shell.routing, 12000, `stage ${what}`);
const waitColoring = (page, predicate, timeoutMs, what) => poll(() => coloringOf(page), predicate, timeoutMs, what);

async function hold(page, keys, ms) {
  for (const key of keys) await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  for (const key of keys) await page.keyboard.up(key);
}

async function pulseUntil(page, keys, predicate, taps) {
  for (let i = 0; i < taps; i += 1) {
    if (predicate(await coloringOf(page))) return true;
    await hold(page, keys, 140);
    await page.waitForTimeout(60);
  }
  return predicate(await coloringOf(page));
}

async function tapFallback(page) {
  await page.waitForSelector('.lesson-hud__talk', { state: 'visible', timeout: 15000 });
  await page.click('.lesson-hud__talk', { force: true });
  await page.waitForSelector('.lesson-hud__fallback', { state: 'visible', timeout: 8000 });
  await page.locator('.lesson-hud__fallback').first().click();
}

function toScreen(box, x, y) {
  const size = Math.min(box.width, box.height);
  return { x: box.x + (box.width - size) / 2 + x * size, y: box.y + (box.height - size) / 2 + y * size };
}

/** One creation from the close-up: answer, paint to full power, Done. */
async function makeCreation(page, label) {
  await tapFallback(page);
  const ready = await waitColoring(page, (d) => d?.phase === 'coloring' && d?.toolsVisible, 9000, `${label} tools`);
  if (!ready) return false;
  const answer = await page.locator('.coloring-bubble__answer').first().textContent().catch(() => '');
  const favourite = answer.replace(/\s+/g, ' ').trim().match(/^I like ([a-z]+)\.$/)?.[1];
  if (!favourite) return false;
  await page.click(`.coloring-swatch[data-color="${favourite}"]`, { force: true });
  await page.click('.coloring-brush[data-brush="large"]', { force: true });
  const box = await page.locator('.coloring-canvas').boundingBox();
  for (let y = 0.06; y <= 0.96; y += 0.035) {
    if (((await coloringOf(page))?.power ?? 0) >= 1) break;
    const from = toScreen(box, 0.06, y);
    const to = toScreen(box, 0.94, y);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 4 });
    await page.mouse.up();
    await page.waitForTimeout(30);
  }
  await page.waitForTimeout(1200);
  await page.click('.coloring-tool--done', { force: true });
  return Boolean(await waitColoring(page, (d) => d?.phase === 'room' && d?.canAct, 25000, `${label} room`));
}

/** Make one creation, then press the Restaurant button and answer the turnaround. */
async function completeColoring(page, label) {
  const first = await waitColoring(page, (d) => d?.phase === 'canvas-question' || (d?.phase === 'room' && d?.canAct),
    12000, `${label} coloring ready`);
  if (first?.phase === 'room') {
    await pulseUntil(page, ['KeyW'], (d) => d?.action === 'easel', 24);
    await page.keyboard.press('Space');
    await waitColoring(page, (d) => d?.phase === 'canvas-question', 9000, `${label} close-up`);
  }
  check(`${label}: a creation is made`, await makeCreation(page, label));
  const finishButton = page.locator('[data-coloring-finish]');
  await finishButton.waitFor({ state: 'visible', timeout: 6000 });
  check(`${label}: the Restaurant button is visible`, await finishButton.isVisible());
  await finishButton.click();
  await waitColoring(page, (d) => d?.phase === 'turnaround', 6000, `${label} turnaround`);
  await tapFallback(page);
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

  const url = new URL(BASE_URL);
  url.searchParams.set('editor', '1');
  await page.goto(url.href, { waitUntil: 'load' });

  // ---- Startup ------------------------------------------------------------
  const startup = await waitStage(page, 'coloring', 'coloring at startup');
  check('startup opens Coloring directly in sequence mode', startup?.mode === 'sequence', JSON.stringify(startup));
  check('the five-door hub never appears', !(await page.locator('.hub-prompt').isVisible().catch(() => false)));
  check('Coloring shows no Back', !(await backVisible(page)));
  await waitColoring(page, (d) => d?.phase === 'canvas-question', 9000, 'first close-up');
  await page.screenshot({ path: `${OUT}-1-startup-coloring.png` });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(900);
  check('Escape does not leave Coloring', (await shellOf(page))?.stage === 'coloring');

  // ---- Forward: Coloring -> Restaurant, by Coloring's own finish ----------
  await completeColoring(page, 'first Coloring');
  await waitStage(page, 'restaurant', 'restaurant after Coloring');
  await page.waitForTimeout(1200);
  check('finishing Coloring opens the Restaurant', (await shellOf(page))?.stage === 'restaurant');
  check('Back appears in the Restaurant', await backVisible(page));
  await page.screenshot({ path: `${OUT}-2-restaurant.png` });
  let save = await saved(page, SAVE_KEY);
  check('Coloring earned its stamp', save.stamps?.coloring === true, JSON.stringify(save.stamps));

  // ---- Back: Restaurant -> fresh Coloring, creations kept ----------------
  await page.keyboard.press('Escape');
  await waitStage(page, 'coloring', 'coloring after Restaurant Back');
  const back = await waitColoring(page, (d) => d?.persistence?.count >= 1, 9000, 'saved creation');
  check('Restaurant Escape goes back to Coloring', Boolean(back));
  check('the saved creation is still there', back?.persistence?.count === 1, JSON.stringify(back?.persistence));
  check('Coloring hides Back again', !(await backVisible(page)));
  await page.screenshot({ path: `${OUT}-3-back-to-coloring.png` });

  await completeColoring(page, 'second Coloring');
  await waitStage(page, 'restaurant', 'restaurant again');
  check('finishing Coloring again opens the Restaurant again', (await shellOf(page))?.stage === 'restaurant');
  save = await saved(page, SAVE_KEY);

  // ---- Restaurant -> Zoo, Zoo Back -> fresh Restaurant --------------------
  await page.evaluate(() => window.__eslDebug.shellFinish(2));
  await waitStage(page, 'zoo', 'zoo');
  await page.waitForTimeout(1500);
  check('finishing the Restaurant opens the Zoo', (await shellOf(page))?.stage === 'zoo');
  check('Back stays in the Zoo', await backVisible(page));
  await page.screenshot({ path: `${OUT}-4-zoo.png` });
  await page.locator('.shell-back-control').click();
  await waitStage(page, 'restaurant', 'restaurant after Zoo Back');
  check('Zoo Back goes to the Restaurant', (await shellOf(page))?.stage === 'restaurant');

  await page.evaluate(() => window.__eslDebug.shellFinish(3));
  await waitStage(page, 'zoo', 'zoo again');
  await page.waitForTimeout(800);
  await page.keyboard.press('Escape');
  await waitStage(page, 'restaurant', 'restaurant after Zoo Escape');
  check('Zoo Escape goes to the Restaurant', (await shellOf(page))?.stage === 'restaurant');
  await page.evaluate(() => window.__eslDebug.shellFinish(3));
  await waitStage(page, 'zoo', 'zoo a third time');

  // ---- Zoo -> completion ---------------------------------------------------
  await page.evaluate(() => window.__eslDebug.shellFinish(1));
  await waitStage(page, 'complete', 'completion screen');
  const card = page.locator('.sequence-complete');
  check('finishing the Zoo shows the completion screen', await card.isVisible());
  check('the completion screen says ぜんぶ できた！',
    (await card.locator('h1').textContent())?.trim() === 'ぜんぶ できた！');
  const names = await card.locator('.sequence-complete__name').allTextContents();
  check('the completion screen lists only the three stages', names.join(',') === 'Coloring,Restaurant,Zoo', names.join(','));
  check('the completion screen has no Back', !(await backVisible(page)));
  await page.screenshot({ path: `${OUT}-5-complete.png` });
  save = await saved(page, SAVE_KEY);
  check('all three stamps are earned',
    save.stamps?.coloring && save.stamps?.restaurant && save.stamps?.zoo, JSON.stringify(save.stamps));
  check('Drink Stand and Sports earned nothing', !save.stamps?.['drink-stand'] && !save.stamps?.sports);

  // ---- もういちど -> Coloring, keeping every save ----------------------------
  await card.locator('.sequence-complete__replay').click();
  await waitStage(page, 'coloring', 'coloring after replay');
  const replay = await waitColoring(page, (d) => d?.persistence?.count >= 2, 9000, 'saved creations after replay');
  check('もういちど restarts at Coloring', (await shellOf(page))?.stage === 'coloring');
  check('both creations survive the replay', replay?.persistence?.count === 2, JSON.stringify(replay?.persistence));
  check('the completion screen is gone', !(await card.isVisible().catch(() => false)));
  const after = await saved(page, SAVE_KEY);
  check('stamps and best stars survive the replay',
    after.stamps?.zoo && after.bestStars?.restaurant === 3, JSON.stringify(after.bestStars));
  await page.screenshot({ path: `${OUT}-6-replay-coloring.png` });

  // ---- ?hub=1 still opens the old free-play room ---------------------------
  const hubUrl = new URL(BASE_URL);
  hubUrl.searchParams.set('hub', '1');
  await page.goto(hubUrl.href, { waitUntil: 'load' });
  const hub = await waitStage(page, 'hub', 'hub via ?hub=1');
  check('?hub=1 opens the five-door hub', hub?.mode === 'hub');
  check('?hub=1 has no dev finish hook without ?editor',
    !(await page.evaluate(() => typeof window.__eslDebug?.shellFinish === 'function')));
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}-7-hub.png` });

  await context.close();
}

try {
  await main();
} catch (error) {
  check('the sequence run completed without throwing', false, String(error?.message ?? error));
} finally {
  await browser?.close().catch(() => {});
}

check('no console or page errors', errors.length === 0, errors.slice(0, 4).join(' || '));
const failed = results.filter((result) => !result.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
if (failed > 0) process.exitCode = 1;
