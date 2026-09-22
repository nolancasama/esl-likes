/**
 * The child's drawing, cut out and stood up.
 *
 * Nine flat quads, each textured by re-rendering only its own regions with the
 * same draw code the colouring page used. That is the whole trick: the puppet
 * is not a reconstruction of the child's robot from palette values, it *is* the
 * drawing, so every accent survives — purple feet, orange antenna, pink studs.
 *
 * Deliberately unlit. `MeshBasicMaterial` means the room's lights never shade a
 * piece, so it stays as flat as paper from every angle; a cream backing quad a
 * hair behind each piece supplies the cut edge, and a soft quad on the floor
 * supplies the shadow that grounds it.
 *
 * All the motion comes from `robotPuppet.js`. This file only applies it.
 */

import * as THREE from 'three';

import { PIECES, regionBounds } from './robotDefinition.js';
import { drawPiece, fillFor, pieceTextureBounds } from './robotRenderer.js';
import {
  DURATIONS,
  HOP_DISTANCE,
  PIECE_DEPTH,
  PIECE_PARENTS,
  PUPPET_HEIGHT,
  ROAM_POINTS,
  STATES,
  createRoamPlan,
  pieceLayout,
  poseFor,
  stepRoam,
} from './robotPuppet.js';

/** The picture y the puppet stands on, so its feet land on the floor. */
const FEET = 0.875;

/** Paper thickness, and how much the backing quad oversteps the artwork. */
const PAPER_DEPTH = 0.012;
const PAPER_EDGE = 1.035;
const EDGE_COLOR_CSS = '#f2ece0';

/**
 * How far the sheet may turn away from the camera, in radians.
 *
 * Small on purpose. The camera is a fixed world-aligned three-quarter follow
 * (see DESIGN_DECISIONS), so a cut-out kept nearly parallel to the picture
 * plane is always legible; a lean of a sixth of a radian is enough to stop it
 * looking like a decal.
 */
const LEAN = 0.17;

/** Picture units to world units. The picture is a unit square. */
const toWorldX = (pictureX) => (pictureX - 0.5) * PUPPET_HEIGHT;
const toWorldY = (pictureY) => (FEET - pictureY) * PUPPET_HEIGHT;

/**
 * One piece's texture, cropped to the piece and nothing else.
 *
 * `drawPiece` translates the whole picture so the piece sits at the origin, so
 * the canvas contains exactly this piece's regions with the artwork's own
 * outlines — and never a neighbour's.
 */
function pieceTexture(piece, colors, size) {
  const box = pieceTextureBounds(piece, { size });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(box.width));
  canvas.height = Math.max(1, Math.ceil(box.height));
  drawPiece(canvas.getContext('2d'), piece, { size, colors });
  return { texture: asTexture(canvas), canvas, box };
}

function asTexture(canvas) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

/**
 * The same piece as a flat cream silhouette — the cut edge of the paper.
 *
 * It has to be the piece's *shape*, not its bounding box. A plain quad works
 * for the torso, whose artwork nearly fills its box, and fails badly for the
 * antenna, which is a thin stalk in a tall empty box: the cream backing showed
 * as a rectangle hanging above the robot's head. `source-in` replaces the
 * artwork's colours while keeping its alpha exactly.
 */
function pieceSilhouette(pieceCanvas) {
  const canvas = document.createElement('canvas');
  canvas.width = pieceCanvas.width;
  canvas.height = pieceCanvas.height;
  const out = canvas.getContext('2d');
  out.drawImage(pieceCanvas, 0, 0);
  out.globalCompositeOperation = 'source-in';
  out.fillStyle = EDGE_COLOR_CSS;
  out.fillRect(0, 0, canvas.width, canvas.height);
  return { texture: asTexture(canvas), canvas };
}

/**
 * A round gradient, for the two soft things the puppet needs.
 *
 * Both were plain quads first, and an untextured quad is a rectangle: the
 * shadow read as a grey card under the robot, and the antenna's additive glow
 * read as a white box floating above its head.
 */
function radialTexture(stops, size = 128) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const out = canvas.getContext('2d');
  const half = size / 2;
  const gradient = out.createRadialGradient(half, half, 0, half, half, half);
  for (const [offset, color] of stops) gradient.addColorStop(offset, color);
  out.fillStyle = gradient;
  out.fillRect(0, 0, size, size);
  return { texture: asTexture(canvas), canvas };
}

const shadowTexture = () => radialTexture([
  [0, 'rgba(59,47,74,0.55)'],
  [0.55, 'rgba(59,47,74,0.26)'],
  [1, 'rgba(59,47,74,0)'],
]);

/**
 * A halo, not a blob.
 *
 * A bright core washed the antenna light to white — and that region is one of
 * the two the child is *graded* on, so its colour has to stay readable. The
 * peak therefore sits at 0.42 of the quad's radius, just outside the light
 * itself, and the centre is nearly clear.
 */
const glowTexture = () => radialTexture([
  [0, 'rgba(255,240,170,0.16)'],
  [0.42, 'rgba(255,230,140,0.6)'],
  [1, 'rgba(255,214,90,0)'],
]);

/**
 * Builds the puppet and returns a controller for it.
 *
 * @param {object} options
 * @param {object} options.colors  the child's finished region colours
 * @param {number} [options.textureSize] picture size the textures are drawn at
 */
export function createPaperPuppet({ colors = {}, textureSize = 900, onLand } = {}) {
  const disposables = { geometries: new Set(), materials: new Set(), textures: new Set(), canvases: [] };
  const own = (bag, thing) => { disposables[bag].add(thing); return thing; };

  const root = new THREE.Group();
  root.name = 'paper-robot';

  /** The squash/stretch group, so a scale never disturbs where the puppet stands. */
  const body = new THREE.Group();
  root.add(body);

  const quad = own('geometries', new THREE.PlaneGeometry(1, 1));

  /** @type {Record<string, {group: THREE.Group, layout: object}>} */
  const pieces = {};

  // Parents before children, so a piece's group exists when its child needs it.
  const ordered = [...PIECES].sort((a, b) => depthInTree(a) - depthInTree(b));
  function depthInTree(piece) {
    let depth = 0;
    let at = piece;
    while (PIECE_PARENTS[at]) { at = PIECE_PARENTS[at]; depth += 1; }
    return depth;
  }

  for (const piece of ordered) {
    const layout = pieceLayout(piece);
    const parentName = PIECE_PARENTS[piece];
    const parent = parentName ? pieces[parentName].group : body;

    const group = new THREE.Group();
    group.name = `paper-${piece}`;
    if (parentName) {
      const parentLayout = pieces[parentName].layout;
      group.position.set(
        (layout.pivot.x - parentLayout.pivot.x) * PUPPET_HEIGHT,
        -(layout.pivot.y - parentLayout.pivot.y) * PUPPET_HEIGHT,
        0,
      );
    } else {
      group.position.set(toWorldX(layout.pivot.x), toWorldY(layout.pivot.y), 0);
    }
    parent.add(group);

    const { texture, canvas } = pieceTexture(piece, colors, textureSize);
    own('textures', texture);
    disposables.canvases.push(canvas);
    const material = own('materials', new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      // A hard cutout rather than blended edges: paper has an edge, and blending
      // it makes nine pieces overlap into mush where they meet.
      alphaTest: 0.35,
      side: THREE.DoubleSide,
      depthWrite: true,
    }));

    const width = layout.width * PUPPET_HEIGHT;
    const height = layout.height * PUPPET_HEIGHT;
    const mesh = new THREE.Mesh(quad, material);
    mesh.scale.set(width, height, 1);
    mesh.position.set(
      layout.offset.x * PUPPET_HEIGHT,
      -layout.offset.y * PUPPET_HEIGHT,
      PIECE_DEPTH[piece] * PAPER_DEPTH,
    );
    group.add(mesh);

    // The cut edge: the same silhouette in cream, a hair behind and a hair
    // larger. From any oblique angle this is the thickness of the paper, and
    // from behind it is the blank back of the sheet.
    const silhouette = pieceSilhouette(canvas);
    own('textures', silhouette.texture);
    disposables.canvases.push(silhouette.canvas);
    const edgeMaterial = own('materials', new THREE.MeshBasicMaterial({
      map: silhouette.texture, transparent: true, alphaTest: 0.35, side: THREE.DoubleSide,
    }));
    const edge = new THREE.Mesh(quad, edgeMaterial);
    edge.scale.set(width * PAPER_EDGE, height * PAPER_EDGE, 1);
    edge.position.set(mesh.position.x, mesh.position.y, mesh.position.z - PAPER_DEPTH * 0.5);
    group.add(edge);

    pieces[piece] = { group, layout, mesh, edge };
  }

  // The eyelid: a quad in the eye band's own colour, over the eyes, faded in to
  // blink. The artwork is baked into the texture, so there is nothing to redraw.
  const eyeBox = regionBounds('eyes');
  const lidMaterial = own('materials', new THREE.MeshBasicMaterial({
    color: new THREE.Color(fillFor('eyes', colors)),
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
  }));
  const lid = new THREE.Mesh(quad, lidMaterial);
  lid.scale.set(
    (eyeBox.maxX - eyeBox.minX) * 0.92 * PUPPET_HEIGHT,
    (eyeBox.maxY - eyeBox.minY) * 0.82 * PUPPET_HEIGHT,
    1,
  );
  {
    const head = pieces.head.layout;
    lid.position.set(
      ((eyeBox.minX + eyeBox.maxX) / 2 - head.pivot.x) * PUPPET_HEIGHT,
      -((eyeBox.minY + eyeBox.maxY) / 2 - head.pivot.y) * PUPPET_HEIGHT,
      PIECE_DEPTH.head * PAPER_DEPTH + 0.004,
    );
  }
  pieces.head.group.add(lid);

  // The antenna light glowing when the robot powers up. A gradient, not a flat
  // quad: additive blending over a plain square gave it a white box for a halo.
  const glowArt = glowTexture();
  own('textures', glowArt.texture);
  disposables.canvases.push(glowArt.canvas);
  const glowMaterial = own('materials', new THREE.MeshBasicMaterial({
    map: glowArt.texture, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
    depthWrite: false, side: THREE.DoubleSide,
  }));
  const glow = new THREE.Mesh(quad, glowMaterial);
  {
    const lightBox = regionBounds('antennaLight');
    const antenna = pieces.antenna.layout;
    const span = (lightBox.maxX - lightBox.minX) * 2.6 * PUPPET_HEIGHT;
    glow.scale.set(span, span, 1);
    glow.position.set(
      ((lightBox.minX + lightBox.maxX) / 2 - antenna.pivot.x) * PUPPET_HEIGHT,
      -((lightBox.minY + lightBox.maxY) / 2 - antenna.pivot.y) * PUPPET_HEIGHT,
      PIECE_DEPTH.antenna * PAPER_DEPTH + 0.006,
    );
  }
  pieces.antenna.group.add(glow);

  // A soft shadow on the floor. It shrinks as the puppet leaves the ground,
  // which is most of what sells a hop as a hop.
  const shadowArt = shadowTexture();
  own('textures', shadowArt.texture);
  disposables.canvases.push(shadowArt.canvas);
  const shadowMaterial = own('materials', new THREE.MeshBasicMaterial({
    map: shadowArt.texture, transparent: true, opacity: 0.85, depthWrite: false,
  }));
  const shadow = new THREE.Mesh(quad, shadowMaterial);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.set(0, 0.012, 0);
  shadow.scale.set(PUPPET_HEIGHT * 0.72, PUPPET_HEIGHT * 0.5, 1);
  root.add(shadow);

  let state = STATES.IDLE;
  let stateTime = 0;
  let roam = null;
  let glowFloor = 0;
  let lastPose = poseFor(STATES.IDLE, 0);
  /** +1 faces right, -1 faces left. A cut-out turns by flipping, not rotating. */
  let mirror = 1;

  function applyPose(newPose) {
    // The touchdown, reported once per hop. The pose carries the hop stage, so
    // noticing the air -> land edge here needs no second clock.
    if (newPose.stage === 'land' && lastPose.stage !== 'land') onLand?.();
    lastPose = newPose;
    body.position.set(
      newPose.root.x * PUPPET_HEIGHT * 0.5,
      newPose.root.y * PUPPET_HEIGHT * 0.5,
      0,
    );
    body.rotation.z = newPose.root.tilt * mirror;
    body.scale.set(newPose.root.scale.x * mirror, newPose.root.scale.y, 1);
    for (const piece of PIECES) {
      pieces[piece].group.rotation.z = newPose.rotations[piece] ?? 0;
    }
    lidMaterial.opacity = newPose.blink;
    glowMaterial.opacity = Math.max(glowFloor, newPose.glow) * 0.75;

    // The shadow tracks height, not the piece hierarchy: tighter and fainter
    // the higher the puppet is.
    const lift = Math.max(0, newPose.root.y);
    shadowMaterial.opacity = 0.85 / (1 + lift * 2.4);
    const tighten = 1 / (1 + lift * 0.85);
    shadow.scale.set(PUPPET_HEIGHT * 0.72 * tighten, PUPPET_HEIGHT * 0.5 * tighten, 1);
  }

  applyPose(lastPose);

  const api = {
    group: root,
    pieces,
    get state() { return state; },
    get stateTime() { return stateTime; },
    get pose() { return lastPose; },
    get roamPlan() { return roam; },

    setState(next, { resetTime = true } = {}) {
      state = next;
      if (resetTime) stateTime = 0;
      return api;
    },

    /**
     * Applies one exact pose, bypassing the clock.
     *
     * The preview page uses this to render a chosen frame of a hop. It exists
     * so the preview goes through the same code the game does — reaching into
     * the piece groups from outside left the material opacities being set by
     * `update`'s own clock, which made the glow look intermittent when it was
     * in fact always a white square.
     */
    setPose(newPose) { applyPose(newPose); return api; },

    /** A steady background glow, for the moment after the robot wakes up. */
    setGlowFloor(value) { glowFloor = Math.min(1, Math.max(0, value)); return api; },

    /**
     * Puts the puppet somewhere on the floor, facing the viewer.
     *
     * `facing` is a heading, not a yaw. A flat cut-out turned to face the way it
     * is travelling shows the camera its edge, which is why the robot was a
     * sliver in the room. So the sheet stays roughly parallel to the picture
     * plane: a heading becomes a *flip* plus a slight lean, the way a paper
     * puppet turns round in a paper theatre.
     */
    placeAt(x, z, facing = 0) {
      root.position.x = x;
      root.position.z = z;
      api.setHeading(facing);
      return api;
    },

    setHeading(facing) {
      const sideways = Math.sin(facing);
      // Hysteresis: only commit to a flip when the heading is clearly sideways,
      // so a puppet hopping straight at the camera does not flicker.
      if (Math.abs(sideways) > 0.3) mirror = sideways > 0 ? 1 : -1;
      root.rotation.y = LEAN * sideways;
      return api;
    },

    get mirror() { return mirror; },

    /** Lifts the whole puppet, for the peel-off-the-page moment. */
    setLift(y) { root.position.y = y; return api; },

    startRoaming(points = ROAM_POINTS) {
      roam = createRoamPlan(points);
      api.placeAt(roam.position.x, roam.position.z, roam.facing);
      state = roam.state;
      stateTime = 0;
      return api;
    },

    stopRoaming() { roam = null; return api; },

    update(dt) {
      const safeDt = Math.min(Math.max(dt || 0, 0), 0.05);
      stateTime += safeDt;

      if (roam) {
        stepRoam(roam, safeDt);
        // The roam plan owns the state while roaming; a cinematic takes it back
        // by calling stopRoaming first.
        if (roam.state !== state) { state = roam.state; stateTime = roam.stateTime; }
        else stateTime = roam.stateTime;
        root.position.x = roam.position.x;
        root.position.z = roam.position.z;
        api.setHeading(roam.facing);
      }

      applyPose(poseFor(state, stateTime));
      return api;
    },

    /** True once the current one-shot state has played out. */
    isFinished() {
      return stateTime >= (DURATIONS[state] ?? 1);
    },

    dispose() {
      root.parent?.remove(root);
      for (const texture of disposables.textures) texture.dispose();
      for (const material of disposables.materials) material.dispose();
      for (const geometry of disposables.geometries) geometry.dispose();
      for (const canvas of disposables.canvases) { canvas.width = 0; canvas.height = 0; }
      disposables.textures.clear();
      disposables.materials.clear();
      disposables.geometries.clear();
      disposables.canvases.length = 0;
      roam = null;
    },
  };

  return api;
}

export { HOP_DISTANCE, STATES };
