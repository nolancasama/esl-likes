import { Vector3 } from 'three';

const STYLE_ID = 'esl-likes-dialogue-styles';
const EDGE_MARGIN = 16;

function installStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    /* width: max-content, or a bubble anchored near the right edge shrinks to the
       space left of its anchor and wraps into a narrow column before it is clamped. */
    .npc-dialogue { position: absolute; z-index: 18; width: max-content; max-width: min(78vw, 520px);
      min-width: 180px; transform: translate(-50%, -100%); pointer-events: auto;
      box-sizing: border-box; padding: 16px 58px 16px 20px; border: 4px solid #273858;
      border-radius: 24px; background: #fff; color: #1b2940;
      box-shadow: 0 7px 0 rgba(28,48,78,.25), 0 12px 30px rgba(28,48,78,.2);
      font-family: system-ui, sans-serif; font-size: calc(clamp(1.45rem, 4vw, 2.35rem)
        * var(--lesson-text-scale, 1)); font-weight: 800; line-height: 1.22; text-align: center; }
    .npc-dialogue::after { content: ''; position: absolute; left: 50%; bottom: -18px;
      width: 26px; height: 26px; background: #fff; border-right: 4px solid #273858;
      border-bottom: 4px solid #273858; transform: translateX(-50%) rotate(45deg); }
    .npc-dialogue__line { overflow-wrap: anywhere; word-break: keep-all; text-wrap: balance; }
    .npc-dialogue__replay { position: absolute; top: 50%; right: 10px; transform: translateY(-50%);
      width: 44px; height: 44px; border: 0; border-radius: 50%; background: #3a86ff;
      color: #fff; font: 900 1.6rem/1 system-ui, sans-serif; cursor: pointer;
      display: grid; place-items: center; }
    .npc-dialogue__replay:focus-visible { outline: 5px solid #ffcf33; outline-offset: 3px; }
    @media (max-width: 420px) {
      .npc-dialogue { padding: 14px 52px 14px 16px; min-width: 160px; }
      .npc-dialogue__replay { width: 40px; height: 40px; right: 8px; }
    }
  `;
  document.head.append(style);
}

function speak(audio, text) {
  if (!text) return;
  try {
    if (typeof audio?.speakNpc === 'function') audio.speakNpc(text);
    else if (typeof audio?.speak === 'function') audio.speak(text);
    else if (typeof audio?.say === 'function') audio.say(text);
  } catch { /* speech synthesis is optional and never blocks dialogue */ }
}

/**
 * Creates a single reusable speech bubble projected from a world-space anchor.
 * `anchor` may be an Object3D, Vector3-like value, or a function returning one.
 */
export function createDialogue({
  root = document.body,
  camera = null,
  audio = null,
  strings = {},
  textScale = 1,
} = {}) {
  installStyles();

  const element = document.createElement('aside');
  element.className = 'npc-dialogue';
  element.hidden = true;
  element.setAttribute('role', 'dialog');
  element.setAttribute('aria-live', 'polite');
  element.style.setProperty('--lesson-text-scale', String(textScale));

  const line = document.createElement('div');
  line.className = 'npc-dialogue__line';
  const replayButton = document.createElement('button');
  replayButton.className = 'npc-dialogue__replay';
  replayButton.type = 'button';
  replayButton.textContent = '\u21BB';
  const replayLabel = strings.replay || strings.replaySpeech || '';
  replayButton.setAttribute('aria-label', replayLabel);
  replayButton.title = replayLabel;
  element.append(line, replayButton);
  root.append(element);

  const worldPosition = new Vector3();
  let activeCamera = camera;
  let anchor = null;
  let offsetY = 1.8;
  let currentText = '';
  let onReplay = null;

  function resolveAnchor() {
    let value = typeof anchor === 'function' ? anchor() : anchor;
    if (!value) return false;

    if (typeof value.getWorldPosition === 'function') {
      value.getWorldPosition(worldPosition);
    } else if (Array.isArray(value)) {
      worldPosition.set(value[0] || 0, value[1] || 0, value[2] || 0);
    } else if (value.position && typeof value.position.x === 'number') {
      worldPosition.copy(value.position);
    } else if (typeof value.x === 'number') {
      worldPosition.copy(value);
    } else {
      return false;
    }
    worldPosition.y += offsetY;
    return true;
  }

  function replay() {
    if (onReplay) onReplay(currentText);
    else speak(audio, currentText);
  }

  function update() {
    if (element.hidden || !activeCamera || !resolveAnchor()) return;

    worldPosition.project(activeCamera);
    if (worldPosition.z < -1 || worldPosition.z > 1) {
      element.style.visibility = 'hidden';
      return;
    }

    const viewportWidth = root.clientWidth || window.innerWidth;
    const viewportHeight = root.clientHeight || window.innerHeight;
    const bubbleWidth = element.offsetWidth;
    const bubbleHeight = element.offsetHeight;
    const projectedX = (worldPosition.x * 0.5 + 0.5) * viewportWidth;
    const projectedY = (-worldPosition.y * 0.5 + 0.5) * viewportHeight;
    const minX = EDGE_MARGIN + bubbleWidth * 0.5;
    const maxX = viewportWidth - EDGE_MARGIN - bubbleWidth * 0.5;
    const minY = EDGE_MARGIN + bubbleHeight;
    const maxY = viewportHeight - EDGE_MARGIN;
    const x = maxX < minX ? viewportWidth * 0.5 : Math.min(maxX, Math.max(minX, projectedX));
    const y = maxY < minY ? viewportHeight * 0.5 : Math.min(maxY, Math.max(minY, projectedY));

    element.style.left = `${x}px`;
    element.style.top = `${y}px`;
    element.style.visibility = 'visible';
  }

  replayButton.addEventListener('click', replay);

  return {
    element,
    replayButton,
    show(options, legacyAnchor) {
      const config = typeof options === 'string'
        ? { text: options, anchor: legacyAnchor }
        : (options || {});
      currentText = config.text || '';
      anchor = config.anchor || null;
      offsetY = Number.isFinite(config.offsetY) ? config.offsetY : 1.8;
      onReplay = config.onReplay || null;
      line.textContent = currentText;
      element.hidden = false;
      element.style.visibility = 'hidden';
      update();
      if (config.speak !== false) replay();
    },
    hide() {
      element.hidden = true;
      anchor = null;
      onReplay = null;
    },
    update,
    setCamera(nextCamera) {
      activeCamera = nextCamera;
    },
    setTextScale(scale) {
      element.style.setProperty('--lesson-text-scale', String(scale || 1));
    },
    dispose() {
      replayButton.removeEventListener('click', replay);
      element.remove();
      anchor = null;
      onReplay = null;
    },
  };
}
