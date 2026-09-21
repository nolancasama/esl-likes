import test from 'node:test';
import assert from 'node:assert/strict';

import { ensureUniqueId, formatId, indexOfId, nextId } from './editorIds.js';

test('ids are the asset id plus a three-digit number', () => {
  assert.equal(formatId('common-tree', 1), 'common-tree-001');
  assert.equal(formatId('rock', 14), 'rock-014');
  assert.equal(formatId('rock', 1234), 'rock-1234');
});

test('the first id for an asset is 001', () => {
  assert.equal(nextId('rock', []), 'rock-001');
});

test('allocation fills the lowest free slot', () => {
  assert.equal(nextId('rock', ['rock-001', 'rock-003']), 'rock-002');
  assert.equal(nextId('rock', ['rock-001', 'rock-002']), 'rock-003');
});

test('ids of other assets do not consume numbers', () => {
  assert.equal(nextId('rock', ['tree-001', 'tree-002', 'bush-001']), 'rock-001');
});

test('an asset id containing a hyphen still parses', () => {
  assert.equal(indexOfId('common-tree-014', 'common-tree'), 14);
  assert.equal(indexOfId('common-tree-014', 'tree'), null);
  assert.equal(nextId('common-tree', ['common-tree-001']), 'common-tree-002');
});

test('a hand-edited id with no number is ignored by the allocator', () => {
  assert.equal(indexOfId('rock-big', 'rock'), null);
  assert.equal(nextId('rock', ['rock-big']), 'rock-001');
});

test('deleting one object does not renumber the others', () => {
  const taken = new Set(['rock-001', 'rock-002', 'rock-003']);
  taken.delete('rock-002');
  // rock-003 keeps its id; the freed slot is what gets reused.
  assert.ok(taken.has('rock-003'));
  assert.equal(nextId('rock', taken), 'rock-002');
});

test('an id loaded from a file is kept when it is free', () => {
  assert.equal(ensureUniqueId('rock-042', 'rock', new Set()), 'rock-042');
});

test('a colliding loaded id is renumbered rather than overwriting', () => {
  const taken = new Set(['rock-001']);
  const id = ensureUniqueId('rock-001', 'rock', taken);
  assert.notEqual(id, 'rock-001');
  assert.equal(id, 'rock-002');
});

test('a missing id falls back to a fresh one', () => {
  assert.equal(ensureUniqueId(undefined, 'bush', ['bush-001']), 'bush-002');
  assert.equal(ensureUniqueId('', 'bush', []), 'bush-001');
});
