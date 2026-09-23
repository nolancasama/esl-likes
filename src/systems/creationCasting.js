export const EXTRA_CREATION_CHANCE = 0.25;

function randomIndex(length, random) {
  if (length <= 0) return -1;
  return Math.min(length - 1, Math.floor(random() * length));
}

/**
 * Chooses every paper-character slot up front. Guaranteed slots are explicitly
 * reserved inside the early window before any independent chance rolls occur.
 */
export function chooseCreationSlots({
  slots = 0,
  eligibleCount = 0,
  guaranteed = 1,
  earlyWindow = 3,
  extraChance = EXTRA_CREATION_CHANCE,
  random = Math.random,
} = {}) {
  const slotCount = Math.max(0, Math.floor(slots));
  if (eligibleCount <= 0 || slotCount <= 0) return [];

  const earlyCount = Math.min(slotCount, Math.max(0, Math.floor(earlyWindow)));
  const guaranteedCount = Math.min(
    earlyCount,
    Math.max(0, Math.floor(guaranteed)),
  );
  const availableEarly = Array.from({ length: earlyCount }, (_, index) => index);
  const paper = new Set();

  for (let count = 0; count < guaranteedCount; count += 1) {
    const choice = randomIndex(availableEarly.length, random);
    paper.add(availableEarly[choice]);
    availableEarly.splice(choice, 1);
  }

  for (let index = 0; index < slotCount; index += 1) {
    if (!paper.has(index) && random() < extraChance) paper.add(index);
  }

  return [...paper].sort((a, b) => a - b);
}

/**
 * Picks without mutating the records or used set. Unused records come first;
 * when alternatives exist, the immediately previous index is excluded.
 */
export function pickCreation({
  records,
  random = Math.random,
  used = new Set(),
  lastIndex,
} = {}) {
  if (!records?.length) return { record: null, index: -1 };

  const indices = records.map((_, index) => index);
  const repeatSafe = records.length > 1 && Number.isInteger(lastIndex)
    && lastIndex >= 0 && lastIndex < records.length
    ? indices.filter((index) => index !== lastIndex)
    : indices;
  const unused = repeatSafe.filter((index) => !used?.has?.(index));
  const candidates = unused.length ? unused : repeatSafe;
  const index = candidates[randomIndex(candidates.length, random)];

  return { record: records[index], index };
}
