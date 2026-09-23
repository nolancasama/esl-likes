export const DB_NAME = 'esl-likes';
export const DB_VERSION = 1;
export const STORE_NAME = 'coloring-creations';
export const RECORD_VERSION = 1;

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction was aborted.'));
  });
}

/** Browser-only storage and image conversion for completed Coloring creations. */
export function createCreationStorage() {
  let databasePromise;

  function openDatabase() {
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      if (!globalThis.indexedDB) {
        reject(new Error('IndexedDB is unavailable.'));
        return;
      }

      const request = globalThis.indexedDB.open(DB_NAME, DB_VERSION);
      let settled = false;
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => {
        if (settled) {
          request.result.close();
          return;
        }
        settled = true;
        resolve(request.result);
      };
      request.onerror = () => {
        settled = true;
        reject(request.error ?? new Error('IndexedDB could not be opened.'));
      };
      request.onblocked = () => {
        if (settled) return;
        settled = true;
        reject(new Error('IndexedDB open was blocked.'));
      };
    });
    return databasePromise;
  }

  async function readRows() {
    const database = await openDatabase();
    const transaction = database.transaction(STORE_NAME, 'readonly');
    return requestResult(transaction.objectStore(STORE_NAME).getAll());
  }

  async function putRow(row) {
    const database = await openDatabase();
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(row);
    await transactionDone(transaction);
    return row.artworkBlob.size;
  }

  async function clearRows() {
    const database = await openDatabase();
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).clear();
    await transactionDone(transaction);
  }

  function toBlob(canvas) {
    return new Promise((resolve, reject) => {
      try {
        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error('The coloring artwork could not be encoded as PNG.'));
        }, 'image/png');
      } catch (error) {
        reject(error);
      }
    });
  }

  async function toCanvas(blob) {
    const ownerDocument = globalThis.document;
    const image = ownerDocument?.createElement?.('img');
    const canvas = ownerDocument?.createElement?.('canvas');
    if (!image || !canvas || !globalThis.URL?.createObjectURL) {
      throw new Error('A browser document is required to restore coloring artwork.');
    }

    const objectUrl = globalThis.URL.createObjectURL(blob);
    try {
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error('The saved coloring PNG could not be decoded.'));
        image.src = objectUrl;
      });
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('A 2D canvas context is required to restore coloring artwork.');
      context.drawImage(image, 0, 0);
      return canvas;
    } finally {
      globalThis.URL.revokeObjectURL(objectUrl);
    }
  }

  return { readRows, putRow, clearRows, toBlob, toCanvas };
}
