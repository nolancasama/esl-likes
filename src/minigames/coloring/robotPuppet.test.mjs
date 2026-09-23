import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DURATIONS,
  HOP_DISTANCE,
  HOP_STAGES,
  OBSTACLES,
  ROAM_POINTS,
  SAFE_AREA,
  SQUASH_LIMIT,
  STATES,
  blinkAt,
  createRoamPlan,
  hopPhase,
  hopProgress,
  insideSafeArea,
  pieceLayout as subjectPieceLayout,
  poseFor as subjectPoseFor,
  poseRotationKeys as subjectPoseRotationKeys,
  squashStretch,
  stepRoam,
} from './robotPuppet.js';
import { pieceBounds as subjectPieceBounds } from './robotDefinition.js';
import robot from './subjects/robot.js';

const { depth: PIECE_DEPTH, parents: PIECE_PARENTS, pieces: PIECES, pivots: PIVOTS } = robot;
const pieceBounds = (piece) => subjectPieceBounds(robot, piece);
const pieceLayout = (piece) => subjectPieceLayout(robot, piece);
const poseFor = (state, time) => subjectPoseFor(robot, state, time);
const poseRotationKeys = () => subjectPoseRotationKeys(robot);
const PIECE_LAYOUTS = Object.freeze(PIECES.map(pieceLayout));

const samples = (count = 400) => Array.from({ length: count }, (_, i) => i / count);

// --- squash and stretch ----------------------------------------------------

test('squash/stretch never leaves the safe band on either axis', () => {
  // Deliberately fed values well outside the range the poses produce.
  for (let amount = -4; amount <= 4; amount += 0.01) {
    const { x, y } = squashStretch(amount);
    assert.ok(x >= 1 - SQUASH_LIMIT - 1e-9 && x <= 1 + SQUASH_LIMIT + 1e-9, `x=${x} at ${amount}`);
    assert.ok(y >= 1 - SQUASH_LIMIT - 1e-9 && y <= 1 + SQUASH_LIMIT + 1e-9, `y=${y} at ${amount}`);
  }
});

test('squash/stretch is paper flexing, not rubber: apparent area barely moves', () => {
  for (let amount = -1; amount <= 1; amount += 0.02) {
    const { x, y } = squashStretch(amount);
    const area = x * y;
    // The spec allows a fifth. Partial compensation keeps it far inside that.
    assert.ok(Math.abs(area - 1) < 0.2, `area ${area.toFixed(3)} at ${amount.toFixed(2)}`);
  }
});

test('positive squashes and negative stretches, and zero is neutral', () => {
  assert.deepEqual(squashStretch(0), { x: 1, y: 1 });
  const squashed = squashStretch(0.8);
  assert.ok(squashed.y < 1 && squashed.x > 1, 'a squash must be shorter and wider');
  const stretched = squashStretch(-0.8);
  assert.ok(stretched.y > 1 && stretched.x < 1, 'a stretch must be taller and narrower');
});

// --- the hop ---------------------------------------------------------------

test('a hop passes through crouch, air, land and recover, in that order', () => {
  const seen = [];
  for (const t of samples()) {
    const { stage } = hopPhase(t);
    if (seen[seen.length - 1] !== stage) seen.push(stage);
  }
  assert.deepEqual(seen, ['crouch', 'launch', 'air', 'land', 'recover']);
});

test('a hop returns to the ground, so repeating it never drifts upward', () => {
  assert.ok(Math.abs(hopPhase(0).height) < 1e-9);
  assert.ok(Math.abs(hopPhase(0.99999).height) < 1e-3);
  // And the cycle is periodic, so hop five hundred and it is still on the floor.
  for (const cycles of [1, 2, 7, 500]) {
    assert.ok(Math.abs(hopPhase(cycles).height) < 1e-9, `after ${cycles} hops`);
  }
});

test('the puppet actually leaves the ground, and crouches before it does', () => {
  const heights = samples().map((t) => hopPhase(t).height);
  assert.ok(Math.max(...heights) > 0.4, 'the apex is too low to read as a hop');
  assert.ok(Math.min(...heights) < -0.03, 'there is no crouch');
  // The crouch has to come before the apex, or it is a landing, not a launch.
  const apexAt = heights.indexOf(Math.max(...heights));
  const dipAt = heights.indexOf(Math.min(...heights));
  assert.ok(dipAt < apexAt, 'the dip must precede the apex');
});

test('height and squash are continuous across every stage boundary', () => {
  const edge = 1e-5;
  for (const boundary of Object.values(HOP_STAGES)) {
    const before = hopPhase(boundary - edge);
    const after = hopPhase(boundary + edge);
    assert.ok(Math.abs(before.height - after.height) < 1e-3,
      `height jumps at ${boundary}: ${before.height} -> ${after.height}`);
    assert.ok(Math.abs(before.squash - after.squash) < 1e-3,
      `squash jumps at ${boundary}: ${before.squash} -> ${after.squash}`);
  }
});

test('it stretches on the way up and squashes on impact', () => {
  const air = hopPhase((HOP_STAGES.launch + HOP_STAGES.air) / 2);
  assert.ok(air.squash < -0.2, 'not stretched in the air');
  const impact = hopPhase(HOP_STAGES.air + (HOP_STAGES.land - HOP_STAGES.air) * 0.35);
  assert.ok(impact.squash > 0.5, 'no squash on landing');
  const crouch = hopPhase(HOP_STAGES.crouch - 1e-4);
  assert.ok(crouch.squash > 0.5, 'no compression in the crouch');
});

test('forward travel rises from nothing to everything, and mostly in the air', () => {
  let previous = -1;
  for (const t of samples()) {
    const progress = hopProgress(t);
    assert.ok(progress >= previous - 1e-9, `progress went backwards at ${t}`);
    previous = progress;
  }
  assert.ok(Math.abs(hopProgress(0)) < 1e-9);
  assert.equal(hopProgress(0.999), 1);
  const airShare = hopProgress(HOP_STAGES.air) - hopProgress(HOP_STAGES.launch);
  assert.ok(airShare > 0.7, `only ${airShare.toFixed(2)} of the travel is airborne`);
});

test('the blink is rare and brief', () => {
  const closed = samples(4000).map((t) => blinkAt(t * 40)).filter(Boolean).length;
  assert.ok(closed > 0, 'it never blinks');
  assert.ok(closed / 4000 < 0.06, 'it blinks far too much');
});

// --- poses -----------------------------------------------------------------

test('there are exactly four states and each has a duration', () => {
  assert.deepEqual(Object.keys(STATES).sort(), ['CELEBRATE', 'HOP', 'IDLE', 'STARTUP']);
  for (const state of Object.values(STATES)) {
    assert.ok(DURATIONS[state] > 0, state);
  }
});

test('every state poses every piece, and only real pieces', () => {
  assert.deepEqual(poseRotationKeys().slice().sort(), [...PIECES].sort());
  for (const state of Object.values(STATES)) {
    for (const t of [0, 0.13, 0.5, 1.1, 3.4]) {
      const pose = poseFor(state, t);
      assert.deepEqual(Object.keys(pose.rotations).sort(), [...PIECES].sort(), state);
      for (const [piece, rotation] of Object.entries(pose.rotations)) {
        assert.ok(Number.isFinite(rotation), `${state}/${piece} at ${t}`);
        // A flat cut-out flapping is charming; a limb spun past the vertical is
        // a bug, and 1.8rad is already well past "loose".
        assert.ok(Math.abs(rotation) <= 1.8, `${state}/${piece} rotated ${rotation}`);
      }
      assert.ok(Number.isFinite(pose.root.y) && Number.isFinite(pose.root.tilt));
      assert.ok(pose.blink >= 0 && pose.blink <= 1);
      assert.ok(pose.glow >= 0 && pose.glow <= 1);
    }
  }
});

test('no pose ever exceeds the squash limits', () => {
  for (const state of Object.values(STATES)) {
    for (const t of samples(200).map((k) => k * 4)) {
      const { scale } = poseFor(state, t).root;
      for (const axis of ['x', 'y']) {
        assert.ok(scale[axis] >= 1 - SQUASH_LIMIT - 1e-9 && scale[axis] <= 1 + SQUASH_LIMIT + 1e-9,
          `${state} scale.${axis}=${scale[axis]} at ${t}`);
      }
    }
  }
});

test('idle stays on the ground and barely moves', () => {
  for (const t of samples(200).map((k) => k * 6)) {
    const pose = poseFor(STATES.IDLE, t);
    assert.ok(Math.abs(pose.root.y) < 0.05, `idle lifted to ${pose.root.y}`);
    assert.equal(pose.progress, 0, 'idle must not travel');
  }
});

test('the arms flare outward in opposite directions during a hop', () => {
  const apex = poseFor(STATES.HOP, DURATIONS[STATES.HOP] * 0.5);
  assert.ok(apex.rotations.leftArm < 0 && apex.rotations.rightArm > 0,
    'the arms must swing out, not both the same way');
  assert.ok(Math.abs(apex.rotations.leftArm) > 0.5, 'the flare is too small to see');
  assert.ok(Math.abs(apex.rotations.leftLeg) > 0, 'the legs do not open at all');
  assert.ok(apex.rotations.leftLeg < 0 && apex.rotations.rightLeg > 0, 'the legs must spread');
  assert.equal(apex.rotations.body, 0, 'the body is the root and does not rotate');
});

test('the arms trail the body rather than moving with it', () => {
  // With one-piece limbs the old forearm-lags-the-upper-arm trick is gone, so
  // the lag moved to the whole arm: it is sampled from earlier in the cycle
  // than the body's own height. Just after takeoff the body is already rising
  // and the arm has not caught up, which is what reads as a puppet.
  const duration = DURATIONS[STATES.HOP];
  const justAfterTakeoff = poseFor(STATES.HOP, duration * (HOP_STAGES.launch + 0.06));
  const atApex = poseFor(STATES.HOP, duration * 0.5);
  assert.ok(Math.abs(justAfterTakeoff.rotations.leftArm) < Math.abs(atApex.rotations.leftArm),
    'the arm is not trailing the body');
  // And the legs, which are NOT lagged, lead the arms off the ground.
  const atLaunch = poseFor(STATES.HOP, duration * (HOP_STAGES.launch + 0.12));
  assert.ok(Math.abs(atLaunch.rotations.leftLeg) > 0, 'the legs should open as it leaves');
});

test('celebrating flaps harder than hopping and does not travel as far up', () => {
  const at = DURATIONS[STATES.CELEBRATE] * 0.5;
  const celebrate = poseFor(STATES.CELEBRATE, at);
  const hop = poseFor(STATES.HOP, DURATIONS[STATES.HOP] * 0.5);
  assert.ok(Math.abs(celebrate.rotations.leftArm) > Math.abs(hop.rotations.leftArm));
  assert.ok(celebrate.root.tilt < hop.root.tilt, 'celebrating should stay more upright');
});

test('startup glows before it moves, and settles by the end', () => {
  const early = poseFor(STATES.STARTUP, 0.05);
  const peak = poseFor(STATES.STARTUP, DURATIONS[STATES.STARTUP] * 0.72);
  const late = poseFor(STATES.STARTUP, DURATIONS[STATES.STARTUP]);
  assert.ok(late.glow > early.glow, 'the glow must build');
  assert.ok(Math.abs(late.root.x) < Math.abs(early.root.x) + 1e-9, 'the shake must settle');
  assert.ok(Math.abs(peak.rotations.leftArm) > Math.abs(early.rotations.leftArm),
    'the arms must twitch outward');
  // A twitch comes back. Left flung out, they snapped when idle took over.
  assert.ok(Math.abs(late.rotations.leftArm) < Math.abs(peak.rotations.leftArm) * 0.4,
    'the twitch must return, or it snaps into the idle pose');
});

test('a negative or absurd time never produces a broken pose', () => {
  for (const t of [-5, -0.001, 0, 1e6]) {
    for (const state of Object.values(STATES)) {
      const pose = poseFor(state, t);
      assert.ok(Number.isFinite(pose.root.y), `${state} at ${t}`);
      assert.ok(Number.isFinite(pose.root.scale.x) && pose.root.scale.x > 0);
    }
  }
  // An unknown state falls through to the hop rather than throwing.
  assert.ok(Number.isFinite(poseFor('nonsense', 0.4).root.y));
});

// --- the puppet's pieces ---------------------------------------------------

test('every piece has a layout, and every layout matches its bounds', () => {
  assert.equal(PIECE_LAYOUTS.length, PIECES.length);
  for (const piece of PIECES) {
    const layout = pieceLayout(piece);
    const box = pieceBounds(piece);
    assert.ok(layout, piece);
    assert.ok(Math.abs(layout.width - (box.maxX - box.minX)) < 1e-9, piece);
    assert.ok(Math.abs(layout.height - (box.maxY - box.minY)) < 1e-9, piece);
    assert.deepEqual(layout.pivot, { x: PIVOTS[piece].x, y: PIVOTS[piece].y }, piece);
    // The offset places the quad's centre relative to the pivot, so adding it
    // back has to land on the centre of the piece's own bounds.
    assert.ok(Math.abs(layout.pivot.x + layout.offset.x - (box.minX + box.maxX) / 2) < 1e-9, piece);
    assert.ok(Math.abs(layout.pivot.y + layout.offset.y - (box.minY + box.maxY) / 2) < 1e-9, piece);
  }
});

test('a piece pivot sits inside or on the edge of the piece it turns', () => {
  for (const piece of PIECES) {
    const box = pieceBounds(piece);
    const pivot = PIVOTS[piece];
    assert.ok(pivot.x >= box.minX - 1e-9 && pivot.x <= box.maxX + 1e-9, `${piece} x`);
    assert.ok(pivot.y >= box.minY - 1e-9 && pivot.y <= box.maxY + 1e-9, `${piece} y`);
  }
});

test('the parenting tree covers every piece, has one root and no cycles', () => {
  assert.deepEqual(Object.keys(PIECE_PARENTS).sort(), [...PIECES].sort());
  const roots = PIECES.filter((piece) => PIECE_PARENTS[piece] === null);
  assert.deepEqual(roots, ['body'], 'the body is the only root');
  for (const piece of PIECES) {
    const seen = new Set([piece]);
    let at = PIECE_PARENTS[piece];
    while (at) {
      assert.ok(!seen.has(at), `cycle through ${piece}`);
      assert.ok(PIECES.includes(at), `${piece} names a piece that does not exist: ${at}`);
      seen.add(at);
      at = PIECE_PARENTS[at];
    }
    assert.ok(seen.has('body'), `${piece} does not hang off the body`);
  }
  assert.deepEqual(Object.keys(PIECE_DEPTH).sort(), [...PIECES].sort());
});

test('every limb sits behind the body, which is what hides the seams', () => {
  // The limb shapes overlap the torso on purpose. With the body in front that
  // overlap is covered at rest; put a limb in front and the join becomes a
  // visible step with the torso's paint showing on the limb.
  for (const limb of ['leftArm', 'rightArm', 'leftLeg', 'rightLeg']) {
    assert.ok(PIECE_DEPTH[limb] < PIECE_DEPTH.body, `${limb} is in front of the body`);
  }
  assert.ok(PIECE_DEPTH.leftLeg < PIECE_DEPTH.leftArm, 'the legs belong behind the arms');
  assert.deepEqual(PIECE_DEPTH.leftArm, PIECE_DEPTH.rightArm);
  assert.deepEqual(PIECE_DEPTH.leftLeg, PIECE_DEPTH.rightLeg);
});

test('the puppet is five pieces and the body is one of them', () => {
  assert.equal(PIECES.length, 5);
  assert.ok(PIECES.includes('body'));
});

// --- where it roams --------------------------------------------------------

test('every authored roam point is somewhere the puppet may actually go', () => {
  assert.ok(ROAM_POINTS.length >= 3, 'a loop needs more than a couple of points');
  for (const point of ROAM_POINTS) {
    assert.ok(insideSafeArea(point), `(${point.x}, ${point.z}) is not in the safe area`);
  }
});

test('the safe area excludes the walls, the table, the easel and the artist', () => {
  assert.ok(!insideSafeArea({ x: SAFE_AREA.minX - 0.1, z: 0 }));
  assert.ok(!insideSafeArea({ x: 0, z: SAFE_AREA.maxZ + 0.1 }));
  for (const obstacle of OBSTACLES) {
    assert.ok(!insideSafeArea({ x: obstacle.x, z: obstacle.z }), `${obstacle.x},${obstacle.z}`);
  }
});

test('the roam loop hops between points and pauses in between', () => {
  const plan = createRoamPlan();
  assert.equal(plan.state, STATES.IDLE);
  const visited = new Set([plan.index]);
  const states = new Set();

  // Two minutes of play at sixty frames a second.
  for (let frame = 0; frame < 7200; frame += 1) {
    stepRoam(plan, 1 / 60);
    states.add(plan.state);
    visited.add(plan.index);
    assert.ok(insideSafeArea(plan.position),
      `left the safe area at (${plan.position.x.toFixed(2)}, ${plan.position.z.toFixed(2)})`);
  }
  assert.deepEqual([...states].sort(), [STATES.HOP, STATES.IDLE].sort());
  assert.ok(visited.size >= 3, `only reached ${visited.size} points`);
});

test('a leg is made of whole hops and ends exactly on its point', () => {
  const plan = createRoamPlan();
  // Run until the first leg completes.
  let guard = 0;
  while (plan.index === 0 && guard < 5000) { stepRoam(plan, 1 / 60); guard += 1; }
  const landed = plan.points[plan.index];
  assert.ok(Math.abs(plan.position.x - landed.x) < 1e-9, 'did not land on the point');
  assert.ok(Math.abs(plan.position.z - landed.z) < 1e-9, 'did not land on the point');
  assert.equal(plan.state, STATES.IDLE, 'a leg must end in a pause, not mid-air');
});

test('a roam plan can begin in place and takes its first leg to points[start]', () => {
  const from = { x: 0.6, z: 0.8 };
  const start = 4;
  const plan = createRoamPlan(ROAM_POINTS, start, {
    from,
    idlePause: 0.1,
    stateTime: 0.1,
  });
  assert.deepEqual(plan.position, from);
  assert.deepEqual(plan.origin, from);

  let guard = 0;
  while ((plan.state !== STATES.IDLE || plan.position.x === from.x) && guard < 5000) {
    stepRoam(plan, 1 / 60);
    guard += 1;
  }
  assert.ok(guard < 5000, 'the first leg never finished');
  assert.equal(plan.index, start);
  assert.deepEqual(plan.position, ROAM_POINTS[start]);
});

test('a hop covers roughly the hop distance, so travel reads as hopping', () => {
  const plan = createRoamPlan();
  while (plan.state === STATES.IDLE) stepRoam(plan, 1 / 60);
  const target = plan.points[(plan.index + 1) % plan.points.length];
  const distance = Math.hypot(target.x - plan.origin.x, target.z - plan.origin.z);
  const perHop = distance / plan.hops;
  assert.ok(perHop > HOP_DISTANCE * 0.5 && perHop < HOP_DISTANCE * 1.5,
    `${perHop.toFixed(2)} per hop against a nominal ${HOP_DISTANCE}`);
});

test('a roam plan refuses points it could not safely use', () => {
  const inside = OBSTACLES[0];
  assert.throws(
    () => createRoamPlan([{ x: inside.x, z: inside.z }, { x: 0, z: 0 }]),
    /at least two safe points/,
  );
  // Unsafe points are dropped rather than silently hopped through.
  const plan = createRoamPlan([...ROAM_POINTS, { x: inside.x, z: inside.z }]);
  assert.equal(plan.points.length, ROAM_POINTS.length);
});

test('stepping with a nonsense delta neither moves nor breaks the plan', () => {
  const plan = createRoamPlan();
  const before = { ...plan.position };
  for (const dt of [0, -1, NaN, undefined, 1e6]) stepRoam(plan, dt);
  assert.ok(Number.isFinite(plan.position.x) && Number.isFinite(plan.position.z));
  assert.ok(insideSafeArea(plan.position));
  assert.deepEqual(plan.position, before, 'a bad delta must not teleport the puppet');
});

test('a pose carries its hop stage, and only while hopping', () => {
  for (const state of [STATES.IDLE, STATES.STARTUP]) {
    assert.equal(poseFor(state, 0.3).stage, null, state);
  }
  for (const state of [STATES.HOP, STATES.CELEBRATE]) {
    const stages = samples(200)
      .map((k) => poseFor(state, k * DURATIONS[state]).stage);
    assert.ok(stages.every(Boolean), `${state} left a pose with no stage`);
    assert.ok(new Set(stages).size === 5, `${state} reported ${new Set(stages).size} stages`);
  }
});

test('one hop reports exactly one touchdown', () => {
  // This is what the paper-tap sound listens for: the air -> land edge. Two
  // edges per hop would double the sound, none would lose it silently.
  let previous = null;
  let landings = 0;
  const frames = Math.round(DURATIONS[STATES.HOP] * 3 * 60);
  for (let frame = 0; frame <= frames; frame += 1) {
    const stage = poseFor(STATES.HOP, (frame / 60)).stage;
    if (stage === 'land' && previous !== 'land') landings += 1;
    previous = stage;
  }
  assert.equal(landings, 3, 'three hops must make three taps');
});
