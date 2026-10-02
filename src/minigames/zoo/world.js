import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import {
  bounds as campusBounds,
  landmarks,
  pathNodes,
  regions,
  retainedProps,
} from './layout.js';
import { AREAS, TERRITORIES } from './territories.js';
import {
  ENVIRONMENT_MODELS,
  RUNTIME_ENVIRONMENT_MODELS,
  SCENERY_GROUPS,
} from './scenery.js';
import { createRng, spawnAnimals } from './roaming.js';
import { createAnimalAnimator, resolveAnimalClips } from './animalAnimator.js';
import { createBlockyRock, createBlockyTree, createParkScatter } from './blockyTree.js';

// Ground tints used where an area wants a hint of its animals' colouring.
// Nothing here fences anything: the park is one continuous space.
export const ANIMAL_MODELS = Object.freeze({
  // Every one of these models faces local +z at rotation 0, and the roaming
  // code sets an animal's rotation to its heading, so no yaw offset is wanted.
  // The old zoo carried `yawOffset: Math.PI` from when animals stood still in
  // pens; applied to a walking animal it turns it through 180 degrees and it
  // moonwalks to its destination.
  cat: Object.freeze({ file: 'cube-world/Cat.gltf', targetHeight: 0.8 }),
  // A large hen rather than a bantam. At 0.8 the chicken had to be framed from
  // inside about three units, and walking at 1.2 it crossed that whole window
  // in a second and a half. It is still comfortably the smallest animal.
  chicken: Object.freeze({ file: 'cube-world/Chicken.gltf', targetHeight: 1.05 }),
  dog: Object.freeze({ file: 'cube-world/Dog.gltf', targetHeight: 1.15 }),
  horse: Object.freeze({ file: 'cube-world/Horse.gltf', targetHeight: 2.2 }),
  pig: Object.freeze({ file: 'cube-world/Pig.gltf', targetHeight: 1.1 }),
  raccoon: Object.freeze({ file: 'cube-world/Raccoon.gltf', targetHeight: 0.8 }),
  sheep: Object.freeze({ file: 'cube-world/Sheep.gltf', targetHeight: 1.25 }),
  wolf: Object.freeze({ file: 'cube-world/Wolf.gltf', targetHeight: 1.35 }),
});

// The imported-model palette lives in `scenery.js`. Trees, rocks, and farm
// landmarks are procedural below.

function publicPath(path) {
  return `${import.meta.env?.BASE_URL || './'}${path}`;
}

export function createZooWorld({ labels = {}, seed = null } = {}) {
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  const canvases = new Set();
  const modelSources = new Set();
  const animators = [];
  // A seeded generator when one is supplied, so a test or a harness run can
  // reproduce an exact park; otherwise the animals start somewhere new.
  const worldSeed = Number.isFinite(seed) ? seed : Math.floor(Math.random() * 0xffffffff);
  const roamRng = createRng(worldSeed);
  const parkScatter = createParkScatter(worldSeed);
  const modelAbort = new AbortController();
  let loadPromise = null;
  let environmentLoadPromise = null;
  let editorEnvironmentLoadPromise = null;
  let environmentStatus = 'ready';
  let environmentPending = 0;
  let loadedEnvironmentModels = 0;
  const failedEnvironmentAssets = [];
  let beforeDressingStats = null;
  let afterDressingStats = null;
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
  // The single level field stays bright enough for the four flat region tints
  // to read without turning those patches into raised terrain.
  const grass = makeMaterial(0x74ad3d);
  const plazaMaterial = makeMaterial(0xd9cab3);
  const leaf = makeMaterial(0x4f9955);
  const leafLight = makeMaterial(0x72b85d);
  const leafDark = makeMaterial(0x397a43);
  const bark = makeMaterial(0x765137);
  const dark = makeMaterial(0x29384a);
  const regionMaterials = Object.freeze({
    grassland: makeMaterial(0x8cbd4e),
    woodland: makeMaterial(0x3f7a2a),
    farm: makeMaterial(0x7fb340),
  });
  const timber = makeMaterial(0x9d7448);
  const hay = makeMaterial(0xd7af50);

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

  const landmarkById = new Map(landmarks.map((landmark) => [landmark.id, landmark]));
  const plazaPosition = landmarkById.get('plaza')
    ?? pathNodes.find((node) => node.kind === 'plaza')
    ?? { x: 0, z: 27.6 };
  const plaza = addMesh(group, lowCylinder, plazaMaterial,
    plazaPosition.x, 0.025, plazaPosition.z, 7, 0.14, 6);
  plaza.name = 'zoo-entrance-plaza';
  plaza.rotation.y = Math.PI / 16;

  const treeResources = {
    boxGeometry: box,
    trunkMaterial: bark,
    canopyMaterials: [leaf, leafLight, leafDark],
  };

  // The generator returns ordinary tree groups for landmarks and tooling. The
  // live scatter is folded into one InstancedMesh per shared material, keeping
  // eighty trees cheap enough for classroom Chromebooks.
  const treeMatrices = new Map([bark, leaf, leafLight, leafDark].map((material) => [material, []]));
  for (const placement of parkScatter.trees) {
    const tree = createBlockyTree(createRng(placement.seed), treeResources, placement.variant);
    tree.position.set(placement.x, 0, placement.z);
    tree.rotation.y += placement.yaw;
    tree.scale.setScalar(placement.scale);
    tree.updateMatrixWorld(true);
    tree.traverse((object) => {
      if (object.isMesh) treeMatrices.get(object.material).push(object.matrixWorld.clone());
    });
  }
  let treeBatch = 0;
  for (const [material, matrices] of treeMatrices) {
    if (!matrices.length) continue;
    const instances = new THREE.InstancedMesh(box, material, matrices.length);
    instances.name = `zoo-blocky-tree-scatter-${treeBatch++}`;
    matrices.forEach((matrix, index) => instances.setMatrixAt(index, matrix));
    instances.instanceMatrix.needsUpdate = true;
    environmentRoot.add(instances);
    markPhotoOccluder(instances);
  }

  // Rocks get their own cool greys rather than the plaza's warm beige:
  // scattered across green grass, the beige version read as
  // cardboard boxes, and at distance it was nearly the colour of the white
  // sheep the child is sent out to photograph.
  const rockMid = makeMaterial(0x8f959d);
  const rockDark = makeMaterial(0x6b727c);
  const rockResources = { boxGeometry: box, rockMaterials: [rockMid, rockDark] };
  const rockMatrices = new Map([rockMid, rockDark].map((material) => [material, []]));
  for (const placement of parkScatter.rocks) {
    const rock = createBlockyRock(createRng(placement.seed), rockResources, placement.variant);
    rock.position.set(placement.x, 0, placement.z);
    rock.rotation.y += placement.yaw;
    rock.scale.setScalar(placement.scale);
    rock.updateMatrixWorld(true);
    rock.traverse((object) => {
      if (object.isMesh) rockMatrices.get(object.material).push(object.matrixWorld.clone());
    });
  }
  let rockBatch = 0;
  for (const [material, matrices] of rockMatrices) {
    if (!matrices.length) continue;
    const instances = new THREE.InstancedMesh(box, material, matrices.length);
    instances.name = `zoo-blocky-rock-scatter-${rockBatch++}`;
    matrices.forEach((matrix, index) => instances.setMatrixAt(index, matrix));
    instances.instanceMatrix.needsUpdate = true;
    environmentRoot.add(instances);
  }

  const treePosition = landmarkById.get('giantForestTree');
  if (treePosition) {
    const giantTree = createBlockyTree(createRng(worldSeed ^ 0x51f15e), treeResources, 'chunky-round');
    giantTree.name = 'zoo-giant-forest-tree-blocky';
    giantTree.position.set(treePosition.x, 0, treePosition.z);
    giantTree.scale.setScalar(1.75);
    group.add(giantTree);
    giantTree.traverse((object) => {
      if (object.isMesh) markPhotoOccluder(object);
    });
  }

  const propById = new Map(retainedProps.map((prop) => [prop.id, prop]));
  const forestLogPosition = propById.get('forestLog');
  const forestLog = markPhotoOccluder(addMesh(group, cylinder, bark,
    forestLogPosition.x, 0.48, forestLogPosition.z, 0.72, 3.2, 0.72));
  forestLog.name = 'zoo-forest-fallen-log';
  forestLog.rotation.z = Math.PI / 2;
  forestLog.rotation.y = 0.35;

  for (const [id, scaleAmount] of [['farmHayA', 1], ['farmHayB', 0.78]]) {
    const { x, z } = propById.get(id);
    const bale = addMesh(group, box, hay, x, 0.55 * scaleAmount, z,
      1.2 * scaleAmount, 1.1 * scaleAmount, 1.1 * scaleAmount);
    bale.name = 'zoo-farm-hay-bale';
    bale.rotation.y = 0.12;
  }
  const troughPosition = propById.get('farmTrough');
  const trough = addMesh(group, box, timber, troughPosition.x, 0.45, troughPosition.z, 2.6, 0.65, 0.8);
  trough.name = 'zoo-farm-trough';
  addMesh(group, box, dark, troughPosition.x, 0.7, troughPosition.z, 2.2, 0.1, 0.58);

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
    // Tall, narrow animals were judged by their width alone
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
      zooSpecies: territory.id,
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
   * every student sees — the wider rock scatter for one draw call. An instance
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
   * A fresh, ground-origin copy of one loaded environment model, for the
   * editor to place. Returns null when that model is palette-only or failed.
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

  async function loadEnvironment({ editor = false } = {}) {
    const configs = editor ? ENVIRONMENT_MODELS : RUNTIME_ENVIRONMENT_MODELS;
    if (!configs.length) {
      environmentLoadPromise ??= Promise.resolve();
      return environmentLoadPromise;
    }
    if (editorEnvironmentLoadPromise) return editorEnvironmentLoadPromise;
    environmentStatus = 'loading';
    environmentPending = configs.length;
    editorEnvironmentLoadPromise = Promise.all(configs.map(async (config) => {
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
    return editorEnvironmentLoadPromise;
  }

  function loadAnimals() {
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      await Promise.all(habitats.map(async (habitat) => {
        const { file } = ANIMAL_MODELS[habitat.id];
        try {
          const asset = await loadGltf(file);
          if (disposed) {
            disposeModelSource(asset.scene, asset.materials);
            return;
          }
          modelSources.add(asset);
          placeModel(habitat, asset.scene, resolveAnimalClips(asset.animations));
        } catch (error) {
          if (!disposed) console.warn(`[zoo] ${file} unavailable; keeping animal placeholders.`, error);
        }
      }));
    })();
    return loadPromise;
  }

  /** A normalized, skeleton-safe copy for one-shot UI rendering. */
  function cloneAnimalModel(id) {
    const model = habitatById.get(id)?.model;
    return model ? cloneSkinned(model) : null;
  }

  /** Per-animal state for the debug panel and the playthrough harness. */
  function getAnimalDebug() {
    return habitats.map((subject) => ({
      ...subject.roamer.debug(),
      source: ANIMAL_MODELS[subject.id].file,
      modelLoaded: Boolean(subject.model),
      clip: subject.animator?.currentClip ?? null,
      availableClips: subject.animator?.availableClips ?? [],
      // How big the animal reads in a photo. The chicken is far smaller than
      // the horse, so one photographing distance cannot fit both.
      photoRadius: Number((subject.photoRadius ?? 0).toFixed(2)),
      photoHalfHeight: Number((subject.photoHalfHeight ?? 0).toFixed(2)),
    }));
  }

  group.add(new THREE.HemisphereLight(0xffffff, 0x5f844e, 2.35));
  const sun = new THREE.DirectionalLight(0xffffff, 2.15);
  sun.position.set(10, 18, 12);
  group.add(sun);

  function update(dt) {
    if (disposed) return;
    const step = Math.max(0, Math.min(Number.isFinite(dt) ? dt : 0, 0.1));
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
    group, habitats, loadAnimals, cloneAnimalModel, loadEnvironment, update, getSceneStats, getSceneStatsReport,
    getEnvironmentState, getAnimalDebug, dispose,
    countBlockedSamples, occluderDistances, visibilitySampleCount: VISIBILITY_OFFSETS.length,
    // Editor-only. Gameplay never touches these; see scenery.js.
    environmentRoot, setSceneryEditable, getSceneryGroups, createEnvironmentObject,
  };
}
