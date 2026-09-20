// Solid geometry of the dining room (DESIGN_DECISIONS 2026-09-20 "the room is
// solid"). Pure: no scene, no DOM, no three.js. index.js builds the chair
// meshes from `chairPositions` so the collision boxes can never drift apart
// from the chairs the child can actually see.

/**
 * The dining room's tables. `x`/`z` is the table top; `seatX`/`seatZ` is where
 * its one customer sits, one chair-depth in front of it. All five are built
 * whatever the active table count, so all five are always solid.
 */
export const TABLES = Object.freeze([
  Object.freeze({ x: -4.2, z: -1.0, seatX: -4.2, seatZ: -2.05 }),
  Object.freeze({ x: 0, z: 1.8, seatX: 0, seatZ: 0.75 }),
  Object.freeze({ x: 4.2, z: -1.0, seatX: 4.2, seatZ: -2.05 }),
  Object.freeze({ x: -4.2, z: 3.9, seatX: -4.2, seatZ: 2.85 }),
  Object.freeze({ x: 4.2, z: 3.9, seatX: 4.2, seatZ: 2.85 }),
]);

/**
 * How close the player must be to talk. It lives here because it is one half
 * of a single invariant: the footprints below must never grow past the point
 * where a child can still stand somewhere legal and be heard.
 */
export const TALK_RADIUS = 2.7;

/** Walkable floor. The belt front sits just inside `minZ`. */
export const ROOM_BOUNDS = Object.freeze({
  minX: -6.25, maxX: 6.25, minZ: -4.45, maxZ: 6.65,
});

// Every footprint below carries this much padding for the player's own body.
// The table already did: its top is radius 1.0 and it blocks at 1.12.
const BODY_PADDING = 0.12;

export const TABLE_RADIUS = 1.12;

// The chair mesh is 0.9 x 0.82, so 0.45 x 0.41 before padding. Deliberately
// the visible size and no more — an oversized invisible barrier around four
// chairs would close the aisles the child walks down.
export const CHAIR_HALF_WIDTH = 0.45 + BODY_PADDING;
export const CHAIR_HALF_DEPTH = 0.41 + BODY_PADDING;

/** Around the seated body, not the whole chair-and-table group. */
export const SEATED_CUSTOMER_RADIUS = 0.38 + BODY_PADDING;

/**
 * Customers block movement only while they are settled at a table. A customer
 * walking in or walking out is soft: a moving body that blocks the player can
 * trap them against furniture, and neither of those states can be talked to
 * anyway.
 */
export const SOLID_CUSTOMER_STATES = Object.freeze(['seated', 'awaiting', 'eating']);

export function blocksMovement(state) {
  return SOLID_CUSTOMER_STATES.includes(state);
}

/**
 * The two chairs around one table: the one its customer sits on, and the empty
 * far-side one. Returned in the order index.js adds the meshes.
 */
export function chairPositions(table) {
  return [
    { x: table.seatX, z: table.seatZ },
    { x: table.x, z: table.z + 1.25 },
  ];
}

function insideBounds(x, z) {
  return x >= ROOM_BOUNDS.minX && x <= ROOM_BOUNDS.maxX
    && z >= ROOM_BOUNDS.minZ && z <= ROOM_BOUNDS.maxZ;
}

function insideCircle(x, z, centre, radius) {
  const dx = x - centre.x;
  const dz = z - centre.z;
  return (dx * dx) + (dz * dz) < radius * radius;
}

function insideChair(x, z, chair) {
  return Math.abs(x - chair.x) < CHAIR_HALF_WIDTH
    && Math.abs(z - chair.z) < CHAIR_HALF_DEPTH;
}

/**
 * Can a body stand at (x, z)?
 *
 * `tables` are the room's tables (`{ x, z, seatX, seatZ }`); each contributes
 * its top and its two chairs. `blockers` are the seated bodies, already
 * filtered by the caller to those `blocksMovement` accepts.
 */
export function canOccupy(x, z, { tables = [], blockers = [] } = {}) {
  if (!Number.isFinite(x) || !Number.isFinite(z) || !insideBounds(x, z)) return false;
  for (const table of tables) {
    if (insideCircle(x, z, table, TABLE_RADIUS)) return false;
    for (const chair of chairPositions(table)) {
      if (insideChair(x, z, chair)) return false;
    }
  }
  for (const blocker of blockers) {
    if (insideCircle(x, z, blocker, SEATED_CUSTOMER_RADIUS)) return false;
  }
  return true;
}

/**
 * One movement step, shared by walking and click-to-walk so both obey exactly
 * the same obstacles. Axis-separated, so a body slides along a chair instead of
 * stopping dead against it.
 *
 * The escape hatch matters: a customer can sit down on the spot the player is
 * standing on, which would otherwise wall them in on both axes at once. A body
 * that is already inside an obstacle may move freely until it is clear.
 */
export function resolveMove(fromX, fromZ, toX, toZ, world = {}) {
  if (!canOccupy(fromX, fromZ, world)) return { x: toX, z: toZ, escaping: true };
  const x = canOccupy(toX, fromZ, world) ? toX : fromX;
  const z = canOccupy(x, toZ, world) ? toZ : fromZ;
  return { x, z, escaping: false };
}
