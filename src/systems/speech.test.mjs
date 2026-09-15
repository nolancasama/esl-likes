import test from 'node:test';
import assert from 'node:assert/strict';

import { PressToTalk, SPEECH_STATE, createSpeechSystem } from './speech.js';

class FakeTarget {
  constructor() {
    this.listeners = new Map();
    this.disabled = false;
    this.hidden = false;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter((item) => item !== listener));
  }

  dispatch(type, properties = {}) {
    const event = {
      type,
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
      stopImmediatePropagation() {},
      ...properties,
    };
    for (const listener of [...(this.listeners.get(type) || [])]) listener(event);
    return event;
  }
}

function installBrowser() {
  const originals = new Map();
  const install = (name, value) => {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  };

  const counters = { starts: 0, stops: 0, aborts: 0 };
  const instances = [];

  class FakeRecognition {
    constructor() {
      instances.push(this);
    }

    start() { counters.starts += 1; }
    stop() {
      counters.stops += 1;
      queueMicrotask(() => this.onend?.());
    }
    abort() { counters.aborts += 1; }

    result(transcript, { isFinal = true } = {}) {
      const result = [{ transcript }];
      result.isFinal = isFinal;
      this.onresult?.({ results: [result] });
    }

    end() { this.onend?.(); }
  }

  const fakeWindow = new FakeTarget();
  fakeWindow.SpeechRecognition = FakeRecognition;
  const fakeDocument = new FakeTarget();
  fakeDocument.hidden = false;
  install('window', fakeWindow);
  install('document', fakeDocument);

  return {
    button: new FakeTarget(),
    counters,
    instances,
    window: fakeWindow,
    restore() {
      for (const [name, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete globalThis[name];
      }
    },
  };
}

function questionTarget(overrides = {}) {
  return {
    mode: 'question',
    category: 'drink',
    ...overrides,
  };
}

test('one click starts one configured recognition session and commits synchronously', () => {
  const browser = installBrowser();
  let commits = 0;
  const speech = createSpeechSystem();
  speech.bind(browser.button);
  speech.setTarget(questionTarget({ onCommit: () => { commits += 1; } }));

  browser.button.dispatch('click', { button: 0 });

  assert.equal(commits, 1);
  assert.equal(browser.counters.starts, 1);
  assert.equal(speech.active, true);
  assert.equal(browser.instances[0].continuous, false);
  assert.equal(browser.instances[0].interimResults, true);
  assert.equal(browser.instances[0].maxAlternatives, 5);

  speech.dispose();
  browser.restore();
});

test('a press does nothing without an enabled target', () => {
  const browser = installBrowser();
  const speech = createSpeechSystem();
  speech.bind(browser.button);

  browser.button.dispatch('click', { button: 0 });
  assert.equal(browser.counters.starts, 0);

  speech.setTarget(questionTarget());
  speech.setEnabled(false);
  browser.button.dispatch('click', { button: 0 });
  assert.equal(browser.counters.starts, 0);

  speech.dispose();
  browser.restore();
});

test('pointer and key release events have no effect on a listening session', () => {
  const browser = installBrowser();
  const press = new PressToTalk(browser.button);

  browser.button.dispatch('click', { button: 0 });
  for (const type of ['pointerup', 'keyup', 'pointerleave', 'lostpointercapture']) {
    browser.button.dispatch(type, { pointerId: 7, key: 'Enter' });
  }

  assert.equal(press.active, true);
  assert.equal(browser.counters.stops, 0);
  assert.equal(browser.counters.aborts, 0);

  press.dispose();
  browser.restore();
});

test('a second press cancels without a result or failure', () => {
  const browser = installBrowser();
  let failures = 0;
  let cancels = 0;
  const speech = createSpeechSystem();
  speech.bind(browser.button);
  speech.setTarget(questionTarget({
    onFailure: () => { failures += 1; },
    onCancel: () => { cancels += 1; },
  }));

  browser.button.dispatch('click', { button: 0 });
  browser.instances[0].result('banana', { isFinal: false });
  browser.button.dispatch('click', { button: 0 });

  assert.equal(browser.counters.aborts, 1);
  assert.equal(browser.counters.stops, 0);
  assert.equal(failures, 0);
  assert.equal(cancels, 1);
  assert.equal(speech.active, false);
  assert.equal(speech.state, SPEECH_STATE.READY);

  speech.dispose();
  browser.restore();
});

test('natural recognizer end judges the attempt and does not restart', () => {
  const browser = installBrowser();
  let failures = 0;
  const speech = createSpeechSystem();
  speech.bind(browser.button);
  speech.setTarget(questionTarget({ onFailure: () => { failures += 1; } }));

  browser.button.dispatch('click', { button: 0 });
  browser.instances[0].result('banana');
  browser.instances[0].end();

  assert.equal(failures, 1);
  assert.equal(speech.active, false);
  assert.equal(speech.state, SPEECH_STATE.TRY_AGAIN);
  assert.equal(browser.counters.starts, 1);

  speech.dispose();
  browser.restore();
});

test('an interim match is accepted immediately', () => {
  const browser = installBrowser();
  const accepted = [];
  const speech = createSpeechSystem();
  speech.bind(browser.button);
  speech.setTarget(questionTarget({ onAccepted: (result, meta) => accepted.push({ result, meta }) }));

  browser.button.dispatch('click', { button: 0 });
  browser.instances[0].result('What drink do you like?', { isFinal: false });

  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].result.ok, true);
  assert.equal(accepted[0].meta.interim, true);
  assert.equal(speech.state, SPEECH_STATE.ACCEPTED);
  assert.equal(speech.active, false);

  speech.dispose();
  browser.restore();
});

test('the safety cap finishes and judges after eight seconds', async () => {
  const browser = installBrowser();
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const timers = [];
  globalThis.setTimeout = (callback, delay) => {
    const timer = { callback, delay, cleared: false };
    timers.push(timer);
    return timer;
  };
  globalThis.clearTimeout = (timer) => {
    if (timer) timer.cleared = true;
  };

  const results = [];
  const press = new PressToTalk(browser.button, { onResult: (...args) => results.push(args) });
  browser.button.dispatch('click', { button: 0 });
  const cap = timers.find((timer) => timer.delay === 8000);
  assert.ok(cap, 'the eight-second cap is scheduled');

  cap.callback();
  await Promise.resolve();

  assert.equal(browser.counters.stops, 1);
  assert.equal(press.active, false);
  assert.equal(results.length, 1);

  press.dispose();
  globalThis.setTimeout = originalSetTimeout;
  globalThis.clearTimeout = originalClearTimeout;
  browser.restore();
});

test('Enter starts globally, repeat is ignored, Space and keyup do nothing', () => {
  const browser = installBrowser();
  const press = new PressToTalk(browser.button);

  browser.window.dispatch('keydown', { key: ' ', repeat: false });
  browser.window.dispatch('keydown', { key: 'Enter', repeat: true });
  browser.window.dispatch('keyup', { key: 'Enter' });
  assert.equal(browser.counters.starts, 0);

  const enter = browser.window.dispatch('keydown', { key: 'Enter', repeat: false });
  assert.equal(enter.defaultPrevented, true);
  assert.equal(browser.counters.starts, 1);
  assert.equal(press.active, true);

  browser.window.dispatch('keyup', { key: 'Enter' });
  assert.equal(press.active, true);

  press.dispose();
  browser.restore();
});

test('a refused commit opens no recognition session', () => {
  const browser = installBrowser();
  const speech = createSpeechSystem();
  speech.bind(browser.button);
  speech.setTarget(questionTarget({ onCommit: () => false }));

  browser.button.dispatch('click', { button: 0 });

  assert.equal(browser.counters.starts, 0);
  assert.equal(speech.active, false);

  speech.dispose();
  browser.restore();
});

test('mic-free press commits and opens fallback without recognition', () => {
  const browser = installBrowser();
  let commits = 0;
  let fallbacks = 0;
  const speech = createSpeechSystem();
  speech.bind(browser.button);
  speech.setTarget(questionTarget({
    micFree: true,
    onCommit: () => { commits += 1; },
    onFallback: () => { fallbacks += 1; },
  }));

  browser.button.dispatch('click', { button: 0 });

  assert.equal(commits, 1);
  assert.equal(fallbacks, 1);
  assert.equal(browser.counters.starts, 0);
  assert.equal(speech.active, false);

  speech.dispose();
  browser.restore();
});
