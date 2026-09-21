/**
 * Undo/redo for the scene placement editor.
 *
 * A pure command stack — no three.js, no DOM — so the ordering and the
 * boundaries of an undoable step can be tested without a renderer.
 *
 * The rule that matters is granularity: a continuous gizmo drag is ONE entry,
 * from the transform before the drag to the transform after it. Pushing per
 * frame would fill the stack with hundreds of sub-pixel steps and make undo
 * useless, which is the usual way a level editor's undo goes wrong.
 */

const DEFAULT_LIMIT = 200;

/**
 * @param {object} [options]
 * @param {number} [options.limit] entries kept before the oldest is dropped
 * @param {(state: {canUndo: boolean, canRedo: boolean, length: number}) => void} [options.onChange]
 */
export function createHistory({ limit = DEFAULT_LIMIT, onChange = null } = {}) {
  const done = [];
  const undone = [];

  const state = () => ({ canUndo: done.length > 0, canRedo: undone.length > 0, length: done.length });
  const notify = () => onChange?.(state());

  /**
   * Records a command that has ALREADY been applied. The editor performs the
   * action first and reports it here, so `do()` is only ever called again by
   * redo. A command is `{ label, do(), undo() }`.
   */
  function push(command) {
    if (!command || typeof command.do !== 'function' || typeof command.undo !== 'function') {
      throw new Error('A history command needs both do() and undo().');
    }
    done.push(command);
    // Anything that was undone is unreachable once a new branch starts.
    undone.length = 0;
    while (done.length > limit) done.shift();
    notify();
    return command;
  }

  /** Applies a command for the first time and records it. */
  function run(command) {
    command.do();
    return push(command);
  }

  function undo() {
    const command = done.pop();
    if (!command) return null;
    command.undo();
    undone.push(command);
    notify();
    return command;
  }

  function redo() {
    const command = undone.pop();
    if (!command) return null;
    command.do();
    done.push(command);
    notify();
    return command;
  }

  function clear() {
    done.length = 0;
    undone.length = 0;
    notify();
  }

  return {
    push,
    run,
    undo,
    redo,
    clear,
    get canUndo() { return done.length > 0; },
    get canRedo() { return undone.length > 0; },
    get length() { return done.length; },
    get limit() { return limit; },
    /** Labels oldest-first, for tests and for the panel's tooltip. */
    labels() { return done.map((command) => command.label ?? 'edit'); },
  };
}

/**
 * The one command shape worth sharing: a transform change from `before` to
 * `after`, where both are plain `{ position, rotation, scale }` triples. Used
 * by the gizmo, the numeric fields, nudging and snap-to-ground alike, so all
 * four undo identically.
 */
export function transformCommand({ label = 'transform', apply, before, after }) {
  const copy = (value) => ({
    position: [...value.position],
    rotation: [...value.rotation],
    scale: [...value.scale],
  });
  const from = copy(before);
  const to = copy(after);
  return {
    label,
    do: () => apply(copy(to)),
    undo: () => apply(copy(from)),
  };
}

/** True when two transforms are identical — a drag that moved nothing is not a step. */
export function sameTransform(a, b, epsilon = 1e-6) {
  if (!a || !b) return false;
  for (const key of ['position', 'rotation', 'scale']) {
    for (let i = 0; i < 3; i += 1) {
      if (Math.abs(a[key][i] - b[key][i]) > epsilon) return false;
    }
  }
  return true;
}
