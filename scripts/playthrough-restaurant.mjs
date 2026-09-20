// Permanent Restaurant progression playthrough.
//
//   npm run build && npm run playthrough:restaurant
//
// This replaces the pre-open-seating harness (still available as
// `playthrough:restaurant-legacy`, and known-failing) with one that follows the
// shape the Restaurant actually has now: a solo warm-up, a rival challenge,
// then Round 1 -> rematch-or-finish / Round 2 -> Round 3, the physical result
// transition between them, and the final turnaround question.
//
// Outcomes are forced through `window.__eslDebug.restaurantControl` so every
// branch is reachable in seconds and deterministically. That control exists
// only for tests; the game never reads it. Belt malfunction timing is sampled
// from the game's own debug clock rather than wall-clock, so a slow machine
// cannot turn a timing check red.
//
// Known-bad self-check: `RESTAURANT_KNOWN_BAD=1` asserts that a deliberately
// wrong expectation fails, so a green run means the checks can actually fail.
import { chromium } from 'playwright';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const URL = process.argv[2] || 'http://localhost:5199/';
const ARTIFACT_DIR = process.argv[3] || '.tmp/playthrough/restaurant';
const SAVE_KEY = 'esl-likes-save-v1';
const LEVEL = Number(process.env.RESTAURANT_LEVEL || 2);
const KNOWN_BAD = process.env.RESTAURANT_KNOWN_BAD === '1';
const ONLY = process.env.RESTAURANT_ONLY || process.argv.slice(2).find(
  (argument) => argument.startsWith('--only='),
)?.slice('--only='.length) || null;

const results = [];
let scope = 'startup';
let failures = 0;

function check(name, passed, detail = '') {
  results.push({ scope, name, passed: Boolean(passed), detail: String(detail).slice(0, 400) });
  if (!passed) failures += 1;
  const mark = passed ? 'ok  ' : 'FAIL';
  console.log(`${mark} [${scope}] ${name}${passed || !detail ? '' : ` -- ${detail}`}`);
}

/**
 * Records an observation that is real but shift-dependent, so a run in which it
 * did not happen is not a regression. Never counts as a failure; always
 * reported, so a behaviour that silently stops happening is still visible.
 */
function info(name, observed, detail = '') {
  results.push({
    scope, name, kind: 'info', observed: Boolean(observed), detail: String(detail).slice(0, 400),
  });
  console.log(`${observed ? 'seen' : '----'} [${scope}] ${name}${detail ? ` -- ${detail}` : ''}`);
}

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

async function openGame() {
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  await context.addInitScript(({ key, level }) => {
    localStorage.setItem(key, JSON.stringify({
      version: 1, settings: { micFree: true, difficulty: level },
    }));
  }, { key: SAVE_KEY, level: LEVEL });

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });

  const sleep = (ms) => page.waitForTimeout(ms);
  const debug = () => page.evaluate(() => {
    const raw = window.__eslDebug?.restaurant;
    return raw == null ? null : JSON.parse(JSON.stringify(raw));
  });
  const control = (name, ...params) => page.evaluate(
    ({ method, args }) => window.__eslDebug?.restaurantControl?.[method]?.(...args) ?? null,
    { method: name, args: params },
  );

  async function waitFor(predicate, timeoutMs, label) {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < deadline) {
      last = await debug();
      if (last && predicate(last)) return last;
      await sleep(50);
    }
    check(`precondition: ${label}`, false, `timed out after ${timeoutMs}ms`);
    return null;
  }

  async function hold(keys, ms) {
    for (const key of keys) await page.keyboard.down(key);
    await sleep(ms);
    for (const key of keys) await page.keyboard.up(key);
  }

  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await sleep(3500);
  // Restaurant is the left-hand hub door.
  await page.click('#game-canvas', { position: { x: 683, y: 600 } });
  await hold(['KeyW', 'KeyA'], 2600);
  for (let pulse = 0; pulse < 30; pulse += 1) {
    if (await page.evaluate(() => Boolean(window.__eslDebug?.restaurant))) break;
    await page.keyboard.press('Space');
    await sleep(200);
    if (await page.evaluate(() => Boolean(window.__eslDebug?.restaurant))) break;
    await hold(['KeyW', 'KeyA'], 200);
  }
  return { page, context, errors, sleep, debug, control, waitFor };
}

/** Brings the rival on and answers its challenge, leaving Round 1 in service. */
async function reachRoundOne(h) {
  await h.waitFor((s) => s.lifecycle === 'service', 20000, 'service starts');
  await h.control('triggerRival');
  await h.waitFor((s) => s.rivalChallenge?.choicesVisible, 30000, 'Round 1 challenge choices');
  await h.page.keyboard.press('Enter');
  return h.waitFor(
    (s) => s.lifecycle === 'service' && s.progression?.round === 1 && s.rival,
    20000, 'Round 1 rival live',
  );
}

/**
 * Ends the round in progress with a forced outcome and samples the result
 * staging as it happens, so a teleport is visible as an absent walk.
 */
async function endRoundWatchingStaging(h, outcome, untilRound) {
  await h.control('forceOutcome', outcome);
  await h.control('endRound');
  // One continuous window covers the whole transition: the staging walk, the
  // outgoing waiter and the player walking back. Sampling these in separate
  // loops lets a fast transition slip between them.
  const frames = [];
  const transition = {
    sawExit: false, sawReturnWalk: false, playerTrack: [], phases: new Set(),
  };
  for (let sample = 0; sample < 260; sample += 1) {
    const s = await h.debug();
    if (s?.resultStage?.active) {
      frames.push({
        phase: s.resultStage.phase,
        player: s.resultStage.playerPosition,
        rival: s.resultStage.rivalPosition,
        labelVisible: s.resultStage.labelVisible,
      });
    }
    if (s?.progression?.exitWalking) transition.sawExit = true;
    if (s?.progression?.returnWalking) transition.sawReturnWalk = true;
    // Progression phases are transient; a check that looks afterwards misses them.
    if (s?.progression?.phase) transition.phases.add(s.progression.phase);
    if (s?.player) transition.playerTrack.push({ x: s.player.x, z: s.player.z });
    if (untilRound && s?.progression?.round === untilRound) break;
    if (s?.lifecycle === 'turnaround' || s?.progression?.awaitingChoice) break;
    await h.sleep(40);
  }
  frames.transition = transition;
  return frames;
}

const MARKS = { player: { x: -1.35, z: -3.75 }, rival: { x: 1.35, z: -3.75 } };
const distance = (a, b) => (a && b ? Math.hypot(a.x - b.x, a.z - b.z) : Infinity);

function checkStaging(frames, label) {
  const staging = frames.filter((frame) => frame.phase === 'staging');
  check(`${label}: the waiters walk to the result marks`, staging.length >= 2,
    `staging frames ${staging.length}`);
  if (staging.length < 2) return;
  const first = staging[0];
  const last = staging[staging.length - 1];
  // No teleport: at least one waiter must start away from its mark and close in.
  const playerStart = distance(first.player, MARKS.player);
  const rivalStart = distance(first.rival, MARKS.rival);
  check(`${label}: neither waiter starts already snapped to its mark`,
    playerStart > 0.2 || rivalStart > 0.2,
    `player ${playerStart.toFixed(2)} rival ${rivalStart.toFixed(2)} from marks`);
  check(`${label}: both waiters reach their marks`,
    distance(last.player, MARKS.player) < 1.5 && distance(last.rival, MARKS.rival) < 1.5,
    `player ${distance(last.player, MARKS.player).toFixed(2)} rival ${distance(last.rival, MARKS.rival).toFixed(2)}`);
  check(`${label}: the result label waits for the walk`,
    staging.every((frame) => !frame.labelVisible),
    'the label showed while the waiters were still walking');
}

// =========================================================================
// A: Round 1 loss -> rematch
// =========================================================================
if (!ONLY || ONLY === 'rematch') {
  scope = 'rematch';
  const h = await openGame();
  const round1 = await reachRoundOne(h);
  check('Round 1 starts with one rival order and no belt malfunction',
    round1?.rival?.maxActiveOrders === 1 && round1?.beltMalfunction?.enabled === false,
    JSON.stringify({ orders: round1?.rival?.maxActiveOrders, belt: round1?.beltMalfunction?.enabled }));

  const frames = await endRoundWatchingStaging(h, 'rival', null);
  checkStaging(frames, 'Round 1 loss');

  const choice = await h.waitFor((s) => s.progression?.awaitingChoice, 25000, 'rematch choice');
  check('a Round 1 loss offers the rematch choice',
    Boolean(choice?.progression?.awaitingChoice) && choice?.progression?.choicesVisible,
    JSON.stringify(choice?.progression?.phase));

  // First button: rematch. Clicked for the same reason as the finish path.
  await h.sleep(600); // past the choice guard
  await h.page.locator('.restaurant-ui__challenge-replies button').nth(0).click();
  let sawReturnWalk = false;
  const rematchTrack = [];
  for (let sample = 0; sample < 90; sample += 1) {
    const s = await h.debug();
    if (s?.progression?.returnWalking) sawReturnWalk = true;
    if (s?.player) rematchTrack.push({ x: s.player.x, z: s.player.z });
    if (s?.lifecycle === 'service') break;
    await h.sleep(40);
  }
  check('choosing a rematch walks the waiters back rather than snapping them',
    sawReturnWalk, `returnWalking seen: ${sawReturnWalk}`);
  const rematchJumps = rematchTrack.filter((point, index) => index > 0
    && Math.hypot(point.x - rematchTrack[index - 1].x, point.z - rematchTrack[index - 1].z) > 3.0);
  check('the rematch never teleports the player across the room',
    rematchJumps.length === 0, `${rematchJumps.length} jumps over 3 units`);

  const rematch = await h.waitFor(
    (s) => s.lifecycle === 'service' && s.progression?.attempt === 2 && s.rival,
    25000, 'rematch service',
  );
  check('the rematch is a second attempt against Waiter 1',
    rematch?.progression?.attempt === 2 && rematch?.progression?.rivalId === 'waiter1',
    JSON.stringify({ attempt: rematch?.progression?.attempt, rival: rematch?.progression?.rivalId }));
  check('the rematch score restarts at 0-0',
    rematch?.competition?.score?.player === 0 && rematch?.competition?.score?.rival === 0,
    JSON.stringify(rematch?.competition));
  check('the rematch keeps the belt dishes',
    (rematch?.conveyor?.dishes?.length ?? 0) > 0,
    `dishes ${rematch?.conveyor?.dishes?.length}`);
  check('the rematch clears customers, claims and carried dishes',
    !rematch?.carried && (rematch?.customers ?? []).every((customer) => customer.owner !== 'rival'),
    JSON.stringify({ carried: Boolean(rematch?.carried) }));
  check('no solo phase repeats before the rematch',
    rematch?.rush?.triggered === true || rematch?.directorPhase !== 'warmup',
    `directorPhase ${rematch?.directorPhase}`);
  check(`${scope}: no runtime errors`, h.errors.length === 0, h.errors.slice(0, 3).join(' | '));
  await h.context.close();
}

// =========================================================================
// B: Round 1 loss -> finish goes to the final question
// =========================================================================
if (!ONLY || ONLY === 'finish') {
  scope = 'finish';
  const h = await openGame();
  await reachRoundOne(h);
  await endRoundWatchingStaging(h, 'draw', null);
  const choice = await h.waitFor((s) => s.progression?.awaitingChoice, 25000, 'rematch choice');
  check('a Round 1 draw also offers the choice, not Round 2',
    Boolean(choice?.progression?.awaitingChoice) && choice?.progression?.round === 1,
    JSON.stringify(choice?.progression?.phase));
  // Second button: finish. Clicked rather than navigated, because with nothing
  // focused the first arrow press only moves focus onto the first reply.
  await h.sleep(600); // past the choice guard
  await h.page.locator('.restaurant-ui__challenge-replies button').nth(1).click();
  const question = await h.waitFor((s) => s.lifecycle === 'turnaround', 25000, 'final question');
  check('choosing to finish goes to the final turnaround question',
    Boolean(question), `lifecycle ${question?.lifecycle}`);
  check(`${scope}: no runtime errors`, h.errors.length === 0, h.errors.slice(0, 3).join(' | '));
  await h.context.close();
}

// =========================================================================
// C: Round 1 win -> Round 2 (physically continuous) -> Round 3
// =========================================================================
if (!ONLY || ONLY === 'progression') {
  scope = 'progression';
  const h = await openGame();
  await reachRoundOne(h);

  const frames = await endRoundWatchingStaging(h, 'player', 2);
  checkStaging(frames, 'Round 1 win');

  // Waiter 1 leaves and the player walks back at the same time: no teleport.
  const { sawExit, sawReturnWalk, playerTrack, phases } = frames.transition;
  check('winning Round 1 advances through the Round 2 intro',
    phases.has('round2-intro'), `phases seen: ${[...phases].join(', ')}`);
  check('Waiter 1 physically exits after the result', sawExit, `exitWalking seen: ${sawExit}`);
  check('the player walks back instead of being reset', sawReturnWalk,
    `returnWalking seen: ${sawReturnWalk}`);
  const jumps = playerTrack.filter((point, index) => index > 0
    && Math.hypot(point.x - playerTrack[index - 1].x, point.z - playerTrack[index - 1].z) > 3.0);
  check('the player never jumps across the room between frames', jumps.length === 0,
    `${jumps.length} jumps over 3 units`);

  await h.waitFor((s) => s.rivalChallenge?.choicesVisible, 40000, 'Round 2 challenge choices');
  await h.page.keyboard.press('Enter');
  const round2 = await h.waitFor(
    (s) => s.progression?.round === 2 && s.lifecycle === 'service' && s.rival,
    40000, 'Round 2 rival live',
  );
  check('Round 2 runs against Waiter 2 on the Round 2 belt',
    round2?.progression?.rivalId === 'waiter2' && round2?.conveyor?.mode === 'roundTwo',
    JSON.stringify({ rival: round2?.progression?.rivalId, belt: round2?.conveyor?.mode }));
  check('Round 2 keeps the one-order rival', round2?.rival?.maxActiveOrders === 1,
    `maxActiveOrders ${round2?.rival?.maxActiveOrders}`);
  check('Round 2 has no belt malfunction', round2?.beltMalfunction?.enabled === false,
    JSON.stringify(round2?.beltMalfunction));

  // Round 2 win -> Round 3.
  const r3frames = await endRoundWatchingStaging(h, 'player', 3);
  checkStaging(r3frames, 'Round 2 win');
  const round3 = await h.waitFor(
    (s) => s.progression?.round === 3 && s.lifecycle === 'service' && s.rival,
    45000, 'Round 3 service',
  );
  check('winning Round 2 unlocks Round 3', Boolean(round3), `round ${round3?.progression?.round}`);
  check('Round 3 keeps Waiter 2 rather than adding a character',
    round3?.progression?.rivalId === 'waiter2'
      && (round3?.progression?.rivalCharactersBuilt ?? []).length === 2,
    JSON.stringify(round3?.progression?.rivalCharactersBuilt));
  check('Round 3 gives the rival two active orders',
    round3?.rival?.maxActiveOrders === 2, `maxActiveOrders ${round3?.rival?.maxActiveOrders}`);
  check('Round 3 runs the Round 3 belt with malfunction enabled',
    round3?.conveyor?.mode === 'roundThree' && round3?.beltMalfunction?.enabled === true,
    JSON.stringify({ belt: round3?.conveyor?.mode, malfunction: round3?.beltMalfunction?.enabled }));
  check('Round 3 restarts the score at 0-0',
    round3?.competition?.score?.player === 0 && round3?.competition?.score?.rival === 0,
    JSON.stringify(round3?.competition));
  check('no Waiter 2 order survives into Round 3',
    (round3?.rival?.activeOrderCount ?? 0) === 0 && !round3?.rival?.carriedDish,
    JSON.stringify(round3?.rival?.activeOrders));

  // --- Round 3 in motion: belt cycle and rival multitasking ---------------
  let maxOrders = 0;
  let warningBeforeStop = null;
  let sawWarning = false;
  let beltMovedWhileStopped = false;
  let lastTravel = null;
  let lastPhase = null;
  const stopDurations = [];
  const runDurations = [];
  let phaseStartedAt = null;
  const sequences = [];

  let overTwo = false;
  // Phase 1 observes the belt's own rhythm, so run and stop durations are the
  // ones the game actually produces. Forcing stoppages here would measure the
  // harness, not the game; that comes afterwards.
  for (let sample = 0; sample < 260; sample += 1) {
    const s = await h.debug();
    if (!s || s.lifecycle !== 'service') break;
    const orders = s.rival?.activeOrderCount ?? 0;
    maxOrders = Math.max(maxOrders, orders);
    if (orders > 2) overTwo = true;
    const belt = s.beltMalfunction;
    if (belt?.warningActive) sawWarning = true;
    if (belt?.phase !== lastPhase) {
      // Phase durations come from the game's own clock, not wall-clock.
      if (lastPhase && phaseStartedAt !== null) {
        const span = s.elapsed - phaseStartedAt;
        if (lastPhase === 'stopped') stopDurations.push(span);
        if (lastPhase === 'running') runDurations.push(span);
      }
      if (lastPhase) sequences.push(`${lastPhase}->${belt?.phase}`);
      if (belt?.phase === 'stopped') warningBeforeStop = lastPhase === 'warning';
      lastPhase = belt?.phase;
      phaseStartedAt = s.elapsed;
    }
    if (belt?.stopped) {
      const travel = s.conveyor?.beltTravel;
      if (lastTravel !== null && travel !== lastTravel) beltMovedWhileStopped = true;
      lastTravel = travel;
    } else lastTravel = null;
    await h.sleep(100);
  }

  // Phase 2 induces stoppages: belt downtime is exactly when the rival is meant
  // to go and take another order, so this is the designed trigger rather than
  // waiting on chance. Belt timing is no longer measured here.
  for (let sample = 0; sample < 300 && maxOrders < 2; sample += 1) {
    const s = await h.debug();
    if (!s || s.lifecycle !== 'service') break;
    const orders = s.rival?.activeOrderCount ?? 0;
    maxOrders = Math.max(maxOrders, orders);
    if (orders > 2) overTwo = true;
    if (sample % 25 === 0) await h.control('beltStop');
    await h.sleep(100);
  }

  // Hard invariants: the cap, and that the rival is actually taking orders.
  check('the Round 3 rival never exceeds two active orders', !overTwo,
    `highest active order count ${maxOrders}`);
  check('the Round 3 rival is taking orders at all', maxOrders >= 1,
    `highest active order count ${maxOrders}`);
  // Emergent, so reported rather than asserted: the rival only claims a second
  // customer when no dish matches an order it already holds. A stopped belt
  // leaves its dishes standing still, which makes them EASIER to collect, so a
  // stoppage often sends it to the belt rather than to another table. Whether
  // two orders overlap in a given shift depends on what the belt offers.
  // The guarantee itself is unit-tested in rival.test.mjs.
  info('two overlapping rival orders observed in play', maxOrders === 2,
    `highest active order count ${maxOrders}`);
  check('a warning always precedes a stop', warningBeforeStop !== false,
    `transitions ${sequences.slice(0, 8).join(', ')}`);
  check('the warning is shown to the player', sawWarning, 'no warning phase observed');
  check('the belt does not move while stopped', !beltMovedWhileStopped,
    'belt travel changed during a stoppage');
  check('stop durations stay inside the configured range',
    stopDurations.length === 0 || stopDurations.every((span) => span >= 1.7 && span <= 3.2),
    `stops ${stopDurations.map((span) => span.toFixed(2)).join(', ')}`);
  check('a minimum run separates stoppages',
    runDurations.length === 0 || runDurations.every((span) => span >= 7.5),
    `runs ${runDurations.map((span) => span.toFixed(2)).join(', ')}`);

  const stopped = await h.debug();
  check('dish ids stay unique across stoppages',
    new Set((stopped?.conveyor?.dishes ?? []).map((dish) => dish.id)).size
      === (stopped?.conveyor?.dishes ?? []).length,
    `dishes ${stopped?.conveyor?.dishes?.length}`);

  // Round 3 always ends in the final question, whatever the outcome.
  await endRoundWatchingStaging(h, 'rival', null);
  const final = await h.waitFor((s) => s.lifecycle === 'turnaround', 30000, 'final question');
  check('Round 3 ends in the final turnaround question, never a Round 4',
    Boolean(final) && final?.progression?.round === 3,
    JSON.stringify({ lifecycle: final?.lifecycle, round: final?.progression?.round }));
  if (KNOWN_BAD) {
    // Deliberately wrong, and read from real game state rather than hardcoded:
    // if this passes, the checks are not actually looking at the game.
    check('known-bad: Round 3 is asserted to be a Round 4',
      final?.progression?.round === 4,
      `real round ${final?.progression?.round}`);
  }
  check(`${scope}: no runtime errors`, h.errors.length === 0, h.errors.slice(0, 3).join(' | '));
  await h.page.screenshot({ path: path.join(ARTIFACT_DIR, 'round3-final.png') }).catch(() => {});
  await h.context.close();
}

// =========================================================================
// D: Round 2 loss and draw both finish without Round 3
// =========================================================================
for (const outcome of (!ONLY || ONLY === 'round2-end') ? ['rival', 'draw'] : []) {
  scope = `round2-${outcome}`;
  const h = await openGame();
  await reachRoundOne(h);
  await endRoundWatchingStaging(h, 'player', 2);
  await h.waitFor((s) => s.rivalChallenge?.choicesVisible, 45000, 'Round 2 challenge choices');
  await h.page.keyboard.press('Enter');
  await h.waitFor((s) => s.progression?.round === 2 && s.lifecycle === 'service' && s.rival,
    40000, 'Round 2 rival live');

  await endRoundWatchingStaging(h, outcome, null);
  const final = await h.waitFor((s) => s.lifecycle === 'turnaround', 30000, 'final question');
  check(`a Round 2 ${outcome} goes to the final question`, Boolean(final),
    `lifecycle ${final?.lifecycle}`);
  check(`a Round 2 ${outcome} never unlocks Round 3`,
    final?.progression?.round === 2 && final?.beltMalfunction?.enabled === false,
    JSON.stringify({ round: final?.progression?.round }));
  check(`${scope}: no runtime errors`, h.errors.length === 0, h.errors.slice(0, 3).join(' | '));
  await h.context.close();
}

// =========================================================================
// Known-bad self-check: the checks must be able to fail.
// =========================================================================
await browser.close();

await mkdir(ARTIFACT_DIR, { recursive: true }).catch(() => {});
await writeFile(
  path.join(ARTIFACT_DIR, 'manifest.json'),
  JSON.stringify({
    level: LEVEL,
    only: ONLY,
    knownBad: KNOWN_BAD,
    total: results.filter((entry) => entry.kind !== 'info').length,
    passed: results.filter((entry) => entry.kind !== 'info').length - failures,
    failed: failures,
    observations: results.filter((entry) => entry.kind === 'info'),
    checks: results,
  }, null, 2),
).catch(() => {});

const passed = results.length - failures;
console.log(`\nRestaurant progression playthrough: ${passed}/${results.length} checks passed.`);
if (KNOWN_BAD) {
  // In known-bad mode exactly the seeded failure should fail.
  const seeded = failures === 1;
  console.log(seeded
    ? 'Known-bad run behaved correctly: the seeded failure was the only failure.'
    : `Known-bad run is inconclusive: ${failures} failures.`);
  process.exit(seeded ? 0 : 1);
}
process.exit(failures === 0 ? 0 : 1);
