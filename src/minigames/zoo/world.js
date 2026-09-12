import * as THREE from 'three';

const TAU = Math.PI * 2;

export const HABITAT_POSITIONS = Object.freeze([
  Object.freeze({ id: 'elephant', x: -10.5, z: 10.8 }),
  Object.freeze({ id: 'lion', x: -16.4, z: 2.5 }),
  Object.freeze({ id: 'panda', x: -12, z: -9.5 }),
  Object.freeze({ id: 'monkey', x: -3.8, z: -12.8 }),
  Object.freeze({ id: 'giraffe', x: 7.2, z: -12 }),
  Object.freeze({ id: 'penguin', x: 16, z: 4.7 }),
]);

const ANIMAL_VISUALS = Object.freeze({
  elephant: Object.freeze({ ground: 0xb8c990, fence: 0x8d7356, radius: 1.45 }),
  lion: Object.freeze({ ground: 0xd9bd72, fence: 0x9c7140, radius: 1.3 }),
  panda: Object.freeze({ ground: 0x78ad70, fence: 0x735942, radius: 1.25 }),
  monkey: Object.freeze({ ground: 0x7ea56d, fence: 0x735942, radius: 1.2 }),
  giraffe: Object.freeze({ ground: 0xdab96a, fence: 0x9c7140, radius: 2.15 }),
  penguin: Object.freeze({ ground: 0x9bcdd5, fence: 0x648d99, radius: 1.2 }),
});

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
  } else if (id === 'lion') {
    fillRect('#dca34d', -68, -18, 100, 52);
    fillCircle('#8d5b35', 46, -18, 42);
    fillCircle('#dfa950', 46, -18, 26);
  } else if (id === 'panda') {
    fillRect('#f4f1e8', -62, -24, 96, 60);
    fillCircle('#f4f1e8', 46, -20, 36);
    fillCircle('#222833', 26, -48, 13);
    fillCircle('#222833', 66, -48, 13);
    fillCircle('#222833', 34, -23, 9);
    fillCircle('#222833', 58, -23, 9);
  } else if (id === 'monkey') {
    fillRect('#865537', -48, -22, 77, 61);
    fillCircle('#865537', 42, -25, 32);
    fillCircle('#d7a06b', 47, -21, 19);
    context.beginPath();
    context.arc(-42, 5, 44, 0.45 * Math.PI, 1.65 * Math.PI);
    context.stroke();
  } else if (id === 'giraffe') {
    fillRect('#e9bb4e', -64, 4, 82, 38);
    fillRect('#e9bb4e', 2, -68, 26, 88);
    fillRect('#e9bb4e', 5, -83, 58, 30);
    context.fillStyle = '#995e32';
    for (const [sx, sy] of [[-43, 17], [-12, 9], [11, -46], [12, -14], [38, -72]]) {
      context.fillRect(sx, sy, 13, 13);
    }
  } else {
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
  const animations = [];
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

  addMesh(group, box, grass, 0, -0.24, 0.8, 42, 0.5, 38);

  // One continuous, overlapping path loop. The plaza intersects the southern
  // side, so following either direction always visits every habitat and returns.
  const pathSegments = 72;
  for (let index = 0; index < pathSegments; index += 1) {
    const angle = (index / pathSegments) * TAU;
    const nextAngle = ((index + 1) / pathSegments) * TAU;
    const point = new THREE.Vector2(Math.sin(angle) * 13.4, Math.cos(angle) * 9.9);
    const next = new THREE.Vector2(Math.sin(nextAngle) * 13.4, Math.cos(nextAngle) * 9.9);
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

  const plaza = addMesh(group, lowCylinder, plazaMaterial, 0, 0.015, 12.6, 5.5, 0.14, 5.5);
  plaza.rotation.y = Math.PI / 16;

  // Fountain is offset so it is a clear landmark without blocking the avatar,
  // visitors, or the path mouth.
  addMesh(group, lowCylinder, stone, 3.45, 0.25, 13.05, 2.05, 0.5, 2.05);
  addMesh(group, lowCylinder, water, 3.45, 0.51, 13.05, 1.67, 0.08, 1.67);
  addMesh(group, cylinder, stoneDark, 3.45, 0.98, 13.05, 0.32, 1.45, 0.32);
  const fountainTop = addMesh(group, sphere, water, 3.45, 1.82, 13.05, 0.32, 0.5, 0.32);
  animations.push({ kind: 'fountain', object: fountainTop });

  // A tall, unmistakable tree on the opposite side of the entrance plaza.
  addMesh(group, cylinder, bark, -4.35, 2.25, 13.15, 0.85, 4.5, 0.85);
  addMesh(group, sphere, leaf, -4.35, 5.15, 13.15, 3.3, 3.2, 3.3);
  addMesh(group, sphere, leafLight, -3.25, 5.6, 12.85, 2.15, 2.1, 2.15);

  // Striped entrance gate. The clear centre span is wide enough for movement.
  for (const x of [-2.8, 2.8]) {
    for (let stripe = 0; stripe < 5; stripe += 1) {
      addMesh(group, box, stripe % 2 ? gateWhite : gateRed, x, 0.45 + stripe * 0.9, 17.15, 0.62, 0.9, 0.62);
    }
  }
  for (let stripe = 0; stripe < 7; stripe += 1) {
    addMesh(group, box, stripe % 2 ? gateWhite : gateRed, -2.55 + stripe * 0.85, 4.58, 17.15, 0.86, 0.62, 0.62);
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
    const sign = addMesh(habitatGroup, plane, material, inward.x * 3.3, 3.0, inward.y * 3.3);
    sign.rotation.y = Math.atan2(inward.x, inward.y);
    const backing = addMesh(habitatGroup, plane, ownMaterial(new THREE.MeshBasicMaterial({ color: 0xf3f6fa })),
      inward.x * 3.34, 3.0, inward.y * 3.34);
    backing.rotation.y = sign.rotation.y + Math.PI;
    addMesh(habitatGroup, cylinder, dark, inward.x * 3.3, 1.45, inward.y * 3.3, 0.15, 2.9, 0.15);
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

  function createElephant(parent) {
    const animal = new THREE.Group();
    const gray = makeMaterial(0x929da5);
    const grayLight = makeMaterial(0xb7c0c4);
    const ivory = makeMaterial(0xfff2c9);
    addMesh(animal, box, gray, 0, 1.3, 0, 2.15, 1.2, 1.12);
    for (const x of [-0.72, 0.72]) for (const z of [-0.34, 0.34]) addMesh(animal, box, gray, x, 0.48, z, 0.42, 1.05, 0.42);
    addMesh(animal, box, gray, 0, 1.62, 0.9, 1.05, 1.02, 0.82);
    addMesh(animal, box, grayLight, -0.64, 1.68, 0.83, 0.34, 0.9, 0.72);
    addMesh(animal, box, grayLight, 0.64, 1.68, 0.83, 0.34, 0.9, 0.72);
    addMesh(animal, box, gray, 0, 0.98, 1.43, 0.3, 1.55, 0.3);
    const leftTusk = addMesh(animal, cylinder, ivory, -0.31, 1.12, 1.48, 0.08, 0.65, 0.08);
    const rightTusk = addMesh(animal, cylinder, ivory, 0.31, 1.12, 1.48, 0.08, 0.65, 0.08);
    leftTusk.rotation.x = rightTusk.rotation.x = -0.18;
    parent.add(animal);
    return animal;
  }

  function createLion(parent) {
    const animal = new THREE.Group();
    const gold = makeMaterial(0xd79b43);
    const mane = makeMaterial(0x7e4d2d);
    const muzzle = makeMaterial(0xf0c476);
    addMesh(animal, box, gold, 0, 1.05, 0, 1.8, 0.95, 0.9);
    for (const x of [-0.62, 0.62]) for (const z of [-0.27, 0.27]) addMesh(animal, box, gold, x, 0.42, z, 0.3, 0.9, 0.3);
    addMesh(animal, box, mane, 0, 1.45, 0.8, 1.2, 1.25, 0.45);
    addMesh(animal, box, gold, 0, 1.47, 1.08, 0.83, 0.82, 0.7);
    addMesh(animal, box, muzzle, 0, 1.28, 1.5, 0.52, 0.34, 0.24);
    const tail = addMesh(animal, box, gold, -1.02, 1.15, -0.32, 0.16, 0.16, 1.1);
    tail.rotation.x = 0.45;
    addMesh(animal, sphere, mane, -1.02, 1.55, -0.79, 0.22, 0.22, 0.22);
    parent.add(animal);
    return animal;
  }

  function createPanda(parent) {
    const animal = new THREE.Group();
    const white = makeMaterial(0xf2f0e8);
    const black = makeMaterial(0x20252b);
    addMesh(animal, box, white, 0, 1.05, 0, 1.45, 1.15, 0.92);
    for (const x of [-0.54, 0.54]) for (const z of [-0.26, 0.26]) addMesh(animal, box, black, x, 0.42, z, 0.34, 0.82, 0.34);
    addMesh(animal, box, white, 0, 1.56, 0.72, 1.05, 0.91, 0.68);
    addMesh(animal, box, black, -0.35, 1.7, 1.08, 0.27, 0.31, 0.12);
    addMesh(animal, box, black, 0.35, 1.7, 1.08, 0.27, 0.31, 0.12);
    addMesh(animal, sphere, black, -0.45, 2.03, 0.73, 0.25, 0.25, 0.25);
    addMesh(animal, sphere, black, 0.45, 2.03, 0.73, 0.25, 0.25, 0.25);
    parent.add(animal);
    return animal;
  }

  function createMonkey(parent) {
    const animal = new THREE.Group();
    const brown = makeMaterial(0x7a4d31);
    const tan = makeMaterial(0xd8a06a);
    addMesh(animal, box, brown, 0, 1.08, 0, 1.12, 1.12, 0.74);
    addMesh(animal, box, brown, 0, 1.66, 0.55, 0.86, 0.82, 0.64);
    addMesh(animal, box, tan, 0, 1.58, 0.9, 0.56, 0.48, 0.16);
    for (const x of [-0.72, 0.72]) {
      const arm = addMesh(animal, box, brown, x, 0.91, 0.08, 0.28, 1.42, 0.28);
      arm.rotation.z = x < 0 ? -0.25 : 0.25;
      addMesh(animal, box, brown, x * 0.58, 0.34, -0.13, 0.32, 0.72, 0.32);
    }
    const tailOne = addMesh(animal, box, brown, -0.68, 1.08, -0.64, 0.18, 0.18, 1.0);
    tailOne.rotation.x = -0.55;
    const tailTwo = addMesh(animal, box, brown, -0.68, 1.51, -1.02, 0.18, 0.92, 0.18);
    tailTwo.rotation.z = -0.28;
    parent.add(animal);
    return animal;
  }

  function createGiraffe(parent) {
    const animal = new THREE.Group();
    const yellow = makeMaterial(0xe3b447);
    const brown = makeMaterial(0x88512d);
    const darkBrown = makeMaterial(0x5d3c2c);
    addMesh(animal, box, yellow, 0, 1.48, 0, 1.65, 0.86, 0.82);
    for (const x of [-0.56, 0.56]) for (const z of [-0.23, 0.23]) addMesh(animal, box, yellow, x, 0.65, z, 0.25, 1.45, 0.25);
    addMesh(animal, box, yellow, 0, 2.66, 0.43, 0.43, 2.25, 0.43);
    addMesh(animal, box, yellow, 0, 3.72, 0.7, 0.72, 0.55, 0.9);
    for (const x of [-0.2, 0.2]) addMesh(animal, cylinder, darkBrown, x, 4.18, 0.7, 0.08, 0.45, 0.08);
    for (const [x, y, z] of [[-0.44, 1.65, 0.43], [0.35, 1.45, -0.43], [0, 2.35, 0.66], [0, 3.0, 0.66], [0.2, 3.78, 1.15]]) {
      addMesh(animal, box, brown, x, y, z, 0.28, 0.28, 0.1);
    }
    parent.add(animal);
    return animal;
  }

  function createPenguin(parent) {
    const animal = new THREE.Group();
    const black = makeMaterial(0x202936);
    const white = makeMaterial(0xf4f5ef);
    const orange = makeMaterial(0xef9832);
    addMesh(animal, box, black, 0, 1.0, 0, 1.05, 1.55, 0.82);
    addMesh(animal, box, white, 0, 0.97, 0.44, 0.67, 1.1, 0.08);
    addMesh(animal, box, black, 0, 1.72, 0.16, 0.83, 0.72, 0.7);
    const beak = addMesh(animal, box, orange, 0, 1.65, 0.67, 0.38, 0.18, 0.5);
    beak.rotation.x = Math.PI / 10;
    for (const x of [-0.4, 0.4]) {
      const flipper = addMesh(animal, box, black, x, 1.05, 0, 0.22, 1.0, 0.48);
      flipper.rotation.z = x < 0 ? -0.32 : 0.32;
      addMesh(animal, box, orange, x * 0.55, 0.17, 0.2, 0.52, 0.13, 0.67);
    }
    parent.add(animal);
    return animal;
  }

  const animalFactories = {
    elephant: createElephant,
    lion: createLion,
    panda: createPanda,
    monkey: createMonkey,
    giraffe: createGiraffe,
    penguin: createPenguin,
  };

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
    const animal = animalFactories[position.id](habitatGroup);
    animal.name = `zoo-animal-${position.id}`;
    animal.userData.animalId = position.id;
    animal.rotation.y = Math.atan2(-position.x, -position.z);
    const photoTarget = new THREE.Object3D();
    photoTarget.name = `zoo-photo-target-${position.id}`;
    photoTarget.position.set(0, position.id === 'giraffe' ? 2.15 : 1.2, 0);
    animal.add(photoTarget);
    animations.push({
      kind: 'animal',
      object: animal,
      phase: index * 1.07,
      speed: 0.18 + index * 0.012,
      radiusX: 0.55 + (index % 2) * 0.18,
      radiusZ: 0.34 + ((index + 1) % 2) * 0.15,
      baseY: 0,
    });
    return {
      id: position.id,
      x: position.x,
      z: position.z,
      group: habitatGroup,
      animal,
      photoTarget,
      photoRadius: visual.radius,
      sign,
    };
  });

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
      const x = Math.cos(angle) * animation.radiusX;
      const z = Math.sin(angle) * animation.radiusZ;
      const previousX = animation.object.position.x;
      const previousZ = animation.object.position.z;
      animation.object.position.set(x, animation.baseY + Math.sin(elapsed * 2 + animation.phase) * 0.025, z);
      const dx = x - previousX;
      const dz = z - previousZ;
      if (Math.abs(dx) + Math.abs(dz) > 0.00001) animation.object.rotation.y = Math.atan2(dx, dz);
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    group.removeFromParent();
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
    animations.length = 0;
  }

  return { group, habitats, update, dispose };
}
