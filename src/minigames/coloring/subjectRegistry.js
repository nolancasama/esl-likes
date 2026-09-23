import robot from './subjects/robot.js';
import snowman from './subjects/snowman.js';
import gingerbread from './subjects/gingerbread.js';
import hero from './subjects/hero.js';
import ninja from './subjects/ninja.js';

export const DEFAULT_SUBJECT_ID = 'robot';

export const SUBJECTS = Object.freeze([
  robot,
  snowman,
  gingerbread,
  hero,
  ninja,
]);
export const subjectRegistry = SUBJECTS;

export function subjectById(id) {
  return SUBJECTS.find((subject) => subject.id === id) ?? null;
}

/**
 * Picks a subject without immediately repeating one when alternatives exist.
 * `subjects` is an intentional test seam for proving the multi-subject rule
 * before later slices add their data to the production registry.
 */
export function pickNextSubject({ random = Math.random, lastId = null, subjects = SUBJECTS } = {}) {
  if (!subjects.length) return null;
  const choices = subjects.length > 1
    ? subjects.filter((subject) => subject.id !== lastId)
    : subjects;
  const index = Math.min(choices.length - 1, Math.floor(random() * choices.length));
  return choices[Math.max(0, index)];
}

export default SUBJECTS;
