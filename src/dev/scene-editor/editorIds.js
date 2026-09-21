/**
 * Stable identity for placed objects.
 *
 * An editor id is `${assetId}-${n}`, zero-padded to three digits, with `n` the
 * lowest integer not already taken by that asset. Identity is this string and
 * never an array index: deleting the fourth tree must not rename the fifth, or
 * every id in an exported layout would shift and the diff would be unreadable.
 *
 * Pure — no three.js, no DOM.
 */

const PAD = 3;
const SUFFIX = /-(\d+)$/;

export function formatId(assetId, index) {
  return `${assetId}-${String(index).padStart(PAD, '0')}`;
}

/** The numeric suffix of an id belonging to `assetId`, or null. */
export function indexOfId(id, assetId) {
  if (typeof id !== 'string' || !id.startsWith(`${assetId}-`)) return null;
  const match = SUFFIX.exec(id);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isInteger(value) && value >= 0 ? value : null;
}

/**
 * Allocates the lowest free id for `assetId`, given the ids already in use.
 * `taken` is anything iterable of strings (a Set, a Map's keys, an array).
 */
export function nextId(assetId, taken) {
  const used = new Set();
  for (const id of taken ?? []) {
    const index = indexOfId(id, assetId);
    if (index !== null) used.add(index);
  }
  let index = 1;
  while (used.has(index)) index += 1;
  return formatId(assetId, index);
}

/**
 * Keeps an id unique inside `taken` without renumbering it: used when loading a
 * layout that already carries ids. A collision gets a fresh number rather than
 * silently overwriting the object that was there first.
 */
export function ensureUniqueId(preferredId, assetId, taken) {
  const used = taken instanceof Set ? taken : new Set(taken ?? []);
  if (typeof preferredId === 'string' && preferredId && !used.has(preferredId)) return preferredId;
  return nextId(assetId, used);
}
