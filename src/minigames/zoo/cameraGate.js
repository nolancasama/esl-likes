/** The one request-derived gate used by the button, shortcut, and controller. */
export function canOpenZooCamera({ active, phase, openRequestCount }) {
  return active === true && phase === 'playing' && openRequestCount > 0;
}
