export const EXTRA_ROBOT_CHANCE = 0.25;

function randomIndex(length, random) {
  if (length <= 0) return -1;
  return Math.min(length - 1, Math.floor(random() * length));
}

/** Reserve one of the first three arrivals when saved robot artwork exists. */
export function chooseGuaranteedRobotSlot({
  savedCount = 0,
  shiftLength = 0,
  random = Math.random,
} = {}) {
  if (savedCount <= 0) return null;

  const earlyArrivalCount = Math.min(3, Math.max(0, Math.floor(shiftLength)));
  const index = randomIndex(earlyArrivalCount, random);
  return index < 0 ? null : index;
}

/** Decide whether an arrival uses a saved robot character. */
export function isRobotSlot({
  index,
  guaranteedSlot,
  savedCount = 0,
  random = Math.random,
  extraChance = EXTRA_ROBOT_CHANCE,
} = {}) {
  if (savedCount <= 0) return false;
  if (Number.isInteger(guaranteedSlot) && index === guaranteedSlot) return true;
  return random() < extraChance;
}

/** Pick saved artwork without consuming it or repeating the previous robot. */
export function pickRobotRecord({ records, random = Math.random, lastIndex } = {}) {
  if (!records?.length) return { record: null, index: -1 };

  let index;
  if (records.length === 1) {
    index = 0;
  } else if (Number.isInteger(lastIndex) && lastIndex >= 0 && lastIndex < records.length) {
    index = randomIndex(records.length - 1, random);
    if (index >= lastIndex) index += 1;
  } else {
    index = randomIndex(records.length, random);
  }

  return { record: records[index], index };
}
