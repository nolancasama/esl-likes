/**
 * What the child has coloured so far.
 *
 * Pure: a map from region id to palette colour, plus undo and the accounting
 * that decides whether the robot has been decorated enough to come alive. No
 * canvas and no DOM, so every rule here is testable without a browser.
 */

import { FREE_REGIONS, REGION_BY_ID, REGION_IDS } from './robotDefinition.js';

/** All seven lesson colours. The old three-colour restriction is gone. */
export const PALETTE = Object.freeze(['red', 'blue', 'yellow', 'green', 'pink', 'purple', 'orange']);

/** Hex used for filling. Line art always redraws on top, so these can be strong. */
export const PALETTE_HEX = Object.freeze({
  red: '#e2483d',
  blue: '#2f7dd1',
  yellow: '#f2c53d',
  green: '#4aa855',
  pink: '#ef85b5',
  purple: '#8c62c4',
  orange: '#ef8f3c',
});

/** How much of the free decoration has to be done before the robot wakes up. */
export const COMPLETION_THRESHOLD = 0.4;

export const isColor = (value) => PALETTE.includes(value);

export function createColorState(initial = {}) {
  /** @type {Map<string, string>} */
  const colors = new Map();
  const undoStack = [];

  for (const [regionId, color] of Object.entries(initial)) {
    if (REGION_BY_ID[regionId] && isColor(color)) colors.set(regionId, color);
  }

  /** Records the previous value so a single step can be taken back. */
  function remember(regionId) {
    undoStack.push({ regionId, previous: colors.get(regionId) ?? null });
    if (undoStack.length > 100) undoStack.shift();
  }

  const api = {
    /**
     * Fills one region. Returns false, without touching the stack, when
     * nothing would change — re-tapping a region in its current colour should
     * not cost an undo step.
     */
    fill(regionId, color) {
      if (!REGION_BY_ID[regionId] || !isColor(color)) return false;
      if (colors.get(regionId) === color) return false;
      remember(regionId);
      colors.set(regionId, color);
      return true;
    },

    /** Clears one region back to blank. The eraser. */
    clear(regionId) {
      if (!REGION_BY_ID[regionId] || !colors.has(regionId)) return false;
      remember(regionId);
      colors.delete(regionId);
      return true;
    },

    undo() {
      const step = undoStack.pop();
      if (!step) return null;
      if (step.previous === null) colors.delete(step.regionId);
      else colors.set(step.regionId, step.previous);
      return step.regionId;
    },

    /** The guarded `やりなおす`. One undo step, so it is not a cliff edge. */
    reset() {
      const before = api.snapshot();
      undoStack.length = 0;
      colors.clear();
      undoStack.push({ regionId: null, previous: null, whole: before });
      return true;
    },

    get(regionId) { return colors.get(regionId) ?? null; },
    has(regionId) { return colors.has(regionId); },
    get size() { return colors.size; },
    get canUndo() { return undoStack.length > 0; },

    /** A plain object, for scoring, for the puppet, and for tests. */
    snapshot() { return Object.fromEntries(colors); },

    restore(snapshot) {
      colors.clear();
      undoStack.length = 0;
      for (const [regionId, color] of Object.entries(snapshot ?? {})) {
        if (REGION_BY_ID[regionId] && isColor(color)) colors.set(regionId, color);
      }
    },

    /** How much of the optional decoration is done, 0..1. */
    completion() {
      if (!FREE_REGIONS.length) return 1;
      const done = FREE_REGIONS.filter((region) => colors.has(region.id)).length;
      return done / FREE_REGIONS.length;
    },

    isDecoratedEnough() { return api.completion() >= COMPLETION_THRESHOLD; },

    /** Regions with no colour yet — for the "decorate a bit more" nudge. */
    unpainted() { return REGION_IDS.filter((id) => !colors.has(id)); },
  };

  // `reset` pushes a whole-state step; undo has to understand it.
  const baseUndo = api.undo;
  api.undo = () => {
    const step = undoStack[undoStack.length - 1];
    if (step && step.whole) {
      undoStack.pop();
      colors.clear();
      for (const [regionId, color] of Object.entries(step.whole)) colors.set(regionId, color);
      return null;
    }
    return baseUndo();
  };

  return api;
}
