import {
  AUTO_TALK_DWELL_MS,
  AUTO_TALK_FACING_DEGREES,
  AUTO_TALK_REARM_MS,
} from '../config/interaction.js';

const DEG_TO_RAD = Math.PI / 180;

function duration(value, fallback) {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function degrees(value, fallback) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(180, Math.max(0, value));
}

function deltaMilliseconds(dt) {
  if (!Number.isFinite(dt) || dt <= 0) return 0;
  const milliseconds = dt * 1000;
  return Number.isFinite(milliseconds) ? milliseconds : Number.MAX_VALUE;
}

function snapshotCandidate(candidate) {
  if (
    !candidate
    || !Number.isFinite(candidate.x)
    || !Number.isFinite(candidate.z)
    || !Number.isFinite(candidate.radiusSq)
    || candidate.radiusSq < 0
  ) return null;

  // The talk radius is centred on (x, z); facing is judged toward (lookX, lookZ)
  // when given. They differ at the Drink Stand, where the child stands on a
  // window's approach point but faces the customer behind the counter — judging
  // facing toward a point the player is standing on is undefined.
  const hasLook = Number.isFinite(candidate.lookX) && Number.isFinite(candidate.lookZ);
  return {
    id: candidate.id,
    x: candidate.x,
    z: candidate.z,
    radiusSq: candidate.radiusSq,
    lookX: hasLook ? candidate.lookX : candidate.x,
    lookZ: hasLook ? candidate.lookZ : candidate.z,
  };
}

function distanceSq(candidate, player) {
  if (!candidate || !player || !Number.isFinite(player.x) || !Number.isFinite(player.z)) {
    return null;
  }
  const dx = candidate.x - player.x;
  const dz = candidate.z - player.z;
  const result = (dx * dx) + (dz * dz);
  return Number.isFinite(result) ? result : null;
}

function contains(candidate, player) {
  const distance = distanceSq(candidate, player);
  return distance !== null && distance <= candidate.radiusSq;
}

function facingScore(candidate, player) {
  if (
    !candidate
    || !player
    || !Number.isFinite(player.forwardX)
    || !Number.isFinite(player.forwardZ)
  ) return null;

  const lookX = Number.isFinite(candidate.lookX) ? candidate.lookX : candidate.x;
  const lookZ = Number.isFinite(candidate.lookZ) ? candidate.lookZ : candidate.z;
  const dx = lookX - player.x;
  const dz = lookZ - player.z;
  const directionLength = Math.hypot(dx, dz);
  const forwardLength = Math.hypot(player.forwardX, player.forwardZ);
  if (!Number.isFinite(directionLength) || directionLength === 0 || forwardLength === 0) {
    return null;
  }

  const dot = ((player.forwardX * dx) + (player.forwardZ * dz))
    / (forwardLength * directionLength);
  return Number.isFinite(dot) ? Math.min(1, Math.max(-1, dot)) : null;
}

/**
 * Creates the pure dwell-to-talk state machine shared by service games.
 * Call update with real render-frame seconds; no timers or browser state are used.
 */
export function createTalkDwell({
  dwellMs: requestedDwellMs = AUTO_TALK_DWELL_MS,
  facingDegrees: requestedFacingDegrees = AUTO_TALK_FACING_DEGREES,
  rearmMs: requestedRearmMs = AUTO_TALK_REARM_MS,
} = {}) {
  const dwellMs = duration(requestedDwellMs, AUTO_TALK_DWELL_MS);
  const facingDegrees = degrees(requestedFacingDegrees, AUTO_TALK_FACING_DEGREES);
  const rearmMs = duration(requestedRearmMs, AUTO_TALK_REARM_MS);
  const minimumFacingScore = Math.cos(facingDegrees * DEG_TO_RAD);

  let phase = 'idle';
  let targetId = null;
  let targetCandidate = null;
  let elapsedMs = 0;
  let lastCandidates = new Map();
  const acceptedIds = new Set();
  const disarmedIds = new Map();

  const returnToIdle = () => {
    phase = 'idle';
    targetId = null;
    targetCandidate = null;
    elapsedMs = 0;
  };

  const isFacing = (candidate, player) => {
    const score = facingScore(candidate, player);
    return score !== null && score >= minimumFacingScore;
  };

  const rememberCandidates = (candidates) => {
    lastCandidates = new Map();
    for (const candidate of candidates) {
      const snapshot = snapshotCandidate(candidate);
      if (snapshot) lastCandidates.set(snapshot.id, snapshot);
    }
  };

  const updateDisarmedIds = (candidates, player, moving, frameMs) => {
    const currentById = new Map(candidates.map((candidate) => [candidate.id, candidate]));

    for (const [id, disarm] of disarmedIds) {
      const current = snapshotCandidate(currentById.get(id));
      if (current) disarm.zone = current;

      if (!disarm.released) {
        const observedOutside = disarm.zone ? !contains(disarm.zone, player) : false;
        if (!moving && !observedOutside) continue;

        disarm.released = true;
        disarm.elapsedMs = 0;
        if (rearmMs === 0) disarmedIds.delete(id);
        continue;
      }

      if (moving) {
        disarm.elapsedMs = 0;
        continue;
      }

      disarm.elapsedMs = Math.min(rearmMs, disarm.elapsedMs + frameMs);
      if (disarm.elapsedMs >= rearmMs) disarmedIds.delete(id);
    }
  };

  const eligible = (candidate, player) => (
    candidate
    && !acceptedIds.has(candidate.id)
    && !disarmedIds.has(candidate.id)
    && contains(candidate, player)
    && isFacing(candidate, player)
  );

  const chooseCandidate = (candidates, player, lockedTargetId) => {
    if (lockedTargetId !== null && lockedTargetId !== undefined) {
      const locked = candidates.find((candidate) => candidate.id === lockedTargetId);
      return eligible(locked, player) ? locked : null;
    }

    let best = null;
    let bestScore = -Infinity;
    for (const candidate of candidates) {
      if (!eligible(candidate, player)) continue;
      const score = facingScore(candidate, player);
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
    return best;
  };

  const advanceDwell = (frameMs) => {
    if (dwellMs === 0 || frameMs >= dwellMs - elapsedMs) {
      elapsedMs = dwellMs;
      phase = 'ready';
      return;
    }
    elapsedMs += frameMs;
  };

  return {
    update(dt, input = {}) {
      const candidates = Array.isArray(input.candidates) ? input.candidates : [];
      const player = input.player ?? null;
      const moving = input.moving === true;
      const frameMs = deltaMilliseconds(dt);

      rememberCandidates(candidates);
      updateDisarmedIds(candidates, player, moving, frameMs);

      // A committed conversation is resolved only by its explicit speech outcome.
      if (phase === 'committed') return;

      if (phase === 'dwelling' || phase === 'ready') {
        const current = candidates.find((candidate) => candidate.id === targetId);
        if (moving || !current || !contains(current, player) || !isFacing(current, player)) {
          returnToIdle();
          return;
        }

        targetCandidate = snapshotCandidate(current);
        if (phase === 'dwelling') advanceDwell(frameMs);
        return;
      }

      if (moving) return;
      const selected = chooseCandidate(candidates, player, input.lockedTargetId);
      if (!selected) return;

      phase = 'dwelling';
      targetId = selected.id;
      targetCandidate = snapshotCandidate(selected);
      elapsedMs = 0;
      advanceDwell(frameMs);
    },

    commit() {
      if (phase !== 'dwelling' && phase !== 'ready') return false;
      phase = 'committed';
      elapsedMs = dwellMs;
      return true;
    },

    reset() {
      returnToIdle();
      acceptedIds.clear();
      disarmedIds.clear();
      lastCandidates.clear();
    },

    notifyAccepted(id) {
      acceptedIds.add(id);
      disarmedIds.delete(id);
      returnToIdle();
    },

    notifyEnded(id, outcome) {
      if (outcome !== 'failed' && outcome !== 'cancelled') return false;

      if (!acceptedIds.has(id)) {
        const zone = targetId === id ? targetCandidate : lastCandidates.get(id);
        disarmedIds.set(id, {
          released: false,
          elapsedMs: 0,
          zone: zone ? { ...zone } : null,
        });
      }
      returnToIdle();
      return true;
    },

    get phase() { return phase; },
    get targetId() { return targetId; },
    get progress() {
      if (phase === 'ready' || phase === 'committed') return 1;
      if (phase !== 'dwelling' || dwellMs === 0) return 0;
      return Math.min(1, Math.max(0, elapsedMs / dwellMs));
    },
  };
}
