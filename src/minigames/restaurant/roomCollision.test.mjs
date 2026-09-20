import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CHAIR_HALF_DEPTH,
  CHAIR_HALF_WIDTH,
  ROOM_BOUNDS,
  SEATED_CUSTOMER_RADIUS,
  TABLES,
  TABLE_RADIUS,
  TALK_RADIUS,
  blocksMovement,
  canOccupy,
  chairPositions,
  resolveMove,
} from './roomCollision.js';

const ROOM = { tables: TABLES };
const EPSILON = 1e-6;

function seatOf(table) {
  return { x: table.seatX, z: table.seatZ };
}

function withSeated(...tables) {
  return { tables: TABLES, blockers: tables.map(seatOf) };
}

test('the room boundary is closed on every side', () => {
  assert.equal(canOccupy(0, 5.5, ROOM), true);
  assert.equal(canOccupy(ROOM_BOUNDS.minX - 0.01, 5.5, ROOM), false);
  assert.equal(canOccupy(ROOM_BOUNDS.maxX + 0.01, 5.5, ROOM), false);
  assert.equal(canOccupy(0, ROOM_BOUNDS.minZ - 0.01, ROOM), false);
  assert.equal(canOccupy(0, ROOM_BOUNDS.maxZ + 0.01, ROOM), false);
  // Non-finite input is never walkable rather than silently true.
  assert.equal(canOccupy(Number.NaN, 0, ROOM), false);
  assert.equal(canOccupy(0, Infinity, ROOM), false);
});

test('tables are still impassable, right up to their radius', () => {
  for (const table of TABLES) {
    assert.equal(canOccupy(table.x, table.z, ROOM), false, 'stood on a table top');
    assert.equal(
      canOccupy(table.x + TABLE_RADIUS - EPSILON, table.z, ROOM), false,
      'walked inside the table radius',
    );
    assert.equal(
      canOccupy(table.x + TABLE_RADIUS + EPSILON, table.z, ROOM), true,
      'the table blocks further than its own radius',
    );
  }
});

test('both chairs around every table are solid', () => {
  for (const table of TABLES) {
    for (const chair of chairPositions(table)) {
      assert.equal(canOccupy(chair.x, chair.z, ROOM), false, 'walked through a chair');
      // Just inside each half-extent is blocked; just outside is free.
      assert.equal(canOccupy(chair.x + CHAIR_HALF_WIDTH - EPSILON, chair.z, ROOM), false);
      assert.equal(canOccupy(chair.x, chair.z + CHAIR_HALF_DEPTH - EPSILON, ROOM), false);
    }
  }
});

test('the far-side chair is solid even though nobody ever sits on it', () => {
  const [, farSeat] = chairPositions(TABLES[1]);
  // Far enough from its table that only the chair itself can be blocking here.
  assert.ok(Math.hypot(farSeat.x - TABLES[1].x, farSeat.z - TABLES[1].z) > TABLE_RADIUS);
  assert.equal(canOccupy(farSeat.x, farSeat.z, ROOM), false);
});

test('a chair blocks its own footprint and not a step beyond it', () => {
  const [, farSeat] = chairPositions(TABLES[1]);
  assert.equal(canOccupy(farSeat.x + CHAIR_HALF_WIDTH + EPSILON, farSeat.z, ROOM), true);
  assert.equal(canOccupy(farSeat.x, farSeat.z + CHAIR_HALF_DEPTH + EPSILON, ROOM), true);
});

test('settled customers block the floor; moving ones never do', () => {
  for (const state of ['seated', 'awaiting', 'eating']) {
    assert.equal(blocksMovement(state), true, `${state} should be solid`);
  }
  // A body that is walking, leaving or gone must stay soft: a moving obstacle
  // can pin the player against furniture, and none of these can be talked to.
  for (const state of ['walkingIn', 'leaving', 'delivered', 'left', undefined]) {
    assert.equal(blocksMovement(state), false, `${state} must not be solid`);
  }
});

test('you cannot walk through a customer sitting at their table', () => {
  for (const table of TABLES) {
    assert.equal(canOccupy(table.seatX, table.seatZ, withSeated(table)), false);
  }
});

test('a seated body blocks on its own, wherever it happens to be sitting', () => {
  // At a seat the chair box (0.57 x 0.53) already contains the body circle
  // (0.50), so the chair does the blocking there. The body rule is what makes
  // "a settled customer is solid" true independently of the furniture — this
  // probes it on open floor, where nothing else is in the way.
  const body = { x: 2.0, z: 5.6 };
  assert.equal(canOccupy(body.x, body.z, ROOM), true, 'pick a spot that starts clear');

  const world = { tables: TABLES, blockers: [body] };
  assert.equal(canOccupy(body.x, body.z, world), false);
  assert.equal(canOccupy(body.x + SEATED_CUSTOMER_RADIUS - EPSILON, body.z, world), false);
  assert.equal(canOccupy(body.x, body.z + SEATED_CUSTOMER_RADIUS - EPSILON, world), false);
  // And no further: the body is a modest footprint, not a bubble.
  assert.equal(canOccupy(body.x + SEATED_CUSTOMER_RADIUS + EPSILON, body.z, world), true);
  assert.equal(canOccupy(body.x, body.z + SEATED_CUSTOMER_RADIUS + EPSILON, world), true);
});

test('a body stops blocking the moment the caller drops it from the blockers', () => {
  // This is how a customer standing up to leave frees the floor: index.js
  // rebuilds the blocker list each frame from blocksMovement(state).
  const body = { x: 2.0, z: 5.6 };
  assert.equal(canOccupy(body.x, body.z, { tables: TABLES, blockers: [body] }), false);
  assert.equal(canOccupy(body.x, body.z, { tables: TABLES, blockers: [] }), true);
});

test('an empty chair stays solid after its customer has gone', () => {
  const table = TABLES[3];
  const [seat] = chairPositions(table);
  assert.equal(canOccupy(seat.x, seat.z, { tables: TABLES, blockers: [] }), false,
    'the chair is furniture: it does not vanish with the diner');
});

test('every table keeps a legal spot inside talk range of its customer', () => {
  for (const table of TABLES) {
    const seat = seatOf(table);
    const world = withSeated(table);
    const reachable = [];
    // Sweep the floor on a coarse grid and keep the standable spots in range.
    for (let x = ROOM_BOUNDS.minX; x <= ROOM_BOUNDS.maxX; x += 0.05) {
      for (let z = ROOM_BOUNDS.minZ; z <= ROOM_BOUNDS.maxZ; z += 0.05) {
        if (Math.hypot(x - seat.x, z - seat.z) >= TALK_RADIUS) continue;
        if (canOccupy(x, z, world)) reachable.push({ x, z });
      }
    }
    assert.ok(
      reachable.length > 100,
      `table at ${table.x},${table.z} has only ${reachable.length} legal talk spots`,
    );
    // And from more than one side, so an approach is never single-file.
    assert.ok(reachable.some((spot) => spot.x < seat.x - 0.6));
    assert.ok(reachable.some((spot) => spot.x > seat.x + 0.6));
  }
});

test('the spot click-to-walk aims at is legal at every table', () => {
  // index.js routes a clicked customer to (seatX, seatZ - 1.65).
  for (const table of TABLES) {
    const x = table.seatX;
    const z = table.seatZ - 1.65;
    assert.equal(canOccupy(x, z, withSeated(...TABLES)), true,
      `click-to-walk aims into an obstacle at table ${table.x},${table.z}`);
    assert.ok(Math.hypot(x - table.seatX, z - table.seatZ) < TALK_RADIUS,
      'the click-to-walk spot must land inside talk range');
  }
});

test('the rival approach spot beside each table stays clear', () => {
  // index.js setRivalApproach: (table.x +/- 1.55, table.z).
  for (const table of TABLES) {
    const side = table.x < -0.1 ? 1 : -1;
    assert.equal(canOccupy(table.x + (side * 1.55), table.z, withSeated(...TABLES)), true,
      `the rival would stand inside an obstacle at table ${table.x},${table.z}`);
  }
});

test('the belt front and the player start are never walled off', () => {
  const world = withSeated(...TABLES);
  assert.equal(canOccupy(0, 5.7, world), true, 'the player start must be standable');
  for (let x = -6; x <= 6; x += 0.25) {
    assert.equal(canOccupy(x, -4.4, world), true, `the belt front is blocked at x=${x}`);
  }
});

test('a blocked step slides along the obstacle instead of stopping dead', () => {
  // Walking from open floor straight into table 3's far chair: the step into
  // it is refused, but moving sideways along its face still goes through.
  const [, chair] = chairPositions(TABLES[3]);
  const fromX = chair.x;
  const fromZ = chair.z + CHAIR_HALF_DEPTH + 0.3;
  assert.equal(canOccupy(fromX, fromZ, ROOM), true, 'start clear of everything');

  const moved = resolveMove(fromX, fromZ, fromX + 0.1, chair.z + 0.45, ROOM);
  assert.equal(moved.z, fromZ, 'stepped into the chair');
  assert.equal(moved.x, fromX + 0.1, 'sliding sideways should still be allowed');
  assert.equal(moved.escaping, false);
});

test('a body already inside an obstacle can always walk back out', () => {
  // A customer sitting down on the spot the player occupies would otherwise
  // wall them in on both axes at once.
  const table = TABLES[0];
  const moved = resolveMove(
    table.seatX, table.seatZ, table.seatX, table.seatZ - 0.1, withSeated(table),
  );
  assert.equal(moved.escaping, true);
  assert.deepEqual(
    { x: moved.x, z: moved.z }, { x: table.seatX, z: table.seatZ - 0.1 },
    'a trapped body must be free to move',
  );
});

test('an unobstructed step is taken whole', () => {
  const moved = resolveMove(0, 5.5, 0.2, 5.3, ROOM);
  assert.deepEqual({ x: moved.x, z: moved.z }, { x: 0.2, z: 5.3 });
  assert.equal(moved.escaping, false);
});

test('collision footprints stay modest rather than becoming invisible walls', () => {
  // Guards against quietly widening a footprint to fix a bug elsewhere.
  assert.ok(CHAIR_HALF_WIDTH <= 0.6 && CHAIR_HALF_WIDTH >= 0.45);
  assert.ok(CHAIR_HALF_DEPTH <= 0.6 && CHAIR_HALF_DEPTH >= 0.45);
  assert.ok(SEATED_CUSTOMER_RADIUS <= 0.55 && SEATED_CUSTOMER_RADIUS >= 0.45);
});
