/**
 * The seven lesson colours.
 *
 * Its own file because the palette outlived the region-fill system it used to
 * live inside: `colorState.js` tracked which region held which colour, and
 * with freehand painting there are no regions to track. The colours stayed.
 */

export const PALETTE = Object.freeze(['red', 'blue', 'yellow', 'green', 'pink', 'purple', 'orange']);

/** Line art always redraws on top, so these can be strong. */
export const PALETTE_HEX = Object.freeze({
  red: '#e2483d',
  blue: '#2f7dd1',
  yellow: '#f2c53d',
  green: '#4aa855',
  pink: '#ef85b5',
  purple: '#8c62c4',
  orange: '#ef8f3c',
});

export const isColor = (value) => PALETTE.includes(value);
