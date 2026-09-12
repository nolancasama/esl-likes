// Scripted Zoo playthrough, keyboard-driven, through the mic-free fallback.
// Run from this repo:
//   npm run build && npx vite preview --port 5199   (in another terminal)
//   node scripts/playthrough-zoo.mjs http://localhost:5199/ .tmp/zoo
//
// Session A — the listening route: ask, hear the animal, walk to that habitat,
// frame and shoot it, show the photo. Use 🔊 once. Expect 3 stars and a photo
// saved into the stamp book.
// Session B — the anti-shortcut check: photograph and show a wrong animal
// first, every time. That must NOT reach three stars.
// playwright resolves from recipe-tester/node_modules; it is not a dependency here.
import { chromium } from 'playwright';

const URL = process.argv[2] || 'http://localhost:5199/';
const OUT = process.argv[3] || '.tmp/zoo';
const SAVE_KEY = 'esl-likes-save-v1';
const ANIMALS = ['elephant', 'giraffe', 'penguin', 'tiger', 'dog', 'cat'];
// Adjust to the class names the minigame actually uses.
const SEL = {
  viewfinder: '.zoo-viewfinder',
  shutter: '.zoo-viewfinder__shutter',
  camera: '.zoo-ui__camera',
  close: '.zoo-viewfinder__close',
  instruction: '.zoo-ui__instruction',
  notice: '.zoo-ui__notice',
};

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

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
    const read = () => {
      const d = window.__eslDebug?.zoo;
      return d ? JSON.parse(JSON.stringify(typeof d === 'function' ? d() : d)) : null;
    };
    return {
      debug: read(),
      viewfinder: visible(q(SEL.viewfinder)),
      shutterEnabled: q(SEL.shutter) ? !q(SEL.shutter).disabled : null,
      bubble: visible(q('.npc-dialogue__line')) ? q('.npc-dialogue__line').textContent.trim() : null,
      listen: visible(q('.listen-again')),
      fallback: [...document.querySelectorAll('.lesson-hud__fallback')].filter(visible)
        .map((b) => ({ text: b.getAttribute('aria-label') || b.textContent, value: b.dataset.value ?? null })),
      greeting: q('.greeting')?.textContent.trim() ?? null,
      prompt: visible(q('.interaction-prompt')),
      body: document.body.innerText,
    };
  }, SEL);
  const waitFor = async (pred, ms, label) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const s = await ui();
      if (pred(s)) return s;
      await sleep(120);
    }
    if (label) console.log(`  (timed out waiting for ${label})`);
    return null;
  };
  const hold = async (keys, ms) => {
    for (const k of keys) await page.keyboard.down(k);
    await sleep(ms);
    for (const k of keys) await page.keyboard.up(k);
    await sleep(60);
  };
  // Walk toward world (x, z). W is -z, D is +x.
  const walkTo = async (x, z, radius = 1.2, stop = null, max = 160) => {
    for (let i = 0; i < max; i += 1) {
      const s = await ui();
      if (stop && stop(s)) return s;
      const p = s.debug?.player;
      if (!p) return null;
      const dx = x - p.x;
      const dz = z - p.z;
      if (Math.hypot(dx, dz) <= radius) return s;
      const keys = [];
      if (dz < -0.25) keys.push('KeyW');
      if (dz > 0.25) keys.push('KeyS');
      if (dx > 0.25) keys.push('KeyD');
      if (dx < -0.25) keys.push('KeyA');
      await hold(keys, Math.min(260, 60 + Math.hypot(dx, dz) * 40));
    }
    return null;
  };
  await page.goto(URL, { waitUntil: 'networkidle' });
  await sleep(3200);
  return { page, sleep, ui, waitFor, hold, walkTo };
}

// Hub door for Zoo is the rightmost of the arc.
async function enterZoo(h) {
  await h.hold(['KeyD'], 1500);
  for (let i = 0; i < 40 && !(await h.ui()).prompt; i += 1) await h.hold(['KeyW'], 140);
  await h.page.keyboard.press('Space');
  return h.waitFor((u) => u.debug, 8000, 'zoo');
}

const animalFromSentence = (sentence) => ANIMALS.find((a) => new RegExp(`I like ${a}s?\\.`).test(sentence || '')) ?? null;
const waitingVisitor = (s) => s?.debug?.visitors.findIndex((v) => v.asked === false && v.state !== 'hidden') ?? -1;
const habitat = (s, id) => s.debug.habitats.find((hb) => hb.id === id);

async function askNext(h) {
  const s = await h.waitFor((u) => waitingVisitor(u) >= 0, 20000, 'waiting visitor');
  if (!s) return null;
  const index = waitingVisitor(s);
  const v = s.debug.visitors[index];
  const asked = await h.walkTo(v.x, v.z, 1.1, (u) => u.fallback.length > 0);
  if (!asked?.fallback.length) return null;
  await h.page.click('.lesson-hud__fallback');
  const a = await h.waitFor((u) => u.bubble && /^I like .+\.$/.test(u.bubble), 7000, 'answer');
  return { index, asked, bubble: a?.bubble, animal: animalFromSentence(a?.bubble) };
}

// Walk to a habitat, open the viewfinder, wait for a good frame, shoot.
async function photograph(h, animal, tag = '') {
  const s = await h.ui();
  const hb = habitat(s, animal);
  if (!hb) return { ready: false, why: `no habitat for ${animal}` };
  const walked = await h.walkTo(hb.x, hb.z, 3.2);
  const at = walked?.debug?.player;
  await h.page.click(SEL.camera);
  const open = await h.waitFor((u) => u.viewfinder, 5000, 'viewfinder');
  if (!open) return { ready: false, why: 'viewfinder never opened', animal, at };
  // Coarse aiming: nudge until the shutter reports a good frame. Require the
  // viewfinder phase too, so the opening wipe is over before pressing.
  const readyNow = (u) => u.debug?.phase === 'viewfinder' && u.shutterEnabled && u.debug?.shutterReady;
  let ready = await h.waitFor(readyNow, 2500);
  for (let i = 0; i < 16 && !ready; i += 1) {
    await h.hold([i % 2 ? 'KeyA' : 'KeyD'], 120);
    await h.hold(['KeyW'], 140);
    ready = await h.waitFor(readyNow, 1200);
  }
  if (!ready) {
    await h.page.screenshot({ path: `${OUT}-fail-${animal}${tag}-aim.png` });
    console.log(`  could not frame ${animal}: player=${JSON.stringify((await h.ui()).debug?.player)} habitat=${JSON.stringify(hb)}`);
    await h.page.click(SEL.close).catch(() => {});
    await h.waitFor((u) => !u.viewfinder, 4000);
    return { ready: false, why: 'never framed', animal, at };
  }
  const before = await h.page.evaluate(() => {
    window.__shutterClicks = 0;
    const b = document.querySelector('.zoo-viewfinder__shutter');
    b?.addEventListener('click', () => { window.__shutterClicks += 1; }, true);
    const vf = document.querySelector('.zoo-viewfinder');
    return {
      disabled: b?.disabled, rect: b?.getBoundingClientRect().toJSON(),
      viewfinderHidden: vf?.hidden,
      focus: document.activeElement?.className ?? null,
    };
  });
  await h.page.click(SEL.shutter).catch((e) => console.log(`  shutter click threw: ${e.message.split('\n')[0]}`));
  const shot = await h.waitFor((u) => u.debug?.carriedPhoto, 4000, 'photo taken');
  if (!shot) {
    await h.page.screenshot({ path: `${OUT}-fail-${animal}${tag}-shutter.png` });
    const clicks = await h.page.evaluate(() => window.__shutterClicks);
    console.log(`  shutter clicked but no photo for ${animal}: before=${JSON.stringify(before)} clicksSeen=${clicks} after=${JSON.stringify((await h.ui()).debug)}`);
  }
  await h.page.click(SEL.close).catch(() => {});
  await h.waitFor((u) => !u.viewfinder, 4000);
  return { ready: true, carried: shot?.debug?.carriedPhoto ?? null, animal, at };
}

async function showPhoto(h, index) {
  const s = await h.ui();
  const v = s.debug.visitors[index];
  await h.walkTo(v.x, v.z, 1.1);
  await h.page.keyboard.press('Space');
  await h.sleep(1200);
  return h.ui();
}

// ---- Session A: the listening route -------------------------------------
if (!process.env.ONLY_B) {
  const h = await openPage('A');
  const { page } = h;
  let s = await enterZoo(h);
  check('hub -> Zoo', s?.debug);
  await h.sleep(1500);
  s = await h.ui();
  check('debug snapshot exposes six habitats and no wanted animals',
    s.debug?.habitats.length === 6 && !JSON.stringify(s.debug).match(/want|favou?rite/i),
    JSON.stringify(s.debug?.habitats.map((x) => x.id)));
  check('nothing points the way (no marker/arrow/minimap in the overlay)',
    !/やじるし|→|arrow|minimap/i.test(s.body));
  await page.screenshot({ path: `${OUT}-01-plaza.png` });

  let served = 0;
  for (let i = 0; i < 3; i += 1) {
    const q = await askNext(h);
    if (!q) { console.log(`  stalled before visitor ${i + 1}: ${JSON.stringify((await h.ui()).debug)}`); break; }
    if (i === 0) {
      check('question offered: "What animal do you like?"', /what animal do you like/i.test(q.asked.fallback[0].text), q.asked.fallback[0].text);
      check('visitor answers with an exact vocabulary sentence', q.animal, q.bubble);
      await page.screenshot({ path: `${OUT}-02-answer.png` });
      await h.waitFor((u) => !u.bubble, 8000);
      s = await h.ui();
      check('the answer is not left on screen', !/I like/.test(s.body));
      // The control is hidden while the answer plays; wait rather than sample once.
      check('🔊 offered while a request is open', await h.waitFor((u) => u.listen, 6000, '🔊'));
    }
    if (i === 1) {
      await page.click('.listen-again');
      const r = await h.waitFor((u) => u.bubble && /I like/.test(u.bubble), 3000, 'replayed answer');
      check('🔊 replays the visitor\'s exact sentence', r?.bubble === q.bubble, r?.bubble);
      await h.waitFor((u) => !u.bubble, 6000);
    }
    const shot = await photograph(h, q.animal);
    if (i === 0) {
      check('the viewfinder only shoots a well-framed animal', shot?.ready, JSON.stringify(shot));
      check('the photo taken is of that animal', shot?.carried === q.animal, shot?.carried);
      await page.screenshot({ path: `${OUT}-03-photo.png` });
    }
    s = await showPhoto(h, q.index);
    if (s?.debug?.visitors[q.index]?.served) served += 1;
    if (i === 0) await page.screenshot({ path: `${OUT}-04-shown.png` });
  }
  check('all three requests completed', served === 3, `${served}/3`);

  s = await h.waitFor((u) => u.fallback.length >= 3, 15000, 'turnaround');
  const values = s?.fallback.map((f) => f.value) ?? [];
  check('turnaround offers all six animal sentences', values.length === 6 && values.includes('tiger'), s?.fallback.map((f) => f.text).join(' | '));
  await page.screenshot({ path: `${OUT}-05-turnaround.png` });
  await page.click('.lesson-hud__fallback[data-value="tiger"]');
  s = await h.waitFor((u) => !u.debug && u.greeting !== null, 15000, 'hub');
  check('finishes back to the hub', s);
  await h.sleep(1200);
  s = await h.ui();
  check('hub greets with the animal the child chose', s.greeting?.includes('tiger'), s.greeting);
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '{}'), SAVE_KEY);
  check('stamp and answer persisted', saved?.stamps?.zoo === true && saved?.answers?.animal === 'tiger',
    JSON.stringify({ stamps: saved?.stamps, answers: saved?.answers }));
  check('listening + one replay = 3 stars', saved?.bestStars?.zoo === 3, JSON.stringify(saved?.bestStars));
  const photo = saved?.zooPhotos?.zoo ?? saved?.zooPhotos?.animal ?? null;
  check('a photo was saved for the stamp book', typeof photo === 'string' && photo.startsWith('data:image/'),
    photo ? `${photo.slice(0, 24)}… ${Math.round(photo.length / 1024)} kB` : 'none');
  await page.click('.stamp-button');
  await h.sleep(600);
  const shown = await page.evaluate(() => Boolean(document.querySelector('.stamp-photo')));
  check('the stamp book shows the photo', shown);
  await page.screenshot({ path: `${OUT}-06-stampbook.png` });
  await page.evaluate(() => document.querySelector('.modal-header button')?.click());

  s = await enterZoo(h);
  check('Zoo can be entered a second time', s?.debug);
  await h.sleep(1500);
  const dupes = await page.evaluate((SEL) => ({
    listen: document.querySelectorAll('.listen-again').length,
    hud: document.querySelectorAll('.lesson-hud').length,
    viewfinder: document.querySelectorAll(SEL.viewfinder).length,
  }), SEL);
  check('re-entry leaves no duplicated overlays', dupes.listen <= 1 && dupes.hud === 1 && dupes.viewfinder <= 1, JSON.stringify(dupes));
  await page.close();
}

// ---- Session B: ignore the answers, show a wrong animal first --------------
{
  const h = await openPage('B');
  const { page } = h;
  await enterZoo(h);
  await h.sleep(1500);
  let refusal = null;
  for (let i = 0; i < 3; i += 1) {
    const q = await askNext(h);
    if (!q) { console.log(`  B stalled before visitor ${i + 1}: ${JSON.stringify((await h.ui()).debug)}`); break; }
    await h.waitFor((u) => !u.bubble, 8000);
    const wrong = ANIMALS.find((a) => a !== q.animal);
    await photograph(h, wrong);
    let s = await showPhoto(h, q.index);
    if (refusal === null) {
      refusal = { bubble: s?.bubble, english: /I like/.test(s?.body ?? ''), served: s?.debug?.visitors[q.index]?.served };
      await page.screenshot({ path: `${OUT}-07-wrong-animal.png` });
    }
    await photograph(h, q.animal);
    await showPhoto(h, q.index);
  }
  check('a wrong animal is refused in Japanese with no English repeat',
    refusal && !refusal.english && refusal.served === false && refusal.bubble, JSON.stringify(refusal));
  const s = await h.waitFor((u) => u.fallback.length >= 3, 15000, 'turnaround');
  if (s) await page.click('.lesson-hud__fallback');
  await h.waitFor((u) => !u.debug, 15000, 'hub');
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '{}'), SAVE_KEY);
  const stars = saved?.bestStars?.zoo ?? null;
  check('showing wrong photos still finishes and earns the stamp (no dead end)', saved?.stamps?.zoo === true);
  check('anti-shortcut: showing a wrong animal first cannot reach 3 stars', stars !== null && stars < 3, JSON.stringify(saved?.bestStars));
  await page.close();
}

check('no console or page errors', errors.length === 0, errors.slice(0, 3).join(' || '));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
await browser.close();
