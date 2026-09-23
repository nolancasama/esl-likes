function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

const rect = (x, y, width, height, radius = 0.03) => ({ kind: 'rect', x, y, width, height, radius });
const circle = (cx, cy, r) => ({ kind: 'circle', cx, cy, r });

const ninja = {
  id: 'ninja', category: 'character', zooSpecies: null,
  pieces: ['body', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg'],
  pivots: { body: { x: 0.5, y: 0.5 }, leftArm: { x: 0.34, y: 0.39 }, rightArm: { x: 0.66, y: 0.39 }, leftLeg: { x: 0.42, y: 0.68 }, rightLeg: { x: 0.58, y: 0.68 } },
  parents: { body: null, leftArm: 'body', rightArm: 'body', leftLeg: 'body', rightLeg: 'body' },
  depth: { leftArm: -0.5, rightArm: -0.5, leftLeg: -0.7, rightLeg: -0.7, body: 0 },
  shapes: [
    { id: 'leftArm', piece: 'leftArm', order: 10, shape: rect(0.16, 0.35, 0.24, 0.35, 0.1) },
    { id: 'rightArm', piece: 'rightArm', order: 11, shape: rect(0.6, 0.35, 0.24, 0.35, 0.1) },
    { id: 'leftLeg', piece: 'leftLeg', order: 12, shape: rect(0.33, 0.65, 0.17, 0.3, 0.075) },
    { id: 'rightLeg', piece: 'rightLeg', order: 13, shape: rect(0.5, 0.65, 0.17, 0.3, 0.075) },
    { id: 'torso', piece: 'body', order: 20, shape: rect(0.31, 0.3, 0.38, 0.46, 0.12) },
    { id: 'hood', piece: 'body', order: 21, shape: circle(0.5, 0.2, 0.17) },
  ],
  details: {
    eyes: [{ cx: 0.445, cy: 0.19, r: 0.024 }, { cx: 0.555, cy: 0.19, r: 0.024 }], pupilRatio: 0.52,
    marks: [
      { type: 'line', piece: 'body', x1: 0.36, y1: 0.14, x2: 0.64, y2: 0.14, lineWidth: 1.5 },
      { type: 'line', piece: 'body', x1: 0.34, y1: 0.24, x2: 0.66, y2: 0.24, lineWidth: 1.5 },
      { type: 'line', piece: 'body', x1: 0.33, y1: 0.58, x2: 0.67, y2: 0.58, lineWidth: 1.6 },
      { type: 'line', piece: 'body', x1: 0.37, y1: 0.4, x2: 0.63, y2: 0.57, lineWidth: 1.5 },
      { type: 'line', piece: 'leftArm', x1: 0.18, y1: 0.59, x2: 0.37, y2: 0.59 },
      { type: 'line', piece: 'rightArm', x1: 0.63, y1: 0.59, x2: 0.82, y2: 0.59 },
      { type: 'line', piece: 'leftLeg', x1: 0.35, y1: 0.85, x2: 0.48, y2: 0.85 },
      { type: 'line', piece: 'rightLeg', x1: 0.52, y1: 0.85, x2: 0.65, y2: 0.85 },
    ],
  },
  personality: {
    idle: { root: { sway: 0.02, bob: 0.012, tilt: 0.025, tiltPhase: 1, squash: 0.03 }, rotations: { leftArm: { base: -0.07, bob: -0.04 }, rightArm: { base: 0.07, bob: 0.04 } } },
    startup: { root: { shake: 0.028, shakeFrequency: 36, lift: 0.2, tiltFromShake: 0.55, restSquash: 0.16, bounceSquash: -0.28 }, rotations: { leftArm: { flare: -0.48 }, rightArm: { flare: 0.48 }, leftLeg: { bounce: -0.08 }, rightLeg: { bounce: 0.08 } } },
    hop: { root: { hopHeightScale: 0.72, tilt: 0.1 }, rotations: { leftArm: { base: -0.12, lagAir: -0.42 }, rightArm: { base: 0.12, lagAir: 0.42 }, leftLeg: { air: -0.13 }, rightLeg: { air: 0.13 } }, blink: true },
    celebrate: { root: { hopHeightScale: 0.88, tilt: 0.12 }, rotations: { leftArm: { lagAir: -0.7 }, rightArm: { lagAir: 0.7 }, leftLeg: { air: -0.18 }, rightLeg: { air: 0.18 } }, blink: false },
  },
  liveScale: 1,
};

export default deepFreeze(ninja);
