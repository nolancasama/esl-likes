import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import {
  PATH_WIDTH,
  SIGN_DEPTH,
  SIGN_WIDTH,
  bounds as campusBounds,
  colliders,
  habitats as campusHabitats,
  landmarks,
  pathEdges,
  pathNodes,
  regions,
  signs as campusSigns,
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
  giraffe: Object.freeze({ file: 'giraffe.glb', targetHeight: 3.65 }),
  penguin: Object.freeze({ file: 'Animals.glb', node: 'pinguin.001', targetHeight: 1.55 }),
  tiger: Object.freeze({ file: 'Animals.glb', node: 'tiger', targetHeight: 1.65 }),
  deer: Object.freeze({ file: 'Animals.glb', node: 'deer', targetHeight: 2 }),
  // A .gltf rather than .glb: its buffers and colours are embedded, so the same
  // fetch-and-parse path loads it. Its materials are already distinct browns, so
  // unlike the elephant it needs no tint.
  alpaca: Object.freeze({ file: 'alpaca.gltf', targetHeight: 1.7 }),
  horse: Object.freeze({ file: 'obj/Horse_White.obj', materialFile: 'obj/Horse_White.mtl', format: 'obj', targetHeight: 2.2 }),
  fox: Object.freeze({ file: 'obj/Fox.obj', materialFile: 'obj/Fox.mtl', format: 'obj', targetHeight: 1.05 }),
  wolf: Object.freeze({ file: 'obj/Wolf.obj', materialFile: 'obj/Wolf.mtl', format: 'obj', targetHeight: 1.35 }),
  stag: Object.freeze({ file: 'obj/Stag.obj', materialFile: 'obj/Stag.mtl', format: 'obj', targetHeight: 2.45 }),
  bull: Object.freeze({ file: 'obj/Bull.obj', materialFile: 'obj/Bull.mtl', format: 'obj', targetHeight: 2.35 }),
  cow: Object.freeze({ file: 'obj/Cow.obj', materialFile: 'obj/Cow.mtl', format: 'obj', targetHeight: 2.2 }),
  donkey: Object.freeze({ file: 'obj/Donkey.obj', materialFile: 'obj/Donkey.mtl', format: 'obj', targetHeight: 1.9 }),
});

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
  const modelAbort = new AbortController();
  let loadPromise = null;
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

  const box = ownGeometry(new THREE.BoxGeometry(1, 1, 1));
  const cylinder = ownGeometry(new THREE.CylinderGeometry(0.5, 0.5, 1, 12));
  const lowCylinder = ownGeometry(new THREE.CylinderGeometry(0.5, 0.5, 1, 24));
  const sphere = ownGeometry(new THREE.SphereGeometry(0.5, 12, 8));
  const signPlane = ownGeometry(new THREE.PlaneGeometry(SIGN_WIDTH, 1.57));
  const grass = makeMaterial(0x75b866);
  const pathMaterial = makeMaterial(0xe8d3a4);
  const plazaMaterial = makeMaterial(0xd9cab3);
  const stone = makeMaterial(0xb0a79d);
  const stoneDark = makeMaterial(0x777b83);
  const water = makeMaterial(0x4bb9d1, { transparent: true, opacity: 0.8 });
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

  const fountainPosition = landmarkById.get('fountainHub')
    ?? pathNodes.find((node) => node.kind === 'hub')
    ?? { x: 0, z: 0 };
  markPhotoOccluder(addMesh(group, lowCylinder, stone,
    fountainPosition.x, 0.25, fountainPosition.z, 2.05, 0.5, 2.05));
  addMesh(group, lowCylinder, water, fountainPosition.x, 0.51, fountainPosition.z, 1.67, 0.08, 1.67);
  markPhotoOccluder(addMesh(group, cylinder, stoneDark,
    fountainPosition.x, 0.98, fountainPosition.z, 0.32, 1.45, 0.32));
  const fountainTop = addMesh(group, sphere, water,
    fountainPosition.x, 1.82, fountainPosition.z, 0.32, 0.5, 0.32);
  fountainTop.userData.baseY = 1.82;
  animations.push({ kind: 'fountain', object: fountainTop });

  // Striped entrance gate, retaining a wide clear centre span.
  const gatePosition = landmarkById.get('entranceGate') ?? { x: plazaPosition.x, z: plazaPosition.z + 5 };
  const gatePosts = colliders.filter((collider) => collider.landmarkId === 'entranceGate');
  const gateXs = gatePosts.length === 2 ? gatePosts.map((collider) => collider.x) : [-2.8, 2.8];
  for (const gateX of gateXs) {
    for (let stripe = 0; stripe < 5; stripe += 1) {
      markPhotoOccluder(addMesh(group, box, stripe % 2 ? gateWhite : gateRed,
        gateX, 0.45 + stripe * 0.9, gatePosition.z, 0.62, 0.9, 0.62));
    }
  }
  const gateLeft = Math.min(...gateXs);
  const gateRight = Math.max(...gateXs);
  const gateStripeWidth = (gateRight - gateLeft) / 7;
  for (let stripe = 0; stripe < 7; stripe += 1) {
    addMesh(group, box, stripe % 2 ? gateWhite : gateRed,
      gateLeft + gateStripeWidth * (stripe + 0.5), 4.58, gatePosition.z,
      gateStripeWidth + 0.02, 0.62, 0.62);
  }

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

  const barnPosition = landmarkById.get('barn');
  if (barnPosition) {
    const barnCollider = colliders.find((collider) => collider.landmarkId === 'barn');
    const barnWidth = (barnCollider?.hw ?? 2.7) * 2;
    const barnDepth = (barnCollider?.hd ?? 2.1) * 2;
    const barnBody = addMesh(group, box, barnRed,
      barnPosition.x, 2, barnPosition.z, barnWidth, 4, barnDepth);
    markPhotoOccluder(barnBody);
    barnBody.rotation.y = barnCollider?.rotation ?? 0;
    const roof = addMesh(group, box, barnTrim, barnPosition.x, 4.35, barnPosition.z, 6.1, 0.75, 4.8);
    markPhotoOccluder(roof);
    roof.rotation.y = barnCollider?.rotation ?? 0;
    markPhotoOccluder(addMesh(group, box, dark,
      barnPosition.x, 1.4, barnPosition.z + 2.12, 1.8, 2.8, 0.12));
  }

  const bridgePosition = landmarkById.get('penguinBridge');
  if (bridgePosition) {
    markPhotoOccluder(addMesh(group, box, timber,
      bridgePosition.x, 0.42, bridgePosition.z, 5.6, 0.35, 1.5));
    for (const zOffset of [-0.8, 0.8]) {
      markPhotoOccluder(addMesh(group, box, paleRock,
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

  function createSign(id, placement) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 236;
    canvases.add(canvas);
    const context = canvas.getContext('2d');
    context.fillStyle = '#fffaf0';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = '#29384a';
    context.lineWidth = 14;
    context.strokeRect(7, 7, canvas.width - 14, canvas.height - 14);
    drawAnimalIcon(context, id, 105, 119);
    const label = String(labels[id] ?? id);
    context.fillStyle = '#1e2c40';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = `900 ${label.length > 8 ? 59 : 70}px system-ui, sans-serif`;
    context.fillText(label, 343, 120, 310);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    textures.add(texture);
    // A double-sided plane shows the lettering mirrored from behind, so the
    // board carries two single-sided planes back to back, each reading
    // correctly. Placement comes from layout.js, beside the viewpoint spur and
    // clear of the photo sightline.
    const material = ownMaterial(new THREE.MeshBasicMaterial({ map: texture }));
    const normalX = Math.sin(placement.facing);
    const normalZ = Math.cos(placement.facing);
    const boardY = 2.25;
    const board = addMesh(group, box, dark, placement.x, boardY, placement.z,
      SIGN_WIDTH + 0.12, 1.69, SIGN_DEPTH * 0.8);
    board.rotation.y = placement.facing;
    markPhotoOccluder(board);
    const half = SIGN_DEPTH * 0.5;
    const front = addMesh(group, signPlane, material,
      placement.x + normalX * half, boardY, placement.z + normalZ * half);
    front.rotation.y = placement.facing;
    const back = addMesh(group, signPlane, material,
      placement.x - normalX * half, boardY, placement.z - normalZ * half);
    back.rotation.y = placement.facing + Math.PI;
    addMesh(group, cylinder, dark, placement.x, 0.72, placement.z, 0.15, 1.44, 0.15);
    return front;
  }

  function addFence(habitatGroup, visual, fenceCollider) {
    const fenceMaterial = makeMaterial(visual.fence);
    const radius = fenceCollider?.r ?? 3.4;
    const segments = 14;
    for (let index = 0; index < segments; index += 1) {
      const angle = (index / segments) * TAU;
      const nextAngle = ((index + 1) / segments) * TAU;
      const x = Math.sin(angle) * radius;
      const z = Math.cos(angle) * radius;
      const nextX = Math.sin(nextAngle) * radius;
      const nextZ = Math.cos(nextAngle) * radius;
      addMesh(habitatGroup, cylinder, fenceMaterial, x, 0.7, z, 0.14, 1.4, 0.14);
      const railLength = Math.hypot(nextX - x, nextZ - z) + 0.08;
      for (const y of [0.55, 1.05]) {
        const rail = addMesh(habitatGroup, box, fenceMaterial,
          (x + nextX) * 0.5, y, (z + nextZ) * 0.5, 0.14, 0.14, railLength);
        rail.rotation.y = Math.atan2(nextX - x, nextZ - z);
      }
    }
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
    addFence(habitatGroup, visual, fenceCollider);
    const signPlacement = campusSigns.find((entry) => entry.habitatId === position.id);
    const sign = signPlacement ? createSign(position.id, signPlacement) : null;
    const animal = new THREE.Group();
    animal.name = `zoo-animal-${position.id}`;
    animal.userData.animalId = position.id;
    const facing = position.facing;
    const tangentX = -Math.cos(facing);
    const tangentZ = Math.sin(facing);
    const baseX = -tangentX * 0.55;
    const baseZ = -tangentZ * 0.55;
    animal.position.set(baseX, 0, baseZ);
    animal.rotation.y = facing;
    habitatGroup.add(animal);
    const photoTarget = new THREE.Object3D();
    photoTarget.name = `zoo-photo-target-${position.id}`;
    animal.add(photoTarget);
    const placeholder = createPlaceholder(ANIMAL_MODELS[position.id].targetHeight);
    animal.add(placeholder);
    animations.push({
      kind: 'animal',
      object: animal,
      phase: index * 1.07,
      speed: 0.18 + index * 0.012,
      radiusX: 0.55 + (index % 2) * 0.18,
      radiusZ: 0.34 + ((index + 1) % 2) * 0.15,
      baseY: 0,
      baseX,
      baseZ,
      facing,
    });
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
      sign,
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

  function placeModel(habitat, sourceObject) {
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

    habitat.animal.remove(habitat.placeholder);
    habitat.animal.add(content);
    habitat.model = content;
    applyPhotoBounds(habitat, content);
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
    return { scene: gltf.scene, materials: [] };
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
          placeModel(habitat, sourceObject);
        }
      } catch (error) {
        if (!disposed) console.warn(`[zoo] ${file} unavailable; keeping animal placeholders.`, error);
      }
    }));
    return loadPromise;
  }

  // Gentle landmark labels are intentionally absent: habitat signs are the
  // only directional information, and none is connected to a visitor request.
  group.add(new THREE.HemisphereLight(0xffffff, 0x5f844e, 2.35));
  const sun = new THREE.DirectionalLight(0xffffff, 2.15);
  sun.position.set(10, 18, 12);
  group.add(sun);

  function update(dt) {
    if (disposed) return;
    elapsed += Math.max(0, Math.min(Number.isFinite(dt) ? dt : 0, 0.1));
    for (const animation of animations) {
      if (animation.kind === 'fountain') {
        animation.object.position.y = animation.object.userData.baseY + Math.sin(elapsed * 2.2) * 0.08;
        continue;
      }
      const angle = elapsed * animation.speed + animation.phase;
      const x = animation.baseX + Math.cos(angle) * animation.radiusX;
      const z = animation.baseZ + Math.sin(angle) * animation.radiusZ;
      const previousX = animation.object.position.x;
      const previousZ = animation.object.position.z;
      animation.object.position.set(x, animation.baseY, z);
      const moved = Math.abs(x - previousX) + Math.abs(z - previousZ) > 0.00001;
      if (moved) animation.object.rotation.y = animation.facing + Math.sin(angle * 1.7) * 0.1;
    }
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
  }

  function getSceneStats() {
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

  return {
    group, habitats, loadAnimals, update, getSceneStats, dispose,
    countBlockedSamples, occluderDistances, visibilitySampleCount: VISIBILITY_OFFSETS.length,
  };
}
