import test from 'node:test';
import assert from 'node:assert/strict';

import { createHistory, sameTransform, transformCommand } from './editorHistory.js';

/** A stand-in for a placed object: just the numbers the editor writes. */
const makeSubject = () => ({
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
});

const apply = (subject) => (transform) => {
  subject.position = [...transform.position];
  subject.rotation = [...transform.rotation];
  subject.scale = [...transform.scale];
};

test('a recorded command undoes and redoes', () => {
  const history = createHistory();
  const subject = makeSubject();
  const before = { ...makeSubject() };
  const after = { position: [3, 0, 4], rotation: [0, 1, 0], scale: [2, 2, 2] };

  history.run(transformCommand({ label: 'move', apply: apply(subject), before, after }));
  assert.deepEqual(subject.position, [3, 0, 4]);

  history.undo();
  assert.deepEqual(subject.position, [0, 0, 0]);
  assert.deepEqual(subject.scale, [1, 1, 1]);

  history.redo();
  assert.deepEqual(subject.position, [3, 0, 4]);
  assert.deepEqual(subject.scale, [2, 2, 2]);
});

test('create and delete are undoable and redoable', () => {
  const history = createHistory();
  const world = new Set();

  history.run({ label: 'create', do: () => world.add('tree-001'), undo: () => world.delete('tree-001') });
  assert.ok(world.has('tree-001'));
  history.undo();
  assert.equal(world.size, 0);
  history.redo();
  assert.ok(world.has('tree-001'));

  history.run({ label: 'delete', do: () => world.delete('tree-001'), undo: () => world.add('tree-001') });
  assert.equal(world.size, 0);
  history.undo();
  assert.ok(world.has('tree-001'), 'undoing a delete brings the object back');
});

test('a new action discards the redo branch', () => {
  const history = createHistory();
  const log = [];
  history.run({ label: 'a', do: () => log.push('a'), undo: () => log.pop() });
  history.undo();
  assert.ok(history.canRedo);
  history.run({ label: 'b', do: () => log.push('b'), undo: () => log.pop() });
  assert.equal(history.canRedo, false);
  assert.deepEqual(history.labels(), ['b']);
});

test('undo and redo on an empty stack are harmless', () => {
  const history = createHistory();
  assert.equal(history.undo(), null);
  assert.equal(history.redo(), null);
  assert.equal(history.canUndo, false);
  assert.equal(history.canRedo, false);
});

test('the stack is capped and drops the oldest entry', () => {
  const history = createHistory({ limit: 3 });
  for (const label of ['a', 'b', 'c', 'd']) {
    history.push({ label, do: () => {}, undo: () => {} });
  }
  assert.equal(history.length, 3);
  assert.deepEqual(history.labels(), ['b', 'c', 'd']);
});

test('a command without do and undo is rejected', () => {
  const history = createHistory();
  assert.throws(() => history.push({ label: 'broken' }), /needs both do\(\) and undo\(\)/);
});

test('onChange reports what the panel needs to grey out its buttons', () => {
  const seen = [];
  const history = createHistory({ onChange: (state) => seen.push(state) });
  history.run({ label: 'a', do: () => {}, undo: () => {} });
  history.undo();
  assert.deepEqual(seen.at(-2), { canUndo: true, canRedo: false, length: 1 });
  assert.deepEqual(seen.at(-1), { canUndo: false, canRedo: true, length: 0 });
});

test('a drag that moved nothing is not a step', () => {
  const before = makeSubject();
  const after = makeSubject();
  assert.equal(sameTransform(before, after), true);
  after.position[0] = 1e-9;
  assert.equal(sameTransform(before, after), true, 'float noise is not a move');
  after.position[0] = 0.01;
  assert.equal(sameTransform(before, after), false);
});

test('a transform command keeps its own copies of the endpoints', () => {
  const subject = makeSubject();
  const before = makeSubject();
  const after = { position: [5, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
  const command = transformCommand({ apply: apply(subject), before, after });
  // Mutating the caller's objects afterwards must not rewrite history.
  after.position[0] = 999;
  before.position[0] = -999;
  command.do();
  assert.deepEqual(subject.position, [5, 0, 0]);
  command.undo();
  assert.deepEqual(subject.position, [0, 0, 0]);
});

test('clear empties both directions', () => {
  const history = createHistory();
  history.run({ label: 'a', do: () => {}, undo: () => {} });
  history.undo();
  history.clear();
  assert.equal(history.canUndo, false);
  assert.equal(history.canRedo, false);
});
