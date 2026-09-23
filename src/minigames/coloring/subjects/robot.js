function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

const rect = (x, y, width, height, radius = 0.03) => (
  { kind: 'rect', x, y, width, height, radius }
);
const circle = (cx, cy, r) => ({ kind: 'circle', cx, cy, r });

const robot = {
  id: 'robot',
  category: 'character',
  zooSpecies: null,
  pieces: ['body', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg'],
  pivots: {
    body: { x: 0.5, y: 0.5 },
    leftArm: { x: 0.2125, y: 0.45 },
    rightArm: { x: 0.7875, y: 0.45 },
    leftLeg: { x: 0.4, y: 0.765 },
    rightLeg: { x: 0.6, y: 0.765 },
  },
  parents: {
    body: null,
    leftArm: 'body',
    rightArm: 'body',
    leftLeg: 'body',
    rightLeg: 'body',
  },
  depth: {
    leftArm: -0.5,
    rightArm: -0.5,
    leftLeg: -0.7,
    rightLeg: -0.7,
    body: 0,
  },
  shapes: [
    { id: 'leftArm', piece: 'leftArm', order: 10, shape: rect(0.125, 0.425, 0.175, 0.285, 0.05) },
    { id: 'rightArm', piece: 'rightArm', order: 11, shape: rect(0.7, 0.425, 0.175, 0.285, 0.05) },
    { id: 'leftLeg', piece: 'leftLeg', order: 12, shape: rect(0.335, 0.75, 0.13, 0.155, 0.04) },
    { id: 'rightLeg', piece: 'rightLeg', order: 13, shape: rect(0.535, 0.75, 0.13, 0.155, 0.04) },
    { id: 'leftFoot', piece: 'leftLeg', order: 14, shape: rect(0.305, 0.885, 0.185, 0.062, 0.03) },
    { id: 'rightFoot', piece: 'rightLeg', order: 15, shape: rect(0.51, 0.885, 0.185, 0.062, 0.03) },
    { id: 'antennaBall', piece: 'body', order: 20, shape: circle(0.5, 0.065, 0.036) },
    { id: 'antennaStalk', piece: 'body', order: 21, shape: rect(0.484, 0.09, 0.032, 0.075, 0.012) },
    { id: 'neck', piece: 'body', order: 22, shape: rect(0.435, 0.345, 0.13, 0.055, 0.012) },
    { id: 'head', piece: 'body', order: 23, shape: rect(0.285, 0.155, 0.43, 0.205, 0.062) },
    { id: 'torso', piece: 'body', order: 24, shape: rect(0.285, 0.385, 0.43, 0.395, 0.055) },
  ],
  details: {
    eyes: [
      { cx: 0.415, cy: 0.25, r: 0.032 },
      { cx: 0.585, cy: 0.25, r: 0.032 },
    ],
    pupilRatio: 0.46,
    marks: [
      { type: 'line', piece: 'body', x1: 0.452, y1: 0.305, x2: 0.548, y2: 0.305, lineWidth: 1.3 },
      { type: 'circle', piece: 'body', cx: 0.44, cy: 0.6, r: 0.018 },
      { type: 'circle', piece: 'body', cx: 0.5, cy: 0.6, r: 0.018 },
      { type: 'circle', piece: 'body', cx: 0.56, cy: 0.6, r: 0.018 },
      { type: 'line', piece: 'leftArm', x1: 0.133, y1: 0.632, x2: 0.292, y2: 0.632 },
      { type: 'line', piece: 'rightArm', x1: 0.708, y1: 0.632, x2: 0.867, y2: 0.632 },
      { type: 'line', piece: 'leftLeg', x1: 0.343, y1: 0.832, x2: 0.457, y2: 0.832 },
      { type: 'line', piece: 'rightLeg', x1: 0.543, y1: 0.832, x2: 0.657, y2: 0.832 },
    ],
  },
  personality: {
    idle: {
      root: { sway: 0.06, bob: 0.018, tilt: 0.035, tiltPhase: 0.6, squash: -0.06 },
      rotations: {
        leftArm: { base: -0.08, bob: -0.05, phase: 0 },
        rightArm: { base: 0.08, bob: 0.05, phase: 0 },
        leftLeg: { bob: -0.015, phase: 0 },
        rightLeg: { bob: 0.015, phase: 0 },
      },
    },
    startup: {
      root: { shake: 0.055, shakeFrequency: 34, lift: 0.3, tiltFromShake: 0.8, restSquash: 0.35, bounceSquash: -0.55 },
      rotations: {
        leftArm: { base: -0.1, flare: -1.05 },
        rightArm: { base: 0.1, flare: 1.05 },
        leftLeg: { bounce: -0.12 },
        rightLeg: { bounce: 0.12 },
      },
      glow: 1,
    },
    hop: {
      root: { hopHeightScale: 1, tilt: 0.24 },
      rotations: {
        leftArm: { base: -0.18, lagAir: -0.95 },
        rightArm: { base: 0.18, lagAir: 0.95 },
        leftLeg: { air: -0.22 },
        rightLeg: { air: 0.22 },
      },
      blink: true,
      glow: 0.25,
    },
    celebrate: {
      root: { hopHeightScale: 1, tilt: 0.24, tiltScale: 0.4 },
      rotations: {
        leftArm: { base: -0.18, lagAir: -0.95 },
        rightArm: { base: 0.18, lagAir: 0.95 },
        leftLeg: { air: -0.22 },
        rightLeg: { air: 0.22 },
      },
      rotationScale: 1.45,
      blink: false,
      glow: 0.6,
    },
    glow: { piece: 'body', cx: 0.5, cy: 0.065, r: 0.036 },
  },
  liveScale: 1,
};

export default deepFreeze(robot);
