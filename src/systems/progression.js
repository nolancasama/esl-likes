export const SAVE_KEY = 'esl-likes-save-v1';

export const DEFAULT_SETTINGS = Object.freeze({
  volume: 0.8,
  micFree: false,
  difficulty: 1,
  textSize: 'large',
});

function cleanRecord(value, cleanValue) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  const clean = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!key) continue;
    const next = cleanValue(entry);
    if (next !== undefined) clean[key] = next;
  }
  return clean;
}

function cleanSettings(value) {
  const source = value && typeof value === 'object' ? value : {};
  const volume = Number(source.volume);
  const difficulty = Number(source.difficulty);
  const textSizes = new Set(['normal', 'large', 'extraLarge']);

  return {
    volume: Number.isFinite(volume)
      ? Math.min(1, Math.max(0, volume))
      : DEFAULT_SETTINGS.volume,
    micFree: typeof source.micFree === 'boolean'
      ? source.micFree
      : DEFAULT_SETTINGS.micFree,
    difficulty: Number.isInteger(difficulty) && difficulty >= 1 && difficulty <= 3
      ? difficulty
      : DEFAULT_SETTINGS.difficulty,
    textSize: textSizes.has(source.textSize)
      ? source.textSize
      : DEFAULT_SETTINGS.textSize,
  };
}

function cleanState(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    version: 1,
    stamps: cleanRecord(source.stamps, (entry) => entry === true ? true : undefined),
    bestStars: cleanRecord(source.bestStars, (entry) => {
      const stars = Number(entry);
      return Number.isFinite(stars) && stars > 0
        ? Math.min(3, Math.max(1, Math.round(stars)))
        : undefined;
    }),
    answers: cleanRecord(source.answers, (entry) => {
      return typeof entry === 'string' && entry.trim() ? entry.trim() : undefined;
    }),
    zooPhotos: cleanRecord(source.zooPhotos, (entry) => {
      return typeof entry === 'string' && entry ? entry : undefined;
    }),
    settings: cleanSettings(source.settings),
  };
}

function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

function defaultStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function createProgression({ storage = defaultStorage() } = {}) {
  let state = cleanState(null);
  const listeners = new Set();

  try {
    const saved = storage?.getItem(SAVE_KEY);
    if (saved) state = cleanState(JSON.parse(saved));
  } catch {
    state = cleanState(null);
  }

  function persist() {
    try {
      storage?.setItem(SAVE_KEY, JSON.stringify(state));
    } catch {
      // Storage may be disabled, full, or unavailable in a private context.
      // The in-memory game remains fully playable.
    }
  }

  function notify() {
    const snapshot = copy(state);
    for (const listener of listeners) listener(snapshot);
  }

  function changed() {
    persist();
    notify();
  }

  return {
    getState() {
      return copy(state);
    },

    subscribe(listener) {
      if (typeof listener !== 'function') return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    awardStamp(id, stars = 1) {
      if (typeof id !== 'string' || !id) return;
      const result = Math.min(3, Math.max(1, Math.round(Number(stars) || 1)));
      state.stamps[id] = true;
      state.bestStars[id] = Math.max(state.bestStars[id] || 0, result);
      changed();
    },

    hasStamp(id) {
      return state.stamps[id] === true;
    },

    getBestStars(id) {
      return state.bestStars[id] || 0;
    },

    setAnswer(category, answer) {
      if (typeof category !== 'string' || !category) return;
      if (typeof answer === 'string' && answer.trim()) {
        state.answers[category] = answer.trim();
      } else {
        delete state.answers[category];
      }
      changed();
    },

    getAnswer(category) {
      return state.answers[category] ?? null;
    },

    setZooPhoto(id, photo) {
      if (typeof id !== 'string' || !id) return;
      if (typeof photo === 'string' && photo) {
        state.zooPhotos[id] = photo;
      } else {
        delete state.zooPhotos[id];
      }
      changed();
    },

    getZooPhotos() {
      return { ...state.zooPhotos };
    },

    getSettings() {
      return { ...state.settings };
    },

    updateSettings(update) {
      const patch = typeof update === 'function'
        ? update({ ...state.settings })
        : update;
      state.settings = cleanSettings({ ...state.settings, ...patch });
      changed();
      return { ...state.settings };
    },

    reset() {
      state = cleanState(null);
      changed();
    },
  };
}

