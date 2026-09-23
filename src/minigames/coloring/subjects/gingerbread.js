function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

const rect = (x, y, width, height, radius = 0.03) => ({ kind: 'rect', x, y, width, height, radius });
const circle = (cx, cy, r) => ({ kind: 'circle', cx, cy, r });

const gingerbread = {
  id: 'gingerbread', category: 'character', zooSpecies: null,
  pieces: ['body', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg'],
  pivots: { body: { x: 0.5, y: 0.5 }, leftArm: { x: 0.34, y: 0.4 }, rightArm: { x: 0.66, y: 0.4 }, leftLeg: { x: 0.42, y: 0.67 }, rightLeg: { x: 0.58, y: 0.67 } },
  parents: { body: null, leftArm: 'body', rightArm: 'body', leftLeg: 'body', rightLeg: 'body' },
  depth: { leftArm: -0.5, rightArm: -0.5, leftLeg: -0.7, rightLeg: -0.7, body: 0 },
  shapes: [
    { id: 'leftArm', piece: 'leftArm', order: 10, shape: rect(0.13, 0.36, 0.27, 0.14, 0.07) },
    { id: 'rightArm', piece: 'rightArm', order: 11, shape: rect(0.6, 0.36, 0.27, 0.14, 0.07) },
    { id: 'leftLeg', piece: 'leftLeg', order: 12, shape: rect(0.32, 0.64, 0.18, 0.31, 0.09) },
    { id: 'rightLeg', piece: 'rightLeg', order: 13, shape: rect(0.5, 0.64, 0.18, 0.31, 0.09) },
    { id: 'torso', piece: 'body', order: 20, shape: rect(0.31, 0.31, 0.38, 0.43, 0.15) },
    { id: 'head', piece: 'body', order: 21, shape: circle(0.5, 0.2, 0.18) },
  ],
  details: {
    eyes: [{ cx: 0.44, cy: 0.17, r: 0.025 }, { cx: 0.56, cy: 0.17, r: 0.025 }], pupilRatio: 0.5,
    marks: [
      { type: 'arc', piece: 'body', cx: 0.5, cy: 0.22, r: 0.08, startAngle: 0.25, endAngle: 2.9 },
      { type: 'circle', piece: 'body', cx: 0.5, cy: 0.45, r: 0.02, fill: true },
      { type: 'circle', piece: 'body', cx: 0.5, cy: 0.56, r: 0.02, fill: true },
      { type: 'arc', piece: 'leftArm', cx: 0.24, cy: 0.43, r: 0.055, startAngle: 0, endAngle: Math.PI },
      { type: 'arc', piece: 'rightArm', cx: 0.76, cy: 0.43, r: 0.055, startAngle: 0, endAngle: Math.PI },
      { type: 'arc', piece: 'leftLeg', cx: 0.41, cy: 0.82, r: 0.055, startAngle: 0, endAngle: Math.PI },
      { type: 'arc', piece: 'rightLeg', cx: 0.59, cy: 0.82, r: 0.055, startAngle: 0, endAngle: Math.PI },
    ],
  },
  personality: {
    idle: { root: { sway: 0.04, bob: 0.025, tilt: 0.045, tiltPhase: 0.6, squash: -0.06 }, rotations: { leftArm: { bob: -0.09 }, rightArm: { bob: 0.09 } } },
    startup: { root: { shake: 0.04, shakeFrequency: 28, lift: 0.36, tiltFromShake: 0.8, restSquash: 0.3, bounceSquash: -0.52 }, rotations: { leftArm: { flare: -0.9 }, rightArm: { flare: 0.9 }, leftLeg: { bounce: -0.12 }, rightLeg: { bounce: 0.12 } } },
    hop: { root: { hopHeightScale: 1.22, tilt: 0.2 }, rotations: { leftArm: { lagAir: -0.82 }, rightArm: { lagAir: 0.82 }, leftLeg: { air: -0.22 }, rightLeg: { air: 0.22 } }, blink: true },
    celebrate: { root: { hopHeightScale: 1.35, tilt: 0.18 }, rotations: { leftArm: { lagAir: -1.05 }, rightArm: { lagAir: 1.05 }, leftLeg: { air: -0.28 }, rightLeg: { air: 0.28 } }, rotationScale: 1.12, blink: false },
  },
  liveScale: 1,
};

export default deepFreeze(gingerbread);
