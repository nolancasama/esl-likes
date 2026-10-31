import test from 'node:test';
import assert from 'node:assert/strict';
import { SUBJECTS, subjectById } from './subjectRegistry.js';
import { createRoamPlan, stepRoam, STATES, MOVE_STATE, SQUASH_LIMIT, poseFor } from './robotPuppet.js';
import { locomotionConfigFor, locomotionPose, createLocomotionPose } from './locomotion.js';

const route = [{ x: -4, z: 3 }, { x: 4, z: 3 }];
function planFor(subject) {
  return createRoamPlan(route, 0, { idlePause: 0.1, stateTime: 0.1,
    speed: subject.motionProfile.speed, locomotion: locomotionConfigFor(subject) });
}
function sample(subject, plan, reducedMotion = false, out) {
  return locomotionPose(subject, { moving: plan.state !== STATES.IDLE && !plan.checking,
    cycleTime: plan.cycleTime, idleTime: plan.stateTime, plan, reducedMotion }, out);
}

test('declared styles keep hop fallback and snowman legacy poses', () => {
  assert.equal(locomotionConfigFor({}).style, 'hop');
  assert.deepEqual(SUBJECTS.map((subject) => locomotionConfigFor(subject).style),
    ['piston', 'hop', 'swing-walk', 'fly', 'tiptoe']);
  const snowman = subjectById('snowman');
  const plan = planFor(snowman);
  for (let frame = 0; frame < 180; frame += 1) {
    stepRoam(plan, 1 / 60);
    assert.deepEqual(sample(snowman, plan), poseFor(snowman, plan.state, plan.stateTime * plan.speed));
  }
});

test('continuous styles travel at their world speed and land exactly on the route point', () => {
  const expected = { robot: 0.47, gingerbread: 0.55, hero: 0.62, ninja: 0.3724 };
  for (const subject of SUBJECTS.filter((s) => s.id !== 'snowman')) {
    const plan = planFor(subject);
    stepRoam(plan, 1 / 60);
    assert.equal(plan.state, MOVE_STATE);
    for (let i = 0; i < 120; i += 1) stepRoam(plan, 1 / 60);
    const before = plan.position.x;
    stepRoam(plan, 1 / 60);
    assert.ok(Math.abs((plan.position.x - before) * 60 - expected[subject.id]) < 1e-8, subject.id);
    let frames = 0;
    while (plan.state !== STATES.IDLE && frames++ < 3000) stepRoam(plan, 1 / 60);
    assert.ok(frames < 3000);
    assert.deepEqual(plan.position, route[1]);
  }
});

test('ninja checks every third leg for a bounded pause, without losing its target', () => {
  const subject = subjectById('ninja');
  const plan = planFor(subject);
  const checks = new Set();
  let checkFrames = 0;
  for (let frame = 0; frame < 9000 && plan.leg <= 4; frame += 1) {
    const x = plan.position.x;
    const wasChecking = plan.checking;
    stepRoam(plan, 1 / 60);
    if (plan.checking) {
      checks.add(plan.leg);
      checkFrames += 1;
      assert.equal(plan.position.x, x);
    } else if (wasChecking) assert.ok(Math.abs(plan.position.x - x) < 0.01);
  }
  assert.deepEqual([...checks], [3]);
  assert.ok(checkFrames / 60 >= 0.7 && checkFrames / 60 <= 1);
});

test('rigid styles stay grounded, keep piston overlap, and reuse output safely', () => {
  for (const subject of SUBJECTS) {
    const plan = planFor(subject);
    const out = createLocomotionPose(subject);
    for (let frame = 0; frame < 1500; frame += 1) {
      stepRoam(plan, 1 / 60);
      const pose = sample(subject, plan, false, out);
      if (subject.id !== 'snowman') assert.equal(pose, out);
      for (const axis of ['x', 'y']) assert.ok(Math.abs(pose.root.scale[axis] - 1) <= SQUASH_LIMIT);
      if (['robot', 'ninja'].includes(subject.id)) assert.equal(pose.root.y, 0);
      if (subject.id === 'gingerbread') assert.ok(pose.root.y >= 0 && pose.root.y <= 0.03);
      if (subject.id === 'robot') {
        for (const leg of ['leftLeg', 'rightLeg']) {
          assert.ok(pose.translations[leg] >= 0 && pose.translations[leg] <= subject.locomotion.retract && subject.locomotion.retract <= 0.12);
          assert.equal(pose.rotations[leg], 0);
        }
      }
      if (subject.id === 'gingerbread') {
        // Forward/back on local X only: a Z turn on a camera-facing sheet flaps.
        for (const limb of ['leftArm', 'rightArm', 'leftLeg', 'rightLeg']) {
          assert.equal(pose.rotations[limb], 0);
        }
        const { armSwing, legSwing } = subject.locomotion;
        assert.ok(Math.abs(pose.pitches.leftArm / armSwing - pose.pitches.rightLeg / legSwing) < 1e-12);
        assert.ok(Math.abs(pose.pitches.rightArm / armSwing - pose.pitches.leftLeg / legSwing) < 1e-12);
        assert.ok(Math.abs(pose.pitches.leftArm + pose.pitches.rightArm) < 1e-12);
      }
    }
  }
});

test('reduced motion retains flight and navigation while damping style amplitudes', () => {
  for (const subject of SUBJECTS.filter((s) => s.id !== 'snowman')) {
    const plan = planFor(subject);
    for (let i = 0; i < 150; i += 1) stepRoam(plan, 1 / 60);
    const regular = sample(subject, plan);
    const reduced = sample(subject, plan, true);
    if (subject.id === 'hero') {
      assert.ok(reduced.root.y * 1.75 * subject.liveScale * 0.5 > 1.1);
      assert.ok(Math.abs(reduced.rotations.cape) <= Math.abs(regular.rotations.cape));
    } else if (subject.id === 'gingerbread') {
      assert.ok(Math.abs(reduced.pitches.leftArm) <= Math.abs(regular.pitches.leftArm) * 0.401);
      assert.ok(Math.abs(regular.pitches.leftArm) > 0);
    } else {
      assert.ok(Math.abs(reduced.rotations.leftArm) <= Math.abs(regular.rotations.leftArm) * 0.401);
    }
    assert.notEqual(plan.position.x, route[0].x);
  }
});
