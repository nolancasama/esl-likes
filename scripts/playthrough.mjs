// Scripted Restaurant rush-hour playthrough.
// Run after building and starting the preview server:
//   node scripts/playthrough.mjs http://localhost:5199/ .tmp/restaurant pizza
//
// A short mock-mic probe checks dwell behavior. Session A then remembers every
// person-food pair and delivers correctly through the mic-free fallback;
// Session B ignores the answers and deliberately loses first-try credit.
// Separate contexts keep best-stars state from leaking between sessions.
import { chromium } from 'playwright';
import { LESSON_BY_ID } from '../src/config/lesson.js';
import { FIRST_TRY_SHARE_CAP, scoreSession } from '../src/minigames/restaurant/scoring.js';
import { createMockSpeechInitScript } from './lib/mockSpeech.mjs';

// The spoken sentence is not the vocabulary id: "hamburger" is answered as
// "I like hamburgers." Derive the mapping from the real config so this harness
// keeps agreeing with the game if the vocabulary ever changes.
const FOOD_BY_SENTENCE = new Map(
  LESSON_BY_ID.restaurant.vocabulary.map(({ id, answer }) => [
    answer.match(/^I like (.+)\.$/)[1].toLowerCase(),
    id,
  ]),
);

const URL = process.argv[2] || 'http://localhost:5199/';
const OUT = process.argv[3] || '.tmp/restaurant';
const CHOICE = process.argv[4] || 'pizza';
const LEVEL = 2; // At least two live orders, to exercise concurrent dishes.
const SHIFT_TOTAL = 7;
const SAVE_KEY = 'esl-likes-save-v1';
const SEL = {
  ui: '.restaurant-ui',
  action: '.restaurant-ui__action',
  notice: '.restaurant-ui__notice',
  combo: '.restaurant-ui__combo',
};

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

async function newContext({ micFree = true, mockSpeech = false, difficulty = LEVEL } = {}) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  if (mockSpeech) await context.addInitScript(createMockSpeechInitScript());
  await context.addInitScript(([key, level, useMicFree]) => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem(key, JSON.stringify({
        version: 1,
        settings: { micFree: useMicFree, difficulty: level },
      }));
      sessionStorage.setItem('seeded', '1');
    }
  }, [SAVE_KEY, difficulty, micFree]);
  return context;
}

const results = [];
const errors = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  - ${detail}` : ''}`);
};
const precondition = (name, value, detail = '') => {
  const ok = Boolean(value);
  results.push({ name, ok, classification: ok ? 'PASS' : 'HARNESS_PRECONDITION_FAILED' });
  console.log(`${ok ? 'PASS' : 'HARNESS_PRECONDITION_FAILED'}  ${name}${detail ? `  - ${detail}` : ''}`);
  return ok;
};

async function openPage(label, options = {}) {
  const page = await (await newContext(options)).newPage();
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
    const text = (selector) => (visible(q(selector))
      ? q(selector).textContent.replace(/\s+/g, ' ').trim()
      : null);
    const rawDebug = window.__eslDebug?.restaurant;
    const debug = rawDebug
      ? JSON.parse(JSON.stringify(typeof rawDebug === 'function' ? rawDebug() : rawDebug))
      : null;
    return {
      restaurant: Boolean(q(selectors.ui)),
      prompt: visible(q('.interaction-prompt')),
      talkVisible: visible(q('.lesson-hud__talk')),
      talkState: q('.lesson-hud__talk')?.dataset.state ?? null,
      action: text(selectors.action),
      notice: text(selectors.notice),
      combo: text(selectors.combo),
      score: text('.restaurant-ui__score'),
      phasePill: text('.restaurant-ui__phase'),
      instruction: q('.restaurant-ui .scene-card p')?.textContent.trim() ?? null,
      bubble: text('.npc-dialogue__line'),
      listen: visible(q('.listen-again')),
      fallback: [...document.querySelectorAll('.lesson-hud__fallback')]
        .filter(visible)
        .map((button) => ({
          text: button.getAttribute('aria-label') || button.textContent.replace(/\s+/g, ' ').trim(),
          value: button.dataset.value ?? null,
        })),
      greeting: q('.greeting')?.textContent.trim() ?? null,
      body: document.body.innerText,
      debug,
    };
  }, SEL);
  const waitFor = async (predicate, ms, labelText) => {
    const end = Date.now() + ms;
    let last = null;
    while (Date.now() < end) {
      last = await ui();
      if (predicate(last)) return last;
      await sleep(120);
    }
    console.log(`  (timed out waiting for ${labelText})`);
    return null;
  };
  const hold = async (keys, ms) => {
    for (const key of keys) await page.keyboard.down(key);
    await sleep(ms);
    for (const key of keys) await page.keyboard.up(key);
    await sleep(80);
  };
  await page.goto(URL, { waitUntil: 'networkidle' });
  await sleep(3200);
  return { page, sleep, ui, waitFor, hold };
}

async function enterRestaurant(h) {
  // Restaurant is the left-hand hub door. The established keyboard route is
  // used only in the hub; Restaurant interactions use debug click points.
  await h.hold(['KeyW', 'KeyA'], 2500);
  let s = await h.ui();
  for (let pulse = 0; pulse < 12 && !s.prompt; pulse += 1) {
    await h.hold(['KeyW', 'KeyA'], 140);
    s = await h.ui();
  }
  if (s.prompt) await h.page.keyboard.press('Space');
  return h.waitFor((state) => state.restaurant && state.debug, 8000, 'Restaurant');
}

const clickAt = (page, point) => page.mouse.click(point.x, point.y);
const customerAt = (state, index) => state?.debug?.customers.find((customer) => customer.index === index);
const serviceLifecycle = (state) => state?.debug?.lifecycle ?? state?.debug?.gamePhase ?? state?.debug?.phase;
const isInService = (state) => {
  const phase = serviceLifecycle(state);
  return !['round-end', 'turnaround', 'finishing'].includes(phase) && Boolean(state?.debug);
};
const directorPhase = (state) => state?.debug?.directorPhase
  ?? state?.debug?.servicePhase
  ?? (['warmup', 'rush', 'finalPush'].includes(state?.debug?.phase) ? state.debug.phase : null);
const progressOf = (state) => state?.debug?.progress ?? {
  done: state?.debug?.customers?.filter((customer) => ['delivered', 'left'].includes(customer.state)).length ?? 0,
  total: state?.debug?.customers?.length ?? 0,
};
const tableOf = (customer) => customer?.table?.index ?? customer?.table;
const patienceSnapshot = (state) => state.debug.customers.map((customer) => ({
  index: customer.index,
  patience: customer.patience,
}));
const samePatience = (before, after) => before.every((value) => {
  const current = after.find((candidate) => candidate.index === value.index);
  return current && (value.patience == null || Math.abs(current.patience - value.patience) < 0.001);
});
const customerOwner = (customer) => customer?.owner ?? null;
const customerReservation = (customer) => customer?.reservation ?? customer?.reservedBy ?? null;
const playerOrders = (state) => state?.debug?.customers.filter((customer) => {
  if (['delivered', 'eating', 'leaving', 'left', 'resolved'].includes(customer.state)) return false;
  return customerOwner(customer) === 'player'
    || (customerOwner(customer) === null && ['awaiting', 'preparing'].includes(customer.state));
}) ?? [];
const rivalIsWalking = (state) => ['walkingToCustomer', 'walkingToPass', 'delivering']
  .includes(state?.debug?.rival?.state);
const playerDeliveryCustomer = (state, remembered) => {
  const carried = state?.debug?.carried;
  if (!carried) return null;
  return state.debug.customers.find((customer) => customerOwner(customer) === 'player'
    && customer.state === 'awaiting'
    && ((customer.id ?? customer.index) === carried.customer
      || remembered.get(customer.index) === carried.food)) ?? null;
};

async function waitForShiftState(h, predicate, label, ms = 120000) {
  const end = Date.now() + ms;
  let state = await h.ui();
  while (Date.now() < end && state?.debug) {
    if (predicate(state) || !isInService(state)) return state;
    await h.sleep(120);
    state = await h.ui();
  }
  console.log(`  (timed out waiting for ${label})`);
  return null;
}

async function approachCustomer(h, index, predicate, label) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const s = await h.ui();
    const customer = customerAt(s, index);
    if (!customer?.screen || customerOwner(customer) === 'rival') return null;
    await clickAt(h.page, customer.screen);
    // Click-to-walk may cross the room before the real-time 1.2 s dwell even
    // begins. Do not re-click during that dwell: doing so deliberately cancels
    // and retargets the conversation.
    const reached = await h.waitFor(predicate, 6000, label);
    if (reached) return reached;
  }
  return null;
}

async function askCustomer(h, index, { checkFreeze = false, checkRivalFreeze = false, remember = true } = {}) {
  const prompt = await approachCustomer(
    h,
    index,
    (state) => state.fallback.length > 0,
    `question prompt for customer ${index}`,
  );
  if (!prompt) {
    const missing = await h.ui();
    // On Challenge the rival may legitimately reach an unclaimed customer first.
    if (customerOwner(customerAt(missing, index)) === 'rival') {
      console.log(`  (the rival claimed customer ${index} first)`);
      return null;
    }
    check(`question prompt for customer ${index} appears`, false,
      JSON.stringify({ customer: customerAt(missing, index), debug: missing.debug }));
    await h.page.screenshot({ path: `${OUT}-missing-question-${index}.png` });
    return null;
  }

  if (checkFreeze) {
    // Let the short focus-enter ramp reach zero before measuring. Every meter
    // must remain still for the rest of the protected interaction.
    await h.sleep(350);
    const focused = await h.ui();
    const before = patienceSnapshot(focused);
    await h.sleep(1800);
    const afterState = await h.ui();
    const after = patienceSnapshot(afterState);
    check('speech focus is active for the mic-free prompt', focused.debug.focusActive && afterState.debug.focusActive);
    check('all customer patience is frozen while the prompt is open', samePatience(before, after),
      JSON.stringify({ before, after }));
  }

  if (checkRivalFreeze) {
    // Only a moving rival makes this meaningful. Whether it is still walking when
    // the prompt opens depends on route timing; rival.test.mjs covers zero dt.
    if (rivalIsWalking(prompt)) {
      const before = prompt.debug.rival;
      await h.sleep(1400);
      const after = (await h.ui()).debug?.rival;
      const positionStill = Math.hypot(
        (after?.position?.x ?? Infinity) - before.position.x,
        (after?.position?.z ?? Infinity) - before.position.z,
      ) < 0.001;
      check('speech focus freezes rival state, target, position and carried food',
        after?.state === before.state
          && after?.targetCustomer === before.targetCustomer
          && after?.carryingFood === before.carryingFood
          && positionStill,
      JSON.stringify({ before, after }));
    } else {
      console.log(`  (rival not mid-walk when customer ${index} prompt opened; freeze not sampled here)`);
    }
  }

  const answerButton = prompt.fallback[0];
  if (!answerButton) {
    check(`customer ${index} has a fallback answer`, false, JSON.stringify(prompt));
    return null;
  }
  await h.page.click('.lesson-hud__fallback');
  const answer = await h.waitFor(
    (state) => customerAt(state, index)?.state === 'awaiting'
      && state.bubble
      && /^I like .+\.$/.test(state.bubble),
    7000,
    `answer from customer ${index}`,
  );
  if (!answer) {
    const missing = await h.ui();
    check(`customer ${index} answer produces an awaiting transition`, false,
      JSON.stringify({ customer: customerAt(missing, index), debug: missing.debug }));
    await h.page.screenshot({ path: `${OUT}-missing-answer-${index}.png` });
    return null;
  }
  // The accepted prompt's fallback buttons stay visible through a short speech
  // cooldown. Wait for them to clear, or the next approachCustomer() mistakes
  // this stale prompt for the next customer's and taps a dead button.
  await h.waitFor((state) => state.fallback.length === 0, 3000, 'accepted prompt to clear');
  const spoken = answer?.bubble.match(/^I like (.+)\.$/)?.[1]?.toLowerCase() ?? null;
  const food = spoken === null ? null : (FOOD_BY_SENTENCE.get(spoken) ?? spoken);
  if (remember) {
    check(`customer ${index} gives an English food answer`, food, answer?.bubble);
    check(`customer ${index} answer agrees with the order`, food === customerAt(answer, index)?.food,
      JSON.stringify({ heard: food, debug: customerAt(answer, index)?.food }));
  }
  return { index, food, bubble: answer?.bubble ?? null };
}

async function askShowingCues(h, remembered, options = {}) {
  let asked = 0;
  for (;;) {
    let s = await h.ui();
    if (!s.debug?.customers.some((candidate) => candidate.cueShowing)
      && asked < (options.minimum ?? 0)) {
      // Warm-up caps demand at two until 18 s of SERVICE time, and speech focus
      // freezes that clock while asking, so the third hand can take a while.
      s = await h.waitFor(
        (state) => state.debug?.customers.some((candidate) => candidate.cueShowing),
        40000,
        'next order cue',
      );
      if (!s) return asked;
    }
    const customer = s.debug?.customers.find((candidate) => candidate.cueShowing);
    if (!customer) return asked;
    const answer = await askCustomer(h, customer.index, {
      checkFreeze: Boolean(options.checkFreeze && asked === 0),
      remember: options.remember !== false,
    });
    if (!answer) return asked;
    if (remembered) remembered.set(answer.index, answer.food);
    asked += 1;
  }
}

async function collectDish(h, dish) {
  for (let attempt = 0; attempt < 28; attempt += 1) {
    const s = await h.ui();
    if (s.debug?.carried) return s;
    const current = s.debug?.readyDishes.find((candidate) => candidate.slot === dish.slot)
      ?? s.debug?.readyDishes.find((candidate) => candidate.food === dish.food);
    if (!current?.screen) return null;
    await clickAt(h.page, current.screen);
    const nearby = await h.waitFor((state) => state.debug?.carried || state.action, 900, 'dish pickup');
    if (nearby?.debug?.carried) return nearby;
    if (nearby?.action) await h.page.keyboard.press('Space');
    const collected = await h.waitFor((state) => state.debug?.carried, 1200, 'carried dish');
    if (collected) return collected;
  }
  return null;
}

async function offerDish(h, index) {
  const before = await h.ui();
  const carriedFood = before.debug?.carried?.food ?? before.debug?.carried;
  const beforeTarget = customerAt(before, index);
  if (!carriedFood || !beforeTarget?.screen) {
    return { outcome: 'missing', state: before, carriedFood };
  }

  // A locked customer ignores deliver() without changing dialogue or state.
  // When the hook exposes the lock, do not turn that deliberate no-op into a
  // second refusal. Callers can step away by continuing their sweep.
  if ((beforeTarget.refusalRemaining ?? 0) > 0) {
    return { outcome: 'locked', state: before, carriedFood };
  }

  const transition = (state) => {
    const target = customerAt(state, index);
    const delivered = ['delivered', 'eating'].includes(target?.state)
      && !['delivered', 'eating'].includes(beforeTarget.state)
      && !state.debug?.carried;
    if (delivered) return 'delivered';

    const refusalStarted = Number.isFinite(target?.refusalRemaining)
      && target.refusalRemaining > Math.max(0, beforeTarget.refusalRemaining ?? 0) + 0.001;
    // Older builds of the redesigned debug snapshot omitted refusalRemaining.
    // The first wrong offer still has an unambiguous debug transition because
    // it clears first-try credit. Stable state is reported as no-change, never
    // guessed to be a refusal from dialogue text.
    const firstTryLost = before.debug?.carried?.firstTry !== false
      && state.debug?.carried?.firstTry === false;
    if (state.debug?.carried && (refusalStarted || firstTryLost)) return 'refused';
    return null;
  };

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = await h.ui();
    const currentOutcome = transition(current);
    if (currentOutcome) return { outcome: currentOutcome, state: current, carriedFood };
    const customer = customerAt(current, index);
    if (!current.debug?.carried) return { outcome: 'missing', state: current, carriedFood };
    if (!customer?.screen) return { outcome: 'missing', state: current, carriedFood };
    await clickAt(h.page, customer.screen);
    const changed = await h.waitFor((state) => Boolean(transition(state)), 2800, `delivery transition at customer ${index}`);
    if (changed) return { outcome: transition(changed), state: changed, carriedFood };
  }
  return { outcome: 'no-change', state: await h.ui(), carriedFood };
}

const TABLE_SEATS = Object.freeze([
  { x: -4.2, z: -2.05 },
  { x: 0, z: 0.75 },
  { x: 4.2, z: -2.05 },
  { x: -4.2, z: 2.85 },
  { x: 4.2, z: 2.85 },
]);

async function runPastCustomer(h, customer) {
  const seat = TABLE_SEATS[tableOf(customer)];
  if (!seat) return { passed: false, prompted: true, minimumDistance: Infinity };
  // Stay in the aisle two metres beside the chair. This is inside the generous
  // talk radius but clear of the table collision circle. Keep W held all the
  // way through the radius so no real-time dwell can accumulate.
  const aisleX = seat.x <= 0 ? seat.x + 2 : seat.x - 2;
  let state = await h.ui();
  const xKey = state.debug.player.x < aisleX ? 'KeyD' : 'KeyA';
  await h.page.keyboard.down(xKey);
  for (let frame = 0; frame < 100; frame += 1) {
    state = await h.ui();
    if ((xKey === 'KeyD' && state.debug.player.x >= aisleX)
      || (xKey === 'KeyA' && state.debug.player.x <= aisleX)) break;
    await h.sleep(40);
  }
  await h.page.keyboard.down('KeyW');
  await h.page.keyboard.up(xKey);

  let minimumDistance = Infinity;
  let prompted = false;
  const exitZ = Math.max(seat.z - 3.1, -4.35);
  for (let frame = 0; frame < 160; frame += 1) {
    state = await h.ui();
    const dx = state.debug.player.x - seat.x;
    const dz = state.debug.player.z - seat.z;
    minimumDistance = Math.min(minimumDistance, Math.hypot(dx, dz));
    prompted ||= state.talkVisible || state.debug.focusActive || state.fallback.length > 0;
    if (state.debug.player.z < exitZ) break;
    await h.sleep(40);
  }
  await h.page.keyboard.up('KeyW');
  return { passed: minimumDistance < 2.7, prompted, minimumDistance };
}

async function clickAndWaitForArrival(h, customer) {
  // A click may start a walk, or — when the avatar already stands at that
  // customer — arrive instantly and go straight to the dwell. Accept either
  // signal, and re-click with fresh coordinates if the game shows neither.
  const id = customer.id ?? customer.index;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await clickAt(h.page, customer.screen);
    const started = await h.waitFor(
      (state) => state.debug?.player?.autoWalking
        || state.debug?.dwell?.targetId === id
        || state.debug?.question?.customer === id,
      1500,
      'click-to-walk or dwell to start',
    );
    if (started) break;
    const fresh = customerAt(await h.ui(), customer.index);
    if (fresh?.screen) customer = fresh;
  }
  const arrived = await h.waitFor(
    (state) => !state.debug?.player?.autoWalking && customerAt(state, customer.index)?.state === 'orderCue',
    6000,
    `arrival at customer ${customer.index}`,
  );
  const arrivedAt = await h.page.evaluate(() => performance.now());
  return { arrived, arrivedAt };
}

async function finishTurnaround(h, screenshotName, expectedScore = null) {
  const s = await h.waitFor(
    (state) => serviceLifecycle(state) === 'turnaround' && state.fallback.length >= 3,
    18000,
    'turnaround',
  );
  check('turnaround opens under speech focus', s?.debug?.focusActive, JSON.stringify(s?.debug));
  if (!s) return null;
  if (expectedScore) {
    check('the final result shows both player and rival counts plainly',
      s.score?.includes(`きみ ${expectedScore.player}`)
        && s.score.includes(`ウェイター ${expectedScore.rival}`),
    JSON.stringify({ score: s.score, expectedScore }));
  }
  await h.sleep(800);
  await h.page.screenshot({ path: screenshotName });
  const choice = s.fallback.find((answer) => answer.value === CHOICE);
  check(`turnaround offers "I like ${CHOICE}."`, choice, s.fallback.map((answer) => answer.text).join(' | '));
  await h.page.click(choice ? `.lesson-hud__fallback[data-value="${CHOICE}"]` : '.lesson-hud__fallback');
  return h.waitFor((state) => !state.restaurant && state.greeting !== null, 15000, 'hub return');
}

// ---- Dwell and microphone behavior -------------------------------------
// This short probe uses the real Restaurant controller with the deterministic
// Web Speech mock. The two complete scoring sessions below remain mic-free.
{
  const h = await openPage('dwell-mic', { micFree: false, mockSpeech: true });
  const { page } = h;
  let s = await enterRestaurant(h);
  check('mic probe enters Restaurant with the speech mock installed',
    s?.restaurant && await page.evaluate(() => Boolean(window.__mockSpeech)));

  s = await waitForShiftState(h,
    (state) => state.debug?.customers.some((customer) => customer.cueShowing),
    'raised hand for pass-by probe',
  );
  const passCustomer = s?.debug?.customers.find((customer) => customer.cueShowing) ?? null;
  if (!passCustomer) {
    check('a raised hand appears for the dwell probe', false, JSON.stringify(s?.debug));
  } else {
    const pass = await runPastCustomer(h, passCustomer);
    check('running passes through a raised customer talk radius', pass.passed,
      JSON.stringify({ minimumDistance: pass.minimumDistance, customer: passCustomer }));
    check('running past a raised hand opens no prompt or speech focus', !pass.prompted,
      JSON.stringify(pass));

    await page.evaluate(() => window.__mockSpeech.queueTranscript('What food do you like?'));
    const startsBeforeCorrect = await page.evaluate(() => window.__mockSpeech.starts);
    s = await h.ui();
    const currentPassCustomer = customerAt(s, passCustomer.index);
    const arrival = currentPassCustomer?.screen
      ? await clickAndWaitForArrival(h, currentPassCustomer)
      : { arrived: null, arrivedAt: 0 };
    await h.sleep(600);
    const startsDuringDwell = await page.evaluate(() => window.__mockSpeech.starts);
    check('click-to-walk arrival does not listen before the dwell completes',
      Boolean(arrival.arrived) && startsDuringDwell === startsBeforeCorrect,
      JSON.stringify({ startsBeforeCorrect, startsDuringDwell, arrived: Boolean(arrival.arrived) }));
    const accepted = await h.waitFor(
      (state) => customerAt(state, passCustomer.index)?.state === 'awaiting',
      5000,
      'mocked correct question after dwell',
    );
    const countersAfterCorrect = await page.evaluate(() => window.__mockSpeech.getCounters());
    check('a scripted correct question is accepted after the dwell',
      Boolean(accepted) && countersAfterCorrect.starts === startsBeforeCorrect + 1
        && countersAfterCorrect.lastStartAt - arrival.arrivedAt >= 700,
      JSON.stringify({ countersAfterCorrect, arrivedAt: arrival.arrivedAt }));

    s = await waitForShiftState(h,
      (state) => state.debug?.customers.some((customer) => customer.cueShowing),
      'raised hand for silence probe',
    );
    const silenceCustomer = s?.debug?.customers.find((customer) => customer.cueShowing) ?? null;
    if (!silenceCustomer) {
      check('a second raised hand appears for the silence probe', false, JSON.stringify(s?.debug));
    } else {
      await page.evaluate(() => window.__mockSpeech.queueSilence());
      const startsBeforeSilence = await page.evaluate(() => window.__mockSpeech.starts);
      await clickAndWaitForArrival(h, silenceCustomer);
      // The dwell runs on real time but software GL clamps frame dt, so wait
      // for the commit itself rather than assuming 1.2 s of wall clock.
      const committed = await h.waitFor(
        (state) => state.debug?.question?.committed && state.debug?.question?.customer === (silenceCustomer.id ?? silenceCustomer.index),
        8000,
        'silence-probe conversation to commit after the dwell',
      );
      const tryAgain = await h.waitFor(
        (state) => state.talkState === 'try-again',
        5000,
        'speech silence to end in try-again',
      );
      const startsAfterSilence = await page.evaluate(() => window.__mockSpeech.starts);
      await h.sleep(2600);
      const standing = await h.ui();
      const startsAfterStanding = await page.evaluate(() => window.__mockSpeech.starts);
      const trace = { dwell: standing.debug?.dwell, question: standing.debug?.question, talkState: standing.talkState };
      check('scripted silence ends in try-again',
        Boolean(committed) && Boolean(tryAgain) && startsAfterSilence === startsBeforeSilence + 1,
        JSON.stringify({ committed: Boolean(committed), startsBeforeSilence, startsAfterSilence, talkState: tryAgain?.talkState, ...trace }));
      // Only meaningful if an automatic session really ran first.
      check('the microphone does not auto-reopen while standing still after silence',
        startsAfterSilence === startsBeforeSilence + 1 && startsAfterStanding === startsAfterSilence,
        JSON.stringify({ startsBeforeSilence, startsAfterSilence, startsAfterStanding, ...trace }));
    }
  }
  await page.close();
}

// ---- Session A: listen, remember, deliver first try ---------------------
{
  const h = await openPage('listening');
  const { page } = h;
  let s = await enterRestaurant(h);
  check('hub -> Restaurant at 1366x768', s?.restaurant && s?.debug?.level === LEVEL,
    JSON.stringify({ level: s?.debug?.level }));
  s = await waitForShiftState(h,
    (state) => state.debug?.customers.some((customer) => customer.cueShowing), 'order cue');
  check('level 2 reports the seven-customer shift total', progressOf(s).total === SHIFT_TOTAL,
    JSON.stringify(progressOf(s)));
  check('customer debug identities include their table', s?.debug?.customers.length > 0
    && s.debug.customers.every((customer) => Number.isInteger(customer.index)
      && Number.isInteger(tableOf(customer))), JSON.stringify(s?.debug?.customers));
  check('a raised-order cue is exposed without food content', s?.debug?.customers.some((customer) => customer.cueShowing));
  await page.screenshot({ path: `${OUT}-01-seated-order-cue.png` });

  const remembered = new Map();
  const seenFoods = new Map();
  const resolvedTables = new Set();
  const resolvedIds = new Set();
  let replacementChecked = false;
  let reachedRush = directorPhase(s) === 'rush';
  let duplicateChecked = false;
  await askShowingCues(h, remembered, { checkFreeze: true, minimum: 3 });
  s = await h.ui();
  check('Normal reaches three unresolved player orders', playerOrders(s).length >= 3,
    JSON.stringify(playerOrders(s).map((customer) => [customer.index, customer.state, customer.owner])));
  if (playerOrders(s).length >= 3) {
    await page.screenshot({ path: `${OUT}-08-normal-multiple-unresolved.png` });
  }
  s = await waitForShiftState(h,
    (state) => state.debug?.readyDishes.length >= 2, 'two ready dishes');
  check('two independently prepared dishes can wait on the counter', s?.debug?.readyDishes.length >= 2,
    JSON.stringify(s?.debug?.readyDishes));
  const readySlots = s?.debug?.readyDishes.map((dish) => dish.slot) ?? [];
  check('ready dishes occupy separate randomised counter slots', readySlots.length >= 2
    && readySlots.every((slot) => Number.isInteger(slot) && slot >= 0 && slot < 4)
    && new Set(readySlots).size === readySlots.length,
  JSON.stringify(readySlots));
  if (s) await page.screenshot({ path: `${OUT}-02-two-ready-dishes.png` });

  let carryingShot = false;
  let comboShot = false;
  const serviceDeadline = Date.now() + 240000;
  while (isInService(s) && progressOf(s).done < progressOf(s).total && Date.now() < serviceDeadline) {
    s = await h.ui();
    reachedRush ||= directorPhase(s) === 'rush';
    for (const customer of s.debug.customers) {
      const indexes = seenFoods.get(customer.food) ?? new Set();
      indexes.add(customer.index);
      seenFoods.set(customer.food, indexes);
      if (!resolvedIds.has(customer.index) && resolvedTables.has(tableOf(customer))
        && !['scheduled', 'left'].includes(customer.state)) replacementChecked = true;
    }
    if (s.debug?.customers.some((customer) => customer.cueShowing)) {
      await askShowingCues(h, remembered);
      s = await h.ui();
      continue;
    }

    const dish = s.debug.readyDishes[0] ?? null;
    if (!dish) {
      s = await h.waitFor(
        (state) => !isInService(state)
          || progressOf(state).done >= progressOf(state).total
          || state.debug?.customers.some((customer) => customer.cueShowing)
          || state.debug?.readyDishes.length > 0,
        25000,
        'next cue or deliverable dish',
      );
      if (!s) {
        s = await h.ui();
        if (isInService(s) && Date.now() < serviceDeadline) continue;
        check('listening shift produces another actionable state', false, JSON.stringify(s.debug));
        await page.screenshot({ path: `${OUT}-listening-stalled.png` });
        break;
      }
      continue;
    }
    s = await collectDish(h, dish);
    check(`collect ready ${dish.food}`, s?.debug?.carried, JSON.stringify(s?.debug?.carried));
    if (!carryingShot && s) {
      carryingShot = true;
      await page.screenshot({ path: `${OUT}-03-carried-dish.png` });
    }
    const carriedFood = s?.debug?.carried?.food ?? s?.debug?.carried;
    const matching = s?.debug?.customers.filter((customer) => customer.state === 'awaiting'
      && remembered.get(customer.index) === carriedFood) ?? [];
    const testingDuplicate = !duplicateChecked && matching.length >= 2;
    const target = testingDuplicate ? matching[matching.length - 1] : matching[0];
    check(`remember who ordered ${carriedFood}`, target, JSON.stringify([...remembered]));
    if (!target) {
      await page.screenshot({ path: `${OUT}-missing-answer.png` });
      break;
    }
    const result = await offerDish(h, target.index);
    check(`first-try ${carriedFood} delivery is accepted`, result.outcome === 'delivered',
      `${result.outcome} — target ${target.index} ${JSON.stringify(
        result.state?.debug?.customers?.map((c) => [c.index, c.state, c.food]),
      )} carried ${JSON.stringify(result.state?.debug?.carried)}`);
    s = result.state;
    if (result.outcome !== 'delivered') {
      await page.screenshot({ path: `${OUT}-unexpected-listening-delivery.png` });
      break;
    }
    resolvedTables.add(tableOf(target));
    resolvedIds.add(target.index);
    if (testingDuplicate) {
      check(`repeated ${carriedFood} is accepted by either matching customer`, result.outcome === 'delivered',
        `target ${target.index}; matching customers ${matching.map((customer) => customer.index).join(', ')}`);
      duplicateChecked = result.outcome === 'delivered';
    }
    if (!comboShot && s?.debug?.combo >= 2) {
      comboShot = true;
      check('first-try combo reaches two', Boolean(s.combo), s.combo ?? `debug combo ${s.debug.combo}`);
      await page.screenshot({ path: `${OUT}-04-combo.png` });
    }
  }
  s = await h.ui();
  reachedRush ||= directorPhase(s) === 'rush';
  const listeningProgress = progressOf(s);
  const listeningRecords = s?.debug?.records ?? null;
  check('a replacement customer is seated after an earlier customer resolves', replacementChecked,
    JSON.stringify(s?.debug?.customers.map((customer) => [customer.index, tableOf(customer), customer.state])));
  check('the service director reaches rush', reachedRush, JSON.stringify({ phase: directorPhase(s) }));
  check('the listening shift reaches its full reported total',
    listeningProgress.total === SHIFT_TOTAL && listeningProgress.done === listeningProgress.total,
    JSON.stringify(listeningProgress));
  check('all seven customers resolve as successful deliveries in the listening session',
    remembered.size === SHIFT_TOTAL
      && (!listeningRecords || (listeningRecords.length === SHIFT_TOTAL
        && listeningRecords.every((record) => record.delivered))),
    JSON.stringify({ remembered: remembered.size, records: listeningRecords }));
  check('combo pop was captured', comboShot);
  const repeatedFood = [...seenFoods].find(([, indexes]) => indexes.size >= 2)?.[0] ?? null;
  if (repeatedFood && duplicateChecked) {
    check(`duplicate-food session exercises ${repeatedFood}`, true);
  } else {
    console.log('SKIP  repeated-food acceptance (no simultaneous matching pair was ready)');
  }

  s = await finishTurnaround(h, `${OUT}-05-turnaround.png`);
  check('listening session finishes back at the hub', s);
  check('Restaurant debug hook is removed on exit', s?.debug == null, JSON.stringify(s?.debug));
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '{}'), SAVE_KEY);
  check('listening session earns the Restaurant stamp', saved?.stamps?.restaurant === true,
    JSON.stringify(saved?.stamps));
  check('listening first-try session earns three stars', saved?.bestStars?.restaurant === 3,
    JSON.stringify(saved?.bestStars));
  await page.close();
}

// ---- Session B: ignore answers and sweep customers ----------------------
{
  const h = await openPage('sweep');
  const { page } = h;
  let s = await enterRestaurant(h);
  check('anti-shortcut session enters Restaurant', s?.restaurant);
  let wrongChecked = false;
  let recoveredAfterWrong = false;
  let currentDishHadWrong = false;
  let wrongedDeliveries = 0;
  const serviceDeadline = Date.now() + 240000;
  while (isInService(s) && progressOf(s).done < progressOf(s).total && Date.now() < serviceDeadline) {
    s = await h.ui();
    // Taking an order while carrying is intentional controller behavior and is
    // also how the sweep reveals a genuinely wrong target for the held plate.
    if (s.debug?.customers.some((customer) => customer.cueShowing)) {
      await askShowingCues(h, null, { remember: false });
      s = await h.ui();
      continue;
    }
    if (!s.debug?.carried && s.debug?.readyDishes.length === 0) {
      s = await h.waitFor(
        (state) => !isInService(state)
          || progressOf(state).done >= progressOf(state).total
          || state.debug?.customers.some((customer) => customer.cueShowing)
          || state.debug?.readyDishes.length > 0,
        25000,
        'sweep cue or dish',
      );
      if (!s) {
        s = await h.ui();
        if (isInService(s) && Date.now() < serviceDeadline) continue;
        check('anti-shortcut shift produces another actionable state', false, JSON.stringify(s.debug));
        await page.screenshot({ path: `${OUT}-sweep-stalled.png` });
        break;
      }
      continue;
    }
    if (!s || !isInService(s)) break;
    if (!s.debug.carried) {
      await h.waitFor((state) => !state.bubble, 7000, 'English answer to clear');
      s = await h.ui();
      const wrongTargetFor = (state, food) => state.debug.customers.find((customer) =>
        ['seated', 'awaiting'].includes(customer.state)
          && !customer.cueShowing
          && customer.food !== food
          && (customer.refusalRemaining ?? 0) <= 0);
      let dish = s.debug.readyDishes.find((candidate) => wrongTargetFor(s, candidate.food));
      const mayProduceWrongTarget = progressOf(s).done < progressOf(s).total - 1;
      if (!dish && mayProduceWrongTarget) {
        // Do not accept a first-try delivery merely because this instant's
        // occupants all happen to want the held food. Keep the counter intact
        // while hands and replacements expose a genuinely different target.
        s = await h.waitFor(
          (state) => !isInService(state)
            || state.debug?.customers.some((customer) => customer.cueShowing)
            || state.debug?.readyDishes.some((candidate) => wrongTargetFor(state, candidate.food)),
          25000,
          'a wrong target for a ready plate',
        );
        if (!s) {
          s = await h.ui();
          if (isInService(s) && Date.now() < serviceDeadline) continue;
          check('a non-final plate gets a deterministic wrong target', false,
            JSON.stringify(s.debug));
          await page.screenshot({ path: `${OUT}-no-wrong-target.png` });
          break;
        }
        continue;
      }
      dish ??= s.debug.readyDishes[0];
      if (!dish) continue;
      s = await collectDish(h, dish);
      if (!s) break;
      currentDishHadWrong = false;
    }
    const carriedFood = s.debug.carried?.food ?? s.debug.carried;
    if (!currentDishHadWrong) {
      const wrongTarget = s.debug.customers
        .filter((customer) => ['seated', 'awaiting'].includes(customer.state)
          && !customer.cueShowing
          && customer.food !== carriedFood
          && (customer.refusalRemaining ?? 0) <= 0)
        .sort((a, b) => a.index - b.index)[0];
      const mayProduceWrongTarget = progressOf(s).done < progressOf(s).total - 1;
      if (!wrongTarget && mayProduceWrongTarget) {
        await h.sleep(250);
        continue;
      }
      if (wrongTarget) {
        const result = await offerDish(h, wrongTarget.index);
        s = result.state;
        if (result.outcome === 'refused') {
          currentDishHadWrong = true;
          wrongedDeliveries += 1;
          if (!wrongChecked) {
            const stillCarried = s.debug.carried?.food ?? s.debug.carried;
            const englishRepeated = Boolean(s.bubble && /^I like .+\.$/.test(s.bubble));
            check('wrong delivery leaves the same dish in hand', stillCarried === carriedFood,
              JSON.stringify({ before: carriedFood, after: stillCarried }));
            check('wrong delivery refuses without repeating the English answer', !englishRepeated,
              JSON.stringify({ bubble: s.bubble, instruction: s.instruction }));
            wrongChecked = true;
            await page.screenshot({ path: `${OUT}-06-wrong-delivery.png` });
          }
          continue;
        }
        if (result.outcome !== 'locked') {
          check('the selected different-food customer refuses the plate', false,
            JSON.stringify({ outcome: result.outcome, wrongTarget, carriedFood }));
          break;
        }
      }
    }

    // Once this plate has definitely lost first-try credit, recover by taking
    // it to any awaiting customer who ordered that food.
    s = await h.ui();
    const matching = s.debug.customers.find((customer) => customer.state === 'awaiting'
      && customer.food === carriedFood);
    if (!matching) {
      await h.sleep(250);
      continue;
    }
    const result = await offerDish(h, matching.index);
    s = result.state;
    if (result.outcome === 'delivered') {
      if (currentDishHadWrong) recoveredAfterWrong = true;
      currentDishHadWrong = false;
    } else if (result.outcome !== 'locked') {
      check('a wrong-first plate remains recoverable at its matching customer', false,
        JSON.stringify({ outcome: result.outcome, matching, carriedFood }));
      break;
    }
  }
  s = await h.ui();
  const sweepProgress = progressOf(s);
  const sweepRecords = s?.debug?.records ?? null;
  const sweepScore = s?.debug?.scoring
    ?? (sweepRecords?.length === SHIFT_TOTAL ? scoreSession(sweepRecords) : null);
  check('anti-shortcut run exercised a wrong delivery', wrongChecked);
  check('the order is recoverable after a wrong delivery', recoveredAfterWrong);
  check('guessing remains recoverable and resolves the full shift total',
    sweepProgress.total === SHIFT_TOTAL && sweepProgress.done === sweepProgress.total,
    JSON.stringify({ progress: sweepProgress, customers: s?.debug?.customers }));
  check('the anti-shortcut result contains exactly one record per customer',
    sweepRecords?.length === SHIFT_TOTAL,
    JSON.stringify({ recordCount: sweepRecords?.length, records: sweepRecords }));
  check('the deterministic sweep is below the scoring first-try cap',
    sweepScore?.firstTryShare < FIRST_TRY_SHARE_CAP,
    JSON.stringify({ cap: FIRST_TRY_SHARE_CAP, wrongedDeliveries, score: sweepScore }));
  s = await finishTurnaround(h, `${OUT}-07-sweep-turnaround.png`);
  check('guessing session still finishes', s);
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '{}'), SAVE_KEY);
  const stars = saved?.bestStars?.restaurant ?? null;
  check('anti-shortcut sweep still earns the stamp', saved?.stamps?.restaurant === true,
    JSON.stringify(saved?.stamps));
  check('anti-shortcut sweep cannot reach three stars', stars !== null && stars < 3,
    JSON.stringify({ bestStars: saved?.bestStars, firstTryShare: sweepScore?.firstTryShare }));
  await page.close();
}

// ---- Session C: Challenge rival ownership and shared rush ---------------
{
  const h = await openPage('challenge-rival', { difficulty: 3 });
  const { page } = h;
  let s = await enterRestaurant(h);
  const enteredChallenge = precondition('Challenge session enters Restaurant at level 3',
    s?.restaurant && s?.debug?.level === 3, JSON.stringify({ level: s?.debug?.level }));
  if (enteredChallenge) {
    check('Challenge opens with the lunch-rush phase pill',
      s.phasePill === 'ランチラッシュ！' || s.body.includes('ランチラッシュ！'),
      JSON.stringify({ phasePill: s.phasePill }));
  }

  const remembered = new Map();
  let rivalryTarget = null;
  let takeoverCommitted = false;
  let rivalPassChecked = false;

  // Camp beside the first hand, then cancel the dwell. This establishes a
  // reachable target without reserving it, so the later race tests ownership
  // instead of which waiter happened to start closer to the table.
  // Click-to-walk parks the player at (seatX, seatZ - 1.65). From there, only
  // these keys leave the talk radius without walking into or facing another
  // seat (tables 3 and 4 step toward the centre customer, so they are skipped).
  const AWAY_KEY_BY_TABLE = { 0: 'KeyD', 1: 'KeyW', 2: 'KeyA' };
  const stageable = (customer) => customer.cueShowing && customerOwner(customer) === null
    && AWAY_KEY_BY_TABLE[customer.table] !== undefined;
  s = await waitForShiftState(h, (state) => state.debug?.customers.some(stageable),
    'Challenge raised hand at a back table to stage rival race');
  const campCustomer = s?.debug?.customers.find(stageable) ?? null;
  const hasCampCustomer = precondition('precondition: an unclaimed raised hand can stage the rival race',
    campCustomer?.screen, JSON.stringify(campCustomer));
  if (hasCampCustomer) {
    // Cancel while the dwell is still running. Waiting for arrival first let
    // the 1.2 s dwell commit, which claims the customer instead of releasing it.
    const campId = campCustomer.id ?? campCustomer.index;
    await clickAt(page, campCustomer.screen);
    const dwelling = await h.waitFor((state) => state.debug?.dwell?.targetId === campId
      && state.debug.dwell.phase === 'dwelling'
      && state.debug.dwell.progress < 0.6
      && customerReservation(customerAt(state, campCustomer.index)) === 'player', 8000,
    'staged dwell to reserve the camp customer');
    // Press away from the customer before any further full ui() round-trip: under
    // SwiftShader one snapshot can outlast the rest of the 1.2 s dwell.
    await page.evaluate(() => {
      window.__stagedDwellAtKeydown = null;
      window.addEventListener('keydown', () => {
        const raw = window.__eslDebug?.restaurant;
        const d = typeof raw === 'function' ? raw() : raw;
        window.__stagedDwellAtKeydown = JSON.parse(JSON.stringify({
          dwell: d?.dwell ?? null,
          committed: d?.question?.committed ?? null,
          player: d?.player ?? null,
        }));
      }, { once: true, capture: true });
    });
    // S (+z) would walk into the customer and table; see AWAY_KEY_BY_TABLE.
    await h.hold([AWAY_KEY_BY_TABLE[campCustomer.table]], 800);
    console.log(`  (staged dwell at keydown: ${JSON.stringify(
      await page.evaluate(() => window.__stagedDwellAtKeydown))})`);
    console.log(`  (staged dwell after keyup: ${JSON.stringify(await page.evaluate(() => {
      const raw = window.__eslDebug?.restaurant;
      const d = typeof raw === 'function' ? raw() : raw;
      return { dwell: d?.dwell ?? null, committed: d?.question?.committed ?? null, player: d?.player ?? null };
    }))})`);
    precondition('precondition: the staged dwell reserves the camp customer before commit',
      dwelling, JSON.stringify(customerAt(dwelling, campCustomer.index)));
    // Leave the 2.7-unit talk radius: stopping inside it while still locked on
    // the customer starts a fresh dwell, which then commits.
    s = await h.waitFor((state) => {
      const customer = customerAt(state, campCustomer.index);
      return customerOwner(customer) === null
        && customerReservation(customer) === null
        && state.debug?.dwell?.targetId == null
        && !state.debug?.focusActive;
    }, 3000, 'staged dwell cancellation to release its reservation');
    const released = precondition('precondition: cancelling the staged dwell releases the player reservation',
      s, JSON.stringify(customerAt(await h.ui(), campCustomer.index)));
    if (!released) {
      // If the dwell won the race, its open prompt freezes the service clock.
      // Answer it so the rest of the Challenge run is not measured frozen.
      const stuck = await h.ui();
      if (stuck.fallback.length) {
        await page.click('.lesson-hud__fallback');
        await h.waitFor((state) => !state.debug?.focusActive, 8000, 'recovery from the committed staged dwell');
      }
    }
    if (released) {
      s = await h.waitFor((state) => state.debug?.rival?.state === 'walkingToCustomer'
        && state.debug.rival.targetCustomer === (campCustomer.id ?? campCustomer.index),
      18000, 'rival to walk toward the staged customer');
      const rivalStarted = precondition('precondition: the rival walks toward the staged unclaimed customer',
        s, JSON.stringify((await h.ui()).debug?.rival));
      if (rivalStarted) {
        rivalryTarget = campCustomer.id ?? campCustomer.index;
        const fresh = customerAt(s, campCustomer.index);
        if (fresh?.screen) await clickAt(page, fresh.screen);
        const reserved = await h.waitFor((state) => {
          const customer = customerAt(state, campCustomer.index);
          return customerReservation(customer) === 'player' || customerOwner(customer) === 'player';
        }, 1800, 'player reservation on the rival walk target');
        const reservationReached = precondition(
          'precondition: player dwell reserves the customer while the rival is approaching',
          reserved, JSON.stringify(customerAt(await h.ui(), campCustomer.index)),
        );
        if (reservationReached) {
          const prompt = await h.waitFor((state) => state.fallback.length > 0 && state.debug?.focusActive,
            4000, 'held fallback on the rival walk target');
          precondition('precondition: speech focus opens on the reserved customer',
            prompt, JSON.stringify(prompt?.debug?.rival));
          // A player reservation makes the rival abandon this target by design
          // (rival.js 'reserved'), so it is often idle by the time focus opens.
          const walkingFocus = prompt && rivalIsWalking(prompt);
          if (!walkingFocus) console.log('  (rival already abandoned the reserved target; freeze sampled on the separate-routes prompt)');
          if (walkingFocus) {
            const before = prompt.debug.rival;
            await h.sleep(1400);
            const after = (await h.ui()).debug?.rival;
            const positionStill = Math.hypot(
              (after?.position?.x ?? Infinity) - before.position.x,
              (after?.position?.z ?? Infinity) - before.position.z,
            ) < 0.001;
            check('speech focus freezes rival state, target, position and carried food',
              after?.state === before.state
                && after?.targetCustomer === before.targetCustomer
                && after?.carryingFood === before.carryingFood
                && positionStill,
            JSON.stringify({ before, after }));
          }
          if (prompt?.fallback[0]) await page.click('.lesson-hud__fallback');
          const committed = await h.waitFor((state) => {
            const customer = customerAt(state, campCustomer.index);
            return customerOwner(customer) === 'player'
              && customer?.state === 'awaiting'
              && /^I like .+\.$/.test(state.bubble ?? '');
          }, 7000, 'player claim to commit after the reserved dwell');
          const committedReached = precondition(
            'precondition: the reserved Challenge conversation commits successfully',
            committed, JSON.stringify(customerAt(await h.ui(), campCustomer.index)),
          );
          if (committedReached) {
            const spoken = committed.bubble.match(/^I like (.+)\.$/)?.[1]?.toLowerCase() ?? null;
            remembered.set(campCustomer.index, FOOD_BY_SENTENCE.get(spoken) ?? spoken);
            takeoverCommitted = true;
            const abandoned = await h.waitFor((state) => state.debug?.rival?.targetCustomer !== rivalryTarget,
              8000, 'rival to abandon the player-owned target');
            check('a player dwell keeps the approached customer and makes the rival abandon it',
              customerOwner(customerAt(abandoned, campCustomer.index)) === 'player',
              JSON.stringify({ customer: customerAt(abandoned, campCustomer.index), rival: abandoned?.debug?.rival }));
          }
        }
      }
    }
  }

  // Let the rival establish ownership before probing the player interaction
  // filters. A missing claim is setup failure, not evidence about those filters.
  s = await waitForShiftState(h, (state) => state.debug?.customers.some((customer) =>
    customerOwner(customer) === 'rival'), 'first rival-owned customer', 40000);
  let rivalCustomer = s?.debug?.customers.find((customer) => customerOwner(customer) === 'rival') ?? null;
  const rivalClaimed = precondition('precondition: the rival claims an unclaimed Challenge customer',
    rivalCustomer, JSON.stringify(s?.debug?.rival));
  if (rivalClaimed && rivalCustomer.screen) {
    const rivalId = rivalCustomer.id ?? rivalCustomer.index;
    await clickAt(page, rivalCustomer.screen);
    const started = await h.waitFor((state) => state.debug?.player?.autoWalking
      || state.debug?.dwell?.targetId === rivalId
      || state.debug?.question?.customer === rivalId,
    1200, 'click response at rival-owned customer');
    if (started?.debug?.player?.autoWalking) {
      await h.waitFor((state) => !state.debug?.player?.autoWalking
        || !customerAt(state, rivalCustomer.index), 7000, 'arrival beside rival-owned customer');
    }
    const forbiddenTalk = await h.waitFor((state) => state.debug?.dwell?.targetId === rivalId
      || state.debug?.question?.customer === rivalId,
    1600, 'forbidden rival-owned talk target');
    check('rival-owned customers never become click-to-talk or dwell targets', !forbiddenTalk,
      JSON.stringify(forbiddenTalk?.debug));
  }

  s = await waitForShiftState(h, (state) => state.debug?.rivalPass?.contents?.state === 'ready',
    'first ready rival-pass dish', 35000);
  const firstRivalPassReady = precondition(
    'precondition: the rival pass visibly contains its own ready dish',
    s?.debug?.rivalPass?.contents?.state === 'ready' && s.debug.rivalPass.screen,
  JSON.stringify(s?.debug?.rivalPass));
  if (firstRivalPassReady) {
    await clickAt(page, s.debug.rivalPass.screen);
    await h.waitFor((state) => !state.debug?.player?.autoWalking, 8000,
      'player movement after clicking the rival pass');
    const afterPassClick = await h.ui();
    check('the player cannot collect from the rival pass', !afterPassClick.debug?.carried,
      JSON.stringify({ carried: afterPassClick.debug?.carried, rivalPass: afterPassClick.debug?.rivalPass }));
    rivalPassChecked = !afterPassClick.debug?.carried;
    s = afterPassClick;
  }

  // Preserve enough free order budget for two simultaneous hand cues. This
  // makes the motion frame prove that each waiter has a different customer.
  s = await waitForShiftState(h, (state) => (state.debug?.rivalServed ?? 0) >= 1,
    'rival to complete its first table', 60000);
  const rivalCompleted = precondition('precondition: the rival completes a claimed customer',
    (s?.debug?.rivalServed ?? 0) >= 1, JSON.stringify({
      rival: s?.debug?.rival,
      rivalServed: s?.debug?.rivalServed,
    }));
  if (rivalCompleted) {
    s = await waitForShiftState(h, (state) => {
      const target = state.debug?.rival?.targetCustomer;
      return state.debug?.rival?.state === 'walkingToCustomer'
        && state.debug.customers.some((customer) => customer.cueShowing
          && customerOwner(customer) === null
          && (customer.id ?? customer.index) !== target);
    }, 'separate customer routes for player and rival', 35000);
    const playerRouteTarget = s?.debug?.customers.find((customer) => customer.cueShowing
      && customerOwner(customer) === null
      && (customer.id ?? customer.index) !== s.debug.rival.targetCustomer) ?? null;
    const separateRoutes = precondition(
      'precondition: a second raised hand exists while the rival approaches another customer',
      s && playerRouteTarget?.screen, JSON.stringify({ rival: s?.debug?.rival, customers: s?.debug?.customers }),
    );
    if (separateRoutes) {
      await clickAt(page, playerRouteTarget.screen);
      const bothMoving = await h.waitFor((state) => state.debug?.player?.autoWalking
        && state.debug?.rival?.state === 'walkingToCustomer'
        && state.debug.rival.targetCustomer !== (playerRouteTarget.id ?? playerRouteTarget.index),
      1400, 'both waiters moving toward separate customers');
      const movingReached = precondition('precondition: both waiters begin their separate routes',
        bothMoving, JSON.stringify((await h.ui()).debug));
      if (movingReached) {
        await page.screenshot({ path: `${OUT}-09-player-rival-separate-customers.png` });
      }
      const answer = await askCustomer(h, playerRouteTarget.index, { checkRivalFreeze: true });
      if (answer) remembered.set(answer.index, answer.food);
    }
  }

  // Reach three player orders first, then capture the explicit choice between
  // serving ready food and taking one newly raised fourth order.
  for (let attempts = 0; attempts < 6 && playerOrders(await h.ui()).length < 3; attempts += 1) {
    s = await waitForShiftState(h, (state) => state.debug?.customers.some((customer) =>
      customer.cueShowing && customerOwner(customer) !== 'rival'), 'next player Challenge hand', 16000);
    const next = s?.debug?.customers.find((customer) =>
      customer.cueShowing && customerOwner(customer) !== 'rival');
    if (!next) break;
    const answer = await askCustomer(h, next.index);
    if (answer) remembered.set(answer.index, answer.food);
  }
  s = await waitForShiftState(h, (state) => playerOrders(state).length >= 3
    && state.debug?.readyDishes.length >= 1
    && state.debug.customers.some((customer) => customer.cueShowing
      && customerOwner(customer) !== 'rival'),
  'ready food beside a newly raised fourth player hand', 35000);
  const choiceReached = precondition(
    'precondition: Challenge offers a new raised hand while player food is ready',
    s, JSON.stringify(s?.debug));
  if (choiceReached) {
    await page.screenshot({ path: `${OUT}-10-raised-hand-or-ready-food.png` });
  }
  // The rival may win any single race, so keep taking free hands until four.
  for (let attempts = 0; attempts < 6 && playerOrders(await h.ui()).length < 4; attempts += 1) {
    s = await waitForShiftState(h, (state) => state.debug?.customers.some((customer) =>
      customer.cueShowing && customerOwner(customer) === null), 'fourth player Challenge hand', 16000);
    const next = s?.debug?.customers.find((customer) =>
      customer.cueShowing && customerOwner(customer) === null);
    if (!next) break;
    const answer = await askCustomer(h, next.index);
    if (answer) remembered.set(answer.index, answer.food);
  }
  s = await h.ui();
  check('Challenge reaches four unresolved player orders', playerOrders(s).length >= 4,
    JSON.stringify(playerOrders(s).map((customer) => [customer.index, customer.state, customer.owner])));
  if (playerOrders(s).length >= 4) {
    await page.screenshot({ path: `${OUT}-11-challenge-four-unresolved.png` });
  }

  // Carry a real player dish to a rival table. Ownership must make the offer
  // a no-op even when food happens to match.
  s = await waitForShiftState(h, (state) => state.debug?.readyDishes.length > 0,
    'player dish for rival-owned delivery probe', 30000);
  const dishForProbe = s?.debug?.readyDishes[0] ?? null;
  const hasPlayerDish = precondition('precondition: a player dish is ready for the ownership probe',
    dishForProbe, JSON.stringify(s?.debug?.readyDishes));
  if (hasPlayerDish) s = await collectDish(h, dishForProbe);
  if (s?.debug?.carried) {
    // Owner stays 'rival' after that customer is served and gone, so require one
    // still waiting at its table; a finished customer's screen point is empty floor.
    const rivalAwaiting = (customer) => customerOwner(customer) === 'rival' && customer.state === 'awaiting';
    s = await waitForShiftState(h, (state) => state.debug?.customers.some(rivalAwaiting),
      'rival-owned delivery target', 35000);
    rivalCustomer = s?.debug?.customers.find(rivalAwaiting) ?? null;
    const deliveryTargetReady = precondition(
      'precondition: a rival-owned customer exists while the player carries a dish',
      rivalCustomer, JSON.stringify({ carried: s?.debug?.carried, customers: s?.debug?.customers }),
    );
    if (deliveryTargetReady) {
      const carriedBefore = s.debug.carried;
      await clickAt(page, rivalCustomer.screen);
      await h.waitFor((state) => !state.debug?.player?.autoWalking
        || !customerAt(state, rivalCustomer.index), 7000, 'rival-table delivery attempt to settle');
      const after = await h.ui();
      check('deliver ignores rival-owned customers and leaves the player dish carried',
        after.debug?.carried?.customer === carriedBefore.customer
          && after.debug?.carried?.food === carriedBefore.food,
      JSON.stringify({ before: carriedBefore, after: after.debug?.carried,
        target: customerAt(after, rivalCustomer.index) }));
      s = after;
    }
  }

  // Finish the carried plate normally before approaching the rival pass.
  if (s?.debug?.carried) {
    const target = playerDeliveryCustomer(s, remembered);
    if (target) s = (await offerDish(h, target.index)).state;
  }
  check('the rival-pass ownership probe completed', rivalPassChecked);

  // Complete the shared shift with the same listen/remember/deliver loop as
  // Normal, while treating ownership as the authoritative interaction filter.
  const serviceDeadline = Date.now() + 300000;
  while (s?.debug && isInService(s) && progressOf(s).done < progressOf(s).total
    && Date.now() < serviceDeadline) {
    s = await h.ui();
    const cue = s.debug.customers.find((customer) => customer.cueShowing
      && customerOwner(customer) !== 'rival');
    if (cue) {
      const answer = await askCustomer(h, cue.index);
      if (answer) remembered.set(answer.index, answer.food);
      continue;
    }
    if (!s.debug.carried && s.debug.readyDishes.length > 0) {
      s = await collectDish(h, s.debug.readyDishes[0]);
      continue;
    }
    if (s?.debug?.carried) {
      const target = playerDeliveryCustomer(s, remembered);
      if (target) {
        s = (await offerDish(h, target.index)).state;
        continue;
      }
    }
    s = await h.waitFor((state) => !isInService(state)
      || progressOf(state).done >= progressOf(state).total
      || state.debug?.customers.some((customer) => customer.cueShowing
        && customerOwner(customer) !== 'rival')
      || (!state.debug?.carried && state.debug?.readyDishes.length > 0),
    25000, 'next owned Challenge action');
    if (!s) s = await h.ui();
  }

  s = await h.ui();
  const challengeProgress = progressOf(s);
  check('Challenge shared service resolves its full reported total',
    challengeProgress.done === challengeProgress.total,
    JSON.stringify({ progress: challengeProgress, rival: s?.debug?.rival, customers: s?.debug?.customers }));
  const scoreReady = precondition('precondition: both waiters complete at least one table for the score HUD',
    (s?.debug?.playerServed ?? 0) >= 1 && (s?.debug?.rivalServed ?? 0) >= 1,
  JSON.stringify({ playerServed: s?.debug?.playerServed, rivalServed: s?.debug?.rivalServed }));
  if (scoreReady) {
    const playerText = `きみ ${s.debug.playerServed}`;
    const rivalText = `ウェイター ${s.debug.rivalServed}`;
    check('Challenge score pill reflects both completed-table counts',
      s.score?.includes(playerText) && s.score.includes(rivalText),
      JSON.stringify({ score: s.score, playerText, rivalText }));
  }
  const finalCounts = scoreReady
    ? { player: s.debug.playerServed, rival: s.debug.rivalServed }
    : null;
  s = await finishTurnaround(h, `${OUT}-12-final-player-vs-waiter.png`, finalCounts);
  check('Challenge session finishes back at the hub', s);
  check('the staged ownership takeover completed', takeoverCommitted);
  await page.close();
}

check('no console or page errors', errors.length === 0, errors.slice(0, 3).join(' || '));
const failed = results.filter((result) => !result.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
await browser.close();
if (failed > 0) process.exitCode = 1;
