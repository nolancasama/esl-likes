import test from 'node:test';
import assert from 'node:assert/strict';

import { HoldToTalk, SPEECH_STATE, createSpeechSystem } from './speech.js';

class FakeTarget {
  constructor() {
    this.listeners = new Map();
    this.disabled = false;
    this.hidden = false;
    this.capturedPointer = null;
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
      preventDefault() {},
      stopImmediatePropagation() {},
      ...properties,
    };
    for (const listener of [...(this.listeners.get(type) || [])]) listener(event);
  }

  setPointerCapture(pointerId) { this.capturedPointer = pointerId; }
  hasPointerCapture(pointerId) { return this.capturedPointer === pointerId; }
  releasePointerCapture(pointerId) {
    if (this.capturedPointer === pointerId) this.capturedPointer = null;
  }
}

function installBrowser({ permission = 'prompt' } = {}) {
  const originals = new Map();
  const install = (name, value) => {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  };

  const counters = { starts: 0, stops: 0, aborts: 0, permissionQueries: 0 };
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
    error(reason) { this.onerror?.({ error: reason }); }
  }

  const fakeWindow = new FakeTarget();
  fakeWindow.SpeechRecognition = FakeRecognition;
  const fakeDocument = new FakeTarget();
  fakeDocument.hidden = false;
  const fakeNavigator = {
    permissions: {
      query: async ({ name }) => {
        assert.equal(name, 'microphone');
        counters.permissionQueries += 1;
        return { state: permission };
      },
    },
  };

  install('window', fakeWindow);
  install('document', fakeDocument);
  install('navigator', fakeNavigator);

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

const settlePermission = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

function questionTarget(overrides = {}) {
  return {
    mode: 'question',
    category: 'drink',
    ...overrides,
  };
}

test('listenOnce refuses to start without a target', async () => {
  const browser = installBrowser({ permission: 'granted' });
  const speech = createSpeechSystem();
  speech.bind(browser.button);
  await settlePermission();

  assert.equal(speech.autoListenAllowed(), true);
  assert.equal(speech.listenOnce(), false);
  assert.equal(browser.counters.starts, 0);

  speech.dispose();
  browser.restore();
});

test('listenOnce starts with a target and accepts a live correct result', async () => {
  const browser = installBrowser({ permission: 'granted' });
  const accepted = [];
  const speech = createSpeechSystem();
  speech.bind(browser.button);
  speech.setTarget(questionTarget({ onAccepted: (result) => accepted.push(result) }));
  await settlePermission();

  assert.equal(speech.listenOnce(), true);
  assert.equal(speech.active, true);
  assert.equal(browser.counters.starts, 1);
  assert.equal(speech.listenOnce(), false);

  browser.instances[0].result('What drink do you like?');
  browser.instances[0].end();

  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].ok, true);
  assert.equal(speech.state, SPEECH_STATE.ACCEPTED);
  assert.equal(speech.active, false);

  speech.dispose();
  browser.restore();
});

test('an automatic session ends on engine silence, reports try-again, and does not restart', async () => {
  const browser = installBrowser({ permission: 'granted' });
  let failures = 0;
  const states = [];
  const speech = createSpeechSystem();
  speech.bind(browser.button);
  speech.setTarget(questionTarget({
    onFailure: () => { failures += 1; },
    onState: (state) => states.push(state),
  }));
  await settlePermission();

  assert.equal(speech.listenOnce(), true);
  browser.instances[0].end();

  assert.equal(failures, 1);
  assert.equal(speech.active, false);
  assert.equal(speech.state, SPEECH_STATE.TRY_AGAIN);
  assert.equal(browser.counters.starts, 1);
  assert.equal(states.at(-1), SPEECH_STATE.TRY_AGAIN);

  speech.dispose();
  browser.restore();
});

test('listen is bounded by the existing hold cap', async () => {
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
  const hold = new HoldToTalk(browser.button, { onResult: (...args) => results.push(args) });
  assert.equal(hold.listen(), true);
  const cap = timers.find((timer) => timer.delay === 5000);
  assert.ok(cap, 'the unchanged five-second cap is scheduled');

  cap.callback();
  await Promise.resolve();

  assert.equal(browser.counters.stops, 1);
  assert.equal(hold.active, false);
  assert.equal(results.length, 1);

  hold.dispose();
  globalThis.setTimeout = originalSetTimeout;
  globalThis.clearTimeout = originalClearTimeout;
  browser.restore();
});

test('autoListenAllowed follows permission, a successful hold, and denial', async () => {
  const grantedBrowser = installBrowser({ permission: 'granted' });
  const grantedSpeech = createSpeechSystem();
  grantedSpeech.bind(grantedBrowser.button);
  await settlePermission();
  assert.equal(grantedSpeech.autoListenAllowed(), true);
  assert.equal(grantedBrowser.counters.permissionQueries, 1);
  grantedSpeech.dispose();
  grantedBrowser.restore();

  const promptBrowser = installBrowser({ permission: 'prompt' });
  const promptSpeech = createSpeechSystem();
  promptSpeech.bind(promptBrowser.button);
  promptSpeech.setTarget(questionTarget());
  await settlePermission();
  assert.equal(promptSpeech.autoListenAllowed(), false);

  promptBrowser.button.dispatch('pointerdown', { button: 0, pointerId: 3 });
  assert.equal(promptSpeech.autoListenAllowed(), true);
  promptBrowser.instances[0].error('not-allowed');
  assert.equal(promptSpeech.autoListenAllowed(), false);

  promptSpeech.dispose();
  promptBrowser.restore();
});

test('a plain pointer hold still starts on down and stops on release', async () => {
  const browser = installBrowser();
  const results = [];
  const states = [];
  const hold = new HoldToTalk(browser.button, {
    onResult: (alternatives) => results.push(alternatives),
    onState: (state) => states.push(state),
  });

  browser.button.dispatch('pointerdown', { button: 0, pointerId: 7 });
  assert.equal(browser.counters.starts, 1);
  assert.equal(hold.active, true);
  browser.instances[0].result('not a match', { isFinal: false });

  browser.button.dispatch('pointerup', { button: 0, pointerId: 7 });
  await Promise.resolve();

  assert.equal(browser.counters.stops, 1);
  assert.equal(browser.counters.aborts, 0);
  assert.equal(hold.active, false);
  assert.deepEqual(results, [['not a match']]);
  assert.deepEqual(states, ['listening', 'idle', 'idle']);

  hold.dispose();
  browser.restore();
});
