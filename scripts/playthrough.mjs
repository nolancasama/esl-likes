// Scripted Restaurant rush-hour playthrough.
// Run after building and starting the preview server:
//   node scripts/playthrough.mjs http://localhost:5199/ .tmp/restaurant pizza
//
// A short mock-mic probe checks dwell behavior. Session A then remembers every
// person-food pair and delivers correctly through the mic-free fallback;
// Session B ignores the answers and deliberately loses first-try credit.
// Separate contexts keep best-stars state from leaking between sessions.
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
import { LESSON_BY_ID, UI } from '../src/config/lesson.js';
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
const BELT_FRONT_Z = -4.4;
const BELT_FRONT_BAND = 1.15;
const BELT_PICKUP_WINDOW = 1.4;
const BELT_ARRIVAL_WINDOW = 1.6;
const CLEAR_AISLES = Object.freeze([-2.1, 2.1]);
// The only row that crosses the room clear of every table with room for key
// overshoot: behind the back tables (z <= -2.12) and in front of the belt wall.
const CROSSING_Z = -3.3;
const HARNESS_AUTO_SPEED = 5.7; // src AUTO_SPEED, used to estimate click-to-walk time
const STAGNATION_GAME_SECONDS = 45;
const DEFAULT_SEED = 0x5eed0914;
const FORCE_MISS_PICKUP = process.env.RESTAURANT_FORCE_MISS_PICKUP === '1';
const seedValue = (input) => {
  if (input === undefined || input === '') return DEFAULT_SEED;
  const numeric = Number(input);
  if (Number.isSafeInteger(numeric)) return numeric >>> 0;
  let hash = 2166136261;
  for (const character of input) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};
const RESTAURANT_SEED = seedValue(process.env.RESTAURANT_SEED);
console.log(`Restaurant seed: ${RESTAURANT_SEED}${FORCE_MISS_PICKUP ? ' (forced missed pickup)' : ''}`);
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
  await context.addInitScript(({ key, level, useMicFree, seed }) => {
    let randomState = seed >>> 0;
    Math.random = () => {
      randomState = (randomState + 0x6d2b79f5) >>> 0;
      let value = randomState;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
    Object.defineProperty(window, '__restaurantHarnessSeed', { value: seed, configurable: false });
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem(key, JSON.stringify({
        version: 1,
        settings: { micFree: useMicFree, difficulty: level },
      }));
      sessionStorage.setItem('seeded', '1');
    }
  }, { key: SAVE_KEY, level: difficulty, useMicFree: micFree, seed: RESTAURANT_SEED });
  return context;
}

const CHECK_REGISTRY = Object.freeze({
  'Conversation probe': Object.freeze([
    'mic probe enters Restaurant with the speech mock installed',
    'a raised hand appears for the dwell probe',
    'running passes through a raised customer talk radius',
    'running past a raised hand opens no prompt or speech focus',
    'click-to-walk arrival does not listen before the dwell completes',
    'a scripted correct question is accepted after the dwell',
    'a second raised hand appears for the silence probe',
    'scripted silence ends in try-again',
    'the microphone does not auto-reopen while standing still after silence',
  ]),
  Normal: Object.freeze([
    'hub -> Restaurant at 1366x768',
    'Restaurant exposes the frozen conveyor debug contract',
    'belt enters beyond the right wall and exits beyond the left wall',
    'legacy bell, ready cue, and counter are absent',
    'the host is out of the room during service',
    'the MATSUBARA RESTAURANT sign is visible inside the 1366x768 viewport',
    'precondition: service is active with no dishes on the conveyor',
    'belt travel increases during service with no dishes on the belt',
    'level 2 reports the seven-customer shift total',
    'customer debug identities include their table',
    'a raised-order cue is exposed without food content',
    'no customer shows a food cue',
    'each approached customer opens a question prompt',
    'each question prompt has a fallback answer',
    'each answered customer transitions to awaiting',
    'each remembered answer is an English food answer',
    'each remembered answer agrees with the order',
    'Normal reaches three unresolved player orders',
    'several dishes coexist on Normal',
    'dedicated click-to-walk pickup probe collects its targeted dish',
    'dedicated interact-key pickup probe collects its targeted dish',
    'reliable fulfillment pickups collect their targeted dishes',
    'remembered orders identify matching delivery customers',
    'delivery target remains eligible at commit',
    'deliveries to confirmed awaiting customers commit',
    'listening shift maintains semantic progress through completion',
    'speech focus is active for the mic-free prompt',
    'all customer patience is frozen while the prompt is open',
    'speech focus freezes belt travel and every dish position',
    'belt travel and dishes resume from their frozen values after speech focus',
    'precondition: a dish is carried beside a raised hand at the back-right table',
    'carrying a dish does not block opening the back-right table conversation',
    'a replacement customer is seated after an earlier customer resolves',
    'the service director reaches rush',
    'the listening shift reaches its full reported total',
    'all seven customers resolve as successful deliveries in the listening session',
    'first-try combo reaches two',
    'combo pop was captured',
    'repeated foods still deliver correctly',
    'precondition: a completed preparation is observed through pending supply and belt entry',
    'due food enters within the Normal SPEC bound after preparation completes',
    'entry order can differ from asking order',
    'a dish is observed to exit past exitX',
    'a missed due dish re-enters later',
    'a wrongly picked dish can be returned at dishReturn',
    'the order still completes after returning a wrongly picked dish',
    'turnaround opens under speech focus',
    'the host is in the room at turnaround',
    'turnaround offers the configured food choice',
    'listening session finishes back at the hub',
    'Restaurant debug hook is removed on exit',
    'listening session earns the Restaurant stamp',
    'listening first-try session earns three stars',
  ]),
  'Anti-shortcut': Object.freeze([
    'anti-shortcut session enters Restaurant',
    'each approached customer opens a question prompt',
    'each question prompt has a fallback answer',
    'each answered customer transitions to awaiting',
    'reliable fulfillment pickups collect their targeted dishes',
    'delivery target remains eligible at commit',
    'anti-shortcut shift maintains semantic progress through completion',
    'a non-final plate gets a deterministic wrong target',
    'the selected different-food customer refuses the plate',
    'wrong delivery leaves the same dish in hand',
    'wrong delivery refuses without repeating the English answer',
    'a wrong-first plate remains recoverable at its matching customer',
    'anti-shortcut run exercised a wrong delivery',
    'the order is recoverable after a wrong delivery',
    'guessing remains recoverable and resolves the full shift total',
    'the anti-shortcut result contains exactly one record per customer',
    'the deterministic sweep is below the scoring first-try cap',
    'turnaround opens under speech focus',
    'the host is in the room at turnaround',
    'turnaround offers the configured food choice',
    'guessing session still finishes',
    'anti-shortcut sweep still earns the stamp',
    'anti-shortcut sweep cannot reach three stars',
  ]),
  Challenge: Object.freeze([
    'Challenge session enters Restaurant at level 3',
    'Challenge opens with the lunch-rush phase pill',
    'precondition: an unclaimed raised hand can stage the rival race',
    'precondition: the staged dwell reserves the camp customer before commit',
    'precondition: cancelling the staged dwell releases the player reservation',
    'precondition: the rival walks toward the staged unclaimed customer',
    'precondition: player dwell reserves the customer while the rival is approaching',
    'precondition: speech focus opens on the reserved customer',
    'precondition: the reserved Challenge conversation commits successfully',
    'a player dwell keeps the approached customer and makes the rival abandon it',
    'precondition: the rival claims an unclaimed Challenge customer',
    'rival-owned customers never become click-to-talk or dwell targets',
    'precondition: the rival hatch visibly contains its own ready dish',
    'the player can never collect from rivalHatch on Challenge',
    'precondition: the rival completes a claimed customer',
    'precondition: a second raised hand exists while the rival approaches another customer',
    'precondition: both waiters begin their separate routes',
    'each approached customer opens a question prompt',
    'each question prompt has a fallback answer',
    'each answered customer transitions to awaiting',
    'each remembered answer is an English food answer',
    'each remembered answer agrees with the order',
    'precondition: Challenge offers a new raised hand while player food is ready',
    'Challenge reaches four unresolved player orders',
    'precondition: a player dish is ready for the ownership probe',
    'precondition: a rival-owned customer exists while the player carries a dish',
    'deliver ignores rival-owned customers and leaves the player dish carried',
    'the rival-hatch ownership probe completed',
    'delivery target remains eligible at commit',
    'Challenge shift maintains semantic progress through completion',
    'several dishes coexist on Challenge',
    'restaurant-E-rush.png is captured in the required Challenge rush state',
    'speech focus freezes rival state, target, position and carried food',
    'Challenge shared service resolves its full reported total',
    'precondition: both waiters complete at least one table for the score HUD',
    'Challenge score pill reflects both completed-table counts',
    'turnaround opens under speech focus',
    'the host is in the room at turnaround',
    'the final result shows both player and rival counts plainly',
    'turnaround offers the configured food choice',
    'Challenge session finishes back at the hub',
    'the staged ownership takeover completed',
  ]),
  Review: Object.freeze([
    'precondition: restaurant-A-back-wall.png reaches whole room, belt, both openings, and sign',
    'restaurant-A-back-wall.png is captured with whole room, belt, both openings, and sign',
    'precondition: restaurant-B-multiple-dishes.png reaches at least two visible conveyor dishes',
    'restaurant-B-multiple-dishes.png is captured with at least two visible conveyor dishes',
    'precondition: restaurant-C-dish-entering.png reaches dish within 1.5 units inside the right opening',
    'restaurant-C-dish-entering.png is captured with dish within 1.5 units inside the right opening',
    'precondition: restaurant-D-dish-exiting.png reaches dish within 1.5 units inside the left opening',
    'restaurant-D-dish-exiting.png is captured with dish within 1.5 units inside the left opening',
    'no console or page errors',
  ]),
});
const results = Object.entries(CHECK_REGISTRY).flatMap(([section, names]) => names.map((name) => ({
  section,
  name,
  ok: false,
  result: 'HARNESS_PRECONDITION_FAILED',
  detail: 'session did not reach this check',
  observed: false,
})));
const resultByName = new Map(results.map((result) => [`${result.section}: ${result.name}`, result]));
const trace = [];
const errors = [];
const reviewScreenshots = new Map();
const reviewCandidates = new Map();
let rivalSpeechFreezeReported = false;
let checkScope = '';
const recordCheck = (name, ok, detail, classification) => {
  const scopedName = checkScope ? `${checkScope}: ${name}` : name;
  const result = resultByName.get(scopedName);
  if (!result) throw new Error(`Unregistered Restaurant check: ${scopedName}`);
  const observation = { section: checkScope, name, result: classification, detail: detail || '' };
  trace.push(observation);
  if (!result.observed || (result.result === 'PASS' && classification !== 'PASS')) {
    Object.assign(result, { ok: Boolean(ok), result: classification, detail: detail || '', observed: true });
  }
  return Boolean(ok);
};
const check = (name, ok, detail = '') => recordCheck(
  name, ok, detail, ok ? 'PASS' : 'PRODUCT_FAILURE',
);
const precondition = (name, value, detail = '') => {
  const ok = Boolean(value);
  return recordCheck(name, ok, detail, ok ? 'PASS' : 'HARNESS_PRECONDITION_FAILED');
};
// An outcome that only means something once its session reached that point.
const outcomeCheck = (name, reached, ok, detail = '') => (reached
  ? check(name, ok, detail)
  : precondition(name, false, JSON.stringify({
    unreached: 'the shift did not reach its semantic end', detail,
  })));

async function openPage(label, options = {}) {
  const page = await (await newContext(options)).newPage();
  const observations = {
    entries: [],
    exits: [],
    preparationCompleted: [],
    reentries: [],
    seenDishIds: new Set(),
    seenPendingKeys: new Set(),
    reentryFoods: new Map(),
    previousDishes: new Map(),
    screenshots: new Set(),
    reviewStates: new Map(),
    maxVisibleDishes: 0,
    speechFreezeChecked: false,
  };
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`${label}: ${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`${label}: PAGEERROR ${error.message}`));
  const sleep = (ms) => page.waitForTimeout(ms);
  const rawUi = () => page.evaluate((selectors) => {
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
      instruction: q('.restaurant-ui .restaurant-ui__hint')?.textContent.trim() ?? null,
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
      transition: (() => {
        const wipe = q('#scene-wipe');
        const rect = wipe?.getBoundingClientRect();
        const animations = wipe?.getAnimations?.() ?? [];
        const active = animations.some((animation) => animation.playState === 'running'
          || animation.playState === 'pending');
        const width = rect?.width ?? window.innerWidth;
        return { active, width, clear: !active && width <= 1 };
      })(),
      debug,
    };
  }, SEL);
  const ui = async () => {
    const state = await rawUi();
    const conveyor = state.debug?.conveyor;
    if (!conveyor) return state;
    const currentIds = new Set(conveyor.dishes.map((dish) => dish.id));
    for (const prior of observations.previousDishes.values()) {
      if (!currentIds.has(prior.id) && prior.x <= conveyor.exitX + 0.35) {
        observations.exits.push(prior);
      }
    }
    for (const pending of conveyor.pending) {
      const key = `${pending.food}:${pending.dueAt}:${pending.reentry}`;
      if (observations.seenPendingKeys.has(key)) continue;
      observations.seenPendingKeys.add(key);
      const event = { ...pending, beltTravel: conveyor.beltTravel };
      if (pending.reentry) observations.reentryFoods.set(
        pending.food, (observations.reentryFoods.get(pending.food) ?? 0) + 1,
      );
      else observations.preparationCompleted.push(event);
    }
    for (const dish of conveyor.dishes) {
      if (observations.seenDishIds.has(dish.id)) continue;
      observations.seenDishIds.add(dish.id);
      const reentry = !dish.filler && (observations.reentryFoods.get(dish.food) ?? 0) > 0;
      const event = { ...dish, beltTravel: conveyor.beltTravel, reentry };
      observations.entries.push(event);
      if (reentry) {
        observations.reentries.push(event);
        observations.reentryFoods.set(dish.food, observations.reentryFoods.get(dish.food) - 1);
      }
    }
    observations.previousDishes = new Map(conveyor.dishes.map((dish) => [dish.id, { ...dish }]));

    const visibleDishes = conveyor.dishes.filter((dish) => Math.abs(dish.x) <= conveyor.visibleHalfWidth);
    observations.maxVisibleDishes = Math.max(observations.maxVisibleDishes, visibleDishes.length);
    const onScreen = (dish, candidate) => dish?.screen
      && Number.isFinite(dish.screen.x) && Number.isFinite(dish.screen.y)
      && dish.screen.x >= 0 && dish.screen.x <= 1366
      && dish.screen.y >= 0 && dish.screen.y <= 768
      && Math.abs(dish.x) < candidate.debug.conveyor.visibleHalfWidth;
    const capture = async (name, qualify) => {
      if (observations.screenshots.has(name) || reviewScreenshots.has(name)) return;
      // The belt and wipe can change between ui() calls, so the screenshot is
      // qualified only by this fresh snapshot taken immediately before it.
      const candidate = await rawUi();
      const evidence = qualify(candidate, onScreen);
      if (!evidence) return;
      observations.reviewStates.set(name, evidence);
      reviewCandidates.set(name, evidence);
      if (!evidence.rendered) return;
      observations.screenshots.add(name);
      reviewScreenshots.set(name, evidence);
      console.log(`  (review screenshot restaurant-${name}.png: ${JSON.stringify(evidence)})`);
      await page.screenshot({ path: `${OUT}-${name}.png` });
    };
    await capture('A-back-wall', (candidate) => {
      const ready = candidate.transition.clear && candidate.debug?.lifecycle === 'service'
        && candidate.debug?.sign?.visible
        && candidate.debug.sign.text === 'MATSUBARA RESTAURANT'
        && candidate.debug.conveyor.entryX > 6.85 && candidate.debug.conveyor.exitX < -6.85
        && candidate.debug.conveyor.direction === -1;
      return ready ? { dishId: null, x: null, transition: candidate.transition, rendered: true } : null;
    });
    await capture('B-multiple-dishes', (candidate, rendered) => {
      const dishes = visibleBeltDishes(candidate);
      if (dishes.length < 2 || !candidate.transition.clear) return null;
      return { dishId: dishes[0].id, x: dishes[0].x, transition: candidate.transition,
        rendered: dishes.slice(0, 2).every((dish) => rendered(dish, candidate)) };
    });
    await capture('C-dish-entering', (candidate, rendered) => {
      const belt = candidate.debug?.conveyor;
      const dish = belt?.dishes.find((item) => item.x <= belt.entryX && item.x >= belt.entryX - 1.5);
      if (!dish || !candidate.transition.clear) return null;
      return { dishId: dish.id, x: dish.x, transition: candidate.transition,
        rendered: rendered(dish, candidate) };
    });
    await capture('D-dish-exiting', (candidate, rendered) => {
      const belt = candidate.debug?.conveyor;
      const dish = belt?.dishes.find((item) => item.x >= belt.exitX && item.x <= belt.exitX + 1.5);
      if (!dish || !candidate.transition.clear) return null;
      return { dishId: dish.id, x: dish.x, transition: candidate.transition,
        rendered: rendered(dish, candidate) };
    });
    await capture('E-rush', (candidate, rendered) => {
      const dishes = visibleBeltDishes(candidate);
      const ready = options.difficulty === 3 && candidate.transition.clear
        && playerOrders(candidate).length >= 2 && dishes.length >= 2
        && candidate.debug.customers.some((customer) => customer.cueShowing);
      return ready ? { dishId: dishes[0].id, x: dishes[0].x, transition: candidate.transition,
        rendered: dishes.slice(0, 2).every((dish) => rendered(dish, candidate)) } : null;
    });
    return state;
  };
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
  return { page, sleep, ui, waitFor, hold, observations };
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
  return h.waitFor((state) => state.restaurant && state.debug && state.transition.clear,
    8000, 'Restaurant transition and intro to finish');
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
const semanticState = (state) => ({
  progress: progressOf(state),
  lifecycle: serviceLifecycle(state),
  customers: state?.debug?.customers?.map((customer) => ({
    id: customer.id ?? customer.index,
    state: customer.state,
    owner: customer.owner,
    food: customer.food,
  })) ?? [],
  carried: state?.debug?.carried ? {
    dishId: state.debug.carried.dishId,
    food: state.debug.carried.food,
    customer: state.debug.carried.customer,
  } : null,
  beltDishes: beltDishes(state).map((dish) => ({ id: dish.id, food: dish.food, filler: dish.filler })),
});
function createStagnationWatchdog(initial) {
  let signature = JSON.stringify(semanticState(initial));
  let progressedAt = gameSeconds(initial);
  let last = semanticState(initial);
  return {
    observe(state) {
      const next = semanticState(state);
      const nextSignature = JSON.stringify(next);
      const now = gameSeconds(state);
      if (nextSignature !== signature) {
        signature = nextSignature;
        progressedAt = now;
      }
      last = next;
      return now - progressedAt < STAGNATION_GAME_SECONDS;
    },
    detail(state) {
      return {
        stagnantGameSeconds: gameSeconds(state) - progressedAt,
        limitGameSeconds: STAGNATION_GAME_SECONDS,
        lastState: last,
      };
    },
  };
}
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
    precondition('each approached customer opens a question prompt', false,
      JSON.stringify({ customer: customerAt(missing, index), debug: missing.debug }));
    await h.page.screenshot({ path: `${OUT}-missing-question-${index}.png` });
    return null;
  }

  let frozenConveyor = null;
  if (checkFreeze && beltDishes(prompt).length > 0) {
    // Let the short focus-enter ramp reach zero before measuring. Every meter
    // must remain still for the rest of the protected interaction.
    await h.sleep(350);
    const focused = await h.ui();
    const before = patienceSnapshot(focused);
    frozenConveyor = focused.debug?.conveyor;
    h.observations.speechFreezeChecked = true;
    await h.sleep(1800);
    const afterState = await h.ui();
    const after = patienceSnapshot(afterState);
    check('speech focus is active for the mic-free prompt', focused.debug.focusActive && afterState.debug.focusActive);
    check('all customer patience is frozen while the prompt is open', samePatience(before, after),
      JSON.stringify({ before, after }));
    const afterConveyor = afterState.debug?.conveyor;
    check('speech focus freezes belt travel and every dish position',
      frozenConveyor && afterConveyor
        && afterConveyor.beltTravel === frozenConveyor.beltTravel
        && afterConveyor.dishes.length === frozenConveyor.dishes.length
        && frozenConveyor.dishes.every((dish) =>
          afterConveyor.dishes.some((candidate) => candidate.id === dish.id && candidate.x === dish.x)),
    JSON.stringify({ before: frozenConveyor, after: afterConveyor }));
  }

  if (checkRivalFreeze) {
    // Only a moving rival makes this meaningful. Whether it is still walking when
    // the prompt opens depends on route timing; rival.test.mjs covers zero dt.
    if (rivalIsWalking(prompt) && !rivalSpeechFreezeReported) {
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
      rivalSpeechFreezeReported = true;
    } else {
      console.log(`  (rival not mid-walk when customer ${index} prompt opened; freeze not sampled here)`);
    }
  }

  const answerButton = prompt.fallback[0];
  if (!answerButton) {
    precondition('each question prompt has a fallback answer', false,
      JSON.stringify({ customerIndex: index, prompt }));
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
    precondition('each answered customer transitions to awaiting', false,
      JSON.stringify({ customer: customerAt(missing, index), debug: missing.debug }));
    await h.page.screenshot({ path: `${OUT}-missing-answer-${index}.png` });
    return null;
  }
  // The accepted prompt's fallback buttons stay visible through a short speech
  // cooldown. Wait for them to clear, or the next approachCustomer() mistakes
  // this stale prompt for the next customer's and taps a dead button.
  await h.waitFor((state) => state.fallback.length === 0, 3000, 'accepted prompt to clear');
  if (frozenConveyor) {
    const resumed = await h.waitFor((state) =>
      state.debug?.conveyor?.beltTravel > frozenConveyor.beltTravel, 4000, 'conveyor to resume after speech focus');
    const resumedConveyor = resumed?.debug?.conveyor;
    const travelDelta = (resumedConveyor?.beltTravel ?? NaN) - frozenConveyor.beltTravel;
    const continuedFromFrozenPositions = frozenConveyor.dishes.every((dish) => {
      const current = resumedConveyor?.dishes.find((candidate) => candidate.id === dish.id);
      return !current || Math.abs(current.x
        - (dish.x + frozenConveyor.direction * travelDelta)) < 0.03;
    });
    check('belt travel and dishes resume from their frozen values after speech focus',
      Boolean(resumedConveyor) && continuedFromFrozenPositions,
    JSON.stringify({ frozen: frozenConveyor, resumed: resumedConveyor }));
  }
  const spoken = answer?.bubble.match(/^I like (.+)\.$/)?.[1]?.toLowerCase() ?? null;
  const food = spoken === null ? null : (FOOD_BY_SENTENCE.get(spoken) ?? spoken);
  precondition('each approached customer opens a question prompt', true,
    JSON.stringify({ customerIndex: index }));
  precondition('each question prompt has a fallback answer', true,
    JSON.stringify({ customerIndex: index, answerButton }));
  precondition('each answered customer transitions to awaiting', true,
    JSON.stringify({ customerIndex: index, customer: customerAt(answer, index) }));
  if (remember) {
    check('each remembered answer is an English food answer', food,
      JSON.stringify({ customerIndex: index, bubble: answer?.bubble }));
    check('each remembered answer agrees with the order', food === customerAt(answer, index)?.food,
      JSON.stringify({ customerIndex: index, heard: food, debug: customerAt(answer, index)?.food }));
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

const beltDishes = (state) => state?.debug?.conveyor?.dishes ?? [];
const visibleBeltDishes = (state) => beltDishes(state).filter((dish) =>
  Math.abs(dish.x) <= (state?.debug?.conveyor?.visibleHalfWidth ?? -1));
// A dish is worth walking to only if it stays visible for the walk plus a margin.
const pickupLeadOk = (state, dish) => {
  const conveyor = state?.debug?.conveyor;
  const player = state?.debug?.player;
  if (!conveyor || !player || !(conveyor.speed > 0)) return false;
  const exitEdge = conveyor.direction < 0 ? -conveyor.visibleHalfWidth : conveyor.visibleHalfWidth;
  const remainingSeconds = Math.abs(dish.x - exitEdge) / conveyor.speed;
  const walkSeconds = (Math.abs(player.x - dish.x) + Math.abs(player.z - BELT_FRONT_Z))
    / HARNESS_AUTO_SPEED;
  return remainingSeconds >= walkSeconds + 1;
};
// Skip dishes still crossing the entry edge: they become visible and
// collectable in the same game update, which no page observer can see first.
const reachableBeltDishes = (state) => visibleBeltDishes(state)
  .filter((dish) => Math.abs(dish.x) <= (state.debug.conveyor.visibleHalfWidth - 0.3)
    && pickupLeadOk(state, dish));

const TABLE_SEATS = Object.freeze([
  { x: -4.2, z: -2.05 },
  { x: 0, z: 0.75 },
  { x: 4.2, z: -2.05 },
  { x: -4.2, z: 2.85 },
  { x: 4.2, z: 2.85 },
]);
const RIVAL_WALK_SPEED = 3.75; // rival.js RIVAL_SPEED; a walk lasts distance / speed
const rivalWalkSecondsLeft = (state) => {
  const rival = state?.debug?.rival;
  if (!rivalIsWalking(state) || !rival?.position) return 0;
  let destination = null;
  if (rival.state === 'walkingToPass') {
    const hatch = state.debug.rivalHatch?.position;
    destination = Number.isFinite(hatch?.x) ? hatch : { x: -5.95, z: 1.45 };
  } else {
    const customer = state.debug.customers.find((candidate) =>
      (candidate.id ?? candidate.index) === rival.targetCustomer);
    destination = customer ? TABLE_SEATS[tableOf(customer)] : null;
  }
  if (!destination) return 0;
  return Math.hypot(destination.x - rival.position.x, destination.z - rival.position.z)
    / RIVAL_WALK_SPEED;
};

// Walk plus the 1.2 s dwell outlasts most rival walks, so no approach from a
// distance opens a prompt mid-walk. Instead wait just outside the customer's
// 2.7 talk radius and step in (facing them) when the rival has just begun a
// long walk to someone else; the prompt then opens 1.2 s later.
let rivalFreezeStagings = 0;
async function stageRivalFreezePrompt(h, cue, remembered) {
  if (rivalFreezeStagings >= 4) return false;
  rivalFreezeStagings += 1;
  const table = tableOf(cue);
  const seat = TABLE_SEATS[table];
  if (!seat) return false;
  // Table 1's own table is behind its seat, so approach it from the front.
  const front = table === 1;
  const stand = { x: seat.x, z: front ? seat.z - 3.1 : seat.z + 3.1 };
  const stepZ = front ? stand.z + 0.8 : stand.z - 0.8;
  const id = cue.id ?? cue.index;
  const eligible = (state) => {
    const live = customerAt(state, cue.index);
    return Boolean(live?.cueShowing) && customerOwner(live) !== 'rival';
  };
  if (!await walkClear(h, stand)) return false;
  const ready = await h.waitFor((state) => !eligible(state) || (rivalIsWalking(state)
    && state.debug.rival.targetCustomer !== id
    && rivalWalkSecondsLeft(state) > 1.9), 12000, 'long rival walk while waiting beside a raised hand');
  if (!ready || !eligible(ready)) return false;
  if (!await moveAxisTo(h, 'z', stepZ, 0.2)) return false;
  const prompt = await h.waitFor((state) => state.fallback.length > 0 && state.debug?.focusActive,
    3000, `staged rival-freeze prompt at customer ${cue.index}`);
  if (!prompt) return false;
  if (prompt.debug?.question?.customer === id && rivalIsWalking(prompt)) {
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
    JSON.stringify({ before, after, staged: true }));
    rivalSpeechFreezeReported = true;
  } else {
    console.log(`  (staged prompt at customer ${cue.index} opened after the rival walk ended)`);
  }
  const promptCustomer = prompt.debug?.question?.customer;
  const promptIndex = prompt.debug?.customers.find((candidate) =>
    (candidate.id ?? candidate.index) === promptCustomer)?.index ?? cue.index;
  await h.page.click('.lesson-hud__fallback');
  const answered = await h.waitFor((state) => customerAt(state, promptIndex)?.state === 'awaiting'
    && /^I like .+\.$/.test(state.bubble ?? ''), 7000, 'staged rival-freeze answer');
  const spoken = answered?.bubble.match(/^I like (.+)\.$/)?.[1]?.toLowerCase() ?? null;
  const food = spoken === null ? null : (FOOD_BY_SENTENCE.get(spoken) ?? spoken);
  if (food) remembered.set(promptIndex, food);
  await h.waitFor((state) => state.fallback.length === 0, 3000, 'staged prompt to clear');
  return true;
}

async function moveAxisTo(h, axis, target, tolerance = 0.45) {
  let state = await h.ui();
  const start = state.debug?.player?.[axis];
  if (!Number.isFinite(start)) return null;
  if (Math.abs(start - target) <= tolerance) return state;
  const key = axis === 'x'
    ? (start < target ? 'KeyD' : 'KeyA')
    : (start < target ? 'KeyS' : 'KeyW');
  const startedAt = gameSeconds(state);
  let lastGameSeconds = startedAt;
  let lastPosition = { ...state.debug.player };
  let stagnantFrames = 0;
  let observedFrames = 0;
  await h.page.keyboard.down(key);
  try {
    const end = Date.now() + 6000;
    while (Date.now() < end) {
      state = await h.ui();
      const value = state.debug?.player?.[axis];
      if (Number.isFinite(value) && (Math.abs(value - target) <= tolerance
        || (start < target ? value >= target : value <= target))) return state;
      const currentGameSeconds = gameSeconds(state);
      if (currentGameSeconds > lastGameSeconds + 0.001) {
        observedFrames += 1;
        const position = state.debug?.player;
        const moved = position && Math.hypot(
          position.x - lastPosition.x,
          position.z - lastPosition.z,
        ) > 0.01;
        stagnantFrames = moved ? 0 : stagnantFrames + 1;
        lastPosition = position ? { ...position } : lastPosition;
        lastGameSeconds = currentGameSeconds;
        if (stagnantFrames >= 6) {
          h.lastMovementFailure = {
            reason: 'position unchanged across observed game frames while a key was held',
            axis,
            target,
            key,
            observedFrames,
            elapsedGameSeconds: currentGameSeconds - startedAt,
            lastPosition,
          };
          return null;
        }
      }
      await h.sleep(40);
    }
    h.lastMovementFailure = {
      reason: 'axis movement did not reach its target',
      axis,
      target,
      key,
      observedFrames,
      elapsedGameSeconds: gameSeconds(state) - startedAt,
      lastPosition,
    };
    return null;
  } finally {
    await h.page.keyboard.up(key);
  }
}

async function movePlayerTo(h, position) {
  if (!await moveAxisTo(h, 'x', position.x)) return null;
  return moveAxisTo(h, 'z', position.z);
}

const gameSeconds = (state) => {
  const conveyor = state?.debug?.conveyor;
  return conveyor?.speed > 0 ? conveyor.beltTravel / conveyor.speed : 0;
};

const nearestClearAisle = (x) => CLEAR_AISLES.reduce((nearest, candidate) =>
  (Math.abs(candidate - x) < Math.abs(nearest - x) ? candidate : nearest));

// Tables block straight key walks, so every harness key walk (other than the
// key probe's dish tracking along the belt front) goes aisle -> crossing row ->
// aisle on the target's side -> target.
async function walkClear(h, target) {
  const initial = await h.ui();
  const player = initial.debug?.player;
  if (!player) return null;
  const startAisle = nearestClearAisle(player.x);
  const targetAisle = Math.abs(target.x) < 0.01
    ? startAisle
    : CLEAR_AISLES.find((aisle) => Math.sign(aisle) === Math.sign(target.x));
  if (!await moveAxisTo(h, 'x', startAisle)) return null;
  if (targetAisle !== startAisle
    && (!await moveAxisTo(h, 'z', CROSSING_Z) || !await moveAxisTo(h, 'x', targetAisle))) return null;
  if (!await moveAxisTo(h, 'z', target.z)) return null;
  return moveAxisTo(h, 'x', target.x);
}

async function stageAtBeltFront(h) {
  const initial = await h.ui();
  return walkClear(h, { x: nearestClearAisle(initial.debug?.player?.x ?? 0), z: BELT_FRONT_Z });
}

async function installClickPickupLatch(page, dishId) {
  await page.evaluate(({ targetId, frontZ, frontBand, arrivalWindow }) => {
    const prior = window.__restaurantPickupLatch;
    if (prior) prior.active = false;
    const latch = {
      targetId,
      active: true,
      frames: 0,
      setup: null,
      last: null,
    };
    window.__restaurantPickupLatch = latch;
    const observe = () => {
      if (!latch.active) return;
      const source = window.__eslDebug?.restaurant;
      const debug = typeof source === 'function' ? source() : source;
      const dish = debug?.conveyor?.dishes?.find((candidate) => candidate.id === targetId);
      const player = debug?.player;
      latch.frames += 1;
      if (!dish || !player) {
        latch.active = false;
        return;
      }
      const visible = dish.screen
        && Number.isFinite(dish.screen.x) && Number.isFinite(dish.screen.y)
        && dish.screen.x >= 0 && dish.screen.x <= window.innerWidth
        && dish.screen.y >= 0 && dish.screen.y <= window.innerHeight
        && Math.abs(dish.x) <= debug.conveyor.visibleHalfWidth;
      latch.last = {
        dish: { id: dish.id, x: dish.x, visible: Boolean(visible) },
        player: { x: player.x, z: player.z },
      };
      if (visible
        && Math.abs(player.z - frontZ) <= frontBand
        && Math.abs(player.x - dish.x) <= arrivalWindow) {
        latch.setup = { ...latch.last, frame: latch.frames };
      }
      requestAnimationFrame(observe);
    };
    // Observe once before the click: when the player already stands in range,
    // the game collects in its next update, before any later latch frame runs.
    observe();
  }, { targetId: dishId, frontZ: BELT_FRONT_Z, frontBand: BELT_FRONT_BAND,
    arrivalWindow: BELT_ARRIVAL_WINDOW });
}

async function readClickPickupLatch(page) {
  return page.evaluate(() => {
    const latch = window.__restaurantPickupLatch;
    if (!latch) return null;
    latch.active = false;
    return JSON.parse(JSON.stringify(latch));
  });
}

async function forcedMissClick(h, dish) {
  const first = dish;
  const moved = await h.waitFor((state) => {
    const current = beltDishes(state).find((candidate) => candidate.id === first.id);
    const behindX = current
      ? current.x - state.debug.conveyor.direction * 3
      : Infinity;
    return current?.screen && Math.abs(current.x - first.x) >= 0.2
      && Math.abs(behindX) <= state.debug.conveyor.visibleHalfWidth;
  }, 6000, 'dish motion used to project a forced miss point on the belt');
  const current = beltDishes(moved).find((candidate) => candidate.id === first.id);
  if (!current?.screen || !first.screen || current.x === first.x) return false;
  const screenPerWorldX = (current.screen.x - first.screen.x) / (current.x - first.x);
  const screenPerWorldY = (current.screen.y - first.screen.y) / (current.x - first.x);
  const behindWorldUnits = -moved.debug.conveyor.direction * 3;
  await clickAt(h.page, {
    x: current.screen.x + screenPerWorldX * behindWorldUnits,
    y: current.screen.y + screenPerWorldY * behindWorldUnits,
  });
  await h.waitFor((state) => state.debug?.player?.autoWalking, 1200, 'forced miss click-to-walk');
  await h.waitFor((state) => !state.debug?.player?.autoWalking, 8000, 'forced miss walk to settle');
  return true;
}

async function collectDish(h, dish, method = 'click', { forceMiss = false } = {}) {
  const wantedId = dish?.id;
  const keySetupAt = (state) => {
    const current = beltDishes(state).find((candidate) => candidate.id === wantedId);
    const player = state.debug?.player;
    const visible = current?.screen
      && Math.abs(current.x) < (state.debug?.conveyor?.visibleHalfWidth ?? -1);
    return visible && player
      && Math.abs(player.z - BELT_FRONT_Z) <= BELT_FRONT_BAND
      && Math.abs(player.x - current.x) <= BELT_PICKUP_WINDOW
      && state.action === UI.restaurant.collectDish
      ? { dish: current, player: { ...player }, transition: state.transition }
      : null;
  };
  let setup = null;
  let state = await h.ui();
  const startedAt = gameSeconds(state);
  let attempts = 0;
  h.lastMovementFailure = null;
  if (state.debug?.carried) return { state, setup: null, wantedId, attempts,
    elapsedGameSeconds: 0, movementFailure: null };
  let current = beltDishes(state).find((candidate) => candidate.id === wantedId);
  if (!current?.screen) return { state, setup: null, wantedId, attempts,
    elapsedGameSeconds: 0, movementFailure: null };

  if (method === 'click') {
    await installClickPickupLatch(h.page, wantedId);
    if (forceMiss) {
      await forcedMissClick(h, current);
    } else {
      await clickAt(h.page, current.screen);
      attempts += 1;
      const end = Date.now() + 9000;
      while (Date.now() < end) {
        state = await h.ui();
        if (state.debug?.carried || !beltDishes(state).some((candidate) => candidate.id === wantedId)) break;
        await h.sleep(40);
      }
    }
    const latch = await readClickPickupLatch(h.page);
    setup = latch?.setup ?? null;
    state = await h.ui();
  } else {
    if (await stageAtBeltFront(h)) {
      const end = Date.now() + 8000;
      while (Date.now() < end) {
        state = await h.ui();
        setup = keySetupAt(state);
        if (setup) break;
        current = beltDishes(state).find((candidate) => candidate.id === wantedId);
        if (!current) break;
        const key = state.debug.player.x < current.x ? 'KeyD' : 'KeyA';
        const startX = state.debug.player.x;
        let lastX = startX;
        let lastObservedAt = gameSeconds(state);
        let stagnantFrames = 0;
        let blocked = false;
        await h.page.keyboard.down(key);
        try {
          attempts += 1;
          for (let frame = 0; frame < 14; frame += 1) {
            const candidate = await h.ui();
            const observedAt = gameSeconds(candidate);
            const candidateX = candidate.debug?.player?.x;
            if (keySetupAt(candidate)
              || !beltDishes(candidate).some((item) => item.id === wantedId)
              || Math.abs(candidateX - startX) >= 0.35) break;
            if (observedAt > lastObservedAt + 0.001) {
              stagnantFrames = Math.abs(candidateX - lastX) <= 0.01 ? stagnantFrames + 1 : 0;
              lastObservedAt = observedAt;
              lastX = candidateX;
              if (stagnantFrames >= 6) {
                h.lastMovementFailure = {
                  reason: 'position unchanged across observed game frames while tracking a dish',
                  key,
                  dishId: wantedId,
                  attempts,
                  elapsedGameSeconds: observedAt - startedAt,
                  lastPosition: { ...candidate.debug.player },
                };
                blocked = true;
                break;
              }
            }
            await h.sleep(40);
          }
        } finally {
          await h.page.keyboard.up(key);
        }
        if (blocked) break;
      }
    }
    // The snapshot proving the setup is the one immediately before Space.
    state = await h.ui();
    setup = keySetupAt(state);
    if (setup) await h.page.keyboard.press('Space');
  }

  if (!state.debug?.carried && setup) {
    state = await h.waitFor((candidate) => candidate.debug?.carried
      || !beltDishes(candidate).some((item) => item.id === wantedId),
    1800, `${method} pickup outcome for dish ${wantedId}`) ?? await h.ui();
  } else {
    state = await h.ui();
  }
  return { state, setup, wantedId, attempts,
    elapsedGameSeconds: gameSeconds(state) - startedAt,
    movementFailure: h.lastMovementFailure,
    carriedTarget: state.debug?.carried?.dishId === wantedId };
}

function reportPickupProbe(name, attempt, dish) {
  const detail = JSON.stringify({ dish, setup: attempt?.setup, carried: attempt?.state?.debug?.carried,
    attempts: attempt?.attempts, elapsedGameSeconds: attempt?.elapsedGameSeconds,
    movementFailure: attempt?.movementFailure, forcedMiss: FORCE_MISS_PICKUP });
  if (!attempt?.setup) return precondition(name, false, detail);
  return check(name, attempt.carriedTarget, detail);
}

function reportFulfillmentPickup(attempt, dish) {
  const name = 'reliable fulfillment pickups collect their targeted dishes';
  const detail = JSON.stringify({ dish, setup: attempt?.setup, carried: attempt?.state?.debug?.carried,
    attempts: attempt?.attempts, elapsedGameSeconds: attempt?.elapsedGameSeconds });
  if (!attempt?.setup) {
    // A dish that left the belt before the walk reached it is a retry on the
    // next dish, not a verdict; the check stays unobserved if none succeeds.
    const state = attempt?.state;
    const dishLeft = !state?.debug?.carried && !attempt?.movementFailure
      && !beltDishes(state).some((candidate) => candidate.id === dish?.id);
    if (dishLeft) {
      trace.push({ section: checkScope, event: 'fulfillment-dish-left-before-setup', detail });
      return false;
    }
    return precondition(name, false, detail);
  }
  return check(name, attempt.carriedTarget, detail);
}

async function openRaisedHandWhileCarrying(h, customer, remembered) {
  const setup = await h.ui();
  const liveCustomer = customerAt(setup, customer.index);
  const detail = JSON.stringify({ table: tableOf(liveCustomer), customer: liveCustomer,
    carried: setup.debug?.carried });
  const established = precondition(
    'precondition: a dish is carried beside a raised hand at the back-right table',
    setup.debug?.carried && liveCustomer?.cueShowing && tableOf(liveCustomer) === 2,
    detail,
  );
  if (!established) {
    precondition('carrying a dish does not block opening the back-right table conversation', false, detail);
    return setup;
  }
  const prompt = await approachCustomer(h, liveCustomer.index,
    (state) => state.fallback.length > 0, 'carried-dish conversation at the back-right table');
  check('carrying a dish does not block opening the back-right table conversation',
    prompt?.debug?.carried && prompt.fallback.length > 0,
  JSON.stringify({ table: 2, customer: customerAt(prompt, liveCustomer.index),
    carried: prompt?.debug?.carried }));
  if (!prompt?.fallback.length) return prompt ?? await h.ui();
  await h.page.click('.lesson-hud__fallback');
  const answered = await h.waitFor((state) => customerAt(state, liveCustomer.index)?.state === 'awaiting'
    && state.debug?.carried, 7000, 'carried-dish conversation answer');
  const spoken = answered?.bubble.match(/^I like (.+)\.$/)?.[1]?.toLowerCase() ?? null;
  const food = spoken === null ? null : (FOOD_BY_SENTENCE.get(spoken) ?? spoken);
  if (answered && food) remembered.set(liveCustomer.index, food);
  await h.waitFor((state) => state.fallback.length === 0, 3000,
    'carried-dish conversation prompt to clear');
  return answered ?? await h.ui();
}

async function returnDish(h) {
  const initial = await h.ui();
  const carriedFood = initial.debug?.carried?.food;
  const position = initial.debug?.dishReturn?.position;
  if (!carriedFood || !position) return null;
  if (!await walkClear(h, position)) return null;
  const actionable = await h.waitFor((state) => state.debug?.carried
    && state.action === UI.restaurant.returnDish, 3000,
    'dish return interaction');
  if (!actionable) return null;
  await h.page.keyboard.press('Space');
  return h.waitFor((state) => !state.debug?.carried, 3000, 'returned dish to leave the player hands');
}

const DELIVERY_POSITIONS = Object.freeze([
  { x: -4.2, z: -3.7 },
  { x: 0, z: -0.9 },
  // Inboard of the talk spot: key overshoot at x 4.2 can stop inside the dish
  // return radius, where Space returns the plate instead of delivering it.
  { x: 3.9, z: -3.7 },
  { x: -4.2, z: 1.2 },
  { x: 4.2, z: 1.2 },
]);

async function moveToDeliveryPosition(h, tableIndex) {
  const target = DELIVERY_POSITIONS[tableIndex];
  const initial = await h.ui();
  if (!target || !initial.debug?.player) return null;
  return walkClear(h, target);
}

async function offerDish(h, preferredIndex, { mode = 'correct' } = {}) {
  let state = await h.ui();
  const carriedFood = state.debug?.carried?.food ?? state.debug?.carried;
  if (!carriedFood) return { outcome: 'missing', state, carriedFood, confirmedAtCommit: false };
  const eligible = (customer) => customer?.state === 'awaiting'
    && customerOwner(customer) !== 'rival'
    && (customer.refusalRemaining ?? 0) <= 0
    && (mode === 'wrong' ? customer.food !== carriedFood : customer.food === carriedFood);

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    state = await h.ui();
    if (!state.debug?.carried) return { outcome: 'missing', state, carriedFood, confirmedAtCommit: false };
    const preferred = customerAt(state, preferredIndex);
    const target = eligible(preferred) ? preferred : state.debug.customers.find(eligible);
    if (!target) {
      precondition('delivery target remains eligible at commit', false,
        JSON.stringify({ preferredIndex, mode, carried: state.debug.carried }));
      trace.push({ section: checkScope, event: 'delivery-target-stale', attempt,
        detail: { preferredIndex, mode, carried: state.debug.carried,
          customers: state.debug.customers.map((customer) => ({ index: customer.index,
            state: customer.state, food: customer.food })) } });
      const returned = await returnDish(h);
      return { outcome: 'precondition-failed', state: returned ?? await h.ui(), carriedFood,
        confirmedAtCommit: false };
    }
    if (target.index !== preferredIndex) {
      precondition('delivery target remains eligible at commit', false,
        JSON.stringify({ preferredIndex, retargetedTo: target.index, mode, carriedFood }));
      trace.push({ section: checkScope, event: 'delivery-retargeted', attempt,
        detail: { from: preferredIndex, to: target.index, mode, carriedFood } });
      preferredIndex = target.index;
    }
    if (!await moveToDeliveryPosition(h, tableOf(target))) {
      precondition('delivery target remains eligible at commit', false,
        JSON.stringify({ preferredIndex, mode, movementFailure: h.lastMovementFailure }));
      return { outcome: 'precondition-failed', state: await h.ui(), carriedFood,
        confirmedAtCommit: false, movementFailure: h.lastMovementFailure };
    }
    const actionable = await h.waitFor((candidate) => {
      const live = customerAt(candidate, preferredIndex);
      return !eligible(live) || candidate.action === UI.restaurant.deliverDish;
    }, 1800, `delivery action at customer ${preferredIndex}`) ?? await h.ui();
    const liveTarget = customerAt(actionable, preferredIndex);
    if (!eligible(liveTarget)) {
      precondition('delivery target remains eligible at commit', false,
        JSON.stringify({ preferredIndex, mode, target: liveTarget }));
      trace.push({ section: checkScope, event: 'delivery-target-changed-before-commit', attempt,
        detail: { target: liveTarget, carried: actionable.debug?.carried } });
      continue;
    }
    const before = await h.ui();
    const beforeTarget = customerAt(before, preferredIndex);
    if (!eligible(beforeTarget) || before.action !== UI.restaurant.deliverDish) {
      precondition('delivery target remains eligible at commit', false,
        JSON.stringify({ preferredIndex, mode, target: beforeTarget, action: before.action }));
      trace.push({ section: checkScope, event: 'delivery-target-changed-at-commit', attempt,
        detail: { target: beforeTarget, action: before.action, carried: before.debug?.carried } });
      continue;
    }
    precondition('delivery target remains eligible at commit', true,
      JSON.stringify({ preferredIndex, mode, target: beforeTarget, carried: before.debug.carried }));
    await h.page.keyboard.press('Space');
    const transition = (candidate) => {
      const customer = customerAt(candidate, preferredIndex);
      if (['delivered', 'eating'].includes(customer?.state) && !candidate.debug?.carried) return 'delivered';
      const refusalStarted = Number.isFinite(customer?.refusalRemaining)
        && customer.refusalRemaining > Math.max(0, beforeTarget.refusalRemaining ?? 0) + 0.001;
      const firstTryLost = before.debug?.carried?.firstTry !== false
        && candidate.debug?.carried?.firstTry === false;
      if (candidate.debug?.carried && (refusalStarted || firstTryLost)) return 'refused';
      return null;
    };
    const changed = await h.waitFor((candidate) => Boolean(transition(candidate)), 2800,
      `delivery transition at customer ${preferredIndex}`);
    if (changed) return { outcome: transition(changed), state: changed, carriedFood,
      confirmedAtCommit: true, targetIndex: preferredIndex, attempts: attempt };
    return { outcome: 'no-change', state: await h.ui(), carriedFood,
      confirmedAtCommit: true, targetIndex: preferredIndex, attempts: attempt };
  }
  const returned = await returnDish(h);
  return { outcome: 'precondition-failed', state: returned ?? await h.ui(), carriedFood,
    confirmedAtCommit: false };
}

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

async function finishTurnaround(h, screenshotName, expectedScore = null, reached = true) {
  const s = reached ? await h.waitFor(
    (state) => serviceLifecycle(state) === 'turnaround' && state.fallback.length >= 3,
    18000,
    'turnaround',
  ) : null;
  outcomeCheck('turnaround opens under speech focus', reached, s?.debug?.focusActive,
    JSON.stringify(s?.debug));
  outcomeCheck('the host is in the room at turnaround', reached, s?.debug?.host?.inRoom === true,
    JSON.stringify(s?.debug?.host));
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
  check('turnaround offers the configured food choice', choice,
    JSON.stringify({ choice: CHOICE, answers: s.fallback.map((answer) => answer.text) }));
  await h.page.click(choice ? `.lesson-hud__fallback[data-value="${CHOICE}"]` : '.lesson-hud__fallback');
  return h.waitFor((state) => !state.restaurant && state.greeting !== null, 15000, 'hub return');
}

// ---- Dwell and microphone behavior -------------------------------------
// This short probe uses the real Restaurant controller with the deterministic
// Web Speech mock. The two complete scoring sessions below remain mic-free.
checkScope = 'Conversation probe';
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
    precondition('a raised hand appears for the dwell probe', false, JSON.stringify(s?.debug));
  } else {
    precondition('a raised hand appears for the dwell probe', true, JSON.stringify(passCustomer));
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
      precondition('a second raised hand appears for the silence probe', false, JSON.stringify(s?.debug));
    } else {
      precondition('a second raised hand appears for the silence probe', true, JSON.stringify(silenceCustomer));
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
checkScope = 'Normal';
{
  const h = await openPage('listening');
  const { page } = h;
  let s = await enterRestaurant(h);
  check('hub -> Restaurant at 1366x768', s?.restaurant && s?.debug?.level === LEVEL,
    JSON.stringify({ level: s?.debug?.level }));
  const contract = s?.debug;
  check('Restaurant exposes the frozen conveyor debug contract',
    contract?.conveyor
      && Array.isArray(contract.conveyor.dishes)
      && Array.isArray(contract.conveyor.pending)
      && contract.dishReturn?.position && contract.dishReturn?.screen
      && contract.sign && contract.host && contract.legacy
      && Object.hasOwn(contract, 'rivalHatch')
      && Object.hasOwn(contract, 'carried')
      && Array.isArray(contract.customers)
      && contract.player && Object.hasOwn(contract, 'rival'),
  JSON.stringify(contract));
  check('belt enters beyond the right wall and exits beyond the left wall',
    contract?.conveyor?.entryX > 6.85
      && contract.conveyor.exitX < -6.85
      && contract.conveyor.direction === -1,
  JSON.stringify(contract?.conveyor));
  check('legacy bell, ready cue, and counter are absent',
    contract?.legacy?.bell === false
      && contract.legacy.readyCue === false
      && contract.legacy.counter === false,
  JSON.stringify(contract?.legacy));
  check('the host is out of the room during service', contract?.host?.inRoom === false,
    JSON.stringify(contract?.host));
  check('the MATSUBARA RESTAURANT sign is visible inside the 1366x768 viewport',
    contract?.sign?.text === 'MATSUBARA RESTAURANT'
      && contract.sign.visible === true
      && contract.sign.screen.x >= 0 && contract.sign.screen.x <= 1366
      && contract.sign.screen.y >= 0 && contract.sign.screen.y <= 768,
  JSON.stringify(contract?.sign));
  const emptyTravelStart = contract?.conveyor?.dishes.length === 0
    ? contract.conveyor.beltTravel : null;
  const emptyBeltEstablished = precondition(
    'precondition: service is active with no dishes on the conveyor',
    emptyTravelStart !== null, JSON.stringify(contract?.conveyor));
  const emptyBeltMoved = emptyTravelStart === null ? null : await h.waitFor((state) =>
    beltDishes(state).length === 0
      && state.debug.conveyor.beltTravel > emptyTravelStart, 4000,
  'empty conveyor surface to advance during service');
  if (emptyBeltEstablished) {
    check('belt travel increases during service with no dishes on the belt', emptyBeltMoved,
      JSON.stringify({ before: emptyTravelStart, after: emptyBeltMoved?.debug?.conveyor }));
  } else {
    precondition('belt travel increases during service with no dishes on the belt', false,
      JSON.stringify(contract?.conveyor));
  }
  s = await waitForShiftState(h,
    (state) => state.debug?.customers.some((customer) => customer.cueShowing), 'order cue');
  check('level 2 reports the seven-customer shift total', progressOf(s).total === SHIFT_TOTAL,
    JSON.stringify(progressOf(s)));
  check('customer debug identities include their table', s?.debug?.customers.length > 0
    && s.debug.customers.every((customer) => Number.isInteger(customer.index)
      && Number.isInteger(tableOf(customer))), JSON.stringify(s?.debug?.customers));
  check('a raised-order cue is exposed without food content', s?.debug?.customers.some((customer) => customer.cueShowing));
  check('no customer shows a food cue', s?.debug?.customers.every((customer) =>
    !Object.hasOwn(customer, 'foodCue') && !Object.hasOwn(customer, 'foodCueShowing')),
  JSON.stringify(s?.debug?.customers));
  await page.screenshot({ path: `${OUT}-01-seated-order-cue.png` });

  const remembered = new Map();
  const seenFoods = new Map();
  const resolvedTables = new Set();
  const resolvedIds = new Set();
  let replacementChecked = false;
  let reachedRush = directorPhase(s) === 'rush';
  let duplicateChecked = false;
  await askShowingCues(h, remembered, { minimum: 3 });
  s = await h.ui();
  check('Normal reaches three unresolved player orders', playerOrders(s).length >= 3,
    JSON.stringify(playerOrders(s).map((customer) => [customer.index, customer.state, customer.owner])));
  if (playerOrders(s).length >= 3) {
    await page.screenshot({ path: `${OUT}-08-normal-multiple-unresolved.png` });
  }
  s = await waitForShiftState(h,
    (state) => beltDishes(state).filter((dish) =>
      Math.abs(dish.x) <= state.debug.conveyor.visibleHalfWidth).length >= 2,
  'two visible conveyor dishes');
  precondition('several dishes coexist on Normal', s,
    JSON.stringify(s?.debug?.conveyor?.dishes));

  let carryingShot = false;
  let comboShot = false;
  let returnedWrongDish = false;
  let returnProgress = null;
  let carryingConversationReported = false;
  const missedDish = beltDishes(s).find((dish) => !dish.filler) ?? null;
  const clickProbeDish = visibleBeltDishes(s).find((dish) => dish.id !== missedDish?.id && dish.filler)
    ?? visibleBeltDishes(s).find((dish) => dish.id !== missedDish?.id)
    ?? null;
  const clickProbe = clickProbeDish
    ? await collectDish(h, clickProbeDish, 'click', { forceMiss: FORCE_MISS_PICKUP })
    : null;
  reportPickupProbe('dedicated click-to-walk pickup probe collects its targeted dish',
    clickProbe, clickProbeDish);
  s = clickProbe?.state ?? await h.ui();
  if (s.debug?.carried) {
    const returned = await returnDish(h);
    returnedWrongDish = Boolean(returned && !returned.debug?.carried);
    if (returnedWrongDish) returnProgress = progressOf(returned).done;
    s = returned ?? await h.ui();
  }

  const keyStage = await stageAtBeltFront(h);
  s = keyStage ?? await h.ui();
  s = await waitForShiftState(h, (state) => visibleBeltDishes(state)
    .some((dish) => dish.id !== clickProbeDish?.id && dish.id !== missedDish?.id
      && dish.x > state.debug.player.x + BELT_PICKUP_WINDOW
      && dish.x < state.debug.player.x + 3.5),
  'dish for dedicated interact-key pickup probe', 30000) ?? await h.ui();
  const keyProbeDish = visibleBeltDishes(s)
    .filter((dish) => dish.id !== clickProbeDish?.id && dish.id !== missedDish?.id)
    .sort((left, right) => Math.abs(left.x - s.debug.player.x)
      - Math.abs(right.x - s.debug.player.x))[0] ?? null;
  const keyProbe = keyProbeDish ? await collectDish(h, keyProbeDish, 'key') : null;
  reportPickupProbe('dedicated interact-key pickup probe collects its targeted dish', keyProbe, keyProbeDish);
  s = keyProbe?.state ?? await h.ui();
  if (s.debug?.carried) {
    const returned = await returnDish(h);
    if (!returnedWrongDish && returned && !returned.debug?.carried) {
      returnedWrongDish = true;
      returnProgress = progressOf(returned).done;
    }
    s = returned ?? await h.ui();
  }

  const serviceWatchdog = createStagnationWatchdog(s);
  let serviceProgressing = true;
  while (isInService(s) && progressOf(s).done < progressOf(s).total && serviceProgressing) {
    s = await h.ui();
    serviceProgressing = serviceWatchdog.observe(s);
    if (!serviceProgressing) break;
    reachedRush ||= directorPhase(s) === 'rush';
    for (const customer of s.debug.customers) {
      const indexes = seenFoods.get(customer.food) ?? new Set();
      indexes.add(customer.index);
      seenFoods.set(customer.food, indexes);
      if (!resolvedIds.has(customer.index) && resolvedTables.has(tableOf(customer))
        && !['scheduled', 'left'].includes(customer.state)) replacementChecked = true;
    }
    const backRightCue = s.debug?.customers.find((customer) =>
      customer.cueShowing && tableOf(customer) === 2);
    const canStageCarryingConversation = !carryingConversationReported && backRightCue
      && !s.debug?.carried
      && visibleBeltDishes(s).some((candidate) => candidate.id !== missedDish?.id);
    if (s.debug?.customers.some((customer) => customer.cueShowing)
      && !canStageCarryingConversation) {
      await askShowingCues(h, remembered, {
        checkFreeze: !h.observations.speechFreezeChecked && visibleBeltDishes(s).some((dish) =>
          dish.x > s.debug.conveyor.exitX + 1.5),
      });
      s = await h.ui();
      continue;
    }

    // Fulfil only dishes someone is waiting for, that stay on the belt long
    // enough to reach, and never start a pickup while a plate is in hand.
    const wantedDish = (state, candidate) => candidate.id !== missedDish?.id && !candidate.filler
      && state.debug.customers.some((customer) => customer.state === 'awaiting'
        && remembered.get(customer.index) === candidate.food);
    let pickedDishId = s.debug?.carried?.dishId ?? null;
    if (!s.debug?.carried) {
      const dish = reachableBeltDishes(s).find((candidate) => wantedDish(s, candidate)) ?? null;
      if (!dish) {
        s = await h.waitFor(
          (state) => !isInService(state)
            || progressOf(state).done >= progressOf(state).total
            || state.debug?.customers.some((customer) => customer.cueShowing)
            || reachableBeltDishes(state).some((candidate) => wantedDish(state, candidate)),
          25000,
          'next cue or deliverable dish',
        );
        if (!s) {
          s = await h.ui();
          serviceProgressing = serviceWatchdog.observe(s);
          if (!serviceProgressing) break;
        }
        continue;
      }
      const pickup = await collectDish(h, dish, 'click');
      s = pickup.state;
      reportFulfillmentPickup(pickup, dish);
      pickedDishId = dish.id;
      const raised = s?.debug?.customers.find((customer) =>
        customer.cueShowing && tableOf(customer) === 2);
      if (s?.debug?.carried && raised && !carryingConversationReported) {
        s = await openRaisedHandWhileCarrying(h, raised, remembered);
        carryingConversationReported = true;
      }
      if (!s?.debug?.carried) continue;
    }
    if (!carryingShot && s) {
      carryingShot = true;
      await page.screenshot({ path: `${OUT}-03-carried-dish.png` });
    }
    const carriedFood = s?.debug?.carried?.food ?? s?.debug?.carried;
    const matching = s?.debug?.customers.filter((customer) => customer.state === 'awaiting'
      && remembered.get(customer.index) === carriedFood) ?? [];
    const testingDuplicate = !duplicateChecked && matching.length >= 2;
    const target = testingDuplicate ? matching[matching.length - 1] : matching[0];
    if (!target) {
      // The customer this plate was for left or was served meanwhile.
      trace.push({ section: checkScope, event: 'carried-dish-without-remembered-customer',
        detail: { dishId: pickedDishId, carriedFood, remembered: [...remembered] } });
      s = await returnDish(h) ?? await h.ui();
      continue;
    }
    precondition('remembered orders identify matching delivery customers', true,
      JSON.stringify({ dishId: pickedDishId, carriedFood, target: target.index }));
    const result = await offerDish(h, target.index);
    (result.confirmedAtCommit ? check : precondition)(
      'deliveries to confirmed awaiting customers commit', result.outcome === 'delivered',
      `${result.outcome} — target ${target.index} ${JSON.stringify(
        result.state?.debug?.customers?.map((c) => [c.index, c.state, c.food]),
      )} carried ${JSON.stringify(result.state?.debug?.carried)}`);
    s = result.state;
    if (result.outcome !== 'delivered') {
      if (!result.confirmedAtCommit) continue;
      await page.screenshot({ path: `${OUT}-unexpected-listening-delivery.png` });
      break;
    }
    resolvedTables.add(tableOf(target));
    resolvedIds.add(target.index);
    if (testingDuplicate) {
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
  const listeningEnded = precondition('listening shift maintains semantic progress through completion',
    serviceProgressing && (!isInService(s) || listeningProgress.done === listeningProgress.total),
    JSON.stringify(serviceWatchdog.detail(s)));
  check('a replacement customer is seated after an earlier customer resolves', replacementChecked,
    JSON.stringify(s?.debug?.customers.map((customer) => [customer.index, tableOf(customer), customer.state])));
  check('the service director reaches rush', reachedRush, JSON.stringify({ phase: directorPhase(s) }));
  outcomeCheck('the listening shift reaches its full reported total', listeningEnded,
    listeningProgress.total === SHIFT_TOTAL && listeningProgress.done === listeningProgress.total,
    JSON.stringify(listeningProgress));
  outcomeCheck('all seven customers resolve as successful deliveries in the listening session',
    listeningEnded,
    remembered.size === SHIFT_TOTAL
      && (!listeningRecords || (listeningRecords.length === SHIFT_TOTAL
        && listeningRecords.every((record) => record.delivered))),
    JSON.stringify({ remembered: remembered.size, records: listeningRecords }));
  check('combo pop was captured', comboShot);
  if (!h.observations.speechFreezeChecked) {
    for (const name of [
      'speech focus is active for the mic-free prompt',
      'all customer patience is frozen while the prompt is open',
      'speech focus freezes belt travel and every dish position',
      'belt travel and dishes resume from their frozen values after speech focus',
    ]) precondition(name, false, 'no raised hand overlapped a moving belt dish');
  }
  if (!carryingConversationReported) {
    precondition('precondition: a dish is carried beside a raised hand at the back-right table', false,
      'the Normal session never staged table 2 with both a raised hand and a carried dish');
    precondition('carrying a dish does not block opening the back-right table conversation', false,
      'the carrying conversation setup was not reached');
  }
  // Concurrent identical orders depend on service timing; two customers who
  // ordered the same food and were both served also prove food-based matching.
  const servedFoods = [...resolvedIds].map((index) => remembered.get(index)).filter(Boolean);
  const servedRepeat = servedFoods.find((food, index) => servedFoods.indexOf(food) !== index) ?? null;
  const repeatedFood = [...seenFoods].find(([, indexes]) => indexes.size >= 2)?.[0] ?? null;
  if ((repeatedFood && duplicateChecked) || servedRepeat) {
    check('repeated foods still deliver correctly', true,
      JSON.stringify({ repeatedFood, duplicateChecked, servedRepeat }));
  } else {
    precondition('repeated foods still deliver correctly', false,
      JSON.stringify({ repeatedFood, duplicateChecked, seenFoods: [...seenFoods] }));
  }

  const dueEntrySamples = h.observations.preparationCompleted.map((prepared) => {
    const entered = h.observations.entries.find((entry) => !entry.filler && !entry.reentry
      && entry.food === prepared.food && entry.beltTravel >= prepared.beltTravel);
    return entered ? {
      food: prepared.food,
      serviceSeconds: (entered.beltTravel - prepared.beltTravel) / contract.conveyor.speed,
    } : null;
  }).filter(Boolean);
  const dueEntryObserved = precondition(
    'precondition: a completed preparation is observed through pending supply and belt entry',
    dueEntrySamples.length > 0, JSON.stringify({
      prepared: h.observations.preparationCompleted,
      entries: h.observations.entries,
    }),
  );
  if (dueEntryObserved) {
    check('due food enters within the Normal SPEC bound after preparation completes',
      dueEntrySamples.some((sample) => sample.serviceSeconds <= 4.15),
    JSON.stringify(dueEntrySamples));
  } else {
    precondition('due food enters within the Normal SPEC bound after preparation completes', false,
      'no completed-preparation-to-entry sample');
  }
  const askingOrder = [...remembered.values()];
  const entryOrder = h.observations.entries.filter((entry) => !entry.filler && !entry.reentry)
    .map((entry) => entry.food);
  const comparableOrderLength = Math.min(askingOrder.length, entryOrder.length);
  precondition('entry order can differ from asking order',
    comparableOrderLength >= 2
      && askingOrder.slice(0, comparableOrderLength)
        .some((food, index) => food !== entryOrder[index]),
  JSON.stringify({ askingOrder, entryOrder }));
  precondition('a dish is observed to exit past exitX', h.observations.exits.length > 0,
    JSON.stringify({ exitX: contract.conveyor.exitX, exits: h.observations.exits }));
  precondition('a missed due dish re-enters later', missedDish
    && h.observations.exits.some((dish) => dish.id === missedDish.id)
    && h.observations.reentries.some((dish) => dish.food === missedDish.food),
  JSON.stringify({ missedDish, exits: h.observations.exits, reentries: h.observations.reentries }));
  precondition('a wrongly picked dish can be returned at dishReturn', returnedWrongDish,
    JSON.stringify({ returnProgress, progress: listeningProgress }));
  if (returnedWrongDish) {
    check('the order still completes after returning a wrongly picked dish',
      returnProgress !== null && listeningProgress.done > returnProgress,
    JSON.stringify({ returnProgress, progress: listeningProgress }));
  } else {
    precondition('the order still completes after returning a wrongly picked dish', false,
      'no wrong-pick return was established');
  }

  s = await finishTurnaround(h, `${OUT}-05-turnaround.png`, null, listeningEnded);
  outcomeCheck('listening session finishes back at the hub', listeningEnded, s);
  outcomeCheck('Restaurant debug hook is removed on exit', listeningEnded, s?.debug == null,
    JSON.stringify(s?.debug));
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '{}'), SAVE_KEY);
  outcomeCheck('listening session earns the Restaurant stamp', listeningEnded,
    saved?.stamps?.restaurant === true, JSON.stringify(saved?.stamps));
  outcomeCheck('listening first-try session earns three stars', listeningEnded,
    saved?.bestStars?.restaurant === 3,
    JSON.stringify(saved?.bestStars));
  await page.close();
}

// ---- Session B: ignore answers and sweep customers ----------------------
checkScope = 'Anti-shortcut';
{
  const h = await openPage('sweep');
  const { page } = h;
  let s = await enterRestaurant(h);
  check('anti-shortcut session enters Restaurant', s?.restaurant);
  let wrongChecked = false;
  let recoveredAfterWrong = false;
  let currentDishHadWrong = false;
  let wrongedDeliveries = 0;
  const sweepWatchdog = createStagnationWatchdog(s);
  let sweepProgressing = true;
  while (isInService(s) && progressOf(s).done < progressOf(s).total && sweepProgressing) {
    s = await h.ui();
    sweepProgressing = sweepWatchdog.observe(s);
    if (!sweepProgressing) break;
    // Taking an order while carrying is intentional controller behavior and is
    // also how the sweep reveals a genuinely wrong target for the held plate.
    if (s.debug?.customers.some((customer) => customer.cueShowing)) {
      await askShowingCues(h, null, { remember: false });
      s = await h.ui();
      continue;
    }
    if (!s.debug?.carried && reachableBeltDishes(s).length === 0) {
      s = await h.waitFor(
        (state) => !isInService(state)
          || progressOf(state).done >= progressOf(state).total
          || state.debug?.customers.some((customer) => customer.cueShowing)
          || reachableBeltDishes(state).length > 0,
        25000,
        'sweep cue or dish',
      );
      if (!s) {
        s = await h.ui();
        sweepProgressing = sweepWatchdog.observe(s);
        if (!sweepProgressing) break;
      }
      continue;
    }
    if (!s || !isInService(s)) break;
    if (!s.debug.carried) {
      await h.waitFor((state) => !state.bubble, 7000, 'English answer to clear');
      s = await h.ui();
      const wrongTargetFor = (state, food) => state.debug.customers.find((customer) =>
        customer.state === 'awaiting'
          && !customer.cueShowing
          && customer.food !== food
          && (customer.refusalRemaining ?? 0) <= 0);
      let dish = reachableBeltDishes(s).find((candidate) => wrongTargetFor(s, candidate.food));
      const mayProduceWrongTarget = progressOf(s).done < progressOf(s).total - 1;
      if (!dish && mayProduceWrongTarget) {
        // Do not accept a first-try delivery merely because this instant's
        // occupants all happen to want the held food. Keep the belt untouched
        // while hands and replacements expose a genuinely different target.
        s = await h.waitFor(
          (state) => !isInService(state)
            || state.debug?.customers.some((customer) => customer.cueShowing)
            || reachableBeltDishes(state).some((candidate) => wrongTargetFor(state, candidate.food)),
          25000,
          'a wrong target for a conveyor dish',
        );
        if (!s) {
          s = await h.ui();
          sweepProgressing = sweepWatchdog.observe(s);
          if (!sweepProgressing) break;
        }
        continue;
      }
      dish ??= reachableBeltDishes(s)[0];
      if (!dish) continue;
      const pickup = await collectDish(h, dish, 'click');
      reportFulfillmentPickup(pickup, dish);
      s = pickup.state;
      if (!s) break;
      currentDishHadWrong = false;
    }
    const carriedFood = s.debug.carried?.food ?? s.debug.carried;
    if (!currentDishHadWrong) {
      const wrongTarget = s.debug.customers
        .filter((customer) => customer.state === 'awaiting'
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
        precondition('a non-final plate gets a deterministic wrong target', true,
          JSON.stringify({ dishId: s.debug.carried?.dishId, carriedFood, wrongTarget }));
        const result = await offerDish(h, wrongTarget.index, { mode: 'wrong' });
        s = result.state;
        if (result.outcome === 'refused') {
          check('the selected different-food customer refuses the plate', true,
            JSON.stringify({ targetIndex: wrongTarget.index, carriedFood, attempts: result.attempts }));
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
        if (result.confirmedAtCommit) {
          check('the selected different-food customer refuses the plate', false,
            JSON.stringify({ outcome: result.outcome, wrongTarget, carriedFood }));
          break;
        }
        precondition('the selected different-food customer refuses the plate', false,
          JSON.stringify({ outcome: result.outcome, wrongTarget, carriedFood }));
        currentDishHadWrong = false;
        continue;
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
      if (currentDishHadWrong) {
        recoveredAfterWrong = true;
        check('a wrong-first plate remains recoverable at its matching customer', true,
          JSON.stringify({ targetIndex: matching.index, carriedFood, attempts: result.attempts }));
      }
      currentDishHadWrong = false;
    } else if (result.confirmedAtCommit) {
      check('a wrong-first plate remains recoverable at its matching customer', false,
        JSON.stringify({ outcome: result.outcome, matching, carriedFood }));
      break;
    } else {
      precondition('a wrong-first plate remains recoverable at its matching customer', false,
        JSON.stringify({ outcome: result.outcome, matching, carriedFood }));
    }
  }
  s = await h.ui();
  const sweepProgress = progressOf(s);
  const sweepEnded = precondition('anti-shortcut shift maintains semantic progress through completion',
    sweepProgressing && (!isInService(s) || sweepProgress.done === sweepProgress.total),
    JSON.stringify(sweepWatchdog.detail(s)));
  const sweepRecords = s?.debug?.records ?? null;
  const sweepScore = s?.debug?.scoring
    ?? (sweepRecords?.length === SHIFT_TOTAL ? scoreSession(sweepRecords) : null);
  precondition('anti-shortcut run exercised a wrong delivery', wrongChecked);
  outcomeCheck('the order is recoverable after a wrong delivery', sweepEnded, recoveredAfterWrong);
  outcomeCheck('guessing remains recoverable and resolves the full shift total', sweepEnded,
    sweepProgress.total === SHIFT_TOTAL && sweepProgress.done === sweepProgress.total,
    JSON.stringify({ progress: sweepProgress, customers: s?.debug?.customers }));
  outcomeCheck('the anti-shortcut result contains exactly one record per customer', sweepEnded,
    sweepRecords?.length === SHIFT_TOTAL,
    JSON.stringify({ recordCount: sweepRecords?.length, records: sweepRecords }));
  outcomeCheck('the deterministic sweep is below the scoring first-try cap', sweepEnded,
    sweepScore?.firstTryShare < FIRST_TRY_SHARE_CAP,
    JSON.stringify({ cap: FIRST_TRY_SHARE_CAP, wrongedDeliveries, score: sweepScore }));
  s = await finishTurnaround(h, `${OUT}-07-sweep-turnaround.png`, null, sweepEnded);
  outcomeCheck('guessing session still finishes', sweepEnded, s);
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '{}'), SAVE_KEY);
  const stars = saved?.bestStars?.restaurant ?? null;
  outcomeCheck('anti-shortcut sweep still earns the stamp', sweepEnded, saved?.stamps?.restaurant === true,
    JSON.stringify(saved?.stamps));
  outcomeCheck('anti-shortcut sweep cannot reach three stars', sweepEnded, stars !== null && stars < 3,
    JSON.stringify({ bestStars: saved?.bestStars, firstTryShare: sweepScore?.firstTryShare }));
  await page.close();
}

// ---- Session C: Challenge rival ownership and shared rush ---------------
checkScope = 'Challenge';
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
  let rivalHatchChecked = false;

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
          if (walkingFocus && !rivalSpeechFreezeReported) {
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
            rivalSpeechFreezeReported = true;
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

  s = await waitForShiftState(h, (state) => state.debug?.rivalHatch?.contents?.state === 'ready',
    'first ready rival-hatch dish', 35000);
  const firstRivalHatchReady = precondition(
    'precondition: the rival hatch visibly contains its own ready dish',
    s?.debug?.rivalHatch?.contents?.state === 'ready' && s.debug.rivalHatch.screen,
  JSON.stringify(s?.debug?.rivalHatch));
  if (firstRivalHatchReady) {
    await clickAt(page, s.debug.rivalHatch.screen);
    await h.waitFor((state) => !state.debug?.player?.autoWalking, 8000,
      'player movement after clicking the rival hatch');
    const afterHatchClick = await h.ui();
    check('the player can never collect from rivalHatch on Challenge', !afterHatchClick.debug?.carried,
      JSON.stringify({ carried: afterHatchClick.debug?.carried, rivalHatch: afterHatchClick.debug?.rivalHatch }));
    rivalHatchChecked = !afterHatchClick.debug?.carried;
    s = afterHatchClick;
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
  // collecting conveyor food and taking one newly raised fourth order.
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
    && beltDishes(state).filter((dish) =>
      Math.abs(dish.x) <= state.debug.conveyor.visibleHalfWidth).length >= 2
    && state.debug.customers.some((customer) => customer.cueShowing
      && customerOwner(customer) !== 'rival'),
  'multiple visible dishes beside a newly raised fourth player hand', 35000);
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
  s = await waitForShiftState(h, (state) => visibleBeltDishes(state).length > 0,
    'player dish for rival-owned delivery probe', 30000);
  const dishForProbe = visibleBeltDishes(s)[0] ?? null;
  const hasPlayerDish = precondition('precondition: a player dish is ready for the ownership probe',
    dishForProbe, JSON.stringify(s?.debug?.conveyor?.dishes));
  if (hasPlayerDish) s = (await collectDish(h, dishForProbe)).state;
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

  // Finish the carried plate normally before approaching the rival hatch.
  if (s?.debug?.carried) {
    const target = playerDeliveryCustomer(s, remembered);
    if (target) s = (await offerDish(h, target.index)).state;
  }
  if (!firstRivalHatchReady) {
    precondition('the player can never collect from rivalHatch on Challenge', false,
      JSON.stringify(s?.debug?.rivalHatch));
  }
  precondition('the rival-hatch ownership probe completed', rivalHatchChecked);

  // Complete the shared shift with the same listen/remember/deliver loop as
  // Normal, while treating ownership as the authoritative interaction filter.
  const challengeWatchdog = createStagnationWatchdog(s);
  let challengeProgressing = true;
  while (s?.debug && isInService(s) && progressOf(s).done < progressOf(s).total
    && challengeProgressing) {
    s = await h.ui();
    challengeProgressing = challengeWatchdog.observe(s);
    if (!challengeProgressing) break;
    const cue = s.debug.customers.find((customer) => customer.cueShowing
      && customerOwner(customer) !== 'rival');
    if (cue) {
      // Keep staging the rival-freeze sample until one prompt opens mid-walk.
      if (!rivalSpeechFreezeReported && await stageRivalFreezePrompt(h, cue, remembered)) continue;
      const answer = await askCustomer(h, cue.index, { checkRivalFreeze: !rivalSpeechFreezeReported });
      if (answer) remembered.set(answer.index, answer.food);
      continue;
    }
    if (!s.debug.carried && reachableBeltDishes(s).length > 0) {
      s = (await collectDish(h, reachableBeltDishes(s)[0])).state;
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
      || (!state.debug?.carried && reachableBeltDishes(state).length > 0),
    25000, 'next owned Challenge action');
    if (!s) s = await h.ui();
  }

  s = await h.ui();
  const challengeProgress = progressOf(s);
  const challengeEnded = precondition('Challenge shift maintains semantic progress through completion',
    challengeProgressing && (!isInService(s) || challengeProgress.done === challengeProgress.total),
    JSON.stringify(challengeWatchdog.detail(s)));
  precondition('several dishes coexist on Challenge', h.observations.maxVisibleDishes >= 2,
    JSON.stringify({ maxVisibleDishes: h.observations.maxVisibleDishes }));
  precondition('restaurant-E-rush.png is captured in the required Challenge rush state',
    h.observations.screenshots.has('E-rush'), JSON.stringify({
      maxVisibleDishes: h.observations.maxVisibleDishes,
      screenshots: [...h.observations.screenshots],
    }));
  if (!rivalSpeechFreezeReported) {
    precondition('speech focus freezes rival state, target, position and carried food', false,
      'no speech prompt remained open while the rival was moving');
  }
  outcomeCheck('Challenge shared service resolves its full reported total', challengeEnded,
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
  s = await finishTurnaround(h, `${OUT}-12-final-player-vs-waiter.png`, finalCounts, challengeEnded);
  outcomeCheck('Challenge session finishes back at the hub', challengeEnded, s);
  check('the staged ownership takeover completed', takeoverCommitted);
  await page.close();
}

checkScope = 'Review';
for (const [name, stateDescription] of [
  ['A-back-wall', 'whole room, belt, both openings, and sign'],
  ['B-multiple-dishes', 'at least two visible conveyor dishes'],
  ['C-dish-entering', 'dish within 1.5 units inside the right opening'],
  ['D-dish-exiting', 'dish within 1.5 units inside the left opening'],
]) {
  const candidate = reviewCandidates.get(name);
  const reached = precondition(`precondition: restaurant-${name}.png reaches ${stateDescription}`,
    candidate, JSON.stringify(candidate ?? [...reviewCandidates]));
  const captureName = `restaurant-${name}.png is captured with ${stateDescription}`;
  const detail = JSON.stringify(reviewScreenshots.get(name) ?? candidate ?? [...reviewScreenshots]);
  if (reached) check(captureName, reviewScreenshots.has(name), detail);
  else precondition(captureName, false, detail);
}
check('no console or page errors', errors.length === 0, errors.slice(0, 3).join(' || '));
const failed = results.filter((result) => !result.ok).length;
const serializedChecks = results.map(({ observed, ...result }) => result);
const sectionSummaries = Object.entries(CHECK_REGISTRY).map(([section, names]) => ({
  section,
  passed: results.filter((result) => result.section === section && result.ok).length,
  total: names.length,
  seed: RESTAURANT_SEED,
}));
const resultClass = results.some((result) => result.result === 'HARNESS_ERROR') ? 'HARNESS_ERROR'
  : results.some((result) => result.result === 'HARNESS_PRECONDITION_FAILED')
    ? 'HARNESS_PRECONDITION_FAILED'
    : results.some((result) => result.result === 'PRODUCT_FAILURE') ? 'PRODUCT_FAILURE' : 'PASS';
const tracePath = `${OUT}-trace.json`;
await writeFile(tracePath, `${JSON.stringify(trace, null, 2)}\n`, 'utf8');
await writeFile(`${OUT}-results.json`, `${JSON.stringify({
  seed: RESTAURANT_SEED,
  forcedMissPickup: FORCE_MISS_PICKUP,
  result: resultClass,
  fixedTotal: serializedChecks.length,
  sections: sectionSummaries,
  checks: serializedChecks,
  trace: tracePath,
}, null, 2)}\n`, 'utf8');
console.log(`\nCheck list (${results.length} total):`);
for (const [index, result] of results.entries()) {
  console.log(`${index + 1}. ${result.result}  ${result.section}: ${result.name}`);
}
console.log(`${results.length - failed}/${results.length} checks passed`);
await browser.close();
if (failed > 0) process.exitCode = 1;
