import { SPEECH_STATE } from '../systems/speech.js';

const STYLE_ID = 'esl-likes-hud-styles';
const FALLBACK_AFTER_FAILURES = 2;

function installStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .lesson-hud { position: absolute; inset: 0; z-index: 20; pointer-events: none;
      display: flex; align-items: flex-end; justify-content: center; padding: 24px;
      box-sizing: border-box; font-family: system-ui, sans-serif; }
    .lesson-hud__talk, .lesson-hud__fallback { pointer-events: auto; border: 4px solid #fff;
      box-shadow: 0 6px 0 rgba(28,48,78,.3), 0 10px 26px rgba(28,48,78,.24);
      font: inherit; font-weight: 800; cursor: pointer; -webkit-tap-highlight-color: transparent; }
    .lesson-hud__talk { width: min(82vw, 360px); min-height: 84px; border-radius: 28px;
      padding: 14px 24px; background: #3a86ff; color: #fff; touch-action: none;
      display: flex; align-items: center; justify-content: center; gap: 14px;
      font-size: calc(1.25rem * var(--lesson-text-scale, 1)); position: relative; }
    .lesson-hud__talk:focus-visible, .lesson-hud__fallback:focus-visible {
      outline: 6px solid #ffcf33; outline-offset: 4px; }
    .lesson-hud__talk:disabled { cursor: default; opacity: .72; }
    .lesson-hud__talk-icon { font-size: 2rem; line-height: 1; }
    .lesson-hud__talk-key { border: 2px solid rgba(255,255,255,.8); border-radius: 7px;
      padding: 3px 7px; font-size: .7rem; line-height: 1; background: rgba(17,37,70,.2); }
    .lesson-hud__fallback-list { display: flex; flex-wrap: wrap; justify-content: center; gap: 12px; }
    .lesson-hud__fallback-list.is-choices { max-width: min(94vw, 760px); }
    .lesson-hud__fallback-list.is-choices .lesson-hud__fallback { width: auto; min-width: 0; flex: 0 1 auto;
      min-height: 68px; padding: 10px 18px; font-size: calc(1.2rem * var(--lesson-text-scale, 1)); }
    .lesson-hud__talk[data-state="listening"] { background: #e94f64; transform: translateY(3px);
      box-shadow: 0 3px 0 rgba(28,48,78,.3), 0 6px 18px rgba(28,48,78,.2); }
    .lesson-hud__talk[data-state="listening"]::after { content: ''; position: absolute; inset: -10px;
      border: 5px solid rgba(233,79,100,.75); border-radius: 36px; pointer-events: none;
      animation: lesson-talk-pulse 1.15s ease-out infinite; }
    @keyframes lesson-talk-pulse {
      0% { transform: scale(.96); opacity: .95; }
      70%, 100% { transform: scale(1.1); opacity: 0; }
    }
    @media (prefers-reduced-motion: reduce) {
      .lesson-hud__talk[data-state="listening"]::after { animation: none; opacity: .8; }
    }
    .lesson-hud__talk[data-state="detected"] { background: #ef8a17; }
    .lesson-hud__talk[data-state="accepted"] { background: #35a853; }
    .lesson-hud__talk[data-state="try-again"] { background: #b24ee8; }
    .lesson-hud__fallback-wrap { width: min(92vw, 760px); pointer-events: auto;
      display: flex; flex-direction: column; align-items: center; gap: 10px; }
    .lesson-hud__fallback { width: 100%; min-height: 110px; padding: 22px 24px;
      border-radius: 28px; background: #fff8dc; color: #24324a;
      display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: .34em;
      font-size: calc(clamp(1.65rem, 5vw, 3.2rem) * var(--lesson-text-scale, 1)); }
    .lesson-hud__fallback-word { border-radius: .3em; padding: .06em .12em;
      transition: background-color 120ms ease, color 120ms ease, transform 120ms ease; }
    .lesson-hud__fallback-word.is-active { background: #ffcf33; color: #17233a;
      transform: translateY(-3px); }
    .lesson-hud__fallback-hint { color: #fff; background: rgba(25,39,61,.82);
      border-radius: 999px; padding: 8px 16px; font-size: calc(1rem * var(--lesson-text-scale, 1));
      font-weight: 700; text-align: center; }
    @media (max-height: 520px) {
      .lesson-hud { padding: 12px; }
      .lesson-hud__talk { min-height: 70px; }
      .lesson-hud__fallback { min-height: 84px; padding: 14px 18px; }
    }
  `;
  document.head.append(style);
}

function labelForState(strings, state) {
  const labels = strings?.talkStates || strings || {};
  if (state === SPEECH_STATE.READY) return labels.ready || labels.micReady || '';
  if (state === SPEECH_STATE.LISTENING) return labels.listening || '';
  if (state === SPEECH_STATE.DETECTED) return labels.detected || labels.speechDetected || '';
  if (state === SPEECH_STATE.ACCEPTED) return labels.accepted || '';
  if (state === SPEECH_STATE.TRY_AGAIN) return labels.tryAgain || labels.try_again || '';
  return '';
}

function readTextSize(settings) {
  if (!settings) return 'normal';
  if (typeof settings.get === 'function') {
    const all = settings.get();
    if (all && typeof all === 'object') return all.textSize || 'normal';
    return settings.get('textSize') || 'normal';
  }
  return settings.textSize || settings.value?.textSize || 'normal';
}

/** DOM overlay for press-to-talk and the no-dead-end read-along fallback. */
export function createHud({ root = document.body, strings = {}, audio = null, settings = null } = {}) {
  installStyles();

  const element = document.createElement('section');
  element.className = 'lesson-hud';
  element.hidden = true;

  const talkButton = document.createElement('button');
  talkButton.className = 'lesson-hud__talk';
  talkButton.type = 'button';
  talkButton.dataset.state = SPEECH_STATE.READY;

  const talkIcon = document.createElement('span');
  talkIcon.className = 'lesson-hud__talk-icon';
  talkIcon.textContent = '\uD83C\uDFA4';
  talkIcon.setAttribute('aria-hidden', 'true');
  const talkLabel = document.createElement('span');
  talkLabel.className = 'lesson-hud__talk-label';
  const talkKey = document.createElement('kbd');
  talkKey.className = 'lesson-hud__talk-key';
  talkKey.textContent = 'Enter';
  talkButton.append(talkIcon, talkLabel, talkKey);

  const fallbackWrap = document.createElement('div');
  fallbackWrap.className = 'lesson-hud__fallback-wrap';
  fallbackWrap.hidden = true;
  const fallbackList = document.createElement('div');
  fallbackList.className = 'lesson-hud__fallback-list';
  const fallbackButton = createFallbackButton();
  fallbackList.append(fallbackButton);
  const fallbackHint = document.createElement('div');
  fallbackHint.className = 'lesson-hud__fallback-hint';
  const readAlongHint = strings.fallbackIntro || strings.fallbackHint || '';
  const chooseHint = strings.fallbackChoose || readAlongHint;
  fallbackHint.textContent = readAlongHint;
  fallbackHint.hidden = !fallbackHint.textContent;
  fallbackWrap.append(fallbackList, fallbackHint);
  element.append(talkButton, fallbackWrap);
  root.append(element);

  let failures = 0;
  let micFree = Boolean(typeof settings?.get === 'function'
    ? settings.get('micFree')
    : settings?.micFree);
  let targetSentence = '';
  let onFallbackContinue = null;
  let choices = [];
  let activeButton = fallbackButton;
  let activeSentence = '';
  let animationTimers = [];
  let fallbackRunning = false;

  function clearAnimation() {
    for (const timer of animationTimers) clearTimeout(timer);
    animationTimers = [];
    fallbackRunning = false;
    setFallbackDisabled(false);
    highlightWord(-1);
  }

  function setFallbackDisabled(disabled) {
    for (const button of fallbackList.children) button.disabled = disabled;
  }

  function createFallbackButton() {
    const button = document.createElement('button');
    button.className = 'lesson-hud__fallback';
    button.type = 'button';
    button.addEventListener('click', () => playReadAlong(button));
    return button;
  }

  // One read-along button per sentence. A plain prompt has a single sentence;
  // a turnaround ("I like ___.") offers one per answer, so a child without a
  // working microphone still chooses their own answer instead of being handed
  // the first one on the list.
  function sentences() {
    if (choices.length) return choices;
    return targetSentence ? [{ sentence: targetSentence, value: undefined }] : [];
  }

  function renderWords() {
    const entries = sentences();
    while (fallbackList.children.length > Math.max(1, entries.length)) fallbackList.lastElementChild.remove();
    while (fallbackList.children.length < entries.length) fallbackList.append(createFallbackButton());
    if (!entries.length) fallbackButton.replaceChildren();
    entries.forEach((entry, index) => {
      const button = fallbackList.children[index];
      button.replaceChildren();
      for (const word of entry.sentence.trim().split(/\s+/).filter(Boolean)) {
        const span = document.createElement('span');
        span.className = 'lesson-hud__fallback-word';
        span.textContent = word;
        button.append(span);
      }
      button.setAttribute('aria-label', entry.sentence);
      if (entry.value === undefined) delete button.dataset.value;
      else button.dataset.value = entry.value;
    });
    fallbackList.classList.toggle('is-choices', choices.length > 0);
    fallbackHint.textContent = choices.length ? chooseHint : readAlongHint;
    fallbackHint.hidden = !fallbackHint.textContent;
  }

  function setTalkState(nextState) {
    talkButton.dataset.state = nextState;
    const label = labelForState(strings, nextState);
    talkLabel.textContent = label;
    talkKey.hidden = nextState !== SPEECH_STATE.READY;
    talkButton.setAttribute('aria-label', label);
  }

  function showFallback() {
    if (!sentences().length) return;
    talkButton.disabled = true;
    talkButton.hidden = true;
    fallbackWrap.hidden = false;
    element.hidden = false;
  }

  function showTalk() {
    fallbackWrap.hidden = true;
    talkButton.hidden = false;
    talkButton.disabled = false;
    element.hidden = false;
  }

  function highlightWord(index) {
    const words = activeButton.children;
    for (let i = 0; i < words.length; i += 1) {
      words[i].classList.toggle('is-active', i === index);
    }
  }

  function speakTarget() {
    const indexFromBoundary = (value, detail) => {
      const boundary = value && typeof value === 'object' ? value : detail;
      if (Number.isInteger(boundary?.wordIndex)) return boundary.wordIndex;
      if (Number.isInteger(boundary?.charIndex)) {
        const prefix = activeSentence.slice(0, boundary.charIndex).trim();
        return prefix ? prefix.split(/\s+/).length : 0;
      }
      return Number.isInteger(value) ? value : -1;
    };
    const callbacks = {
      onWord: (value, detail) => highlightWord(indexFromBoundary(value, detail)),
      onBoundary: (value, detail) => highlightWord(indexFromBoundary(value, detail)),
    };
    try {
      if (typeof audio?.speakTarget === 'function') audio.speakTarget(activeSentence, callbacks);
      else if (typeof audio?.speak === 'function') audio.speak(activeSentence, callbacks);
      else if (typeof audio?.say === 'function') audio.say(activeSentence, callbacks);
    } catch { /* audio is optional and must never block the route forward */ }
  }

  function playReadAlong(button = fallbackButton) {
    if (fallbackRunning) return;
    clearAnimation();
    const entry = sentences()[[...fallbackList.children].indexOf(button)];
    if (!entry) return;
    activeButton = button;
    activeSentence = entry.sentence;
    fallbackRunning = true;
    setFallbackDisabled(true);
    const words = [...button.children];
    speakTarget();

    let elapsed = 0;
    words.forEach((word, index) => {
      animationTimers.push(setTimeout(() => highlightWord(index), elapsed));
      elapsed += Math.min(650, Math.max(300, word.textContent.length * 80));
    });
    animationTimers.push(setTimeout(() => {
      highlightWord(-1);
      fallbackRunning = false;
      setFallbackDisabled(false);
      const callback = onFallbackContinue;
      if (callback) callback(entry.value);
    }, elapsed + 120));
  }

  setTalkState(SPEECH_STATE.READY);

  const api = {
    element,
    talkButton,
    fallbackButton,
    setTalkState,
    configureTalk(options = {}) {
      clearAnimation();
      failures = 0;
      targetSentence = options.targetSentence || '';
      onFallbackContinue = options.onFallbackContinue || null;
      choices = Array.isArray(options.choices) ? options.choices.filter((choice) => choice?.sentence) : [];
      micFree = options.micFree ?? micFree;
      renderWords();
      setTalkState(SPEECH_STATE.READY);
      showTalk();
    },
    recordFailure() {
      failures += 1;
      setTalkState(SPEECH_STATE.TRY_AGAIN);
      if (failures >= FALLBACK_AFTER_FAILURES) showFallback();
      return failures;
    },
    resetFailures() {
      failures = 0;
      setTalkState(SPEECH_STATE.READY);
      if (!micFree) showTalk();
    },
    setMicFree(nextMicFree) {
      micFree = Boolean(nextMicFree);
      if (failures < FALLBACK_AFTER_FAILURES) showTalk();
    },
    setTextSize(size) {
      const scale = size === 'extraLarge' ? 1.3 : size === 'large' ? 1.15 : 1;
      element.style.setProperty('--lesson-text-scale', String(scale));
    },
    show() {
      if (failures >= FALLBACK_AFTER_FAILURES) showFallback();
      else showTalk();
    },
    showFallback,
    hide() {
      clearAnimation();
      talkButton.disabled = true;
      element.hidden = true;
    },
    dispose() {
      clearAnimation();
      fallbackButton.removeEventListener('click', playReadAlong);
      element.remove();
    },
    get failureCount() { return failures; },
    get isFallbackVisible() { return !fallbackWrap.hidden; },
  };

  api.setTextSize(readTextSize(settings));
  const unsubscribeSettings = typeof settings?.subscribe === 'function'
    ? settings.subscribe((next) => {
      api.setMicFree(next.micFree);
      api.setTextSize(next.textSize);
    })
    : null;
  const originalDispose = api.dispose;
  api.dispose = () => {
    unsubscribeSettings?.();
    originalDispose();
  };
  return api;
}
