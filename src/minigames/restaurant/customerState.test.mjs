import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OWNERSHIP_BUBBLE_TEXT,
  PATIENCE_LOW,
  PATIENCE_MEDIUM,
  PATIENCE_SECONDS,
  drainPatience,
  isTalkable,
  ownershipBubble,
  patienceLevel,
} from './customerState.js';
import { createSpeechFocus } from '../../systems/speechFocus.js';

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

test('patience is green above 50%, amber from 50% to 20%, red below 20%', () => {
  assert.equal(PATIENCE_MEDIUM, 0.5);
  assert.equal(PATIENCE_LOW, 0.2);
  assert.equal(patienceLevel(1), 'high');
  assert.equal(patienceLevel(0.51), 'high');
  assert.equal(patienceLevel(0.5), 'high');
  assert.equal(patienceLevel(0.49), 'medium');
  assert.equal(patienceLevel(0.21), 'medium');
  assert.equal(patienceLevel(0.2), 'medium');
  assert.equal(patienceLevel(0.19), 'low');
  assert.equal(patienceLevel(0), 'low');
});

test('patience runs out in about 45–50 s on Easy, 35–40 s on Normal, 25–30 s on Challenge', () => {
  const ranges = { 1: [45, 50], 2: [35, 40], 3: [25, 30] };
  for (const [level, [low, high]] of Object.entries(ranges)) {
    const seconds = PATIENCE_SECONDS[level];
    assert.ok(seconds >= low && seconds <= high, `level ${level}: ${seconds}`);
    // Drain at a 60 fps service clock from full to empty.
    let waiting = customer({ state: 'awaiting', owner: 'player', patience: seconds, patienceMax: seconds });
    let elapsed = 0;
    while (waiting.patience > 0) {
      waiting = { ...waiting, patience: drainPatience(waiting, 1 / 60) };
      elapsed += 1 / 60;
    }
    assert.ok(Math.abs(elapsed - seconds) < 0.05, `level ${level} emptied in ${elapsed}`);
  }
  assert.ok(PATIENCE_SECONDS[1] > PATIENCE_SECONDS[2] && PATIENCE_SECONDS[2] > PATIENCE_SECONDS[3]);
});

test('Normal and Challenge are much shorter than the previous 120 s and 100 s', () => {
  assert.ok(PATIENCE_SECONDS[2] <= 120 * 0.4);
  assert.ok(PATIENCE_SECONDS[3] <= 100 * 0.4);
  assert.ok(PATIENCE_SECONDS[1] <= 150 * 0.4);
});

test('only waiting drains patience, and nothing refills it', () => {
  assert.equal(drainPatience(customer({ state: 'awaiting', patience: 30 }), 2), 28);
  assert.equal(drainPatience(customer({ state: 'seated', patience: 30 }), 2), 30);
  assert.equal(drainPatience(customer({ state: 'seated', patience: 30 }), 2, { preOrderDrain: 0.5 }), 29);
  assert.equal(drainPatience(customer({ state: 'eating', patience: 30 }), 2), 30);
  assert.equal(drainPatience(customer({ state: 'awaiting', patience: 1 }), 5), 0);
  // A wrong delivery (refusal lock) or a colour step is not an input: the next
  // update keeps draining from where it was.
  const refused = customer({ state: 'awaiting', owner: 'player', patience: 10, patienceMax: 38, refusalRemaining: 5 });
  assert.equal(drainPatience(refused, 1), 9);
  assert.equal(drainPatience(customer({ state: 'awaiting', patience: 30 }), -1), 30);
  assert.equal(drainPatience(customer({ state: 'awaiting', patience: 30 }), Number.NaN), 30);
});

test('speech focus protects patience: no drain while the service clock is frozen', () => {
  const focus = createSpeechFocus();
  const waiting = customer({ state: 'awaiting', owner: 'player', patience: 20, patienceMax: 38 });
  focus.begin('talk');
  let patience = waiting.patience;
  // Let the enter ramp finish, then a long recognition.
  for (let step = 0; step < 600; step += 1) {
    focus.update(1 / 60);
    const before = patience;
    patience = drainPatience({ ...waiting, patience }, focus.serviceDelta(1 / 60));
    if (step > 60) assert.equal(patience, before);
  }
  assert.ok(patience > 19, `drained ${20 - patience} s during focus`);
});
