import test from 'node:test';
import assert from 'node:assert/strict';

import { reactionPose } from './reactionPose.js';

function close(actual, expected, epsilon = 1e-10) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} is not close to ${expected}`);
}

function priorBlend(seconds) {
  const value = Math.min(1, Math.max(0, seconds / 0.25));
  return value * value * (3 - (2 * value));
}

test('dejected is a shared standing slump with a bounded two-cycle head shake', () => {
  const pose = reactionPose('dejected', 1.03);
  assert.ok(!Object.keys(pose.nodes).some((name) => /leg|knee/.test(name)));
  assert.ok(pose.nodes.head.x > 0.3);
  assert.ok(pose.nodes.torso.x > 0.15);
  assert.notEqual(pose.nodes.head.y, 0);
  close(reactionPose('dejected', 2.9).nodes.head.y, 0);

  let maximum = 0;
  for (let time = 0; time <= 3.6; time += 0.005) {
    maximum = Math.max(maximum, Math.abs(reactionPose('dejected', time).nodes.head.y));
  }
  assert.ok(maximum <= 0.35);
});

test('celebrate matches the previous formula and holds after 1.5 seconds', () => {
  for (const seconds of [0.1, 0.73, 1.5, 2.9]) {
    const pose = reactionPose('celebrate', seconds);
    const blend = priorBlend(seconds);
    const hopping = seconds < 1.5 ? Math.sin((seconds % 0.5) / 0.5 * Math.PI) : 0;
    const pump = seconds < 1.5 ? Math.sin(seconds * Math.PI * 4) * 0.35 : 0;
    const twist = seconds < 1.5 ? Math.sin(seconds * Math.PI * 2) * 0.12 : 0;
    close(pose.rootY, Math.max(0, hopping) * 0.45);
    close(pose.nodes['arm-left'].z, (2.4 + pump) * blend);
    close(pose.nodes['arm-right'].z, (-2.4 - pump) * blend);
    close(pose.nodes.torso.y, twist * blend);
  }
});

test('shrug matches the previous rotation and position formulas', () => {
  for (const seconds of [0.1, 0.91, 1.55, 2.9]) {
    const pose = reactionPose('shrug', seconds);
    const blend = priorBlend(seconds);
    const lift = Math.sin(Math.min(1, seconds / 0.45) * Math.PI) * 0.04;
    const nod = seconds > 0.65 && seconds < 1.55
      ? Math.sin((seconds - 0.65) * Math.PI * 2.2) * 0.08
      : 0;
    close(pose.nodes['arm-left'].x, -0.5 * blend);
    close(pose.nodes['arm-left'].z, 0.55 * blend);
    close(pose.nodes['arm-right'].x, -0.5 * blend);
    close(pose.nodes['arm-right'].z, -0.55 * blend);
    close(pose.positions.torso.y, lift * blend);
    close(pose.nodes.head.x, nod * blend);
    close(pose.nodes.head.z, 0.15 * blend);
  }
});
