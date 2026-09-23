import { restaurantPresentation, zooPresentation } from '../subjectPresentation.js';

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

const rect = (x, y, width, height, radius = 0.03) => ({ kind: 'rect', x, y, width, height, radius });
const circle = (cx, cy, r) => ({ kind: 'circle', cx, cy, r });
const LIVE_SCALE = 1.08;

const snowman = {
  id: 'snowman', category: 'character', zooSpecies: null,
  crossGame: { restaurantCustomer: true, zooVisitor: true },
  presentation: {
    restaurant: restaurantPresentation(LIVE_SCALE),
    zoo: zooPresentation(LIVE_SCALE),
  },
  pieces: ['body', 'leftArm', 'rightArm'],
  pivots: { body: { x: 0.5, y: 0.55 }, leftArm: { x: 0.31, y: 0.43 }, rightArm: { x: 0.69, y: 0.43 } },
  parents: { body: null, leftArm: 'body', rightArm: 'body' },
  depth: { leftArm: -0.5, rightArm: -0.5, body: 0 },
  shapes: [
    { id: 'leftArm', piece: 'leftArm', order: 10, shape: rect(0.1, 0.39, 0.27, 0.08, 0.04) },
    { id: 'rightArm', piece: 'rightArm', order: 11, shape: rect(0.63, 0.39, 0.27, 0.08, 0.04) },
    { id: 'bottomSnowball', piece: 'body', order: 20, shape: circle(0.5, 0.69, 0.26) },
    { id: 'middleSnowball', piece: 'body', order: 21, shape: circle(0.5, 0.43, 0.22) },
    { id: 'head', piece: 'body', order: 22, shape: circle(0.5, 0.19, 0.17) },
  ],
  details: {
    eyes: [{ cx: 0.445, cy: 0.17, r: 0.024 }, { cx: 0.555, cy: 0.17, r: 0.024 }], pupilRatio: 0.5,
    marks: [
      { type: 'triangle', piece: 'body', points: [{ x: 0.49, y: 0.22 }, { x: 0.64, y: 0.25 }, { x: 0.49, y: 0.27 }], fill: '#e58a1f' },
      { type: 'arc', piece: 'body', cx: 0.5, cy: 0.26, r: 0.07, startAngle: 0.35, endAngle: 2.8 },
      { type: 'line', piece: 'body', x1: 0.34, y1: 0.34, x2: 0.66, y2: 0.34, lineWidth: 1.5 },
      { type: 'line', piece: 'body', x1: 0.35, y1: 0.38, x2: 0.64, y2: 0.38, lineWidth: 1.5 },
      { type: 'circle', piece: 'body', cx: 0.5, cy: 0.48, r: 0.018, fill: true },
      { type: 'circle', piece: 'body', cx: 0.5, cy: 0.57, r: 0.018, fill: true },
      { type: 'circle', piece: 'body', cx: 0.5, cy: 0.68, r: 0.018, fill: true },
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
