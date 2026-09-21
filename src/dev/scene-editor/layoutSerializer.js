/**
 * Pure serialisation for the scene placement editor's layout JSON.
 *
 * No three.js and no DOM: this module works on plain number triples, so the
 * whole format — ordering, rounding, validation, point formats — is testable
 * without a renderer. The editor and the editor-less layout loader both go
 * through here, which is what keeps the saved file and the game in step.
 *
 * The format is deliberately small and hand-editable. See
 * `.ai/scene-editor-spec.md` for the contract.
 */

export const LAYOUT_VERSION = 1;

/** Decimal places kept in the file. Four is finer than anyone places by hand. */
const PRECISION = 4;
const FACTOR = 10 ** PRECISION;

/**
 * Rounds for the file. `-0` is normalised to `0`: it serialises as `-0` in
 * JSON, which makes a diff shout about a placement that did not move.
 */
export function round(value) {
  if (!Number.isFinite(value)) return 0;
  const rounded = Math.round(value * FACTOR) / FACTOR;
  return Object.is(rounded, -0) ? 0 : rounded;
}

const isFiniteTriple = (value) => Array.isArray(value)
  && value.length === 3
  && value.every((entry) => Number.isFinite(entry));

const triple = (value, fallback) => (isFiniteTriple(value)
  ? [round(value[0]), round(value[1]), round(value[2])]
  : [...fallback]);

/** A `{ position, rotation, scale }` of plain triples, rounded for the file. */
export function serializeTransform(transform = {}) {
  return {
    position: triple(transform.position, [0, 0, 0]),
    rotation: triple(transform.rotation, [0, 0, 0]),
    scale: triple(transform.scale, [1, 1, 1]),
  };
}

/** The inverse. Missing or malformed fields fall back to an identity transform. */
export function deserializeTransform(entry = {}) {
  return {
    position: isFiniteTriple(entry.position) ? [...entry.position] : [0, 0, 0],
    rotation: isFiniteTriple(entry.rotation) ? [...entry.rotation] : [0, 0, 0],
    scale: isFiniteTriple(entry.scale) ? [...entry.scale] : [1, 1, 1],
  };
}

/**
 * Points are stored in whichever shape the host authors them in. The Zoo's
 * `territories.js` authors `[x, z]` pairs, so `xz` exports pairs and the block
 * pastes straight back into the source it came from. `xyz` is for hosts whose
 * markers are genuinely three-dimensional.
 */
export function serializePointList(points = [], format = 'xz') {
  const list = Array.isArray(points) ? points : [];
  return list.map((point) => {
    const x = round(point?.x ?? point?.[0] ?? 0);
    const y = round(point?.y ?? (Array.isArray(point) ? point[1] : 0) ?? 0);
    const z = format === 'xyz'
      ? round(point?.z ?? point?.[2] ?? 0)
      : round(point?.z ?? (Array.isArray(point) ? point[1] : 0) ?? 0);
    return format === 'xyz' ? [x, y, z] : [x, z];
  });
}

/** Reads a stored point list back into `{ x, y, z }` objects. */
export function deserializePointList(points = [], format = 'xz') {
  const list = Array.isArray(points) ? points : [];
  const parsed = [];
  for (const point of list) {
    if (!Array.isArray(point)) continue;
    if (format === 'xyz') {
      if (point.length < 3 || !point.slice(0, 3).every(Number.isFinite)) continue;
      parsed.push({ x: point[0], y: point[1], z: point[2] });
    } else {
      if (point.length < 2 || !point.slice(0, 2).every(Number.isFinite)) continue;
      parsed.push({ x: point[0], y: 0, z: point[1] });
    }
  }
  return parsed;
}

/**
 * Builds the layout object. `objects` are sorted by id so that the same scene
 * always produces the same bytes — a layout is meant to live in version
 * control, where an unordered export would show every line as changed.
 */
export function serializeLayout({ project = 'unknown', objects = [], points = {}, pointFormats = {} } = {}) {
  const serialized = objects.map((entry) => ({
    id: String(entry.id),
    asset: String(entry.asset ?? entry.assetId ?? ''),
    category: String(entry.category ?? ''),
    ...serializeTransform(entry),
  }));
  serialized.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const layout = {
    version: LAYOUT_VERSION,
    project: String(project),
    objects: serialized,
  };

  const groupIds = Object.keys(points).sort();
  if (groupIds.length) {
    layout.points = {};
    for (const groupId of groupIds) {
      layout.points[groupId] = serializePointList(points[groupId], pointFormats[groupId] ?? 'xz');
    }
  }
  return layout;
}

export function toJSON(layout, { pretty = true } = {}) {
  return JSON.stringify(layout, null, pretty ? 2 : 0);
}

/**
 * Validates a layout and separates what can be used from what cannot.
 *
 * A wrong or missing version throws: the file is not this format and guessing
 * would place scenery from a shape we do not understand. An unknown asset id is
 * different — the rest of the file is still good, so that object is skipped and
 * named in `errors`. Nothing is ever dropped silently.
 */
export function parseLayout(raw, { knownAssets = null } = {}) {
  const source = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw new Error('Layout must be an object.');
  }
  if (source.version !== LAYOUT_VERSION) {
    throw new Error(`Unsupported layout version ${JSON.stringify(source.version)}; expected ${LAYOUT_VERSION}.`);
  }
  if (source.objects !== undefined && !Array.isArray(source.objects)) {
    throw new Error('Layout "objects" must be an array.');
  }

  const known = knownAssets ? new Set(knownAssets) : null;
  const objects = [];
  const errors = [];
  const seen = new Set();

  (source.objects ?? []).forEach((entry, index) => {
    const where = `objects[${index}]`;
    if (!entry || typeof entry !== 'object') {
      errors.push(`${where}: not an object.`);
      return;
    }
    const asset = typeof entry.asset === 'string' ? entry.asset : '';
    if (!asset) {
      errors.push(`${where}: missing "asset".`);
      return;
    }
    if (known && !known.has(asset)) {
      errors.push(`${where}: unknown asset "${asset}".`);
      return;
    }
    const id = typeof entry.id === 'string' && entry.id ? entry.id : `${asset}-${index}`;
    if (seen.has(id)) {
      errors.push(`${where}: duplicate id "${id}".`);
      return;
    }
    seen.add(id);
    objects.push({
      id,
      asset,
      category: typeof entry.category === 'string' ? entry.category : '',
      ...deserializeTransform(entry),
    });
  });

  const points = {};
  if (source.points && typeof source.points === 'object' && !Array.isArray(source.points)) {
    for (const [groupId, list] of Object.entries(source.points)) {
      if (!Array.isArray(list)) {
        errors.push(`points.${groupId}: not an array.`);
        continue;
      }
      points[groupId] = list;
    }
  }

  return { version: source.version, project: String(source.project ?? ''), objects, points, errors };
}
