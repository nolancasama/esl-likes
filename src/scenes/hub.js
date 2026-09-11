import * as THREE from 'three';
import { LESSONS, UI, formatUi } from '../config/lesson.js';

const MOVE_SPEED = 5.2;
const INTERACT_RADIUS_SQ = 2.7 * 2.7;

function createSignTexture(lesson) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 192;
  const context = canvas.getContext('2d');
  context.fillStyle = lesson.available ? '#fff4a8' : '#e4edf3';
  context.fillRect(8, 8, 496, 176);
  context.lineWidth = 12;
  context.strokeStyle = lesson.available ? '#e58b2e' : '#72899a';
  context.strokeRect(8, 8, 496, 176);
  context.fillStyle = '#17324d';
  context.font = 'bold 48px sans-serif';
  context.textAlign = 'center';
  context.fillText(lesson.name, 256, 82);
  context.font = 'bold 30px sans-serif';
  context.fillStyle = lesson.available ? '#b24761' : '#5c7180';
  context.fillText(lesson.available ? UI.hub.practice : UI.hub.comingSoon, 256, 137);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeDoor(lesson, position, shared) {
  const group = new THREE.Group();
  group.position.copy(position);

  const frame = new THREE.Mesh(shared.frameGeometry, shared.frameMaterials[lesson.available ? 0 : 1]);
  frame.position.y = 1.65;
  group.add(frame);

  const inset = new THREE.Mesh(shared.doorGeometry, shared.doorMaterials[lesson.available ? 0 : 1]);
  inset.position.set(0, 1.55, 0.18);
  group.add(inset);

  const texture = createSignTexture(lesson);
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true }));
  label.position.set(0, 3.7, 0.4);
  label.scale.set(4.4, 1.65, 1);
  group.add(label);

  group.userData = { lesson, inset, texture };
  return group;
}

function disposeGroup(group) {
  group.traverse((object) => {
    if (object.userData?.texture) object.userData.texture.dispose();
    if (object.material?.map?.isCanvasTexture) {
      object.material.map.dispose();
      object.material.dispose();
    }
  });
}

export function createHub(ctx) {
  const { scene, cameraRig, input, characters, progression, stampBook, onEnterMinigame, uiRoot } = ctx;
  let world = null;
  let player = null;
  let nearest = null;
  let overlay = null;
  let prompt = null;

  const move = new THREE.Vector2();
  const doorWorldPosition = new THREE.Vector3();
  const playerWorldPosition = new THREE.Vector3();
  const doorEntries = [];
  const owned = [];

  const shared = {
    frameGeometry: new THREE.BoxGeometry(3.6, 3.6, 0.55),
    doorGeometry: new THREE.BoxGeometry(2.65, 3, 0.25),
    frameMaterials: [
      new THREE.MeshStandardMaterial({ color: 0xf7b34c, flatShading: true }),
      new THREE.MeshStandardMaterial({ color: 0x8295a4, flatShading: true }),
    ],
    doorMaterials: [
      new THREE.MeshStandardMaterial({ color: 0x5cc48a, emissive: 0x000000, flatShading: true }),
      new THREE.MeshStandardMaterial({ color: 0xb8c5ce, flatShading: true }),
    ],
  };

  function buildOverlay() {
    overlay = document.createElement('div');
    overlay.innerHTML = `
      <div class="top-bar">
        <section class="hub-card">
          <h1></h1>
          <p class="move-hint"></p>
          <p class="greeting"></p>
        </section>
        <div class="top-actions"><button class="stamp-button" type="button"></button></div>
      </div>
      <div class="interaction-prompt is-hidden"></div>
    `;
    overlay.querySelector('h1').textContent = UI.hub.title;
    overlay.querySelector('.move-hint').textContent = UI.hub.moveHint;
    const greeting = overlay.querySelector('.greeting');
    const answer = LESSONS.map((lesson) => progression.getAnswer(lesson.category)).find(Boolean);
    greeting.textContent = answer ? formatUi(UI.hub.greeting, { answer }) : '';
    const stampButton = overlay.querySelector('.stamp-button');
    stampButton.textContent = UI.hub.stampBook;
    stampButton.addEventListener('click', stampBook.open);
    prompt = overlay.querySelector('.interaction-prompt');
    uiRoot.append(overlay);
  }

  async function enter() {
    world = new THREE.Group();
    world.name = 'hub';
    scene.background = new THREE.Color(0x8fd5ff);
    scene.fog = new THREE.Fog(0x8fd5ff, 26, 48);

    world.add(new THREE.HemisphereLight(0xffffff, 0x9dcd7a, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 2.4);
    sun.position.set(8, 13, 7);
    world.add(sun);

    const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x91d36b, flatShading: true });
    const ground = new THREE.Mesh(new THREE.CylinderGeometry(24, 25, 0.7, 16), groundMaterial);
    ground.position.y = -0.4;
    world.add(ground);
    owned.push({ geometry: ground.geometry, material: groundMaterial });

    const pathMaterial = new THREE.MeshStandardMaterial({ color: 0xffe2a1, flatShading: true });
    const path = new THREE.Mesh(new THREE.BoxGeometry(26, 0.08, 7), pathMaterial);
    path.position.set(0, 0.01, -4.5);
    world.add(path);
    owned.push({ geometry: path.geometry, material: pathMaterial });

    // The five doors fan in a shallow arc rather than a straight row: the outer
    // pair sit nearer the camera and turn slightly inward, so all five signs are
    // on screen and readable at once from the spawn point. A child has to be
    // able to see every choice without walking around to find it.
    const doorSpread = [-9, -4.5, 0, 4.5, 9];
    LESSONS.forEach((lesson, index) => {
      const x = doorSpread[index];
      const z = -8.6 + (x / 9) ** 2 * 2.2;
      const door = makeDoor(lesson, new THREE.Vector3(x, 0, z), shared);
      door.rotation.y = -x * 0.035;
      world.add(door);
      doorEntries.push(door);
    });

    player = characters.create({ model: characters.playerModel });
    player.position.set(0, 0, 3);
    player.scale.setScalar(0.82);
    world.add(player);
    scene.add(world);

    // Centred behind the child, not offset to one side: an off-centre rig threw
    // the rightmost door off the edge of the screen entirely. The look target is
    // pushed forward toward the doors so the row of signs sits in the middle of
    // the frame instead of crammed against the top edge behind the guidance card.
    cameraRig
      .setTarget(player)
      .setPreset('follow', { offset: [0, 7.4, 11.5], lookOffset: [0, 1.4, -4.6] });
    buildOverlay();
  }

  function update(dt) {
    if (!player || stampBook.isOpen()) return;
    const safeDt = Math.min(dt, 0.05);
    input.getMovement(move);
    if (move.lengthSq() > 0) {
      player.position.x += move.x * MOVE_SPEED * safeDt;
      player.position.z -= move.y * MOVE_SPEED * safeDt;
      player.position.x = THREE.MathUtils.clamp(player.position.x, -12.5, 12.5);
      player.position.z = THREE.MathUtils.clamp(player.position.z, -6.5, 7);
      // Kenney models face +z at rotation 0 and forward (W) moves toward -z, so the
      // heading is atan2(x, -y). Turn the short way round rather than spinning
      // through a full circle whenever the heading crosses +/-PI.
      const wantedRotation = Math.atan2(move.x, -move.y);
      const turn = Math.atan2(Math.sin(wantedRotation - player.rotation.y), Math.cos(wantedRotation - player.rotation.y));
      player.rotation.y += turn * (1 - Math.exp(-12 * safeDt));
      player.playAnimation?.('walk');
    } else {
      player.playAnimation?.('idle');
    }
    player.updateAnimation?.(safeDt);

    player.getWorldPosition(playerWorldPosition);
    let nextNearest = null;
    let nearestDistance = INTERACT_RADIUS_SQ;
    for (const door of doorEntries) {
      door.getWorldPosition(doorWorldPosition);
      const distance = playerWorldPosition.distanceToSquared(doorWorldPosition);
      if (distance < nearestDistance) {
        nextNearest = door;
        nearestDistance = distance;
      }
    }

    if (nearest !== nextNearest) {
      if (nearest?.userData.lesson.available) nearest.userData.inset.material.emissive.setHex(0x000000);
      nearest = nextNearest;
      if (nearest?.userData.lesson.available) nearest.userData.inset.material.emissive.setHex(0x185f35);
    }

    if (nearest) {
      prompt.classList.remove('is-hidden');
      prompt.textContent = nearest.userData.lesson.available ? UI.hub.interact : UI.hub.comingSoon;
      if (nearest.userData.lesson.available && input.consumeInteract()) {
        onEnterMinigame(nearest.userData.lesson.id);
      }
    } else {
      prompt.classList.add('is-hidden');
    }
  }

  function exit() {
    if (!world) return;
    cameraRig.setTarget(null);
    overlay?.remove();
    overlay = null;
    prompt = null;
    player?.disposeCharacter?.();
    disposeGroup(world);
    scene.remove(world);
    world = null;
    player = null;
    nearest = null;
    doorEntries.length = 0;
    shared.frameGeometry.dispose();
    shared.doorGeometry.dispose();
    for (const material of [...shared.frameMaterials, ...shared.doorMaterials]) material.dispose();
    for (const item of owned) {
      item.geometry.dispose();
      item.material.dispose();
    }
    owned.length = 0;
  }

  return { id: 'hub', enter, update, exit };
}
