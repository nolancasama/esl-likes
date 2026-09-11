import { UI } from '../config/lesson.js';

const TEXT_SIZE_VALUES = ['normal', 'large', 'extraLarge'];
const TEXT_SIZE_SCALES = [1, 1.15, 1.3];

export function createSettings({ root, progression }) {
  if (!root || !progression) {
    throw new TypeError('createSettings requires root and progression');
  }

  const labels = UI.settings;
  const listeners = new Set();
  let open = false;
  let previousSettings = '';

  const launcher = document.createElement('button');
  launcher.type = 'button';
  launcher.className = 'settings-launcher';
  launcher.textContent = labels.open;

  const backdrop = document.createElement('div');
  backdrop.className = 'settings-backdrop';
  backdrop.hidden = true;
  backdrop.innerHTML = `
    <section class="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <header class="settings-header">
        <h2 id="settings-title"></h2>
        <button class="settings-close" type="button"></button>
      </header>
      <label class="settings-row">
        <span class="settings-volume-label"></span>
        <input class="settings-volume" type="range" min="0" max="1" step="0.05">
        <output class="settings-volume-value"></output>
      </label>
      <label class="settings-row settings-check-row">
        <input class="settings-mic-free" type="checkbox">
        <span class="settings-mic-free-label"></span>
      </label>
      <p class="settings-hint"></p>
      <label class="settings-row">
        <span class="settings-difficulty-label"></span>
        <select class="settings-difficulty"></select>
      </label>
      <label class="settings-row">
        <span class="settings-text-size-label"></span>
        <select class="settings-text-size"></select>
      </label>
    </section>
  `;

  const style = document.createElement('style');
  style.textContent = `
    .settings-launcher { position: absolute; top: 1rem; right: 1rem; min-width: 7rem; min-height: 3rem; z-index: 40; pointer-events: auto; }
    .settings-backdrop { position: absolute; inset: 0; z-index: 50; display: grid; place-items: center; padding: 1rem; background: rgb(16 30 50 / .58); pointer-events: auto; }
    .settings-backdrop[hidden] { display: none; }
    .settings-panel { width: min(32rem, 100%); box-sizing: border-box; padding: 1.25rem; border: .25rem solid #30445d; border-radius: 1.25rem; background: #fff9df; color: #26384d; font-size: calc(1rem * var(--ui-text-scale, 1.15)); box-shadow: 0 .6rem 0 rgb(21 38 57 / .28); }
    .settings-header { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
    .settings-header h2 { margin: 0; font-size: 1.55em; }
    .settings-close, .settings-panel select, .settings-panel input { min-height: 2.75rem; font: inherit; }
    .settings-close { min-width: 5rem; }
    .settings-row { display: grid; grid-template-columns: minmax(7rem, 1fr) minmax(8rem, 1.4fr) auto; align-items: center; gap: .75rem; margin-top: 1.1rem; font-weight: 700; }
    .settings-check-row { grid-template-columns: 2.75rem 1fr; }
    .settings-check-row input { width: 2rem; }
    .settings-hint { margin: .35rem 0 0 3.5rem; font-size: .82em; font-weight: 500; }
    @media (max-width: 32rem) { .settings-row { grid-template-columns: 1fr; } .settings-check-row { grid-template-columns: 2.75rem 1fr; } .settings-hint { margin-left: 0; } }
  `;

  const panel = backdrop.querySelector('.settings-panel');
  const closeButton = backdrop.querySelector('.settings-close');
  const volume = backdrop.querySelector('.settings-volume');
  const volumeValue = backdrop.querySelector('.settings-volume-value');
  const micFree = backdrop.querySelector('.settings-mic-free');
  const difficulty = backdrop.querySelector('.settings-difficulty');
  const textSize = backdrop.querySelector('.settings-text-size');

  backdrop.querySelector('#settings-title').textContent = labels.title;
  closeButton.textContent = labels.close;
  backdrop.querySelector('.settings-volume-label').textContent = labels.volume;
  backdrop.querySelector('.settings-mic-free-label').textContent = labels.micFree;
  backdrop.querySelector('.settings-hint').textContent = labels.micFreeHint;
  backdrop.querySelector('.settings-difficulty-label').textContent = labels.difficulty;
  backdrop.querySelector('.settings-text-size-label').textContent = labels.textSize;

  labels.difficultyLevels.forEach((text, index) => {
    difficulty.add(new Option(text, String(index + 1)));
  });
  labels.textSizes.forEach((text, index) => {
    textSize.add(new Option(text, TEXT_SIZE_VALUES[index]));
  });

  root.append(style, launcher, backdrop);

  function get(key) {
    const current = progression.getSettings();
    return key === undefined ? current : current[key];
  }

  function apply(settings, notify = false) {
    volume.value = String(settings.volume);
    volumeValue.value = `${Math.round(settings.volume * 100)}%`;
    micFree.checked = settings.micFree;
    difficulty.value = String(settings.difficulty);
    textSize.value = settings.textSize;
    const textIndex = Math.max(0, TEXT_SIZE_VALUES.indexOf(settings.textSize));
    document.documentElement.style.setProperty('--ui-text-scale', String(TEXT_SIZE_SCALES[textIndex]));

    const serialized = JSON.stringify(settings);
    if (notify && serialized !== previousSettings) {
      for (const listener of listeners) listener({ ...settings });
    }
    previousSettings = serialized;
  }

  function update(patch) {
    apply(progression.updateSettings(patch), true);
  }

  function show() {
    if (open) return;
    open = true;
    backdrop.hidden = false;
    closeButton.focus();
  }

  function hide() {
    if (!open) return;
    open = false;
    backdrop.hidden = true;
    launcher.focus();
  }

  function toggle() {
    if (open) hide();
    else show();
  }

  launcher.addEventListener('click', show);
  closeButton.addEventListener('click', hide);
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) hide();
  });
  volume.addEventListener('input', () => update({ volume: Number(volume.value) }));
  micFree.addEventListener('change', () => update({ micFree: micFree.checked }));
  difficulty.addEventListener('change', () => update({ difficulty: Number(difficulty.value) }));
  textSize.addEventListener('change', () => update({ textSize: textSize.value }));

  const onKeyDown = (event) => {
    if (open && event.key === 'Escape') hide();
  };
  window.addEventListener('keydown', onKeyDown);

  const unsubscribeProgression = progression.subscribe((state) => apply(state.settings, true));
  apply(get());

  return {
    get,
    open: show,
    close: hide,
    toggle,
    subscribe(listener) {
      if (typeof listener !== 'function') return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    destroy() {
      unsubscribeProgression();
      window.removeEventListener('keydown', onKeyDown);
      launcher.remove();
      backdrop.remove();
      style.remove();
      listeners.clear();
    },
    element: panel,
  };
}
