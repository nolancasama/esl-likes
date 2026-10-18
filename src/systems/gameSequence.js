/**
 * The student's route through the game: one fixed run of stages instead of a
 * room of doors. The shell owns this; no minigame knows what comes before or
 * after it — each one only calls `ctx.finish(result)`.
 */
export const GAME_SEQUENCE = Object.freeze(['coloring', 'restaurant', 'zoo', 'sports', 'drink-stand']);

/** Stages that are not minigames. */
export const HUB_STAGE = 'hub';
export const COMPLETE_STAGE = 'complete';
export const UNLOCK_STAGE = 'unlock';

/**
 * `sequence` is the normal student flow. `hub` is the old five-door free-play
 * room, kept for teachers and for the playthrough harnesses (`?hub=1`).
 */
export const SHELL_MODES = Object.freeze(['sequence', 'hub']);

export function gameIndex(id, sequence = GAME_SEQUENCE) {
  return sequence.indexOf(id);
}

export function nextGameAfter(id, sequence = GAME_SEQUENCE) {
  const index = gameIndex(id, sequence);
  if (index < 0 || index >= sequence.length - 1) return null;
  return sequence[index + 1];
}

export function previousGameBefore(id, sequence = GAME_SEQUENCE) {
  const index = gameIndex(id, sequence);
  if (index <= 0) return null;
  return sequence[index - 1];
}

export function activeLessons(lessonById, sequence = GAME_SEQUENCE) {
  return Object.freeze(sequence.map((id) => lessonById[id]).filter(Boolean));
}

export function stageProgressState(id, stamps, sequence = GAME_SEQUENCE) {
  if (stamps[id]) return 'earned';
  const index = gameIndex(id, sequence);
  return index === 0 || (index > 0 && stamps[sequence[index - 1]]) ? 'unlocked' : 'locked';
}

/** Reads the shell mode from a query string; anything but `?hub` is the sequence. */
export function shellModeFromSearch(search = '') {
  return new URLSearchParams(search).has('hub') ? 'hub' : 'sequence';
}

/**
 * The one routing path for startup, forward progression, Back and replay.
 *
 * `show(stage, { backAvailable, transition })` builds the stage and resolves
 * `false` if it could not (a transition was already running); `record(gameId,
 * result)` stores progress before the route moves on. `isPlayable(id)` keeps
 * disabled lessons unreachable even if something asks for them.
 */
export function createShellNavigator({
  mode = 'sequence',
  sequence = GAME_SEQUENCE,
  isPlayable,
  show,
  record = () => {},
}) {
  if (!SHELL_MODES.includes(mode)) throw new TypeError(`Unknown shell mode: ${mode}`);
  if (typeof isPlayable !== 'function' || typeof show !== 'function') {
    throw new TypeError('createShellNavigator requires isPlayable and show');
  }

  let current = null;
  let routing = false;
  let finishing = false;
  let pendingNext = null;

  const isGame = (stage) => stage !== HUB_STAGE && stage !== COMPLETE_STAGE && stage !== UNLOCK_STAGE;

  function backTarget(stage) {
    if (!isGame(stage)) return null;
    if (mode === HUB_STAGE) return HUB_STAGE;
    return previousGameBefore(stage, sequence);
  }

  function finishTarget(gameId) {
    if (mode === HUB_STAGE) return HUB_STAGE;
    return nextGameAfter(gameId, sequence) ?? COMPLETE_STAGE;
  }

  async function go(stage, { transition = true, unlock } = {}) {
    if (routing || !stage) return false;
    if (isGame(stage) && !isPlayable(stage)) return false;
    if (stage === HUB_STAGE && mode !== HUB_STAGE) return false;
    routing = true;
    const previous = current;
    current = stage;
    let shown = false;
    try {
      shown = (await show(stage, { backAvailable: backTarget(stage) !== null, transition, ...(unlock ? { unlock } : {}) })) !== false;
    } finally {
      if (!shown) current = previous;
      routing = false;
      finishing = false;
    }
    return shown;
  }

  return {
    get current() { return current; },
    get routing() { return routing; },
    mode,
    start() {
      return go(mode === HUB_STAGE ? HUB_STAGE : sequence[0], { transition: false });
    },
    /** From the hub's doors. The sequence never offers a choice. */
    enter(id) {
      if (mode !== HUB_STAGE || current !== HUB_STAGE || !isGame(id)) return Promise.resolve(false);
      return go(id);
    },
    finish(gameId, result = {}) {
      // A controller that has already been replaced cannot finish the run.
      if (finishing || routing || !isGame(gameId) || gameId !== current) return Promise.resolve(false);
      finishing = true;
      try {
        record(gameId, result);
      } catch (error) {
        finishing = false;
        throw error;
      }
      const next = finishTarget(gameId);
      if (mode === 'sequence' && isGame(next)) {
        pendingNext = next;
        return go(UNLOCK_STAGE, { transition: false, unlock: { completed: gameId, next } });
      }
      return go(next);
    },
    async continueFromUnlock() {
      if (current !== UNLOCK_STAGE || routing || !pendingNext) return false;
      const shown = await go(pendingNext);
      if (shown) pendingNext = null;
      return shown;
    },
    back() {
      if (routing) return Promise.resolve(false);
      return go(backTarget(current));
    },
    canGoBack(stage = current) {
      return backTarget(stage) !== null;
    },
    /** もういちど on the completion screen: a fresh run, keeping every save. */
    restart() {
      if (current !== COMPLETE_STAGE) return Promise.resolve(false);
      return go(sequence[0]);
    },
  };
}
