import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { LESSON_BY_ID, UI } from '../config/lesson.js';
import { createBackControl } from '../ui/backControl.js';
import { createSequenceComplete } from '../ui/sequenceComplete.js';
import { createStageUnlock } from '../ui/stageUnlock.js';
import { createStampBook } from '../ui/stampBook.js';
import {
  COMPLETE_STAGE,
  GAME_SEQUENCE,
  HUB_STAGE,
  UNLOCK_STAGE,
  activeLessons,
  createShellNavigator,
  nextGameAfter,
  previousGameBefore,
  shellModeFromSearch,
  stageProgressState,
} from './gameSequence.js';

const mainSource = readFileSync(new URL('../main.js', import.meta.url), 'utf8');

class FakeEventTarget {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  removeEventListener(type, listener) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((entry) => entry !== listener));
  }
  dispatch(type, init = {}) {
    const event = {
      key: '',
      target: null,
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
      ...init,
    };
    for (const listener of this.listeners.get(type) ?? []) listener(event);
    return event;
  }
}

class FakeElement extends FakeEventTarget {
  constructor(tagName) {
    super();
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.attributes = {};
    this.hidden = false;
    this.className = '';
    this.textContent = '';
    this.removed = false;
    const element = this;
    this.classList = {
      add(name) { element.className = `${element.className} ${name}`.trim(); },
      remove(name) { element.className = element.className.split(' ').filter((c) => c !== name).join(' '); },
      contains(name) { return element.className.split(' ').includes(name); },
      toggle() {},
    };
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this.attributes[name] = value; }
  remove() { this.removed = true; }
  focus() {}
  click() { this.dispatch('click', { target: this }); }
  findAll(className, into = []) {
    if (this.className.split(' ').includes(className)) into.push(this);
    for (const child of this.children) child.findAll?.(className, into);
    return into;
  }
}

async function withFakeDom(run) {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const fakeWindow = new FakeEventTarget();
  globalThis.window = fakeWindow;
  globalThis.document = {
    createElement: (tag) => new FakeElement(tag),
    documentElement: { classList: { toggle() {}, remove() {} } },
  };
  try {
    return await run({ window: fakeWindow, root: new FakeElement('div') });
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
}

/** A shell with a fake stage builder that records every screen it builds. */
function makeShell({ mode = 'sequence', playable = (id) => Boolean(LESSON_BY_ID[id]?.available) } = {}) {
  const shown = [];
  const recorded = [];
  const shell = createShellNavigator({
    mode,
    isPlayable: playable,
    show: async (stage, options) => {
      shown.push({ stage, ...options });
      return true;
    },
    record: (gameId, result) => recorded.push({ gameId, result }),
  });
  return { shell, shown, recorded, last: () => shown.at(-1) };
}

test('the run is Coloring, Restaurant, Zoo, Sports, Drink Stand and nothing else', () => {
  assert.deepEqual([...GAME_SEQUENCE], ['coloring', 'restaurant', 'zoo', 'sports', 'drink-stand']);
  assert.ok(Object.isFrozen(GAME_SEQUENCE));
  assert.equal(nextGameAfter('coloring'), 'restaurant');
  assert.equal(nextGameAfter('restaurant'), 'zoo');
  assert.equal(nextGameAfter('zoo'), 'sports');
  assert.equal(nextGameAfter('sports'), 'drink-stand');
  assert.equal(nextGameAfter('drink-stand'), null);
  assert.equal(nextGameAfter(HUB_STAGE), null);
  assert.equal(previousGameBefore('coloring'), null);
  assert.equal(previousGameBefore('restaurant'), 'coloring');
  assert.equal(previousGameBefore('zoo'), 'restaurant');
  assert.equal(previousGameBefore('sports'), 'zoo');
  assert.equal(previousGameBefore('drink-stand'), 'sports');
});

test('all five games of the run are available and registered in the shell', () => {
  for (const id of GAME_SEQUENCE) assert.equal(LESSON_BY_ID[id].available, true, id);
  assert.equal(GAME_SEQUENCE.length, 5);
  assert.ok(LESSON_BY_ID['drink-stand'].answers.length > 0);
  assert.ok(LESSON_BY_ID.sports.answers.length > 0);
  assert.match(mainSource, /import \{ createDrinkStand \} from '\.\/minigames\/drinkStand\/index\.js';/);
  assert.match(mainSource, /import \{ createSports \} from '\.\/minigames\/sports\/index\.js';/);
  assert.match(mainSource, /\['drink-stand', createDrinkStand\]/);
  assert.match(mainSource, /\['sports', createSports\]/);
});

test('startup goes straight to Coloring with no Back', async () => {
  const { shell, shown } = makeShell();
  await shell.start();
  assert.deepEqual(shown, [{ stage: 'coloring', backAvailable: false, transition: false }]);
  assert.equal(shell.current, 'coloring');
});

test('each finish records progress, shows an unlock without a wipe, then wipes into the next game', async () => {
  const { shell, shown, recorded } = makeShell();
  await shell.start();

  const results = [{ stars: 2 }, { stars: 3 }, { stars: 1, detail: { zooPhoto: 'data:image/png;base64,x' } }, { stars: 2 }];
  for (const [index, result] of results.entries()) {
    const completed = GAME_SEQUENCE[index];
    const next = GAME_SEQUENCE[index + 1];
    await shell.finish(completed, result);
    assert.deepEqual(shown.at(-1), {
      stage: UNLOCK_STAGE, backAvailable: false, transition: false, unlock: { completed, next },
    });
    assert.equal(recorded.at(-1).gameId, completed, 'progress is recorded before the unlock');
    assert.equal(shell.canGoBack(), false);
    await shell.continueFromUnlock();
    assert.deepEqual(shown.at(-1), { stage: next, backAvailable: true, transition: true });
  }

  await shell.finish('drink-stand', { stars: 3 });
  assert.deepEqual(shown.at(-1), { stage: COMPLETE_STAGE, backAvailable: false, transition: true });

  assert.deepEqual(recorded.map((entry) => entry.gameId), ['coloring', 'restaurant', 'zoo', 'sports', 'drink-stand']);
  assert.equal(recorded[2].result.detail.zooPhoto, 'data:image/png;base64,x');
  assert.ok(!shown.some((entry) => entry.stage === HUB_STAGE), 'the sequence never passes through the hub');
});

test('Back goes to the previous stage and does nothing in Coloring', async () => {
  const { shell, shown } = makeShell();
  await shell.start();
  assert.equal(await shell.back(), false);
  assert.equal(shown.length, 1, 'Coloring has nowhere to go back to');

  await shell.finish('coloring');
  await shell.continueFromUnlock();
  await shell.finish('restaurant');
  await shell.continueFromUnlock();
  await shell.finish('zoo');
  await shell.continueFromUnlock();
  await shell.finish('sports');
  await shell.continueFromUnlock();
  assert.equal(shell.current, 'drink-stand');

  await shell.back();
  assert.deepEqual(shown.at(-1), { stage: 'sports', backAvailable: true, transition: true });
  await shell.back();
  assert.deepEqual(shown.at(-1), { stage: 'zoo', backAvailable: true, transition: true });
  await shell.back();
  assert.deepEqual(shown.at(-1), { stage: 'restaurant', backAvailable: true, transition: true });
  await shell.back();
  assert.deepEqual(shown.at(-1), { stage: 'coloring', backAvailable: false, transition: true });
});

test('a stage that was gone back to can be finished again and the run carries on', async () => {
  const { shell, recorded, last } = makeShell();
  await shell.start();
  await shell.finish('coloring');
  await shell.continueFromUnlock();
  await shell.finish('restaurant');
  await shell.continueFromUnlock();
  await shell.back();
  await shell.finish('restaurant', { stars: 1 });
  assert.equal(last().stage, UNLOCK_STAGE);
  await shell.continueFromUnlock();
  assert.equal(last().stage, 'zoo');
  assert.deepEqual(recorded.map((entry) => entry.gameId), ['coloring', 'restaurant', 'restaurant']);
});

test('もういちど restarts at Coloring from the completion screen only', async () => {
  const { shell, last } = makeShell();
  await shell.start();
  assert.equal(await shell.restart(), false, 'no replay mid-run');
  await shell.finish('coloring');
  await shell.continueFromUnlock();
  await shell.finish('restaurant');
  await shell.continueFromUnlock();
  await shell.finish('zoo');
  await shell.continueFromUnlock();
  assert.equal(await shell.restart(), false, 'no replay after the Zoo any more');
  await shell.finish('sports');
  await shell.continueFromUnlock();
  await shell.finish('drink-stand');
  assert.equal(shell.current, COMPLETE_STAGE);
  assert.equal(await shell.back(), false, 'no Back on the completion screen');

  await shell.restart();
  assert.deepEqual(last(), { stage: 'coloring', backAvailable: false, transition: true });
});

test('only the current game can finish, and only once', async () => {
  const { shell, recorded, shown } = makeShell();
  await shell.start();
  assert.equal(await shell.finish('zoo'), false, 'a stale controller cannot finish the run');
  const first = shell.finish('coloring');
  assert.equal(await shell.finish('coloring'), false, 'a second finish while routing is ignored');
  await first;
  assert.equal(recorded.length, 1);
  assert.deepEqual(shown.map((entry) => entry.stage), ['coloring', UNLOCK_STAGE]);
  assert.equal(await shell.finish('coloring'), false, 'a finished controller cannot finish during unlock');
});

test('a refused transition leaves the shell where it was and able to finish again', async () => {
  let refuse = false;
  const shell = createShellNavigator({
    isPlayable: () => true,
    show: async () => !refuse,
  });
  await shell.start();
  refuse = true;
  assert.equal(await shell.finish('coloring'), false);
  assert.equal(shell.current, 'coloring');
  refuse = false;
  assert.equal(await shell.finish('coloring'), true);
  assert.equal(shell.current, UNLOCK_STAGE);
});

test('disabled games and the hub are unreachable in the sequence', async () => {
  const { shell, shown } = makeShell();
  await shell.start();
  assert.equal(await shell.enter('drink-stand'), false);
  assert.equal(await shell.enter('sports'), false);
  assert.equal(await shell.enter('restaurant'), false, 'the sequence offers no door choice');
  assert.deepEqual(shown.map((entry) => entry.stage), ['coloring']);
});

test('unlock cannot be entered, finished, restarted, or reached with Back', async () => {
  const { shell, shown } = makeShell();
  await shell.start();
  assert.equal(await shell.continueFromUnlock(), false);
  assert.equal(await shell.enter(UNLOCK_STAGE), false);
  await shell.finish('coloring');
  const count = shown.length;
  assert.equal(await shell.back(), false);
  assert.equal(await shell.restart(), false);
  assert.equal(await shell.enter('restaurant'), false);
  assert.equal(await shell.finish(UNLOCK_STAGE), false);
  assert.equal(shown.length, count);
  await shell.continueFromUnlock();
  assert.equal(await shell.continueFromUnlock(), false, 'continuation is consumed once');
  await shell.back();
  assert.equal(shell.current, 'coloring');
  assert.equal(shown.at(-1).transition, true);
});

test('refused unlock continuation can retry the pending next game', async () => {
  let refuse = false;
  const shell = createShellNavigator({
    isPlayable: () => true,
    show: async () => !refuse,
  });
  await shell.start();
  await shell.finish('coloring');
  refuse = true;
  assert.equal(await shell.continueFromUnlock(), false);
  assert.equal(shell.current, UNLOCK_STAGE);
  refuse = false;
  assert.equal(await shell.continueFromUnlock(), true);
  assert.equal(shell.current, 'restaurant');
});

test('stamp progress derives earned, unlocked and locked states from predecessor stamps', () => {
  const stamps = Object.freeze({ restaurant: true, sports: true });
  assert.equal(stageProgressState('coloring', stamps), 'unlocked');
  assert.equal(stageProgressState('restaurant', stamps), 'earned');
  assert.equal(stageProgressState('zoo', stamps), 'unlocked');
  assert.equal(stageProgressState('sports', stamps), 'earned');
  assert.equal(stageProgressState('drink-stand', stamps), 'unlocked');
  assert.equal(stageProgressState('restaurant', {}), 'locked');
  assert.equal(stageProgressState('nope', stamps), 'locked');
  assert.equal(stageProgressState('second', { first: true }, ['first', 'second']), 'unlocked');
  assert.equal(stageProgressState('second', {}, ['first', 'second']), 'locked');
});

test('?hub=1 keeps the old free-play room: every finish and Back return to it', async () => {
  assert.equal(shellModeFromSearch(''), 'sequence');
  assert.equal(shellModeFromSearch('?foo=1'), 'sequence');
  assert.equal(shellModeFromSearch('?hub=1'), 'hub');

  const { shell, shown } = makeShell({ mode: 'hub' });
  await shell.start();
  assert.deepEqual(shown.at(-1), { stage: HUB_STAGE, backAvailable: false, transition: false });
  assert.equal(await shell.enter('nope'), false, 'unknown doors stay shut in the hub');
  await shell.enter('sports');
  assert.deepEqual(shown.at(-1), { stage: 'sports', backAvailable: true, transition: true }, 'Sports is a real door again');
  await shell.back();
  await shell.enter('zoo');
  assert.deepEqual(shown.at(-1), { stage: 'zoo', backAvailable: true, transition: true });
  await shell.back();
  assert.equal(shell.current, HUB_STAGE);
  await shell.enter('coloring');
  assert.deepEqual(shown.at(-1), { stage: 'coloring', backAvailable: true, transition: true });
  await shell.finish('coloring');
  assert.equal(shell.current, HUB_STAGE);
  assert.ok(!shown.some((entry) => entry.stage === UNLOCK_STAGE));
  assert.equal(await shell.enter(UNLOCK_STAGE), false);
});

test('Escape follows the stage: kept in Coloring, previous stage elsewhere, local guards first', async () => {
  await withFakeDom(async ({ window, root }) => {
    let shell;
    const back = createBackControl({ root, label: UI.back, onBack: () => shell.back() });
    shell = createShellNavigator({
      isPlayable: (id) => Boolean(LESSON_BY_ID[id]?.available),
      show: async (stage, { backAvailable }) => {
        back.setAvailable(backAvailable);
        return true;
      },
    });
    const escape = () => window.dispatch('keydown', { key: 'Escape' });
    const settle = () => new Promise((resolve) => setImmediate(resolve));

    await shell.start();
    assert.equal(back.element.hidden, true, 'no visible Back in Coloring');
    assert.equal(escape().defaultPrevented, false);
    await settle();
    assert.equal(shell.current, 'coloring', 'Escape does not leave Coloring');

    await shell.finish('coloring');
    assert.equal(back.element.hidden, true, 'no Back during unlock');
    assert.equal(escape().defaultPrevented, false);
    await settle();
    assert.equal(shell.current, UNLOCK_STAGE);
    await shell.continueFromUnlock();
    assert.equal(back.element.hidden, false, 'Back appears in the Restaurant');
    await shell.finish('restaurant');
    await shell.continueFromUnlock();
    assert.equal(back.element.hidden, false, 'Back stays in the Zoo');

    // The Zoo's viewfinder (or Settings) takes Escape before the shell does.
    let viewfinderOpen = true;
    const unregister = back.registerEscapeGuard(() => {
      if (!viewfinderOpen) return false;
      viewfinderOpen = false;
      return true;
    });
    escape();
    await settle();
    assert.equal(shell.current, 'zoo', 'the local guard consumed the first Escape');
    escape();
    await settle();
    assert.equal(shell.current, 'restaurant', 'Zoo Escape -> Restaurant');
    unregister();

    escape();
    await settle();
    assert.equal(shell.current, 'coloring', 'Restaurant Escape -> Coloring');
    assert.equal(back.element.hidden, true);

    back.element.click();
    await settle();
    assert.equal(shell.current, 'coloring');
    back.destroy();
  });
});

test('the stamp book shows the five stages of the run', async () => {
  await withFakeDom(({ root }) => {
    const lessons = activeLessons(LESSON_BY_ID);
    assert.deepEqual(lessons.map((lesson) => lesson.name), ['Coloring', 'Restaurant', 'Zoo', 'Sports', 'Drink Stand']);
    const book = createStampBook({
      root,
      progression: { getState: () => ({ stamps: { sports: true }, bestStars: { sports: 3 }, zooPhotos: {} }) },
      lessons,
      strings: UI.stampBook,
    });
    book.open();
    const names = root.findAll('stamp-name').map((element) => element.textContent);
    assert.deepEqual(names, ['Coloring', 'Restaurant', 'Zoo', 'Sports', 'Drink Stand']);
    const stamps = root.findAll('stamp');
    assert.equal(stamps[0].children[0].textContent, '○');
    assert.equal(stamps[0].children[2].textContent, 'UNLOCKED');
    assert.equal(stamps[1].children[0].textContent, '🔒');
    assert.equal(stamps[1].children[2].textContent, 'LOCKED');
    assert.equal(stamps[1].classList.contains('is-locked'), true);
    assert.equal(stamps[2].classList.contains('is-locked'), true);
    assert.equal(stamps[3].classList.contains('is-earned'), true);
    assert.match(stamps[3].children[2].textContent, /3/);
    assert.equal(stamps[4].children[2].textContent, 'UNLOCKED');
    assert.equal(stamps[4].classList.contains('is-locked'), false);
    assert.ok(stamps.every((stamp) => stamp.tagName === 'ARTICLE' && !stamp.listeners.has('click')));
    book.destroy?.();
  });
  assert.match(mainSource, /lessons: ACTIVE_LESSONS/);
  assert.doesNotMatch(mainSource, /lessons: LESSONS\b/);
});

test('unlock card automatically continues once and plays its delayed reward sound', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  await withFakeDom(({ root }) => {
    let completions = 0;
    const sounds = [];
    const screen = createStageUnlock({
      root,
      lesson: LESSON_BY_ID.restaurant,
      strings: { title: 'UNLOCKED!' },
      audio: { playSfx: (name) => sounds.push(name) },
      onComplete: () => { completions += 1; },
    });
    screen.enter();
    const [section] = root.findAll('stage-unlock');
    assert.ok(section);
    assert.equal(root.findAll('stage-unlock__title')[0].textContent, 'UNLOCKED!');
    assert.equal(root.findAll('stage-unlock__name')[0].textContent, 'Restaurant');
    const descendants = (element) => [element, ...element.children.flatMap(descendants)];
    assert.ok(descendants(section).every((element) => element.tagName !== 'BUTTON' && element.tagName !== 'P'));
    t.mock.timers.tick(399);
    assert.deepEqual(sounds, []);
    assert.equal(completions, 0);
    t.mock.timers.tick(1);
    assert.deepEqual(sounds, ['unlock']);
    t.mock.timers.tick(1399);
    assert.equal(completions, 0);
    t.mock.timers.tick(1);
    assert.equal(completions, 1, 'completion does not need an animationend event');
    t.mock.timers.tick(5000);
    assert.equal(completions, 1);
    screen.exit();
    assert.equal(section.removed, true);
  });
});

test('exiting or reentering unlock clears old sound and continuation timers', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  await withFakeDom(({ root }) => {
    let completions = 0;
    const sounds = [];
    const screen = createStageUnlock({
      root,
      lesson: LESSON_BY_ID.zoo,
      strings: { title: 'UNLOCKED!' },
      audio: { playSfx: (name) => sounds.push(name) },
      durationMs: 900,
      onComplete: () => { completions += 1; },
    });
    screen.enter();
    t.mock.timers.tick(200);
    screen.exit();
    t.mock.timers.tick(1000);
    assert.deepEqual(sounds, []);
    assert.equal(completions, 0);
    screen.enter();
    t.mock.timers.tick(200);
    screen.enter();
    t.mock.timers.tick(400);
    assert.deepEqual(sounds, ['unlock'], 'only the current enter plays sound');
    t.mock.timers.tick(500);
    assert.equal(completions, 1);
    screen.exit();
  });
});

test('the completion screen lists the run with best stars and replays on もういちど', async () => {
  await withFakeDom(({ root }) => {
    let replays = 0;
    const screen = createSequenceComplete({
      root,
      progression: { getBestStars: (id) => ({ coloring: 3, restaurant: 2 })[id] || 0 },
      lessons: activeLessons(LESSON_BY_ID),
      strings: UI.sequenceComplete,
      onReplay: () => { replays += 1; },
    });
    screen.enter();
    const [section] = root.findAll('sequence-complete');
    assert.equal(section.children[0].children[0].textContent, 'ぜんぶ できた！');
    assert.deepEqual(root.findAll('sequence-complete__name').map((e) => e.textContent), ['Coloring', 'Restaurant', 'Zoo', 'Sports', 'Drink Stand']);
    assert.deepEqual(root.findAll('sequence-complete__stars').map((e) => e.textContent), ['★★★', '★★☆', '☆☆☆', '☆☆☆', '☆☆☆']);
    const [replay] = root.findAll('sequence-complete__replay');
    assert.equal(replay.textContent, 'もういちど');
    replay.click();
    assert.equal(replays, 1);
    screen.exit();
    assert.equal(section.removed, true);
  });
});

test('the shell no longer routes anything to the hub by default', () => {
  assert.doesNotMatch(mainSource, /returnToHub/);
  assert.match(mainSource, /shellModeFromSearch\(window\.location\.search\)/);
  assert.match(mainSource, /then\(\(\) => shellRoute\.start\(\)\)/);
  assert.match(mainSource, /finish: \(result\) => shellRoute\.finish\(id, result\)/);
  assert.match(mainSource, /onBack: \(\) => shellRoute\.back\(\)/);
  // The hub itself stays in source for free play.
  assert.match(mainSource, /import \{ createHub \} from '\.\/scenes\/hub\.js';/);
});
