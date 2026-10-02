import test from 'node:test';
import assert from 'node:assert/strict';

import { RING_RADIUS, createCrowd, createNewcomerReaction } from './robotCrowd.js';
import { ROAM_POINTS, insideSafeArea } from './robotPuppet.js';

/** A seeded RNG, so "they differ" is a fact about the crowd and not about luck. */
function seeded(seed = 1) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const join = (count, random = seeded(7)) => {
  const crowd = createCrowd({ random });
  return { crowd, members: Array.from({ length: count }, () => crowd.join()) };
};

test('every member gets its own id, and the crowd tracks them', () => {
  const { crowd, members } = join(5);
  assert.equal(crowd.size, 5);
  assert.equal(new Set(members.map((m) => m.id)).size, 5);
  for (const member of members) assert.ok(crowd.has(member.id));
});

test('leaving removes only that member', () => {
  const { crowd, members } = join(3);
  assert.ok(crowd.leave(members[1].id));
  assert.equal(crowd.size, 2);
  assert.ok(crowd.has(members[0].id));
  assert.ok(!crowd.has(members[1].id));
  assert.ok(crowd.has(members[2].id));
  assert.equal(crowd.leave(members[1].id), false, 'leaving twice must not double-count');
});

// --- the whole point: they must not move as one -----------------------------

test('consecutive members start from different points in the loop', () => {
  const { members } = join(ROAM_POINTS.length);
  const starts = members.map((m) => m.start);
  assert.equal(new Set(starts).size, ROAM_POINTS.length,
    'members set off from the same corner and will travel in convoy');
});

test('idle pauses differ, so hops cannot stay in unison', () => {
  const { members } = join(8);
  const pauses = members.map((m) => m.idlePause);
  assert.equal(new Set(pauses).size, 8, 'two robots idle for exactly the same beat');
  for (const pause of pauses) {
    assert.ok(pause >= 1.1 && pause <= 2.3, `idle pause ${pause} is outside the authored range`);
  }
});

test('phase offsets differ, so nobody lands on the same frame', () => {
  const { members } = join(8);
  const phases = members.map((m) => m.stateTime);
  assert.equal(new Set(phases).size, 8);
  for (const phase of phases) assert.ok(phase >= 0 && phase <= 1.6);
});

test('saved personality values are reused when a robot rejoins', () => {
  const crowd = createCrowd({ random: () => 0 });
  const saved = { start: 4, idlePause: 2.17, stateTime: 0.83 };
  const member = crowd.join(saved);
  assert.equal(member.start, saved.start);
  assert.equal(member.idlePause, saved.idlePause);
  assert.equal(member.stateTime, saved.stateTime);
  assert.ok(member.points.length > 0, 'rejoining did not receive live roam points');
});

test('a subject motion profile controls cadence without overriding saved pauses', () => {
  const crowd = createCrowd({ random: () => 0.5 });
  const profile = { speed: 1.28, idleMin: 0.6, idleMax: 1 };
  const fresh = crowd.join({}, profile);
  assert.equal(fresh.speed, profile.speed);
  assert.equal(fresh.idlePause, 0.8);

  const restored = crowd.join({ idlePause: 2.17, stateTime: 0.83 }, profile);
  assert.equal(restored.speed, profile.speed);
  assert.equal(restored.idlePause, 2.17);
  assert.equal(restored.stateTime, 0.83);
});

test('the newcomer reaction celebrates once and always resumes previous roaming', () => {
  function fakePuppet(x, z) {
    const calls = [];
    const puppet = {
      group: { position: { x, z } },
      calls,
      pauseRoaming() { calls.push('pause'); return puppet; },
      resumeRoaming() { calls.push('resume'); return puppet; },
      setHeading(value) { calls.push(['heading', value]); return puppet; },
      setState(value) { calls.push(['state', value]); return puppet; },
    };
    return puppet;
  }

  const nearby = fakePuppet(1, 0);
  const far = fakePuppet(20, 20);
  const newcomer = { puppet: fakePuppet(0, 0) };
  const reaction = createNewcomerReaction({ duration: 1.25, radius: 6.5 });

  assert.equal(reaction.start([{ puppet: nearby }, { puppet: far }], newcomer), 1);
  assert.equal(reaction.active, true);
  assert.deepEqual(nearby.calls[0], 'pause');
  assert.deepEqual(nearby.calls.at(-1), ['state', 'celebrate']);
  assert.deepEqual(far.calls, []);

  assert.equal(reaction.update(0.5), true);
  assert.deepEqual(nearby.calls.at(-1), ['state', 'idle']);
  assert.equal(reaction.update(0.74), true);
  assert.equal(reaction.update(0.02), false);
  assert.equal(reaction.active, false);
  assert.equal(nearby.calls.filter((call) => call === 'resume').length, 1);
});

test('a member that never asks for randomness still differs in its route', () => {
  // A constant RNG is the adversarial case: idlePause and stateTime collapse,
  // and only the start index and the displaced points can keep them apart.
  const crowd = createCrowd({ random: () => 0.5 });
  const a = crowd.join();
  const b = crowd.join();
  assert.equal(a.idlePause, b.idlePause);
  assert.notEqual(a.start, b.start);
  assert.notDeepEqual(a.points, b.points);
});

// --- spacing, decided once ---------------------------------------------------

test('each member roams its own displaced copy of the points', () => {
  const { members } = join(6);
  for (const member of members) {
    assert.equal(member.points.length, ROAM_POINTS.length, 'a point was dropped');
    assert.notEqual(member.points, ROAM_POINTS, 'the shared list was handed out');
  }
  // Every member's list must differ from every other's, or two robots share a
  // seat.
  const keys = members.map((m) => m.points.map((p) => `${p.x.toFixed(3)},${p.z.toFixed(3)}`).join('|'));
  assert.equal(new Set(keys).size, members.length);
});

test('a displaced point never leaves the safe area', () => {
  const { members } = join(24);
  for (const member of members) {
    for (const point of member.points) {
      assert.ok(insideSafeArea(point),
        `${member.id} would hop to (${point.x}, ${point.z}), which is in a wall or the easel`);
    }
  }
});

test('displacement stays inside the ring, so the spread is a nudge not a relocation', () => {
  const { members } = join(24);
  for (const member of members) {
    for (const [index, point] of member.points.entries()) {
      const authored = ROAM_POINTS[index];
      const distance = Math.hypot(point.x - authored.x, point.z - authored.z);
      assert.ok(distance <= RING_RADIUS + 1e-9,
        `${member.id} moved point ${index} by ${distance.toFixed(3)}`);
    }
  }
});

test('nearby joiners are pushed apart, not stacked', () => {
  // The failure this prevents: five robots standing in exactly one spot. Take
  // the first point of the first six members and check no two of them sit on
  // top of each other.
  const { members } = join(6);
  const spots = members.map((m) => m.points[0]);
  for (let i = 0; i < spots.length; i += 1) {
    for (let j = i + 1; j < spots.length; j += 1) {
      const distance = Math.hypot(spots[i].x - spots[j].x, spots[i].z - spots[j].z);
      assert.ok(distance > 0.12, `members ${i} and ${j} are ${distance.toFixed(3)} apart`);
    }
  }
});

test('a member that leaves does not free its slot for the next one', () => {
  // Reusing a ring slot would put the new robot exactly where the old one was
  // — which, since old robots are never removed in play, is a bug waiting for
  // the one case where one is.
  const crowd = createCrowd({ random: seeded(3) });
  const first = crowd.join();
  crowd.leave(first.id);
  const second = crowd.join();
  assert.notDeepEqual(second.points, first.points);
});

test('the crowd has no cap', () => {
  const crowd = createCrowd({ random: seeded(11) });
  for (let i = 0; i < 60; i += 1) assert.ok(crowd.join().id);
  assert.equal(crowd.size, 60);
  assert.equal(crowd.all().length, 60);
});
