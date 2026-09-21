/**
 * Loads a saved layout into a scene **without the editor**.
 *
 * This is the half that ships. The editor is a development tool that may never
 * run in a student's browser, but the JSON it exports has to be consumable by
 * the game itself, or the whole exercise is just a drawing of a level.
 *
 * Deliberately free of three.js, the DOM and every other editor module: it only
 * calls `adapter.createAsset` and writes `position` / `rotation` / `scale` on
 * whatever comes back. That also makes it testable against a plain stub.
 */

import { parseLayout } from './layoutSerializer.js';

export const EDITOR_USER_DATA = '__editor';

/** Writes a plain `{ position, rotation, scale }` triple set onto an Object3D. */
export function applyTransform(object, transform) {
  object.position.set(transform.position[0], transform.position[1], transform.position[2]);
  object.rotation.set(transform.rotation[0], transform.rotation[1], transform.rotation[2]);
  object.scale.set(transform.scale[0], transform.scale[1], transform.scale[2]);
  return object;
}

/** Reads an Object3D's transform back out as plain triples. */
export function readTransform(object) {
  return {
    position: [object.position.x, object.position.y, object.position.z],
    rotation: [object.rotation.x, object.rotation.y, object.rotation.z],
    scale: [object.scale.x, object.scale.y, object.scale.z],
  };
}

/**
 * Instantiates every object in `layout` under `root`.
 *
 * A bad version throws — the file is not this format. An asset the adapter does
 * not know is reported and skipped, so one stale entry cannot cost you the rest
 * of the park.
 *
 * @returns {{ created: Array, errors: string[] }}
 */
export function loadLayoutInto(root, layout, adapter, { onError = null } = {}) {
  const knownAssets = Array.isArray(adapter?.assets)
    ? adapter.assets.map((asset) => asset.id)
    : null;
  const parsed = parseLayout(layout, { knownAssets });

  const errors = [...parsed.errors];
  const created = [];

  for (const entry of parsed.objects) {
    let object = null;
    try {
      object = adapter.createAsset(entry.asset);
    } catch (error) {
      errors.push(`${entry.id}: createAsset("${entry.asset}") threw: ${error.message}`);
      continue;
    }
    if (!object) {
      errors.push(`${entry.id}: createAsset("${entry.asset}") returned nothing.`);
      continue;
    }
    applyTransform(object, entry);
    object.name ||= `layout-${entry.id}`;
    object.userData[EDITOR_USER_DATA] = {
      id: entry.id,
      assetId: entry.asset,
      category: entry.category,
      deletable: true,
      locked: false,
    };
    root.add(object);
    created.push({ ...entry, object });
  }

  if (errors.length && onError) for (const message of errors) onError(message);
  return { created, errors, project: parsed.project, points: parsed.points };
}
