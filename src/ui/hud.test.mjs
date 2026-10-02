import assert from 'node:assert/strict';
import test from 'node:test';

import { SPEECH_STATE } from '../systems/speech.js';
import { createHud } from './hud.js';

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.hidden = false;
    this.disabled = false;
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.textContent = '';
    this.className = '';
    this.id = '';
    this.style = { setProperty() {} };
    this.classList = { toggle() {}, add() {}, remove() {} };
  }

  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  get lastElementChild() { return this.children[this.children.length - 1]; }
  remove() { this.removed = true; }
  addEventListener() {}
  removeEventListener() {}
  setAttribute(name, value) { this.attributes[name] = value; }
}

function makeSettings(initial = {}) {
  let value = { micFree: false, textSize: 'normal', ...initial };
  const subscribers = new Set();
  return {
    get(key) { return key ? value[key] : value; },
    subscribe(listener) { subscribers.add(listener); return () => subscribers.delete(listener); },
    update(patch) {
      value = { ...value, ...patch };
      for (const listener of subscribers) listener(value);
    },
  };
}

function withFakeDocument(run) {
  const previous = globalThis.document;
  const head = new FakeElement('head');
  globalThis.document = {
    head,
    body: new FakeElement('body'),
    createElement: (tag) => new FakeElement(tag),
    getElementById: (id) => head.children.find((child) => child.id === id) ?? null,
  };
  try {
    return run();
  } finally {
    globalThis.document = previous;
  }
}

const strings = { talkStates: { ready: 'はなす', accepted: 'できた！' } };

test('a settings change never resurrects a hidden accepted HUD', () => withFakeDocument(() => {
  const settings = makeSettings();
  const hud = createHud({ strings, settings });
  hud.configureTalk({ targetSentence: 'What color do you like?' });
  hud.setTalkState(SPEECH_STATE.ACCEPTED);
  assert.equal(hud.talkButton.dataset.state, SPEECH_STATE.ACCEPTED);

  hud.hide();
  settings.update({ textSize: 'large' });
  settings.update({ micFree: true });
  settings.update({ micFree: false });
  hud.setMicFree(true);

  assert.equal(hud.element.hidden, true);
  assert.notEqual(hud.talkButton.dataset.state, SPEECH_STATE.ACCEPTED);
  hud.dispose();
}));

test('hide resets the visual Talk state but keeps the fallback policy', () => withFakeDocument(() => {
  const hud = createHud({ strings, settings: makeSettings() });
  hud.configureTalk({ targetSentence: 'I like red.' });
  hud.recordFailure();
  hud.recordFailure();
  assert.equal(hud.isFallbackVisible, true);

  hud.hide();
  assert.equal(hud.talkButton.dataset.state, SPEECH_STATE.READY);
  assert.equal(hud.failureCount, 2);
  hud.show();
  assert.equal(hud.isFallbackVisible, true, 'show() still honours the fallback after hide()');
  hud.dispose();
}));

test('the next prompt shows a fresh READY Talk button', () => withFakeDocument(() => {
  const settings = makeSettings();
  const hud = createHud({ strings, settings });
  hud.configureTalk({ targetSentence: 'What food do you like?' });
  hud.setTalkState(SPEECH_STATE.ACCEPTED);
  hud.hide();
  settings.update({ micFree: true });

  hud.configureTalk({ targetSentence: 'What animal do you like?' });
  assert.equal(hud.element.hidden, false);
  assert.equal(hud.talkButton.hidden, false);
  assert.equal(hud.talkButton.disabled, false);
  assert.equal(hud.talkButton.dataset.state, SPEECH_STATE.READY);
  assert.equal(hud.talkButton.attributes['aria-label'], 'はなす');
  hud.dispose();
}));

test('setMicFree still refreshes a visible HUD', () => withFakeDocument(() => {
  const hud = createHud({ strings, settings: makeSettings() });
  hud.configureTalk({ targetSentence: 'What color do you like?' });
  hud.talkButton.disabled = true;
  hud.setMicFree(false);
  assert.equal(hud.talkButton.disabled, false);
  hud.dispose();
}));
