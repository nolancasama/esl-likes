/**
 * THE CROWD: how a roomful of paper robots avoids looking like one robot
 * copied twenty times.
 *
 * Pure. No three.js, no DOM — this module only decides numbers, and the
 * controller hands them to `paperPuppet.startRoaming`.
 *
 * Two problems, one answer.
 *
 *   1. **Synchronised hopping.** Every puppet runs the same roam plan over the
 *      same authored points, so puppets started together hop in lockstep like
 *      soldiers. Fixed by giving each member its own starting point, its own
 *      idle pause and its own phase offset.
 *   2. **Pile-ups.** Six authored points and twenty robots means stacks. Fixed
 *      by giving each member its **own displaced copy** of the point list.
 *
 * The displacement is the whole anti-pile-up mechanism, and it is deliberately
 * decided **once, when a robot joins** — never per frame. Runtime avoidance
 * (separation forces, occupancy checks, a nudge away from a neighbour) is what
 * makes a crowd of toys jitter, and a jittering paper robot looks broken in a
 * way that a slightly overlapping one does not. Occasional overlap is the
 * accepted price.
 */

import { ROAM_POINTS, insideSafeArea } from './robotPuppet.js';

/** How far a member's roam points may sit from the authored ones, in world units. */
export const RING_RADIUS = 0.62;

/**
 * The golden angle.
 *
 * Successive multiples of it never fall near each other, so robot 5 is not
 * standing where robot 4 stands — which a plain `index * (2π / n)` cannot
 * promise unless you know `n` in advance, and here `n` is however many robots
 * the child feels like making.
 */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** Idle pause range, in seconds. Wide enough to break unison, short enough to stay lively. */
const IDLE_MIN = 1.1;
const IDLE_MAX = 2.3;

/** How far into its cycle a new robot starts, in seconds. */
const PHASE_SPREAD = 1.6;

export function createCrowd({ points = ROAM_POINTS, random = Math.random } = {}) {
  const members = new Map();
  let nextId = 1;
  /**
   * Monotonic, unlike `members.size`: a robot that left must not free its ring
   * slot for the next one, or two robots end up on the same offset.
   */
  let joinCount = 0;

  /**
   * This member's own copy of the roam points, shifted off the authored ones.
   *
   * The radius is stepped as well as the angle, so members do not all land on
   * one circle around each point. A shifted point that leaves the safe area
   * (through a wall, or into the easel) falls back to the authored point —
   * crowding is better than a robot hopping into the furniture.
   */
  function displacedPoints(index) {
    const angle = index * GOLDEN_ANGLE;
    const radius = RING_RADIUS * (0.4 + 0.6 * ((index % 3) / 2));
    const dx = Math.cos(angle) * radius;
    const dz = Math.sin(angle) * radius;
    return Object.freeze(points.map((point) => {
      const moved = { x: point.x + dx, z: point.z + dz };
      return insideSafeArea(moved) ? Object.freeze(moved) : point;
    }));
  }

  const api = {
    get size() { return members.size; },

    /** Enrols a new robot and returns the variation it should roam with. */
    join(variation = {}) {
      const index = joinCount;
      joinCount += 1;
      const idlePause = IDLE_MIN + random() * (IDLE_MAX - IDLE_MIN);
      const stateTime = random() * PHASE_SPREAD;
      const member = Object.freeze({
        id: nextId,
        start: variation.start ?? index % Math.max(1, points.length),
        idlePause: variation.idlePause ?? idlePause,
        stateTime: variation.stateTime ?? stateTime,
        points: displacedPoints(index),
      });
      nextId += 1;
      members.set(member.id, member);
      return member;
    },

    leave(id) { return members.delete(id); },
    has(id) { return members.has(id); },
    get(id) { return members.get(id) ?? null; },
    /** Every member, in join order. */
    all() { return [...members.values()]; },
  };

  return api;
}
