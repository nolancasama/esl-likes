import * as THREE from 'three';
import { LESSON_BY_ID, UI, answerFor } from '../../config/lesson.js';
import { promptQuestion, promptAnswer } from '../../systems/speechPrompt.js';
import { createListenAgain } from '../../ui/listenAgain.js';
import { pickSport, scoreSession, shuffleZones } from './scoring.js';

const LESSON = LESSON_BY_ID.sports;
const STRINGS = UI.sports;
const MOVE_SPEED = 6;
const TALK_RADIUS_SQ = 2.8 * 2.8;
const ZONE_RADIUS_SQ = 3.25 * 3.25;
const FOLLOW_GAP = 1.35;
const FIELD_LIMIT = 13.6;
const NPC_MODELS = Object.freeze('bcdefghijklmnopqr'.split(''));

const CORNERS = Object.freeze([
  Object.freeze({ x: -9.5, z: -9.5 }),
  Object.freeze({ x: 9.5, z: -9.5 }),
  Object.freeze({ x: -9.5, z: 9.5 }),
  Object.freeze({ x: 9.5, z: 9.5 }),
]);

const DIFFICULTY = Object.freeze({
  1: Object.freeze({ count: 3, waves: Object.freeze([1, 1, 1]) }),
  2: Object.freeze({ count: 4, waves: Object.freeze([2, 2]) }),
  3: Object.freeze({ count: 6, waves: Object.freeze([3, 3]) }),
});

const SPORT_STYLE = Object.freeze({
  soccer: Object.freeze({ ground: 0x49a966, accent: 0xffffff }),
  basketball: Object.freeze({ ground: 0xe98a35, accent: 0x273858 }),
  baseball: Object.freeze({ ground: 0xaa7045, accent: 0xf7e7c6 }),
  volleyball: Object.freeze({ ground: 0xf0d486, accent: 0xffffff }),
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function faceToward(object, x, z) {
  object.rotation.y = Math.atan2(x - object.position.x, z - object.position.z);
}

/** Sports minigame controller for the frozen shell interface. */
export function createSports(ctx) {
  const {
    scene,
    camera,
    cameraRig,
    input,
    speech,
    audio,
    dialogue,
    characters,
    hud,
    settings,
    finish,
  } = ctx;

  let world = null;
  let player = null;
  let coach = null;
  let cameraFocus = null;
  let overlay = null;
  let style = null;
  let instruction = null;
  let notice = null;
  let listenAgain = null;
  let unsubscribeSettings = null;
  let active = false;
  let finishCalled = false;
  let debugRootCreated = false;
  let phase = 'inactive';
  let level = 1;
  let elapsed = 0;
  let noticeRemaining = 0;
  let dialogueRemaining = 0;
  let answerRemaining = 0;
  let replayRemaining = 0;
  let roundEndRemaining = 0;
  let celebrationRemaining = 0;
  let finishRemaining = 0;
  let questionNpc = null;
  let dialogueNpc = null;
  let currentReplayNpc = null;
  let acceptedAnswer = null;
  let activeWave = 0;
  let waveDelivered = 0;
  let lastJoinedNpc = null;
  let celebrationZone = null;
  let celebrationStart = null;
  let overviewCamera = true;

  const zones = [];
  const npcs = [];
  const records = [];
  const replayQueue = [];
  const trail = [];
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  const canvases = new Set();
  const move = new THREE.Vector2();
  const followerTarget = new THREE.Vector3();
  const parentQuaternion = new THREE.Quaternion();

  const ownGeometry = (geometry) => {
    geometries.add(geometry);
    return geometry;
  };
  const ownMaterial = (material) => {
    materials.add(material);
    return material;
  };
  const ownTexture = (texture) => {
    textures.add(texture);
    return texture;
  };
  const makeMaterial = (color, options = {}) => ownMaterial(new THREE.MeshStandardMaterial({
    color,
    flatShading: true,
    roughness: 0.82,
    ...options,
  }));

  function addPart(parent, geometry, material, x, y, z, sx = 1, sy = 1, sz = 1) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    parent.add(mesh);
    return mesh;
  }

  function setInstruction(text) {
    if (instruction) instruction.textContent = text;
  }

  function showNotice(text, seconds = 1.7) {
    if (!notice) return;
    notice.textContent = text;
    notice.hidden = false;
    noticeRemaining = seconds;
  }

  function createOverlay() {
    style = document.createElement('style');
    style.textContent = `
      .sports-ui { position: absolute; inset: 0; pointer-events: none; }
      .sports-ui__instruction { max-width: min(66vw, 32rem); }
      .sports-ui__notice { position: absolute; top: 1rem; left: 50%; transform: translateX(-50%);
        max-width: min(78vw, 32rem); padding: .72rem 1.2rem; border: .22rem solid #fff;
        border-radius: 999px; background: #ef5b47; color: #fff; box-shadow: 0 .34rem 0 rgb(35 49 71 / .28);
        font: 900 calc(1.18rem * var(--ui-scale, 1)) system-ui, sans-serif; text-align: center; }
      .sports-dialogue .npc-dialogue__replay { display: none; }
    `;
    document.head.append(style);

    overlay = document.createElement('div');
    overlay.className = 'sports-ui';
    overlay.innerHTML = `
      <div class="top-bar">
        <section class="scene-card"><h1></h1><p class="sports-ui__instruction"></p></section>
      </div>
      <div class="sports-ui__notice" role="status" aria-live="polite" hidden></div>
    `;
    overlay.querySelector('h1').textContent = STRINGS.roomName;
    instruction = overlay.querySelector('.sports-ui__instruction');
    notice = overlay.querySelector('.sports-ui__notice');
    listenAgain = createListenAgain({ root: overlay, label: UI.listenAgain, onPress: replayFollowers });
    document.querySelector('#ui-layer').append(overlay);
    dialogue.element?.classList.add('sports-dialogue');
    setInstruction(STRINGS.walkToFriend);
  }

  function signCanvasFor(sport) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    canvases.add(canvas);
    const context = canvas.getContext('2d');
    context.fillStyle = '#fffaf0';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = '#273858';
    context.lineWidth = 16;
    context.strokeRect(8, 8, canvas.width - 16, canvas.height - 16);
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.save();
    context.translate(104, 84);
    context.strokeStyle = '#273858';
    context.fillStyle = `#${SPORT_STYLE[sport].ground.toString(16).padStart(6, '0')}`;
    context.lineWidth = 12;
    if (sport === 'soccer') {
      context.strokeRect(-56, -38, 112, 76);
      context.beginPath(); context.arc(0, 10, 24, 0, Math.PI * 2); context.fill(); context.stroke();
    } else if (sport === 'basketball') {
      context.beginPath(); context.moveTo(0, -64); context.lineTo(0, -8); context.stroke();
      context.beginPath(); context.ellipse(0, 0, 48, 14, 0, 0, Math.PI * 2); context.stroke();
      context.beginPath(); context.arc(0, 48, 31, 0, Math.PI * 2); context.fill(); context.stroke();
    } else if (sport === 'baseball') {
      context.beginPath(); context.arc(-12, 16, 30, 0, Math.PI * 2); context.fillStyle = '#fff'; context.fill(); context.stroke();
      context.beginPath(); context.moveTo(28, 56); context.lineTo(62, -48); context.strokeStyle = '#aa7045'; context.lineWidth = 20; context.stroke();
    } else {
      context.beginPath(); context.moveTo(-70, 22); context.lineTo(70, 22); context.moveTo(-62, -42); context.lineTo(-62, 54); context.moveTo(62, -42); context.lineTo(62, 54); context.stroke();
      context.beginPath(); context.arc(0, -22, 29, 0, Math.PI * 2); context.fill(); context.stroke();
    }
    context.restore();
    const label = answerFor(LESSON, sport).replace(/^I like /, '').replace(/\.$/, '');
    context.fillStyle = '#1b2940';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = `900 ${label.length > 10 ? 64 : 78}px system-ui, sans-serif`;
    context.fillText(label, 330, 132, 330);
    const texture = ownTexture(new THREE.CanvasTexture(canvas));
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  function addPath(box, material, corner) {
    const distance = Math.hypot(corner.x, corner.z);
    const ux = corner.x / distance;
    const uz = corner.z / distance;
    const start = 3.1;
    const end = distance - 3.1;
    const length = end - start;
    const middle = (start + end) * 0.5;
    const path = addPart(world, box, material, ux * middle, 0.015, uz * middle, 2.15, 0.06, length);
    path.rotation.y = Math.atan2(ux, uz);
  }

  function addGoal(zone, shared) {
    const group = zone.props;
    addPart(group, shared.post, shared.white, 0, 1.4, -2.25, 0.13, 2.8, 0.13);
    addPart(group, shared.post, shared.white, -1.65, 1.4, -2.25, 0.13, 2.8, 0.13);
    addPart(group, shared.post, shared.white, 1.65, 1.4, -2.25, 0.13, 2.8, 0.13);
    const crossbar = addPart(group, shared.post, shared.white, 0, 2.76, -2.25, 0.13, 3.4, 0.13);
    crossbar.rotation.z = Math.PI / 2;
  }

  function addHoop(zone, shared) {
    const group = zone.props;
    addPart(group, shared.post, shared.dark, 0, 1.5, -2.15, 0.18, 3, 0.18);
    addPart(group, shared.box, shared.white, 0, 2.75, -1.98, 1.4, 1.05, 0.16);
    const rim = addPart(group, shared.ring, shared.orange, 0, 2.25, -1.62);
    rim.rotation.x = Math.PI / 2;
  }

  function addBackstop(zone, shared) {
    const group = zone.props;
    addPart(group, shared.post, shared.dark, -1.65, 1.45, -2.2, 0.13, 2.9, 0.13);
    addPart(group, shared.post, shared.dark, 1.65, 1.45, -2.2, 0.13, 2.9, 0.13);
    for (let index = -2; index <= 2; index += 1) {
      addPart(group, shared.post, shared.fence, index * 0.65, 1.45, -2.18, 0.04, 2.8, 0.04);
    }
    for (let index = 0; index < 4; index += 1) {
      const rail = addPart(group, shared.post, shared.fence, 0, 0.45 + index * 0.65, -2.18, 0.04, 3.3, 0.04);
      rail.rotation.z = Math.PI / 2;
    }
  }

  function addNet(zone, shared) {
    const group = zone.props;
    addPart(group, shared.post, shared.dark, -2.15, 1.25, 0, 0.12, 2.5, 0.12);
    addPart(group, shared.post, shared.dark, 2.15, 1.25, 0, 0.12, 2.5, 0.12);
    addPart(group, shared.box, shared.white, 0, 1.45, 0, 4.25, 1.25, 0.06);
    for (let index = -4; index <= 4; index += 1) addPart(group, shared.post, shared.dark, index * 0.48, 1.45, -0.04, 0.018, 1.2, 0.018);
  }

  function createZone(sport, corner, shared) {
    const zone = {
      id: sport,
      x: corner.x,
      z: corner.z,
      inside: false,
      players: [],
      group: new THREE.Group(),
      props: new THREE.Group(),
      sign: null,
      ball: null,
    };
    zone.group.position.set(corner.x, 0, corner.z);
    zone.group.rotation.y = Math.atan2(-corner.x, -corner.z);
    zone.group.add(zone.props);
    world.add(zone.group);
    const ground = sport === 'baseball'
      ? ownGeometry(new THREE.CylinderGeometry(3.05, 3.05, 0.09, 4))
      : shared.zoneGround;
    const floor = addPart(zone.group, ground, shared.groundMaterials[sport], 0, 0.05, 0, sport === 'baseball' ? 1 : 1, 1, sport === 'baseball' ? 1 : 1);
    if (sport === 'baseball') floor.rotation.y = Math.PI / 4;
    if (sport === 'soccer') addGoal(zone, shared);
    else if (sport === 'basketball') addHoop(zone, shared);
    else if (sport === 'baseball') addBackstop(zone, shared);
    else addNet(zone, shared);

    const ballMaterial = sport === 'basketball' ? shared.orange : sport === 'baseball' ? shared.white : shared.ball;
    zone.ball = addPart(zone.group, sport === 'baseball' ? shared.smallBall : shared.ballGeometry, ballMaterial, 0, 0.32, 0);
    zone.ball.visible = false;

    const signTexture = signCanvasFor(sport);
    const signMaterial = ownMaterial(new THREE.MeshBasicMaterial({ map: signTexture, transparent: false, side: THREE.DoubleSide }));
    zone.sign = addPart(zone.group, shared.signPlane, signMaterial, 0, 3.75, -3.05, 1, 1, 1);
    addPart(zone.group, shared.post, shared.dark, 0, 1.75, -3.08, 0.14, 3.5, 0.14);
    return zone;
  }

  function waitingSpot(index) {
    const sector = (index * 2.399963 + Math.random() * 0.8) % (Math.PI * 2);
    const radius = 1.45 + Math.random() * 1.25;
    return { x: Math.cos(sector) * radius, z: Math.sin(sector) * radius };
  }

  function buildWorld() {
    world = new THREE.Group();
    world.name = 'sports-minigame';
    scene.background = new THREE.Color(0x9bdcff);
    scene.fog = null;
    world.add(new THREE.HemisphereLight(0xffffff, 0x6fa253, 2.5));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(8, 15, 10);
    world.add(sun);

    const box = ownGeometry(new THREE.BoxGeometry(1, 1, 1));
    const post = ownGeometry(new THREE.CylinderGeometry(0.5, 0.5, 1, 12));
    const ballGeometry = ownGeometry(new THREE.SphereGeometry(0.34, 16, 10));
    const smallBall = ownGeometry(new THREE.SphereGeometry(0.18, 12, 8));
    const ring = ownGeometry(new THREE.TorusGeometry(0.48, 0.08, 8, 24));
    const signPlane = ownGeometry(new THREE.PlaneGeometry(4.3, 2.15));
    const zoneGround = ownGeometry(new THREE.BoxGeometry(6.1, 0.1, 5.4));
    const grass = makeMaterial(0x72bd68);
    const path = makeMaterial(0xf5e6bd);
    const plaza = makeMaterial(0xded4c7);
    const white = makeMaterial(0xffffff);
    const dark = makeMaterial(0x273858);
    const orange = makeMaterial(0xe96c28);
    const fence = makeMaterial(0x9fc7cf, { transparent: true, opacity: 0.72 });
    const ball = makeMaterial(0xf7f7f0);
    const groundMaterials = Object.fromEntries(Object.entries(SPORT_STYLE).map(([id, visual]) => [id, makeMaterial(visual.ground)]));

    addPart(world, box, grass, 0, -0.22, 0, 29, 0.45, 29);
    const plazaMesh = addPart(world, ownGeometry(new THREE.CylinderGeometry(3.75, 3.75, 0.14, 40)), plaza, 0, -0.02, 0);
    plazaMesh.rotation.y = Math.PI / 8;
    for (const corner of CORNERS) addPath(box, path, corner);

    const shared = { box, post, ballGeometry, smallBall, ring, signPlane, zoneGround, white, dark, orange, fence, ball, groundMaterials };
    const assignment = shuffleZones(Math.random);
    for (let index = 0; index < CORNERS.length; index += 1) zones.push(createZone(assignment[index], CORNERS[index], shared));

    player = characters.create({ model: characters.playerModel });
    player.position.set(0, 0.08, 5.8);
    player.rotation.y = Math.PI;
    player.scale.setScalar(0.84);
    world.add(player);

    cameraFocus = new THREE.Object3D();
    cameraFocus.position.copy(player.position);
    world.add(cameraFocus);

    coach = characters.create({ model: 'r' });
    coach.visible = false;
    coach.scale.setScalar(0.84);
    world.add(coach);

    const configured = DIFFICULTY[level];
    for (let index = 0; index < configured.count; index += 1) {
      const spot = waitingSpot(index);
      const character = characters.create({ model: NPC_MODELS[Math.floor(Math.random() * NPC_MODELS.length)] });
      character.position.set(spot.x, 0.08, spot.z);
      character.scale.setScalar(0.79);
      faceToward(character, 0, 0);
      character.visible = false;
      world.add(character);
      npcs.push({
        index,
        sport: pickSport(Math.random),
        state: 'hidden',
        asked: false,
        replayed: false,
        wrongVisits: 0,
        character,
        wave: 0,
        shakeRemaining: 0,
        joinProgress: 0,
        joinStart: new THREE.Vector3(),
        playOffset: new THREE.Vector3(),
      });
    }

    let cursor = 0;
    configured.waves.forEach((count, wave) => {
      for (let offset = 0; offset < count; offset += 1) npcs[cursor++].wave = wave;
    });
    activateWave(0);
    scene.add(world);
    resetTrail();
    cameraRig.setTarget(cameraFocus).setPreset('follow', {
      offset: [12, 16, 20],
      lookOffset: [0, 0.9, 0],
      damping: 5,
    });
  }

  function activateWave(wave) {
    activeWave = wave;
    waveDelivered = 0;
    for (const npc of npcs) {
      if (npc.wave !== wave || npc.state !== 'hidden') continue;
      npc.state = 'waiting';
      npc.character.visible = true;
      npc.character.playAnimation?.('idle');
    }
    setInstruction(STRINGS.walkToFriend);
    showNotice(STRINGS.newFriends, 1.7);
  }

  function clearQuestion(keepHud = false) {
    questionNpc = null;
    speech.clearTarget();
    if (!keepHud) hud.hide();
  }

  function acceptQuestion(npc) {
    if (!active || phase !== 'playing' || npc.state !== 'waiting') return;
    clearQuestion(true);
    npc.asked = true;
    npc.state = 'following';
    npc.character.playAnimation?.('emote-yes');
    hud.setTalkState('accepted');
    audio.playSfx('accept');
    dialogueNpc = npc;
    dialogueRemaining = 2.45;
    answerRemaining = 2.45;
    phase = 'answering';
    faceToward(npc.character, player.position.x, player.position.z);
    faceToward(player, npc.character.position.x, npc.character.position.z);
    dialogue.show({ text: answerFor(LESSON, npc.sport), anchor: npc.character, offsetY: 1.9 });
    setInstruction(STRINGS.listenAndLead);
    setDialogueTwoShot(npc.character);
  }

  function targetQuestion(npc) {
    if (questionNpc === npc || phase !== 'playing') return;
    clearQuestion();
    questionNpc = npc;
    promptQuestion(ctx, LESSON, {
      isActive: () => active && phase === 'playing' && npc.state === 'waiting',
      onAccepted: () => acceptQuestion(npc),
    });
    setInstruction(STRINGS.askFriend);
  }

  function nearestWaitingNpc() {
    let nearest = null;
    let best = TALK_RADIUS_SQ;
    for (const npc of npcs) {
      if (npc.state !== 'waiting') continue;
      const dx = player.position.x - npc.character.position.x;
      const dz = player.position.z - npc.character.position.z;
      const distance = dx * dx + dz * dz;
      if (distance < best) {
        best = distance;
        nearest = npc;
      }
    }
    return nearest;
  }

  function followingNpcs() {
    return npcs.filter((npc) => npc.state === 'following');
  }

  function replayFollowers() {
    if (!active || phase !== 'playing') return;
    const followers = followingNpcs();
    if (!followers.length) return;
    clearQuestion();
    replayQueue.splice(0, replayQueue.length, ...followers);
    for (const npc of followers) npc.replayed = true;
    phase = 'replaying';
    listenAgain?.hide();
    playNextReplay();
  }

  function playNextReplay() {
    if (!replayQueue.length) {
      currentReplayNpc = null;
      phase = 'playing';
      dialogue.hide();
      restoreFollowCamera();
      return;
    }
    currentReplayNpc = replayQueue.shift();
    replayRemaining = 1.9;
    const sentence = answerFor(LESSON, currentReplayNpc.sport);
    dialogue.show({ text: sentence, anchor: currentReplayNpc.character, offsetY: 1.9, speak: false });
    audio.speak(sentence);
    currentReplayNpc.character.playAnimation?.('emote-yes');
    faceToward(currentReplayNpc.character, player.position.x, player.position.z);
    setDialogueTwoShot(currentReplayNpc.character);
  }

  function setDialogueTwoShot(npcObject) {
    let dx = player.position.x - npcObject.position.x;
    let dz = player.position.z - npcObject.position.z;
    const length = Math.hypot(dx, dz) || 1;
    dx /= length;
    dz /= length;
    const midpointX = (player.position.x + npcObject.position.x) * 0.5;
    const midpointZ = (player.position.z + npcObject.position.z) * 0.5;
    // Side-on, not over the avatar's shoulder: from behind the avatar the child
    // hid the NPC who was speaking, bubble included. Use the perpendicular on the
    // follow camera's (+z) side, nudged toward the avatar so the NPC's face shows.
    let sideX = -dz;
    let sideZ = dx;
    if (sideZ < 0) { sideX = -sideX; sideZ = -sideZ; }
    cameraRig.setTarget(null).setPreset('fixed', {
      position: [midpointX + sideX * 5 + dx * 1.3, 3.2, midpointZ + sideZ * 5 + dz * 1.3],
      lookAt: [midpointX, 0.95, midpointZ],
      damping: 7,
    });
  }

  function restoreFollowCamera() {
    overviewCamera = false;
    cameraRig.setTarget(cameraFocus).setPreset('follow', {
      offset: [8.8, 10.8, 12.2], lookOffset: [0, 0.9, -1.2], damping: 5,
    });
  }

  function resetTrail() {
    trail.length = 0;
    for (let index = 0; index < 80; index += 1) trail.push({ x: player.position.x, z: player.position.z });
  }

  function recordTrail() {
    const head = trail[0];
    if (head && Math.hypot(player.position.x - head.x, player.position.z - head.z) < 0.16) return;
    trail.unshift({ x: player.position.x, z: player.position.z });
    if (trail.length > 220) trail.length = 220;
  }

  function pointAlongTrail(distance, out) {
    if (!trail.length) return out.copy(player.position);
    let travelled = 0;
    let previousX = player.position.x;
    let previousZ = player.position.z;
    for (const point of trail) {
      const segment = Math.hypot(point.x - previousX, point.z - previousZ);
      if (travelled + segment >= distance && segment > 0) {
        const mix = clamp((distance - travelled) / segment, 0, 1);
        return out.set(previousX + (point.x - previousX) * mix, 0.08, previousZ + (point.z - previousZ) * mix);
      }
      travelled += segment;
      previousX = point.x;
      previousZ = point.z;
    }
    const last = trail[trail.length - 1];
    return out.set(last.x, 0.08, last.z);
  }

  function updateMovement(dt) {
    input.getMovement(move);
    if (move.lengthSq() === 0) {
      player.playAnimation?.('idle');
      return;
    }
    if (overviewCamera) restoreFollowCamera();
    player.position.x = clamp(player.position.x + move.x * MOVE_SPEED * dt, -FIELD_LIMIT, FIELD_LIMIT);
    player.position.z = clamp(player.position.z - move.y * MOVE_SPEED * dt, -FIELD_LIMIT, FIELD_LIMIT);
    const wantedRotation = Math.atan2(move.x, -move.y);
    const turn = Math.atan2(Math.sin(wantedRotation - player.rotation.y), Math.cos(wantedRotation - player.rotation.y));
    player.rotation.y += turn * (1 - Math.exp(-12 * dt));
    player.playAnimation?.('walk');
    recordTrail();
  }

  function updateFollowers(dt) {
    const followers = followingNpcs();
    for (let index = 0; index < followers.length; index += 1) {
      const npc = followers[index];
      pointAlongTrail((index + 1) * FOLLOW_GAP, followerTarget);
      const dx = followerTarget.x - npc.character.position.x;
      const dz = followerTarget.z - npc.character.position.z;
      const distance = Math.hypot(dx, dz);
      if (distance > 0.08) {
        const speed = Math.min(7.4, 4.7 + distance * 1.1);
        const step = Math.min(distance, speed * dt);
        npc.character.position.x += dx / distance * step;
        npc.character.position.z += dz / distance * step;
        faceToward(npc.character, followerTarget.x, followerTarget.z);
        npc.character.playAnimation?.('walk');
      } else {
        npc.character.playAnimation?.('idle');
      }
    }
  }

  function joinZone(zone, matching) {
    dialogue.hide();
    for (let index = 0; index < matching.length; index += 1) {
      const npc = matching[index];
      npc.state = 'joined';
      npc.joinProgress = 0;
      npc.joinStart.copy(npc.character.position);
      const angle = (zone.players.length + index) * 2.2;
      npc.playOffset.set(Math.sin(angle) * 1.2, 0.08, Math.cos(angle) * 0.85 + 0.4);
      zone.players.push(npc);
      records.push({ outcome: npc.wrongVisits === 0 ? 'first' : 'later', replayed: npc.replayed });
      npc.character.playAnimation?.('emote-yes');
      lastJoinedNpc = npc;
    }
    zone.ball.visible = true;
    waveDelivered += matching.length;
    dialogueNpc = matching[0];
    dialogueRemaining = 1.75;
    dialogue.show({ text: STRINGS.joined, anchor: matching[0].character, offsetY: 1.9, speak: false });
    showNotice(STRINGS.goodRoute, 1.45);
    audio.playSfx('accept');
    if (!followingNpcs().length) listenAgain?.hide();
    checkWaveComplete();
  }

  function wrongZone() {
    const followers = followingNpcs();
    if (!followers.length) return;
    for (const npc of followers) {
      npc.wrongVisits += 1;
      npc.shakeRemaining = 1.05;
      npc.character.playAnimation?.('idle');
    }
    dialogueNpc = followers[0];
    dialogueRemaining = 1.8;
    dialogue.show({ text: STRINGS.wrongZone, anchor: followers[0].character, offsetY: 1.9, speak: false });
    showNotice(STRINGS.tryAnotherZone, 1.6);
    audio.playSfx('retry');
  }

  function checkZones() {
    if (phase !== 'playing') return;
    for (const zone of zones) {
      const dx = player.position.x - zone.x;
      const dz = player.position.z - zone.z;
      const inside = dx * dx + dz * dz <= ZONE_RADIUS_SQ;
      if (inside && !zone.inside) {
        const followers = followingNpcs();
        const matching = followers.filter((npc) => npc.sport === zone.id);
        if (matching.length) joinZone(zone, matching);
        else if (followers.length) wrongZone();
      }
      zone.inside = inside;
    }
  }

  function checkWaveComplete() {
    const waveNpcs = npcs.filter((npc) => npc.wave === activeWave);
    if (!waveNpcs.every((npc) => npc.state === 'joined')) return;
    const nextWave = activeWave + 1;
    if (npcs.some((npc) => npc.wave === nextWave)) {
      activateWave(nextWave);
      return;
    }
    phase = 'round-end';
    clearQuestion();
    listenAgain?.hide();
    hud.hide();
    setInstruction(STRINGS.everyonePlaying);
    roundEndRemaining = 1.45;
  }

  function updateJoined(dt) {
    for (const zone of zones) {
      for (let index = 0; index < zone.players.length; index += 1) {
        const npc = zone.players[index];
        npc.character.updateAnimation?.(dt);
        if (npc.joinProgress < 1) {
          npc.joinProgress = Math.min(1, npc.joinProgress + dt * 1.35);
          const t = 1 - Math.pow(1 - npc.joinProgress, 3);
          npc.character.position.lerpVectors(npc.joinStart, new THREE.Vector3(
            zone.x + npc.playOffset.x,
            0.08,
            zone.z + npc.playOffset.z,
          ), t);
          faceToward(npc.character, zone.x, zone.z - 2);
          npc.character.playAnimation?.('walk');
          continue;
        }
        npc.character.playAnimation?.('idle');
        const beat = elapsed * 4.5 + index * 1.4;
        const head = npc.character.userData.head;
        const leftArm = npc.character.userData.armLeft;
        const rightArm = npc.character.userData.armRight;
        const torso = npc.character.userData.torso;
        if (zone.id === 'soccer') {
          npc.character.position.y = 0.08 + Math.max(0, Math.sin(beat)) * 0.06;
          if (torso) torso.rotation.x = Math.sin(beat) * 0.12;
        } else if (zone.id === 'basketball') {
          if (leftArm) leftArm.rotation.x = -1.05 + Math.sin(beat) * 0.18;
          if (rightArm) rightArm.rotation.x = -1.05 + Math.sin(beat) * 0.18;
          npc.character.position.y = 0.08 + Math.max(0, Math.sin(beat)) * 0.16;
        } else if (zone.id === 'baseball') {
          if (torso) torso.rotation.y = Math.sin(beat) * 0.42;
          if (leftArm) leftArm.rotation.z = -0.7 + Math.sin(beat) * 0.4;
          if (rightArm) rightArm.rotation.z = 0.7 - Math.sin(beat) * 0.4;
        } else {
          if (leftArm) leftArm.rotation.x = -1.1 + Math.sin(beat) * 0.22;
          if (rightArm) rightArm.rotation.x = -1.1 + Math.sin(beat) * 0.22;
          npc.character.position.y = 0.08 + Math.max(0, Math.sin(beat)) * 0.12;
        }
        if (head) head.rotation.z = Math.sin(beat * 0.5) * 0.06;
      }

      if (!zone.players.length) continue;
      const cycle = (elapsed * 0.55) % 1;
      if (zone.id === 'soccer') {
        zone.ball.position.set(Math.sin(cycle * Math.PI * 2) * 0.7, 0.34, 1.25 - cycle * 3.25);
      } else if (zone.id === 'basketball') {
        zone.ball.position.set(0, 0.38 + Math.sin(cycle * Math.PI) * 2.45, 1.35 - cycle * 3.1);
      } else if (zone.id === 'baseball') {
        zone.ball.position.set(-0.6 + cycle * 3.8, 0.58 + Math.sin(cycle * Math.PI) * 1.35, 0.75 - cycle * 2.1);
      } else {
        zone.ball.position.set(Math.sin(cycle * Math.PI * 2) * 1.75, 1.65 + Math.sin(cycle * Math.PI) * 1.15, Math.cos(cycle * Math.PI * 2) * 0.45);
      }
    }
  }

  function updateShakes(dt) {
    for (const npc of npcs) {
      if (npc.shakeRemaining <= 0) continue;
      npc.shakeRemaining = Math.max(0, npc.shakeRemaining - dt);
      const shake = Math.sin(npc.shakeRemaining * 28) * 0.13 * (npc.shakeRemaining / 1.05);
      npc.character.rotation.z = shake;
      if (npc.character.userData.head) npc.character.userData.head.rotation.y = shake * 2.2;
      if (npc.shakeRemaining === 0) {
        npc.character.rotation.z = 0;
        if (npc.character.userData.head) npc.character.userData.head.rotation.y = 0;
      }
    }
  }

  function updateContext() {
    const followers = followingNpcs();
    if (followers.length) listenAgain?.show();
    else listenAgain?.hide();
    const nearby = nearestWaitingNpc();
    if (nearby) targetQuestion(nearby);
    else {
      clearQuestion();
      if (followers.length) setInstruction(STRINGS.leadToZone);
      else setInstruction(STRINGS.walkToFriend);
    }
  }

  function updateCameraFocus(dt) {
    let x = player.position.x;
    let z = player.position.z;
    let count = 1;
    for (const npc of npcs) {
      if (npc.state !== 'following') continue;
      x += npc.character.position.x;
      z += npc.character.position.z;
      count += 1;
    }
    cameraFocus.position.x += (x / count - cameraFocus.position.x) * (1 - Math.exp(-7 * dt));
    cameraFocus.position.z += (z / count - cameraFocus.position.z) * (1 - Math.exp(-7 * dt));
  }

  function beginTurnaround() {
    if (!active || phase !== 'round-end') return;
    phase = 'turnaround';
    const zone = zones.find((entry) => entry.players.includes(lastJoinedNpc)) || zones[0];
    coach.visible = true;
    coach.position.set(
      clamp(player.position.x + 1.7, zone.x - 2.2, zone.x + 2.2),
      0.08,
      clamp(player.position.z + 1.15, zone.z - 1.9, zone.z + 1.9),
    );
    faceToward(coach, player.position.x, player.position.z);
    faceToward(player, coach.position.x, coach.position.z);
    coach.playAnimation?.('idle');
    dialogue.show({ text: LESSON.question, anchor: coach, offsetY: 1.9 });
    setInstruction(STRINGS.turnaround);
    setDialogueTwoShot(coach);
    promptAnswer(ctx, LESSON, {
      isActive: () => active && phase === 'turnaround',
      onAccepted: completeTurnaround,
    });
  }

  function completeTurnaround(answer) {
    if (!active || phase !== 'turnaround') return;
    acceptedAnswer = answer || LESSON.answers[0];
    celebrationZone = zones.find((zone) => zone.id === acceptedAnswer) || zones[0];
    celebrationStart = player.position.clone();
    celebrationRemaining = 2.45;
    phase = 'celebrating';
    speech.clearTarget();
    hud.setTalkState('accepted');
    dialogue.hide();
    coach.playAnimation?.('emote-yes');
    player.playAnimation?.('walk');
    setInstruction(STRINGS.yourTurn);
    showNotice(STRINGS.letsPlay, 2.2);
    audio.playSfx('stamp');
    restoreFollowCamera();
  }

  function updateCelebration(dt) {
    celebrationRemaining -= dt;
    const progress = clamp((2.45 - celebrationRemaining) / 1.35, 0, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const targetX = celebrationZone.x;
    const targetZ = celebrationZone.z + 1.1;
    player.position.x = celebrationStart.x + (targetX - celebrationStart.x) * eased;
    player.position.z = celebrationStart.z + (targetZ - celebrationStart.z) * eased;
    faceToward(player, targetX, targetZ - 2);
    if (progress >= 1) {
      player.playAnimation?.('emote-yes');
      player.position.y = 0.08 + Math.max(0, Math.sin(elapsed * 7)) * 0.12;
    }
    updateCameraFocus(dt);
    if (celebrationRemaining <= 0) {
      phase = 'finishing';
      finishRemaining = 0.55;
      setInstruction(STRINGS.complete);
    }
  }

  function debugSnapshot() {
    return {
      phase,
      level,
      player: { x: player?.position.x ?? 0, z: player?.position.z ?? 0 },
      zones: zones.map((zone) => ({ id: zone.id, x: zone.x, z: zone.z })),
      npcs: npcs.map((npc) => ({
        state: npc.state,
        asked: npc.asked,
        x: npc.character.position.x,
        z: npc.character.position.z,
      })),
    };
  }

  function installDebugHook() {
    if (!window.__eslDebug) {
      Object.defineProperty(window, '__eslDebug', { value: {}, configurable: true, writable: false });
      debugRootCreated = true;
    }
    Object.defineProperty(window.__eslDebug, 'sports', { configurable: true, enumerable: true, get: debugSnapshot });
  }

  function removeDebugHook() {
    if (window.__eslDebug) delete window.__eslDebug.sports;
    if (debugRootCreated && window.__eslDebug && Object.keys(window.__eslDebug).length === 0) delete window.__eslDebug;
    debugRootCreated = false;
  }

  function enter(requestedLevel) {
    const configuredLevel = Number(settings.get('difficulty'));
    const numericLevel = Number(requestedLevel);
    level = THREE.MathUtils.clamp(
      Math.round(Number.isFinite(numericLevel) && numericLevel > 0 ? numericLevel : configuredLevel || 1),
      1,
      3,
    );
    active = true;
    finishCalled = false;
    phase = 'playing';
    elapsed = 0;
    noticeRemaining = 0;
    dialogueRemaining = 0;
    answerRemaining = 0;
    replayRemaining = 0;
    roundEndRemaining = 0;
    celebrationRemaining = 0;
    finishRemaining = 0;
    acceptedAnswer = null;
    questionNpc = null;
    dialogueNpc = null;
    currentReplayNpc = null;
    activeWave = 0;
    waveDelivered = 0;
    lastJoinedNpc = null;
    celebrationZone = null;
    celebrationStart = null;
    overviewCamera = true;
    createOverlay();
    buildWorld();
    installDebugHook();
    unsubscribeSettings = settings.subscribe((next) => {
      if (!active) return;
      speech.setEnabled(!next.micFree);
      hud.setMicFree(next.micFree);
      hud.setTextSize(next.textSize);
    });
  }

  function update(dt) {
    if (!active) return;
    const safeDt = Math.min(Math.max(dt || 0, 0), 0.05);
    elapsed += safeDt;
    if (noticeRemaining > 0) {
      noticeRemaining -= safeDt;
      if (noticeRemaining <= 0 && notice) notice.hidden = true;
    }
    if (dialogueRemaining > 0) {
      dialogueRemaining -= safeDt;
      if (dialogueRemaining <= 0 && phase === 'playing') {
        dialogue.hide();
        dialogueNpc = null;
      }
    }

    if (phase === 'playing') {
      updateMovement(safeDt);
      updateFollowers(safeDt);
      updateContext();
      checkZones();
      updateCameraFocus(safeDt);
    } else if (phase === 'answering') {
      player.playAnimation?.('idle');
      answerRemaining -= safeDt;
      if (answerRemaining <= 0) {
        dialogue.hide();
        dialogueNpc = null;
        hud.hide();
        phase = 'playing';
        restoreFollowCamera();
      }
    } else if (phase === 'replaying') {
      player.playAnimation?.('idle');
      updateFollowers(safeDt);
      replayRemaining -= safeDt;
      if (replayRemaining <= 0) playNextReplay();
    } else if (phase === 'round-end') {
      player.playAnimation?.('idle');
      roundEndRemaining -= safeDt;
      if (roundEndRemaining <= 0) beginTurnaround();
    } else if (phase === 'celebrating') {
      updateCelebration(safeDt);
    } else if (phase === 'finishing') {
      finishRemaining -= safeDt;
      if (finishRemaining <= 0 && !finishCalled) {
        finishCalled = true;
        const result = scoreSession(records);
        hud.hide();
        finish({ stars: result.stars, detail: { category: 'sport', answer: acceptedAnswer } });
      }
    }

    updateJoined(safeDt);
    for (const npc of npcs) {
      if (npc.state !== 'joined') npc.character.updateAnimation?.(safeDt);
    }
    updateShakes(safeDt);
    player?.updateAnimation?.(safeDt);
    coach?.updateAnimation?.(safeDt);
    for (const zone of zones) {
      zone.group.getWorldQuaternion(parentQuaternion);
      zone.sign?.quaternion.copy(parentQuaternion.invert()).multiply(camera.quaternion);
    }
  }

  function exit() {
    active = false;
    phase = 'inactive';
    unsubscribeSettings?.();
    unsubscribeSettings = null;
    speech.clearTarget();
    speech.cancel();
    audio.stop();
    hud.hide();
    dialogue.hide();
    dialogue.element?.classList.remove('sports-dialogue');
    cameraRig.setTarget(null);
    listenAgain?.dispose();
    removeDebugHook();
    player?.disposeCharacter?.();
    coach?.disposeCharacter?.();
    for (const npc of npcs) npc.character.disposeCharacter?.();
    if (world) scene.remove(world);
    for (const texture of textures) texture.dispose();
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    for (const canvas of canvases) { canvas.width = 0; canvas.height = 0; }
    textures.clear();
    geometries.clear();
    materials.clear();
    canvases.clear();
    zones.length = 0;
    npcs.length = 0;
    records.length = 0;
    replayQueue.length = 0;
    trail.length = 0;
    overlay?.remove();
    style?.remove();
    world = null;
    player = null;
    coach = null;
    cameraFocus = null;
    overlay = null;
    style = null;
    instruction = null;
    notice = null;
    listenAgain = null;
    questionNpc = null;
    dialogueNpc = null;
    currentReplayNpc = null;
    celebrationZone = null;
    celebrationStart = null;
    scene.fog = null;
  }

  return { id: 'sports', enter, update, exit };
}
