// Does the easel tell the truth, and does つぎ ▶ page it without stealing Space?
//
// Run through scripts/playthrough-run.mjs. The one invariant worth a harness is
// "what the child sees on the easel is what opens", so this reads
// previewSubjectId before the press and activeSubjectId after it, rather than
// trusting a screenshot of a page that all five subjects can plausibly produce.
import { chromium } from 'playwright';

const TARGET_URL = process.argv[2] || 'http://localhost:5199/';
const OUT = process.argv[3] || '.tmp/preview';
const VIEW = { width: Number(process.argv[4]) || 1024, height: Number(process.argv[5]) || 600 };

const SAVE_KEY = 'esl-likes-save-v1';
const ANSWER_PATTERN = /^I like ([a-z]+)\.$/;
const results = [];
const notes = [];
const errors = [];
let browser = null;

function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
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

async function pulseUntil(page, keys, predicate, taps, what) {
  for (let i = 0; i < taps; i += 1) {
    if (predicate(await debugOf(page))) return true;
    await hold(page, keys, 140);
    await page.waitForTimeout(60);
  }
  const ok = predicate(await debugOf(page));
  if (!ok) check(`walking to ${what}`, false);
  return ok;
}

async function answerQuestion(page, label) {
  await page.waitForSelector('.lesson-hud__talk', { state: 'visible', timeout: 15000 });
  await page.click('.lesson-hud__talk', { force: true });
  await page.waitForSelector('.lesson-hud__fallback', { state: 'visible', timeout: 8000 });
  await page.click('.lesson-hud__fallback');
  const ready = await waitFor(page, (d) => d?.phase === 'coloring' && d?.toolsVisible, 9000,
    `${label} coloring tools`);
  if (!ready) return null;
  const answer = await page.locator('.coloring-bubble__answer').first()
    .textContent().catch(() => null);
  return answer?.replace(/\s+/g, ' ').trim().match(ANSWER_PATTERN)?.[1] ?? null;
}

function toScreen(box, x, y) {
  const size = Math.min(box.width, box.height);
  return {
    x: box.x + (box.width - size) / 2 + x * size,
    y: box.y + (box.height - size) / 2 + y * size,
  };
}

async function paintToFullPower(page, favourite, label) {
  await page.click(`.coloring-swatch[data-color="${favourite}"]`, { force: true });
  await page.waitForTimeout(70);
  await page.click('.coloring-brush[data-brush="large"]', { force: true });
  await page.waitForTimeout(70);
  const box = await page.locator('.coloring-canvas').boundingBox();
  for (let y = 0.06; y <= 0.96; y += 0.035) {
    const state = await debugOf(page);
    if ((state?.power ?? 0) >= 1 || state?.phase !== 'coloring') break;
    const from = toScreen(box, 0.06, y);
    const to = toScreen(box, 0.94, y);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 4 });
    await page.mouse.up();
    await page.waitForTimeout(30);
  }
  return Boolean(await waitFor(page, (d) => d?.phase === 'coloring' && d?.power >= 1, 6000,
    `${label} full power`));
}

async function finishCreation(page, label) {
  await page.waitForTimeout(1200);
  await page.click('.coloring-tool--done', { force: true });
  return waitFor(page, (d) => d?.phase === 'room' && d?.canAct, 25000, `${label} room`);
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
  await page.waitForTimeout(2600);
  await hold(page, ['KeyW', 'KeyA'], 1220);
  await hold(page, ['KeyW'], 950);
  await page.keyboard.press('Space');
  const first = await waitFor(page, (d) => d?.phase === 'canvas-question', 9000, 'first close-up');
  check('the first page of a visit is still the robot',
    first?.activeSubjectId === 'robot', String(first?.activeSubjectId));

  // One creation, so the room (and its easel) exists to be tested.
  const favourite = await answerQuestion(page, 'round 1');
  check('round 1 names a favourite colour', Boolean(favourite), String(favourite));
  check('round 1 paints to full power', await paintToFullPower(page, favourite, 'round 1'));
  const room = await finishCreation(page, 'round 1');
  check('the first creation comes alive', room?.robots?.length === 1, `robots=${room?.robots?.length}`);

  const afterFinish = room?.previewSubjectId ?? null;
  check('finishing the robot queues the next registry subject on the easel',
    afterFinish && afterFinish !== 'robot', `preview=${afterFinish}`);
  notes.push(`preview after finishing robot: ${afterFinish}`);

  // ---- つぎ ▶ pages the preview, in registry order, wrapping ---------------
  const seen = [afterFinish];
  for (let press = 0; press < 5; press += 1) {
    await page.click('.coloring-room-ui__next', { force: true });
    await page.waitForTimeout(220);
    const state = await debugOf(page);
    seen.push(state?.previewSubjectId ?? null);
  }
  notes.push(`preview sequence: ${seen.join(' -> ')}`);
  check('Next changes the easel preview every press',
    seen.every((id, index) => index === 0 || id !== seen[index - 1]), seen.join(' -> '));
  check('Next wraps around the registry rather than stopping at the end',
    new Set(seen).size >= 5, `${new Set(seen).size} distinct of ${seen.length}`);
  const livingAfterNext = await debugOf(page);
  check('paging the preview leaves living creations alone',
    livingAfterNext?.robots?.length === 1, `robots=${livingAfterNext?.robots?.length}`);
  check('paging the preview does not touch durable storage',
    livingAfterNext?.persistence?.count === 1,
    JSON.stringify(livingAfterNext?.persistence));
  await page.screenshot({ path: `${OUT}-1-room-with-next.png` });

  // ---- Space after Next opens the easel, it does not page again -----------
  const previewBeforeSpace = livingAfterNext?.previewSubjectId ?? null;
  await pulseUntil(page, ['KeyW'], (d) => d?.action === 'easel', 24, 'the easel');
  await waitFor(page, (d) => d?.phase === 'room' && d?.canAct && d?.action === 'easel', 9000,
    'easel action');
  const previewAtEasel = (await debugOf(page))?.previewSubjectId ?? null;
  await page.keyboard.press('Space');
  const opened = await waitFor(page, (d) => d?.phase === 'canvas-question', 9000, 'close-up from Space');
  check('Space still opens the easel after pressing Next (the button never keeps focus)',
    Boolean(opened), `phase=${opened?.phase}`);
  check('the subject that opens is exactly the one the easel was showing',
    opened?.activeSubjectId === previewAtEasel,
    `easel showed ${previewAtEasel}, close-up opened ${opened?.activeSubjectId}`);
  notes.push(`preview before walking: ${previewBeforeSpace}; at easel: ${previewAtEasel}; opened: ${opened?.activeSubjectId}`);
  await page.screenshot({ path: `${OUT}-2-opened-${opened?.activeSubjectId}.png` });

  // ---- Snowman close-up, for the two-circle judgement --------------------
  let guard = 0;
  while ((await debugOf(page))?.activeSubjectId !== 'snowman' && guard < 8) {
    guard += 1;
    const colour = await answerQuestion(page, `cycle ${guard}`);
    if (!colour || !await paintToFullPower(page, colour, `cycle ${guard}`)) break;
    const back = await finishCreation(page, `cycle ${guard}`);
    if (!back) break;
    while ((await debugOf(page))?.previewSubjectId !== 'snowman' && guard < 40) {
      guard += 1;
      await page.click('.coloring-room-ui__next', { force: true });
      await page.waitForTimeout(180);
    }
    await pulseUntil(page, ['KeyW'], (d) => d?.action === 'easel', 24, 'the easel');
    await page.keyboard.press('Space');
    await waitFor(page, (d) => d?.phase === 'canvas-question', 9000, 'snowman close-up');
  }
  const snowmanState = await debugOf(page);
  check('the snowman can be reached from the easel',
    snowmanState?.activeSubjectId === 'snowman', String(snowmanState?.activeSubjectId));
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}-3-snowman-closeup.png` });

  // ---- A finished snowman, then the Zoo, to judge the 1.25x cross-game size
  if (snowmanState?.activeSubjectId === 'snowman') {
    const colour = await answerQuestion(page, 'snowman');
    if (colour && await paintToFullPower(page, colour, 'snowman')) {
      const room = await finishCreation(page, 'snowman');
      check('the snowman comes alive in the Coloring room', Boolean(room),
        `robots=${room?.robots?.length}`);
      await page.screenshot({ path: `${OUT}-4-snowman-alive.png` });

      // The final turnaround must show the creation alone — no avatar walking
      // back into the middle of the room.
      await pulseUntil(page, ['KeyD'], (d) => (d?.player?.x ?? -99) >= 3.25, 20, 'the door side');
      await pulseUntil(page, ['KeyW'], (d) => d?.action === 'door', 28, 'the door');
      await page.keyboard.press('Space');
      const turn = await waitFor(page, (d) => d?.phase === 'turnaround', 9000, 'the turnaround');
      check('walking out starts the turnaround question', Boolean(turn), `phase=${turn?.phase}`);
      await page.waitForTimeout(1800);
      await page.screenshot({ path: `${OUT}-7-turnaround.png` });

      await page.keyboard.press('Escape');
      await page.waitForTimeout(2400);
      await hold(page, ['KeyD'], 1500);
      for (let step = 0; step < 14; step += 1) {
        await hold(page, ['KeyW'], 260);
        if (await page.evaluate(() => Boolean(window.__eslDebug?.zoo))) break;
        await page.keyboard.press('Space');
      }
      await page.keyboard.press('Space');
      const inZoo = await page.evaluate(() => Boolean(window.__eslDebug?.zoo));
      check('the Zoo opens so the visitor crowd can be judged', inZoo);
      if (inZoo) {
        await page.waitForTimeout(2800);
        await page.screenshot({ path: `${OUT}-5-zoo-with-creation.png` });
        await hold(page, ['KeyW'], 900);
        await page.waitForTimeout(1200);
        await page.screenshot({ path: `${OUT}-6-zoo-closer.png` });
      }
    }
  }

  await context.close();
}

try {
  await main();
} catch (error) {
  check('the preview run completed without throwing', false, String(error?.message ?? error));
} finally {
  await browser?.close().catch(() => {});
}

check('no console or page errors', errors.length === 0, errors.slice(0, 4).join(' || '));
for (const note of notes) console.log(`NOTE  ${note}`);
const failed = results.filter((result) => !result.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
if (failed > 0) process.exitCode = 1;
