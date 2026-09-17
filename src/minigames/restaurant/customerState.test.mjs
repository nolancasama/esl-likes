import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OWNERSHIP_BUBBLE_TEXT,
  isTalkable,
  ownershipBubble,
  patienceLevel,
} from './customerState.js';

function customer(overrides = {}) {
  return {
    state: 'seated',
    owner: null,
    reservedBy: null,
    food: 'pizza',
    patience: 100,
    patienceMax: 100,
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
    { kind: 'player', text: 'まってる…', patience: 1, patienceLevel: 'high' },
  );
  assert.deepEqual(
    ownershipBubble(customer({ state: 'awaiting', owner: 'rival' })),
    { kind: 'rival', text: 'まってる…', patience: 1, patienceLevel: 'high' },
  );
});

test('ownership bubble text is constant and never includes the food id', () => {
  assert.equal(OWNERSHIP_BUBBLE_TEXT, 'まってる…');
  for (const food of ['pizza', 'hamburger', 'curry', 'sushi']) {
    const bubble = ownershipBubble(customer({ state: 'awaiting', owner: 'player', food }));
    assert.equal(bubble.text, 'まってる…');
    assert.equal(bubble.text.includes(food), false);
    assert.equal(bubble.text.includes('I like'), false);
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
    ownershipBubble(awaiting, { dialogueOnCustomer: false }).text,
    'まってる…',
  );
});

test('claimed customers carry their own patience; unclaimed ones show none', () => {
  assert.equal(ownershipBubble(customer({ patience: 20 })), null);
  const calm = ownershipBubble(customer({ state: 'awaiting', owner: 'player', patience: 80 }));
  const urgent = ownershipBubble(customer({ state: 'awaiting', owner: 'rival', patience: 10 }));
  assert.equal(calm.patience, 0.8);
  assert.equal(urgent.patience, 0.1);
  assert.equal(calm.patienceLevel, 'high');
  assert.equal(urgent.patienceLevel, 'low');
});

test('patience levels run green, amber, red', () => {
  assert.equal(patienceLevel(0.9), 'high');
  assert.equal(patienceLevel(0.45), 'medium');
  assert.equal(patienceLevel(0.1), 'low');
});
