import { restaurantPresentation, zooPresentation } from '../subjectPresentation.js';

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

const rect = (x, y, width, height, radius = 0.03) => ({ kind: 'rect', x, y, width, height, radius });
const circle = (cx, cy, r) => ({ kind: 'circle', cx, cy, r });
const LIVE_SCALE = 1;

const hero = {
  id: 'hero', category: 'character', zooSpecies: null,
  crossGame: { restaurantCustomer: true, zooVisitor: true },
  presentation: {
    restaurant: restaurantPresentation(LIVE_SCALE),
    zoo: zooPresentation(LIVE_SCALE),
  },
  pieces: ['body', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg', 'cape'],
  pivots: { body: { x: 0.5, y: 0.5 }, leftArm: { x: 0.34, y: 0.38 }, rightArm: { x: 0.66, y: 0.38 }, leftLeg: { x: 0.42, y: 0.68 }, rightLeg: { x: 0.58, y: 0.68 }, cape: { x: 0.5, y: 0.32 } },
  parents: { body: null, leftArm: 'body', rightArm: 'body', leftLeg: 'body', rightLeg: 'body', cape: 'body' },
  depth: { cape: -1, leftArm: -0.5, rightArm: -0.5, leftLeg: -0.7, rightLeg: -0.7, body: 0 },
  shapes: [
    { id: 'cape', piece: 'cape', order: 1, shape: rect(0.27, 0.27, 0.46, 0.61, 0.14) },
    { id: 'leftArm', piece: 'leftArm', order: 10, shape: rect(0.17, 0.34, 0.23, 0.34, 0.1) },
    { id: 'rightArm', piece: 'rightArm', order: 11, shape: rect(0.6, 0.34, 0.23, 0.34, 0.1) },
    { id: 'leftLeg', piece: 'leftLeg', order: 12, shape: rect(0.34, 0.65, 0.16, 0.3, 0.07) },
    { id: 'rightLeg', piece: 'rightLeg', order: 13, shape: rect(0.5, 0.65, 0.16, 0.3, 0.07) },
    { id: 'torso', piece: 'body', order: 20, shape: rect(0.32, 0.29, 0.36, 0.46, 0.11) },
    { id: 'head', piece: 'body', order: 21, occludesOutline: true, shape: circle(0.5, 0.18, 0.15) },
  ],
  details: {
    eyes: [{ cx: 0.445, cy: 0.17, r: 0.024 }, { cx: 0.555, cy: 0.17, r: 0.024 }], pupilRatio: 0.46,
    marks: [
      { type: 'arc', piece: 'body', cx: 0.5, cy: 0.21, r: 0.065, startAngle: 0.25, endAngle: 2.9 },
      { type: 'polygon', piece: 'body', points: [{ x: 0.5, y: 0.39 }, { x: 0.525, y: 0.445 }, { x: 0.585, y: 0.45 }, { x: 0.54, y: 0.49 }, { x: 0.555, y: 0.55 }, { x: 0.5, y: 0.515 }, { x: 0.445, y: 0.55 }, { x: 0.46, y: 0.49 }, { x: 0.415, y: 0.45 }, { x: 0.475, y: 0.445 }], fill: '#f0c62e' },
      { type: 'line', piece: 'body', x1: 0.33, y1: 0.62, x2: 0.67, y2: 0.62, lineWidth: 1.5 },
      { type: 'line', piece: 'leftArm', x1: 0.19, y1: 0.58, x2: 0.37, y2: 0.58 },
      { type: 'line', piece: 'rightArm', x1: 0.63, y1: 0.58, x2: 0.81, y2: 0.58 },
    ],
  },
  personality: {
    idle: { root: { sway: 0.025, bob: 0.018, tilt: 0.03, tiltPhase: 0.5, squash: -0.035 }, rotations: { leftArm: { base: -0.14, bob: -0.04 }, rightArm: { base: 0.14, bob: 0.04 }, cape: { bob: -0.035, frequency: 0.7 } } },
    startup: { root: { shake: 0.025, shakeFrequency: 25, lift: 0.28, tiltFromShake: 0.6, restSquash: 0.22, bounceSquash: -0.42 }, rotations: { leftArm: { base: -0.12, flare: -0.65 }, rightArm: { base: 0.12, flare: 0.65 }, cape: { bounce: -0.15 } } },
    hop: { root: { hopHeightScale: 0.95, tilt: 0.14 }, rotations: { leftArm: { base: -0.22, lagAir: -0.62 }, rightArm: { base: 0.22, lagAir: 0.62 }, leftLeg: { air: -0.16 }, rightLeg: { air: 0.16 }, cape: { base: -0.04, lagAir: -0.42 } }, blink: true },
    celebrate: { root: { hopHeightScale: 1.08, tilt: 0.1 }, rotations: { leftArm: { lagAir: -0.95 }, rightArm: { lagAir: 0.95 }, leftLeg: { air: -0.2 }, rightLeg: { air: 0.2 }, cape: { lagAir: -0.55 } }, blink: false },
  },
  liveScale: LIVE_SCALE,
};

export default deepFreeze(hero);
