import { createCreationStorage, RECORD_VERSION } from './creationStorage.js';

/** Finished creations stay synchronous in memory while durability happens behind them. */

const creations = [];
let storage;
let hydrationPromise;
let writeQueue = Promise.resolve();
let lastOrderTime = -1;
let orderWithinTime = 0;
const durableSizes = new Map();
const persistence = {
  hydrated: false,
  available: false,
  lastError: null,
};

function creationStorage() {
  storage ??= createCreationStorage();
  return storage;
}

function errorMessage(error) {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function warnPersistence(message, error) {
  persistence.available = false;
  persistence.lastError = errorMessage(error);
  console.warn(message, error);
}

function markAvailable() {
  persistence.available = true;
  persistence.lastError = null;
}

function nextId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const random = Math.random().toString(36).slice(2);
  return `creation-${Date.now().toString(36)}-${random}`;
}

function nextOrder(createdAt) {
  if (createdAt === lastOrderTime) orderWithinTime += 1;
  else {
    lastOrderTime = createdAt;
    orderWithinTime = 0;
  }
  return createdAt * 1000 + orderWithinTime;
}

function freezeCrowd(crowd = {}) {
  return Object.freeze({
    start: crowd.start,
    idlePause: crowd.idlePause,
    stateTime: crowd.stateTime,
  });
}

function freezeRecord({ id, subjectId, createdAt, order, artwork, crowd }) {
  return Object.freeze({
    id,
    version: RECORD_VERSION,
    subjectId,
    createdAt,
    order,
    artwork,
    crowd: freezeCrowd(crowd),
  });
}

function compareCreations(left, right) {
  const leftOrder = Number.isFinite(left.order) ? left.order : null;
  const rightOrder = Number.isFinite(right.order) ? right.order : null;
  if (leftOrder !== null && rightOrder !== null && leftOrder !== rightOrder) return leftOrder - rightOrder;
  const leftCreatedAt = Number.isFinite(left.createdAt) ? left.createdAt : 0;
  const rightCreatedAt = Number.isFinite(right.createdAt) ? right.createdAt : 0;
  if (leftCreatedAt !== rightCreatedAt) return leftCreatedAt - rightCreatedAt;
  return left.id.localeCompare(right.id);
}

function copyCanvas(source) {
  const ownerDocument = source?.ownerDocument ?? globalThis.document;
  const copy = ownerDocument?.createElement?.('canvas');
  if (!copy) throw new TypeError('A canvas document is required to save coloring artwork.');

  copy.width = source.width;
  copy.height = source.height;
  const context = copy.getContext('2d');
  if (!context) throw new TypeError('The coloring artwork must provide a 2D canvas context.');
  context.drawImage(source, 0, 0);
  return copy;
}

/**
 * Saves one completed robot. Artwork is copied now, before the live painting
 * surface can be reset or disposed; crowd data is reduced to the personality
 * fields needed to reconstruct the robot on a later visit.
 */
export function saveCompletedCreation({ subjectId, artwork, crowd }) {
  const createdAt = Date.now();
  const record = freezeRecord({
    id: nextId(),
    subjectId,
    createdAt,
    order: nextOrder(createdAt),
    artwork: copyCanvas(artwork),
    crowd,
  });
  creations.push(record);
  const targetStorage = creationStorage();
  writeQueue = writeQueue.then(async () => {
    const artworkBlob = await targetStorage.toBlob(record.artwork);
    const row = {
      id: record.id,
      version: record.version,
      subjectId: record.subjectId,
      createdAt: record.createdAt,
      order: record.order,
      artworkBlob,
      crowd: { ...record.crowd },
    };
    const bytes = await targetStorage.putRow(row);
    durableSizes.set(record.id, Number.isFinite(bytes) ? bytes : artworkBlob.size);
    markAvailable();
  }).catch((error) => {
    warnPersistence('Coloring creation could not be saved permanently; it remains available for this session.', error);
  });
  return record;
}

/** A snapshot of the saved-record list; the stored canvases remain read-only assets. */
export function savedCreations() {
  return creations.slice();
}

/**
 * Restores durable records once, merging them with anything completed while the
 * database was opening so a slow Chromebook can never lose the newest creation.
 */
export function hydrateCreations() {
  if (hydrationPromise) return hydrationPromise;
  const targetStorage = creationStorage();
  hydrationPromise = (async () => {
    try {
      const rows = await targetStorage.readRows();
      markAvailable();
      const restored = [];
      for (const row of rows) {
        try {
          if (!row || typeof row.id !== 'string' || !row.id) throw new TypeError('Saved creation has no string id.');
          if (!(row.artworkBlob instanceof Blob)) throw new TypeError('Saved creation has no Blob artwork.');
          if (row.version !== RECORD_VERSION) throw new TypeError(`Unsupported saved creation version: ${row.version}.`);
          const artwork = await targetStorage.toCanvas(row.artworkBlob);
          restored.push(freezeRecord({
            id: row.id,
            subjectId: typeof row.subjectId === 'string' ? row.subjectId : undefined,
            createdAt: Number.isFinite(row.createdAt) ? row.createdAt : 0,
            order: Number.isFinite(row.order) ? row.order : undefined,
            artwork,
            crowd: row.crowd,
          }));
          durableSizes.set(row.id, row.artworkBlob.size);
        } catch (error) {
          console.warn('A saved Coloring creation was skipped because it could not be restored.', error);
        }
      }

      const merged = new Map(creations.map((record) => [record.id, record]));
      for (const record of restored) {
        if (!merged.has(record.id)) merged.set(record.id, record);
      }
      creations.splice(0, creations.length, ...merged.values());
      creations.sort(compareCreations);
    } catch (error) {
      warnPersistence('Saved Coloring creations could not be loaded; the game will continue without them.', error);
    } finally {
      persistence.hydrated = true;
    }
    return savedCreations();
  })();
  return hydrationPromise;
}

/** Clears both tiers explicitly; normal navigation and shutdown never call this. */
export async function clearSavedCreations() {
  await writeQueue;
  creations.length = 0;
  try {
    await creationStorage().clearRows();
    durableSizes.clear();
    markAvailable();
  } catch (error) {
    warnPersistence('Saved Coloring creations could not be cleared permanently.', error);
  }
}

export function creationPersistenceStatus() {
  return {
    hydrated: persistence.hydrated,
    available: persistence.available,
    lastError: persistence.lastError,
    bytes: [...durableSizes.values()].reduce((total, bytes) => total + bytes, 0),
    count: durableSizes.size,
  };
}

/** Test-only storage seam; game code always uses the browser implementation. */
export function __setCreationStorage(nextStorage) {
  storage = nextStorage ?? undefined;
  hydrationPromise = undefined;
  writeQueue = Promise.resolve();
  durableSizes.clear();
  persistence.hydrated = false;
  persistence.available = false;
  persistence.lastError = null;
}

/** Memory-only by design: Back, replay, and browser shutdown never erase durable art. */
export function clearColoringSession() {
  creations.length = 0;
}
