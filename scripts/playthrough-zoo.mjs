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
import { writeFile } from 'node:fs/promises';
import { clickIfPresent, clickUntil, holdUntil, waitForDebug } from './lib/driver.mjs';

const URL = process.argv[2] || 'http://localhost:5199/';
const OUT = process.argv[3] || '.tmp/zoo';
const optionArgs = process.argv.slice(4);
const onlyAt = optionArgs.indexOf('--only');
const selectedSections = onlyAt === -1
  ? null
  : new Set((optionArgs[onlyAt + 1] ?? '').split(',').map((name) => name.trim()).filter(Boolean));
const sectionEnabled = (name) => !selectedSections || selectedSections.has(name);
const knownSections = new Set(['listening', 'antiShortcut', 'habitats']);
if (selectedSections && [...selectedSections].some((name) => !knownSections.has(name))) {
  throw new Error(`Unknown --only section. Choose from: ${[...knownSections].join(', ')}`);
}
const SAVE_KEY = 'esl-likes-save-v1';
const ANIMALS = ['elephant', 'giraffe', 'penguin', 'tiger', 'deer', 'alpaca', 'horse',
  'fox', 'wolf', 'stag', 'bull', 'cow', 'donkey'];
const MOVE_SPEED = 13.5;
const DEFAULT_SEED = 0x5eed1234;
const FORCE_WALK_SHORT = process.env.ZOO_FORCE_WALK_SHORT === '1';
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
const ZOO_SEED = seedValue(process.env.ZOO_SEED);
console.log(`Zoo seed: ${ZOO_SEED}${FORCE_WALK_SHORT ? ' (forced short walker)' : ''}`);
// Adjust to the class names the minigame actually uses.
const SEL = {
  viewfinder: '.zoo-viewfinder',
  shutter: '.zoo-viewfinder__shutter',
  camera: '.zoo-ui__camera',
  close: '.zoo-viewfinder__close',
  instruction: '.zoo-ui__instruction',
  notice: '.zoo-ui__notice',
};

// One browser per session, not one shared by both. Sharing meant session B ran
// after ~6 minutes of software rendering had already loaded the process, and it
// crawled badly enough for fixed waits to expire — which looked like three
// different game bugs in turn and was none of them.
async function newContext() {
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  await context.addInitScript(({ key, seed }) => {
    let randomState = seed >>> 0;
    Math.random = () => {
      randomState = (randomState + 0x6d2b79f5) >>> 0;
      let value = randomState;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
    Object.defineProperty(window, '__zooHarnessSeed', { value: seed, configurable: false });
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem(key, JSON.stringify({ version: 1, settings: { micFree: true, difficulty: 1 } }));
      sessionStorage.setItem('seeded', '1');
    }
  }, { key: SAVE_KEY, seed: ZOO_SEED });
  return { browser, context };
}

const results = [];
const errors = [];
const networkErrors = [];
let lastTrace = null;
let activeSection = null;
let activeHarness = null;
const listeningChecks = [
  'hub -> Zoo',
  'debug snapshot exposes every habitat and no wanted animals',
  'nothing points the way (no marker/arrow/minimap in the overlay)',
  'question offered: "What animal do you like?"',
  'visitor answers with an exact vocabulary sentence',
  'the answer is not left on screen',
  '🔊 offered while a request is open',
  'Listen Again control can be clicked',
  '🔊 replays the visitor\'s exact sentence',
  ...[1, 2, 3].flatMap((number) => [
    `request ${number} viewpoint is reached before photographing`,
    `visitor ${number} is reached before showing the photo`,
  ]),
  'the viewfinder only shoots a well-framed animal',
  'the photo taken is of that animal',
  'all three requests completed',
  'turnaround offers every animal sentence',
  'turnaround answer can be selected',
  'finishes back to the hub',
  'hub greets with the animal the child chose',
  'stamp and answer persisted',
  'listening + one replay = 3 stars',
  'a photo was saved for the stamp book',
  'stamp book control is available',
  'the stamp book shows the photo',
  'Zoo can be entered a second time',
  're-entry leaves no duplicated overlays',
  'listening section completes without a harness exception',
];
const antiShortcutChecks = [
  ...[1, 2, 3].flatMap((number) => [
    `request ${number} wrong-photo viewpoint is reached before photographing`,
    `visitor ${number} is reached before wrong-photo delivery`,
    `request ${number} correct-photo viewpoint is reached before photographing`,
    `visitor ${number} is reached before correct-photo delivery`,
  ]),
  'a wrong animal is refused in Japanese with no English repeat',
  'a refused photo is no longer carried',
  'anti-shortcut turnaround answer can be selected',
  'showing wrong photos still finishes and earns the stamp (no dead end)',
  'anti-shortcut: showing a wrong animal first cannot reach 3 stars',
  'antiShortcut section completes without a harness exception',
];
const habitatCheckNames = (animal) => [
  `${animal} has a graph-backed viewpoint`,
  `${animal} viewpoint is reached from the plaza`,
  `${animal} graph route is at most 10 seconds at movement speed`,
  `${animal} faces the habitat before photographing`,
  `${animal} reaches shutter-ready from its viewpoint`,
  `${animal} frames and photographs as the right animal`,
];
const habitatChecks = [
  'environment assets reach a terminal load state',
  'environment assets load without fallbacks or failed assets',
  'environment loading produces no console or page errors',
  'environment loading produces no failed network requests',
  'scene stats expose before and after dressing with instanced scenery',
  'YOU ARE HERE board exists and names all thirteen animals once',
  'YOU ARE HERE board text is neutral and never marks a request',
  'junction signposts use Japanese region names and complete regional animal lists',
  'animal labels are consistent across the board and signposts',
  'campus debug exposes a routable graph and all habitat viewpoints',
  'plaza visual-review screenshot is saved',
  'hub visual-review screenshot is saved',
  ...ANIMALS.flatMap(habitatCheckNames),
  'all thirteen habitats are photographed in one session',
  'visual-review screenshots are saved for every habitat region',
  'habitats section completes without a harness exception',
];
const CHECK_REGISTRY = {
  listening: listeningChecks,
  antiShortcut: antiShortcutChecks,
  habitats: habitatChecks,
  suite: [
    'no console or page errors',
    'no network errors',
    'the player never leaves the campus bounds',
  ],
};
const sectionRuns = new Map();
const compact = (value) => {
  if (value == null || value === '') return '';
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  return serialized.length > 900 ? `${serialized.slice(0, 897)}...` : serialized;
};
const emitCheck = (section, name, ok, detail, classification, trace = null) => {
  const diagnostic = ok ? compact(detail) : compact({
    ...(detail ? { detail } : {}),
    ...((trace ?? lastTrace) == null ? {} : { trace: trace ?? lastTrace }),
  });
  results.push({ section, name, ok, result: classification });
  console.log(`${classification}  ${name}${diagnostic ? `  - ${diagnostic}` : ''}`);
  return ok;
};
const check = (name, ok, detail = '', precondition = true, trace = null) => {
  if (!activeSection) throw new Error(`Check emitted outside a registered section: ${name}`);
  const run = sectionRuns.get(activeSection);
  if (!run?.pending.has(name)) throw new Error(`Unknown or duplicate ${activeSection} check: ${name}`);
  run.pending.delete(name);
  const ready = typeof precondition === 'function' ? precondition() : precondition;
  const passed = Boolean(ready) && Boolean(typeof ok === 'function' ? ok() : ok);
  return emitCheck(activeSection, name, passed,
    ready ? detail : `HARNESS_PRECONDITION_FAILED${detail ? `: ${detail}` : ''}`,
    passed ? 'PASS' : ready ? 'PRODUCT_FAILURE' : 'HARNESS_PRECONDITION_FAILED', trace);
};
let boundsObserved = false;
const boundsViolations = [];

const distanceBetween = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

const facingDot = (player, target) => {
  const forward = player?.forward ?? player?.facing?.forward;
  if (!forward || !Number.isFinite(forward.x) || !Number.isFinite(forward.z)) return null;
  const dx = target.x - player.x;
  const dz = target.z - player.z;
  const length = Math.hypot(dx, dz);
  if (length < 0.001) return 1;
  return (forward.x * dx + forward.z * dz) / length;
};

function nearestGraphNode(graph, x, z) {
  if (!graph?.nodes?.length) return null;
  let best = null;
  let bestDistance = Infinity;
  for (const node of graph.nodes) {
    const distance = Math.hypot(node.x - x, node.z - z);
    if (distance < bestDistance) {
      best = node;
      bestDistance = distance;
    }
  }
  return best;
}

function graphShortestPath(graph, fromId, toId) {
  if (!graph?.nodes?.length || !graph?.edges?.length || !fromId || !toId) return null;
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  if (!byId.has(fromId) || !byId.has(toId)) return null;
  const adjacent = new Map(graph.nodes.map((node) => [node.id, []]));
  for (const edge of graph.edges) {
    const [aId, bId] = edge;
    const a = byId.get(aId);
    const b = byId.get(bId);
    if (!a || !b) continue;
    const length = distanceBetween(a, b);
    adjacent.get(aId).push([bId, length]);
    adjacent.get(bId).push([aId, length]);
  }
  const distances = new Map([[fromId, 0]]);
  const previous = new Map();
  const remaining = new Set(byId.keys());
  while (remaining.size) {
    let current = null;
    let currentDistance = Infinity;
    for (const id of remaining) {
      const candidate = distances.get(id) ?? Infinity;
      if (candidate < currentDistance) {
        current = id;
        currentDistance = candidate;
      }
    }
    if (current === null || currentDistance === Infinity) break;
    remaining.delete(current);
    if (current === toId) break;
    for (const [next, length] of adjacent.get(current)) {
      const candidate = currentDistance + length;
      if (candidate < (distances.get(next) ?? Infinity)) {
        distances.set(next, candidate);
        previous.set(next, current);
      }
    }
  }
  if (!distances.has(toId)) return null;
  const ids = [];
  for (let id = toId; id; id = previous.get(id)) {
    ids.push(id);
    if (id === fromId) break;
  }
  if (ids.at(-1) !== fromId) return null;
  return { ids: ids.reverse(), length: distances.get(toId), byId };
}

async function openPage(label) {
  const { browser, context } = await newContext();
  let page;
  try {
    page = await context.newPage();
  } catch (error) {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    throw error;
  }
  const close = async () => {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  };
  activeHarness = { close };
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${label}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`${label}: PAGEERROR ${e.message}`));
  page.on('requestfailed', (request) => networkErrors.push(
    `${label}: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? 'failed'}`,
  ));
  page.on('response', (response) => {
    if (response.status() >= 400) networkErrors.push(`${label}: HTTP ${response.status()} ${response.url()}`);
  });
  const sleep = (ms) => page.waitForTimeout(ms);
  const rawUi = () => page.evaluate((SEL) => {
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
  const ui = async () => {
    const state = await rawUi();
    lastTrace = state?.debug ? {
      phase: state.debug.phase,
      elapsed: state.debug.elapsed,
      frame: state.debug.frame,
      player: state.debug.player,
      carriedPhoto: state.debug.carriedPhoto,
      shutterReady: state.debug.shutterReady,
      framing: state.debug.framing ?? state.debug.framingResult ?? {
        visibleFraction: state.debug.visibleFraction,
        blockedSampleCount: state.debug.blockedSampleCount,
      },
      visitors: state.debug.visitors?.map((visitor) => [
        visitor.index, visitor.state, visitor.asked, visitor.served,
      ]),
    } : state;
    const player = state?.debug?.player;
    const bounds = state?.debug?.bounds;
    if (player && bounds) {
      boundsObserved = true;
      const inside = player.x >= bounds.minX && player.x <= bounds.maxX
        && player.z >= bounds.minZ && player.z <= bounds.maxZ;
      if (!inside && boundsViolations.length < 8) boundsViolations.push({ label, player, bounds });
    }
    return state;
  };
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
  // Walk the campus graph node by node. A stalled leg causes a fresh nearest-
  // node lookup and shortest-path plan instead of blindly pressing into a fence.
  let lastRoute = null;
  const walkSegment = async (x, z, radius, stop, maxSteps = 140) => {
    for (let step = 0; step < maxSteps; step += 1) {
      const state = await ui();
      if (stop && stop(state)) return state;
      const player = state.debug?.player;
      if (!player || !Number.isFinite(state.debug?.elapsed) || !Number.isFinite(state.debug?.frame)) {
        throw new Error('Zoo movement debug elapsed/frame/player became unavailable');
      }
      const dx = x - player.x;
      const dz = z - player.z;
      const distance = Math.hypot(dx, dz);
      if (distance <= radius) return state;
      if (FORCE_WALK_SHORT && distance <= radius + 2) return null;
      const keys = [];
      if (dz < -0.2) keys.push('KeyW');
      if (dz > 0.2) keys.push('KeyS');
      if (dx > 0.2) keys.push('KeyD');
      if (dx < -0.2) keys.push('KeyA');
      if (!keys.length) return state;
      for (const key of keys) await page.keyboard.down(key);
      const held = await ui();
      const heldPlayer = held.debug?.player;
      if (!heldPlayer || !Number.isFinite(held.debug?.elapsed) || !Number.isFinite(held.debug?.frame)) {
        throw new Error('Zoo movement debug disappeared after pressing movement keys');
      }
      const heldDistance = Math.hypot(x - heldPlayer.x, z - heldPlayer.z);
      const heldFrame = held.debug.frame;
      const heldElapsed = held.debug.elapsed;
      const wallDeadline = Date.now() + 20000;
      let observedUpdate = false;
      let after = held;
      try {
        while (Date.now() < wallDeadline) {
          after = await ui();
          const afterPlayer = after.debug?.player;
          if (!afterPlayer || !Number.isFinite(after.debug?.elapsed) || !Number.isFinite(after.debug?.frame)) {
            throw new Error('Zoo movement debug disappeared while movement keys were held');
          }
          const frameDelta = after.debug.frame - heldFrame;
          observedUpdate ||= frameDelta > 0;
          const elapsedDelta = after.debug.elapsed - heldElapsed;
          const afterDistance = Math.hypot(x - afterPlayer.x, z - afterPlayer.z);
          const progressed = afterDistance < heldDistance - 0.04;
          if (observedUpdate && (progressed || elapsedDelta >= 0.35 || frameDelta >= 12)) break;
          await sleep(20);
        }
        if (!observedUpdate) {
          throw new Error('No Zoo update occurred while movement keys were held');
        }
      } finally {
        if (observedUpdate) {
          for (const key of keys) await page.keyboard.up(key);
        }
      }
      const afterPlayer = after.debug.player;
      const afterDistance = Math.hypot(x - afterPlayer.x, z - afterPlayer.z);
      if (stop && stop(after)) return after;
      if (afterDistance <= radius) return after;
      if (afterDistance >= heldDistance - 0.04) return null;
    }
    return null;
  };
  const walkTo = async (x, z, radius = 1.2, stop = null, max = 0) => {
    const startedAt = Date.now();
    let replans = 0;
    let graphLength = null;
    for (; replans <= 3; replans += 1) {
      const state = await ui();
      if (stop && stop(state)) return state;
      const player = state.debug?.player;
      const graph = state.debug?.pathGraph;
      if (!player) return null;
      const from = nearestGraphNode(graph, player.x, player.z);
      const to = nearestGraphNode(graph, x, z);
      const route = graphShortestPath(graph, from?.id, to?.id);
      graphLength = route?.length ?? graphLength;
      let reached = true;
      if (route) {
        for (const id of route.ids) {
          const node = route.byId.get(id);
          const atNode = await walkSegment(node.x, node.z, 0.8, stop, max || 140);
          if (!atNode) {
            reached = false;
            break;
          }
          if (stop && stop(atNode)) {
            lastRoute = { replans, graphLength, elapsedMs: Date.now() - startedAt };
            return atNode;
          }
        }
      }
      if (reached) {
        const atTarget = await walkSegment(x, z, radius, stop, max || 140);
        if (atTarget) {
          lastRoute = { replans, graphLength, elapsedMs: Date.now() - startedAt };
          return atTarget;
        }
      }
    }
    lastRoute = { replans, graphLength, elapsedMs: Date.now() - startedAt };
    const player = (await ui()).debug?.player;
    console.log(`  (route gave up short of ${x.toFixed(1)},${z.toFixed(1)} at ${player ? `${player.x.toFixed(1)},${player.z.toFixed(1)}` : '?'})`);
    return null;
  };
  await page.goto(URL, { waitUntil: 'networkidle' });
  await sleep(3200);
  const harness = { page, sleep, ui, waitFor, hold, walkTo, getLastRoute: () => lastRoute, close };
  activeHarness = harness;
  return harness;
}

// Hub door for Zoo is the rightmost of the arc.
async function enterZoo(h, label = 'zoo') {
  await h.hold(['KeyD'], 1500);
  const atDoor = await holdUntil(h.page, 'KeyW', async () => (await h.ui()).prompt, { maxMs: 7000 });
  if (!atDoor || !(await h.ui()).prompt) return null;
  await h.page.keyboard.press('Space');
  // Campus geometry and thirteen canvas signs can take a good deal longer to
  // build than the hub, especially on a software renderer.
  const debug = await waitForDebug(h.page, 'zoo', Boolean, { timeoutMs: 20000, label });
  const entered = debug ? await h.ui() : null;
  if (!entered) {
    const s = await h.ui();
    console.log(`  ${label}: never entered. prompt=${s.prompt} greeting=${s.greeting} body="${(s.body || '').slice(0, 90).replace(/\s+/g, ' ')}"`);
    await h.page.screenshot({ path: `${OUT}-fail-${label}.png` });
  }
  return entered;
}

// Match the exact sentences, never a guessed plural: "I like wolves." and
// "I like foxes." defeat an `<animal>s?` pattern, which silently produced a null
// animal and sent the harness chasing a habitat that does not exist.
const SENTENCE_TO_ID = {
  'I like elephants.': 'elephant',
  'I like giraffes.': 'giraffe',
  'I like penguins.': 'penguin',
  'I like tigers.': 'tiger',
  'I like deer.': 'deer',
  'I like alpacas.': 'alpaca',
  'I like horses.': 'horse',
  'I like foxes.': 'fox',
  'I like wolves.': 'wolf',
  'I like stags.': 'stag',
  'I like bulls.': 'bull',
  'I like cows.': 'cow',
  'I like donkeys.': 'donkey',
};
const animalFromSentence = (sentence) => SENTENCE_TO_ID[(sentence || '').trim()] ?? null;
const waitingVisitor = (s) => s?.debug?.visitors?.findIndex(
  (v) => v.asked === false && v.state !== 'hidden',
) ?? -1;
const habitat = (s, id) => s?.debug?.habitats?.find((hb) => hb.id === id) ?? null;

const sortedAnimalIds = (animals) => (animals ?? []).map((animal) => animal?.id).filter(Boolean).sort();
const sameAnimalIds = (actual, expected) => (
  actual.length === expected.length && actual.every((id, index) => id === expected[index])
);

function inspectSignage(debug) {
  const signage = debug?.signage;
  const board = signage?.youAreHere;
  const signposts = signage?.signposts ?? [];
  const expectedAnimals = [...ANIMALS].sort();
  const boardAnimals = sortedAnimalIds(board?.animals);
  const habitatsByRegion = new Map();
  for (const item of debug?.habitats ?? []) {
    if (!habitatsByRegion.has(item.region)) habitatsByRegion.set(item.region, []);
    habitatsByRegion.get(item.region).push(item.id);
  }
  for (const animals of habitatsByRegion.values()) animals.sort();

  const boardReady = Boolean(
    board?.exists
    && sameAnimalIds(boardAnimals, expectedAnimals)
    && board.animals.every((animal) => typeof animal.label === 'string' && animal.label.trim())
    && board.animals.every((animal) => habitatsByRegion.get(animal.region)?.includes(animal.id)),
  );
  const coveredRegions = new Set();
  const signpostsReady = signposts.length > 0 && signposts.every((signpost) => {
    const expected = habitatsByRegion.get(signpost.regionId);
    if (!expected) return false;
    const actual = sortedAnimalIds(signpost.animals);
    const complete = sameAnimalIds(actual, expected);
    if (complete) coveredRegions.add(signpost.regionId);
    return complete
      && typeof signpost.regionName === 'string'
      && /[^\x00-\x7f]/.test(signpost.regionName)
      && signpost.animals.every((animal) => typeof animal.label === 'string' && animal.label.trim());
  }) && coveredRegions.size === habitatsByRegion.size;

  const labelsByAnimal = new Map(ANIMALS.map((animal) => [animal, new Set()]));
  for (const animal of board?.animals ?? []) labelsByAnimal.get(animal.id)?.add(animal.label);
  for (const signpost of signposts) {
    for (const animal of signpost.animals ?? []) labelsByAnimal.get(animal.id)?.add(animal.label);
  }
  const labelsConsistent = ANIMALS.every((animal) => labelsByAnimal.get(animal)?.size === 1);
  const neutralBoard = boardReady
    && !/want|request|selected|highlight|emphasis|favou?rite/i.test(JSON.stringify(board));

  return {
    signage,
    boardReady,
    signpostsReady,
    labelsConsistent,
    neutralBoard,
    detail: {
      boardAnimals,
      boardRegions: board?.regions?.map((region) => region.id) ?? [],
      signposts: signposts.map((signpost) => ({
        id: signpost.id,
        regionId: signpost.regionId,
        regionName: signpost.regionName,
        animals: sortedAnimalIds(signpost.animals),
      })),
    },
  };
}

async function runSection(name, enabled, run) {
  if (!enabled) return;
  const expected = CHECK_REGISTRY[name];
  const start = results.length;
  const sectionRun = { pending: new Set(expected) };
  sectionRuns.set(name, sectionRun);
  activeSection = name;
  activeHarness = null;
  try {
    await run();
    check(`${name} section completes without a harness exception`, true);
  } catch (error) {
    const completionName = `${name} section completes without a harness exception`;
    if (sectionRun.pending.has(completionName)) {
      sectionRun.pending.delete(completionName);
      emitCheck(name, completionName, false,
        error?.stack?.split('\n').slice(0, 3).join(' | ') || String(error), 'HARNESS_ERROR', lastTrace);
    }
    console.log(`  ${name} section failed; continuing: ${error?.message ?? error}`);
  } finally {
    for (const missing of [...sectionRun.pending]) {
      sectionRun.pending.delete(missing);
      emitCheck(name, missing, false, 'HARNESS_PRECONDITION_FAILED: section did not reach this check',
        'HARNESS_PRECONDITION_FAILED', lastTrace);
    }
    await activeHarness?.close();
    activeHarness = null;
    activeSection = null;
    const sectionResults = results.slice(start);
    const passed = sectionResults.filter((result) => result.ok).length;
    console.log(`  ${name}: ${passed}/${expected.length} checks passed (seed ${ZOO_SEED})`);
  }
}

async function askNext(h) {
  const s = await h.waitFor((u) => waitingVisitor(u) >= 0, 20000, 'waiting visitor');
  if (!s) return null;
  const index = waitingVisitor(s);
  const v = s.debug?.visitors?.[index];
  if (!v) return null;
  const asked = await h.walkTo(v.x, v.z, 1.1, (u) => u.fallback.length > 0);
  if (!asked?.fallback.length) return null;
  if (!await clickIfPresent(h.page, '.lesson-hud__fallback')) return null;
  const a = await h.waitFor((u) => u.bubble && /^I like .+\.$/.test(u.bubble), 7000, 'answer');
  const animal = animalFromSentence(a?.bubble);
  if (!animal) console.log(`  could not read an animal from the answer: "${a?.bubble}"`);
  return { index, asked, bubble: a?.bubble, animal };
}

// Call with the viewfinder open: there A/D rotate the player in place
// (D raises yaw), so turning can never walk off the viewpoint.
async function faceHabitat(h, hb, viewpoint) {
  const yawError = (p) => {
    const wanted = Math.atan2(hb.x - p.x, hb.z - p.z);
    return Math.atan2(Math.sin(wanted - p.yaw), Math.cos(wanted - p.yaw));
  };
  let state = await h.ui();
  let player = state.debug?.player;
  if (!player || distanceBetween(player, viewpoint) > 0.9) return { ok: false, state, why: 'not at viewpoint' };
  if (!Number.isFinite(player.yaw)) return { ok: false, state, why: 'facing debug unavailable' };
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const dot = facingDot(player, hb);
    if (dot !== null && dot >= 0.92) return { ok: true, state, dot, yaw: player.yaw };
    const key = yawError(player) > 0 ? 'KeyD' : 'KeyA';
    await holdUntil(h.page, key, async () => {
      const p = (await h.ui()).debug?.player;
      return !p || Math.abs(yawError(p)) < 0.12 || Math.sign(yawError(p)) !== (key === 'KeyD' ? 1 : -1);
    }, { maxMs: 4500 });
    state = await h.ui();
    player = state.debug?.player;
    if (!player) return { ok: false, state, why: 'player debug disappeared' };
    if (distanceBetween(player, viewpoint) > 0.9) return { ok: false, state, why: 'turning moved the player off the viewpoint' };
  }
  const dot = facingDot(player, hb);
  return { ok: dot !== null && dot >= 0.92, state, dot, yaw: player.yaw, why: 'did not face habitat' };
}

// Walk to a habitat, face it from the viewpoint, open the viewfinder, and shoot.
async function photograph(h, animal, tag = '') {
  const startedAt = Date.now();
  const s = await h.ui();
  const hb = habitat(s, animal);
  if (!hb) return { reached: false, facingOk: false, shutterReady: false, why: `no habitat for ${animal}` };
  const viewpoint = hb.viewpoint;
  if (!viewpoint || !Number.isFinite(viewpoint.x) || !Number.isFinite(viewpoint.z)) {
    return { reached: false, facingOk: false, shutterReady: false, why: `no viewpoint for ${animal}` };
  }
  let walked = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    walked = await h.walkTo(viewpoint.x, viewpoint.z, 0.9);
    const player = walked?.debug?.player;
    if (player && distanceBetween(player, viewpoint) <= 0.9) break;
    walked = null;
  }
  const at = walked?.debug?.player;
  if (!walked) return {
    reached: false, facingOk: false, shutterReady: false,
    why: 'viewpoint was unreachable', animal, viewpoint, at,
    wallSeconds: (Date.now() - startedAt) / 1000,
  };
  await clickUntil(
    h.page,
    async () => {
      const box = await h.page.locator(SEL.camera).boundingBox();
      return box ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : null;
    },
    async () => (await h.ui()).viewfinder,
    { attempts: 3, timeoutMs: 1800 },
  );
  const open = await h.waitFor((u) => u.viewfinder, 5000, 'viewfinder');
  if (!open) return {
    reached: true, facingOk: false, shutterReady: false,
    why: 'viewfinder never opened', animal, at,
    wallSeconds: (Date.now() - startedAt) / 1000,
  };
  const faced = await faceHabitat(h, hb, viewpoint);
  if (!faced.ok) {
    await clickIfPresent(h.page, SEL.close);
    await h.waitFor((u) => !u.viewfinder, 4000);
    return {
      reached: true, facingOk: false, shutterReady: false,
      why: faced.why, animal, viewpoint, at: faced.state?.debug?.player, dot: faced.dot,
      wallSeconds: (Date.now() - startedAt) / 1000,
    };
  }
  const readyNow = (u) => u.debug?.phase === 'viewfinder' && u.shutterEnabled && u.debug?.shutterReady;
  const ready = await h.waitFor(readyNow, 5000);
  if (!ready) {
    await h.page.screenshot({ path: `${OUT}-fail-${animal}${tag}-aim.png` });
    console.log(`  could not frame ${animal}: player=${JSON.stringify((await h.ui()).debug?.player)} habitat=${JSON.stringify(hb)}`);
    await clickIfPresent(h.page, SEL.close);
    await h.waitFor((u) => !u.viewfinder, 4000);
    return {
      reached: true, facingOk: true, shutterReady: false,
      why: 'never framed', animal, at, framing: (await h.ui()).debug?.framing,
      wallSeconds: (Date.now() - startedAt) / 1000,
    };
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
  await clickUntil(
    h.page,
    async () => {
      const box = await h.page.locator(SEL.shutter).boundingBox();
      return box ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : null;
    },
    async () => (await h.ui()).debug?.carriedPhoto === animal,
    { attempts: 2, timeoutMs: 2200 },
  );
  const shot = await h.waitFor((u) => u.debug?.carriedPhoto === animal && !u.viewfinder, 4000, 'photo taken');
  if (!shot) {
    await h.page.screenshot({ path: `${OUT}-fail-${animal}${tag}-shutter.png` });
    const clicks = await h.page.evaluate(() => window.__shutterClicks);
    console.log(`  shutter clicked but no photo for ${animal}: before=${JSON.stringify(before)} clicksSeen=${clicks} after=${JSON.stringify((await h.ui()).debug)}`);
  }
  await clickIfPresent(h.page, SEL.close);
  await h.waitFor((u) => !u.viewfinder, 4000);
  return {
    reached: true,
    facingOk: true,
    shutterReady: true,
    ready: true,
    carried: shot?.debug?.carriedPhoto ?? null,
    animal,
    at,
    wallSeconds: (Date.now() - startedAt) / 1000,
  };
}

// Pens are close enough that a neighbour can frame better than the animal the
// child means. Close in and re-aim until the photo is actually of the animal
// asked for, the way a child would step up to the fence.
async function photographVerified(h, animal, tag = '') {
  let last = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    last = await photograph(h, animal, `${tag}-r${attempt}`);
    if (last?.carried === animal) return last;
    if (last?.carried) {
      console.log(`  wanted ${animal} but photographed ${last.carried}; stepping closer`);
      await h.waitFor((u) => u.debug?.phase === 'playing', 6000);
    }
  }
  return last;
}

async function showPhoto(h, index) {
  // A refusal or a thank-you plays out before the game accepts input again.
  const playing = await h.waitFor((u) => u.debug?.phase === 'playing', 8000);
  if (!playing?.debug?.carriedPhoto) return { arrived: false, state: playing, why: 'no carried photo in playing phase' };
  const s = await h.ui();
  const v = s.debug?.visitors?.[index];
  if (!v) return { arrived: false, state: s, why: `visitor ${index} unavailable` };
  const arrived = await h.walkTo(v.x, v.z, 1.1);
  const atVisitor = arrived?.debug?.player;
  const currentVisitor = arrived?.debug?.visitors?.[index];
  if (!atVisitor || !currentVisitor || distanceBetween(atVisitor, currentVisitor) > 1.1
    || arrived.debug?.phase !== 'playing' || !arrived.debug?.carriedPhoto) {
    return { arrived: false, state: arrived, why: 'visitor delivery position was not reached' };
  }
  const carriedBefore = arrived.debug.carriedPhoto;
  await h.page.keyboard.press('Space');
  const delivered = await h.waitFor((u) => u.debug?.phase !== 'playing'
    || u.debug?.visitors?.[index]?.served
    || u.debug?.carriedPhoto !== carriedBefore, 8000, 'photo delivery');
  return { arrived: true, state: delivered, why: delivered ? null : 'delivery input did not take effect' };
}

// ---- Session A: the listening route -------------------------------------
await runSection('listening', !process.env.ONLY_B && sectionEnabled('listening'), async () => {
  const h = await openPage('A');
  const { page } = h;
  let s = await enterZoo(h);
  check('hub -> Zoo', Boolean(s?.debug), '', Boolean(s?.debug));
  if (!s?.debug) return;
  await h.sleep(1500);
  s = await h.ui();
  check('debug snapshot exposes every habitat and no wanted animals',
    s.debug?.habitats?.length === 13 && !JSON.stringify(s.debug).match(/want|favou?rite/i),
    JSON.stringify(s.debug?.habitats?.map((x) => x.id)));
  check('nothing points the way (no marker/arrow/minimap in the overlay)',
    !/やじるし|→|arrow|minimap/i.test(s.body));
  await page.screenshot({ path: `${OUT}-01-plaza.png` });

  let served = 0;
  let deliveryPreconditionsMet = true;
  for (let i = 0; i < 3; i += 1) {
    const q = await askNext(h);
    if (!q) {
      deliveryPreconditionsMet = false;
      console.log(`  stalled before visitor ${i + 1}: ${JSON.stringify((await h.ui()).debug)}`);
      break;
    }
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
      // Hidden while this visitor's answer is still playing; wait, don't sample once.
      await h.waitFor((u) => u.listen, 8000, '🔊');
      const replayClicked = await clickIfPresent(page, '.listen-again');
      check('Listen Again control can be clicked', replayClicked, '', Boolean(q));
      const r = await h.waitFor((u) => u.bubble && /I like/.test(u.bubble), 3000, 'replayed answer');
      check('🔊 replays the visitor\'s exact sentence', r?.bubble === q.bubble, r?.bubble);
      await h.waitFor((u) => !u.bubble, 6000);
    }
    const shot = await photographVerified(h, q.animal);
    check(`request ${i + 1} viewpoint is reached before photographing`, true,
      JSON.stringify(shot), Boolean(shot?.reached));
    if (i === 0) {
      check('the viewfinder only shoots a well-framed animal', shot?.ready, JSON.stringify(shot), Boolean(shot?.reached && shot?.facingOk));
      check('the photo taken is of that animal', shot?.carried === q.animal, shot?.carried, Boolean(shot?.ready));
      await page.screenshot({ path: `${OUT}-03-photo.png` });
    }
    const delivery = await showPhoto(h, q.index);
    check(`visitor ${i + 1} is reached before showing the photo`, true,
      delivery.why ?? '', delivery.arrived, delivery.state?.debug);
    s = delivery.state;
    if (!delivery.arrived || !s) {
      deliveryPreconditionsMet = false;
      break;
    }
    if (s?.debug?.visitors[q.index]?.served) served += 1;
    if (i === 0) await page.screenshot({ path: `${OUT}-04-shown.png` });
  }
  check('all three requests completed', served === 3, `${served}/3`, deliveryPreconditionsMet);

  s = await h.waitFor((u) => u.fallback.length >= 3, 15000, 'turnaround');
  const values = s?.fallback.map((f) => f.value) ?? [];
  check('turnaround offers every animal sentence', values.length === 13 && values.includes('tiger'),
    s?.fallback.map((f) => f.text).join(' | '), Boolean(s));
  await page.screenshot({ path: `${OUT}-05-turnaround.png` });
  // Never throw here: a missing turnaround used to abort the whole run and take
  // session B's evidence with it. Record it and carry on.
  const turnaroundClicked = await clickIfPresent(
    page, '.lesson-hud__fallback[data-value="tiger"]', { timeoutMs: 8000 },
  );
  check('turnaround answer can be selected', turnaroundClicked, '', Boolean(s));
  if (!turnaroundClicked) await page.screenshot({ path: `${OUT}-fail-turnaround.png` }).catch(() => {});
  s = await h.waitFor((u) => !u.debug && u.greeting !== null, 15000, 'hub');
  const hubReached = Boolean(s);
  check('finishes back to the hub', Boolean(s), '', Boolean(s));
  await h.sleep(1200);
  s = await h.ui();
  check('hub greets with the animal the child chose', s.greeting?.includes('tiger'), s.greeting, Boolean(s?.greeting));
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '{}'), SAVE_KEY);
  check('stamp and answer persisted', saved?.stamps?.zoo === true && saved?.answers?.animal === 'tiger',
    JSON.stringify({ stamps: saved?.stamps, answers: saved?.answers }), hubReached);
  check('listening + one replay = 3 stars', saved?.bestStars?.zoo === 3, JSON.stringify(saved?.bestStars), hubReached);
  const photo = saved?.zooPhotos?.zoo ?? saved?.zooPhotos?.animal ?? null;
  check('a photo was saved for the stamp book', typeof photo === 'string' && photo.startsWith('data:image/'),
    photo ? `${photo.slice(0, 24)}… ${Math.round(photo.length / 1024)} kB` : 'none', hubReached);
  const stampClicked = await clickIfPresent(page, '.stamp-button', { timeoutMs: 3000 });
  check('stamp book control is available', stampClicked, '', Boolean(s?.greeting));
  if (stampClicked) {
    await h.sleep(600);
    const shown = await page.evaluate(() => Boolean(document.querySelector('.stamp-photo')));
    check('the stamp book shows the photo', shown);
    await page.screenshot({ path: `${OUT}-06-stampbook.png` });
    await page.evaluate(() => document.querySelector('.modal-header button')?.click());
  } else {
    check('the stamp book shows the photo', false, 'stamp book was not opened', false);
  }

  s = await enterZoo(h);
  check('Zoo can be entered a second time', Boolean(s?.debug), '', Boolean(s?.debug));
  await h.sleep(1500);
  const dupes = await page.evaluate((SEL) => ({
    listen: document.querySelectorAll('.listen-again').length,
    hud: document.querySelectorAll('.lesson-hud').length,
    viewfinder: document.querySelectorAll(SEL.viewfinder).length,
  }), SEL);
  check('re-entry leaves no duplicated overlays', dupes.listen <= 1 && dupes.hud === 1 && dupes.viewfinder <= 1,
    JSON.stringify(dupes), Boolean(s?.debug));
});

// ---- Session B: ignore the answers, show a wrong animal first --------------
await runSection('antiShortcut', process.env.ONLY_B || sectionEnabled('antiShortcut'), async () => {
  const h = await openPage('B');
  const { page } = h;
  const entered = await enterZoo(h);
  if (!entered?.debug) return;
  await h.sleep(1500);
  let refusal = null;
  let deliveriesReached = true;
  for (let i = 0; i < 3; i += 1) {
    const q = await askNext(h);
    if (!q) {
      deliveriesReached = false;
      console.log(`  B stalled before visitor ${i + 1}: ${JSON.stringify((await h.ui()).debug)}`);
      break;
    }
    await h.waitFor((u) => !u.bubble, 8000);
    const wrong = ANIMALS.find((a) => a !== q.animal);
    const wrongShot = await photograph(h, wrong);
    check(`request ${i + 1} wrong-photo viewpoint is reached before photographing`, true,
      JSON.stringify(wrongShot), Boolean(wrongShot?.reached));
    if (!wrongShot?.carried) {
      deliveriesReached = false;
      break;
    }
    const wrongDelivery = await showPhoto(h, q.index);
    check(`visitor ${i + 1} is reached before wrong-photo delivery`, true,
      wrongDelivery.why ?? '', wrongDelivery.arrived, wrongDelivery.state?.debug);
    let s = wrongDelivery.state;
    if (!wrongDelivery.arrived || !s) {
      deliveriesReached = false;
      break;
    }
    if (refusal === null) {
      refusal = {
        bubble: s?.bubble,
        english: /I like/.test(s?.body ?? ''),
        served: s?.debug?.visitors[q.index]?.served,
        carriedPhoto: s?.debug?.carriedPhoto,
      };
      await page.screenshot({ path: `${OUT}-07-wrong-animal.png` });
    }
    // A refused photo is consumed. Wait for that state and for play to resume,
    // then retry the correct photo until it is actually in hand.
    let correctShot = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const resumed = await h.waitFor((u) => u.debug?.phase === 'playing' && u.debug?.carriedPhoto === null,
        8000, 'refusal to consume photo and play to resume');
      if (!resumed) break;
      const before = await h.ui();
      correctShot = await photographVerified(h, q.animal, `-B${attempt}`);
      const after = await h.ui();
      console.log(`  B retry ${attempt} for ${q.animal}: resumed=${Boolean(resumed)} phaseBefore=${before.debug?.phase} -> ${JSON.stringify(correctShot)} phaseAfter=${after.debug?.phase} carried=${after.debug?.carriedPhoto} player=${after.debug?.player?.x?.toFixed(1)},${after.debug?.player?.z?.toFixed(1)}`);
      if (correctShot?.carried === q.animal) break;
    }
    check(`request ${i + 1} correct-photo viewpoint is reached before photographing`, true,
      JSON.stringify(correctShot), Boolean(correctShot?.reached));
    if (correctShot?.carried !== q.animal) {
      deliveriesReached = false;
      break;
    }
    const correctDelivery = await showPhoto(h, q.index);
    check(`visitor ${i + 1} is reached before correct-photo delivery`, true,
      correctDelivery.why ?? '', correctDelivery.arrived, correctDelivery.state?.debug);
    if (!correctDelivery.arrived || !correctDelivery.state) {
      deliveriesReached = false;
      break;
    }
  }
  check('a wrong animal is refused in Japanese with no English repeat',
    refusal && !refusal.english && refusal.served === false && refusal.bubble,
    JSON.stringify(refusal), Boolean(refusal));
  check('a refused photo is no longer carried', refusal?.carriedPhoto === null,
    JSON.stringify(refusal), Boolean(refusal));
  const s = await h.waitFor((u) => u.fallback.length >= 3, 15000, 'turnaround');
  const clicked = s ? await clickIfPresent(page, '.lesson-hud__fallback') : false;
  check('anti-shortcut turnaround answer can be selected', clicked, '', Boolean(s));
  const hub = await h.waitFor((u) => !u.debug, 15000, 'hub');
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '{}'), SAVE_KEY);
  const stars = saved?.bestStars?.zoo ?? null;
  check('showing wrong photos still finishes and earns the stamp (no dead end)', saved?.stamps?.zoo === true,
    '', deliveriesReached && Boolean(hub));
  check('anti-shortcut: showing a wrong animal first cannot reach 3 stars', stars !== null && stars < 3,
    JSON.stringify(saved?.bestStars), deliveriesReached && Boolean(hub));
});

// ---- Session C: visit and photograph every habitat on the campus ----------
await runSection('habitats', sectionEnabled('habitats'), async () => {
  const errorStart = errors.length;
  const networkErrorStart = networkErrors.length;
  const h = await openPage('habitats');
  const entered = await enterZoo(h, 'habitats');
  const environmentDone = entered ? await h.waitFor(
    (value) => ['ready', 'ready-with-fallbacks'].includes(value.debug?.environment?.status)
      && value.debug.environment.pending === 0,
    30000,
    'environment assets to finish loading',
  ) : null;
  let state = environmentDone ?? (entered ? await h.ui() : null);
  const environment = state?.debug?.environment;
  const environmentExposed = Boolean(
    entered
    && typeof environment?.status === 'string'
    && Number.isFinite(environment?.pending),
  );
  const environmentReady = Boolean(
    environmentDone
    && environment.loadedUniqueModels > 0
    && Array.isArray(environment.failedAssets),
  );
  check('environment assets reach a terminal load state', environmentReady,
    JSON.stringify(environment), environmentExposed, state?.debug);
  check('environment assets load without fallbacks or failed assets',
    environmentReady && environment.status === 'ready' && environment.failedAssets.length === 0,
    JSON.stringify(environment), environmentReady, state?.debug);
  check('environment loading produces no console or page errors', errors.length === errorStart,
    errors.slice(errorStart, errorStart + 3).join(' || '), environmentReady, state?.debug);
  check('environment loading produces no failed network requests', networkErrors.length === networkErrorStart,
    networkErrors.slice(networkErrorStart, networkErrorStart + 3).join(' || '), environmentReady, state?.debug);

  const stats = state?.debug?.sceneStats;
  const reportedSceneStats = {
    beforeDressing: stats?.beforeDressing ?? null,
    afterDressing: stats?.afterDressing ?? null,
    current: stats?.current ?? null,
    uniqueEnvironmentModels: environment?.loadedUniqueModels
      ?? stats?.current?.uniqueEnvironmentModels
      ?? 0,
  };
  console.log(`  sceneStats ${JSON.stringify(reportedSceneStats)}`);
  const statsReady = Boolean(stats?.beforeDressing && stats?.afterDressing && stats?.current);
  check('scene stats expose before and after dressing with instanced scenery',
    statsReady
      && stats.afterDressing.instancedMeshes > stats.beforeDressing.instancedMeshes
      && stats.afterDressing.uniqueEnvironmentModels === environment?.loadedUniqueModels,
    JSON.stringify(stats), environmentReady && statsReady, state?.debug);

  const signage = inspectSignage(state?.debug);
  check('YOU ARE HERE board exists and names all thirteen animals once', signage.boardReady,
    JSON.stringify(signage.detail), Boolean(environmentDone && signage.signage), state?.debug);
  check('YOU ARE HERE board text is neutral and never marks a request', signage.neutralBoard,
    JSON.stringify(signage.detail), signage.boardReady, state?.debug);
  check('junction signposts use Japanese region names and complete regional animal lists',
    signage.signpostsReady, JSON.stringify(signage.detail), Boolean(environmentDone && signage.signage), state?.debug);
  check('animal labels are consistent across the board and signposts', signage.labelsConsistent,
    JSON.stringify(signage.detail), signage.boardReady && signage.signpostsReady, state?.debug);

  const graph = state?.debug?.pathGraph;
  const plaza = graph?.nodes?.find((node) => node.kind === 'plaza') ?? null;
  const hub = graph?.nodes?.find((node) => node.kind === 'hub') ?? null;
  const graphReady = Boolean(
    plaza
    && hub
    && graph.nodes.length > 0
    && graph.edges.length > 0
    && state?.debug?.habitats?.length === ANIMALS.length,
  );
  check('campus debug exposes a routable graph and all habitat viewpoints', graphReady,
    JSON.stringify({
      plaza: plaza?.id,
      hub: hub?.id,
      nodes: graph?.nodes?.length ?? 0,
      edges: graph?.edges?.length ?? 0,
      habitats: state?.debug?.habitats?.length ?? 0,
    }), Boolean(entered), state?.debug);

  const plazaReached = graphReady ? await h.walkTo(plaza.x, plaza.z, 0.8) : null;
  if (plazaReached) await h.page.screenshot({ path: `${OUT}-region-plaza.png` });
  check('plaza visual-review screenshot is saved', Boolean(plazaReached),
    JSON.stringify(plazaReached?.debug?.player), graphReady && Boolean(plazaReached),
    plazaReached?.debug ?? state?.debug);
  const hubReached = graphReady ? await h.walkTo(hub.x, hub.z, 0.8) : null;
  if (hubReached) await h.page.screenshot({ path: `${OUT}-region-hub.png` });
  check('hub visual-review screenshot is saved', Boolean(hubReached),
    JSON.stringify(hubReached?.debug?.player), graphReady && Boolean(hubReached),
    hubReached?.debug ?? state?.debug);

  const visited = new Set();
  const regionScreenshots = new Set();
  const travelTimes = [];
  const habitatResults = [];
  let allHabitatPreconditionsMet = graphReady;
  for (const animal of ANIMALS) {
    state = await h.ui();
    const hb = habitat(state, animal);
    const viewpointNode = hb?.viewpoint
      ? nearestGraphNode(state?.debug?.pathGraph, hb.viewpoint.x, hb.viewpoint.z)
      : null;
    const habitatReady = Boolean(
      hb?.viewpoint
      && viewpointNode
      && distanceBetween(hb.viewpoint, viewpointNode) < 0.2,
    );
    check(`${animal} has a graph-backed viewpoint`, habitatReady,
      JSON.stringify({ habitat: hb, nearest: viewpointNode }), graphReady, state?.debug);
    if (!graphReady || !habitatReady) {
      allHabitatPreconditionsMet = false;
      const result = {
        animal, reached: false, facingOk: false, shutterReady: false,
        photographedAsRightAnimal: false, wallSeconds: null,
      };
      habitatResults.push(result);
      console.log(`  habitat result ${JSON.stringify(result)}`);
      continue;
    }

    let measured = null;
    let arrived = null;
    let route = null;
    const routePlan = graphShortestPath(graph, plaza.id, viewpointNode.id);
    const modeledSeconds = routePlan ? routePlan.length / MOVE_SPEED : null;
    if (!routePlan) allHabitatPreconditionsMet = false;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const reset = await h.walkTo(plaza.x, plaza.z, 0.8);
      if (!reset) break;
      const startedAt = Date.now();
      arrived = await h.walkTo(hb.viewpoint.x, hb.viewpoint.z, 0.9);
      measured = (Date.now() - startedAt) / 1000;
      route = h.getLastRoute();
      if (arrived?.debug?.player && distanceBetween(arrived.debug.player, hb.viewpoint) <= 0.9) break;
      arrived = null;
    }
    travelTimes.push({ animal, wallSeconds: measured, modeledSeconds, routeLength: routePlan?.length ?? null, route });
    console.log(`  ${animal}: route ${modeledSeconds == null ? 'unavailable' : `${modeledSeconds.toFixed(2)} modeled seconds`}; wall ${measured == null ? 'unreached' : `${measured.toFixed(2)}s`} (${route?.replans ?? '?'} stall replans)`);
    check(`${animal} viewpoint is reached from the plaza`, Boolean(arrived),
      JSON.stringify({ wallSeconds: measured, route, player: arrived?.debug?.player }), Boolean(arrived),
      arrived?.debug ?? state?.debug);
    check(`${animal} graph route is at most 10 seconds at movement speed`,
      modeledSeconds !== null && modeledSeconds <= 10,
      JSON.stringify({ routeLength: routePlan?.length, moveSpeed: MOVE_SPEED, modeledSeconds, wallSeconds: measured }),
      Boolean(routePlan), state?.debug);

    if (!arrived) {
      allHabitatPreconditionsMet = false;
      const result = {
        animal, reached: false, facingOk: false, shutterReady: false,
        photographedAsRightAnimal: false, wallSeconds: measured,
      };
      habitatResults.push(result);
      console.log(`  habitat result ${JSON.stringify(result)}`);
      continue;
    }
    const shot = await photograph(h, animal, '-all');
    const rightAnimal = shot?.shutterReady && shot?.carried === animal;
    check(`${animal} faces the habitat before photographing`, shot?.facingOk,
      JSON.stringify({ shot, viewpoint: hb.viewpoint }), Boolean(shot?.reached), (await h.ui()).debug);
    check(`${animal} reaches shutter-ready from its viewpoint`, shot?.shutterReady,
      JSON.stringify({ shot, viewpoint: hb.viewpoint }), Boolean(shot?.facingOk), (await h.ui()).debug);
    check(`${animal} frames and photographs as the right animal`, rightAnimal,
      JSON.stringify({ shot, viewpoint: hb.viewpoint }), Boolean(shot?.shutterReady), (await h.ui()).debug);
    const result = {
      animal,
      reached: Boolean(shot?.reached),
      facingOk: Boolean(shot?.facingOk),
      shutterReady: Boolean(shot?.shutterReady),
      photographedAsRightAnimal: Boolean(rightAnimal),
      wallSeconds: measured,
    };
    habitatResults.push(result);
    if (!shot?.reached || !shot?.facingOk || !shot?.shutterReady) allHabitatPreconditionsMet = false;
    console.log(`  habitat result ${JSON.stringify(result)}`);
    if (rightAnimal) visited.add(animal);
    await h.waitFor((value) => value.debug?.phase === 'playing', 5000, `${animal} camera to close`);
    if (!regionScreenshots.has(hb.region)) {
      await h.page.screenshot({ path: `${OUT}-region-${hb.region}.png` });
      regionScreenshots.add(hb.region);
    }
  }
  check('all thirteen habitats are photographed in one session',
    visited.size === ANIMALS.length && ANIMALS.every((animal) => visited.has(animal)),
    JSON.stringify({ visited: [...visited], travelTimes, habitatResults }), allHabitatPreconditionsMet, (await h.ui()).debug);
  const expectedRegionScreenshots = [...new Set(state?.debug?.habitats?.map((item) => item.region) ?? [])].sort();
  check('visual-review screenshots are saved for every habitat region',
    expectedRegionScreenshots.length > 0
      && expectedRegionScreenshots.every((region) => regionScreenshots.has(region)),
    JSON.stringify({ expected: expectedRegionScreenshots, saved: [...regionScreenshots].sort() }),
    allHabitatPreconditionsMet, (await h.ui()).debug);
});

activeSection = 'suite';
sectionRuns.set('suite', { pending: new Set(CHECK_REGISTRY.suite) });
check('no console or page errors', errors.length === 0, errors.slice(0, 3).join(' || '));
check('no network errors', networkErrors.length === 0, networkErrors.slice(0, 3).join(' || '));
check('the player never leaves the campus bounds', boundsObserved && boundsViolations.length === 0,
  JSON.stringify(boundsViolations), boundsObserved);
activeSection = null;
const sectionSummaries = [...sectionRuns.keys()].map((section) => {
  const sectionResults = results.filter((result) => result.section === section);
  return {
    section,
    passed: sectionResults.filter((result) => result.ok).length,
    total: CHECK_REGISTRY[section].length,
    seed: ZOO_SEED,
  };
});
const suiteSummary = sectionSummaries.find((summary) => summary.section === 'suite');
console.log(`  suite: ${suiteSummary.passed}/${suiteSummary.total} checks passed (seed ${ZOO_SEED})`);
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
const resultClass = results.some((result) => result.result === 'HARNESS_ERROR') ? 'HARNESS_ERROR'
  : results.some((result) => result.result === 'HARNESS_PRECONDITION_FAILED') ? 'HARNESS_PRECONDITION_FAILED'
    : results.some((result) => result.result === 'PRODUCT_FAILURE') ? 'PRODUCT_FAILURE'
      : 'PASS';
await writeFile(`${OUT}-results.json`, `${JSON.stringify({
  seed: ZOO_SEED,
  forcedWalkShort: FORCE_WALK_SHORT,
  result: resultClass,
  sections: sectionSummaries,
  checks: results,
}, null, 2)}\n`, 'utf8');
process.exitCode = failed > 0 ? 1 : 0;
