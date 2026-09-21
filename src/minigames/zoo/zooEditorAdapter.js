/**
 * The Animal Park's adapter for the generic scene placement editor.
 *
 * Everything the editor cannot know — which models exist, how one is built,
 * where the ground is, what may not be walked through, which animals have
 * roaming waypoints — is answered here. The editor core
 * (`src/dev/scene-editor/`) imports nothing from this directory, and this file
 * is the only thing in the Zoo that knows the editor exists.
 *
 * This is the first adapter. `src/dev/scene-editor/demo/primitiveAdapter.js` is
 * the second, and it exists to keep the first from becoming load-bearing.
 */

import * as THREE from 'three';

import { ENVIRONMENT_MODELS } from './scenery.js';
import { bounds, canOccupy, colliders } from './layout.js';
import { TERRITORIES } from './territories.js';

/**
 * The shelves of the asset palette. These are kinds of thing, not places: a
 * rock is a rock wherever it stands, and being able to hide every rock in the
 * park at once is worth more when editing than hiding one corner of it.
 */
const CATEGORIES = Object.freeze([
  { id: 'vegetation', name: 'Trees & plants' },
  { id: 'rocks', name: 'Rocks' },
  { id: 'farm', name: 'Farm buildings' },
  { id: 'furniture', name: 'Cafe & seating' },
  { id: 'props', name: 'Props & fences' },
]);

const CATEGORY_BY_ASSET = Object.freeze({
  grass: 'vegetation',
  'grass-wispy': 'vegetation',
  bush: 'vegetation',
  'common-tree': 'vegetation',
  pine: 'vegetation',
  rock: 'rocks',
  planter: 'props',
  'low-fence': 'props',
  'long-fence': 'props',
  'cafe-table': 'furniture',
  'cafe-chair': 'furniture',
  crate: 'props',
  'farm-barn': 'farm',
  'farm-well': 'farm',
  'water-tower': 'farm',
  // Palette-only: shipped in the assets folder, placed nowhere yet.
  'bush-flowering': 'vegetation',
  'common-tree-b': 'vegetation',
  'dead-tree': 'vegetation',
  fern: 'vegetation',
  'flower-cluster': 'vegetation',
  'flower-patch': 'vegetation',
  'leafy-plant': 'vegetation',
  'pine-b': 'vegetation',
  'pine-c': 'vegetation',
  pebble: 'rocks',
  'pebble-flat': 'rocks',
  'rock-b': 'rocks',
  'rock-c': 'rocks',
  'rock-path': 'rocks',
});

const DISPLAY_NAMES = Object.freeze({
  grass: 'Grass (tall)',
  'grass-wispy': 'Grass (wispy)',
  bush: 'Bush',
  'common-tree': 'Common tree',
  pine: 'Pine',
  rock: 'Rock',
  planter: 'Planter',
  'low-fence': 'Fence (low)',
  'long-fence': 'Fence (long)',
  'cafe-table': 'Cafe table',
  'cafe-chair': 'Cafe chair',
  crate: 'Crate',
  'farm-barn': 'Barn',
  'farm-well': 'Well',
  'water-tower': 'Water tower',
  'bush-flowering': 'Bush (flowering)',
  'common-tree-b': 'Common tree B',
  'dead-tree': 'Dead tree',
  fern: 'Fern',
  'flower-cluster': 'Flowers (pink)',
  'flower-patch': 'Flowers (yellow)',
  'leafy-plant': 'Leafy plant',
  'pine-b': 'Pine B',
  'pine-c': 'Pine C',
  pebble: 'Pebble',
  'pebble-flat': 'Pebble (flat)',
  'rock-b': 'Rock B',
  'rock-c': 'Rock C',
  'rock-path': 'Rock path stone',
});

/**
 * The park's ground is one flat slab whose top sits at y = 0, so a ray-plane
 * intersection is both cheaper and more reliable than raycasting the mesh —
 * it still answers under a path slab, a region patch or a pool edge, where a
 * mesh raycast would return the thing lying on the ground instead of the
 * ground. A project with real terrain would raycast here instead; that is
 * exactly why the editor asks the adapter rather than assuming y = 0.
 */
const GROUND_PLANE = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

/** Roaming waypoints read the same colour they are drawn in the debug view. */
const ANIMAL_COLOURS = Object.freeze({
  tiger: 0xf5952b, horse: 0xc98b5a, dog: 0xd9d2c5, deer: 0xb5763f,
  cat: 0xe0a458, penguin: 0x33415c, chicken: 0xe8e2d0, giraffe: 0xe4b363,
});

export function createZooEditorAdapter({ zooWorld }) {
  if (!zooWorld?.createEnvironmentObject) {
    throw new Error('The Zoo editor adapter needs a built zoo world.');
  }

  return {
    id: 'animal-park',

    categories: CATEGORIES,

    // Only models that can safely be instantiated more than once. Every entry
    // in ENVIRONMENT_MODELS already is: each is a static mesh with no skeleton
    // and no animation, cloned from one loaded source.
    assets: ENVIRONMENT_MODELS.map((model) => ({
      id: model.key,
      name: DISPLAY_NAMES[model.key] ?? model.key,
      category: CATEGORY_BY_ASSET[model.key] ?? 'props',
    })),

    createAsset(assetId) {
      return zooWorld.createEnvironmentObject(assetId);
    },

    getGroundPoint(raycaster, out) {
      const hit = raycaster.ray.intersectPlane(GROUND_PLANE, out);
      if (!hit) return null;
      // Clamp rather than refuse: a ray aimed at the horizon lands thousands of
      // units away, and silently dropping the click reads as the editor being
      // broken. Placing at the park's edge is obvious and recoverable.
      hit.x = THREE.MathUtils.clamp(hit.x, bounds.minX, bounds.maxX);
      hit.z = THREE.MathUtils.clamp(hit.z, bounds.minZ, bounds.maxZ);
      hit.y = 0;
      return hit;
    },

    /**
     * Advisory, not a veto. Scenery is allowed to stand inside a collider — the
     * fountain has planting against it — but a roaming waypoint there would
     * trap an animal, which is what this is really for.
     */
    isPlaceable(x, _y, z) {
      if (x < bounds.minX || x > bounds.maxX || z < bounds.minZ || z > bounds.maxZ) {
        return 'outside the park';
      }
      if (!canOccupy(x, z, 0.72)) return 'inside a collider — an animal could not stand here';
      return true;
    },

    /**
     * The dressing the editor may move. Only groups drawn one object at a time
     * are selectable, which is why the world rebuilds its instanced groups as
     * individuals while the editor is open.
     */
    listExisting() {
      const existing = [];
      for (const group of zooWorld.getSceneryGroups()) {
        if (!group.objects) continue;
        group.objects.forEach((object, index) => {
          existing.push({
            id: `${group.name}-${String(index + 1).padStart(3, '0')}`,
            assetId: group.asset,
            category: CATEGORY_BY_ASSET[group.asset] ?? 'props',
            object,
            deletable: true,
            locked: false,
          });
        });
      }
      return existing;
    },

    /**
     * One group per animal, holding the waypoints `territories.js` authors.
     * `xz` format, because that file stores `[x, z]` pairs and an export that
     * cannot be pasted straight back into it is busywork.
     */
    pointGroups: TERRITORIES.map((territory) => ({
      id: territory.id,
      name: `${territory.id} (${territory.area})`,
      colour: ANIMAL_COLOURS[territory.id] ?? 0x3fa9f5,
      format: 'xz',
      points: territory.waypoints.map((point) => [point.x, point.z]),
    })),

    helpers: [
      {
        id: 'colliders',
        name: 'Colliders',
        build: () => buildColliderHelper(),
      },
      {
        id: 'territories',
        name: 'Territory bounds',
        build: () => buildTerritoryHelper(),
      },
    ],
  };
}

/** Wireframe outlines of everything `canOccupy` refuses. */
function buildColliderHelper() {
  const root = new THREE.Group();
  root.name = 'zoo-editor-colliders';
  const material = new THREE.LineBasicMaterial({ color: 0xff4d6d, transparent: true, opacity: 0.85 });

  for (const collider of colliders) {
    let outline;
    if (collider.type === 'circle') {
      const points = [];
      for (let i = 0; i <= 32; i += 1) {
        const angle = (i / 32) * Math.PI * 2;
        points.push(new THREE.Vector3(Math.cos(angle) * collider.r, 0, Math.sin(angle) * collider.r));
      }
      outline = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material);
    } else {
      const { hw, hd } = collider;
      outline = new THREE.Line(new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-hw, 0, -hd), new THREE.Vector3(hw, 0, -hd),
        new THREE.Vector3(hw, 0, hd), new THREE.Vector3(-hw, 0, hd),
        new THREE.Vector3(-hw, 0, -hd),
      ]), material);
      outline.rotation.y = -collider.rotation;
    }
    outline.position.set(collider.x, 0.06, collider.z);
    root.add(outline);
  }
  return root;
}

/** The box each animal's roaming is confined to. */
function buildTerritoryHelper() {
  const root = new THREE.Group();
  root.name = 'zoo-editor-territories';
  for (const territory of TERRITORIES) {
    const { minX, maxX, minZ, maxZ } = territory.bounds;
    const material = new THREE.LineBasicMaterial({
      color: ANIMAL_COLOURS[territory.id] ?? 0x3fa9f5,
      transparent: true,
      opacity: 0.6,
    });
    const outline = new THREE.Line(new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(minX, 0.04, minZ), new THREE.Vector3(maxX, 0.04, minZ),
      new THREE.Vector3(maxX, 0.04, maxZ), new THREE.Vector3(minX, 0.04, maxZ),
      new THREE.Vector3(minX, 0.04, minZ),
    ]), material);
    root.add(outline);
  }
  return root;
}
