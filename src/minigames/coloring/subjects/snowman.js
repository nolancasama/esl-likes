import { restaurantPresentation, zooPresentation } from '../subjectPresentation.js';

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

const rect = (x, y, width, height, radius = 0.03) => ({ kind: 'rect', x, y, width, height, radius });
const circle = (cx, cy, r) => ({ kind: 'circle', cx, cy, r });
const LIVE_SCALE = 1.08;
const CROSS_GAME_SIZE = 1.25;

const snowman = {
  id: 'snowman', category: 'character', zooSpecies: null,
  crossGame: { restaurantCustomer: true, zooVisitor: true },
  presentation: {
    restaurant: restaurantPresentation(LIVE_SCALE, CROSS_GAME_SIZE),
    zoo: zooPresentation(LIVE_SCALE, CROSS_GAME_SIZE),
  },
  pieces: ['body', 'leftArm', 'rightArm'],
  pivots: { body: { x: 0.5, y: 0.56 }, leftArm: { x: 0.38, y: 0.535 }, rightArm: { x: 0.62, y: 0.535 } },
  parents: { body: null, leftArm: 'body', rightArm: 'body' },
  depth: { leftArm: -0.5, rightArm: -0.5, body: 0 },
  shapes: [
    { id: 'leftArm', piece: 'leftArm', order: 10, shape: rect(0.07, 0.5, 0.35, 0.07, 0.035) },
    { id: 'rightArm', piece: 'rightArm', order: 11, shape: rect(0.58, 0.5, 0.35, 0.07, 0.035) },
    { id: 'bottomSnowball', piece: 'body', order: 20, shape: circle(0.5, 0.67, 0.29) },
    { id: 'head', piece: 'body', order: 21, occludesOutline: true, shape: circle(0.5, 0.28, 0.22) },
  ],
  // The whole face sits in the clear upper half of the head. Two balls put the
  // seam, the scarf and the arms all in one narrow band around y 0.42-0.55, and
  // a mouth anywhere near that reads as a mouth on the snowman's neck.
  details: {
    eyes: [{ cx: 0.44, cy: 0.215, r: 0.024 }, { cx: 0.56, cy: 0.215, r: 0.024 }], pupilRatio: 0.5,
    marks: [
      { type: 'triangle', piece: 'body', points: [{ x: 0.5, y: 0.25 }, { x: 0.65, y: 0.275 }, { x: 0.5, y: 0.3 }], fill: '#e58a1f' },
      { type: 'arc', piece: 'body', cx: 0.5, cy: 0.3, r: 0.058, startAngle: 0.35, endAngle: 2.8 },
      { type: 'line', piece: 'body', x1: 0.32, y1: 0.425, x2: 0.68, y2: 0.425, lineWidth: 1.5 },
      { type: 'line', piece: 'body', x1: 0.33, y1: 0.465, x2: 0.67, y2: 0.465, lineWidth: 1.5 },
      { type: 'circle', piece: 'body', cx: 0.5, cy: 0.63, r: 0.018, fill: true },
      { type: 'circle', piece: 'body', cx: 0.5, cy: 0.73, r: 0.018, fill: true },
      { type: 'circle', piece: 'body', cx: 0.5, cy: 0.83, r: 0.018, fill: true },
    ],
  },
  personality: {
    idle: { root: { sway: 0.045, bob: 0.012, tilt: 0.075, tiltPhase: 0.4, squash: -0.04 }, rotations: { leftArm: { bob: -0.1 }, rightArm: { bob: 0.1 } } },
    startup: { root: { shake: 0.035, shakeFrequency: 20, lift: 0.2, tiltFromShake: 1.2, restSquash: 0.28, bounceSquash: -0.35 }, rotations: { leftArm: { flare: -0.28 }, rightArm: { flare: 0.28 } } },
    hop: { root: { hopHeightScale: 0.48, tilt: 0.18 }, rotations: { leftArm: { lagAir: -0.28 }, rightArm: { lagAir: 0.28 } }, blink: true },
    celebrate: { root: { hopHeightScale: 0.66, tilt: 0.22 }, rotations: { leftArm: { lagAir: -0.5 }, rightArm: { lagAir: 0.5 } }, blink: false },
  },
  liveScale: LIVE_SCALE,
};

export default deepFreeze(snowman);
