import { formatUi } from '../config/lesson.js';
import { stageProgressState } from '../systems/gameSequence.js';
import { SHELL_MODAL_ESCAPE_PRIORITY } from './backControl.js';

function makeElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

export function createStampBook({ root, progression, lessons, strings, registerEscapeGuard, launcherLabel }) {
  // The shell's own button, so the sequence route can open the book too. The
  // hub keeps its button in its own top bar, so the shell hides this one there.
  const launcher = launcherLabel ? makeElement('button', 'stamp-launcher is-hidden', launcherLabel) : null;
  const backdrop = makeElement('div', 'modal-backdrop is-hidden');
  const modal = makeElement('section', 'modal');
  const header = makeElement('div', 'modal-header');
  const title = makeElement('h2', '', strings.title);
  const closeButton = makeElement('button', '', strings.close);
  const grid = makeElement('div', 'stamp-grid');

  backdrop.setAttribute('role', 'dialog');
  backdrop.setAttribute('aria-modal', 'true');
  backdrop.setAttribute('aria-labelledby', 'stamp-book-title');
  title.id = 'stamp-book-title';
  closeButton.type = 'button';
  header.append(title, closeButton);
  modal.append(header, grid);
  backdrop.append(modal);
  if (launcher) {
    // A star, not the full label: game prompts already crowd the top-right corner.
    launcher.textContent = '★';
    launcher.setAttribute('aria-label', launcherLabel);
    launcher.title = launcherLabel;
    launcher.type = 'button';
    launcher.addEventListener('click', () => open());
    root.append(launcher);
  }
  root.append(backdrop);

  function render() {
    const state = progression.getState();
    grid.replaceChildren();
    for (const lesson of lessons) {
      const progress = stageProgressState(lesson.id, state.stamps);
      const earned = progress === 'earned';
      const stamp = makeElement('article', `stamp is-${progress}`);
      const mark = makeElement('div', 'stamp-mark', earned ? '★' : progress === 'locked' ? '🔒' : '○');
      const name = makeElement('div', 'stamp-name', lesson.name);
      const status = makeElement(
        'div',
        'stamp-status',
        earned
          ? `${strings.earned} ${formatUi(strings.stars, { count: state.bestStars[lesson.id] || 0 })}`
          : strings[progress],
      );
      stamp.append(mark, name, status);

      const photo = state.zooPhotos?.[lesson.id] || state.zooPhotos?.animal;
      if (lesson.id === 'zoo' && typeof photo === 'string' && photo.startsWith('data:image/')) {
        const image = makeElement('img', 'stamp-photo');
        image.src = photo;
        image.alt = strings.photo;
        stamp.append(image);
      }
      grid.append(stamp);
    }
  }

  function open() {
    render();
    backdrop.classList.remove('is-hidden');
    closeButton.focus();
  }

  function close() {
    backdrop.classList.add('is-hidden');
  }

  closeButton.addEventListener('click', close);
  backdrop.addEventListener('pointerdown', (event) => {
    if (event.target === backdrop) close();
  });
  const unregisterEscapeGuard = registerEscapeGuard?.(() => {
    if (backdrop.classList.contains('is-hidden')) return false;
    close();
    return true;
  }, { priority: SHELL_MODAL_ESCAPE_PRIORITY }) ?? (() => {});

  return {
    open,
    close,
    toggle() { backdrop.classList.contains('is-hidden') ? open() : close(); },
    isOpen() { return !backdrop.classList.contains('is-hidden'); },
    setLauncherVisible(visible) {
      if (!launcher) return;
      if (visible) launcher.classList.remove('is-hidden');
      else launcher.classList.add('is-hidden');
    },
    destroy() {
      unregisterEscapeGuard();
      launcher?.remove();
      backdrop.remove();
    },
  };
}
