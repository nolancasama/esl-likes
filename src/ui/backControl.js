const TEXT_INPUT_TYPES = new Set([
  '',
  'email',
  'number',
  'password',
  'search',
  'tel',
  'text',
  'url',
]);

function isEditableTarget(target) {
  if (!target || typeof target !== 'object') return false;
  if (target.isContentEditable) return true;

  const tagName = String(target.tagName || '').toLowerCase();
  if (tagName === 'textarea') return true;
  if (tagName === 'input') return TEXT_INPUT_TYPES.has(String(target.type || '').toLowerCase());

  return Boolean(target.closest?.('[contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]'));
}

/** Shell modals paint over every minigame, so their Escape wins over one. */
export const SHELL_MODAL_ESCAPE_PRIORITY = 10;

/**
 * Creates the shell-owned route back to the hub and arbitrates Escape for
 * local UIs that need to close before a minigame can be left.
 */
export function createBackControl({ root, label, onBack }) {
  if (!root || typeof onBack !== 'function') {
    throw new TypeError('createBackControl requires root and onBack');
  }

  const guards = [];
  let available = false;
  let destroyed = false;
  let sequence = 0;

  const element = document.createElement('button');
  element.type = 'button';
  element.className = 'shell-back-control';
  element.textContent = label;
  element.hidden = true;
  root.append(element);

  function activate() {
    if (!available || destroyed) return;
    onBack();
  }

  function onKeyDown(event) {
    if (event.key !== 'Escape' || event.repeat || isEditableTarget(event.target)) return;

    // Highest priority first, then most recently registered. Registration order
    // alone is not enough: the Zoo's viewfinder sits at z-index 18, so a child
    // can open the Settings panel on top of it, and the last-registered guard
    // would then close the viewfinder underneath instead of the panel they are
    // actually looking at. Shell modals therefore outrank minigame guards.
    for (const entry of [...guards].sort((a, b) => b.priority - a.priority || b.seq - a.seq)) {
      if (entry.guard(event) === true) {
        event.preventDefault();
        return;
      }
    }

    if (!available) return;
    event.preventDefault();
    activate();
  }

  element.addEventListener('click', activate);
  window.addEventListener('keydown', onKeyDown);

  return {
    element,
    setAvailable(nextAvailable) {
      available = nextAvailable === true;
      element.hidden = !available;
      // Four minigames put a scene card in the shared `.top-bar`, which starts
      // at the same corner Back now occupies. Marking the document lets the one
      // shared rule move them clear, and leaves the hub — where Back is hidden —
      // exactly as it was.
      document.documentElement?.classList?.toggle('shell-has-back', available);
    },
    /**
     * `priority` lifts a guard above the ordinary last-registered-wins rule.
     * Shell modals that paint over everything use SHELL_MODAL_ESCAPE_PRIORITY;
     * a minigame's own temporary UI leaves it at the default.
     */
    registerEscapeGuard(guard, { priority = 0 } = {}) {
      if (typeof guard !== 'function') throw new TypeError('Escape guard must be a function');
      sequence += 1;
      const registration = { guard, priority, seq: sequence };
      guards.push(registration);
      let registered = true;
      return () => {
        if (!registered) return;
        registered = false;
        const index = guards.indexOf(registration);
        if (index !== -1) guards.splice(index, 1);
      };
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      available = false;
      guards.length = 0;
      document.documentElement?.classList?.remove('shell-has-back');
      window.removeEventListener('keydown', onKeyDown);
      element.removeEventListener('click', activate);
      element.remove();
    },
  };
}
