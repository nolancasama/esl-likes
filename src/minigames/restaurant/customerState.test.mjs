import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OWNERSHIP_BUBBLE_TEXT,
  isTalkable,
  ownershipBubble,
} from './customerState.js';

function customer(overrides = {}) {
  return {
    state: 'seated',
    owner: null,
    reservedBy: null,
    food: 'pizza',
    ...overrides,
  };
}

test('an unclaimed seated customer is talkable', () => {
  assert.equal(isTalkable(customer()), true);
  assert.equal(isTalkable(customer({ reservedBy: undefined })), true);
  assert.equal(isTalkable(customer({ reservedBy: 'player' })), true);
});

test('a customer reserved by someone other than the player is not talkable', () => {
  assert.equal(isTalkable(customer({ reservedBy: 'rival' })), false);
  assert.equal(isTalkable(customer({ reservedBy: undefined, reservation: 'rival' })), false);
});

test('walking, eating, leaving, and owned customers are not talkable', () => {
  assert.equal(isTalkable(customer({ state: 'walkingIn' })), false);
  assert.equal(isTalkable(customer({ state: 'eating' })), false);
  assert.equal(isTalkable(customer({ state: 'leaving' })), false);
  assert.equal(isTalkable(customer({ state: 'awaiting', owner: 'player' })), false);
  assert.equal(isTalkable(customer({ state: 'awaiting', owner: 'rival' })), false);
});

test('an unclaimed customer has no ownership bubble', () => {
  assert.equal(ownershipBubble(customer()), null);
});

test('player- and rival-owned awaiting customers have matching bubbles', () => {
  assert.deepEqual(
    ownershipBubble(customer({ state: 'awaiting', owner: 'player' })),
    { kind: 'player', text: 'I like...' },
  );
  assert.deepEqual(
    ownershipBubble(customer({ state: 'awaiting', owner: 'rival' })),
    { kind: 'rival', text: 'I like...' },
  );
});

test('ownership bubble text is constant and never includes the food id', () => {
  assert.equal(OWNERSHIP_BUBBLE_TEXT, 'I like...');
  for (const food of ['pizza', 'hamburger', 'curry', 'sushi']) {
    const bubble = ownershipBubble(customer({ state: 'awaiting', owner: 'player', food }));
    assert.equal(bubble.text, 'I like...');
    assert.equal(bubble.text.includes(food), false);
  }
});

test('eating and leaving customers have no ownership bubble', () => {
  assert.equal(ownershipBubble(customer({ state: 'eating', owner: 'player' })), null);
  assert.equal(ownershipBubble(customer({ state: 'leaving', owner: 'rival' })), null);
});

test('the ownership bubble hides during dialogue and returns afterward', () => {
  const awaiting = customer({ state: 'awaiting', owner: 'player' });
  assert.equal(ownershipBubble(awaiting, { dialogueOnCustomer: true }), null);
  assert.deepEqual(
    ownershipBubble(awaiting, { dialogueOnCustomer: false }),
    { kind: 'player', text: 'I like...' },
  );
});
