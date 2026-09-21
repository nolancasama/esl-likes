import { AnimationClip } from 'three';

/**
 * Animation clips for the eight animal-park animals.
 *
 * The models themselves carry almost no animation: Animals.glb ships seven
 * rigged skins with no clips at all, and giraffe.glb ships a single idle. The
 * clips are lifted from the original source packs by
 * `scripts/build-animal-clips.mjs` into `assets/animals/animal-clips.json`, and
 * bound to the loaded models here at runtime. Nothing rewrites the model files,
 * so their materials, texture atlas and tuned scales stay exactly as they were.
 *
 * Track names in the bundle already match the bone names three produces after
 * GLTFLoader sanitizes them, so a parsed clip binds to a cloned model with no
 * renaming step.
 */

export const CLIPS_ASSET = 'assets/animals/animal-clips.json';

/**
 * Which roles each animal actually has. The giraffe has no run cycle: its walk
 * is retargeted from another model and there was no second donor worth adding.
 * Consumers must treat `run` as optional for every animal.
 */
export const ANIMAL_CLIP_ROLES = Object.freeze({
  tiger: Object.freeze(['idle', 'walk', 'run']),
  horse: Object.freeze(['idle', 'walk', 'run']),
  dog: Object.freeze(['idle', 'walk', 'run']),
  deer: Object.freeze(['idle', 'walk', 'run']),
  cat: Object.freeze(['idle', 'walk', 'run']),
  penguin: Object.freeze(['idle', 'walk', 'run']),
  chicken: Object.freeze(['idle', 'walk', 'run']),
  giraffe: Object.freeze(['idle', 'walk']),
});

export const CLIP_ANIMAL_IDS = Object.freeze(Object.keys(ANIMAL_CLIP_ROLES));

/**
 * Turns a parsed bundle into `{ [animalId]: { idle, walk, run? } }` of real
 * THREE.AnimationClip instances. Kept separate from fetching so tests can feed
 * it the generated JSON straight from disk.
 */
export function parseAnimalClips(bundle) {
  const animals = bundle?.animals;
  if (!animals || typeof animals !== 'object') {
    throw new Error('animal clip bundle has no animals');
  }

  const parsed = {};
  for (const id of CLIP_ANIMAL_IDS) {
    const entry = animals[id];
    if (!entry) throw new Error(`animal clip bundle is missing "${id}"`);
    const clips = {};
    for (const role of ANIMAL_CLIP_ROLES[id]) {
      const json = entry[role];
      if (!json) throw new Error(`animal clip bundle is missing ${id}.${role}`);
      clips[role] = AnimationClip.parse(json);
    }
    parsed[id] = clips;
  }
  return parsed;
}

/** Fetches and parses the clip bundle. `fetchJson` is injectable for tests. */
export async function loadAnimalClips(fetchJson) {
  return parseAnimalClips(await fetchJson(CLIPS_ASSET));
}

const NAME_SUFFIX = /_\d+$/;

/**
 * Maps the bone names a clip expects onto the names a loaded model actually has.
 *
 * Animals.glb packs all seven animals into one glTF scene, and every one of them
 * uses the same bone names — `Root`, `spine004`, `thighR`. glTF has no problem
 * with that, but GLTFLoader must keep object names unique, so it renames the
 * repeats: the first animal in the file keeps `Root`, the next gets `Root_1`,
 * the next `Root_2`. Only the tiger comes out with the names its clips use, and
 * every other animal silently binds nothing.
 *
 * So the lookup is by base name — the name with any `_<digits>` suffix removed —
 * with an exact match always preferred. No bone in these packs ends in `_<n>` of
 * its own accord, so stripping the suffix is unambiguous.
 */
export function boneNameMap(model) {
  const exact = new Set();
  const byBase = new Map();
  model.traverse((object) => {
    if (!object.name) return;
    exact.add(object.name);
    const base = object.name.replace(NAME_SUFFIX, '');
    if (!byBase.has(base)) byBase.set(base, object.name);
  });
  return (name) => (exact.has(name) ? name : byBase.get(name) ?? null);
}

/**
 * Returns a copy of `clip` whose tracks address `model`'s real bone names.
 * Tracks with no counterpart are dropped rather than left to warn on every
 * frame; the caller can compare track counts to notice a bad retarget.
 */
export function retargetClip(clip, model) {
  const resolve = boneNameMap(model);
  const retargeted = clip.clone();
  retargeted.tracks = retargeted.tracks.reduce((kept, track) => {
    const separator = track.name.lastIndexOf('.');
    const nodeName = track.name.slice(0, separator);
    const property = track.name.slice(separator);
    const resolved = resolve(nodeName);
    if (resolved) {
      track.name = `${resolved}${property}`;
      kept.push(track);
    }
    return kept;
  }, []);
  return retargeted;
}
