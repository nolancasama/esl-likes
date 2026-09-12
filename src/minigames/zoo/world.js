import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

const TAU = Math.PI * 2;

export const HABITAT_POSITIONS = Object.freeze([
  Object.freeze({ id: 'elephant', x: -25.28, z: 18 }),
  Object.freeze({ id: 'giraffe', x: -31.32, z: 8.8 }),
  Object.freeze({ id: 'penguin', x: -32.94, z: -1.63 }),
  Object.freeze({ id: 'tiger', x: -29.91, z: -11.83 }),
  Object.freeze({ id: 'deer', x: -22.63, z: -20.37 }),
  Object.freeze({ id: 'alpaca', x: -12.18, z: -26.03 }),
  Object.freeze({ id: 'horse', x: 0, z: -28 }),
  Object.freeze({ id: 'fox', x: 12.18, z: -26.03 }),
  Object.freeze({ id: 'wolf', x: 22.63, z: -20.37 }),
  Object.freeze({ id: 'stag', x: 29.91, z: -11.83 }),
  Object.freeze({ id: 'bull', x: 32.94, z: -1.63 }),
  Object.freeze({ id: 'cow', x: 31.32, z: 8.8 }),
  Object.freeze({ id: 'donkey', x: 25.28, z: 18 }),
]);

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

  const group = new THREE.Group();
  group.name = 'zoo-world';

  const box = ownGeometry(new THREE.BoxGeometry(1, 1, 1));
  const cylinder = ownGeometry(new THREE.CylinderGeometry(0.5, 0.5, 1, 12));
  const lowCylinder = ownGeometry(new THREE.CylinderGeometry(0.5, 0.5, 1, 24));
  const sphere = ownGeometry(new THREE.SphereGeometry(0.5, 12, 8));
  const plane = ownGeometry(new THREE.PlaneGeometry(5.1, 2.35));
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

  addMesh(group, box, grass, 0, -0.24, 0.8, 100, 0.5, 96);

  // One continuous, overlapping path loop. The plaza intersects the southern
  // side, so following either direction always visits every habitat and returns.
  const pathSegments = 144;
  for (let index = 0; index < pathSegments; index += 1) {
    const angle = (index / pathSegments) * TAU;
    const nextAngle = ((index + 1) / pathSegments) * TAU;
    const point = new THREE.Vector2(Math.sin(angle) * 29.4, Math.cos(angle) * 24.9);
    const next = new THREE.Vector2(Math.sin(nextAngle) * 29.4, Math.cos(nextAngle) * 24.9);
    const length = point.distanceTo(next) + 0.22;
    const slab = addMesh(
      group,
      box,
      pathMaterial,
      (point.x + next.x) * 0.5,
      0.015,
      (point.y + next.y) * 0.5,
      3.25,
      0.08,
      length,
    );
    slab.rotation.y = Math.atan2(next.x - point.x, next.y - point.y);
  }

  const plaza = addMesh(group, lowCylinder, plazaMaterial, 0, 0.015, 27.6, 5.5, 0.14, 5.5);
  plaza.rotation.y = Math.PI / 16;

  // Fountain is offset so it is a clear landmark without blocking the avatar,
  // visitors, or the path mouth.
  addMesh(group, lowCylinder, stone, 3.45, 0.25, 28.05, 2.05, 0.5, 2.05);
  addMesh(group, lowCylinder, water, 3.45, 0.51, 28.05, 1.67, 0.08, 1.67);
  addMesh(group, cylinder, stoneDark, 3.45, 0.98, 28.05, 0.32, 1.45, 0.32);
  const fountainTop = addMesh(group, sphere, water, 3.45, 1.82, 28.05, 0.32, 0.5, 0.32);
  animations.push({ kind: 'fountain', object: fountainTop });

  // A tall, unmistakable tree on the opposite side of the entrance plaza.
  addMesh(group, cylinder, bark, -4.35, 2.25, 28.15, 0.85, 4.5, 0.85);
  addMesh(group, sphere, leaf, -4.35, 5.15, 28.15, 3.3, 3.2, 3.3);
  addMesh(group, sphere, leafLight, -3.25, 5.6, 27.85, 2.15, 2.1, 2.15);

  // Striped entrance gate. The clear centre span is wide enough for movement.
  for (const x of [-2.8, 2.8]) {
    for (let stripe = 0; stripe < 5; stripe += 1) {
      addMesh(group, box, stripe % 2 ? gateWhite : gateRed, x, 0.45 + stripe * 0.9, 32.15, 0.62, 0.9, 0.62);
    }
  }
  for (let stripe = 0; stripe < 7; stripe += 1) {
    addMesh(group, box, stripe % 2 ? gateWhite : gateRed, -2.55 + stripe * 0.85, 4.58, 32.15, 0.86, 0.62, 0.62);
  }

  function createSign(id, habitatGroup, worldX, worldZ) {
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
    // Front face only: a double-sided plane shows the lettering mirrored from
    // behind, which read as backwards English across the zoo. The back gets a
    // plain board instead.
    const material = ownMaterial(new THREE.MeshBasicMaterial({ map: texture }));
    const inward = new THREE.Vector2(-worldX, -worldZ).normalize();
    const tangent = new THREE.Vector2(-inward.y, inward.x);
    const signX = inward.x * 3.3 + tangent.x * 3.5;
    const signZ = inward.y * 3.3 + tangent.y * 3.5;
    const sign = addMesh(habitatGroup, plane, material, signX, 3.0, signZ);
    sign.rotation.y = Math.atan2(inward.x, inward.y);
    const backing = addMesh(habitatGroup, plane, ownMaterial(new THREE.MeshBasicMaterial({ color: 0xf3f6fa })),
      signX + inward.x * 0.04, 3.0, signZ + inward.y * 0.04);
    backing.rotation.y = sign.rotation.y + Math.PI;
    addMesh(habitatGroup, cylinder, dark, signX, 1.45, signZ, 0.15, 2.9, 0.15);
    return sign;
  }

  function addFence(habitatGroup, visual) {
    const fenceMaterial = makeMaterial(visual.fence);
    for (const x of [-2.8, 2.8]) {
      for (const z of [-2.3, 2.3]) addMesh(habitatGroup, cylinder, fenceMaterial, x, 0.7, z, 0.16, 1.4, 0.16);
    }
    for (const z of [-2.3, 2.3]) {
      for (const y of [0.55, 1.05]) addMesh(habitatGroup, box, fenceMaterial, 0, y, z, 5.75, 0.14, 0.14);
    }
    for (const x of [-2.8, 2.8]) {
      for (const y of [0.55, 1.05]) addMesh(habitatGroup, box, fenceMaterial, x, y, 0, 0.14, 0.14, 4.75);
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
  }

  const habitats = HABITAT_POSITIONS.map((position, index) => {
    const visual = ANIMAL_VISUALS[position.id];
    const habitatGroup = new THREE.Group();
    habitatGroup.name = `zoo-habitat-${position.id}`;
    habitatGroup.position.set(position.x, 0, position.z);
    group.add(habitatGroup);
    const floor = addMesh(habitatGroup, lowCylinder, makeMaterial(visual.ground), 0, -0.01, 0, 3.45, 0.12, 3.45);
    floor.rotation.y = Math.PI / 8;
    addFence(habitatGroup, visual);
    const sign = createSign(position.id, habitatGroup, position.x, position.z);
    const animal = new THREE.Group();
    animal.name = `zoo-animal-${position.id}`;
    animal.userData.animalId = position.id;
    const facing = Math.atan2(-position.x, -position.z);
    const inward = new THREE.Vector2(-position.x, -position.z).normalize();
    const tangent = new THREE.Vector2(-inward.y, inward.x);
    const baseX = -tangent.x * 0.85;
    const baseZ = -tangent.y * 0.85;
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
      x: position.x,
      z: position.z,
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
        animation.object.position.y = 1.82 + Math.sin(elapsed * 2.2) * 0.08;
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

  return { group, habitats, loadAnimals, update, dispose };
}
