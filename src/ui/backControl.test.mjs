import assert from 'node:assert/strict';
import test from 'node:test';

import { SHELL_MODAL_ESCAPE_PRIORITY, createBackControl } from './backControl.js';

class FakeEventTarget {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    this.listeners.set(type, listeners.filter((candidate) => candidate !== listener));
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
    this.hidden = false;
    this.removed = false;
  }

  click() {
    this.dispatch('click', { target: this });
  }

  remove() {
    this.removed = true;
  }
}

function makeHarness() {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const fakeWindow = new FakeEventTarget();
  const root = {
    children: [],
    append(element) { this.children.push(element); },
  };
  const classes = new Set();
  const documentElement = {
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
      toggle: (name, force) => (force ? classes.add(name) : classes.delete(name)),
    },
  };
  globalThis.document = {
    createElement: (tagName) => new FakeElement(tagName),
    documentElement,
  };
  globalThis.window = fakeWindow;

  return {
    root,
    window: fakeWindow,
    documentElement,
    restore() {
      globalThis.document = previousDocument;
      globalThis.window = previousWindow;
    },
  };
}

test('Back is hidden until available and click and Escape share the action', () => {
  const harness = makeHarness();
  try {
    let backCount = 0;
    const control = createBackControl({
      root: harness.root,
      label: '← もどる',
      onBack: () => { backCount += 1; },
    });

    assert.equal(harness.root.children.length, 1);
    assert.equal(control.element.textContent, '← もどる');
    assert.equal(control.element.hidden, true);
    control.element.click();
    harness.window.dispatch('keydown', { key: 'Escape' });
    assert.equal(backCount, 0);

    control.setAvailable(true);
    control.element.click();
    const escape = harness.window.dispatch('keydown', { key: 'Escape' });
    assert.equal(backCount, 2);
    assert.equal(escape.defaultPrevented, true);
    control.destroy();
  } finally {
    harness.restore();
  }
});

test('Escape guards run newest first and a consuming guard blocks Back', () => {
  const harness = makeHarness();
  try {
    const calls = [];
    let backCount = 0;
    const control = createBackControl({
      root: harness.root,
      label: '← もどる',
      onBack: () => { backCount += 1; },
    });
    control.setAvailable(true);
    control.registerEscapeGuard(() => {
      calls.push('older');
      return true;
    });
    const unregisterNewest = control.registerEscapeGuard(() => {
      calls.push('newer');
      return false;
    });

    harness.window.dispatch('keydown', { key: 'Escape' });
    assert.deepEqual(calls, ['newer', 'older']);
    assert.equal(backCount, 0);

    calls.length = 0;
    unregisterNewest();
    harness.window.dispatch('keydown', { key: 'Escape' });
    assert.deepEqual(calls, ['older']);
    assert.equal(backCount, 0);
    control.destroy();
  } finally {
    harness.restore();
  }
});

test('showing Back makes room for a minigame scene card', () => {
  const harness = makeHarness();
  try {
    const control = createBackControl({
      root: harness.root,
      label: '← もどる',
      onBack: () => {},
    });
    const root = harness.documentElement;

    // Four minigames start their shared `.top-bar` in the same corner Back
    // occupies. Without this the title and hint sit underneath the button.
    control.setAvailable(true);
    assert.ok(root.classList.contains('shell-has-back'), 'the scene card was left under Back');
    control.setAvailable(false);
    assert.ok(!root.classList.contains('shell-has-back'), 'the hub bar kept a gap for a hidden button');

    control.setAvailable(true);
    control.destroy();
    assert.ok(!root.classList.contains('shell-has-back'), 'the gap outlived the control');
  } finally {
    harness.restore();
  }
});

test('a shell modal takes Escape from a minigame UI underneath it', () => {
  const harness = makeHarness();
  try {
    const calls = [];
    let backCount = 0;
    const control = createBackControl({
      root: harness.root,
      label: '← もどる',
      onBack: () => { backCount += 1; },
    });
    control.setAvailable(true);

    // Settings is built at startup, so it registers FIRST. The Zoo's viewfinder
    // registers on entry, long after. The viewfinder sits at z-index 18 and the
    // Settings launcher at 40, so a child can open the panel on top of an open
    // viewfinder - and last-registered-wins would then close the viewfinder they
    // cannot even see instead of the panel they are looking at.
    control.registerEscapeGuard(() => {
      calls.push('settings');
      return true;
    }, { priority: SHELL_MODAL_ESCAPE_PRIORITY });
    control.registerEscapeGuard(() => {
      calls.push('viewfinder');
      return true;
    });

    harness.window.dispatch('keydown', { key: 'Escape' });
    assert.deepEqual(calls, ['settings'], 'the minigame swallowed the settings panel Escape');
    assert.equal(backCount, 0);
    control.destroy();
  } finally {
    harness.restore();
  }
});

test('Escape is ignored in text inputs and editable fields', () => {
  const harness = makeHarness();
  try {
    let guardCount = 0;
    let backCount = 0;
    const control = createBackControl({
      root: harness.root,
      label: '← もどる',
      onBack: () => { backCount += 1; },
    });
    control.setAvailable(true);
    control.registerEscapeGuard(() => {
      guardCount += 1;
      return false;
    });

    const textInput = { tagName: 'INPUT', type: 'text' };
    const editable = { tagName: 'DIV', isContentEditable: true };
    harness.window.dispatch('keydown', { key: 'Escape', target: textInput });
    harness.window.dispatch('keydown', { key: 'Escape', target: editable });
    assert.equal(guardCount, 0);
    assert.equal(backCount, 0);
    control.destroy();
  } finally {
    harness.restore();
  }
});

test('a held Escape cannot close a local UI and then trigger Back', () => {
  const harness = makeHarness();
  try {
    let localOpen = true;
    let backCount = 0;
    const control = createBackControl({
      root: harness.root,
      label: '← もどる',
      onBack: () => { backCount += 1; },
    });
    control.setAvailable(true);
    control.registerEscapeGuard(() => {
      if (!localOpen) return false;
      localOpen = false;
      return true;
    });

    harness.window.dispatch('keydown', { key: 'Escape', repeat: false });
    harness.window.dispatch('keydown', { key: 'Escape', repeat: true });
    assert.equal(localOpen, false);
    assert.equal(backCount, 0);
    control.destroy();
  } finally {
    harness.restore();
  }
});

test('destroy removes the global listener and button', () => {
  const harness = makeHarness();
  try {
    let backCount = 0;
    const control = createBackControl({
      root: harness.root,
      label: '← もどる',
      onBack: () => { backCount += 1; },
    });
    control.setAvailable(true);
    control.destroy();
    harness.window.dispatch('keydown', { key: 'Escape' });
    control.element.click();
    assert.equal(backCount, 0);
    assert.equal(control.element.removed, true);
  } finally {
    harness.restore();
  }
});
