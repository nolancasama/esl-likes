/**
 * Three brush sizes. Not a slider.
 *
 * A slider asks a seven-year-old to tune a number before they can draw; three
 * buttons ask them to pick one. Diameters are in picture pixels at
 * `PICTURE_SIZE` (720), so they scale with the canvas like everything else.
 *
 * The sizes are chosen against the robot rather than against the canvas: the
 * torso is 0.43 of the picture wide, about 310px, so Large crosses it in four
 * strokes and Small is fine enough to colour an eye or the antenna ball without
 * swamping them.
 */

export const BRUSHES = Object.freeze({
  small: Object.freeze({ id: 'small', diameter: 18, dots: 1 }),
  medium: Object.freeze({ id: 'medium', diameter: 38, dots: 2 }),
  large: Object.freeze({ id: 'large', diameter: 70, dots: 3 }),
});

export const BRUSH_IDS = Object.freeze(Object.keys(BRUSHES));

/** Medium: big enough to make progress, small enough not to swamp a detail. */
export const DEFAULT_BRUSH = 'medium';

export const brushFor = (id) => BRUSHES[id] ?? BRUSHES[DEFAULT_BRUSH];
