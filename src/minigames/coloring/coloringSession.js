/**
 * Finished coloring robots that survive controller exit/re-entry.
 *
 * This is deliberately module state rather than browser storage: it lasts for
 * the running app session and is gone on reload. Records contain no three.js
 * objects, and the stored canvas is never handed to the live painting surface.
 */

const robots = [];

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
export function saveCompletedRobot(artwork, crowd) {
  const record = Object.freeze({
    artwork: copyCanvas(artwork),
    crowd: Object.freeze({
      start: crowd.start,
      idlePause: crowd.idlePause,
      stateTime: crowd.stateTime,
    }),
  });
  robots.push(record);
  return record;
}

/** A snapshot of the saved-record list; the stored canvases remain read-only assets. */
export function savedRobots() {
  return robots.slice();
}

/** Called only when the whole running game session ends, never on minigame exit. */
export function clearColoringSession() {
  robots.length = 0;
}

