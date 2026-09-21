/**
 * A scene-editor adapter built from nothing but three primitives.
 *
 * This exists to keep the editor honest. It imports no game code — no
 * minigame, no system, no config — so if the demo page still places, moves,
 * exports and re-imports correctly, the editor core has not quietly grown a
 * dependency on the game it happens to live beside.
 */

import * as THREE from 'three';

const PALETTE = {
  cube: 0xe7643c,
  sphere: 0x3fa9f5,
  cylinder: 0x8bc34a,
};

const GROUND_Y = 0;
const HALF_EXTENT = 30;

export function createPrimitiveAdapter() {
  const geometries = {
    cube: new THREE.BoxGeometry(1, 1, 1),
    sphere: new THREE.SphereGeometry(0.5, 20, 14),
    cylinder: new THREE.CylinderGeometry(0.5, 0.5, 1, 20),
  };
  const materials = Object.fromEntries(
    Object.entries(PALETTE).map(([key, color]) => [
      key, new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.05 }),
    ]),
  );

  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -GROUND_Y);

  return {
    id: 'primitive-demo',

    categories: [
      { id: 'boxes', name: 'Boxes' },
      { id: 'round', name: 'Round things' },
    ],

    assets: [
      { id: 'cube', name: 'Cube', category: 'boxes' },
      { id: 'sphere', name: 'Sphere', category: 'round' },
      { id: 'cylinder', name: 'Cylinder', category: 'round' },
    ],

    createAsset(assetId) {
      const geometry = geometries[assetId];
      if (!geometry) return null;
      // The logical root is a group whose origin sits on the ground, so a
      // placement's y is the ground and not the middle of the shape.
      const root = new THREE.Group();
      root.name = `demo-${assetId}`;
      const mesh = new THREE.Mesh(geometry, materials[assetId]);
      mesh.position.y = assetId === 'sphere' ? 0.5 : 0.5;
      mesh.castShadow = true;
      root.add(mesh);
      return root;
    },

    getGroundPoint(raycaster, out) {
      return raycaster.ray.intersectPlane(plane, out);
    },

    isPlaceable(x, _y, z) {
      if (Math.abs(x) > HALF_EXTENT || Math.abs(z) > HALF_EXTENT) return 'outside the demo floor';
      return true;
    },

    pointGroups: [
      { id: 'waypoints', name: 'Waypoints', colour: 0xff9f1c, format: 'xz', points: [[-4, -4], [4, -4], [4, 4]] },
    ],

    helpers: [
      {
        id: 'grid',
        name: 'Grid',
        build: () => new THREE.GridHelper(HALF_EXTENT * 2, HALF_EXTENT, 0x445566, 0x2b3644),
      },
    ],

    dispose() {
      for (const geometry of Object.values(geometries)) geometry.dispose();
      for (const material of Object.values(materials)) material.dispose();
    },
  };
}
