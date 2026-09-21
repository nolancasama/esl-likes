/**
 * Does the robot come alive, and how many stars?
 *
 * Pure. This supersedes the pixel-grid correctness in `scoring.js`: with
 * tap-to-fill regions there is nothing to be neat about, so coverage grading
 * and the two-cell neatness margin are gone and correctness is a map lookup.
 * `scoring.js` stays until `index.js` is rewired, then it goes.
 *
 * Only required regions decide activation. A free region can never be wrong —
 * the child's accents are their design, not an answer.
 */

import { FAVORITE_REGIONS, LABEL_REGIONS } from './robotDefinition.js';
import { COMPLETION_THRESHOLD, PALETTE } from './colorState.js';

export const OUTCOMES = Object.freeze({
  FULL: 'full',
  ALMOST: 'almost',
  NOT_READY: 'not-ready',
  INCOMPLETE: 'incomplete',
});

function pick(items, rng) {
  const sample = Number(rng());
  const index = Math.min(items.length - 1, Math.max(0, Math.floor(sample * items.length)));
  return items[index];
}

/**
 * The hidden information for one round.
 *
 * The two labelled colours must differ from each other, or one instruction
 * would be redundant. They are deliberately allowed to equal the favourite:
 * excluding it would leak that the favourite is not that colour, which is
 * exactly the fact the child is supposed to have remembered.
 */
export function pickRound(rng = Math.random) {
  const favourite = pick(PALETTE, rng);
  const starred = pick(FAVORITE_REGIONS, rng).id;

  const labelled = [];
  const used = new Set();
  for (const region of LABEL_REGIONS) {
    let color = pick(PALETTE, rng);
    let guard = 0;
    while (used.has(color) && guard < PALETTE.length * 4) {
      color = pick(PALETTE, rng);
      guard += 1;
    }
    if (used.has(color)) color = PALETTE.find((candidate) => !used.has(candidate)) ?? color;
    used.add(color);
    labelled.push({ regionId: region.id, color });
  }
  return { favourite, starred, labelled };
}

/** What each required region must end up being, as `{ regionId: color }`. */
export function requirementsFor(round) {
  const requirements = { [round.starred]: round.favourite };
  for (const entry of round.labelled) requirements[entry.regionId] = entry.color;
  return requirements;
}

/**
 * Grades an attempt.
 *
 * `INCOMPLETE` is deliberately separate from `ALMOST`: everything required is
 * right, the robot simply wants more decoration. Telling the child "not quite"
 * there would send them hunting for a colour mistake that does not exist.
 */
export function evaluate(round, colors = {}, { completion = 0 } = {}) {
  const starredColor = colors[round.starred] ?? null;
  const favouriteCorrect = starredColor === round.favourite;

  const labelResults = round.labelled.map((entry) => ({
    regionId: entry.regionId,
    expected: entry.color,
    actual: colors[entry.regionId] ?? null,
    correct: (colors[entry.regionId] ?? null) === entry.color,
  }));
  const wrongLabels = labelResults.filter((result) => !result.correct);
  const decoratedEnough = completion >= COMPLETION_THRESHOLD;

  let outcome;
  if (!favouriteCorrect) outcome = OUTCOMES.NOT_READY;
  else if (wrongLabels.length) outcome = OUTCOMES.ALMOST;
  else if (!decoratedEnough) outcome = OUTCOMES.INCOMPLETE;
  else outcome = OUTCOMES.FULL;

  return {
    outcome,
    favouriteCorrect,
    // Never reported to the UI for the starred region — naming the expected
    // colour there would hand over the listening task.
    labelResults,
    wrongLabelIds: wrongLabels.map((result) => result.regionId),
    decoratedEnough,
    completion,
  };
}

/**
 * Stars: required correctness 70%, meaningful completion 20%, memory 10%.
 * Neatness is gone, and free colour choices never move the number.
 */
export function scoreRound(round, colors = {}, { completion = 0, usedListenAgain = false } = {}) {
  const result = evaluate(round, colors, { completion });
  const requiredTotal = 1 + round.labelled.length;
  const requiredCorrect = (result.favouriteCorrect ? 1 : 0)
    + result.labelResults.filter((entry) => entry.correct).length;

  const correctness = requiredCorrect / requiredTotal;
  const completionScore = Math.min(1, completion / COMPLETION_THRESHOLD);
  const memory = usedListenAgain ? 0 : 1;

  const ratio = correctness * 0.7 + completionScore * 0.2 + memory * 0.1;
  const stars = result.outcome === OUTCOMES.FULL
    ? (ratio >= 0.95 ? 3 : ratio >= 0.8 ? 2 : 1)
    : 1;

  return { ...result, ratio, stars, requiredCorrect, requiredTotal, usedListenAgain };
}
