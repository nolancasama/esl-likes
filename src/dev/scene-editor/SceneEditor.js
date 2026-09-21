/**
 * A reusable placement editor for three.js projects.
 *
 * It selects, moves, rotates, scales, duplicates and deletes things in a live
 * game world, and writes the result out as portable JSON that the game itself
 * can load with no editor present. That last part is the point: an editor whose
 * output only the editor understands is a drawing of a level, not a level.
 *
 * NOTHING GAME-SPECIFIC MAY ENTER THIS DIRECTORY. Everything a project needs to
 * say about itself — what assets exist, how one is built, where the ground is,
 * what may be edited — arrives through the adapter. `demo/primitiveAdapter.js`
 * is a second adapter built from three primitives, and it is there to keep this
 * rule honest: if the demo still works, the core is still generic.
 *
 * See `.ai/scene-editor-spec.md` for the frozen contract.
 */

import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';

import { createEditorCamera } from './editorCamera.js';
import { createEditorUI } from './editorUI.js';
import { createHistory, sameTransform, transformCommand } from './editorHistory.js';
import { createPointLayer } from './pointLayer.js';
import { ensureUniqueId, nextId } from './editorIds.js';
import { EDITOR_USER_DATA, applyTransform, loadLayoutInto, readTransform } from './layoutLoader.js';
import { parseLayout, serializeLayout, toJSON } from './layoutSerializer.js';

const NUDGE = 0.25;
const NUDGE_LARGE = 1;
const YAW_STEP = THREE.MathUtils.degToRad(5);
const MIN_SCALE = 0.01;
const CLICK_SLOP = 4;
const DRAFT_DEBOUNCE_MS = 500;

const OWNED_KEYS = new Set([
  'KeyW', 'KeyE', 'KeyR', 'KeyX', 'KeyF', 'KeyG', 'KeyD', 'KeyZ', 'KeyY',
  'Delete', 'Backspace', 'Escape',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'PageUp', 'PageDown', 'Comma', 'Period',
]);

const isTypingTarget = (target) => target instanceof Element
  && target.closest('input, select, textarea, [contenteditable="true"]');

export function createSceneEditor({
  scene,
  camera,
  domElement,
  adapter,
  uiRoot = document.body,
  storageKey = null,
  onEnable = null,
  onDisable = null,
}) {
  if (!adapter?.createAsset || !adapter?.getGroundPoint) {
    throw new Error('A scene-editor adapter needs createAsset() and getGroundPoint().');
  }

  const assets = adapter.assets ?? [];
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const categories = adapter.categories ?? [];

  /** @type {Map<string, {id, assetId, category, object, deletable, locked, adopted}>} */
  const registry = new Map();
  const hiddenCategories = new Set();
  const helperObjects = new Map();

  const root = new THREE.Group();
  root.name = 'scene-editor-root';       // holds objects the editor created
  const overlay = new THREE.Group();
  overlay.name = 'scene-editor-overlay'; // holds gizmo, highlight, helpers, points

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const groundHit = new THREE.Vector3();

  let enabled = false;
  let selection = null;           // registry record
  let placementAsset = null;      // asset id awaiting a ground click
  let uniformScale = true;
  let pointGroupId = null;
  let pointAddMode = false;
  let draggingPoint = null;
  let dragBefore = null;          // transform captured at gizmo mouseDown
  let pointBefore = null;
  let downAt = null;
  let draftTimer = 0;
  let disposed = false;

  const editorCamera = createEditorCamera({ camera, domElement });
  const history = createHistory({ onChange: (state) => ui?.setHistory(state) });

  const gizmo = new TransformControls(camera, domElement);
  gizmo.setSpace('world');
  gizmo.enabled = false;
  const gizmoHelper = gizmo.getHelper();
  gizmoHelper.visible = false;

  const highlight = new THREE.BoxHelper(new THREE.Object3D(), 0xffd400);
  highlight.visible = false;
  highlight.material.depthTest = false;
  highlight.material.transparent = true;

  const pointLayer = adapter.pointGroups?.length
    ? createPointLayer({
      groups: adapter.pointGroups,
      isPlaceable: adapter.isPlaceable ?? null,
    })
    : null;

  const ui = createEditorUI({
    root: uiRoot,
    categories,
    assets,
    pointGroups: adapter.pointGroups ?? [],
    helpers: adapter.helpers ?? [],
    handlers: {
      onClose: () => disable(),
      onUndo: () => { history.undo(); afterMutation('undo'); },
      onRedo: () => { history.redo(); afterMutation('redo'); },
      onSelectAsset: (assetId) => beginPlacement(assetId),
      onCancelPlacement: () => beginPlacement(null),
      onTransformField: handleField,
      onUniformChange: (value) => { uniformScale = value; },
      onToggleLock: (value) => setLocked(value),
      onDelete: () => deleteSelection(),
      onDuplicate: () => duplicateSelection(),
      onSnapToGround: () => snapToGround(),
      onCopyPlacement: () => copyPlacement(),
      onSnapTranslation: (value) => gizmo.setTranslationSnap(value || null),
      onSnapRotation: (value) => gizmo.setRotationSnap(value ? THREE.MathUtils.degToRad(value) : null),
      onCategoryVisibility: setCategoryVisible,
      onHelperToggle: setHelperVisible,
      onPointGroup: selectPointGroup,
      onPointAddMode: () => setPointAddMode(!pointAddMode),
      onPointsExport: () => copyPoints(),
      onExport: () => downloadLayout(),
      onCopyJSON: () => copyLayout(),
      onImport: (text, name) => importLayout(text, name),
      onReset: () => resetLayout(),
    },
  });

  // ---------------------------------------------------------------- registry

  function markObject(record) {
    record.object.userData[EDITOR_USER_DATA] = {
      id: record.id,
      assetId: record.assetId,
      category: record.category,
      deletable: record.deletable,
      locked: record.locked,
    };
  }

  function register({ id, assetId, category, object, deletable = true, locked = false, adopted = false }) {
    const finalId = ensureUniqueId(id, assetId, new Set(registry.keys()));
    const record = { id: finalId, assetId, category, object, deletable, locked, adopted };
    registry.set(finalId, record);
    markObject(record);
    return record;
  }

  function unregister(record) {
    registry.delete(record.id);
    if (selection === record) select(null);
  }

  /** Walks up from a raycast hit to the logical asset root the adapter made. */
  function resolveRecord(object) {
    for (let node = object; node; node = node.parent) {
      const marker = node.userData?.[EDITOR_USER_DATA];
      if (marker && registry.has(marker.id)) return registry.get(marker.id);
    }
    return null;
  }

  // --------------------------------------------------------------- selection

  function select(record) {
    if (record && record.locked) {
      status(`"${record.id}" is locked.`, 'error');
      return;
    }
    selection = record ?? null;
    if (selection) {
      gizmo.attach(selection.object);
      gizmo.enabled = true;
      gizmoHelper.visible = true;
      highlight.setFromObject(selection.object);
      highlight.visible = true;
      ui.setSelection({ id: selection.id, assetId: selection.assetId, locked: selection.locked });
      uniformScale = assetById.get(selection.assetId)?.uniform ?? true;
      ui.setUniform(uniformScale);
      syncFields();
    } else {
      gizmo.detach();
      gizmo.enabled = false;
      gizmoHelper.visible = false;
      highlight.visible = false;
      ui.setSelection(null);
    }
  }

  function syncFields() {
    if (!selection) return;
    const transform = readTransform(selection.object);
    ui.setTransform({
      position: transform.position,
      rotation: transform.rotation.map(THREE.MathUtils.radToDeg),
      scale: transform.scale,
    });
    highlight.setFromObject(selection.object);
  }

  // -------------------------------------------------------------- transforms

  function applyTo(record, transform) {
    applyTransform(record.object, transform);
    if (record === selection) syncFields();
    scheduleDraft();
  }

  /** Every transform change routes through here, so all of them undo alike. */
  function commitTransform(record, before, after, label) {
    if (sameTransform(before, after)) return;
    history.run(transformCommand({
      label,
      before,
      after,
      apply: (transform) => applyTo(record, transform),
    }));
  }

  function mutate(label, change) {
    if (!selection) { status('Nothing is selected.', 'error'); return; }
    if (selection.locked) { status(`"${selection.id}" is locked.`, 'error'); return; }
    const before = readTransform(selection.object);
    const after = readTransform(selection.object);
    change(after);
    clampScale(after);
    commitTransform(selection, before, after, label);
  }

  function clampScale(transform) {
    for (let i = 0; i < 3; i += 1) {
      if (!Number.isFinite(transform.scale[i]) || transform.scale[i] < MIN_SCALE) {
        transform.scale[i] = MIN_SCALE;
      }
    }
  }

  function handleField(kind, axis, value) {
    const index = { x: 0, y: 1, z: 2 }[axis];
    mutate(`edit ${kind}`, (transform) => {
      if (kind === 'rotation') transform.rotation[index] = THREE.MathUtils.degToRad(value);
      else if (kind === 'scale') {
        if (uniformScale) transform.scale = [value, value, value];
        else transform.scale[index] = value;
      } else transform.position[index] = value;
    });
  }

  function snapToGround() {
    if (!selection) { status('Nothing is selected.', 'error'); return; }
    const object = selection.object;
    const origin = new THREE.Vector3(object.position.x, 1000, object.position.z);
    raycaster.set(origin, new THREE.Vector3(0, -1, 0));
    const hit = adapter.getGroundPoint(raycaster, groundHit);
    if (!hit) { status('No ground under that point.', 'error'); return; }
    const y = hit.y;
    mutate('snap to ground', (transform) => { transform.position[1] = y; });
    status('Dropped to ground.', 'ok');
  }

  function setLocked(value) {
    if (!selection) return;
    selection.locked = value;
    markObject(selection);
    status(value ? `"${selection.id}" locked.` : `"${selection.id}" unlocked.`);
    if (value) select(null);
  }

  // ------------------------------------------------------- create and delete

  function instantiate(assetId) {
    const object = adapter.createAsset(assetId);
    if (!object) {
      status(`The adapter could not build "${assetId}".`, 'error');
      return null;
    }
    return object;
  }

  function createAt(assetId, position, { transform = null, label = 'create' } = {}) {
    const object = instantiate(assetId);
    if (!object) return null;
    const asset = assetById.get(assetId);
    const record = register({
      id: nextId(assetId, registry.keys()),
      assetId,
      category: asset?.category ?? '',
      object,
      deletable: asset?.deletable ?? true,
    });
    if (transform) applyTransform(object, transform);
    else object.position.set(position.x, position.y, position.z);
    root.add(object);

    const snapshot = readTransform(object);
    history.push({
      label,
      do: () => {
        const rebuilt = instantiate(assetId);
        if (!rebuilt) return;
        applyTransform(rebuilt, snapshot);
        record.object = rebuilt;
        markObject(record);
        registry.set(record.id, record);
        root.add(rebuilt);
        select(record);
      },
      undo: () => {
        record.object.removeFromParent();
        adapter.disposeAsset?.(assetId, record.object);
        unregister(record);
      },
    });
    select(record);
    scheduleDraft();
    return record;
  }

  function duplicateSelection() {
    if (!selection) { status('Nothing is selected.', 'error'); return; }
    // A fresh instance through the adapter, never Object3D.clone(): cloning a
    // skinned glTF drops the skeleton and the copy renders at the file origin.
    const transform = readTransform(selection.object);
    transform.position[0] += 0.5;
    transform.position[2] += 0.5;
    const record = createAt(selection.assetId, null, { transform, label: 'duplicate' });
    if (record) status(`Duplicated as "${record.id}".`, 'ok');
  }

  function deleteSelection() {
    if (!selection) { status('Nothing is selected.', 'error'); return; }
    const record = selection;
    if (!record.deletable) { status(`"${record.id}" is protected.`, 'error'); return; }
    if (record.locked) { status(`"${record.id}" is locked.`, 'error'); return; }

    const transform = readTransform(record.object);
    const parent = record.object.parent ?? root;
    history.run({
      label: 'delete',
      do: () => {
        record.object.removeFromParent();
        adapter.disposeAsset?.(record.assetId, record.object);
        unregister(record);
      },
      undo: () => {
        const rebuilt = instantiate(record.assetId);
        if (!rebuilt) return;
        applyTransform(rebuilt, transform);
        record.object = rebuilt;
        registry.set(record.id, record);
        markObject(record);
        parent.add(rebuilt);
        select(record);
      },
    });
    status(`Deleted "${record.id}".`, 'ok');
    scheduleDraft();
  }

  // ------------------------------------------------------------------ points

  function selectPointGroup(groupId) {
    pointGroupId = groupId;
    ui.setPointGroup(groupId);
    if (!groupId) setPointAddMode(false);
    else status(`Editing points: ${groupId}. Click a marker to select, or turn on Add mode.`);
  }

  function setPointAddMode(active) {
    pointAddMode = Boolean(active) && Boolean(pointGroupId);
    ui.setPointAddMode(pointAddMode);
    if (pointAddMode) {
      beginPlacement(null);
      status('Add mode: click the ground to append a point.');
    }
  }

  function addPoint(position) {
    if (!pointLayer || !pointGroupId) return;
    const groupId = pointGroupId;
    const point = { x: position.x, y: position.y, z: position.z };
    const index = pointLayer.add(groupId, point);
    history.push({
      label: 'add point',
      do: () => pointLayer.insert(groupId, index, point),
      undo: () => pointLayer.remove(groupId, index),
    });
    notifyPoints(groupId);
    status(`Added point ${index + 1} to ${groupId}.`, 'ok');
  }

  function deletePoint() {
    const chosen = pointLayer?.selected;
    if (!chosen) return false;
    const { groupId, index } = chosen;
    const removed = pointLayer.remove(groupId, index);
    if (!removed) return false;
    history.push({
      label: 'delete point',
      do: () => pointLayer.remove(groupId, index),
      undo: () => pointLayer.insert(groupId, index, removed),
    });
    notifyPoints(groupId);
    status(`Removed point ${index + 1} from ${groupId}.`, 'ok');
    return true;
  }

  function notifyPoints(groupId) {
    adapter.onPointsChanged?.(groupId, pointLayer.points(groupId));
    scheduleDraft();
  }

  // -------------------------------------------------------------- layout i/o

  function buildLayout() {
    const objects = [...registry.values()].map((record) => ({
      id: record.id,
      asset: record.assetId,
      category: record.category,
      ...readTransform(record.object),
    }));
    const snapshot = pointLayer?.snapshot() ?? { points: {}, formats: {} };
    return serializeLayout({
      project: adapter.id ?? 'unknown',
      objects,
      points: snapshot.points,
      pointFormats: snapshot.formats,
    });
  }

  async function toClipboard(text, message) {
    try {
      await navigator.clipboard.writeText(text);
      status(message, 'ok');
    } catch {
      window.prompt('Copy manually:', text);
    }
  }

  function copyLayout() {
    toClipboard(toJSON(buildLayout()), `Copied ${registry.size} placements.`);
  }

  function copyPoints() {
    if (!pointLayer) return;
    const snapshot = pointLayer.snapshot();
    const layout = serializeLayout({
      project: adapter.id ?? 'unknown',
      objects: [],
      points: snapshot.points,
      pointFormats: snapshot.formats,
    });
    toClipboard(toJSON(layout.points ?? {}), 'Copied points.');
  }

  function copyPlacement() {
    if (!selection) { status('Nothing is selected.', 'error'); return; }
    const t = readTransform(selection.object);
    const round = (value) => Math.round(value * 1e4) / 1e4;
    const snippet = `{ x: ${round(t.position[0])}, y: ${round(t.position[1])}, z: ${round(t.position[2])}, `
      + `yaw: ${round(t.rotation[1])}, scale: ${round(t.scale[0])} }`;
    toClipboard(snippet, 'Placement copied.');
  }

  function downloadLayout() {
    const blob = new Blob([toJSON(buildLayout())], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${adapter.id ?? 'layout'}-layout.json`;
    link.click();
    URL.revokeObjectURL(url);
    status(`Exported ${registry.size} placements.`, 'ok');
  }

  /** Removes every object the editor owns. Adopted host objects are left alone. */
  function clearCreated() {
    for (const record of [...registry.values()]) {
      if (record.adopted) continue;
      record.object.removeFromParent();
      adapter.disposeAsset?.(record.assetId, record.object);
      registry.delete(record.id);
    }
    select(null);
  }

  function loadLayout(layout, { replace = true } = {}) {
    const parsed = parseLayout(layout, { knownAssets: assets.map((asset) => asset.id) });
    if (replace) clearCreated();

    const result = loadLayoutInto(root, parsed, adapter);
    for (const entry of result.created) {
      register({
        id: entry.id,
        assetId: entry.asset,
        category: entry.category,
        object: entry.object,
        deletable: assetById.get(entry.asset)?.deletable ?? true,
      });
    }
    if (pointLayer) {
      for (const groupId of pointLayer.groupIds) {
        const stored = parsed.points?.[groupId];
        if (!stored) continue;
        const format = pointLayer.format(groupId);
        pointLayer.load(groupId, stored.map((point) => (format === 'xyz'
          ? { x: point[0], y: point[1], z: point[2] }
          : { x: point[0], y: 0, z: point[1] })));
        notifyPoints(groupId);
      }
    }
    history.clear();
    const errors = [...parsed.errors, ...result.errors];
    if (errors.length) {
      status(`Loaded ${result.created.length}, skipped ${errors.length}. First: ${errors[0]}`, 'error');
      for (const message of errors) console.warn('[scene-editor]', message);
    } else {
      status(`Loaded ${result.created.length} placements.`, 'ok');
    }
    scheduleDraft();
    return { created: result.created.length, errors };
  }

  function importLayout(text, name = 'layout') {
    const ownCount = [...registry.values()].filter((record) => !record.adopted).length;
    if (ownCount && !window.confirm(`Replace ${ownCount} placed object(s) with "${name}"?`)) return;
    try {
      loadLayout(text);
    } catch (error) {
      status(`Import failed: ${error.message}`, 'error');
    }
  }

  function resetLayout() {
    const ownCount = [...registry.values()].filter((record) => !record.adopted).length;
    if (!ownCount) { status('Nothing to reset.'); return; }
    if (!window.confirm(`Remove ${ownCount} placed object(s)? This cannot be undone.`)) return;
    clearCreated();
    history.clear();
    clearDraft();
    status('Cleared.', 'ok');
  }

  // ------------------------------------------------------------------ drafts

  function scheduleDraft() {
    if (!storageKey || !enabled) return;
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
      try {
        window.localStorage.setItem(storageKey, toJSON(buildLayout(), { pretty: false }));
      } catch { /* private mode, quota — a draft is a convenience, never a requirement */ }
    }, DRAFT_DEBOUNCE_MS);
  }

  function clearDraft() {
    if (!storageKey) return;
    try { window.localStorage.removeItem(storageKey); } catch { /* ignore */ }
  }

  function offerDraft() {
    if (!storageKey) return;
    let raw = null;
    try { raw = window.localStorage.getItem(storageKey); } catch { return; }
    if (!raw) return;
    let count = 0;
    try { count = JSON.parse(raw).objects?.length ?? 0; } catch { return; }
    if (!count) return;
    if (window.confirm(`Restore the unsaved draft from last time (${count} objects)?`)) {
      try { loadLayout(raw); } catch (error) { status(`Draft unreadable: ${error.message}`, 'error'); }
    } else clearDraft();
  }

  // ------------------------------------------------------------- visibility

  function setCategoryVisible(categoryId, visible) {
    if (visible) hiddenCategories.delete(categoryId);
    else hiddenCategories.add(categoryId);
    for (const record of registry.values()) {
      if (record.category === categoryId) record.object.visible = visible;
    }
    if (!visible && selection?.category === categoryId) select(null);
  }

  function setHelperVisible(helperId, visible) {
    let object = helperObjects.get(helperId);
    if (!object && visible) {
      const definition = adapter.helpers?.find((helper) => helper.id === helperId);
      object = definition?.build?.() ?? null;
      if (!object) { status(`Helper "${helperId}" produced nothing.`, 'error'); return; }
      helperObjects.set(helperId, object);
      overlay.add(object);
    }
    if (object) object.visible = visible;
  }

  // ----------------------------------------------------------------- pointer

  function updatePointer(event) {
    const rect = domElement.getBoundingClientRect();
    pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
  }

  function onPointerDown(event) {
    if (!enabled || event.button !== 0) return;
    // TransformControls sets `axis` while an axis is hovered; a press then
    // belongs to the gizmo, not to selection.
    downAt = gizmo.axis ? null : { x: event.clientX, y: event.clientY };
    if (downAt && pointLayer) {
      updatePointer(event);
      const hit = pointLayer.pick(raycaster);
      if (hit) {
        pointLayer.select(hit.groupId, hit.index);
        selectPointGroup(hit.groupId);
        const points = pointLayer.points(hit.groupId);
        pointBefore = { ...points[hit.index] };
        draggingPoint = hit;
        editorCamera.setEnabled(false);
        downAt = null;
      }
    }
  }

  function onPointerMove(event) {
    if (!enabled || !draggingPoint) return;
    updatePointer(event);
    const hit = adapter.getGroundPoint(raycaster, groundHit);
    if (hit) pointLayer.move(draggingPoint.groupId, draggingPoint.index, { x: hit.x, y: hit.y, z: hit.z });
  }

  function onPointerUp(event) {
    if (!enabled) return;
    if (draggingPoint) {
      const { groupId, index } = draggingPoint;
      const after = { ...pointLayer.points(groupId)[index] };
      const before = pointBefore;
      draggingPoint = null;
      pointBefore = null;
      editorCamera.setEnabled(true);
      if (before && (before.x !== after.x || before.z !== after.z || before.y !== after.y)) {
        history.push({
          label: 'move point',
          do: () => pointLayer.move(groupId, index, after),
          undo: () => pointLayer.move(groupId, index, before),
        });
        notifyPoints(groupId);
      }
      return;
    }
    if (!downAt) return;
    const moved = Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y);
    downAt = null;
    if (moved > CLICK_SLOP) return;   // that was an orbit, not a click

    updatePointer(event);

    if (placementAsset) {
      const hit = adapter.getGroundPoint(raycaster, groundHit);
      if (!hit) { status('Click the ground to place.', 'error'); return; }
      const verdict = adapter.isPlaceable?.(hit.x, hit.y, hit.z) ?? true;
      if (verdict !== true) status(`Placed, but: ${verdict}`, 'error');
      const asset = placementAsset;
      // Placing is one-shot unless Shift is held. Staying armed would mean the
      // next click anywhere drops another object, including a click meant to
      // select something — and then there is no way to select at all.
      if (!event.shiftKey) beginPlacement(null);
      const record = createAt(asset, hit);
      if (record && verdict === true) {
        status(event.shiftKey
          ? `Placed "${record.id}". Shift held — click again to place another.`
          : `Placed "${record.id}".`, 'ok');
      }
      return;
    }

    if (pointAddMode && pointGroupId) {
      const hit = adapter.getGroundPoint(raycaster, groundHit);
      if (hit) addPoint(hit);
      return;
    }

    const hits = raycaster.intersectObjects(scene.children, true);
    for (const hit of hits) {
      if (overlay.getObjectById(hit.object.id)) continue;
      const record = resolveRecord(hit.object);
      if (record) { select(record); return; }
    }
    select(null);
  }

  function beginPlacement(assetId) {
    placementAsset = assetId ?? null;
    ui.setPlacement(placementAsset);
    if (placementAsset) {
      setPointAddMode(false);
      status(`Click the ground to place "${placementAsset}".`);
    }
  }

  // ---------------------------------------------------------------- keyboard

  function onKeyDown(event) {
    if (!enabled || isTypingTarget(event.target)) return;
    const ctrl = event.ctrlKey || event.metaKey;

    if (ctrl && event.code === 'KeyZ') {
      claim(event);
      if (event.shiftKey) history.redo(); else history.undo();
      afterMutation(event.shiftKey ? 'redo' : 'undo');
      return;
    }
    if (ctrl && event.code === 'KeyY') {
      claim(event);
      history.redo();
      afterMutation('redo');
      return;
    }
    if (ctrl && event.code === 'KeyD') { claim(event); duplicateSelection(); return; }
    if (ctrl) return;
    if (!OWNED_KEYS.has(event.code)) return;

    switch (event.code) {
      case 'KeyW': claim(event); gizmo.setMode('translate'); status('Move'); break;
      case 'KeyE': claim(event); gizmo.setMode('rotate'); status('Rotate'); break;
      case 'KeyR': claim(event); gizmo.setMode('scale'); status('Scale'); break;
      case 'KeyX': {
        claim(event);
        const next = gizmo.space === 'world' ? 'local' : 'world';
        gizmo.setSpace(next);
        status(`Space: ${next}`);
        break;
      }
      case 'KeyF': claim(event); editorCamera.frame(selection?.object ?? null); break;
      case 'KeyG': claim(event); snapToGround(); break;
      case 'Delete':
      case 'Backspace':
        claim(event);
        if (!deletePoint()) deleteSelection();
        break;
      case 'Escape':
        claim(event);
        if (placementAsset) beginPlacement(null);
        else if (pointAddMode) setPointAddMode(false);
        else select(null);
        break;
      case 'ArrowUp':
      case 'ArrowDown':
      case 'ArrowLeft':
      case 'ArrowRight': {
        claim(event);
        const step = event.shiftKey ? NUDGE_LARGE : NUDGE;
        const dx = event.code === 'ArrowLeft' ? -step : event.code === 'ArrowRight' ? step : 0;
        const dz = event.code === 'ArrowUp' ? -step : event.code === 'ArrowDown' ? step : 0;
        mutate('nudge', (transform) => {
          transform.position[0] += dx;
          transform.position[2] += dz;
        });
        break;
      }
      case 'PageUp':
      case 'PageDown': {
        claim(event);
        const step = (event.code === 'PageUp' ? 1 : -1) * (event.shiftKey ? NUDGE_LARGE : NUDGE);
        mutate('height', (transform) => { transform.position[1] += step; });
        break;
      }
      case 'Comma':
      case 'Period': {
        claim(event);
        const step = (event.code === 'Period' ? 1 : -1) * YAW_STEP;
        mutate('yaw', (transform) => { transform.rotation[1] += step; });
        break;
      }
      default: break;
    }
  }

  /**
   * The host game listens on `window` in the bubble phase and preventDefaults
   * WASD and the arrows for walking. The editor listens in capture and stops
   * the event here, so a nudge never also takes a step.
   */
  function claim(event) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }

  function afterMutation(label) {
    syncFields();
    scheduleDraft();
    status(label === 'undo' ? 'Undo.' : 'Redo.');
  }

  function status(message, tone = 'info') {
    ui.setStatus(message, tone);
  }

  // ------------------------------------------------------------------- gizmo

  gizmo.addEventListener('dragging-changed', (event) => {
    editorCamera.setEnabled(!event.value);
  });
  gizmo.addEventListener('mouseDown', () => {
    dragBefore = selection ? readTransform(selection.object) : null;
  });
  gizmo.addEventListener('mouseUp', () => {
    // One history entry for the whole drag, not one per frame.
    if (!selection || !dragBefore) return;
    const after = readTransform(selection.object);
    clampScale(after);
    applyTransform(selection.object, after);
    commitTransform(selection, dragBefore, after, `gizmo ${gizmo.mode}`);
    dragBefore = null;
  });
  gizmo.addEventListener('objectChange', () => syncFields());

  // ------------------------------------------------------------ enable cycle

  function adoptExisting() {
    const existing = adapter.listExisting?.() ?? [];
    for (const entry of existing) {
      if (!entry?.object) continue;
      register({ ...entry, adopted: true });
    }
    return existing.length;
  }

  function enable() {
    if (enabled || disposed) return;
    enabled = true;
    onEnable?.();

    scene.add(root, overlay);
    overlay.add(gizmoHelper, highlight);
    if (pointLayer) overlay.add(pointLayer.root);

    editorCamera.takeOver();
    ui.mount();
    ui.setHistory({ canUndo: history.canUndo, canRedo: history.canRedo, length: history.length });
    ui.setSelection(null);

    const adopted = adoptExisting();
    status(`Editor on. ${adopted} existing object(s) registered.`);

    window.addEventListener('keydown', onKeyDown, true);
    domElement.addEventListener('pointerdown', onPointerDown);
    domElement.addEventListener('pointermove', onPointerMove);
    domElement.addEventListener('pointerup', onPointerUp);

    offerDraft();
  }

  function disable() {
    if (!enabled) return;
    enabled = false;
    clearTimeout(draftTimer);

    window.removeEventListener('keydown', onKeyDown, true);
    domElement.removeEventListener('pointerdown', onPointerDown);
    domElement.removeEventListener('pointermove', onPointerMove);
    domElement.removeEventListener('pointerup', onPointerUp);

    select(null);
    beginPlacement(null);
    setPointAddMode(false);
    ui.unmount();
    editorCamera.release();

    // Restore anything the editor hid, then leave the scene graph as found.
    for (const categoryId of [...hiddenCategories]) setCategoryVisible(categoryId, true);
    for (const object of helperObjects.values()) object.visible = false;

    overlay.removeFromParent();
    // Objects the editor created stay in the world; adopted ones were never ours.
    for (const record of [...registry.values()]) {
      if (record.adopted) registry.delete(record.id);
    }
    if (!registry.size) root.removeFromParent();
    onDisable?.();
  }

  function update(dt) {
    if (!enabled) return;
    editorCamera.update(dt);
    if (selection) highlight.setFromObject(selection.object);
  }

  function dispose() {
    if (disposed) return;
    disable();
    disposed = true;
    clearTimeout(draftTimer);
    gizmo.detach();
    gizmo.dispose();
    highlight.geometry.dispose();
    highlight.material.dispose();
    pointLayer?.dispose();
    editorCamera.dispose();
    ui.dispose();
    for (const object of helperObjects.values()) object.removeFromParent();
    helperObjects.clear();
    registry.clear();
    root.removeFromParent();
    overlay.removeFromParent();
  }

  return {
    enable,
    disable,
    toggle: () => (enabled ? disable() : enable()),
    get enabled() { return enabled; },
    update,
    getLayout: buildLayout,
    loadLayout,
    dispose,
    // Escape hatches for a host that wants to drive the editor itself.
    get selection() { return selection; },
    get history() { return history; },
    root,
  };
}
