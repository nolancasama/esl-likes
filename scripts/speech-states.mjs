// Speech state checks with a scripted stand-in recogniser. Run from this repo:
//   npm run build && npx vite preview --port 5199   (in another terminal)
//   node scripts/speech-states.mjs http://localhost:5199/ .tmp/speech
//
// A real microphone cannot run headless. This drives the REAL HUD and speech
// state machine with a fake SpeechRecognition that replays scripted transcripts,
// to check the four behaviours the Chromebook pass must also see:
//   1. one press of the talk button starts listening
//   2. a valid "What food do you like?" is accepted
//   3. failed or partial speech reaches Try Again
//   4. after two failures the fallback appears, and it works
// It proves the software path only. It says nothing about real microphones,
// real recognition quality or Japanese-accented speech.
// playwright resolves from recipe-tester/node_modules; it is not a dependency here.
import { chromium } from 'playwright';

const URL = process.argv[2] || 'http://localhost:5199/';
const OUT = process.argv[3] || '.tmp/speech';
const SAVE_KEY = 'esl-likes-save-v1';

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const context = await browser.newContext({ viewport: { width: 1024, height: 600 } });

// Fresh save per page (micFree OFF), plus the fake recogniser. Each start()
// consumes the next scripted list of alternatives and reports it as a final
// result 250 ms into the hold.
await context.addInitScript((key) => {
  if (!sessionStorage.getItem('seeded')) {
    localStorage.setItem(key, JSON.stringify({ version: 1, settings: { micFree: false, difficulty: 1 } }));
    sessionStorage.setItem('seeded', '1');
  }
  window.__speechPlan = [];
  class FakeRecognition {
    start() {
      const plan = window.__speechPlan.shift() ?? [];
      this.timer = setTimeout(() => {
        if (plan.length) {
          const result = plan.map((transcript) => ({ transcript, confidence: 0.9 }));
          result.isFinal = true;
          this.onresult?.({ results: [result] });
        }
        // Press-to-talk: a real recogniser ends by itself after the utterance.
        this.endTimer = setTimeout(() => this.onend?.(), 60);
      }, 250);
    }
    stop() { setTimeout(() => this.onend?.(), 30); }
    abort() { clearTimeout(this.timer); }
  }
  window.SpeechRecognition = FakeRecognition;
  window.webkitSpeechRecognition = FakeRecognition;
}, SAVE_KEY);

const results = [];
const errors = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

async function openAtCustomer(label) {
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${label}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`${label}: PAGEERROR ${e.message}`));
  const sleep = (ms) => page.waitForTimeout(ms);
  const state = () => page.evaluate(() => {
    const visible = (el) => Boolean(el) && !el.hidden && !el.closest('[hidden]')
      && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';
    const talk = document.querySelector('.lesson-hud__talk');
    const bubble = document.querySelector('.npc-dialogue');
    return {
      talk: visible(talk) ? talk.dataset.state : null,
      fallback: [...document.querySelectorAll('.lesson-hud__fallback')].some(visible),
      bubble: visible(bubble) ? document.querySelector('.npc-dialogue__line')?.textContent.trim() : null,
    };
  });
  await page.goto(URL, { waitUntil: 'networkidle' });
  await sleep(3000);
  const hold = async (keys, ms) => {
    for (const k of keys) await page.keyboard.down(k);
    await sleep(ms);
    for (const k of keys) await page.keyboard.up(k);
    await sleep(80);
  };
  await hold(['KeyW', 'KeyA'], 2500);
  await page.keyboard.press('Space');
  await sleep(2500);
  await hold(['KeyW', 'KeyA'], 550);
  for (let i = 0; i < 16 && !(await state()).talk; i += 1) await hold(['KeyW'], 140);
  return { page, sleep, state };
}

// One press; nothing is held or released (SPEC §3).
async function holdTalk(page, sleep, transcripts) {
  await page.evaluate((plan) => window.__speechPlan.push(plan), transcripts);
  await page.click('.lesson-hud__talk');
  await sleep(120);
  const during = await page.evaluate(() => document.querySelector('.lesson-hud__talk')?.dataset.state);
  await sleep(900);
  return during;
}

// ---- Session 1: a valid question is accepted ------------------------------
{
  const { page, sleep, state } = await openAtCustomer('valid');
  let s = await state();
  check('talk control is ready beside the customer', s.talk === 'ready', s.talk);
  const during = await holdTalk(page, sleep, ['what food do you like']);
  check('1. one press of the talk button starts listening', during === 'listening', during);
  s = await state();
  check('2. "What food do you like?" is accepted', s.bubble && /^I like /.test(s.bubble), s.bubble);
  await page.screenshot({ path: `${OUT}-1-accepted.png` });
  await page.close();
}

// ---- Session 2: failures reach Try Again, then the fallback ---------------
{
  const { page, sleep, state } = await openAtCustomer('failures');
  await holdTalk(page, sleep, ['banana']);
  let s = await state();
  check('3a. unrelated speech reaches Try Again', s.talk === 'try-again', s.talk);
  check('3b. one failure does not yet show the fallback', !s.fallback);
  await holdTalk(page, sleep, ['what do you like']);
  s = await state();
  check('3c. partial speech (no "food") is not accepted', !s.bubble, s.bubble ?? 'no answer');
  check('4a. after two failures the fallback appears', s.fallback && !s.talk);
  await page.screenshot({ path: `${OUT}-2-fallback.png` });
  await page.click('.lesson-hud__fallback');
  await sleep(4000);
  s = await state();
  check('4b. the fallback continues the conversation', s.bubble && /^I like /.test(s.bubble), s.bubble);
  await page.close();
}

check('no console or page errors', errors.length === 0, errors.slice(0, 3).join(' || '));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
await browser.close();
