// Drink Stand behavioral playthrough at the classroom Chromebook viewport.
// Session A follows the listening route at level 3 and exercises speech focus,
// hold/top-up/tap/overflow filling, rush, combo, and turnaround. Session B uses
// a fixed station order without listening and must not earn three stars.
import { chromium } from 'playwright';
import { clickUntil, createCheck, holdUntil, waitForDebug } from './lib/driver.mjs';
import { createMockSpeechInitScript } from './lib/mockSpeech.mjs';

const URL = process.argv[2] || 'http://localhost:5199/';
const OUT = process.argv[3] || '.tmp/drink';
const optionArgs = process.argv.slice(4);
const onlyAt = optionArgs.indexOf('--only');
const selectedSections = onlyAt === -1
  ? null
  : new Set((optionArgs[onlyAt + 1] ?? '').split(',').map((name) => name.trim()).filter(Boolean));
const sectionEnabled = (name) => !selectedSections || selectedSections.has(name);
const knownSections = new Set(['listening', 'guessing', 'level2', 'mic']);
if (selectedSections && [...selectedSections].some((name) => !knownSections.has(name))) {
  throw new Error(`Unknown --only section. Choose from: ${[...knownSections].join(', ')}`);
}
const SAVE_KEY = 'esl-likes-save-v1';
const SEL = {
  ui: '.drink-stand-ui',
  action: '.drink-stand__action',
  instruction: '.drink-stand__instruction',
  notice: '.drink-stand__notice',
  rush: '.drink-stand__rush',
  combo: '.drink-stand__combo',
};
const DRINKS = new Set(['water', 'milk', 'orange juice', 'apple juice', 'tea', 'soda']);

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const results = [];
const errors = [];
let lastTrace = null;
const recordCheck = createCheck(results, { getTrace: () => lastTrace });
const check = (name, ok, detail = '', precondition = true, trace = null) => recordCheck(name, ok, {
  detail,
  precondition,
  trace,
});

async function newContext(difficulty, seed, { micFree = true, mockSpeech = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  if (mockSpeech) await context.addInitScript(createMockSpeechInitScript());
  await context.addInitScript(({ key, chosenDifficulty, randomSeed, useMicFree }) => {
    let randomState = randomSeed >>> 0;
    Math.random = () => {
      randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
      return randomState / 4294967296;
    };
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem(key, JSON.stringify({
        version: 1,
        settings: { micFree: useMicFree, difficulty: chosenDifficulty },
      }));
      sessionStorage.setItem('seeded', '1');
    }
  }, { key: SAVE_KEY, chosenDifficulty: difficulty, randomSeed: seed, useMicFree: micFree });
  return context;
}

async function openPage(label, difficulty, seed, options = {}) {
  const context = await newContext(difficulty, seed, options);
  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`${label}: ${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`${label}: PAGEERROR ${error.message}`));
  const sleep = (ms) => page.waitForTimeout(ms);
  const ui = () => page.evaluate((selectors) => {
    const visible = (element) => Boolean(element)
      && !element.hidden
      && !element.closest('[hidden]')
      && !element.closest('.is-hidden')
      && getComputedStyle(element).display !== 'none'
      && getComputedStyle(element).visibility !== 'hidden';
    const q = (selector) => document.querySelector(selector);
    const text = (selector) => (visible(q(selector)) ? q(selector).textContent.replace(/\s+/g, ' ').trim() : null);
    const debugValue = window.__eslDebug?.drinkStand;
    return {
      stand: Boolean(q(selectors.ui)),
      action: text(selectors.action),
      notice: text(selectors.notice),
      rush: text(selectors.rush),
      combo: text(selectors.combo),
      instruction: text(selectors.instruction),
      bubble: text('.npc-dialogue__line'),
      listen: visible(q('.listen-again')),
      fallback: [...document.querySelectorAll('.lesson-hud__fallback')].filter(visible)
        .map((button) => ({ text: button.getAttribute('aria-label') || button.textContent, value: button.dataset.value ?? null })),
      greeting: q('.greeting')?.textContent.trim() ?? null,
      prompt: visible(q('.interaction-prompt')),
      talkVisible: visible(q('.lesson-hud__talk')),
      talkState: q('.lesson-hud__talk')?.dataset.state ?? null,
      body: document.body.innerText,
      debug: debugValue ? JSON.parse(JSON.stringify(typeof debugValue === 'function' ? debugValue() : debugValue)) : null,
    };
  }, SEL);
  const tracedUi = async () => {
    const state = await ui();
    lastTrace = state?.debug ? {
      phase: state.debug.phase,
      progress: state.debug.progress,
      dwell: state.debug.dwell,
      question: state.debug.question,
      focusActive: state.debug.focusActive,
      serviceElapsed: state.debug.serviceElapsed,
      customers: state.debug.customers?.map((customer) => [
        customer.index, customer.state, customer.window, customer.asked, customer.served,
      ]),
    } : state;
    return state;
  };
  const waitFor = async (predicate, timeoutMs, labelText) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const state = await tracedUi();
      if (predicate(state)) return state;
      await sleep(100);
    }
    console.log(`  (timed out waiting for ${labelText})`);
    return null;
  };
  const hold = async (keys, ms) => {
    for (const key of keys) await page.keyboard.down(key);
    await sleep(ms);
    for (const key of [...keys].reverse()) await page.keyboard.up(key);
    await sleep(60);
  };
  await page.goto(URL, { waitUntil: 'networkidle' });
  await sleep(3200);
  return { context, page, sleep, ui: tracedUi, waitFor, hold };
}

async function enterStand(h) {
  await h.page.evaluate((selector) => {
    window.__rushSeen = false;
    window.__drinkDirectorTrace = { phases: [], queueWithAllBusy: false };
    const watch = () => {
      const element = document.querySelector(selector);
      if (element && !element.hidden && getComputedStyle(element).display !== 'none') window.__rushSeen = true;
      const raw = window.__eslDebug?.drinkStand;
      const debug = raw && (typeof raw === 'function' ? raw() : raw);
      if (debug) {
        if (debug.phase && !window.__drinkDirectorTrace.phases.includes(debug.phase)) {
          window.__drinkDirectorTrace.phases.push(debug.phase);
        }
        const atWindows = debug.customers?.filter((customer) => customer.state === 'atWindow').length ?? 0;
        const queued = debug.customers?.some((customer) => customer.state === 'queued');
        if (atWindows === debug.maxWindows && queued) window.__drinkDirectorTrace.queueWithAllBusy = true;
      }
      requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);
  }, SEL.rush);
  for (let index = 0; index < 40 && !(await h.ui()).prompt; index += 1) await h.hold(['KeyW'], 140);
  await h.page.keyboard.press('Space');
  const debug = await waitForDebug(h.page, 'drinkStand', Boolean, { timeoutMs: 7000, label: 'Drink Stand' });
  return debug ? h.ui() : null;
}

const activeWindows = (state) => state?.debug?.customers.filter((customer) => customer.state === 'atWindow') ?? [];
const waitingCustomer = (state) => activeWindows(state).find((customer) => !customer.asked && !customer.served) ?? null;
const clickAt = (page, point) => page.mouse.click(point.x, point.y);

async function openQuestion(h) {
  let state = await h.waitFor((value) => waitingCustomer(value), 25000, 'customer at a window');
  if (!state) return null;
  const customerIndex = waitingCustomer(state).index;
  const started = await clickUntil(
    h.page,
    async () => (await h.ui()).debug?.customers.find((entry) => entry.index === customerIndex)?.screen,
    async () => {
      const current = await h.ui();
      const autoTarget = current.debug?.autoTarget;
      return current.debug?.player?.autoWalking
        || current.debug?.dwell?.targetId === customerIndex
        || current.debug?.question?.customer === customerIndex
        || autoTarget?.target === customerIndex
        || autoTarget === customerIndex;
    },
    { attempts: 4, timeoutMs: 1600 },
  );
  if (!started) return null;
  const committed = await h.waitFor(
    (value) => value.debug?.question?.committed && value.debug.question.customer === customerIndex,
    9000,
    `question ${customerIndex} to commit after dwell`,
  );
  if (!committed) return null;
  const promptState = committed.fallback.length > 0
    ? committed
    : await h.waitFor((value) => value.fallback.length > 0, 4000, 'mic-free fallback');
  return promptState ? { customerIndex, promptState } : null;
}

// Diagnostic: which customer the open prompt belonged to, and where the avatar
// was walking, at the moment the answer was tapped.
let lastAcceptContext = null;
async function acceptQuestion(h, opened) {
  if (!opened) return null;
  const before = await h.ui();
  lastAcceptContext = {
    intended: opened.customerIndex,
    prompting: before.debug?.question?.customer ?? before.debug?.questionIndex ?? null,
    autoTarget: before.debug?.autoTarget ?? null,
    player: before.debug?.player ?? null,
  };
  await h.page.click('.lesson-hud__fallback');
  const answer = await h.waitFor((state) => state.bubble && /^I like .+\.$/.test(state.bubble), 7000, 'customer answer');
  const drink = answer?.bubble.match(/^I like (.+)\.$/)?.[1] ?? null;
  await h.waitFor((state) => state.fallback.length === 0, 5000, 'accepted prompt controls to clear');
  return { index: opened.customerIndex, bubble: answer?.bubble ?? null, drink: DRINKS.has(drink) ? drink : null };
}

async function askNext(h) {
  const opened = await openQuestion(h);
  return acceptQuestion(h, opened);
}

async function walkNearStation(h, drink) {
  for (let steps = 0; steps < 70; steps += 1) {
    const state = await h.ui();
    const station = state.debug?.stations.find((entry) => entry.id === drink);
    const player = state.debug?.player;
    if (!station || !player) return null;
    const dx = station.interaction.x - player.x;
    const dz = station.interaction.z - player.z;
    if (state.action && Math.hypot(dx, dz) < 1.55) return state;
    if (Math.abs(dx) > 0.55) await h.hold([dx > 0 ? 'KeyD' : 'KeyA'], 90);
    else if (Math.abs(dz) > 0.55) await h.hold([dz > 0 ? 'KeyS' : 'KeyW'], 90);
    else await h.sleep(100);
  }
  return null;
}

async function pointerHoldAction(h, durationMs) {
  const box = await h.page.locator(SEL.action).boundingBox();
  if (!box) return null;
  await h.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await h.page.mouse.down();
  await h.sleep(durationMs);
  await h.page.mouse.up();
  return h.waitFor((state) => !state.debug?.fillActive, 5000, 'dispenser to stop');
}

async function tapToFull(h) {
  const box = await h.page.locator(SEL.action).boundingBox();
  if (!box) return null;
  await holdUntil(h.page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, async () => {
    const state = await h.ui();
    return state.debug?.fillActive && state.debug?.cup.level > 0;
  }, { maxMs: 240 });
  return h.waitFor((state) => state.debug?.cup.level >= 1 && !state.debug.fillActive, 7000, 'latched full cup');
}

async function overflowCup(h, screenshotPath) {
  const box = await h.page.locator(SEL.action).boundingBox();
  if (!box) return null;
  const overflow = await holdUntil(
    h.page,
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    async () => {
      const state = await h.ui();
      return state.debug?.overflowActive ? state : null;
    },
    { maxMs: 3000 },
  );
  if (overflow) await h.page.screenshot({ path: screenshotPath });
  return h.waitFor((state) => !state.debug?.fillActive, 3000, 'overflow hold release');
}

async function pourByCanvas(h, drink) {
  const state = await h.ui();
  const station = state.debug.stations.find((entry) => entry.id === drink);
  await clickAt(h.page, station.screen);
  return h.waitFor((value) => value.debug?.cup.drink === drink
    && value.debug.cup.servable
    && !value.debug.fillActive, 10000, `fill ${drink}`);
}

async function serve(h, index) {
  const state = await h.ui();
  const customer = state.debug.customers.find((entry) => entry.index === index);
  if (!customer || customer.served) return null;
  await clickAt(h.page, customer.screen);
  return h.waitFor((value) => value.debug?.cup.drink == null, 9000, 'serve cup');
}

const WINDOW_APPROACHES = Object.freeze([
  { x: -5.8, z: -2.35 },
  { x: -1.65, z: -2.35 },
  { x: 2.5, z: -2.35 },
]);

async function runPastWindows(h) {
  let prompted = false;
  let minimumDistance = Infinity;
  const observe = async () => {
    const state = await h.ui();
    prompted ||= state.talkVisible || state.debug?.focusActive || state.fallback.length > 0;
    for (const customer of activeWindows(state)) {
      const point = WINDOW_APPROACHES[customer.window];
      if (point) minimumDistance = Math.min(
        minimumDistance,
        Math.hypot(state.debug.player.x - point.x, state.debug.player.z - point.z),
      );
    }
    return state;
  };

  // Stage outside the talk radii, then hand movement directly from W to A to
  // S. There is no stationary frame beside a customer between those legs.
  await holdUntil(h.page, 'KeyD', async () => {
    const state = await observe();
    return state.debug?.player?.x >= 3.7 ? state : null;
  }, { maxMs: 5000 });

  let held = 'KeyW';
  await h.page.keyboard.down(held);
  const moveUntil = async (predicate, maxMs) => {
    const deadline = Date.now() + maxMs;
    while (Date.now() < deadline) {
      const state = await observe();
      if (predicate(state)) return state;
      await h.sleep(40);
    }
    return null;
  };
  try {
    await moveUntil((state) => state.debug?.player?.z <= -2.2, 5000);
    await h.page.keyboard.down('KeyA');
    await h.page.keyboard.up(held);
    held = 'KeyA';
    await moveUntil((state) => state.debug?.player?.x <= -5.75, 10000);
    await h.page.keyboard.down('KeyS');
    await h.page.keyboard.up(held);
    held = 'KeyS';
    await moveUntil((state) => state.debug?.player?.z >= 0, 5000);
  } finally {
    await h.page.keyboard.up(held);
  }
  await h.sleep(60);
  return { prompted, minimumDistance };
}

async function clickAndWaitForArrival(h, customerIndex) {
  const started = await clickUntil(
    h.page,
    async () => (await h.ui()).debug?.customers.find((customer) => customer.index === customerIndex)?.screen,
    async () => {
      const state = await h.ui();
      const autoTarget = state.debug?.autoTarget;
      return state.debug?.player?.autoWalking
        || state.debug?.dwell?.targetId === customerIndex
        || state.debug?.question?.customer === customerIndex
        || autoTarget?.target === customerIndex
        || autoTarget === customerIndex;
    },
    { attempts: 3, timeoutMs: 1600 },
  );
  if (!started) return { arrived: null, arrivedAt: 0 };
  const arrived = await h.waitFor(
    (state) => !state.debug?.player?.autoWalking
      && (state.debug?.dwell?.targetId === customerIndex || state.debug?.question?.customer === customerIndex),
    7000,
    `arrival at customer ${customerIndex}`,
  );
  return { arrived, arrivedAt: await h.page.evaluate(() => performance.now()) };
}

// Dwell and microphone behavior. This probe is independent of scoring sessions.
if (sectionEnabled('mic')) {
  const h = await openPage('mic', 3, 0xd0e11a11, { micFree: false, mockSpeech: true });
  let state = await enterStand(h);
  const mockInstalled = await h.page.evaluate(() => Boolean(window.__mockSpeech));
  check('mic probe enters Drink Stand with the speech mock installed', state?.stand && mockInstalled);

  state = await h.waitFor((value) => activeWindows(value).some((customer) => !customer.asked),
    15000, 'customer for walking-past probe');
  const pass = state ? await runPastWindows(h) : null;
  check('walking along the windows passes through a customer talk radius',
    pass?.minimumDistance < 2.15, JSON.stringify(pass), Boolean(state));
  check('walking along the windows without stopping opens no prompt',
    pass && !pass.prompted, JSON.stringify(pass), Boolean(state));

  state = await h.ui();
  const correctCustomer = waitingCustomer(state);
  if (!correctCustomer) {
    check('an unasked customer is available for the correct-speech probe', false, '', true, state?.debug);
  } else {
    await h.page.evaluate(() => window.__mockSpeech.queueTranscript('What drink do you like?'));
    const startsBeforeCorrect = await h.page.evaluate(() => window.__mockSpeech.starts);
    const arrival = await clickAndWaitForArrival(h, correctCustomer.index);
    const committedPromise = waitForDebug(
      h.page,
      'drinkStand',
      (debug) => debug?.question?.committed && debug.question.customer === correctCustomer.index,
      { timeoutMs: 9000, label: 'correct-speech conversation to commit after dwell' },
    );
    await h.sleep(600);
    const startsDuringDwell = await h.page.evaluate(() => window.__mockSpeech.starts);
    check('click-to-walk arrival does not listen before the dwell completes',
      Boolean(arrival.arrived) && startsDuringDwell === startsBeforeCorrect,
      JSON.stringify({ startsBeforeCorrect, startsDuringDwell, arrived: Boolean(arrival.arrived) }),
      Boolean(arrival.arrived));
    const committed = await committedPromise;
    const accepted = await h.waitFor(
      (value) => value.debug?.customers.find((customer) => customer.index === correctCustomer.index)?.asked,
      5000,
      'mocked correct question to be accepted',
    );
    const afterCorrect = await h.page.evaluate(() => window.__mockSpeech.getCounters());
    check('a scripted correct question is accepted after the dwell',
      Boolean(committed) && Boolean(accepted) && afterCorrect.starts === startsBeforeCorrect + 1
        && afterCorrect.lastStartAt - arrival.arrivedAt >= 700,
      JSON.stringify({ committed: Boolean(committed), accepted: Boolean(accepted), afterCorrect, arrival }));

    await h.waitFor((value) => !value.bubble && !value.debug?.focusActive && value.fallback.length === 0,
      9000, 'accepted speech to clear before the silence probe');
    state = await h.waitFor((value) => activeWindows(value).some((customer) => !customer.asked),
      15000, 'unasked customer for silence probe');
    const silenceCustomer = waitingCustomer(state);
    if (!silenceCustomer) {
      check('a second customer is available for the silence probe', false, '', true, state?.debug);
    } else {
      await h.page.evaluate(() => window.__mockSpeech.queueSilence());
      const startsBeforeSilence = await h.page.evaluate(() => window.__mockSpeech.starts);
      await clickAndWaitForArrival(h, silenceCustomer.index);
      const silenceCommitted = await waitForDebug(
        h.page,
        'drinkStand',
        (debug) => debug?.question?.committed && debug.question.customer === silenceCustomer.index,
        { timeoutMs: 9000, label: 'silence conversation to commit after dwell' },
      );
      const tryAgain = await h.waitFor((value) => value.talkState === 'try-again',
        5000, 'speech silence to end in try-again');
      const startsAfterSilence = await h.page.evaluate(() => window.__mockSpeech.starts);
      await h.sleep(2600);
      const standing = await h.ui();
      const startsAfterStanding = await h.page.evaluate(() => window.__mockSpeech.starts);
      const automaticSessionRan = startsAfterSilence === startsBeforeSilence + 1;
      const trace = {
        startsBeforeSilence,
        startsAfterSilence,
        startsAfterStanding,
        dwell: standing.debug?.dwell,
        question: standing.debug?.question,
        talkState: standing.talkState,
      };
      check('scripted silence ends in try-again',
        Boolean(silenceCommitted) && Boolean(tryAgain) && automaticSessionRan,
        JSON.stringify(trace));
      check('the microphone does not auto-reopen while standing still after silence',
        startsAfterStanding === startsAfterSilence,
        JSON.stringify(trace), automaticSessionRan);
    }
  }
  await h.context.close();
}

// Session A: level 3 listening route and visual/mechanical acceptance.
if (sectionEnabled('listening')) {
  const h = await openPage('A', 3, 0x5eed1234);
  let state = await enterStand(h);
  check('hub -> Drink Stand', state?.stand);
  await h.sleep(900);
  state = await h.ui();
  check('level 3 uses 7 customers and at most 3 windows',
    state.debug?.configuredCount === 7 && state.debug?.maxWindows === 3,
    JSON.stringify({ count: state.debug?.configuredCount, max: state.debug?.maxWindows }));
  check('level 3 reports initial progress and director state',
    state.debug?.progress?.done === 0 && state.debug?.progress?.total === 7
      && ['warmup', 'main'].includes(state.debug?.phase),
    JSON.stringify({ progress: state.debug?.progress, phase: state.debug?.phase }));
  check('dwell and question state are present from the start',
    Boolean(state.debug?.dwell) && Boolean(state.debug?.question),
    JSON.stringify({ dwell: state.debug?.dwell, question: state.debug?.question }));
  check('debug exposes six shuffled stations without wanted drinks',
    state.debug?.stations.length === 6 && !JSON.stringify(state.debug).match(/want|order|favou?rite/i));
  check('the avatar starts empty-handed', state.debug?.cup.drink == null && state.debug?.cup.level === 0);
  await h.page.screenshot({ path: `${OUT}-01-all-stations.png` });

  state = await h.waitFor((value) => activeWindows(value).length >= 1
    && value.debug.phase !== 'rush', 12000, 'first pre-rush window');

  const opened = await openQuestion(h);
  check('question offered: "What drink do you like?"',
    /what drink do you like/i.test(opened?.promptState.fallback[0]?.text ?? ''), opened?.promptState.fallback[0]?.text);
  await h.sleep(450);
  const frozenBefore = await h.ui();
  await h.sleep(1600);
  const frozenAfter = await h.ui();
  const patienceBefore = activeWindows(frozenBefore).map((customer) => [customer.index, customer.patience]);
  const patienceAfter = new Map(activeWindows(frozenAfter).map((customer) => [customer.index, customer.patience]));
  const allPatienceFrozen = patienceBefore.length >= 1
    && patienceBefore.every(([index, value]) => Math.abs((patienceAfter.get(index) ?? -999) - value) < 0.001);
  const stateBefore = frozenBefore.debug.customers.map((customer) => `${customer.index}:${customer.state}:${customer.window}`).join('|');
  const stateAfter = frozenAfter.debug.customers.map((customer) => `${customer.index}:${customer.state}:${customer.window}`).join('|');
  check('speech focus is active with the fallback open', frozenBefore.debug.focusActive && frozenBefore.debug.focusScale === 0);
  check('active-window patience is frozen during pre-rush speech focus', allPatienceFrozen,
    JSON.stringify({ before: patienceBefore, after: [...patienceAfter] }));
  check('speech focus freezes arrivals, queue promotion, service time, and rush',
    stateBefore === stateAfter
      && Math.abs(frozenAfter.debug.serviceElapsed - frozenBefore.debug.serviceElapsed) < 0.001
      && frozenAfter.debug.rushShown === frozenBefore.debug.rushShown,
    JSON.stringify({ serviceBefore: frozenBefore.debug.serviceElapsed, serviceAfter: frozenAfter.debug.serviceElapsed }));

  await h.page.keyboard.down('Space');
  const first = await acceptQuestion(h, opened);
  await h.page.keyboard.up('Space');
  await h.sleep(250);
  state = await h.ui();
  check('releasing Space after speech does not start a dispenser',
    state.debug?.cup.drink == null && !state.debug?.fillActive);
  check('customer answers with an exact vocabulary sentence', first?.drink, first?.bubble);
  await h.page.screenshot({ path: `${OUT}-03-answer.png` });
  await h.waitFor((value) => !value.bubble, 8000, 'answer bubble to clear');
  state = await h.ui();
  check('the answer is not left on screen', !/I like/.test(state.body));
  check('Listen Again is offered at the asked customer', state.listen);

  state = await h.waitFor((value) => Boolean(value.rush), 15000, 'rush banner');
  check('RUSH banner appears only after protected focus ends', Boolean(state?.rush));
  if (state?.rush) await h.page.screenshot({ path: `${OUT}-04-rush.png` });

  const rushQueue = await h.waitFor((value) => value.debug?.phase === 'rush'
    && activeWindows(value).length === 3
    && value.debug.customers.some((customer) => customer.state === 'queued'),
  15000, 'a visible level-3 rush queue');
  check('the level-3 rush queues a customer while all three windows are busy', Boolean(rushQueue),
    JSON.stringify({
      phase: rushQueue?.debug?.phase,
      windows: activeWindows(rushQueue).length,
      states: rushQueue?.debug?.customers.map((customer) => customer.state),
    }));

  state = await h.waitFor((value) => activeWindows(value).length >= 2, 12000, 'multiple active windows');
  const secondOpened = await openQuestion(h);
  await h.sleep(450);
  const multiBefore = await h.ui();
  await h.sleep(900);
  const multiAfter = await h.ui();
  const multiPatience = new Map(activeWindows(multiAfter).map((customer) => [customer.index, customer.patience]));
  const everyWindowFrozen = activeWindows(multiBefore).length >= 2
    && activeWindows(multiBefore).every((customer) => Math.abs(
      (multiPatience.get(customer.index) ?? -999) - customer.patience,
    ) < 0.001);
  const multiStateBefore = multiBefore.debug.customers.map((customer) => `${customer.index}:${customer.state}:${customer.window}`).join('|');
  const multiStateAfter = multiAfter.debug.customers.map((customer) => `${customer.index}:${customer.state}:${customer.window}`).join('|');
  check('every window freezes together while another customer is speaking',
    everyWindowFrozen && multiStateBefore === multiStateAfter,
    JSON.stringify(activeWindows(multiBefore).map((customer) => [customer.index, customer.patience])));
  await h.page.screenshot({ path: `${OUT}-02-multiple-windows.png` });
  const second = await acceptQuestion(h, secondOpened);
  await h.waitFor((value) => !value.bubble, 8000, 'second answer bubble to clear');
  await h.page.click('.listen-again');
  const replay = await h.waitFor((value) => value.bubble && /I like/.test(value.bubble), 3000, 'replayed answer');
  check('Listen Again replays the exact answer', replay?.bubble === second?.bubble, replay?.bubble);
  await h.waitFor((value) => !value.bubble, 8000, 'replayed bubble to clear');

  const near = await walkNearStation(h, first.drink);
  check('keyboard walking reaches the requested station hold control', Boolean(near?.action), near?.action);
  const partial = await pointerHoldAction(h, 300);
  check('a real hold stops at a visible partial level',
    partial?.debug.cup.level > 0 && partial.debug.cup.level < 0.35 && !partial.debug.cup.servable,
    JSON.stringify(partial?.debug.cup));
  const stoppedLevel = partial?.debug.cup.level ?? 0;
  await h.sleep(450);
  state = await h.ui();
  check('released partial fill stays stopped and offers top-up',
    Math.abs(state.debug.cup.level - stoppedLevel) < 0.001
      && /もう すこし/.test(`${state.instruction} ${state.notice}`));
  await h.page.screenshot({ path: `${OUT}-05-part-filled.png` });

  let topped = await pointerHoldAction(h, 300);
  check('the same station tops up without changing drinks',
    topped?.debug.cup.drink === first.drink && topped.debug.cup.level > stoppedLevel,
    JSON.stringify(topped?.debug.cup));
  // Fill per wall-clock second depends on frame rate under software GL, so keep
  // topping up in short real holds instead of assuming one hold crosses the line.
  for (let extra = 0; extra < 6 && topped?.debug.cup.drink === first.drink && !topped.debug.cup.servable; extra += 1) {
    topped = await pointerHoldAction(h, 220);
  }
  check('topping up at the same station reaches a valid drink',
    topped?.debug.cup.drink === first.drink && topped.debug.cup.servable,
    JSON.stringify(topped?.debug.cup));
  const full = await tapToFull(h);
  check('a short on-screen tap latches to a full valid cup',
    full?.debug.cup.drink === first.drink && full.debug.cup.level === 1 && full.debug.cup.servable,
    JSON.stringify(full?.debug.cup));
  await h.page.screenshot({ path: `${OUT}-06-full.png` });

  const overfilled = await overflowCup(h, `${OUT}-07-overflow.png`);
  check('overflow is playful feedback and the drink remains valid',
    overfilled?.debug.cup.overflowed && overfilled.debug.cup.servable,
    JSON.stringify(overfilled?.debug.cup));
  const queuedBeforeServe = (await h.ui()).debug.customers.find(
    (customer) => customer.state === 'queued',
  );
  const servedFirst = await serve(h, first.index);
  check('an overfilled correct drink serves successfully',
    servedFirst?.debug.customers.find((customer) => customer.index === first.index)?.served === true);
  check('resolved-customer progress advances after a successful serve',
    servedFirst?.debug.progress?.done >= 1 && servedFirst.debug.progress.total === 7,
    JSON.stringify(servedFirst?.debug.progress));
  const refill = queuedBeforeServe ? await h.waitFor(
    (value) => value.debug?.customers.find((customer) => customer.index === queuedBeforeServe.index)?.state === 'atWindow',
    7000,
    'freed window to refill from the line',
  ) : null;
  check('a freed window refills promptly from the line', Boolean(refill),
    JSON.stringify({ queued: queuedBeforeServe?.index, states: refill?.debug?.customers.map((customer) => [customer.index, customer.state]) }),
    Boolean(queuedBeforeServe));

  const secondPoured = await pourByCanvas(h, second.drink);
  const servedSecond = secondPoured ? await serve(h, second.index) : null;
  const combo = await h.waitFor((value) => Boolean(value.combo), 1500, 'combo pop');
  check('combo appears after consecutive first-try serves', Boolean(combo?.combo), combo?.combo);
  if (combo?.combo) await h.page.screenshot({ path: `${OUT}-08-combo.png` });

  let served = servedFirst && servedSecond ? 2 : servedFirst || servedSecond ? 1 : 0;
  const total = state.debug.configuredCount;
  for (let customerNumber = 2; customerNumber < total; customerNumber += 1) {
    const question = await askNext(h);
    if (!question?.drink) {
      // Record why instead of crashing on a missing drink: the evidence decides
      // whether the harness or the game is at fault.
      const snapshot = await h.ui();
      await h.page.screenshot({ path: `${OUT}-A-missing-answer.png` });
      check(`customer ${customerNumber + 1} answers before pouring`, false, JSON.stringify({
        question,
        bubble: snapshot.bubble,
        fallback: snapshot.fallback.length,
        focus: snapshot.debug?.focusActive,
        lastAccept: lastAcceptContext,
        customers: snapshot.debug?.customers.map((customer) => [customer.index, customer.state, customer.asked, customer.served]),
      }));
      break;
    }
    await pourByCanvas(h, question.drink);
    const afterServe = await serve(h, question.index);
    if (afterServe?.debug.customers.find((customer) => customer.index === question.index)?.served) served += 1;
    const live = await h.ui();
    check(`window limit respected after serve ${customerNumber + 1}`,
      activeWindows(live).length <= live.debug.maxWindows);
  }
  check('all level-3 customers served by the listening route', served === total, `${served}/${total}`);
  check('RUSH was observed', await h.page.evaluate(() => window.__rushSeen === true));
  const directorTrace = await h.page.evaluate(() => window.__drinkDirectorTrace);
  check('director phases progress in warm-up -> main -> rush order',
    ['warmup', 'main', 'rush'].every((phase) => directorTrace.phases.includes(phase))
      && directorTrace.phases.indexOf('warmup') < directorTrace.phases.indexOf('main')
      && directorTrace.phases.indexOf('main') < directorTrace.phases.indexOf('rush'),
    JSON.stringify(directorTrace));
  check('director trace observes a queued customer with every window busy', directorTrace.queueWithAllBusy,
    JSON.stringify(directorTrace));

  state = await h.waitFor((value) => value.fallback.length === 6, 15000, 'turnaround');
  check('turnaround offers all six drinks under speech focus',
    state?.fallback.length === 6 && state.debug?.focusActive && state.fallback.some((choice) => choice.value === 'tea'));
  if (state) await h.page.screenshot({ path: `${OUT}-09-turnaround.png` });
  await h.page.click('.lesson-hud__fallback[data-value="tea"]');
  state = await h.waitFor((value) => !value.stand && value.greeting !== null, 15000, 'return to hub');
  check('finishes back at the hub', Boolean(state));
  const saved = await h.page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '{}'), SAVE_KEY);
  check('stamp and turnaround answer persisted',
    saved?.stamps?.['drink-stand'] === true && saved?.answers?.drink === 'tea');
  check('listening route with one replay earns 3 stars', saved?.bestStars?.['drink-stand'] === 3,
    JSON.stringify(saved?.bestStars));
  await h.context.close();
}

// Session B: level 1 fixed-order guessing route.
if (sectionEnabled('guessing')) {
  const h = await openPage('B', 1, 0x1234abcd);
  let state = await enterStand(h);
  check('level 1 uses 5 customers and at most 1 window',
    state?.debug.configuredCount === 5 && state.debug.maxWindows === 1);
  let wrongDeclined = null;
  const total = state.debug.configuredCount;
  for (let index = 0; index < total; index += 1) {
    const question = await askNext(h);
    if (!question) break;
    const fixedOrder = (await h.ui()).debug.stations.map((station) => station.id);
    for (const drink of fixedOrder) {
      await pourByCanvas(h, drink);
      await serve(h, question.index);
      state = await h.ui();
      const customer = state.debug.customers.find((entry) => entry.index === question.index);
      if (customer.served) break;
      if (wrongDeclined === null) wrongDeclined = { bubble: state.bubble, english: /I like/.test(state.body) };
    }
  }
  check('a wrong drink is declined without repeating English',
    wrongDeclined && !wrongDeclined.english, JSON.stringify(wrongDeclined));
  state = await h.waitFor((value) => value.fallback.length === 6, 15000, 'guessing turnaround');
  if (state) await h.page.click('.lesson-hud__fallback');
  await h.waitFor((value) => !value.stand, 15000, 'guessing route hub return');
  const saved = await h.page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '{}'), SAVE_KEY);
  const stars = saved?.bestStars?.['drink-stand'] ?? null;
  check('guessing route still finishes and earns the stamp', saved?.stamps?.['drink-stand'] === true);
  check('anti-shortcut fixed-order guessing cannot reach 3 stars', stars !== null && stars < 3,
    JSON.stringify(saved?.bestStars));
  await h.context.close();
}

// Configuration/behavior spot-check for level 2.
if (sectionEnabled('level2')) {
  const h = await openPage('C', 2, 0xcafef00d);
  let state = await enterStand(h);
  check('level 2 uses 6 customers and at most 2 windows',
    state?.debug.configuredCount === 6 && state.debug.maxWindows === 2
      && state.debug.progress?.total === 6);
  state = await h.waitFor((value) => activeWindows(value).length === 2, 18000, 'two level-2 windows');
  check('level 2 reaches two simultaneous windows and never a third',
    activeWindows(state).length === 2 && activeWindows(state).length <= state.debug.maxWindows);
  await h.context.close();
}

check('no console or page errors', errors.length === 0, errors.slice(0, 3).join(' || '));
const failed = results.filter((result) => !result.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
await browser.close();
process.exitCode = failed > 0 ? 1 : 0;
