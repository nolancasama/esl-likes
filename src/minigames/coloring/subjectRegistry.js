import robot from './subjects/robot.js';
import snowman from './subjects/snowman.js';
import gingerbread from './subjects/gingerbread.js';
import hero from './subjects/hero.js';
import ninja from './subjects/ninja.js';

export const DEFAULT_SUBJECT_ID = 'robot';

export const DEFAULT_MOTION_PROFILE = Object.freeze({
  speed: 1,
  idleMin: 1.1,
  idleMax: 2.3,
});

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

/** Roaming personality is optional so old and future subjects stay playable. */
export function motionProfileFor(subjectOrId) {
  const subject = typeof subjectOrId === 'string' ? subjectById(subjectOrId) : subjectOrId;
  return subject?.motionProfile ?? DEFAULT_MOTION_PROFILE;
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
