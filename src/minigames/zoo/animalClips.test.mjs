import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PropertyBinding } from 'three';
import {
  ANIMAL_CLIP_ROLES,
  CLIP_ANIMAL_IDS,
  parseAnimalClips,
} from './animalClips.js';

const bundlePath = fileURLToPath(new URL('../../../public/assets/animals/animal-clips.json', import.meta.url));
const bundle = JSON.parse(readFileSync(bundlePath, 'utf8'));

// These assert against the generated asset, not against a fixture, so a broken
// or stale `npm run build:animal-clips` fails here rather than in the browser.

test('the bundle covers exactly the eight animal-park animals', () => {
  assert.deepEqual(Object.keys(bundle.animals).sort(), [...CLIP_ANIMAL_IDS].sort());
  assert.equal(CLIP_ANIMAL_IDS.length, 8);
});

test('every animal parses into real clips with positive duration', () => {
  const parsed = parseAnimalClips(bundle);
  for (const id of CLIP_ANIMAL_IDS) {
    for (const role of ANIMAL_CLIP_ROLES[id]) {
      const clip = parsed[id][role];
      assert.ok(clip, `${id}.${role} missing`);
      assert.ok(clip.duration > 0, `${id}.${role} has duration ${clip.duration}`);
      assert.ok(clip.tracks.length > 0, `${id}.${role} has no tracks`);
    }
  }
});

test('the seven ITHappy animals each expose idle, walk and run', () => {
  const ithappy = CLIP_ANIMAL_IDS.filter((id) => id !== 'giraffe');
  assert.equal(ithappy.length, 7);
  for (const id of ithappy) {
    assert.deepEqual([...ANIMAL_CLIP_ROLES[id]], ['idle', 'walk', 'run']);
  }
});

test('the giraffe has an idle and a retargeted walk, and no run', () => {
  assert.deepEqual([...ANIMAL_CLIP_ROLES.giraffe], ['idle', 'walk']);
  assert.equal(bundle.animals.giraffe.idle.name, 'iddle');
  assert.equal(bundle.animals.giraffe.walk.name, 'cow_walk_retargeted');
  assert.equal(bundle.animals.giraffe.run, undefined);
});

test('no clip animates an armature wrapper or a leaf tip bone', () => {
  // `<Mesh>_rig` carries the FBX armature root motion, which would slide an
  // animating animal away from the position the roaming code sets. `*_end`
  // bones do not exist in the glTF models at all.
  for (const [id, roles] of Object.entries(bundle.animals)) {
    for (const [role, clip] of Object.entries(roles)) {
      for (const track of clip.tracks) {
        const { nodeName } = PropertyBinding.parseTrackName(track.name);
        assert.ok(!nodeName.endsWith('_rig'), `${id}.${role} animates ${nodeName}`);
        assert.ok(!nodeName.endsWith('_end'), `${id}.${role} animates ${nodeName}`);
      }
    }
  }
});

test('the giraffe walk carries rotation tracks only', () => {
  // The donor cow is a different shape. Borrowing its bone translations would
  // squash the giraffe into cow proportions, so only rotations are retargeted.
  const tracks = bundle.animals.giraffe.walk.tracks;
  assert.ok(tracks.length > 0);
  for (const track of tracks) {
    assert.ok(track.name.endsWith('.quaternion'), `${track.name} is not a rotation track`);
  }
});

test('every track has a whole number of values per keyframe', () => {
  for (const [id, roles] of Object.entries(bundle.animals)) {
    for (const [role, clip] of Object.entries(roles)) {
      for (const track of clip.tracks) {
        const stride = track.values.length / track.times.length;
        assert.ok(Number.isInteger(stride) && stride > 0,
          `${id}.${role} ${track.name} has ${track.values.length} values over ${track.times.length} times`);
      }
    }
  }
});

test('parseAnimalClips rejects an incomplete bundle', () => {
  assert.throws(() => parseAnimalClips({}), /no animals/);
  const missing = { animals: { ...bundle.animals } };
  delete missing.animals.chicken;
  assert.throws(() => parseAnimalClips(missing), /missing "chicken"/);
});
