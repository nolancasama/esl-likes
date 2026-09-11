const STYLE_ID = 'listen-again-style';

/**
 * LISTEN AGAIN
 * ------------
 * The secondary control for hearing an NPC's answer again (SPEC 3, "Listening
 * again is support, not failure"). It is deliberately modest and off to the
 * side: reachable with Tab and Enter, never bound to the interact key, and never
 * styled as the big primary button, so it is not pressed out of habit.
 *
 * The game's keyboard input ignores keys aimed at a focused button, so
 * activating this can never also fire a world interaction.
 */
export function createListenAgain({ root, label, onPress }) {
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .listen-again { position: absolute; right: 1rem; bottom: 5.4rem; z-index: 21;
        pointer-events: auto; min-height: 3rem; padding: .45rem 1rem;
        border: .18rem solid #273858; border-radius: 999px; background: rgb(255 255 255 / .94);
        color: #1b2940; box-shadow: 0 .25rem 0 rgb(28 48 78 / .22);
        font: 800 calc(1rem * var(--ui-scale, 1)) system-ui, sans-serif; cursor: pointer; }
      .listen-again:hover { background: #fff; }
      .listen-again:focus-visible { outline: 4px solid #ffcf33; outline-offset: 3px; }
    `;
    document.head.append(style);
  }

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'listen-again';
  button.textContent = label;
  button.hidden = true;
  const press = (event) => {
    onPress?.();
    // A mouse or touch press must not leave focus here: a focused button would
    // take the child's next Space press, replaying the answer instead of acting.
    // Keyboard activation (detail 0) keeps focus so Tab users are not lost.
    if (event?.detail > 0) button.blur();
  };
  button.addEventListener('click', press);
  root.append(button);

  return {
    element: button,
    show() {
      if (button.hidden) button.hidden = false;
    },
    hide() {
      if (button.hidden) return;
      if (document.activeElement === button) button.blur();
      button.hidden = true;
    },
    dispose() {
      button.removeEventListener('click', press);
      button.remove();
    },
  };
}
