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
import { openFallback } from './lib/pressTalk.mjs';
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
const knownSections = new Set(['listening', 'antiShortcut', 'animals']);
if (selectedSections && [...selectedSections].some((name) => !knownSections.has(name))) {
  throw new Error(`Unknown --only section. Choose from: ${[...knownSections].join(', ')}`);
}
const SAVE_KEY = 'esl-likes-save-v1';
const ANIMALS = ['cat', 'chicken', 'dog', 'horse', 'pig', 'raccoon', 'sheep', 'wolf'];
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
  'debug snapshot exposes every animal and no wanted animals',
  'nothing points the way (no marker/arrow/minimap in the overlay)',
  'question offered: "What animal do you like?"',
  'visitor answers with an exact vocabulary sentence',
  'the answer is not left on screen',
  '🔊 offered while a request is open',
  'Listen Again control can be clicked',
  '🔊 replays the visitor\'s exact sentence',
  ...[1, 2, 3].flatMap((number) => [
    `request ${number} animal is found before photographing`,
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
    `request ${number} wrong-photo animal is found before photographing`,
    `visitor ${number} is reached before wrong-photo delivery`,
    `request ${number} correct-photo animal is found before photographing`,
    `visitor ${number} is reached before correct-photo delivery`,
  ]),
  'a wrong animal is refused in Japanese with no English repeat',
  'a refused photo is no longer carried',
  'anti-shortcut turnaround answer can be selected',
  'showing wrong photos still finishes and earns the stamp (no dead end)',
  'anti-shortcut: showing a wrong animal first cannot reach 3 stars',
  'antiShortcut section completes without a harness exception',
];
const animalCheckNames = (animal) => [
  `${animal} roams inside its own territory`,
  `${animal} is found by searching its area`,
  `${animal} is found within a reasonable search`,
  `${animal} faces the animal before photographing`,
  `${animal} reaches shutter-ready on a moving animal`,
  `${animal} frames and photographs as the right animal`,
];
const animalChecks = [
  'environment assets reach a terminal load state',
  'environment assets load without fallbacks or failed assets',
  'environment loading produces no console or page errors',
  'environment loading produces no failed network requests',
  'scene stats expose before and after dressing with instanced scenery',
  'no signage, boards or animal-location markers remain',
  'no enclosure viewpoints or habitat records remain',
  'the park exposes live roaming animals and broad areas',
  'campus debug exposes a routable graph and all eight animals',
  'plaza visual-review screenshot is saved',
  'hub visual-review screenshot is saved',
  ...ANIMALS.flatMap(animalCheckNames),
  'all eight animals are photographed in one session',
  'visual-review screenshots are saved for every area',
  'animals section completes without a harness exception',
];
const CHECK_REGISTRY = {
  listening: listeningChecks,
  antiShortcut: antiShortcutChecks,
  animals: animalChecks,
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
      talk: visible(q('.lesson-hud__talk')),
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
  // Park geometry and eight animated animals can take a good deal longer to
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

// Match the exact sentences, never a guessed plural: sheep and wolves differ.
// and defeats an `<animal>s?` pattern, which silently produced a null animal and
// sent the harness chasing an animal that does not exist.
const SENTENCE_TO_ID = {
  'I like cats.': 'cat',
  'I like chickens.': 'chicken',
  'I like dogs.': 'dog',
  'I like horses.': 'horse',
  'I like pigs.': 'pig',
  'I like raccoons.': 'raccoon',
  'I like sheep.': 'sheep',
  'I like wolves.': 'wolf',
};
const animalFromSentence = (sentence) => SENTENCE_TO_ID[(sentence || '').trim()] ?? null;
const waitingVisitor = (s) => s?.debug?.visitors?.findIndex(
  (v) => v.asked === false && v.state !== 'hidden',
) ?? -1;
// Where the animal is NOW. There is no fixed habitat any more, so every reader
// has to re-ask: the animal it is looking for has probably moved since the last
// call. Anything that cached a position here would be aiming at empty grass.
const animalState = (s, id) => s?.debug?.animals?.find((a) => a.id === id) ?? null;

const sortedAnimalIds = (animals) => (animals ?? []).map((animal) => animal?.id).filter(Boolean).sort();
const sameAnimalIds = (actual, expected) => (
  actual.length === expected.length && actual.every((id, index) => id === expected[index])
);

/**
 * The park is navigated by looking at it, so the harness checks that the old
 * signage and enclosure systems really are gone rather than merely hidden.
 */
function inspectNavigationAids(debug) {
  // Scan everything except the roaming internals. `territories` and `animals`
  // legitimately contain roaming waypoints and destinations — that is the
  // simulation's own state, not something shown to a child. What must not exist
  // is a signage or marker system.
  const { territories, animals, ...rest } = debug ?? {};
  const serialised = JSON.stringify(rest);
  return {
    noSignageDebug: debug?.signage === undefined,
    noViewpoints: !(debug?.pathGraph?.nodes ?? []).some((node) => node.kind === 'viewpoint'
      || /viewpoint/.test(node.id ?? '')),
    noHabitatRecords: debug?.habitats === undefined,
    noWaypointMarkers: !/youAreHere|signpost|signboard|minimap|marker|arrow/i.test(serialised),
    hasLiveAnimals: Array.isArray(debug?.animals) && debug.animals.length === ANIMALS.length,
    hasAreas: Array.isArray(debug?.areas) && debug.areas.length > 0,
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
  const reached = await h.walkTo(v.x, v.z, 1.1, (u) => u.talk || u.fallback.length > 0);
  const asked = reached ? await openFallback(h) : null;
  if (!asked?.fallback.length) return null;
  if (!await clickIfPresent(h.page, '.lesson-hud__fallback')) return null;
  const a = await h.waitFor((u) => u.bubble && /^I like .+\.$/.test(u.bubble), 7000, 'answer');
  const animal = animalFromSentence(a?.bubble);
  if (!animal) console.log(`  could not read an animal from the answer: "${a?.bubble}"`);
  return { index, asked, bubble: a?.bubble, animal };
}

// Call with the viewfinder open: there A/D rotate the player in place, so
// turning can never walk the player away from the animal.
//
// The target moves, so its position is re-read on every pass rather than fixed
// once at the start. That is the whole difference from the old fenced zoo.
async function faceAnimal(h, animalId) {
  // In the viewfinder the player turns at a known 1.55 rad/s, so aim by tapping
  // the key for roughly the time the remaining error needs and re-measuring,
  // rather than holding it until a predicate flips. Holding overshot badly on
  // small targets: the player span through several whole turns and ended up
  // facing away from an animal it had already lined up on.
  const TURN_RATE = 1.55;
  const errorTo = (p, target) => {
    const wanted = Math.atan2(target.x - p.x, target.z - p.z);
    return Math.atan2(Math.sin(wanted - p.yaw), Math.cos(wanted - p.yaw));
  };

  let state = await h.ui();
  let best = null;
  for (let attempt = 0; attempt < 14; attempt += 1) {
    state = await h.ui();
    const player = state.debug?.player;
    const target = animalState(state, animalId);
    if (!player || !target) return { ok: false, state, why: 'player or animal debug disappeared' };
    if (!Number.isFinite(player.yaw)) return { ok: false, state, why: 'facing debug unavailable' };

    const dot = facingDot(player, target);
    if (dot !== null && (best === null || dot > best.dot)) best = { dot, yaw: player.yaw };
    if (dot !== null && dot >= 0.985) return { ok: true, state, dot, yaw: player.yaw, target };

    const error = errorTo(player, target);
    if (Math.abs(error) < 0.02) return { ok: true, state, dot, yaw: player.yaw, target };
    // Tap for 70% of the ideal time, so repeated taps converge from below
    // instead of hunting around the target.
    const seconds = Math.min(1.2, (Math.abs(error) / TURN_RATE) * 0.7);
    // D decreases the yaw (see updateViewfinderMovement), so a positive error —
    // one that wants a larger yaw — is corrected with A. Getting this backwards
    // makes the loop converge on the exact opposite bearing.
    const key = error > 0 ? 'KeyA' : 'KeyD';
    await h.page.keyboard.down(key);
    await h.sleep(Math.max(30, Math.round(seconds * 1000)));
    await h.page.keyboard.up(key);
  }

  state = await h.ui();
  const player = state.debug?.player;
  const target = animalState(state, animalId);
  const dot = player && target ? facingDot(player, target) : null;
  return {
    ok: dot !== null && dot >= 0.94, state, dot, yaw: player?.yaw,
    best: best?.dot ?? null, why: 'did not settle facing the animal',
  };
}

/**
 * How far back to stand from a given animal.
 *
 * There is no single right distance: a horse fills the viewfinder from farther
 * away while a chicken is a speck at three units. The game scores a photo on the
 * subject's apparent size, so this inverts that — it solves for the distance at
 * which the animal covers about a third of the frame, from the photo bounds the
 * debug snapshot reports.
 *
 *   apparent = sqrt(halfHeight * radius / aspect) / (d * tan(fov / 2))
 *
 * Solving for `apparent` = 0.35 leaves comfortable margin over the 0.38 framing
 * threshold once the aim is centred.
 */
const VIEWFINDER_FOV = 34;
const VIEWFINDER_ASPECT = 1366 / 768;
const WANTED_APPARENT_SIZE = 0.35;
function photoDistance(animal) {
  const halfHeight = Number(animal?.photoHalfHeight) || 0.6;
  const radius = Number(animal?.photoRadius) || 0.5;
  const tangent = Math.tan((VIEWFINDER_FOV * Math.PI) / 360);
  const distance = Math.sqrt((halfHeight * radius) / VIEWFINDER_ASPECT)
    / (WANTED_APPARENT_SIZE * tangent);
  // Never so close the player is inside the animal, nor so far it is a dot.
  return Math.max(2.2, Math.min(12, distance));
}

/**
 * Puts the player at a sensible photographing distance from a roaming animal.
 *
 * This aims for a distance *band*, not a maximum. Being too close fails as
 * surely as being too far: standing a metre from a horse fills the viewfinder
 * with horse and the framing check rejects it, exactly as it would for a child
 * who walked straight into the animal. So the goal point is computed at the
 * wanted distance along the player-to-animal line and the player walks to it
 * whether that means closing in or backing off.
 *
 * The animal is re-read every pass, because it wanders while the player crosses
 * the park.
 */
async function approachAnimal(h, animalId, { range = null, scale = 1, attempts = 6 } = {}) {
  const first = animalState(await h.ui(), animalId);
  const wanted = range ?? photoDistance(first) * scale;
  const near = wanted * 0.55;
  const far = wanted * 1.35;
  let best = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const state = await h.ui();
    const target = animalState(state, animalId);
    const player = state.debug?.player;
    if (!target) return { ok: false, why: `no live position for ${animalId}` };
    if (player) {
      const distance = distanceBetween(player, target);
      best = { ok: true, state, target, player, distance };
      if (distance >= near && distance <= far) return best;
    }

    // Stand off at `range` on the side the player is already on.
    const from = player ?? { x: 0, z: 31 };
    let dx = from.x - target.x;
    let dz = from.z - target.z;
    let length = Math.hypot(dx, dz);
    if (length < 0.2) {
      // Standing inside the animal: any direction will do, pick one.
      dx = 1; dz = 0; length = 1;
    }
    const goal = {
      x: target.x + (dx / length) * wanted,
      z: target.z + (dz / length) * wanted,
    };
    await h.walkTo(goal.x, goal.z, 1.4);

    const now = await h.ui();
    const nowTarget = animalState(now, animalId);
    const nowPlayer = now.debug?.player;
    if (nowPlayer && nowTarget) {
      const distance = distanceBetween(nowPlayer, nowTarget);
      best = { ok: true, state: now, target: nowTarget, player: nowPlayer, distance };
      if (distance >= near && distance <= far) return best;
    }
  }
  // Out of attempts. A position that is at least in sight still beats giving up.
  const state = await h.ui();
  const target = animalState(state, animalId);
  const player = state.debug?.player;
  const distance = player && target ? distanceBetween(player, target) : Infinity;
  if (player && target && distance <= far * 1.6) {
    return { ok: true, state, target, player, distance, loose: true };
  }
  return { ok: false, why: 'could not settle at a photographing distance', state, target, player, distance };
}

// Find a roaming animal, close on it, open the viewfinder and shoot.
async function photograph(h, animal, tag = '', scale = 1) {
  const startedAt = Date.now();
  const s = await h.ui();
  if (!animalState(s, animal)) {
    return { reached: false, facingOk: false, shutterReady: false, why: `no live position for ${animal}` };
  }
  const closed = await approachAnimal(h, animal, { scale });
  const at = closed.player ?? (await h.ui()).debug?.player;
  if (!closed.ok) return {
    reached: false, facingOk: false, shutterReady: false,
    why: closed.why, animal, at, target: closed.target,
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
  const faced = await faceAnimal(h, animal);
  if (!faced.ok) {
    await clickIfPresent(h.page, SEL.close);
    await h.waitFor((u) => !u.viewfinder, 4000);
    return {
      reached: true, facingOk: false, shutterReady: false,
      why: faced.why, animal, at: faced.state?.debug?.player, dot: faced.dot,
      wallSeconds: (Date.now() - startedAt) / 1000,
    };
  }
  const readyNow = (u) => u.debug?.phase === 'viewfinder' && u.shutterEnabled && u.debug?.shutterReady;
  // Keep tracking the animal instead of aiming once and hoping. Close to a
  // small animal the bearing swings fast — a cat two metres away crossing at
  // 1.6 units a second sweeps most of the frame in a couple of seconds — so a
  // single aim followed by a long wait watches it walk out of shot. A player
  // follows it, and waits for one of its frequent idle pauses.
  let ready = await h.waitFor(readyNow, 1200);
  for (let retry = 0; !ready && retry < 4; retry += 1) {
    const reaim = await faceAnimal(h, animal);
    if (!reaim.ok && retry === 3) break;
    ready = await h.waitFor(readyNow, 1600);
  }
  if (!ready) {
    await h.page.screenshot({ path: `${OUT}-fail-${animal}${tag}-aim.png` });
    console.log(`  could not frame ${animal}: player=${JSON.stringify((await h.ui()).debug?.player)} animal=${JSON.stringify(animalState(await h.ui(), animal))}`);
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

// Animals roam past each other, so a neighbour can frame better than the one
// the child means. Close in and re-aim until the photo really is of the animal
// asked for, the way a child would step closer and try again.
async function photographVerified(h, animal, tag = '') {
  // Each attempt really does step closer. A small animal — the chicken above
  // all — does not fill enough of the frame from a comfortable distance, and a
  // child solves that by walking right up to it. Retrying from the same spot,
  // which is what this used to do, could never solve anything.
  // Each attempt stands closer, as a fraction of that animal's own good photo
  // distance rather than a fixed number of units.
  const SCALES = [1, 0.7, 0.5];
  let last = null;
  for (let attempt = 0; attempt < SCALES.length; attempt += 1) {
    last = await photograph(h, animal, `${tag}-r${attempt}`, SCALES[attempt]);
    if (last?.carried === animal) return last;
    const why = last?.carried ? `photographed ${last.carried}` : (last?.why ?? 'no photo');
    if (attempt + 1 < SCALES.length) {
      console.log(`  wanted ${animal} but ${why}; closing to ${SCALES[attempt + 1]}x its photo distance`);
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
  check('debug snapshot exposes every animal and no wanted animals',
    s.debug?.animals?.length === ANIMALS.length && !JSON.stringify(s.debug).match(/want|favou?rite/i),
    JSON.stringify(s.debug?.animals?.map((x) => x.id)));
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
    check(`request ${i + 1} animal is found before photographing`, true,
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

  s = await h.waitFor((u) => u.talk || u.fallback.length >= 3, 15000, 'turnaround');
  s = s ? await openFallback(h, 3) : s;
  const values = s?.fallback.map((f) => f.value) ?? [];
  check('turnaround offers every animal sentence', values.length === ANIMALS.length && values.includes('wolf'),
    s?.fallback.map((f) => f.text).join(' | '), Boolean(s));
  await page.screenshot({ path: `${OUT}-05-turnaround.png` });
  // Never throw here: a missing turnaround used to abort the whole run and take
  // session B's evidence with it. Record it and carry on.
  const turnaroundClicked = await clickIfPresent(
    page, '.lesson-hud__fallback[data-value="wolf"]', { timeoutMs: 8000 },
  );
  check('turnaround answer can be selected', turnaroundClicked, '', Boolean(s));
  if (!turnaroundClicked) await page.screenshot({ path: `${OUT}-fail-turnaround.png` }).catch(() => {});
  s = await h.waitFor((u) => !u.debug && u.greeting !== null, 15000, 'hub');
  const hubReached = Boolean(s);
  check('finishes back to the hub', Boolean(s), '', Boolean(s));
  await h.sleep(1200);
  s = await h.ui();
  check('hub greets with the animal the child chose', s.greeting?.includes('wolf'), s.greeting, Boolean(s?.greeting));
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '{}'), SAVE_KEY);
  check('stamp and answer persisted', saved?.stamps?.zoo === true && saved?.answers?.animal === 'wolf',
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
    check(`request ${i + 1} wrong-photo animal is found before photographing`, true,
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
    check(`request ${i + 1} correct-photo animal is found before photographing`, true,
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
  const reachedTurnaround = await h.waitFor((u) => u.talk || u.fallback.length >= 3, 15000, 'turnaround');
  const s = reachedTurnaround ? await openFallback(h, 3) : null;
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
await runSection('animals', sectionEnabled('animals'), async () => {
  const errorStart = errors.length;
  const networkErrorStart = networkErrors.length;
  const h = await openPage('animals');
  const entered = await enterZoo(h, 'animals');
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

  const aids = inspectNavigationAids(state?.debug);
  console.log(`  navigationAids ${JSON.stringify(aids)}`);
  check('no signage, boards or animal-location markers remain',
    aids.noSignageDebug && aids.noWaypointMarkers,
    JSON.stringify(aids), Boolean(entered), state?.debug);
  check('no enclosure viewpoints or habitat records remain',
    aids.noViewpoints && aids.noHabitatRecords,
    JSON.stringify(aids), Boolean(entered), state?.debug);
  check('the park exposes live roaming animals and broad areas',
    aids.hasLiveAnimals && aids.hasAreas,
    JSON.stringify({ animals: state?.debug?.animals?.length, areas: state?.debug?.areas?.length }),
    Boolean(entered), state?.debug);

  const graph = state?.debug?.pathGraph;
  const plaza = graph?.nodes?.find((node) => node.kind === 'plaza') ?? null;
  const hub = graph?.nodes?.find((node) => node.kind === 'hub') ?? null;
  const graphReady = Boolean(
    plaza
    && hub
    && graph.nodes.length > 0
    && graph.edges.length > 0
    && state?.debug?.animals?.length === ANIMALS.length,
  );
  check('campus debug exposes a routable graph and all eight animals', graphReady,
    JSON.stringify({
      plaza: plaza?.id,
      hub: hub?.id,
      nodes: graph?.nodes?.length ?? 0,
      edges: graph?.edges?.length ?? 0,
      animals: state?.debug?.animals?.length ?? 0,
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
    const live = animalState(state, animal);
    const territory = state?.debug?.territories?.find((t) => t.id === animal) ?? null;
    const inTerritory = Boolean(live && territory
      && live.x >= territory.bounds.minX - 1 && live.x <= territory.bounds.maxX + 1
      && live.z >= territory.bounds.minZ - 1 && live.z <= territory.bounds.maxZ + 1);
    check(`${animal} roams inside its own territory`, inTerritory,
      JSON.stringify({ live, territory }), graphReady, state?.debug);
    if (!graphReady || !live) {
      allHabitatPreconditionsMet = false;
      const result = {
        animal, reached: false, facingOk: false, shutterReady: false,
        photographedAsRightAnimal: false, wallSeconds: null,
      };
      habitatResults.push(result);
      console.log(`  animal result ${JSON.stringify(result)}`);
      continue;
    }

    // Start every search from the plaza, the way a child does after being asked,
    // and time how long it takes to get eyes on a moving animal.
    await h.walkTo(plaza.x, plaza.z, 0.8);
    const startedAt = Date.now();
    const found = await approachAnimal(h, animal, { attempts: 6 });
    const measured = (Date.now() - startedAt) / 1000;
    travelTimes.push({ animal, wallSeconds: measured, area: live.area });
    console.log(`  ${animal}: searched ${measured.toFixed(1)}s in ${live.area}`);
    check(`${animal} is found by searching its area`, found.ok,
      JSON.stringify({ wallSeconds: measured, why: found.why, at: found.player, target: found.target }),
      Boolean(live), (await h.ui()).debug);
    // A search should be a search, not an expedition. The harness walks
    // straight at the animal, so this is a generous ceiling on a child's hunt.
    check(`${animal} is found within a reasonable search`, found.ok && measured <= 45,
      JSON.stringify({ wallSeconds: measured }), found.ok, (await h.ui()).debug);

    if (!found.ok) {
      allHabitatPreconditionsMet = false;
      const result = {
        animal, reached: false, facingOk: false, shutterReady: false,
        photographedAsRightAnimal: false, wallSeconds: measured,
      };
      habitatResults.push(result);
      console.log(`  animal result ${JSON.stringify(result)}`);
      continue;
    }

    const shot = await photographVerified(h, animal, '-all');
    const rightAnimal = shot?.shutterReady && shot?.carried === animal;
    check(`${animal} faces the animal before photographing`, shot?.facingOk,
      JSON.stringify({ shot }), Boolean(shot?.reached), (await h.ui()).debug);
    check(`${animal} reaches shutter-ready on a moving animal`, shot?.shutterReady,
      JSON.stringify({ shot }), Boolean(shot?.facingOk), (await h.ui()).debug);
    check(`${animal} frames and photographs as the right animal`, rightAnimal,
      JSON.stringify({ shot }), Boolean(shot?.shutterReady), (await h.ui()).debug);
    const result = {
      animal,
      area: live.area,
      reached: Boolean(shot?.reached),
      facingOk: Boolean(shot?.facingOk),
      shutterReady: Boolean(shot?.shutterReady),
      photographedAsRightAnimal: Boolean(rightAnimal),
      wallSeconds: measured,
    };
    habitatResults.push(result);
    if (!shot?.reached || !shot?.facingOk || !shot?.shutterReady) allHabitatPreconditionsMet = false;
    console.log(`  animal result ${JSON.stringify(result)}`);
    if (rightAnimal) visited.add(animal);
    await h.waitFor((value) => value.debug?.phase === 'playing', 5000, `${animal} camera to close`);
    if (!regionScreenshots.has(live.area)) {
      await h.page.screenshot({ path: `${OUT}-region-${live.area}.png` });
      regionScreenshots.add(live.area);
    }
  }
  check('all eight animals are photographed in one session',
    visited.size === ANIMALS.length && ANIMALS.every((animal) => visited.has(animal)),
    JSON.stringify({ visited: [...visited], travelTimes, habitatResults }), allHabitatPreconditionsMet, (await h.ui()).debug);
  const expectedRegionScreenshots = [...new Set(state?.debug?.areas?.map((item) => item.id) ?? [])].sort();
  check('visual-review screenshots are saved for every area',
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
