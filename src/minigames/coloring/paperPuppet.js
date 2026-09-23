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

import { pieceAt, silhouetteBounds } from './robotDefinition.js';
import { drawPiece, pieceTextureBounds } from './robotRenderer.js';
import {
  DURATIONS,
  HOP_DISTANCE,
  PUPPET_HEIGHT,
  ROAM_POINTS,
  STATES,
  createRoamPlan,
  pieceLayout,
  poseFor,
  stepRoam,
} from './robotPuppet.js';

/**
 * The picture y the puppet stands on, so its feet land on the floor.
 *
 * Derived, never typed. This was `0.875` for as long as that happened to be
 * where the robot's feet ended; the definition later grew and the feet reached
 * 0.947, so every puppet stood an eighth of a unit *through* the floor. Taking
 * the silhouette's own lowest point means the next change to the robot's
 * proportions moves the ground with it, silently and correctly.
 */
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

/**
 * The picture size a puppet's pieces are cut at.
 *
 * 900 was sized for a close-up that no longer happens: the puppet is 1.75 world
 * units tall in a room seen from 8.5 up and 10.5 back, which is a couple of
 * hundred screen pixels. Five cropped pieces plus five cream silhouettes at 900
 * is roughly 4 MB of canvas per robot, and the room now keeps every robot the
 * child makes. At 640 the artwork is still finer than the screen can show.
 */
export const PUPPET_TEXTURE_SIZE = 640;

/** Picture units to world units. The picture is a unit square. */
/**
 * One piece's texture, cut out of the child's paint.
 *
 * `drawPiece` clips to this piece's own silhouette shapes and stamps the paint
 * canvas through that clip, so the piece carries the real brushwork — every
 * stroke, every gap, every bit of bare paper the child left. Paint that spilled
 * outside the lines is left behind, which is exactly why spilling is allowed.
 */
function pieceTexture(subject, piece, paint, size) {
  const box = pieceTextureBounds(piece, { subject, size });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(box.width));
  canvas.height = Math.max(1, Math.ceil(box.height));
  drawPiece(canvas.getContext('2d'), piece, { subject, size, paint });
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

// --- what every puppet can share -------------------------------------------

/**
 * The room keeps every robot the child makes, so the per-robot cost is what
 * matters now. Three things are byte-identical for every puppet ever built:
 * the unit quad every piece is scaled from, and the two radial gradients.
 * Built once, lazily, and shared.
 *
 * They are deliberately NOT in any puppet's disposal bag. A puppet disposing a
 * texture that twenty other puppets are still drawing with is the exact bug
 * that turns "keep every robot" into a room of white rectangles. Only
 * `disposeSharedPaperAssets`, called when the minigame exits, may free them.
 */
let sharedQuad = null;
let sharedGlow = null;
let sharedShadow = null;
let livePuppetCount = 0;

const quadGeometry = () => (sharedQuad ||= new THREE.PlaneGeometry(1, 1));
const sharedGlowArt = () => (sharedGlow ||= glowTexture());
const sharedShadowArt = () => (sharedShadow ||= shadowTexture());

/** Frees the shared quad and gradients. Call once, after the last puppet is gone. */
export function disposeSharedPaperAssets() {
  if (livePuppetCount > 0) return;
  sharedQuad?.dispose();
  sharedQuad = null;
  for (const art of [sharedGlow, sharedShadow]) {
    if (!art) continue;
    art.texture.dispose();
    art.canvas.width = 0;
    art.canvas.height = 0;
  }
  sharedGlow = null;
  sharedShadow = null;
}

/** Test seam: which shared assets currently exist. */
export const sharedPaperAssets = () => ({
  quad: sharedQuad,
  glow: sharedGlow?.texture ?? null,
  shadow: sharedShadow?.texture ?? null,
});

/**
 * Builds the puppet and returns a controller for it.
 *
 * @param {object} options
 * @param {object} options.subject the authored subject definition
 * @param {HTMLCanvasElement} [options.paint] the child's finished strokes
 * @param {number} [options.textureSize] picture size the textures are drawn at
 */
export function createPaperPuppet({ subject, paint = null, textureSize = PUPPET_TEXTURE_SIZE, onLand } = {}) {
  const disposables = { geometries: new Set(), materials: new Set(), textures: new Set(), canvases: [] };
  const own = (bag, thing) => { disposables[bag].add(thing); return thing; };
  let disposed = false;
  const liveScale = PUPPET_HEIGHT * subject.liveScale;
  const feet = silhouetteBounds(subject).maxY;
  const rootPiece = subject.pieces[0];

  const root = new THREE.Group();
  root.name = `paper-${subject.id}`;

  /** The squash/stretch group, so a scale never disturbs where the puppet stands. */
  const body = new THREE.Group();
  root.add(body);

  // Shared across every puppet, and so never in this puppet's disposal bag.
  const quad = quadGeometry();

  /** @type {Record<string, {group: THREE.Group, layout: object}>} */
  const pieces = {};

  // Parents before children, so a piece's group exists when its child needs it.
  const ordered = [...subject.pieces].sort((a, b) => depthInTree(a) - depthInTree(b));
  function depthInTree(piece) {
    let depth = 0;
    let at = piece;
    while (subject.parents[at]) { at = subject.parents[at]; depth += 1; }
    return depth;
  }

  for (const piece of ordered) {
    const layout = pieceLayout(subject, piece);
    const parentName = subject.parents[piece];
    const parent = parentName ? pieces[parentName].group : body;

    const group = new THREE.Group();
    group.name = `paper-${piece}`;
    if (parentName) {
      const parentLayout = pieces[parentName].layout;
      group.position.set(
        (layout.pivot.x - parentLayout.pivot.x) * liveScale,
        -(layout.pivot.y - parentLayout.pivot.y) * liveScale,
        0,
      );
    } else {
      group.position.set(
        (layout.pivot.x - 0.5) * liveScale,
        (feet - layout.pivot.y) * liveScale,
        0,
      );
    }
    parent.add(group);

    const { texture, canvas } = pieceTexture(subject, piece, paint, textureSize);
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

    const width = layout.width * liveScale;
    const height = layout.height * liveScale;
    const mesh = new THREE.Mesh(quad, material);
    mesh.scale.set(width, height, 1);
    mesh.position.set(
      layout.offset.x * liveScale,
      -layout.offset.y * liveScale,
      subject.depth[piece] * PAPER_DEPTH,
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

    // `artwork` is this piece's own cut-out canvas, kept so the puppet can be
    // fingerprinted without re-deriving anything.
    pieces[piece] = { group, layout, mesh, edge, artwork: canvas };
  }

  // Blinking. The eyes are baked into the body texture, so a blink is two
  // small ink bars laid over them rather than a redraw.
  const lidMaterial = own('materials', new THREE.MeshBasicMaterial({
    color: 0x17233a, transparent: true, opacity: 0, side: THREE.DoubleSide,
  }));
  const lids = subject.details.eyes.map((eye) => {
    const lid = new THREE.Mesh(quad, lidMaterial);
    const eyePiece = pieceAt(subject, eye.cx, eye.cy) ?? rootPiece;
    const owner = pieces[eyePiece].layout;
    lid.scale.set(eye.r * 1.7 * liveScale, eye.r * 0.42 * liveScale, 1);
    lid.position.set(
      (eye.cx - owner.pivot.x) * liveScale,
      -(eye.cy - owner.pivot.y) * liveScale,
      subject.depth[eyePiece] * PAPER_DEPTH + 0.006,
    );
    pieces[eyePiece].group.add(lid);
    return lid;
  });

  // The antenna light glowing when the robot powers up. A gradient, not a flat
  // quad: additive blending over a plain square gave it a white box for a halo.
  const glowSpec = subject.personality.glow;
  const glowArt = glowSpec ? sharedGlowArt() : null;
  const glowMaterial = glowSpec ? own('materials', new THREE.MeshBasicMaterial({
    map: glowArt.texture, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
    depthWrite: false, side: THREE.DoubleSide,
  })) : null;
  const glow = glowSpec ? new THREE.Mesh(quad, glowMaterial) : null;
  if (glowSpec) {
    const owner = pieces[glowSpec.piece].layout;
    const span = glowSpec.r * 5.2 * liveScale;
    glow.scale.set(span, span, 1);
    glow.position.set(
      (glowSpec.cx - owner.pivot.x) * liveScale,
      -(glowSpec.cy - owner.pivot.y) * liveScale,
      subject.depth[glowSpec.piece] * PAPER_DEPTH + 0.008,
    );
    pieces[glowSpec.piece].group.add(glow);
  }

  // A soft shadow on the floor. It shrinks as the puppet leaves the ground,
  // which is most of what sells a hop as a hop.
  const shadowArt = sharedShadowArt();
  const shadowMaterial = own('materials', new THREE.MeshBasicMaterial({
    map: shadowArt.texture, transparent: true, opacity: 0.85, depthWrite: false,
  }));
  const shadow = new THREE.Mesh(quad, shadowMaterial);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.set(0, 0.012, 0);
  shadow.scale.set(liveScale * 0.72, liveScale * 0.5, 1);
  root.add(shadow);

  let state = STATES.IDLE;
  let stateTime = 0;
  let roam = null;
  let glowFloor = 0;
  let lastPose = poseFor(subject, STATES.IDLE, 0);
  /** +1 faces right, -1 faces left. A cut-out turns by flipping, not rotating. */
  let mirror = 1;

  function applyPose(newPose) {
    // The touchdown, reported once per hop. The pose carries the hop stage, so
    // noticing the air -> land edge here needs no second clock.
    if (newPose.stage === 'land' && lastPose.stage !== 'land') onLand?.();
    lastPose = newPose;
    body.position.set(
      newPose.root.x * liveScale * 0.5,
      newPose.root.y * liveScale * 0.5,
      0,
    );
    body.rotation.z = newPose.root.tilt * mirror;
    body.scale.set(newPose.root.scale.x * mirror, newPose.root.scale.y, 1);
    for (const piece of subject.pieces) {
      pieces[piece].group.rotation.z = newPose.rotations[piece] ?? 0;
    }
    lidMaterial.opacity = newPose.blink;
    for (const lid of lids) lid.visible = newPose.blink > 0.02;
    if (glowMaterial) glowMaterial.opacity = Math.max(glowFloor, newPose.glow) * 0.75;

    // The shadow tracks height, not the piece hierarchy: tighter and fainter
    // the higher the puppet is.
    const lift = Math.max(0, newPose.root.y);
    shadowMaterial.opacity = 0.85 / (1 + lift * 2.4);
    const tighten = 1 / (1 + lift * 0.85);
    shadow.scale.set(liveScale * 0.72 * tighten, liveScale * 0.5 * tighten, 1);
  }

  applyPose(lastPose);

  const api = {
    group: root,
    pieces,
    get state() { return state; },
    get stateTime() { return stateTime; },
    get pose() { return lastPose; },
    get roamPlan() { return roam; },

    /**
     * A few numbers that depend only on this puppet's own artwork.
     *
     * The room keeps every robot, and the failure that would matter most is
     * silent: robot 1 quietly drawing robot 2's paint. That is invisible in any
     * unit test and easy to miss by eye when both are colourful, so a harness
     * needs something cheap it can compare. Sampled once, not per frame.
     */
    fingerprint(samples = 6) {
      const canvas = pieces[rootPiece]?.artwork;
      if (!canvas?.width) return [];
      const out = [];
      const ctx = canvas.getContext('2d');
      for (let i = 0; i < samples; i += 1) {
        const x = Math.floor(((i + 0.5) / samples) * canvas.width);
        const y = Math.floor(canvas.height * (0.3 + 0.4 * ((i % 3) / 2)));
        const [r, g, b, a] = ctx.getImageData(x, y, 1, 1).data;
        out.push(((a & 255) << 24 | r << 16 | g << 8 | b) >>> 0);
      }
      return out;
    },

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

    /**
     * `options` is exactly what `robotCrowd.join()` hands back: where in the
     * loop this robot starts, how long it idles, and how far into its cycle it
     * begins. Left out, every puppet roams identically — which is correct for
     * one robot and wrong for twenty.
     */
    startRoaming(
      points = ROAM_POINTS,
      { start = 0, idlePause, stateTime: phase = 0, from } = {},
    ) {
      roam = createRoamPlan(points, start, { idlePause, stateTime: phase, from });
      if (from === undefined) api.placeAt(roam.position.x, roam.position.z, roam.facing);
      state = roam.state;
      stateTime = phase;
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

      applyPose(poseFor(subject, state, stateTime));
      return api;
    },

    /** True once the current one-shot state has played out. */
    isFinished() {
      return stateTime >= (DURATIONS[state] ?? 1);
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      livePuppetCount -= 1;
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

  livePuppetCount += 1;
  return api;
}

export { HOP_DISTANCE, STATES };
