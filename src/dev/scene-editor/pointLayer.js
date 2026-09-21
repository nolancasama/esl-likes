/**
 * The marker layer: the editor's second item type.
 *
 * Scenery is an asset with a transform. A point is just a place — an animal's
 * roaming waypoint, an NPC spawn, a camera position, a path node. It needs no
 * model, no rotation and no scale, and the host stores it in whatever shape it
 * already authors, so it gets its own small layer rather than being forced
 * through the placement registry.
 *
 * Everything here lives under one group that is removed on `disable()`. These
 * markers must be impossible to see in normal play — they are scaffolding for
 * the person building the level, not part of the level.
 */

import * as THREE from 'three';

const PIN_HEIGHT = 1.6;
const HEAD_RADIUS = 0.34;

export function createPointLayer({ groups = [], isPlaceable = null } = {}) {
  const root = new THREE.Group();
  root.name = 'scene-editor-points';

  const owned = { geometries: [], materials: [] };
  const own = (thing, kind) => { owned[kind].push(thing); return thing; };

  const headGeometry = own(new THREE.SphereGeometry(HEAD_RADIUS, 12, 8), 'geometries');
  const pinGeometry = own(new THREE.CylinderGeometry(0.045, 0.045, PIN_HEIGHT, 6), 'geometries');
  const invalidMaterial = own(new THREE.MeshBasicMaterial({ color: 0xff2d2d }), 'materials');
  const selectedMaterial = own(new THREE.MeshBasicMaterial({ color: 0xffd400 }), 'materials');

  /** @type {Map<string, {group: object, root: THREE.Group, points: Array, material: THREE.Material, line: THREE.Line|null}>} */
  const layers = new Map();
  let selected = null;   // { groupId, index }

  for (const group of groups) {
    const layerRoot = new THREE.Group();
    layerRoot.name = `scene-editor-points-${group.id}`;
    const material = own(new THREE.MeshBasicMaterial({ color: group.colour ?? 0x3fa9f5 }), 'materials');
    const lineMaterial = own(new THREE.LineBasicMaterial({
      color: group.colour ?? 0x3fa9f5, transparent: true, opacity: 0.55,
    }), 'materials');
    const lineGeometry = own(new THREE.BufferGeometry(), 'geometries');
    const line = new THREE.LineLoop(lineGeometry, lineMaterial);
    line.frustumCulled = false;
    layerRoot.add(line);
    root.add(layerRoot);
    layers.set(group.id, {
      group,
      root: layerRoot,
      material,
      line,
      points: (group.points ?? []).map((point) => normalise(point, group.format)),
      markers: [],
    });
  }

  function normalise(point, format) {
    if (Array.isArray(point)) {
      return format === 'xyz'
        ? { x: point[0] ?? 0, y: point[1] ?? 0, z: point[2] ?? 0 }
        : { x: point[0] ?? 0, y: 0, z: point[1] ?? 0 };
    }
    return { x: point?.x ?? 0, y: point?.y ?? 0, z: point?.z ?? 0 };
  }

  function markerMaterial(layer, index, point) {
    if (selected && selected.groupId === layer.group.id && selected.index === index) return selectedMaterial;
    if (isPlaceable) {
      const verdict = isPlaceable(point.x, point.y, point.z, layer.group.id);
      if (verdict !== true) return invalidMaterial;
    }
    return layer.material;
  }

  /** Rebuilds one group's markers. Cheap: a handful of points per group. */
  function rebuild(groupId) {
    const layer = layers.get(groupId);
    if (!layer) return;
    for (const marker of layer.markers) layer.root.remove(marker);
    layer.markers.length = 0;

    layer.points.forEach((point, index) => {
      const marker = new THREE.Group();
      marker.name = `point-${groupId}-${index}`;
      const material = markerMaterial(layer, index, point);
      const pin = new THREE.Mesh(pinGeometry, material);
      pin.position.y = PIN_HEIGHT * 0.5;
      const head = new THREE.Mesh(headGeometry, material);
      head.position.y = PIN_HEIGHT + HEAD_RADIUS * 0.5;
      marker.add(pin, head);
      marker.position.set(point.x, point.y, point.z);
      marker.userData.__editorPoint = { groupId, index };
      layer.root.add(marker);
      layer.markers.push(marker);
    });

    const positions = new Float32Array(layer.points.length * 3);
    layer.points.forEach((point, index) => {
      positions[index * 3] = point.x;
      positions[index * 3 + 1] = point.y + 0.08;
      positions[index * 3 + 2] = point.z;
    });
    layer.line.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    layer.line.geometry.computeBoundingSphere();
    layer.line.visible = layer.points.length > 1;
  }

  function rebuildAll() {
    for (const groupId of layers.keys()) rebuild(groupId);
  }
  rebuildAll();

  /** Walks up from a raycast hit to the marker that owns it. */
  function resolve(object) {
    for (let node = object; node; node = node.parent) {
      if (node.userData?.__editorPoint) return node.userData.__editorPoint;
    }
    return null;
  }

  function pick(raycaster) {
    const hits = raycaster.intersectObject(root, true);
    for (const hit of hits) {
      const found = resolve(hit.object);
      if (found) return found;
    }
    return null;
  }

  const api = {
    root,
    get groupIds() { return [...layers.keys()]; },
    get selected() { return selected; },

    select(groupId, index) {
      const previous = selected;
      selected = groupId === null ? null : { groupId, index };
      if (previous) rebuild(previous.groupId);
      if (selected) rebuild(selected.groupId);
      return selected;
    },

    pick,

    points(groupId) {
      const layer = layers.get(groupId);
      return layer ? layer.points.map((point) => ({ ...point })) : [];
    },

    format(groupId) {
      return layers.get(groupId)?.group.format ?? 'xz';
    },

    add(groupId, point) {
      const layer = layers.get(groupId);
      if (!layer) return null;
      layer.points.push(normalise(point, layer.group.format));
      rebuild(groupId);
      return layer.points.length - 1;
    },

    insert(groupId, index, point) {
      const layer = layers.get(groupId);
      if (!layer) return null;
      layer.points.splice(index, 0, normalise(point, layer.group.format));
      rebuild(groupId);
      return index;
    },

    remove(groupId, index) {
      const layer = layers.get(groupId);
      if (!layer || index < 0 || index >= layer.points.length) return null;
      const [removed] = layer.points.splice(index, 1);
      if (selected && selected.groupId === groupId && selected.index === index) selected = null;
      rebuild(groupId);
      return removed;
    },

    move(groupId, index, point) {
      const layer = layers.get(groupId);
      if (!layer || !layer.points[index]) return;
      layer.points[index] = normalise(point, layer.group.format);
      rebuild(groupId);
    },

    setVisible(groupId, visible) {
      const layer = layers.get(groupId);
      if (layer) layer.root.visible = visible;
    },

    /** `{ groupId: [[x, z], ...] }` plus the formats, for the serializer. */
    snapshot() {
      const points = {};
      const formats = {};
      for (const [groupId, layer] of layers) {
        points[groupId] = layer.points.map((point) => ({ ...point }));
        formats[groupId] = layer.group.format ?? 'xz';
      }
      return { points, formats };
    },

    load(groupId, points) {
      const layer = layers.get(groupId);
      if (!layer) return;
      layer.points = points.map((point) => normalise(point, layer.group.format));
      rebuild(groupId);
    },

    refresh: rebuildAll,

    dispose() {
      root.removeFromParent();
      for (const geometry of owned.geometries) geometry.dispose();
      for (const material of owned.materials) material.dispose();
      layers.clear();
    },
  };
  return api;
}
