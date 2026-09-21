/**
 * Just enough tar.gz and zip reading to pull a handful of named members out of
 * the animal source packs at build time. Both packs live outside the repository
 * and are only ever read, so this stays a reader: no extraction to disk, no
 * dependency added, and no attempt at the parts of either format the packs do
 * not use (sparse files, encryption, zip64, multi-disk).
 */

import { gunzipSync, inflateRawSync } from 'node:zlib';

const TAR_BLOCK = 512;

function readOctal(buffer, offset, length) {
  const text = buffer.toString('ascii', offset, offset + length).replace(/\0.*$/, '').trim();
  return text ? parseInt(text, 8) : 0;
}

/**
 * Reads a gzipped tar into a Map of member path to Buffer.
 * A `.unitypackage` is exactly this: one directory per asset GUID, each holding
 * a `pathname` member naming the asset and an `asset` member with its bytes.
 */
export function readTarGz(buffer) {
  const tar = gunzipSync(buffer);
  const members = new Map();
  let offset = 0;
  let longName = null;

  while (offset + TAR_BLOCK <= tar.length) {
    const nameField = tar.toString('utf8', offset, offset + 100).replace(/\0.*$/, '');
    // Two consecutive zero blocks end the archive; one empty name is enough here.
    if (!nameField && !longName) break;

    const size = readOctal(tar, offset + 124, 12);
    const typeFlag = tar.toString('ascii', offset + 156, offset + 157);
    const prefix = tar.toString('utf8', offset + 345, offset + 500).replace(/\0.*$/, '');
    const dataStart = offset + TAR_BLOCK;
    const data = tar.subarray(dataStart, dataStart + size);

    if (typeFlag === 'L') {
      // GNU long name: the next header's real path is this block's payload.
      longName = data.toString('utf8').replace(/\0.*$/, '');
    } else {
      const path = longName ?? (prefix ? `${prefix}/${nameField}` : nameField);
      longName = null;
      if (typeFlag === '0' || typeFlag === '\0') members.set(path, Buffer.from(data));
    }

    offset = dataStart + Math.ceil(size / TAR_BLOCK) * TAR_BLOCK;
  }

  return members;
}

/**
 * Resolves a `.unitypackage`'s GUID directories into asset paths.
 * Returns a Map of `Assets/...` path to the asset's bytes.
 */
export function readUnityPackage(buffer) {
  const members = readTarGz(buffer);
  const assets = new Map();
  for (const [path, data] of members) {
    if (!path.endsWith('/pathname')) continue;
    const guid = path.slice(0, -'/pathname'.length);
    const asset = members.get(`${guid}/asset`);
    if (!asset) continue; // Folder entries carry a pathname but no asset.
    assets.set(data.toString('utf8').split('\n')[0].trim(), asset);
  }
  return assets;
}

/** Reads a zip's central directory into a Map of member path to Buffer. */
export function readZip(buffer) {
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0 && i >= buffer.length - 66_000; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('zip: no end-of-central-directory record');

  const entryCount = buffer.readUInt16LE(eocd + 10);
  let cursor = buffer.readUInt32LE(eocd + 16);
  const members = new Map();

  for (let i = 0; i < entryCount; i += 1) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.toString('utf8', cursor + 46, cursor + 46 + nameLength);

    if (!name.endsWith('/')) {
      // The local header repeats the name and extra fields at its own lengths.
      const localNameLength = buffer.readUInt16LE(localOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const raw = buffer.subarray(dataStart, dataStart + compressedSize);
      members.set(name, method === 0 ? Buffer.from(raw) : inflateRawSync(raw));
    }

    cursor += 46 + nameLength + extraLength + commentLength;
  }

  return members;
}
