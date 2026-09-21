/**
 * The editor panel.
 *
 * Plain DOM with its own scoped stylesheet, built on the first `mount()` and
 * removed entirely on `unmount()` — nothing of it is left in the document while
 * the editor is closed, because the host here ships to low-end classroom
 * Chromebooks and a dev tool has no business costing a student a frame.
 *
 * It knows nothing about three.js. Everything it can do is a callback in
 * `handlers`, and everything it shows is pushed in through the setters, so the
 * panel and the gizmo cannot drift apart.
 */

const CSS = `
.sed { position: absolute; top: 0; right: 0; bottom: 0; width: 310px; z-index: 40;
  display: flex; flex-direction: column; gap: 0; overflow-y: auto;
  background: #10151c; color: #e8eef5; font: 12px/1.45 ui-monospace, Menlo, Consolas, monospace;
  border-left: 1px solid #2b3644; box-shadow: -8px 0 24px rgba(0,0,0,.35); pointer-events: auto; }
.sed * { box-sizing: border-box; }
.sed__bar { display: flex; align-items: center; justify-content: space-between; gap: 6px;
  padding: 8px 10px; background: #18202b; border-bottom: 1px solid #2b3644; position: sticky; top: 0; z-index: 2; }
.sed__title { font-weight: 700; letter-spacing: .06em; text-transform: uppercase; font-size: 11px; color: #8fd3ff; }
.sed__section { padding: 9px 10px; border-bottom: 1px solid #222c38; }
.sed__h { font-size: 10px; letter-spacing: .09em; text-transform: uppercase; color: #7f8fa3; margin: 0 0 6px; }
.sed__row { display: flex; gap: 5px; align-items: center; flex-wrap: wrap; }
.sed__row + .sed__row { margin-top: 5px; }
.sed button { font: inherit; color: #e8eef5; background: #24303e; border: 1px solid #36465a;
  border-radius: 4px; padding: 4px 7px; cursor: pointer; }
.sed button:hover:not(:disabled) { background: #2f3f52; }
.sed button:disabled { opacity: .38; cursor: default; }
.sed button.is-on { background: #1d6fb8; border-color: #3f9ae0; }
.sed input[type="text"], .sed input[type="number"], .sed select, .sed textarea {
  font: inherit; color: #e8eef5; background: #0b0f14; border: 1px solid #36465a;
  border-radius: 4px; padding: 3px 5px; width: 100%; }
.sed input[type="number"] { -moz-appearance: textfield; }
.sed label { display: flex; align-items: center; gap: 5px; cursor: pointer; }
.sed__grid { display: grid; grid-template-columns: 14px 1fr 1fr 1fr; gap: 4px; align-items: center; }
.sed__grid span { color: #7f8fa3; font-size: 10px; }
.sed__palette { max-height: 230px; overflow-y: auto; display: flex; flex-direction: column; gap: 3px; }
.sed__asset { display: flex; justify-content: space-between; gap: 6px; text-align: left; }
.sed__asset small { color: #7f8fa3; }
.sed__list { display: flex; flex-direction: column; gap: 3px; }
.sed__status { padding: 7px 10px; font-size: 11px; min-height: 30px; border-bottom: 1px solid #222c38; color: #9fb0c4; }
.sed__status[data-tone="error"] { color: #ff9b8f; background: #2a1618; }
.sed__status[data-tone="ok"] { color: #a8e6a0; }
.sed__id { color: #ffd400; word-break: break-all; }
.sed__keys { color: #67788d; font-size: 10px; line-height: 1.5; }
.sed__empty { color: #67788d; font-style: italic; }
`;

const AXES = ['x', 'y', 'z'];
const TRANSLATION_SNAPS = [['off', 0], ['0.1', 0.1], ['0.25', 0.25], ['0.5', 0.5], ['1.0', 1]];
const ROTATION_SNAPS = [['off', 0], ['5°', 5], ['15°', 15], ['45°', 45], ['90°', 90]];

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

export function createEditorUI({ root, categories = [], assets = [], pointGroups = [], helpers = [], handlers = {} }) {
  let style = null;
  let panel = null;
  let mounted = false;

  const fields = { position: {}, rotation: {}, scale: {} };
  let statusNode = null;
  let idNode = null;
  let undoButton = null;
  let redoButton = null;
  let uniformBox = null;
  let lockBox = null;
  let filterInput = null;
  let paletteNode = null;
  let selectionSection = null;
  let placementNode = null;
  let pointSection = null;
  let pointAddButton = null;
  const assetButtons = new Map();
  const pointButtons = new Map();
  let activeAsset = null;
  let activePointGroup = null;

  const call = (name, ...args) => handlers[name]?.(...args);

  function buildTransformGrid() {
    const section = el('div', 'sed__section');
    section.append(el('p', 'sed__h', 'Transform'));
    const grid = el('div', 'sed__grid');
    const rows = [
      ['position', 'P', 0.1],
      ['rotation', 'R', 1],
      ['scale', 'S', 0.05],
    ];
    for (const [kind, label, step] of rows) {
      grid.append(el('span', null, label));
      for (const axis of AXES) {
        const input = el('input');
        input.type = 'number';
        input.step = String(step);
        input.title = `${kind} ${axis}${kind === 'rotation' ? ' (degrees)' : ''}`;
        input.addEventListener('change', () => {
          const value = Number(input.value);
          if (Number.isFinite(value)) call('onTransformField', kind, axis, value);
        });
        // Enter commits and hands the keyboard back. Without this the field
        // keeps focus, and every editor shortcut — delete, duplicate, undo —
        // silently does nothing because the editor sees a typing target.
        input.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') input.blur();
        });
        fields[kind][axis] = input;
        grid.append(input);
      }
    }
    section.append(grid);

    const uniformRow = el('div', 'sed__row');
    uniformBox = el('input');
    uniformBox.type = 'checkbox';
    uniformBox.checked = true;
    uniformBox.addEventListener('change', () => call('onUniformChange', uniformBox.checked));
    const uniformLabel = el('label');
    uniformLabel.append(uniformBox, el('span', null, 'uniform scale'));

    lockBox = el('input');
    lockBox.type = 'checkbox';
    lockBox.addEventListener('change', () => call('onToggleLock', lockBox.checked));
    const lockLabel = el('label');
    lockLabel.append(lockBox, el('span', null, 'locked'));
    uniformRow.append(uniformLabel, lockLabel);
    section.append(uniformRow);

    const actions = el('div', 'sed__row');
    const make = (text, title, name) => {
      const button = el('button', null, text);
      button.title = title;
      button.addEventListener('click', () => call(name));
      return button;
    };
    actions.append(
      make('Ground', 'Drop to ground (G)', 'onSnapToGround'),
      make('Duplicate', 'Ctrl+D', 'onDuplicate'),
      make('Delete', 'Del', 'onDelete'),
      make('Copy placement', 'Copy as a code snippet', 'onCopyPlacement'),
    );
    section.append(actions);
    return section;
  }

  function buildPalette() {
    const section = el('div', 'sed__section');
    section.append(el('p', 'sed__h', 'Assets'));
    filterInput = el('input');
    filterInput.type = 'text';
    filterInput.placeholder = 'filter…';
    filterInput.addEventListener('input', () => applyFilter(filterInput.value));
    section.append(filterInput);

    placementNode = el('p', 'sed__keys', '');
    section.append(placementNode);

    paletteNode = el('div', 'sed__palette');
    const byCategory = new Map(categories.map((category) => [category.id, category.name]));
    for (const asset of assets) {
      const button = el('button', 'sed__asset');
      button.append(el('span', null, asset.name), el('small', null, byCategory.get(asset.category) ?? asset.category));
      button.dataset.search = `${asset.name} ${asset.id} ${asset.category}`.toLowerCase();
      button.addEventListener('click', () => {
        const next = activeAsset === asset.id ? null : asset.id;
        call(next ? 'onSelectAsset' : 'onCancelPlacement', next);
      });
      assetButtons.set(asset.id, button);
      paletteNode.append(button);
    }
    if (!assets.length) paletteNode.append(el('p', 'sed__empty', 'The adapter exposes no assets.'));
    section.append(paletteNode);
    return section;
  }

  function applyFilter(text) {
    const needle = text.trim().toLowerCase();
    for (const button of assetButtons.values()) {
      button.hidden = Boolean(needle) && !button.dataset.search.includes(needle);
    }
  }

  function buildVisibility() {
    const section = el('div', 'sed__section');
    section.append(el('p', 'sed__h', 'Show'));
    const list = el('div', 'sed__list');
    for (const category of categories) {
      const box = el('input');
      box.type = 'checkbox';
      box.checked = true;
      box.addEventListener('change', () => call('onCategoryVisibility', category.id, box.checked));
      const label = el('label');
      label.append(box, el('span', null, category.name));
      list.append(label);
    }
    for (const helper of helpers) {
      const box = el('input');
      box.type = 'checkbox';
      box.addEventListener('change', () => call('onHelperToggle', helper.id, box.checked));
      const label = el('label');
      label.append(box, el('span', null, helper.name));
      list.append(label);
    }
    if (!categories.length && !helpers.length) list.append(el('p', 'sed__empty', 'Nothing to toggle.'));
    section.append(list);
    return section;
  }

  function buildSnapping() {
    const section = el('div', 'sed__section');
    section.append(el('p', 'sed__h', 'Snap'));
    const row = el('div', 'sed__row');
    const build = (options, name, title) => {
      const select = el('select');
      select.title = title;
      for (const [label, value] of options) {
        const option = el('option', null, label);
        option.value = String(value);
        select.append(option);
      }
      select.addEventListener('change', () => call(name, Number(select.value)));
      const wrap = el('div');
      wrap.style.flex = '1';
      wrap.append(el('div', 'sed__keys', title), select);
      return wrap;
    };
    row.append(
      build(TRANSLATION_SNAPS, 'onSnapTranslation', 'move'),
      build(ROTATION_SNAPS, 'onSnapRotation', 'rotate'),
    );
    section.append(row);
    return section;
  }

  function buildPoints() {
    if (!pointGroups.length) return null;
    const section = el('div', 'sed__section');
    section.append(el('p', 'sed__h', 'Points'));
    const list = el('div', 'sed__list');
    for (const group of pointGroups) {
      const button = el('button', null, group.name);
      button.addEventListener('click', () => {
        const next = activePointGroup === group.id ? null : group.id;
        call('onPointGroup', next);
      });
      pointButtons.set(group.id, button);
      list.append(button);
    }
    section.append(list);

    const row = el('div', 'sed__row');
    pointAddButton = el('button', null, 'Add mode');
    pointAddButton.title = 'Click the ground to append a point';
    pointAddButton.addEventListener('click', () => call('onPointAddMode'));
    const exportButton = el('button', null, 'Copy points');
    exportButton.addEventListener('click', () => call('onPointsExport'));
    row.append(pointAddButton, exportButton);
    section.append(row);
    return section;
  }

  function buildLayoutIO() {
    const section = el('div', 'sed__section');
    section.append(el('p', 'sed__h', 'Layout'));
    const row = el('div', 'sed__row');
    const make = (text, name) => {
      const button = el('button', null, text);
      button.addEventListener('click', () => call(name));
      return button;
    };
    const importButton = el('button', null, 'Import');
    const picker = el('input');
    picker.type = 'file';
    picker.accept = 'application/json,.json';
    picker.hidden = true;
    picker.addEventListener('change', async () => {
      const file = picker.files?.[0];
      picker.value = '';
      if (file) call('onImport', await file.text(), file.name);
    });
    importButton.addEventListener('click', () => picker.click());

    const pasteButton = el('button', null, 'Paste');
    pasteButton.title = 'Paste layout JSON';
    pasteButton.addEventListener('click', () => {
      const text = window.prompt('Paste layout JSON');
      if (text) call('onImport', text, 'pasted');
    });

    row.append(
      make('Download', 'onExport'),
      make('Copy JSON', 'onCopyJSON'),
      importButton,
      pasteButton,
      make('Reset', 'onReset'),
      picker,
    );
    section.append(row);
    return section;
  }

  function buildKeys() {
    const section = el('div', 'sed__section');
    section.append(el('p', 'sed__h', 'Keys'));
    section.append(el('p', 'sed__keys',
      'P close · W move · E rotate · R scale · X world/local · F frame\n'
      + 'Ctrl+D duplicate · Del delete · G ground · Ctrl+Z / Ctrl+Shift+Z undo\n'
      + 'arrows nudge (Shift ×4) · PgUp/PgDn height · , . yaw · Esc deselect\n'
      + 'drag left orbit · right pan · wheel zoom'));
    return section;
  }

  function build() {
    style = el('style');
    style.textContent = CSS;

    panel = el('aside', 'sed');
    panel.setAttribute('aria-label', 'Scene placement editor');

    const bar = el('div', 'sed__bar');
    bar.append(el('span', 'sed__title', 'Scene editor'));
    const historyRow = el('div', 'sed__row');
    undoButton = el('button', null, '⟲');
    undoButton.title = 'Undo (Ctrl+Z)';
    undoButton.addEventListener('click', () => call('onUndo'));
    redoButton = el('button', null, '⟳');
    redoButton.title = 'Redo (Ctrl+Shift+Z)';
    redoButton.addEventListener('click', () => call('onRedo'));
    const closeButton = el('button', null, '✕');
    closeButton.title = 'Close the editor (P)';
    closeButton.addEventListener('click', () => call('onClose'));
    historyRow.append(undoButton, redoButton, closeButton);
    bar.append(historyRow);

    statusNode = el('div', 'sed__status', 'Click an object to select it.');
    idNode = el('p', 'sed__id', '—');

    selectionSection = el('div');
    const selectionHeader = el('div', 'sed__section');
    selectionHeader.append(el('p', 'sed__h', 'Selection'), idNode);
    selectionSection.append(selectionHeader, buildTransformGrid());

    panel.append(bar, statusNode, buildPalette(), selectionSection, buildSnapping(), buildVisibility());
    const points = buildPoints();
    if (points) panel.append(points);
    panel.append(buildLayoutIO(), buildKeys());

    // Typing in a field must not also drive the editor's shortcuts.
    panel.addEventListener('keydown', (event) => event.stopPropagation());
  }

  const api = {
    mount() {
      if (mounted) return;
      if (!panel) build();
      document.head.append(style);
      root.append(panel);
      mounted = true;
    },

    unmount() {
      if (!mounted) return;
      panel.remove();
      style.remove();
      mounted = false;
    },

    get mounted() { return mounted; },

    setStatus(message, tone = 'info') {
      if (!statusNode) return;
      statusNode.textContent = message;
      statusNode.dataset.tone = tone;
    },

    setSelection(info) {
      if (!idNode) return;
      idNode.textContent = info ? `${info.id}  ·  ${info.assetId}` : '—';
      if (lockBox) {
        lockBox.checked = Boolean(info?.locked);
        lockBox.disabled = !info;
      }
      const disabled = !info;
      for (const kind of Object.keys(fields)) {
        for (const axis of AXES) fields[kind][axis].disabled = disabled;
      }
      if (disabled) {
        for (const kind of Object.keys(fields)) {
          for (const axis of AXES) fields[kind][axis].value = '';
        }
      }
    },

    /** `{ position, rotation (degrees), scale }` as plain triples. */
    setTransform(transform) {
      if (!transform) return;
      const write = (kind, values) => {
        AXES.forEach((axis, index) => {
          const input = fields[kind][axis];
          if (document.activeElement === input) return;
          input.value = String(Math.round(values[index] * 1e4) / 1e4);
        });
      };
      write('position', transform.position);
      write('rotation', transform.rotation);
      write('scale', transform.scale);
    },

    setUniform(value) {
      if (uniformBox) uniformBox.checked = value;
    },

    setHistory(state) {
      if (undoButton) undoButton.disabled = !state.canUndo;
      if (redoButton) redoButton.disabled = !state.canRedo;
    },

    setPlacement(assetId) {
      activeAsset = assetId;
      for (const [id, button] of assetButtons) button.classList.toggle('is-on', id === assetId);
      if (placementNode) {
        placementNode.textContent = assetId
          ? `Placing "${assetId}" — click the ground. Esc cancels.`
          : '';
      }
    },

    setPointGroup(groupId) {
      activePointGroup = groupId;
      for (const [id, button] of pointButtons) button.classList.toggle('is-on', id === groupId);
    },

    setPointAddMode(active) {
      pointAddButton?.classList.toggle('is-on', Boolean(active));
    },

    dispose() {
      api.unmount();
      assetButtons.clear();
      pointButtons.clear();
      panel = null;
      style = null;
    },
  };
  return api;
}
