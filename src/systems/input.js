import * as THREE from 'three';

const MOVEMENT_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD',
  'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight',
]);
const HANDLED_KEYS = new Set([...MOVEMENT_KEYS, 'Space']);

/** Keyboard state polled by scenes and minigames. */
export function createInput(target = window) {
  const held = new Set();
  const pressed = new Set();
  const movement = new THREE.Vector2();

  const onKeyDown = (event) => {
    const interactive = event.target instanceof Element
      && event.target.closest('button, input, select, textarea, [role="button"]');
    if (interactive) return;
    if (HANDLED_KEYS.has(event.code)) event.preventDefault();
    if (!held.has(event.code)) pressed.add(event.code);
    held.add(event.code);
  };

  const onKeyUp = (event) => {
    if (HANDLED_KEYS.has(event.code)) event.preventDefault();
    held.delete(event.code);
  };

  const clear = () => {
    held.clear();
    pressed.clear();
    movement.set(0, 0);
  };

  const onVisibilityChange = () => {
    if (document.hidden) clear();
  };

  target.addEventListener('keydown', onKeyDown);
  target.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', clear);
  document.addEventListener('visibilitychange', onVisibilityChange);

  function getMovement(out = movement) {
    let x = 0;
    let y = 0;
    if (held.has('KeyA') || held.has('ArrowLeft')) x -= 1;
    if (held.has('KeyD') || held.has('ArrowRight')) x += 1;
    if (held.has('KeyW') || held.has('ArrowUp')) y += 1;
    if (held.has('KeyS') || held.has('ArrowDown')) y -= 1;
    out.set(x, y);
    if (out.lengthSq() > 1) out.normalize();
    return out;
  }

  function isDown(action) {
    if (action === 'interact') return held.has('Space');
    return held.has(action);
  }

  function wasPressed(action) {
    return pressed.has(action === 'interact' ? 'Space' : action);
  }

  function consumeInteract() {
    if (!pressed.has('Space')) return false;
    pressed.delete('Space');
    return true;
  }

  function endFrame() {
    pressed.clear();
  }

  function destroy() {
    clear();
    target.removeEventListener('keydown', onKeyDown);
    target.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', clear);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  }

  return {
    getMovement,
    isDown,
    wasPressed,
    consumeInteract,
    endFrame,
    update: endFrame,
    clear,
    destroy,
  };
}
