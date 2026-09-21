import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import {
  PATH_WIDTH,
  bounds as campusBounds,
  colliders,
  landmarks,
  pathEdges,
  pathNodes,
  regions,
} from './layout.js';
import { AREAS, TERRITORIES } from './territories.js';
import { ENVIRONMENT_MODELS, SCENERY_GROUPS } from './scenery.js';
import { createRng, spawnAnimals } from './roaming.js';
import { createAnimalAnimator } from './animalAnimator.js';
import { CLIPS_ASSET, parseAnimalClips } from './animalClips.js';

const TAU = Math.PI * 2;

// Ground tints used where an area wants a hint of its animals' colouring.
// Nothing here fences anything: the park is one continuous space.
const ANIMAL_MODELS = Object.freeze({
  // Every one of these models faces local +z at rotation 0, and the roaming
  // code sets an animal's rotation to its heading, so no yaw offset is wanted.
  // The old zoo carried `yawOffset: Math.PI` from when animals stood still in
  // pens; applied to a walking animal it turns it through 180 degrees and it
  // moonwalks to its destination.
  tiger: Object.freeze({ file: 'Animals.glb', node: 'tiger', targetHeight: 1.65 }),
  horse: Object.freeze({ file: 'Animals.glb', node: 'horse.001', targetHeight: 2.2 }),
  dog: Object.freeze({ file: 'Animals.glb', node: 'dog.001', targetHeight: 1.15 }),
  deer: Object.freeze({ file: 'Animals.glb', node: 'deer', targetHeight: 2 }),
  cat: Object.freeze({ file: 'Animals.glb', node: 'kitty.001', targetHeight: 0.8 }),
  penguin: Object.freeze({ file: 'Animals.glb', node: 'pinguin.001', targetHeight: 1.3 }),
  // A large hen rather than a bantam. At 0.8 the chicken had to be framed from
  // inside about three units, and walking at 1.2 it crossed that whole window
  // in a second and a half. It is still comfortably the smallest animal.
  chicken: Object.freeze({ file: 'Animals.glb', node: 'chicken.001', targetHeight: 1.05 }),
  giraffe: Object.freeze({ file: 'giraffe.glb', targetHeight: 3.65 }),
});

// The model list and every placement in the park now live in `scenery.js` as
// pure data, so the scene placement editor can read a placement, move it and
// write it back. See that file for why the plant palette is as short as it is.

function publicPath(path) {
  return `${import.meta.env?.BASE_URL || './'}${path}`;
}

export function createZooWorld({ labels = {}, seed = null } = {}) {
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  const canvases = new Set();
  const modelSources = new Set();
  const animations = [];
  const animators = [];
  // A seeded generator when one is supplied, so a test or a harness run can
  // reproduce an exact park; otherwise the animals start somewhere new.
  const roamRng = createRng(Number.isFinite(seed) ? seed : Math.floor(Math.random() * 0xffffffff));
  let animalClips = null;
  let clipStatus = 'idle';
  const modelAbort = new AbortController();
  let loadPromise = null;
  let environmentLoadPromise = null;
  let environmentStatus = 'loading';
  let environmentPending = ENVIRONMENT_MODELS.length;
  let loadedEnvironmentModels = 0;
  const failedEnvironmentAssets = [];
  let beforeDressingStats = null;
  let afterDressingStats = null;
  let elapsed = 0;
  let disposed = false;

  const ownGeometry = (geometry) => {
    geometries.add(geometry);
    return geometry;
  };
  const ownMaterial = (material) => {
    materials.add(material);
    return material;
  };
  const makeMaterial = (color, options = {}) => ownMaterial(new THREE.MeshStandardMaterial({
    color,
    roughness: 0.82,
    metalness: 0,
    flatShading: true,
    ...options,
  }));
  const addMesh = (parent, geometry, material, x, y, z, sx = 1, sy = 1, sz = 1) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    parent.add(mesh);
    return mesh;
  };
  const photoOccluders = [];
  const markPhotoOccluder = (mesh) => {
    photoOccluders.push(mesh);
    return mesh;
  };
  const visibilityRaycaster = new THREE.Raycaster();
  const visibilityOrigin = new THREE.Vector3();
  const visibilityTarget = new THREE.Vector3();
  const visibilityDirection = new THREE.Vector3();
  const visibilityHits = [];

  const group = new THREE.Group();
  group.name = 'zoo-world';
  const environmentRoot = new THREE.Group();
  environmentRoot.name = 'zoo-environment-dressing';
  group.add(environmentRoot);

  const box = ownGeometry(new THREE.BoxGeometry(1, 1, 1));
  const cylinder = ownGeometry(new THREE.CylinderGeometry(0.5, 0.5, 1, 12));
  const lowCylinder = ownGeometry(new THREE.CylinderGeometry(0.5, 0.5, 1, 24));
  const sphere = ownGeometry(new THREE.SphereGeometry(0.5, 12, 8));
  // Ground greens are taken from the Quaternius grass palette (Grass.png is a
  // colour ramp: olive #b19800, green #399600, rust #b95700, yellow-green
  // #67a300) so the field and the grass standing on it belong to one picture.
  // The old 0x75b866 was a bluer green and the grass tufts read as stuck on.
  const grass = makeMaterial(0x74ad3d);
  const pathMaterial = makeMaterial(0xe8d3a4);
  const plazaMaterial = makeMaterial(0xd9cab3);
  const stone = makeMaterial(0xb0a79d);
  const stoneDark = makeMaterial(0x777b83);
  const water = makeMaterial(0x4bb9d1, { transparent: true, opacity: 0.8 });
  const bridgeBlue = makeMaterial(0x3f86b7);
  const mud = makeMaterial(0x7f5b43, { roughness: 1 });
  const leaf = makeMaterial(0x4f9955);
  const leafLight = makeMaterial(0x72b85d);
  const bark = makeMaterial(0x765137);
  const gateRed = makeMaterial(0xe95b55);
  const gateWhite = makeMaterial(0xfff7df);
  const dark = makeMaterial(0x29384a);
  const regionMaterials = Object.freeze({
    grassland: makeMaterial(0x8cbd4e),
    woodland: makeMaterial(0x3f7a2a),
    farm: makeMaterial(0x7fb340),
    cove: makeMaterial(0x8faeb2),
  });
  const barnRed = makeMaterial(0xb94e42);
  const barnTrim = makeMaterial(0xf4e6cb);
  const timber = makeMaterial(0x9d7448);
  const hay = makeMaterial(0xd7af50);
  const paleRock = makeMaterial(0xbec9c7);

  const worldWidth = campusBounds.maxX - campusBounds.minX;
  const worldDepth = campusBounds.maxZ - campusBounds.minZ;
  const worldCenterX = (campusBounds.minX + campusBounds.maxX) * 0.5;
  const worldCenterZ = (campusBounds.minZ + campusBounds.maxZ) * 0.5;
  addMesh(group, box, grass, worldCenterX, -0.24, worldCenterZ, worldWidth, 0.5, worldDepth);

  // Flat-coloured ground patches give each broad area its own tint. They are
  // scenery, not boundaries: they overlap, nothing collides with them, and no
  // sign names them. Reading the ground is how a child tells the areas apart.
  const regionPatchScale = Object.freeze({
    grassland: [34, 28],
    woodland: [34, 28],
    farm: [30, 26],
    cove: [20, 20],
  });
  for (const region of regions) {
    const material = regionMaterials[region.id];
    const scale = regionPatchScale[region.id];
    if (!material || !scale) continue;
    const patch = addMesh(group, lowCylinder, material, region.center.x, 0.015, region.center.z,
      scale[0], 0.04, scale[1]);
    patch.name = `zoo-region-${region.id}`;
    patch.rotation.y = region.id === 'woodland' ? -0.22 : region.id === 'farm' ? 0.17 : 0;
  }

  // Edges form a curving figure-eight polyline. Wide slabs plus round joints
  // make the bends continuous and forgiving without adding geometry per frame.
  const nodeById = new Map(pathNodes.map((node) => [node.id, node]));
  const pathWidth = PATH_WIDTH;
  for (const [fromId, toId] of pathEdges) {
    const from = nodeById.get(fromId);
    const to = nodeById.get(toId);
    if (!from || !to) continue;
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const length = Math.hypot(dx, dz) + 0.2;
    const slab = addMesh(group, box, pathMaterial,
      (from.x + to.x) * 0.5, 0.015, (from.z + to.z) * 0.5,
      pathWidth, 0.08, length);
    slab.name = `zoo-path-${fromId}-${toId}`;
    slab.rotation.y = Math.atan2(dx, dz);
  }
  for (const node of pathNodes) {
    const joint = addMesh(group, lowCylinder, pathMaterial, node.x, 0.018, node.z,
      pathWidth, 0.08, pathWidth);
    joint.name = `zoo-path-node-${node.id}`;
  }

  const landmarkById = new Map(landmarks.map((landmark) => [landmark.id, landmark]));
  const plazaPosition = landmarkById.get('plaza')
    ?? pathNodes.find((node) => node.kind === 'plaza')
    ?? { x: 0, z: 27.6 };
  const plaza = addMesh(group, lowCylinder, plazaMaterial,
    plazaPosition.x, 0.025, plazaPosition.z, 7, 0.14, 6);
  plaza.name = 'zoo-entrance-plaza';
  plaza.rotation.y = Math.PI / 16;

  // The plaza reads as an entrance even before any optional model arrives.
  const boothPosition = landmarkById.get('ticketBooth') ?? { x: 5.8, z: 35.8 };
  const booth = new THREE.Group();
  booth.name = 'zoo-ticket-booth';
  group.add(booth);
  markPhotoOccluder(addMesh(booth, box, gateWhite, boothPosition.x, 1.35, boothPosition.z, 2.7, 2.7, 2.15));
  markPhotoOccluder(addMesh(booth, box, gateRed, boothPosition.x, 2.86, boothPosition.z, 3.15, 0.35, 2.55));
  addMesh(booth, box, dark, boothPosition.x + 0.75, 1.48, boothPosition.z + 1.085, 0.85, 0.78, 0.08);

  const benchMaterial = timber;
  for (const [x, z, yaw] of [[-4.3, 27.2, -0.18], [4.2, 27.1, 0.18]]) {
    const bench = new THREE.Group();
    bench.name = 'zoo-plaza-bench';
    group.add(bench);
    const seat = addMesh(bench, box, benchMaterial, x, 0.58, z, 2.35, 0.18, 0.72);
    seat.rotation.y = yaw;
    const back = addMesh(bench, box, benchMaterial, x, 1.02, z + 0.31, 2.35, 0.72, 0.16);
    back.rotation.y = yaw;
    for (const dx of [-0.85, 0.85]) addMesh(bench, box, dark, x + dx, 0.3, z, 0.12, 0.6, 0.12);
  }
  for (const [x, z] of [[-4.2, 34.2], [4.2, 34.2], [-5.2, 25.7], [5.2, 25.7]]) {
    addMesh(group, cylinder, dark, x, 1.55, z, 0.12, 3.1, 0.12);
    addMesh(group, sphere, gateWhite, x, 3.18, z, 0.5, 0.58, 0.5);
  }

  const terrace = addMesh(group, lowCylinder, plazaMaterial, 7.8, 0.04, 32.2, 5.6, 0.1, 4.9);
  terrace.name = 'zoo-cafe-terrace';

  const fountainPosition = landmarkById.get('fountainHub')
    ?? pathNodes.find((node) => node.kind === 'hub')
    ?? { x: 0, z: 0 };
  markPhotoOccluder(addMesh(group, lowCylinder, stone,
    fountainPosition.x, 0.25, fountainPosition.z, 2.05, 0.5, 2.05));
  addMesh(group, lowCylinder, water, fountainPosition.x, 0.51, fountainPosition.z, 1.67, 0.08, 1.67);
  markPhotoOccluder(addMesh(group, cylinder, stoneDark,
    fountainPosition.x, 1.35, fountainPosition.z, 0.36, 2.25, 0.36));
  addMesh(group, lowCylinder, stone, fountainPosition.x, 2.25, fountainPosition.z, 1.05, 0.22, 1.05);
  addMesh(group, lowCylinder, water, fountainPosition.x, 2.39, fountainPosition.z, 0.84, 0.08, 0.84);
  const fountainTop = addMesh(group, sphere, water,
    fountainPosition.x, 3.12, fountainPosition.z, 0.25, 1.25, 0.25);
  fountainTop.userData.baseY = 3.12;
  fountainTop.name = 'zoo-central-fountain-jet';
  animations.push({ kind: 'fountain', object: fountainTop });

  const treePosition = landmarkById.get('giantForestTree');
  if (treePosition) {
    markPhotoOccluder(addMesh(group, cylinder, bark,
      treePosition.x, 2.6, treePosition.z, 0.95, 5.2, 0.95));
    addMesh(group, sphere, leaf, treePosition.x, 6, treePosition.z, 3.8, 3.45, 3.8);
    addMesh(group, sphere, leafLight, treePosition.x + 1.35, 6.55, treePosition.z - 0.35, 2.3, 2.15, 2.3);
  }

  // The giraffe's feeding post is gone with the enclosures. It was a fixture of
  // a pen the giraffe no longer lives in, it stood in the way of a third of the
  // routes across its territory, and a blank board on a post read as one more
  // sign in a park that is meant to have none.

  // A shallow watering hollow. It was dug for the elephant, which is no longer
  // in the lesson, but it is good grassland scenery and a landmark to steer by.
  const wateringHollow = addMesh(group, lowCylinder, mud, -17.1, 0.06, 9.1, 4.1, 0.1, 2.8);
  wateringHollow.name = 'zoo-watering-hollow';
  wateringHollow.rotation.y = -0.35;

  const forestLog = markPhotoOccluder(addMesh(group, cylinder, bark, -30, 0.48, -19, 0.72, 3.2, 0.72));
  forestLog.name = 'zoo-forest-fallen-log';
  forestLog.rotation.z = Math.PI / 2;
  forestLog.rotation.y = 0.35;

  for (const [x, z, scaleAmount] of [[27, 27, 1], [28.2, 27.1, 0.78]]) {
    const bale = addMesh(group, box, hay, x, 0.55 * scaleAmount, z,
      1.2 * scaleAmount, 1.1 * scaleAmount, 1.1 * scaleAmount);
    bale.name = 'zoo-farm-hay-bale';
    bale.rotation.y = 0.12;
  }
  const trough = addMesh(group, box, timber, 20.2, 0.45, 27, 2.6, 0.65, 0.8);
  trough.name = 'zoo-farm-trough';
  addMesh(group, box, dark, 20.2, 0.7, 27, 2.2, 0.1, 0.58);

  const barnPosition = landmarkById.get('barn');
  let barnFallback = null;
  if (barnPosition) {
    barnFallback = new THREE.Group();
    barnFallback.name = 'zoo-barn-procedural-fallback';
    group.add(barnFallback);
    const barnCollider = colliders.find((collider) => collider.landmarkId === 'barn');
    const barnWidth = (barnCollider?.hw ?? 2.7) * 2;
    const barnDepth = (barnCollider?.hd ?? 2.1) * 2;
    const barnBody = addMesh(barnFallback, box, barnRed,
      barnPosition.x, 2, barnPosition.z, barnWidth, 4, barnDepth);
    markPhotoOccluder(barnBody);
    barnBody.rotation.y = barnCollider?.rotation ?? 0;
    const roof = addMesh(barnFallback, box, barnTrim, barnPosition.x, 4.35, barnPosition.z, 6.1, 0.75, 4.8);
    markPhotoOccluder(roof);
    roof.rotation.y = barnCollider?.rotation ?? 0;
    markPhotoOccluder(addMesh(barnFallback, box, dark,
      barnPosition.x, 1.4, barnPosition.z + 2.12, 1.8, 2.8, 0.12));
  }

  const bridgePosition = landmarkById.get('penguinBridge');
  if (bridgePosition) {
    markPhotoOccluder(addMesh(group, box, bridgeBlue,
      bridgePosition.x, 0.42, bridgePosition.z, 5.6, 0.35, 1.5));
    for (const zOffset of [-0.8, 0.8]) {
      markPhotoOccluder(addMesh(group, box, bridgeBlue,
        bridgePosition.x, 1.05, bridgePosition.z + zOffset, 5.8, 0.18, 0.18));
      for (const xOffset of [-2.65, 0, 2.65]) {
        addMesh(group, cylinder, paleRock,
          bridgePosition.x + xOffset, 0.75, bridgePosition.z + zOffset, 0.15, 1.3, 0.15);
      }
    }
  }

  // Pale pool-edge blocks make every solid cove boundary visible and use the
  // exact boxes that navigation tests and player collision use.
  for (const edge of colliders.filter((collider) => collider.role === 'poolEdge')) {
    const rockEdge = addMesh(group, box, paleRock, edge.x, 0.32, edge.z,
      edge.hw * 2, 0.64, edge.hd * 2);
    markPhotoOccluder(rockEdge);
    rockEdge.rotation.y = edge.rotation;
  }

  // The cove water fills the rectangle the pool-edge colliders enclose, so the
  // visible water and the boundary the penguin walks around cannot drift apart.
  const poolEdges = colliders.filter((collider) => collider.role === 'poolEdge');
  if (poolEdges.length) {
    const xs = poolEdges.map((edge) => edge.x);
    const zs = poolEdges.map((edge) => edge.z);
    addMesh(group, lowCylinder, water,
      (Math.min(...xs) + Math.max(...xs)) / 2, 0.01, (Math.min(...zs) + Math.max(...zs)) / 2,
      6.65, 0.06, 6.1);
  }

  // Stand-in shown until an animal's model arrives, so the park is never empty.
  const placeholderMaterial = makeMaterial(0x91a0aa, { transparent: true, opacity: 0.82 });

  function createPlaceholder(targetHeight) {
    const placeholder = new THREE.Group();
    const bodyHeight = targetHeight * 0.58;
    addMesh(placeholder, box, placeholderMaterial, 0, bodyHeight * 0.5, 0,
      targetHeight * 0.62, bodyHeight, targetHeight * 0.36);
    addMesh(placeholder, sphere, placeholderMaterial, 0, targetHeight * 0.72, targetHeight * 0.2,
      targetHeight * 0.22, targetHeight * 0.22, targetHeight * 0.22);
    return placeholder;
  }

  /**
   * Sizes the photo target from the model's bounds.
   *
   * The target is a child of the animal's own group, so it travels with the
   * animal for free: framing, occlusion and shutter readiness all read its
   * current world position rather than any fixed spot on the map.
   */
  function applyPhotoBounds(subject, object) {
    object.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(object);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    subject.animal.worldToLocal(center);
    subject.photoTarget.position.copy(center);
    subject.photoRadius = Math.max(0.18, Math.max(size.x, size.z) * 0.5);
    // Tall, narrow animals (penguin, giraffe) were judged by their width alone
    // and never counted as framed; height is measured separately.
    subject.photoHalfHeight = Math.max(0.18, size.y * 0.5);
  }

  // Every animal roams; none of them has a pen, a gate or a viewpoint. The
  // roaming brain is pure (roaming.js) and the group below is only its puppet.
  const roamers = spawnAnimals({ rng: roamRng, avoid: { x: 0, z: 31, radius: 12 } });

  const habitats = TERRITORIES.map((territory) => {
    const roamer = roamers[territory.id];
    const animal = new THREE.Group();
    animal.name = `zoo-animal-${territory.id}`;
    animal.userData.animalId = territory.id;
    animal.position.set(roamer.x, 0, roamer.z);
    animal.rotation.y = roamer.facing;
    group.add(animal);

    const photoTarget = new THREE.Object3D();
    photoTarget.name = `zoo-photo-target-${territory.id}`;
    animal.add(photoTarget);

    const placeholder = createPlaceholder(ANIMAL_MODELS[territory.id].targetHeight);
    animal.add(placeholder);

    const subject = {
      id: territory.id,
      area: territory.area,
      region: territory.area,
      roamer,
      // `x`/`z` are kept in step with the roamer each frame so that anything
      // still reading them as a position gets the live one, never a pen centre.
      x: roamer.x,
      z: roamer.z,
      group: animal,
      animal,
      photoTarget,
      photoRadius: 0,
      placeholder,
      animator: null,
    };
    applyPhotoBounds(subject, placeholder);
    return subject;
  });

  const habitatById = new Map(habitats.map((subject) => [subject.id, subject]));

  function disposeModelSource(root, extraMaterials = []) {
    const sourceGeometries = new Set();
    const sourceMaterials = new Set();
    const sourceTextures = new Set();
    root.traverse((object) => {
      if (!object.isMesh) return;
      if (object.geometry) sourceGeometries.add(object.geometry);
      const meshMaterials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of meshMaterials) {
        if (!material) continue;
        sourceMaterials.add(material);
        for (const value of Object.values(material)) {
          if (value?.isTexture) sourceTextures.add(value);
        }
      }
    });
    for (const material of extraMaterials) {
      if (material) sourceMaterials.add(material);
    }
    for (const texture of sourceTextures) texture.dispose();
    for (const material of sourceMaterials) material.dispose();
    for (const geometry of sourceGeometries) geometry.dispose();
  }

  function placeModel(habitat, sourceObject, clips = null) {
    const config = ANIMAL_MODELS[habitat.id];
    // Object3D.clone() does not rebind a skeleton, and every animal in the park
    // is skinned now, so this always goes through SkeletonUtils.
    const sourceClone = cloneSkinned(sourceObject);
    sourceClone.updateMatrixWorld(true);
    const rawBounds = new THREE.Box3().setFromObject(sourceClone);
    const rawSize = rawBounds.getSize(new THREE.Vector3());
    if (!Number.isFinite(rawSize.y) || rawSize.y <= 0) {
      throw new Error(`${habitat.id} has invalid bounds`);
    }

    const content = new THREE.Group();
    const scale = config.targetHeight / rawSize.y;
    const center = rawBounds.getCenter(new THREE.Vector3());
    content.scale.setScalar(scale);
    content.position.set(-center.x * scale, -rawBounds.min.y * scale, -center.z * scale);
    content.add(sourceClone);
    if (config.tint) {
      sourceClone.traverse((object) => {
        if (!object.isMesh || !object.material) return;
        const sources = Array.isArray(object.material) ? object.material : [object.material];
        const tinted = sources.map((material) => {
          const colour = config.tint[material.name];
          if (colour === undefined) return material;
          const copy = ownMaterial(material.clone());
          copy.color.setHex(colour);
          return copy;
        });
        object.material = tinted.length === 1 ? tinted[0] : tinted;
      });
    }
    content.updateMatrixWorld(true);

    const oriented = new THREE.Group();
    oriented.rotation.y = config.yawOffset ?? 0;
    oriented.add(content);
    oriented.updateMatrixWorld(true);

    habitat.animal.remove(habitat.placeholder);
    habitat.animal.add(oriented);
    habitat.model = oriented;
    applyPhotoBounds(habitat, oriented);

    // The animator is bound to the skinned clone, not to the wrapper groups
    // that carry the scale and the yaw offset, so the clips address bones.
    if (clips) {
      habitat.animator = createAnimalAnimator(sourceClone, clips, {
        clipSpeed: habitat.roamer.clipSpeed,
      });
      habitat.animator.syncTo(habitat.roamer.state, habitat.roamer.speed);
      animators.push(habitat.animator);
    }
  }

  async function fetchAsset(path, responseType) {
    const response = await fetch(publicPath(path), { cache: 'force-cache', signal: modelAbort.signal });
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    if (responseType === 'text') return response.text();
    if (responseType === 'json') return response.json();
    return response.arrayBuffer();
  }

  async function loadGltf(file) {
    const path = `assets/animals/${file}`;
    const loader = new GLTFLoader();
    const gltf = await loader.parseAsync(await fetchAsset(path, 'arrayBuffer'), publicPath('assets/animals/'));
    return { scene: gltf.scene, materials: [], animations: gltf.animations };
  }

  async function loadEnvironmentGltf(config) {
    const directory = `assets/zoo/environment/${config.folder}/`;
    const path = `${directory}${config.file}`;
    const loader = new GLTFLoader();
    let source;
    if (config.folder === 'kaykit-restaurant') {
      // KayKit's shared atlas is 1024px. Keep the CC0 furniture geometry but
      // remove texture slots before parsing so the Zoo never requests or uploads
      // an image above the campus' 512px Chromebook budget.
      const document = JSON.parse(await fetchAsset(path, 'text'));
      for (const material of document.materials ?? []) {
        delete material.normalTexture;
        delete material.occlusionTexture;
        delete material.emissiveTexture;
        if (material.pbrMetallicRoughness) {
          delete material.pbrMetallicRoughness.baseColorTexture;
          delete material.pbrMetallicRoughness.metallicRoughnessTexture;
          material.pbrMetallicRoughness.baseColorFactor = [0.76, 0.55, 0.34, 1];
        }
      }
      delete document.images;
      delete document.textures;
      delete document.samplers;
      source = JSON.stringify(document);
    } else {
      source = await fetchAsset(path, 'arrayBuffer');
    }
    const gltf = await loader.parseAsync(source, publicPath(directory));
    return { scene: gltf.scene, materials: [] };
  }

  async function loadEnvironmentObj(config) {
    const directory = `assets/zoo/environment/${config.folder}/`;
    const resourcePath = publicPath(directory);
    let preparedMaterials = null;
    try {
      const materialText = await fetchAsset(`${directory}${config.materialFile}`, 'text');
      preparedMaterials = new MTLLoader().parse(materialText, resourcePath);
      preparedMaterials.preload();
      const modelText = await fetchAsset(`${directory}${config.file}`, 'text');
      const scene = new OBJLoader().setMaterials(preparedMaterials).parse(modelText);
      return { scene, materials: Object.values(preparedMaterials.materials) };
    } catch (error) {
      if (preparedMaterials) {
        for (const material of Object.values(preparedMaterials.materials)) material.dispose();
      }
      throw error;
    }
  }

  function normalisedModel(source, targetHeight) {
    const clone = source.clone(true);
    clone.updateMatrixWorld(true);
    const sourceBounds = new THREE.Box3().setFromObject(clone);
    const size = sourceBounds.getSize(new THREE.Vector3());
    if (!Number.isFinite(size.y) || size.y <= 0) throw new Error('environment model has invalid bounds');
    const scale = targetHeight / size.y;
    const center = sourceBounds.getCenter(new THREE.Vector3());
    const root = new THREE.Group();
    clone.scale.setScalar(scale);
    clone.position.set(-center.x * scale, -sourceBounds.min.y * scale, -center.z * scale);
    root.add(clone);
    root.updateMatrixWorld(true);
    return root;
  }

  function addEnvironmentClone(config, source, placement, { occluder = false, name = config.key } = {}) {
    const root = normalisedModel(source, config.height);
    root.name = `zoo-env-${name}`;
    root.position.set(placement.x, placement.y ?? 0, placement.z);
    root.rotation.y = placement.yaw ?? 0;
    root.scale.multiplyScalar(placement.scale ?? 1);
    environmentRoot.add(root);
    if (occluder) root.traverse((object) => {
      if (object.isMesh) markPhotoOccluder(object);
    });
    return root;
  }

  function addEnvironmentInstances(config, source, placements, { occluder = false, name = config.key } = {}) {
    if (!placements.length) return [];
    const normalised = normalisedModel(source, config.height);
    normalised.updateMatrixWorld(true);
    const created = [];
    const placementMatrix = new THREE.Matrix4();
    const finalMatrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    let meshIndex = 0;
    normalised.traverse((mesh) => {
      if (!mesh.isMesh) return;
      const instances = new THREE.InstancedMesh(mesh.geometry, mesh.material, placements.length);
      instances.name = `zoo-env-${name}-instances-${meshIndex++}`;
      placements.forEach((placement, index) => {
        position.set(placement.x, placement.y ?? 0, placement.z);
        quaternion.setFromAxisAngle(up, placement.yaw ?? 0);
        const amount = placement.scale ?? 1;
        scale.set(amount, amount, amount);
        placementMatrix.compose(position, quaternion, scale);
        finalMatrix.multiplyMatrices(placementMatrix, mesh.matrixWorld);
        instances.setMatrixAt(index, finalMatrix);
      });
      instances.instanceMatrix.needsUpdate = true;
      environmentRoot.add(instances);
      if (occluder) markPhotoOccluder(instances);
      created.push(instances);
    });
    return created;
  }

  const asset = (assets, key) => {
    const found = assets.get(key);
    return found ? [ENVIRONMENT_MODELS.find((entry) => entry.key === key), found.scene] : null;
  };

  // Loaded model sources, kept so the editor can rebuild a group without
  // re-fetching, and the live objects each group produced.
  let loadedAssets = new Map();
  const builtGroups = new Map();
  let sceneryEditable = false;

  /**
   * Where a group's placements are measured from. Most are world coordinates;
   * a few hang off a landmark, and resolving those here rather than freezing
   * the number into the data keeps the two from drifting apart.
   */
  function anchorFor(group) {
    if (!group.anchor) return { x: 0, z: 0 };
    if (group.anchor === 'ticketBooth') return { x: boothPosition.x, z: boothPosition.z };
    const landmark = landmarkById.get(group.anchor);
    return landmark ? { x: landmark.x, z: landmark.z } : null;
  }

  function resolvePlacements(group) {
    const origin = anchorFor(group);
    if (!origin) return null;
    return group.placements.map((placement) => ({
      ...placement,
      x: origin.x + placement.x,
      z: origin.z + placement.z,
    }));
  }

  /**
   * Builds one dressing group.
   *
   * `instanced` collapses the whole group into one InstancedMesh, which is what
   * every student sees — dozens of grass tufts for one draw call. An instance
   * cannot be raycast or dragged individually though, so when the editor is
   * open `sceneryEditable` forces the individual-object path instead.
   */
  function buildGroup(group, assets) {
    const entry = asset(assets, group.asset);
    if (!entry) return null;
    const placements = resolvePlacements(group);
    if (!placements) return null;

    const options = { occluder: group.occluder, name: group.name };
    const asIndividuals = sceneryEditable || group.draw === 'clone';
    const objects = asIndividuals
      ? placements.map((placement) => addEnvironmentClone(...entry, placement, options))
      : addEnvironmentInstances(...entry, placements, options);

    // The procedural barn box only exists until its model arrives.
    if (group.replacesFallback === 'barn' && barnFallback) {
      barnFallback.traverse((object) => {
        const index = photoOccluders.indexOf(object);
        if (index >= 0) photoOccluders.splice(index, 1);
      });
      barnFallback.removeFromParent();
      barnFallback = null;
    }

    const built = { group, objects, individual: asIndividuals };
    builtGroups.set(group.name, built);
    return built;
  }

  /** Removes a group's objects, leaving the shared model source alone. */
  function unbuildGroup(name) {
    const built = builtGroups.get(name);
    if (!built) return;
    for (const object of built.objects) {
      // A stale occluder pointing at a removed mesh would silently corrupt the
      // photo-framing check, so every mesh is withdrawn from that list too.
      object.traverse?.((child) => {
        const index = photoOccluders.indexOf(child);
        if (index >= 0) photoOccluders.splice(index, 1);
      });
      const index = photoOccluders.indexOf(object);
      if (index >= 0) photoOccluders.splice(index, 1);
      object.removeFromParent();
    }
    builtGroups.delete(name);
  }

  function dressPark(assets) {
    loadedAssets = assets;
    for (const group of SCENERY_GROUPS) buildGroup(group, assets);
  }

  /**
   * Rebuilds the instanced groups as individual objects, or back again.
   *
   * Only the editor ever calls this. A student's session never leaves the
   * instanced form, so the draw-call saving the park was built around is
   * untouched by the existence of this switch.
   */
  function setSceneryEditable(enabled) {
    const next = Boolean(enabled);
    if (next === sceneryEditable || !loadedAssets.size) {
      sceneryEditable = next;
      return;
    }
    sceneryEditable = next;
    for (const group of SCENERY_GROUPS) {
      if (group.draw !== 'instanced') continue;
      unbuildGroup(group.name);
      buildGroup(group, loadedAssets);
    }
  }

  /**
   * A fresh, ground-origin copy of one environment model, for the editor to
   * place. Returns null when that model failed to load — the optional farm
   * props do, on a slow classroom connection.
   */
  function createEnvironmentObject(key) {
    const entry = asset(loadedAssets, key);
    if (!entry) return null;
    const [config, source] = entry;
    const root = normalisedModel(source, config.height);
    root.name = `zoo-env-${key}`;
    return root;
  }

  /** What the editor's adapter reads: one entry per dressing group. */
  function getSceneryGroups() {
    return SCENERY_GROUPS.map((group) => {
      const built = builtGroups.get(group.name);
      return {
        name: group.name,
        asset: group.asset,
        area: group.area,
        occluder: Boolean(group.occluder),
        individual: Boolean(built?.individual),
        objects: built?.individual ? built.objects : null,
      };
    });
  }

  async function loadEnvironment() {
    if (environmentLoadPromise) return environmentLoadPromise;
    environmentLoadPromise = Promise.all(ENVIRONMENT_MODELS.map(async (config) => {
      try {
        const loaded = config.format === 'obj'
          ? await loadEnvironmentObj(config)
          : await loadEnvironmentGltf(config);
        if (disposed) {
          disposeModelSource(loaded.scene, loaded.materials);
          return null;
        }
        modelSources.add(loaded);
        loadedEnvironmentModels += 1;
        return [config.key, loaded];
      } catch (error) {
        if (!disposed) {
          failedEnvironmentAssets.push(config.file);
          console.warn(`[zoo] Optional environment asset ${config.file} unavailable; keeping procedural dressing.`, error);
        }
        return null;
      } finally {
        environmentPending -= 1;
      }
    })).then((entries) => {
      if (disposed) return;
      dressPark(new Map(entries.filter(Boolean)));
      environmentStatus = failedEnvironmentAssets.length ? 'ready-with-fallbacks' : 'ready';
      afterDressingStats = collectSceneStats();
    });
    return environmentLoadPromise;
  }

  function findModelNode(root, name) {
    const exact = root.getObjectByName(name);
    if (exact) return exact;
    const normalisedName = name.replace(/[^a-z0-9]/gi, '').toLowerCase();
    let match = null;
    root.traverse((object) => {
      if (!match && object.name.replace(/[^a-z0-9]/gi, '').toLowerCase() === normalisedName) match = object;
    });
    return match;
  }

  /**
   * The clip bundle is a separate fetch from the models, because the models
   * carry no usable animation of their own. A failure here is not fatal: the
   * animals still roam, they just roam without moving their legs, which is
   * visibly wrong but better than an empty park.
   */
  async function loadClips() {
    try {
      const bundle = await fetchAsset(CLIPS_ASSET, 'json');
      animalClips = parseAnimalClips(bundle);
      clipStatus = 'ready';
    } catch (error) {
      clipStatus = 'failed';
      if (!disposed) console.warn('[zoo] animal clips unavailable; animals will not animate.', error);
    }
  }

  function loadAnimals() {
    if (loadPromise) return loadPromise;
    const configs = [...new Map(Object.values(ANIMAL_MODELS).map((config) => [config.file, config])).values()];
    loadPromise = (async () => {
      // Clips first, so a model is never placed without the animator it needs
      // and then left standing frozen while its clips arrive.
      await loadClips();
      await Promise.all(configs.map(async (fileConfig) => {
        const { file } = fileConfig;
        try {
          const asset = await loadGltf(file);
          if (disposed) {
            disposeModelSource(asset.scene, asset.materials);
            return;
          }
          modelSources.add(asset);
          for (const habitat of habitats) {
            const config = ANIMAL_MODELS[habitat.id];
            if (config.file !== file) continue;
            const sourceObject = config.node ? findModelNode(asset.scene, config.node) : asset.scene;
            if (!sourceObject) throw new Error(`${file} is missing ${config.node}`);
            placeModel(habitat, sourceObject, animalClips?.[habitat.id] ?? null);
          }
        } catch (error) {
          if (!disposed) console.warn(`[zoo] ${file} unavailable; keeping animal placeholders.`, error);
        }
      }));
    })();
    return loadPromise;
  }

  /** Per-animal state for the debug panel and the playthrough harness. */
  function getAnimalDebug() {
    return habitats.map((subject) => ({
      ...subject.roamer.debug(),
      source: ANIMAL_MODELS[subject.id].file,
      node: ANIMAL_MODELS[subject.id].node ?? null,
      modelLoaded: Boolean(subject.model),
      clip: subject.animator?.currentClip ?? null,
      availableClips: subject.animator?.availableClips ?? [],
      // How big the animal reads in a photo. The chicken is far smaller than
      // the giraffe, so what counts as a good photographing distance is not the
      // same number for both.
      photoRadius: Number((subject.photoRadius ?? 0).toFixed(2)),
      photoHalfHeight: Number((subject.photoHalfHeight ?? 0).toFixed(2)),
    }));
  }

  function getClipState() {
    return { status: clipStatus, animals: animalClips ? Object.keys(animalClips) : [] };
  }

  group.add(new THREE.HemisphereLight(0xffffff, 0x5f844e, 2.35));
  const sun = new THREE.DirectionalLight(0xffffff, 2.15);
  sun.position.set(10, 18, 12);
  group.add(sun);

  function update(dt) {
    if (disposed) return;
    const step = Math.max(0, Math.min(Number.isFinite(dt) ? dt : 0, 0.1));
    elapsed += step;
    for (const animation of animations) {
      animation.object.position.y = animation.object.userData.baseY + Math.sin(elapsed * 2.2) * 0.08;
    }
    // Roam first, then copy the result onto the models, then drive the clips
    // from the state that produced the movement, so what an animal is doing and
    // what it looks like can never disagree.
    for (const subject of habitats) {
      const roamer = subject.roamer;
      roamer.update(step);
      subject.x = roamer.x;
      subject.z = roamer.z;
      subject.animal.position.x = roamer.x;
      subject.animal.position.z = roamer.z;
      subject.animal.rotation.y = roamer.facing;
      subject.animator?.syncTo(roamer.state, roamer.speed);
    }
    for (const animator of animators) animator.update(step);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    modelAbort.abort();
    group.removeFromParent();
    for (const source of modelSources) disposeModelSource(source.scene, source.materials);
    for (const texture of textures) texture.dispose();
    for (const material of materials) material.dispose();
    for (const geometry of geometries) geometry.dispose();
    for (const canvas of canvases) {
      canvas.width = 1;
      canvas.height = 1;
    }
    textures.clear();
    materials.clear();
    geometries.clear();
    canvases.clear();
    modelSources.clear();
    animations.length = 0;
    for (const animator of animators) animator.dispose();
    animators.length = 0;
  }

  function collectSceneStats() {
    let meshes = 0;
    let instancedMeshes = 0;
    let triangles = 0;
    group.traverse((object) => {
      if (!object.isMesh) return;
      const instances = object.isInstancedMesh ? object.count : 1;
      meshes += 1;
      if (object.isInstancedMesh) instancedMeshes += 1;
      const geometry = object.geometry;
      const triangleCount = geometry?.index
        ? geometry.index.count / 3
        : (geometry?.attributes?.position?.count ?? 0) / 3;
      triangles += triangleCount * instances;
    });
    return {
      meshes,
      instancedMeshes,
      triangles: Math.round(triangles),
      uniqueEnvironmentModels: loadedEnvironmentModels,
    };
  }

  function getSceneStats() {
    return collectSceneStats();
  }

  function getSceneStatsReport() {
    const current = collectSceneStats();
    return {
      beforeDressing: beforeDressingStats ?? current,
      afterDressing: afterDressingStats,
      current,
    };
  }

  function getEnvironmentState() {
    return {
      status: environmentStatus,
      pending: Math.max(0, environmentPending),
      loadedUniqueModels: loadedEnvironmentModels,
      failedAssets: [...failedEnvironmentAssets],
    };
  }



  // Counts how many sample points on the animal are hidden from the camera by
  // opaque scenery (signs, buildings, rock edges). Fence rails are not
  // occluders: the animal is seen between them.
  const visibilityRight = new THREE.Vector3();
  const visibilityUp = new THREE.Vector3();
  const VISIBILITY_OFFSETS = [[0, 0], [0, 0.55], [0, -0.45], [0.55, 0], [-0.55, 0]];
  function countBlockedSamples(habitat, camera) {
    camera.getWorldPosition(visibilityOrigin);
    visibilityRight.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    visibilityUp.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
    const radius = habitat.photoRadius;
    const halfHeight = habitat.photoHalfHeight ?? radius;
    let blocked = 0;
    for (const [right, up] of VISIBILITY_OFFSETS) {
      habitat.photoTarget.getWorldPosition(visibilityTarget);
      visibilityTarget.addScaledVector(visibilityRight, right * radius)
        .addScaledVector(visibilityUp, up * halfHeight);
      visibilityDirection.subVectors(visibilityTarget, visibilityOrigin);
      const distance = visibilityDirection.length();
      if (distance < 0.01) continue;
      visibilityRaycaster.set(visibilityOrigin, visibilityDirection.divideScalar(distance));
      visibilityRaycaster.far = distance;
      visibilityHits.length = 0;
      visibilityRaycaster.intersectObjects(photoOccluders, false, visibilityHits);
      if (visibilityHits.length) blocked += 1;
    }
    return blocked;
  }

  function occluderDistances(origin, direction, far) {
    visibilityRaycaster.set(origin, direction);
    visibilityRaycaster.far = far;
    visibilityHits.length = 0;
    visibilityRaycaster.intersectObjects(photoOccluders, false, visibilityHits);
    return visibilityHits.map((hit) => hit.distance);
  }

  beforeDressingStats = collectSceneStats();

  return {
    group, habitats, loadAnimals, loadEnvironment, update, getSceneStats, getSceneStatsReport,
    getEnvironmentState, getAnimalDebug, getClipState, dispose,
    countBlockedSamples, occluderDistances, visibilitySampleCount: VISIBILITY_OFFSETS.length,
    // Editor-only. Gameplay never touches these; see scenery.js.
    environmentRoot, setSceneryEditable, getSceneryGroups, createEnvironmentObject,
  };
}
