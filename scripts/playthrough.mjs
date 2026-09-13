// Scripted Restaurant playthrough, driven through the mic-free fallback.
// Run after building and starting the preview server:
//   node scripts/playthrough.mjs http://localhost:5199/ .tmp/restaurant pizza
//
// Session A listens, remembers each person-food pair, and delivers correctly.
// Session B ignores the answers and sweeps tables in index order. Separate
// contexts keep best-stars state from leaking between sessions.
import { chromium } from 'playwright';
import { LESSON_BY_ID } from '../src/config/lesson.js';

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

async function newContext() {
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  await context.addInitScript(([key, level]) => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem(key, JSON.stringify({
        version: 1,
        settings: { micFree: true, difficulty: level },
      }));
      sessionStorage.setItem('seeded', '1');
    }
  }, [SAVE_KEY, LEVEL]);
  return context;
}

const results = [];
const errors = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  - ${detail}` : ''}`);
};

async function openPage(label) {
  const page = await (await newContext()).newPage();
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
      action: text(selectors.action),
      notice: text(selectors.notice),
      combo: text(selectors.combo),
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
const unresolved = (customer) => !['delivered', 'left'].includes(customer.state);
const patienceSnapshot = (state) => state.debug.customers.map((customer) => ({
  index: customer.index,
  patience: customer.patience,
}));
const samePatience = (before, after) => before.every((value) => {
  const current = after.find((candidate) => candidate.index === value.index);
  return current && (value.patience == null || Math.abs(current.patience - value.patience) < 0.001);
});

async function approachCustomer(h, index, predicate, label) {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const s = await h.ui();
    const customer = customerAt(s, index);
    if (!customer?.screen) return null;
    await clickAt(h.page, customer.screen);
    const reached = await h.waitFor(predicate, 850, label);
    if (reached) return reached;
  }
  return null;
}

async function askCustomer(h, index, { checkFreeze = false, remember = true } = {}) {
  const prompt = await approachCustomer(
    h,
    index,
    (state) => state.fallback.length > 0,
    `question prompt for customer ${index}`,
  );
  if (!prompt) return null;

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

  await h.page.click('.lesson-hud__fallback');
  const answer = await h.waitFor(
    (state) => customerAt(state, index)?.state === 'awaiting'
      && state.bubble
      && /^I like .+\.$/.test(state.bubble),
    7000,
    `answer from customer ${index}`,
  );
  // The accepted prompt's fallback buttons stay visible through a short speech
  // cooldown. Wait for them to clear, or the next approachCustomer() mistakes
  // this stale prompt for the next customer's and taps a dead button.
  if (answer) await h.waitFor((state) => state.fallback.length === 0, 3000, 'accepted prompt to clear');
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
      s = await h.waitFor(
        (state) => state.debug?.customers.some((candidate) => candidate.cueShowing),
        8000,
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
    const delivered = target?.state === 'delivered'
      && beforeTarget.state !== 'delivered'
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

async function finishTurnaround(h, screenshotName) {
  const s = await h.waitFor(
    (state) => state.debug?.phase === 'turnaround' && state.fallback.length >= 3,
    18000,
    'turnaround',
  );
  check('turnaround opens under speech focus', s?.debug?.focusActive, JSON.stringify(s?.debug));
  if (!s) return null;
  await h.sleep(800);
  await h.page.screenshot({ path: screenshotName });
  const choice = s.fallback.find((answer) => answer.value === CHOICE);
  check(`turnaround offers "I like ${CHOICE}."`, choice, s.fallback.map((answer) => answer.text).join(' | '));
  await h.page.click(choice ? `.lesson-hud__fallback[data-value="${CHOICE}"]` : '.lesson-hud__fallback');
  return h.waitFor((state) => !state.restaurant && state.greeting !== null, 15000, 'hub return');
}

// ---- Session A: listen, remember, deliver first try ---------------------
{
  const h = await openPage('listening');
  const { page } = h;
  let s = await enterRestaurant(h);
  check('hub -> Restaurant at 1366x768', s?.restaurant && s?.debug?.level === LEVEL,
    JSON.stringify({ level: s?.debug?.level }));
  s = await h.waitFor((state) => state.debug?.customers.some((customer) => customer.cueShowing), 12000, 'order cue');
  check('all four level-2 customers are seated', s?.debug?.customers.length === 4
    && s.debug.customers.every((customer) => ['seated', 'orderCue', 'awaiting'].includes(customer.state)),
    JSON.stringify(s?.debug?.customers.map((customer) => customer.state)));
  check('a raised-order cue is exposed without food content', s?.debug?.customers.some((customer) => customer.cueShowing));
  await page.screenshot({ path: `${OUT}-01-seated-order-cue.png` });

  const remembered = new Map();
  const duplicateEntry = [...s.debug.customers.reduce((foods, customer) => {
    const indexes = foods.get(customer.food) ?? [];
    indexes.push(customer.index);
    foods.set(customer.food, indexes);
    return foods;
  }, new Map())].find(([, indexes]) => indexes.length >= 2) ?? null;
  const duplicateFood = duplicateEntry?.[0] ?? null;
  const duplicateIndexes = duplicateEntry?.[1].slice(0, 2) ?? [];
  let duplicateChecked = false;
  // Hold dishes of the repeated food back only while the either-customer check
  // is still pending and still possible. Once it has run, or fewer than two
  // customers with that food remain, holding would strand the last one unserved.
  const holdDuplicate = (state) => Boolean(duplicateFood) && !duplicateChecked
    && state.debug.customers.filter((customer) => unresolved(customer)
      && customer.food === duplicateFood).length >= 2
    && !(duplicateIndexes.every((index) => remembered.get(index) === duplicateFood)
      && state.debug.customers.filter((customer) => customer.state === 'awaiting'
        && customer.food === duplicateFood).length >= 2);
  await askShowingCues(h, remembered, { checkFreeze: true, minimum: 2 });
  s = await h.waitFor((state) => state.debug?.readyDishes.length >= 2, 25000, 'two ready dishes');
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
  while (s?.debug?.phase === 'service' && s.debug.customers.some(unresolved)) {
    s = await h.ui();
    if (s.debug?.customers.some((customer) => customer.cueShowing)) {
      await askShowingCues(h, remembered);
      s = await h.ui();
      continue;
    }

    const dish = s.debug.readyDishes.find((candidate) => candidate.food !== duplicateFood || !holdDuplicate(s))
      ?? null;
    if (!dish) {
      s = await h.waitFor(
        (state) => state.debug?.phase !== 'service'
          || state.debug?.customers.some((customer) => customer.cueShowing)
          || state.debug?.readyDishes.some(
            (candidate) => candidate.food !== duplicateFood || !holdDuplicate(state),
          ),
        25000,
        'next cue or deliverable dish',
      );
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
    const testingDuplicate = !duplicateChecked && carriedFood === duplicateFood && matching.length >= 2;
    const target = testingDuplicate ? matching[matching.length - 1] : matching[0];
    check(`remember who ordered ${carriedFood}`, target, JSON.stringify([...remembered]));
    if (!target) break;
    const result = await offerDish(h, target.index);
    check(`first-try ${carriedFood} delivery is accepted`, result.outcome === 'delivered',
      `${result.outcome} — target ${target.index} ${JSON.stringify(
        result.state?.debug?.customers?.map((c) => [c.index, c.state, c.food]),
      )} carried ${JSON.stringify(result.state?.debug?.carried)}`);
    s = result.state;
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
  check('all level-2 customers resolve in the listening session',
    remembered.size === 4 && s?.debug?.customers.every((customer) => customer.state === 'delivered'),
    JSON.stringify(s?.debug?.customers));
  check('combo pop was captured', comboShot);
  if (duplicateFood) {
    check(`duplicate-food session exercises ${duplicateFood}`, duplicateChecked,
      JSON.stringify({ duplicateIndexes, remembered: [...remembered] }));
  } else {
    console.log('SKIP  repeated-food acceptance (this random session had no duplicate orders)');
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
  while (s?.debug?.phase === 'service' && s.debug.customers.some(unresolved)) {
    s = await h.ui();
    if (!s.debug?.carried && s.debug?.customers.some((customer) => customer.cueShowing)) {
      await askShowingCues(h, null, { remember: false });
      s = await h.ui();
      continue;
    }
    if (!s.debug?.carried && s.debug?.readyDishes.length === 0) {
      s = await h.waitFor(
        (state) => state.debug?.phase !== 'service'
          || state.debug?.customers.some((customer) => customer.cueShowing)
          || state.debug?.readyDishes.length > 0,
        25000,
        'sweep cue or dish',
      );
      continue;
    }
    if (!s || s.debug.phase !== 'service') break;
    if (!s.debug.carried) {
      await h.waitFor((state) => !state.bubble, 7000, 'English answer to clear');
      s = await h.ui();
      const dish = s.debug.readyDishes[0];
      s = await collectDish(h, dish);
      if (!s) break;
      currentDishHadWrong = false;
    }
    const carriedFood = s.debug.carried?.food ?? s.debug.carried;
    // A raised hand takes an order rather than refusing a dish, so the sweep
    // offers plates only to customers without one.
    let targets = s.debug.customers.filter((customer) => unresolved(customer) && !customer.cueShowing)
      .sort((a, b) => a.index - b.index);
    // Ignore the spoken answers, but force the sweep to begin at a wrong table
    // for every plate. This makes the scoring assertion deterministic despite
    // independent food assignment and repeats.
    const knownWrong = targets.find(
      (customer) => customer.state !== 'awaiting' || customer.food !== carriedFood,
    );
    if (knownWrong) targets = [knownWrong, ...targets.filter((customer) => customer.index !== knownWrong.index)];
    for (const target of targets) {
      const result = await offerDish(h, target.index);
      s = result.state;
      if (result.outcome === 'delivered') {
        if (currentDishHadWrong) recoveredAfterWrong = true;
        break;
      }
      if (result.outcome === 'refused' && !wrongChecked) {
        const stillCarried = s.debug.carried?.food ?? s.debug.carried;
        const englishRepeated = Boolean(s.bubble && /^I like .+\.$/.test(s.bubble));
        check('wrong delivery leaves the same dish in hand', stillCarried === carriedFood,
          JSON.stringify({ before: carriedFood, after: stillCarried }));
        check('wrong delivery refuses without repeating the English answer', !englishRepeated,
          JSON.stringify({ bubble: s.bubble, instruction: s.instruction }));
        wrongChecked = true;
        await page.screenshot({ path: `${OUT}-06-wrong-delivery.png` });
      }
      if (result.outcome === 'refused') currentDishHadWrong = true;
    }
  }
  check('anti-shortcut run exercised a wrong delivery', wrongChecked);
  check('the order is recoverable after a wrong delivery', recoveredAfterWrong);
  check('guessing remains recoverable and resolves every customer',
    s?.debug?.customers.every((customer) => customer.state === 'delivered'),
    JSON.stringify(s?.debug?.customers));
  s = await finishTurnaround(h, `${OUT}-07-sweep-turnaround.png`);
  check('guessing session still finishes', s);
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '{}'), SAVE_KEY);
  const stars = saved?.bestStars?.restaurant ?? null;
  check('anti-shortcut sweep still earns the stamp', saved?.stamps?.restaurant === true,
    JSON.stringify(saved?.stamps));
  check('anti-shortcut sweep cannot reach three stars', stars !== null && stars < 3,
    JSON.stringify(saved?.bestStars));
  await page.close();
}

check('no console or page errors', errors.length === 0, errors.slice(0, 3).join(' || '));
const failed = results.filter((result) => !result.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
await browser.close();
if (failed > 0) process.exitCode = 1;
