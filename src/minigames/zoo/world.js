import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import {
  PATH_WIDTH,
  bounds as campusBounds,
  colliders,
  habitats as campusHabitats,
  landmarks,
  pathEdges,
  pathNodes,
  regions,
} from './layout.js';

const TAU = Math.PI * 2;

// Kept as a compatibility export for code that used the original ring data.
// The authoritative positions now live in the pure campus layout module.
export const HABITAT_POSITIONS = campusHabitats;

const ANIMAL_VISUALS = Object.freeze({
  elephant: Object.freeze({ ground: 0xb8c990, fence: 0x78644d }),
  giraffe: Object.freeze({ ground: 0xdab96a, fence: 0x9c7140 }),
  penguin: Object.freeze({ ground: 0x9bcdd5, fence: 0x648d99 }),
  tiger: Object.freeze({ ground: 0xc9a967, fence: 0x755338 }),
  deer: Object.freeze({ ground: 0x8eb875, fence: 0x6f5b43 }),
  alpaca: Object.freeze({ ground: 0xd8cf9a, fence: 0x8a6f4e }),
  horse: Object.freeze({ ground: 0xa8c882, fence: 0xb08850 }),
  fox: Object.freeze({ ground: 0x9cc47f, fence: 0x79533d }),
  wolf: Object.freeze({ ground: 0x91b09a, fence: 0x596878 }),
  stag: Object.freeze({ ground: 0x9eb974, fence: 0x6f513b }),
  bull: Object.freeze({ ground: 0xc4ad78, fence: 0x57483c }),
  cow: Object.freeze({ ground: 0xb3cb86, fence: 0x715d4a }),
  donkey: Object.freeze({ ground: 0xb9bd91, fence: 0x6d6255 }),
});

const ANIMAL_MODELS = Object.freeze({
  elephant: Object.freeze({
    file: 'elephant.glb',
    targetHeight: 2.45,
    // This model carries no texture and ships three materials all set to the
    // same flat 0.8 grey, so it reads as a white blob under the zoo's lights.
    // Colouring by material name is safe precisely because there is no texture.
    tint: Object.freeze({ 'Elephant Gray': 0x9aa4a9, Dark: 0x4b5258, Ivory: 0xf0e7d2 }),
  }),
  // yawOffset turns source models that face -z so every animal faces its viewpoint.
  giraffe: Object.freeze({ file: 'giraffe.glb', targetHeight: 3.65, yawOffset: Math.PI, idleClip: 'iddle' }),
  penguin: Object.freeze({ file: 'Animals.glb', node: 'pinguin.001', targetHeight: 1.55, yawOffset: Math.PI }),
  tiger: Object.freeze({ file: 'Animals.glb', node: 'tiger', targetHeight: 1.65, yawOffset: Math.PI }),
  deer: Object.freeze({ file: 'Animals.glb', node: 'deer', targetHeight: 2, yawOffset: Math.PI }),
  // A .gltf rather than .glb: its buffers and colours are embedded, so the same
  // fetch-and-parse path loads it. Its materials are already distinct browns, so
  // unlike the elephant it needs no tint.
  alpaca: Object.freeze({ file: 'alpaca.gltf', targetHeight: 1.7, idleClip: 'Idle' }),
  horse: Object.freeze({ file: 'obj/Horse_White.obj', materialFile: 'obj/Horse_White.mtl', format: 'obj', targetHeight: 2.2 }),
  fox: Object.freeze({ file: 'obj/Fox.obj', materialFile: 'obj/Fox.mtl', format: 'obj', targetHeight: 1.05 }),
  wolf: Object.freeze({ file: 'obj/Wolf.obj', materialFile: 'obj/Wolf.mtl', format: 'obj', targetHeight: 1.35 }),
  stag: Object.freeze({ file: 'obj/Stag.obj', materialFile: 'obj/Stag.mtl', format: 'obj', targetHeight: 2.45 }),
  bull: Object.freeze({ file: 'obj/Bull.obj', materialFile: 'obj/Bull.mtl', format: 'obj', targetHeight: 2.35 }),
  cow: Object.freeze({ file: 'obj/Cow.obj', materialFile: 'obj/Cow.mtl', format: 'obj', targetHeight: 2.2 }),
  donkey: Object.freeze({ file: 'obj/Donkey.obj', materialFile: 'obj/Donkey.mtl', format: 'obj', targetHeight: 1.9 }),
});

// Campus copy lives with the Zoo rather than in the shared lesson catalogue.
// Animal labels remain the lesson vocabulary; these Japanese names are only
// navigation context and are deliberately unrelated to the active request.
const REGION_SIGNAGE = Object.freeze({
  savanna: Object.freeze({ name: 'サバンナ', animals: Object.freeze(['elephant', 'giraffe', 'tiger']) }),
  forest: Object.freeze({ name: 'もりのどうぶつ', animals: Object.freeze(['deer', 'fox', 'wolf', 'stag']) }),
  farm: Object.freeze({ name: 'ぼくじょう', animals: Object.freeze(['horse', 'alpaca', 'cow', 'bull', 'donkey']) }),
  penguinCove: Object.freeze({ name: 'ペンギンいりえ', animals: Object.freeze(['penguin']) }),
});

const JUNCTION_SIGNPOSTS = Object.freeze([
  Object.freeze({ id: 'hub-savanna', regionId: 'savanna', x: -4.2, z: 12.8, facing: 0, arrow: '←' }),
  Object.freeze({ id: 'forest-turn', regionId: 'forest', x: -23.1, z: 5.8, facing: 0, arrow: '←' }),
  Object.freeze({ id: 'hub-farm', regionId: 'farm', x: 7.1, z: 12.7, facing: 0, arrow: '→' }),
  Object.freeze({ id: 'cove-turn', regionId: 'penguinCove', x: 25.2, z: -7.1, facing: 0, arrow: '→' }),
]);

const ENVIRONMENT_MODELS = Object.freeze([
  Object.freeze({ key: 'common-tree', folder: 'quaternius-nature', file: 'CommonTree_1.gltf', height: 6.2 }),
  Object.freeze({ key: 'dead-tree', folder: 'quaternius-nature', file: 'DeadTree_3.gltf', height: 5.1 }),
  Object.freeze({ key: 'pine-1', folder: 'quaternius-nature', file: 'Pine_1.gltf', height: 6.4 }),
  Object.freeze({ key: 'pine-2', folder: 'quaternius-nature', file: 'Pine_2.gltf', height: 5.5 }),
  Object.freeze({ key: 'bush', folder: 'quaternius-nature', file: 'Bush_Common.gltf', height: 1.05 }),
  Object.freeze({ key: 'flower-bush', folder: 'quaternius-nature', file: 'Bush_Common_Flowers.gltf', height: 0.9 }),
  Object.freeze({ key: 'grass', folder: 'quaternius-nature', file: 'Grass_Common_Tall.gltf', height: 0.75 }),
  Object.freeze({ key: 'fern', folder: 'quaternius-nature', file: 'Fern_1.gltf', height: 0.85 }),
  Object.freeze({ key: 'rock-1', folder: 'quaternius-nature', file: 'Rock_Medium_1.gltf', height: 1.05 }),
  Object.freeze({ key: 'rock-2', folder: 'quaternius-nature', file: 'Rock_Medium_2.gltf', height: 0.85 }),
  Object.freeze({ key: 'pebble', folder: 'quaternius-nature', file: 'Pebble_Round_1.gltf', height: 0.22 }),
  Object.freeze({ key: 'planter', folder: 'kenney-suburban', file: 'planter.glb', height: 0.85 }),
  Object.freeze({ key: 'low-fence', folder: 'kenney-suburban', file: 'fence-low.glb', height: 0.85 }),
  Object.freeze({ key: 'long-fence', folder: 'kenney-suburban', file: 'fence-1x3.glb', height: 1.05 }),
  Object.freeze({ key: 'cafe-table', folder: 'kaykit-restaurant', file: 'table_round_A.gltf', height: 0.9 }),
  Object.freeze({ key: 'cafe-chair', folder: 'kaykit-restaurant', file: 'chair_A.gltf', height: 1.05 }),
  Object.freeze({ key: 'crate', folder: 'kaykit-restaurant', file: 'crate.gltf', height: 0.8 }),
  Object.freeze({ key: 'farm-barn', folder: 'quaternius-farm', file: 'Barn.obj', materialFile: 'Barn.mtl', format: 'obj', height: 6.2, optional: true }),
  Object.freeze({ key: 'farm-well', folder: 'quaternius-farm', file: 'Well.obj', materialFile: 'Well.mtl', format: 'obj', height: 2.4, optional: true }),
  Object.freeze({ key: 'water-tower', folder: 'quaternius-farm', file: 'WaterTower.obj', materialFile: 'WaterTower.mtl', format: 'obj', height: 7.2, optional: true }),
]);

function publicPath(path) {
  return `${import.meta.env?.BASE_URL || './'}${path}`;
}

function drawAnimalIcon(context, id, x, y) {
  context.save();
  context.translate(x, y);
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.strokeStyle = '#26354b';
  context.lineWidth = 10;

  const fillRect = (color, left, top, width, height) => {
    context.fillStyle = color;
    context.fillRect(left, top, width, height);
    context.strokeRect(left, top, width, height);
  };
  const fillCircle = (color, cx, cy, radius) => {
    context.fillStyle = color;
    context.beginPath();
    context.arc(cx, cy, radius, 0, TAU);
    context.fill();
    context.stroke();
  };

  if (id === 'elephant') {
    fillRect('#9ea7ad', -66, -25, 105, 60);
    fillCircle('#9ea7ad', 48, -18, 35);
    context.beginPath();
    context.moveTo(68, 0);
    context.lineTo(75, 55);
    context.stroke();
    fillCircle('#c3c9cd', 28, -20, 24);
  } else if (id === 'giraffe') {
    fillRect('#e9bb4e', -64, 4, 82, 38);
    fillRect('#e9bb4e', 2, -68, 26, 88);
    fillRect('#e9bb4e', 5, -83, 58, 30);
    context.fillStyle = '#995e32';
    for (const [sx, sy] of [[-43, 17], [-12, 9], [11, -46], [12, -14], [38, -72]]) {
      context.fillRect(sx, sy, 13, 13);
    }
  } else if (id === 'penguin') {
    fillCircle('#202a35', 0, 0, 52);
    context.fillStyle = '#f4f4ec';
    context.beginPath();
    context.ellipse(8, 10, 26, 37, 0, 0, TAU);
    context.fill();
    context.fillStyle = '#ef9b32';
    context.beginPath();
    context.moveTo(47, -21);
    context.lineTo(79, -8);
    context.lineTo(47, 2);
    context.closePath();
    context.fill();
    context.stroke();
  } else if (id === 'tiger') {
    fillRect('#e79838', -68, -20, 103, 55);
    fillCircle('#e79838', 46, -17, 34);
    context.strokeStyle = '#513722';
    context.lineWidth = 13;
    for (const sx of [-48, -15, 32, 55]) {
      context.beginPath();
      context.moveTo(sx, -37);
      context.lineTo(sx + 8, -5);
      context.stroke();
    }
  } else if (id === 'deer') {
    fillRect('#b07d4c', -58, -14, 92, 50);
    fillCircle('#c08f5c', 46, -20, 30);
    context.strokeStyle = '#6d4a2c';
    context.lineWidth = 11;
    for (const dir of [-1, 1]) {
      context.beginPath();
      context.moveTo(40 + dir * 6, -44);
      context.lineTo(46 + dir * 20, -80);
      context.moveTo(43 + dir * 13, -63);
      context.lineTo(60 + dir * 24, -70);
      context.stroke();
    }
  } else if (id === 'horse') {
    fillRect('#f1eee4', -62, -12, 100, 52);
    fillCircle('#faf8ef', 48, -22, 30);
    context.fillStyle = '#b9b8b2';
    context.fillRect(4, -52, 44, 15);
    context.strokeStyle = '#b9b8b2';
    context.lineWidth = 12;
    context.beginPath();
    context.moveTo(-62, -6);
    context.lineTo(-80, 34);
    context.stroke();
  } else if (id === 'fox') {
    fillRect('#df6d2f', -58, -12, 84, 45);
    fillCircle('#e97832', 39, -22, 29);
    context.fillStyle = '#e97832';
    context.beginPath();
    context.moveTo(22, -42);
    context.lineTo(27, -78);
    context.lineTo(45, -49);
    context.lineTo(58, -76);
    context.lineTo(62, -38);
    context.fill();
    context.stroke();
    context.strokeStyle = '#df6d2f';
    context.lineWidth = 22;
    context.beginPath();
    context.moveTo(-58, -1);
    context.quadraticCurveTo(-96, -45, -76, 31);
    context.stroke();
  } else if (id === 'wolf') {
    fillRect('#78848d', -60, -15, 91, 49);
    fillCircle('#87939b', 43, -25, 31);
    context.fillStyle = '#87939b';
    context.beginPath();
    context.moveTo(20, -45);
    context.lineTo(25, -82);
    context.lineTo(45, -51);
    context.lineTo(60, -80);
    context.lineTo(65, -43);
    context.fill();
    context.stroke();
    context.strokeStyle = '#59636b';
    context.lineWidth = 13;
    context.beginPath();
    context.moveTo(-60, -8);
    context.lineTo(-84, -37);
    context.stroke();
  } else if (id === 'stag') {
    fillRect('#754a2c', -60, -13, 94, 50);
    fillCircle('#835634', 46, -23, 30);
    context.strokeStyle = '#4c321f';
    context.lineWidth = 9;
    for (const dir of [-1, 1]) {
      context.beginPath();
      context.moveTo(42 + dir * 7, -46);
      context.lineTo(44 + dir * 27, -101);
      for (const [py, reach] of [[-62, 22], [-78, 29], [-93, 34]]) {
        context.moveTo(44 + dir * (12 + (Math.abs(py) - 62) * 0.28), py);
        context.lineTo(44 + dir * reach, py - 15);
      }
      context.stroke();
    }
  } else if (id === 'bull') {
    fillRect('#554537', -65, -17, 102, 55);
    fillCircle('#615043', 47, -22, 32);
    context.fillStyle = '#e5d39b';
    context.beginPath();
    context.moveTo(29, -43);
    context.quadraticCurveTo(2, -72, -6, -48);
    context.moveTo(61, -43);
    context.quadraticCurveTo(91, -72, 96, -45);
    context.stroke();
    context.fill();
    context.strokeStyle = '#26354b';
    context.lineWidth = 10;
    context.beginPath();
    context.moveTo(-65, -8);
    context.lineTo(-88, -36);
    context.stroke();
  } else if (id === 'cow') {
    fillRect('#f2eee2', -65, -17, 102, 55);
    fillCircle('#f7f2e6', 47, -22, 32);
    context.fillStyle = '#5c5149';
    context.fillRect(-45, -17, 28, 32);
    context.beginPath();
    context.arc(47, -28, 13, 0, TAU);
    context.fill();
    context.fillStyle = '#e7a9a4';
    context.beginPath();
    context.ellipse(55, -8, 22, 13, 0, 0, TAU);
    context.fill();
    context.stroke();
  } else if (id === 'donkey') {
    fillRect('#8d8a82', -59, -13, 90, 49);
    fillCircle('#9b9890', 43, -24, 29);
    context.fillStyle = '#9b9890';
    context.beginPath();
    context.moveTo(25, -45);
    context.lineTo(21, -94);
    context.lineTo(39, -50);
    context.lineTo(53, -94);
    context.lineTo(59, -43);
    context.fill();
    context.stroke();
    context.strokeStyle = '#4f4b46';
    context.lineWidth = 12;
    context.beginPath();
    context.moveTo(-59, -8);
    context.lineTo(-78, 28);
    context.stroke();
  } else {
    fillRect('#c8a97e', -44, -4, 72, 46);
    fillRect('#c8a97e', 4, -58, 26, 60);
    fillCircle('#dcc19b', 24, -70, 23);
    context.fillStyle = '#dcc19b';
    context.beginPath();
    context.moveTo(10, -86);
    context.lineTo(15, -106);
    context.lineTo(26, -88);
    context.fill();
    context.stroke();
  }
  context.restore();
}

/**
 * Builds the complete fixed zoo environment. The caller owns adding `group` to
 * a scene and should call `dispose` when leaving the minigame.
 */
export function createZooWorld({ labels = {} } = {}) {
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  const canvases = new Set();
  const modelSources = new Set();
  const animations = [];
  const animalMixers = [];
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
  const junctionSignPlane = ownGeometry(new THREE.PlaneGeometry(4.8, 2.65));
  const campusBoardPlane = ownGeometry(new THREE.PlaneGeometry(6.4, 5.05));
  const grass = makeMaterial(0x75b866);
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
    savanna: makeMaterial(0xcdb66f),
    forest: makeMaterial(0x55865b),
    farm: makeMaterial(0x8fbd70),
    penguinCove: makeMaterial(0x8faeb2),
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

  // Flat-coloured procedural patches establish the four regions before the
  // imported dressing arrives in the following work order.
  const regionPatchScale = Object.freeze({
    savanna: [30, 24],
    forest: [32, 27],
    farm: [34, 26],
    penguinCove: [18, 17],
  });
  for (const region of regions) {
    const material = regionMaterials[region.id];
    const scale = regionPatchScale[region.id];
    if (!material || !scale) continue;
    const patch = addMesh(group, lowCylinder, material, region.center.x, 0.015, region.center.z,
      scale[0], 0.04, scale[1]);
    patch.name = `zoo-region-${region.id}`;
    patch.rotation.y = region.id === 'forest' ? -0.22 : region.id === 'farm' ? 0.17 : 0;
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

  const feederPosition = landmarkById.get('giraffeFeeder');
  if (feederPosition) {
    markPhotoOccluder(addMesh(group, cylinder, timber,
      feederPosition.x, 2.3, feederPosition.z, 0.24, 4.6, 0.24));
    markPhotoOccluder(addMesh(group, box, hay,
      feederPosition.x, 4.05, feederPosition.z, 1.4, 0.75, 0.75));
    markPhotoOccluder(addMesh(group, box, timber,
      feederPosition.x, 4.05, feederPosition.z + 0.42, 1.65, 0.13, 0.13));
  }
  const mudPool = addMesh(group, lowCylinder, mud, -17.1, 0.06, 9.1, 4.1, 0.1, 2.8);
  mudPool.name = 'zoo-elephant-mud-pool';
  mudPool.rotation.y = -0.35;

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

  // The cove water remains a simple plane in this layout-only order.
  const cove = regions.find((region) => region.id === 'penguinCove');
  const penguinHabitat = campusHabitats.find((habitat) => habitat.id === 'penguin');
  if (cove && penguinHabitat) addMesh(group, lowCylinder, water,
    penguinHabitat.x, 0.01, penguinHabitat.z, 6.65, 0.06, 6.1);

  function canvasTexture(canvas) {
    canvases.add(canvas);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    textures.add(texture);
    return texture;
  }

  function drawSmallAnimalIcon(context, id, x, y, scale = 0.16) {
    context.save();
    context.translate(x, y);
    context.scale(scale, scale);
    drawAnimalIcon(context, id, 0, 0);
    context.restore();
  }

  function createJunctionSignpost(placement) {
    const data = REGION_SIGNAGE[placement.regionId];
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 284;
    const context = canvas.getContext('2d');
    context.fillStyle = '#fffaf0';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = '#29384a';
    context.lineWidth = 12;
    context.strokeRect(6, 6, canvas.width - 12, canvas.height - 12);
    context.fillStyle = '#1e2c40';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = '800 35px system-ui, sans-serif';
    context.fillText(`${placement.arrow} ${data.name}`, 256, 43, 470);
    const columns = data.animals.length >= 4 ? 2 : 1;
    const rows = Math.ceil(data.animals.length / columns);
    const cellWidth = 480 / columns;
    const cellHeight = 198 / rows;
    data.animals.forEach((id, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const left = 16 + column * cellWidth;
      const centerY = 78 + row * cellHeight + cellHeight * 0.5;
      drawSmallAnimalIcon(context, id, left + 38, centerY, 0.15);
      context.fillStyle = '#26354b';
      context.textAlign = 'left';
      context.font = '700 24px system-ui, sans-serif';
      context.fillText(String(labels[id] ?? id.toUpperCase()), left + 76, centerY, cellWidth - 86);
    });

    const material = ownMaterial(new THREE.MeshBasicMaterial({ map: canvasTexture(canvas), side: THREE.FrontSide }));
    const normalX = Math.sin(placement.facing);
    const normalZ = Math.cos(placement.facing);
    const y = 2.35;
    const backing = addMesh(group, box, dark, placement.x, y, placement.z, 4.94, 2.79, 0.18);
    backing.name = `zoo-region-signpost-${placement.regionId}`;
    backing.rotation.y = placement.facing;
    markPhotoOccluder(backing);
    const face = addMesh(group, junctionSignPlane, material,
      placement.x + normalX * 0.1, y, placement.z + normalZ * 0.1);
    face.name = `${backing.name}-face`;
    face.rotation.y = placement.facing;
    addMesh(group, cylinder, dark, placement.x, 0.72, placement.z, 0.18, 1.44, 0.18);
    return face;
  }

  function createCampusBoard() {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const context = canvas.getContext('2d');
    context.fillStyle = '#fffaf0';
    context.fillRect(0, 0, 512, 512);
    context.strokeStyle = '#29384a';
    context.lineWidth = 12;
    context.strokeRect(6, 6, 500, 500);
    context.fillStyle = '#1e2c40';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = '900 28px system-ui, sans-serif';
    context.fillText('YOU ARE HERE', 256, 31);

    const mapLeft = 30;
    const mapRight = 482;
    const mapTop = 58;
    const mapBottom = 486;
    const mapX = (x) => mapLeft + ((x - campusBounds.minX) / (campusBounds.maxX - campusBounds.minX)) * (mapRight - mapLeft);
    const mapY = (z) => mapBottom - ((z - campusBounds.minZ) / (campusBounds.maxZ - campusBounds.minZ)) * (mapBottom - mapTop);
    const patchColours = { savanna: '#e4c875', forest: '#87b77a', farm: '#abd080', penguinCove: '#a9d9df' };
    const patchSizes = { savanna: [92, 76], forest: [102, 92], farm: [112, 86], penguinCove: [61, 55] };
    for (const region of regions) {
      if (!patchColours[region.id]) continue;
      context.fillStyle = patchColours[region.id];
      context.beginPath();
      context.ellipse(mapX(region.center.x), mapY(region.center.z), ...patchSizes[region.id], 0, 0, TAU);
      context.fill();
    }
    const nodes = new Map(pathNodes.map((node) => [node.id, node]));
    context.strokeStyle = '#e5d0a5';
    context.lineWidth = 10;
    context.lineCap = 'round';
    for (const [fromId, toId] of pathEdges) {
      const from = nodes.get(fromId);
      const to = nodes.get(toId);
      if (!from || !to) continue;
      context.beginPath();
      context.moveTo(mapX(from.x), mapY(from.z));
      context.lineTo(mapX(to.x), mapY(to.z));
      context.stroke();
    }
    for (const region of regions.filter((entry) => REGION_SIGNAGE[entry.id])) {
      context.fillStyle = '#26354b';
      context.font = '700 14px system-ui, sans-serif';
      context.textAlign = 'center';
      context.fillText(REGION_SIGNAGE[region.id].name, mapX(region.center.x), mapY(region.center.z) - 20, 105);
    }
    for (const habitat of campusHabitats) {
      const x = mapX(habitat.x);
      const y = mapY(habitat.z);
      drawSmallAnimalIcon(context, habitat.id, x, y - 4, 0.075);
      context.fillStyle = '#26354b';
      context.font = '700 10px system-ui, sans-serif';
      context.textAlign = 'center';
      context.fillText(String(labels[habitat.id] ?? habitat.id.toUpperCase()), x, y + 16, 64);
    }
    const hereX = mapX(plazaPosition.x);
    const hereY = mapY(plazaPosition.z);
    context.fillStyle = '#e84444';
    context.beginPath();
    context.arc(hereX, hereY, 9, 0, TAU);
    context.fill();
    context.strokeStyle = '#ffffff';
    context.lineWidth = 3;
    context.stroke();

    const x = -5.2;
    const y = 3.35;
    const z = 32.2;
    const material = ownMaterial(new THREE.MeshBasicMaterial({ map: canvasTexture(canvas), side: THREE.FrontSide }));
    const backing = addMesh(group, box, dark, x, y, z, 6.58, 5.23, 0.2);
    backing.name = 'zoo-you-are-here-board';
    markPhotoOccluder(backing);
    const face = addMesh(group, campusBoardPlane, material, x, y, z + 0.11);
    face.name = 'zoo-you-are-here-board-face';
    for (const postX of [x - 2.65, x + 2.65]) addMesh(group, cylinder, dark, postX, 0.72, z, 0.18, 1.44, 0.18);
    return face;
  }

  const junctionSignFaces = JUNCTION_SIGNPOSTS.map(createJunctionSignpost);
  const campusBoardFace = createCampusBoard();

  function addFence(habitatGroup, visual, fenceCollider, viewingDirection) {
    const fenceMaterial = makeMaterial(visual.fence);
    const radius = fenceCollider?.r ?? 3.4;
    const segments = 14;
    const postMatrices = [];
    const railMatrices = [];
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    for (let index = 0; index < segments; index += 1) {
      const angle = (index / segments) * TAU;
      const nextAngle = ((index + 1) / segments) * TAU;
      const x = Math.sin(angle) * radius;
      const z = Math.cos(angle) * radius;
      const nextX = Math.sin(nextAngle) * radius;
      const nextZ = Math.cos(nextAngle) * radius;
      const midpoint = angle + Math.PI / segments;
      const sightlineDelta = Math.abs(Math.atan2(
        Math.sin(midpoint - viewingDirection),
        Math.cos(midpoint - viewingDirection),
      ));
      // Collision remains a forgiving circle, but the visible fence has a low,
      // post-free camera opening centred on the authored viewpoint.
      if (sightlineDelta < 0.34) continue;
      position.set(x, 0.55, z);
      quaternion.identity();
      scale.set(0.12, 1.1, 0.12);
      postMatrices.push(matrix.compose(position, quaternion, scale).clone());
      const railLength = Math.hypot(nextX - x, nextZ - z) + 0.08;
      for (const y of [0.43, 0.82]) {
        position.set((x + nextX) * 0.5, y, (z + nextZ) * 0.5);
        quaternion.setFromAxisAngle(up, Math.atan2(nextX - x, nextZ - z));
        scale.set(0.14, 0.14, railLength);
        railMatrices.push(matrix.compose(position, quaternion, scale).clone());
      }
    }
    const addInstances = (geometry, matrices, name) => {
      if (!matrices.length) return;
      const instances = new THREE.InstancedMesh(geometry, fenceMaterial, matrices.length);
      instances.name = name;
      matrices.forEach((transform, index) => instances.setMatrixAt(index, transform));
      instances.instanceMatrix.needsUpdate = true;
      habitatGroup.add(instances);
    };
    addInstances(cylinder, postMatrices, `${habitatGroup.name}-fence-posts`);
    addInstances(box, railMatrices, `${habitatGroup.name}-fence-rails`);
  }

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

  function applyPhotoBounds(habitat, object) {
    object.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(object);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    habitat.animal.worldToLocal(center);
    habitat.photoTarget.position.copy(center);
    habitat.photoRadius = Math.max(0.18, Math.max(size.x, size.z) * 0.5);
    // Tall, narrow animals (penguin, giraffe, alpaca) were judged by their width
    // alone and never counted as framed; height is measured separately.
    habitat.photoHalfHeight = Math.max(0.18, size.y * 0.5);
  }

  const habitatColliderById = new Map(colliders
    .filter((collider) => collider.role === 'habitatFence')
    .map((collider) => [collider.habitatId, collider]));

  const habitats = campusHabitats.map((position, index) => {
    const visual = ANIMAL_VISUALS[position.id];
    const fenceCollider = habitatColliderById.get(position.id);
    const habitatGroup = new THREE.Group();
    habitatGroup.name = `zoo-habitat-${position.id}`;
    habitatGroup.position.set(position.x, 0, position.z);
    group.add(habitatGroup);
    const enclosureRadius = (fenceCollider?.r ?? 3.35) * 2.02;
    const floorMaterial = position.region === 'penguinCove' ? water : makeMaterial(visual.ground);
    const floor = addMesh(habitatGroup, lowCylinder, floorMaterial,
      0, -0.01, 0, enclosureRadius, 0.12, enclosureRadius);
    floor.rotation.y = Math.PI / 8;
    addFence(habitatGroup, visual, fenceCollider, position.facing);
    // Animals stand still at the pen centre facing their viewpoint; models
    // without an idle clip used to glide around with frozen legs.
    const animal = new THREE.Group();
    animal.name = `zoo-animal-${position.id}`;
    animal.userData.animalId = position.id;
    animal.rotation.y = position.facing;
    habitatGroup.add(animal);
    const photoTarget = new THREE.Object3D();
    photoTarget.name = `zoo-photo-target-${position.id}`;
    animal.add(photoTarget);
    const placeholder = createPlaceholder(ANIMAL_MODELS[position.id].targetHeight);
    animal.add(placeholder);
    const habitat = {
      id: position.id,
      region: position.region,
      x: position.x,
      z: position.z,
      viewpoint: position.viewpoint,
      group: habitatGroup,
      animal,
      photoTarget,
      photoRadius: 0,
      placeholder,
    };
    applyPhotoBounds(habitat, placeholder);
    return habitat;
  });

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

  function placeModel(habitat, sourceObject, clips = []) {
    const config = ANIMAL_MODELS[habitat.id];
    // The glTF animals may be skinned, and Object3D.clone() does not rebind a
    // skeleton. OBJ animals are static meshes and can use a normal deep clone.
    const sourceClone = config.format === 'obj' ? sourceObject.clone(true) : cloneSkinned(sourceObject);
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
    const idle = config.idleClip ? THREE.AnimationClip.findByName(clips, config.idleClip) : null;
    if (idle) {
      const mixer = new THREE.AnimationMixer(sourceClone);
      mixer.clipAction(idle).play();
      animalMixers.push(mixer);
    }
    oriented.updateMatrixWorld(true);

    habitat.animal.remove(habitat.placeholder);
    habitat.animal.add(oriented);
    habitat.model = oriented;
    applyPhotoBounds(habitat, oriented);
  }

  async function fetchAsset(path, responseType) {
    const response = await fetch(publicPath(path), { cache: 'force-cache', signal: modelAbort.signal });
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    return responseType === 'text' ? response.text() : response.arrayBuffer();
  }

  async function loadGltf(file) {
    const path = `assets/animals/${file}`;
    const loader = new GLTFLoader();
    const gltf = await loader.parseAsync(await fetchAsset(path, 'arrayBuffer'), publicPath('assets/animals/'));
    return { scene: gltf.scene, materials: [], animations: gltf.animations };
  }

  async function loadObj(config) {
    const materialPath = `assets/animals/${config.materialFile}`;
    const modelPath = `assets/animals/${config.file}`;
    const resourcePath = publicPath('assets/animals/obj/');
    let materials = null;
    try {
      // Parse and prepare the MTL before the OBJ so its per-part Kd colours are
      // assigned while OBJLoader builds the otherwise textureless meshes.
      const materialText = await fetchAsset(materialPath, 'text');
      materials = new MTLLoader().parse(materialText, resourcePath);
      materials.preload();
      // These files carry Blender's LINEAR Kd values, but MTLLoader reads Kd as
      // sRGB and converts it down again. That second conversion turned the white
      // horse grey, the fox maroon and the cow nearly black. Undo it so the
      // colours the file actually specifies are the ones that render.
      for (const material of Object.values(materials.materials)) {
        material.color?.convertLinearToSRGB();
      }
      const modelText = await fetchAsset(modelPath, 'text');
      const scene = new OBJLoader().setMaterials(materials).parse(modelText);
      return { scene, materials: Object.values(materials.materials) };
    } catch (error) {
      if (materials) {
        for (const material of Object.values(materials.materials)) material.dispose();
      }
      throw error;
    }
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

  function savannaEnclosure(assets) {
    const commonTree = asset(assets, 'common-tree');
    const deadTree = asset(assets, 'dead-tree');
    const grassAsset = asset(assets, 'grass');
    const bushAsset = asset(assets, 'bush');
    const rockOne = asset(assets, 'rock-1');
    if (commonTree) {
      for (const placement of [{ x: -24, z: 25, scale: 1.05 }, { x: -39, z: 8, scale: 0.9 }, { x: -21, z: 1, scale: 0.82 }]) {
        addEnvironmentClone(...commonTree, placement, { occluder: true, name: 'savanna-tree' });
      }
    }
    if (deadTree) addEnvironmentClone(...deadTree, { x: -39, z: 14, yaw: 0.4 }, { occluder: true, name: 'savanna-dead-tree' });
    if (bushAsset) addEnvironmentInstances(...bushAsset, [
      { x: -21, z: 20 }, { x: -29, z: 10, scale: 0.8 }, { x: -40, z: 21 },
      { x: -23, z: 7 }, { x: -39, z: -1 }, { x: -10, z: 20, scale: 0.75 },
    ], { name: 'savanna-bush' });
    if (grassAsset) addEnvironmentInstances(...grassAsset, [
      { x: -18, z: 22 }, { x: -20, z: 18 }, { x: -26, z: 21 }, { x: -31, z: 24 },
      { x: -36, z: 23 }, { x: -40, z: 18 }, { x: -38, z: 5 }, { x: -31, z: 8 },
      { x: -25, z: 3 }, { x: -18, z: 5 }, { x: -9, z: 8 }, { x: -9, z: 13 },
    ], { name: 'savanna-grass' });
    if (rockOne) addEnvironmentInstances(...rockOne, [
      { x: -27, z: 23, scale: 0.7 }, { x: -41, z: 11, scale: 0.9 }, { x: -25, z: 7, scale: 0.65 },
    ], { occluder: true, name: 'savanna-rock' });
  }

  function forestEnclosure(assets) {
    const pineOne = asset(assets, 'pine-1');
    const pineTwo = asset(assets, 'pine-2');
    const fernAsset = asset(assets, 'fern');
    const bushAsset = asset(assets, 'bush');
    const flowerBush = asset(assets, 'flower-bush');
    const pebbleAsset = asset(assets, 'pebble');
    if (pineOne) for (const placement of [
      { x: -39, z: -22 }, { x: -25, z: -21, scale: 0.9 }, { x: -2, z: -22, scale: 1.05 },
    ]) addEnvironmentClone(...pineOne, placement, { occluder: true, name: 'forest-pine' });
    if (pineTwo) for (const placement of [
      { x: -31, z: -28, scale: 0.9 }, { x: -12, z: -14, scale: 0.85 }, { x: -4, z: -30, scale: 0.9 },
    ]) addEnvironmentClone(...pineTwo, placement, { occluder: true, name: 'forest-pine' });
    if (fernAsset) addEnvironmentInstances(...fernAsset, [
      { x: -37, z: -18 }, { x: -34, z: -23 }, { x: -30, z: -19 }, { x: -27, z: -26 },
      { x: -22, z: -17 }, { x: -18, z: -15 }, { x: -15, z: -30 }, { x: -11, z: -12 },
      { x: -3, z: -19 }, { x: -3, z: -8 }, { x: -31, z: -4 }, { x: -19, z: -11 },
    ], { name: 'forest-ferns' });
    if (bushAsset) addEnvironmentInstances(...bushAsset, [
      { x: -37, z: -16 }, { x: -30, z: -19 }, { x: -23, z: -30 }, { x: -18, z: -15 },
      { x: -15, z: -30 }, { x: -3, z: -19 }, { x: -31, z: -4 }, { x: -20, z: -13 },
    ], { name: 'forest-bushes' });
    if (flowerBush) addEnvironmentInstances(...flowerBush, [
      { x: -17, z: -14, scale: 0.8 }, { x: -3, z: -8, scale: 0.75 }, { x: -27, z: -24, scale: 0.8 },
    ], { name: 'forest-flowers' });
    if (pebbleAsset) addEnvironmentInstances(...pebbleAsset, [
      { x: -24, z: -13 }, { x: -20, z: -16 }, { x: -16, z: -19 }, { x: -9, z: -19 }, { x: -4, z: -18 },
    ], { name: 'forest-pebbles' });
  }

  function farmPaddock(assets) {
    const barnAsset = asset(assets, 'farm-barn');
    const wellAsset = asset(assets, 'farm-well');
    const towerAsset = asset(assets, 'water-tower');
    const longFence = asset(assets, 'long-fence');
    const crateAsset = asset(assets, 'crate');
    if (barnAsset && barnPosition) {
      addEnvironmentClone(...barnAsset, { x: barnPosition.x, z: barnPosition.z, yaw: -0.08 }, { occluder: true, name: 'farm-barn' });
      if (barnFallback) {
        barnFallback.traverse((object) => {
          const index = photoOccluders.indexOf(object);
          if (index >= 0) photoOccluders.splice(index, 1);
        });
        barnFallback.removeFromParent();
      }
    }
    if (wellAsset) addEnvironmentClone(...wellAsset, { x: 25, z: 25, yaw: -0.35 }, { occluder: true, name: 'farm-well' });
    if (towerAsset) addEnvironmentClone(...towerAsset, { x: 38.5, z: 28, yaw: 0.15 }, { occluder: true, name: 'farm-water-tower' });
    if (longFence) addEnvironmentInstances(...longFence, [
      { x: 19, z: 29, yaw: Math.PI / 2 }, { x: 23, z: 29, yaw: Math.PI / 2 },
      { x: 27, z: 27, yaw: 0.1 }, { x: 29, z: 25, yaw: 0.1 },
    ], { name: 'farm-paddock-fence' });
    if (crateAsset) addEnvironmentInstances(...crateAsset, [
      { x: 28.5, z: 24.8 }, { x: 29.3, z: 24.8, scale: 0.8 }, { x: 30, z: 24.6, yaw: 0.3 },
    ], { occluder: true, name: 'farm-crates' });
  }

  function coveKit(assets) {
    const rockOne = asset(assets, 'rock-1');
    const rockTwo = asset(assets, 'rock-2');
    const lowFence = asset(assets, 'low-fence');
    if (rockOne) addEnvironmentInstances(...rockOne, [
      { x: 32, z: -20, scale: 0.8 }, { x: 38.5, z: -19, scale: 0.95 }, { x: 39, z: -10.2, scale: 0.7 },
    ], { occluder: true, name: 'cove-rock' });
    if (rockTwo) addEnvironmentInstances(...rockTwo, [
      { x: 34, z: -20.3 }, { x: 40, z: -17.5 }, { x: 33, z: -9.7, scale: 0.75 },
    ], { occluder: true, name: 'cove-rock' });
    if (lowFence) addEnvironmentInstances(...lowFence, [
      { x: 33, z: -9, yaw: 0, scale: 0.6 }, { x: 37, z: -9, yaw: 0, scale: 0.6 },
      { x: 40.2, z: -12, yaw: Math.PI / 2, scale: 0.6 },
      { x: 40.2, z: -16, yaw: Math.PI / 2, scale: 0.6 },
    ], { name: 'cove-railing' });
  }

  function entrancePlazaKit(assets) {
    const planterAsset = asset(assets, 'planter');
    const tableAsset = asset(assets, 'cafe-table');
    const chairAsset = asset(assets, 'cafe-chair');
    const crateAsset = asset(assets, 'crate');
    if (planterAsset) addEnvironmentInstances(...planterAsset, [
      { x: -8.8, z: 34.5 }, { x: -1.5, z: 34.5 }, { x: 6.3, z: 31 }, { x: 9.5, z: 35 },
    ], { name: 'entrance-planters' });
    if (tableAsset) addEnvironmentInstances(...tableAsset, [
      { x: 7.2, z: 31.8 }, { x: 9, z: 33.8, yaw: 0.4 },
    ], { name: 'cafe-tables' });
    if (chairAsset) addEnvironmentInstances(...chairAsset, [
      { x: 6.1, z: 31.8, yaw: Math.PI / 2 }, { x: 8.3, z: 31.8, yaw: -Math.PI / 2 },
      { x: 7.2, z: 30.7, yaw: Math.PI }, { x: 7.2, z: 32.9 },
      { x: 7.9, z: 33.8, yaw: Math.PI / 2 }, { x: 10.1, z: 33.8, yaw: -Math.PI / 2 },
    ], { name: 'cafe-chairs' });
    if (crateAsset) addEnvironmentClone(...crateAsset,
      { x: boothPosition.x - 0.8, z: boothPosition.z - 1.35, yaw: 0.2, scale: 0.75 },
      { occluder: true, name: 'ticket-crate' });
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
      const assets = new Map(entries.filter(Boolean));
      entrancePlazaKit(assets);
      savannaEnclosure(assets);
      forestEnclosure(assets);
      farmPaddock(assets);
      coveKit(assets);
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

  function loadAnimals() {
    if (loadPromise) return loadPromise;
    const configs = [...new Map(Object.values(ANIMAL_MODELS).map((config) => [config.file, config])).values()];
    loadPromise = Promise.all(configs.map(async (fileConfig) => {
      const { file } = fileConfig;
      try {
        const asset = fileConfig.format === 'obj' ? await loadObj(fileConfig) : await loadGltf(file);
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
          placeModel(habitat, sourceObject, asset.animations);
        }
      } catch (error) {
        if (!disposed) console.warn(`[zoo] ${file} unavailable; keeping animal placeholders.`, error);
      }
    }));
    return loadPromise;
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
    for (const mixer of animalMixers) mixer.update(step);
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
    for (const mixer of animalMixers) mixer.stopAllAction();
    animalMixers.length = 0;
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

  const signageData = Object.freeze({
    youAreHere: Object.freeze({
      exists: Boolean(campusBoardFace),
      regions: Object.freeze(Object.entries(REGION_SIGNAGE).map(([id, data]) => Object.freeze({ id, name: data.name }))),
      animals: Object.freeze(campusHabitats.map((habitat) => Object.freeze({
        id: habitat.id,
        label: String(labels[habitat.id] ?? habitat.id.toUpperCase()),
        region: habitat.region,
      }))),
    }),
    signposts: Object.freeze(JUNCTION_SIGNPOSTS.map((signpost, index) => {
      const data = REGION_SIGNAGE[signpost.regionId];
      return Object.freeze({
        id: signpost.id,
        exists: Boolean(junctionSignFaces[index]),
        regionId: signpost.regionId,
        regionName: data.name,
        animals: Object.freeze(data.animals.map((id) => Object.freeze({
          id,
          label: String(labels[id] ?? id.toUpperCase()),
        }))),
      });
    })),
  });

  function getSignageData() {
    return signageData;
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
    getEnvironmentState, getSignageData, dispose,
    countBlockedSamples, occluderDistances, visibilitySampleCount: VISIBILITY_OFFSETS.length,
  };
}
