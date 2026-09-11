// Scripted Sports playthrough, keyboard-driven, through the mic-free fallback.
// Run from this repo:
//   npm run build && npx vite preview --port 5199   (in another terminal)
//   node scripts/playthrough-sports.mjs http://localhost:5199/ .tmp/sports
//
// Session A — the listening route: ask each NPC, hear the sport, lead them
// straight to that zone; use 🔊 once. Expect 3 stars, turnaround, stamp.
// Session B — the anti-shortcut check: ignore the answers and tour the zones
// in a fixed order until each NPC joins. That must NOT reach three stars.
// playwright resolves from recipe-tester/node_modules; it is not a dependency here.
import { chromium } from 'playwright';

const URL = process.argv[2] || 'http://localhost:5199/';
const OUT = process.argv[3] || '.tmp/sports';
const SAVE_KEY = 'esl-likes-save-v1';
const SPORTS = ['soccer', 'basketball', 'baseball', 'volleyball'];

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
  const ui = () => page.evaluate(() => {
    const visible = (el) => Boolean(el) && !el.hidden && !el.closest('[hidden]') && !el.closest('.is-hidden')
      && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';
    const q = (s) => document.querySelector(s);
    const read = () => {
      const d = window.__eslDebug?.sports;
      return d ? JSON.parse(JSON.stringify(typeof d === 'function' ? d() : d)) : null;
    };
    return {
      debug: read(),
      bubble: visible(q('.npc-dialogue__line')) ? q('.npc-dialogue__line').textContent.trim() : null,
      listen: visible(q('.listen-again')),
      fallback: [...document.querySelectorAll('.lesson-hud__fallback')].filter(visible)
        .map((b) => ({ text: b.getAttribute('aria-label') || b.textContent, value: b.dataset.value ?? null })),
      greeting: q('.greeting')?.textContent.trim() ?? null,
      prompt: visible(q('.interaction-prompt')),
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
    if (label) console.log(`  (timed out waiting for ${label})`);
    return null;
  };
  const hold = async (keys, ms) => {
    for (const k of keys) await page.keyboard.down(k);
    await sleep(ms);
    for (const k of keys) await page.keyboard.up(k);
    await sleep(60);
  };
  // Walk toward world (x, z) until within radius or `stop` holds. W is -z, D is +x.
  const walkTo = async (x, z, radius = 0.9, stop = null, max = 140) => {
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

// Hub door for Sports is fourth in the arc, right of centre.
async function enterSports(h) {
  await h.hold(['KeyD'], 700);
  for (let i = 0; i < 40 && !(await h.ui()).prompt; i += 1) await h.hold(['KeyW'], 140);
  await h.page.keyboard.press('Space');
  return h.waitFor((u) => u.debug, 8000, 'sports field');
}

const waitingNpc = (s) => s?.debug?.npcs.findIndex((n) => n.state === 'waiting' && !n.asked) ?? -1;

// Walk to the next waiting NPC, ask through the fallback, read the answer.
async function askNext(h) {
  const s = await h.waitFor((u) => waitingNpc(u) >= 0, 20000, 'waiting NPC');
  if (!s) return null;
  const index = waitingNpc(s);
  const npc = s.debug.npcs[index];
  const asked = await h.walkTo(npc.x, npc.z, 0.8, (u) => u.fallback.length > 0);
  if (!asked?.fallback.length) return null;
  await h.page.click('.lesson-hud__fallback');
  const a = await h.waitFor((u) => u.bubble && /^I like .+\.$/.test(u.bubble), 7000, 'answer');
  const sport = a?.bubble.match(/^I like (.+)\.$/)?.[1] ?? null;
  return { index, asked, bubble: a?.bubble, sport: SPORTS.includes(sport) ? sport : null };
}

const zoneOf = (s, id) => s.debug.zones.find((z) => z.id === id);
const npcState = (s, index) => s?.debug?.npcs[index]?.state;

// Lead the followers into a zone; returns the state after arrival settles.
async function visitZone(h, id, index) {
  const s = await h.ui();
  const zone = zoneOf(s, id);
  const arrived = await h.walkTo(zone.x, zone.z, 1.2, (u) => npcState(u, index) === 'joined'
    || (u.bubble && !/^I like/.test(u.bubble)));
  await h.sleep(900);
  return arrived ? h.ui() : null;
}

// ---- Session A: the listening route -------------------------------------
if (!process.env.ONLY_B) {
  const h = await openPage('A');
  const { page } = h;
  let s = await enterSports(h);
  check('hub -> Sports field', s?.debug);
  await h.sleep(1500);
  s = await h.ui();
  check('debug snapshot exposes four zones and no wanted sports',
    s.debug?.zones.length === 4 && !JSON.stringify(s.debug).match(/want|sport"|favou?rite/i),
    JSON.stringify(s.debug?.zones.map((z) => z.id)));
  await page.screenshot({ path: `${OUT}-01-field.png` });

  let joined = 0;
  for (let i = 0; i < 3; i += 1) {
    const q = await askNext(h);
    if (!q) { console.log(`  stalled before NPC ${i + 1}: ${JSON.stringify((await h.ui()).debug)}`); break; }
    if (i === 0) {
      check('question offered: "What sport do you like?"', /what sport do you like/i.test(q.asked.fallback[0].text), q.asked.fallback[0].text);
      check('NPC answers with an exact vocabulary sentence', q.sport, q.bubble);
      await page.screenshot({ path: `${OUT}-02-answer.png` });
    }
    s = await h.waitFor((u) => !u.bubble && npcState(u, q.index) === 'following', 8000, 'follower');
    if (i === 0) {
      check('the NPC follows after answering', s);
      check('the answer is not left on screen', s && !/I like/.test(s.body));
      check('🔊 offered while someone follows', s?.listen);
    }
    if (i === 1) {
      await page.click('.listen-again');
      const r = await h.waitFor((u) => u.bubble && /I like/.test(u.bubble), 3000, 'replayed answer');
      check('🔊 replays the follower\'s exact sentence', r?.bubble === q.bubble, r?.bubble);
      await h.waitFor((u) => !u.bubble, 6000);
      await page.screenshot({ path: `${OUT}-03-following.png` });
    }
    s = await visitZone(h, q.sport, q.index);
    if (npcState(s, q.index) === 'joined') joined += 1;
    if (i === 0) {
      check('the follower joins in at their own zone', npcState(s, q.index) === 'joined', npcState(s, q.index));
      await page.screenshot({ path: `${OUT}-04-playing.png` });
    }
    await h.walkTo(0, 0, 1.5);
  }
  check('all three NPCs joined their zones', joined === 3, `${joined}/3`);

  s = await h.waitFor((u) => u.fallback.length >= 3, 15000, 'turnaround');
  const values = s?.fallback.map((f) => f.value) ?? [];
  check('turnaround offers all four sport sentences', values.length === 4 && values.includes('soccer'), s?.fallback.map((f) => f.text).join(' | '));
  await h.sleep(1500);
  await page.screenshot({ path: `${OUT}-05-turnaround.png` });
  await page.click('.lesson-hud__fallback[data-value="soccer"]');
  await h.sleep(1200);
  await page.screenshot({ path: `${OUT}-06-reaction.png` });
  s = await h.waitFor((u) => !u.debug && u.greeting !== null, 15000, 'hub');
  check('finishes back to the hub', s);
  await h.sleep(1200);
  s = await h.ui();
  check('hub greets with the sport the child chose', s.greeting?.includes('soccer'), s.greeting);
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '{}'), SAVE_KEY);
  check('stamp and answer persisted', saved?.stamps?.sports === true && saved?.answers?.sport === 'soccer',
    JSON.stringify({ stamps: saved?.stamps, answers: saved?.answers }));
  check('listening + one replay = 3 stars', saved?.bestStars?.sports === 3, JSON.stringify(saved?.bestStars));

  s = await enterSports(h);
  check('Sports can be entered a second time', s?.debug);
  await h.sleep(1500);
  const dupes = await page.evaluate(() => ({
    listen: document.querySelectorAll('.listen-again').length,
    hud: document.querySelectorAll('.lesson-hud').length,
    canvases: document.querySelectorAll('canvas').length,
  }));
  check('re-entry leaves no duplicated overlays', dupes.listen <= 1 && dupes.hud === 1, JSON.stringify(dupes));
  await page.close();
}

// ---- Session B: ignore the answers, tour the zones -------------------------
{
  const h = await openPage('B');
  const { page } = h;
  await enterSports(h);
  await h.sleep(1500);
  let wrong = null;
  for (let i = 0; i < 3; i += 1) {
    const q = await askNext(h);
    if (!q) { console.log(`  B stalled before NPC ${i + 1}: ${JSON.stringify((await h.ui()).debug)}`); break; }
    await h.waitFor((u) => !u.bubble && npcState(u, q.index) === 'following', 8000, 'follower');
    // Tour with the heard zone last, so the check is deterministic: a lucky
    // first-zone guess is allowed by SPEC, and the unit test already measures
    // how rarely random touring reaches three stars.
    const tour = (await h.ui()).debug.zones.map((z) => z.id).filter((id) => id !== q.sport).concat(q.sport);
    for (const id of tour) {
      const before = npcState(await h.ui(), q.index);
      const s = await visitZone(h, id, q.index);
      if (process.env.VERBOSE) {
        console.log(`  B npc ${i + 1} (said ${q.sport}) -> ${id}: ${before} -> ${npcState(s, q.index)}; bubble=${s?.bubble}; player=${JSON.stringify(s?.debug?.player)}`);
      }
      if (npcState(s, q.index) === 'joined') break;
      if (wrong === null && s) {
        wrong = { bubble: s.bubble, english: /I like/.test(s.body), stillFollowing: npcState(s, q.index) === 'following' };
        await page.screenshot({ path: `${OUT}-07-wrong-zone.png` });
      }
      await h.walkTo(0, 0, 1.5);
    }
    await h.walkTo(0, 0, 1.5);
  }
  check('a wrong zone: Japanese reaction, no English repeat, still following',
    wrong && !wrong.english && wrong.stillFollowing && wrong.bubble, JSON.stringify(wrong));
  const s = await h.waitFor((u) => u.fallback.length >= 3, 15000, 'turnaround');
  if (s) await page.click('.lesson-hud__fallback');
  await h.waitFor((u) => !u.debug, 15000, 'hub');
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '{}'), SAVE_KEY);
  const stars = saved?.bestStars?.sports ?? null;
  check('touring still finishes and earns the stamp (no dead end)', saved?.stamps?.sports === true);
  check('anti-shortcut: touring zones in order cannot reach 3 stars', stars !== null && stars < 3, JSON.stringify(saved?.bestStars));
  await page.close();
}

check('no console or page errors', errors.length === 0, errors.slice(0, 3).join(' || '));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
await browser.close();
