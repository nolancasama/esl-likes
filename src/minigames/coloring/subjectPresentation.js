import { TARGET_HEIGHT } from '../../systems/characters.js';
import { PUPPET_HEIGHT } from './robotPuppet.js';

const RESTAURANT_HUMAN_SCALE = 0.72;
const RESTAURANT_HUMAN_HEIGHT = TARGET_HEIGHT * RESTAURANT_HUMAN_SCALE;

/**
 * Matches a paper subject's authored live height to a seated Restaurant human.
 * The inverse hit-target scale keeps the clickable area at the shipped human
 * size after the paper character's outer scale is applied.
 */
export function restaurantPresentation(liveScale) {
  const scale = RESTAURANT_HUMAN_HEIGHT / (PUPPET_HEIGHT * liveScale);
  const hitTargetScale = RESTAURANT_HUMAN_SCALE / scale;
  return {
    scale,
    groundY: 0,
    seatedY: 0.35,
    bubbleOffsetY: 2.10,
    dialogueOffsetY: 1.65,
    hitTargetY: 1.05 * hitTargetScale,
    hitTargetScale,
  };
}

/** The Zoo stands its visitors at 0.78 scale, slightly off the ground. */
const ZOO_HUMAN_SCALE = 0.78;
const ZOO_HUMAN_HEIGHT = TARGET_HEIGHT * ZOO_HUMAN_SCALE;

/**
 * A paper visitor standing among the Zoo's human ones.
 *
 * Normalised the same way the Restaurant's are: a creation's `liveScale` sets
 * how big it is in the Coloring room, where the sizes are meant to differ, but
 * a visitor waiting to be spoken to should read as one of the crowd rather than
 * loom over it.
 */
export function zooPresentation(liveScale) {
  return {
    scale: ZOO_HUMAN_HEIGHT / (PUPPET_HEIGHT * liveScale),
    groundY: 0.08,
    dialogueOffsetY: 1.9,
  };
}
