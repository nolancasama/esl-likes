/**
 * Builds public/assets/animals/animal-clips.json from the original animal
 * source packs. Run with `npm run build:animal-clips`.
 *
 * Why this exists: the shipped Animals.glb carries seven rigged skins but ZERO
 * animation clips, so the roaming animal park has nothing to play. The clips do
 * exist — inside the ITHappy pack's FBX meshes — and the FBX bone names happen
 * to match the glb's bones once GLTFLoader has sanitized them, so the clips can
 * be lifted out and bound to the existing models at runtime. That keeps
 * Animals.glb, its materials and its shared texture atlas untouched, and avoids
 * a Unity round-trip entirely.
 *
 * The giraffe is the exception: its pack ships no walk cycle, so its walk is
 * retargeted from the styloo cow, which uses a byte-for-byte identical rig.
 *
 * The source packs live outside the repository, in the owner's Downloads. They
 * are read, never copied in, and the generated JSON is what the game ships.
 */

import '../scripts/lib/dom-shim.mjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AnimationClip, PropertyBinding } from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { readUnityPackage, readZip } from './lib/archives.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const downloads = path.join(homedir(), 'Downloads');

const ITHAPPY_PACK = path.join(downloads, 'Unity_2021_Animals_FREE_v2.3.unitypackage');
const STYLOO_PACK = path.join(downloads, 'stylooanimalassetpack.zip');
const OUTPUT = path.join(projectRoot, 'public', 'assets', 'animals', 'animal-clips.json');

/**
 * Clip names are taken verbatim from the source FBX. The chicken's numbering is
 * irregular in the original pack (idle is _001_, walk is _003_, run is _002_),
 * so these are listed rather than derived from a pattern.
 */
const ITHAPPY_ANIMALS = [
  { id: 'tiger', mesh: 'Tiger_001', idle: 'Tiger_001_idle', walk: 'Tiger_001_walk', run: 'Tiger_001_run' },
  { id: 'horse', mesh: 'Horse_001', idle: 'Horse_001_idle', walk: 'Horse_001_walk', run: 'Horse_001_run' },
  { id: 'dog', mesh: 'Dog_001', idle: 'Dog_001_idle', walk: 'Dog_001_walk', run: 'Dog_001_run' },
  { id: 'deer', mesh: 'Deer_001', idle: 'Deer_001_idle', walk: 'Deer_001_walk', run: 'Deer_001_run' },
  { id: 'cat', mesh: 'Kitty_001', idle: 'Kitty_001_idle', walk: 'Kitty_001_walk', run: 'Kitty_001_run' },
  { id: 'penguin', mesh: 'Pinguin_001', idle: 'Pinguin_001_idle', walk: 'Pinguin_001_walk', run: 'Pinguin_001_run' },
  { id: 'chicken', mesh: 'Chicken_001', idle: 'Chicken_001_idle', walk: 'Chicken_003_walk', run: 'Chicken_002_run' },
];

const MESH_DIR = 'Assets/ithappy/Animals_FREE/Meshes/';

/**
 * Tracks targeting these are dropped. `<Mesh>_rig` is the FBX armature wrapper,
 * which has no counterpart in the glb; dropping it is what keeps an animating
 * animal from drifting away from the position the roaming code sets. `*_end`
 * bones are leaf tips Blender did not export into the glb.
 */
function isDroppedTarget(trackName) {
  const { nodeName } = PropertyBinding.parseTrackName(trackName);
  return nodeName.endsWith('_rig') || nodeName.endsWith('_end');
}

function round(value, places) {
  const factor = 10 ** places;
  const rounded = Math.round(value * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/**
 * Collapses a track whose values never change into a single keyframe.
 *
 * This is deliberately not "drop the track". A bone can sit at a constant
 * rotation that differs from its rest pose for a whole clip; dropping it would
 * snap the bone back to rest and break the pose. One keyframe preserves the
 * pose exactly and costs three or four numbers.
 */
function compactTrack(track) {
  const stride = track.values.length / track.times.length;
  let constant = true;
  for (let i = stride; i < track.values.length && constant; i += 1) {
    if (Math.abs(track.values[i] - track.values[i % stride]) > 1e-5) constant = false;
  }

  const places = track.name.endsWith('.quaternion') ? 5 : 4;
  if (constant) {
    return {
      name: track.name,
      type: track.ValueTypeName,
      times: [0],
      values: Array.from(track.values.slice(0, stride), (v) => round(v, places)),
    };
  }
  return {
    name: track.name,
    type: track.ValueTypeName,
    times: Array.from(track.times, (t) => round(t, 4)),
    values: Array.from(track.values, (v) => round(v, places)),
  };
}

function serializeClip(clip, { rotationOnly = false } = {}) {
  const tracks = clip.tracks
    .filter((track) => !isDroppedTarget(track.name))
    // The giraffe borrows another animal's walk. Its bone offsets are its own —
    // a far longer neck and legs — so only rotations transfer; inheriting the
    // donor's translations and scales would deform it into the donor's shape.
    .filter((track) => !rotationOnly || track.name.endsWith('.quaternion'))
    .map(compactTrack);

  return { name: clip.name, duration: round(clip.duration, 4), tracks };
}

function parseFbx(buffer) {
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  return new FBXLoader().parse(arrayBuffer, '');
}

function parseGltf(buffer) {
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  return new Promise((resolve, reject) => {
    new GLTFLoader().parse(arrayBuffer, '', resolve, reject);
  });
}

function requireClip(clips, name, context) {
  const clip = clips.find((candidate) => candidate.name === name);
  if (!clip) {
    throw new Error(`${context}: no clip named "${name}" (found: ${clips.map((c) => c.name).join(', ')})`);
  }
  return clip;
}

/** Bone names present in a glb, as GLTFLoader will have sanitized them. */
function glbNodeNames(buffer) {
  let json;
  if (buffer.readUInt32LE(0) === 0x46546c67) {
    let offset = 12;
    while (offset < buffer.length) {
      const length = buffer.readUInt32LE(offset);
      const type = buffer.readUInt32LE(offset + 4);
      if (type === 0x4e4f534a) {
        json = JSON.parse(buffer.toString('utf8', offset + 8, offset + 8 + length));
        break;
      }
      offset += 8 + length;
    }
  } else {
    json = JSON.parse(buffer.toString('utf8'));
  }
  return new Set(json.nodes.map((node) => PropertyBinding.sanitizeNodeName(node.name || '')));
}

function reportBinding(label, clipJson, targetNames) {
  const targets = new Set(clipJson.tracks.map((track) => PropertyBinding.parseTrackName(track.name).nodeName));
  const missing = [...targets].filter((name) => !targetNames.has(name));
  if (missing.length) {
    throw new Error(`${label}: ${missing.length} track target(s) absent from the model: ${missing.join(', ')}`);
  }
  return targets.size;
}

async function main() {
  console.log('Reading source packs…');
  const ithappy = readUnityPackage(readFileSync(ITHAPPY_PACK));
  const styloo = readZip(readFileSync(STYLOO_PACK));

  const animalsGlb = readFileSync(path.join(projectRoot, 'public/assets/animals/Animals.glb'));
  const giraffeGlb = readFileSync(path.join(projectRoot, 'public/assets/animals/giraffe.glb'));
  const animalsBones = glbNodeNames(animalsGlb);
  const giraffeBones = glbNodeNames(giraffeGlb);

  const animals = {};

  for (const spec of ITHAPPY_ANIMALS) {
    const fbx = ithappy.get(`${MESH_DIR}${spec.mesh}.fbx`);
    if (!fbx) throw new Error(`${spec.id}: ${spec.mesh}.fbx not found in the ITHappy pack`);
    const clips = parseFbx(fbx).animations;

    const entry = {};
    for (const role of ['idle', 'walk', 'run']) {
      const serialized = serializeClip(requireClip(clips, spec[role], spec.id));
      const bound = reportBinding(`${spec.id}.${role}`, serialized, animalsBones);
      entry[role] = serialized;
      if (role === 'walk') console.log(`  ${spec.id}: ${bound} bones bound, walk ${serialized.duration}s`);
    }
    animals[spec.id] = entry;
  }

  // The giraffe's own pack ships a single clip, the misspelled "iddle".
  const giraffeClips = (await parseGltf(giraffeGlb)).animations;
  const cowClips = (await parseGltf(styloo.get('stylooanimalassetpack/glb/Cow.glb'))).animations;

  const giraffeIdle = serializeClip(requireClip(giraffeClips, 'iddle', 'giraffe'));
  const giraffeWalk = serializeClip(requireClip(cowClips, 'walk', 'giraffe walk donor'), { rotationOnly: true });
  giraffeWalk.name = 'cow_walk_retargeted';
  reportBinding('giraffe.idle', giraffeIdle, giraffeBones);
  const bound = reportBinding('giraffe.walk', giraffeWalk, giraffeBones);
  console.log(`  giraffe: ${bound} bones bound, walk ${giraffeWalk.duration}s (retargeted from the styloo cow)`);

  animals.giraffe = { idle: giraffeIdle, walk: giraffeWalk };

  const bundle = {
    note: 'Generated by scripts/build-animal-clips.mjs. Do not edit by hand.',
    source: {
      ithappy: path.basename(ITHAPPY_PACK),
      styloo: path.basename(STYLOO_PACK),
    },
    animals,
  };

  mkdirSync(path.dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, JSON.stringify(bundle));
  const bytes = readFileSync(OUTPUT).length;
  console.log(`\nWrote ${path.relative(projectRoot, OUTPUT)} — ${(bytes / 1024).toFixed(0)} KB, ${Object.keys(animals).length} animals`);
}

await main();
