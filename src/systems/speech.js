import { matchAnswer, matchBest, matchQuestion } from './speechMatch.js';

const MAX_ALTERNATIVES = 5;
const MAX_SESSION_MS = 8000;
const FINISH_GRACE_MS = 400;

export const MIC = Object.freeze({
  IDLE: 'idle',
  LISTENING: 'listening',
  DENIED: 'denied',
  UNSUPPORTED: 'unsupported',
  ERROR: 'error',
});

export const SPEECH_STATE = Object.freeze({
  READY: 'ready',
  LISTENING: 'listening',
  DETECTED: 'detected',
  ACCEPTED: 'accepted',
  TRY_AGAIN: 'try-again',
});

export function speechSupported() {
  return typeof window !== 'undefined'
    && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
}

/**
 * One recognition session per press. This is deliberately a small DOM
 * adapter: matching and attempt/fallback policy live above it.
 */
export class PressToTalk {
  constructor(button, {
    onResult,
    onLiveResult,
    onState,
    onUnavailable,
    onStarted,
    onPress,
    onCancelled,
  } = {}) {
    if (!button?.addEventListener) {
      throw new TypeError('PressToTalk requires a button-like EventTarget.');
    }

    this.button = button;
    this.onResult = onResult || (() => {});
    this.onLiveResult = onLiveResult || (() => {});
    this.onState = onState || (() => {});
    this.onUnavailable = onUnavailable || (() => {});
    this.onStarted = onStarted || (() => {});
    this.onPress = onPress || (() => true);
    this.onCancelled = onCancelled || (() => {});
    this.enabled = true;
    this.active = false;
    this.recognition = null;
    this.startedAt = null;
    this.alternatives = [];
    this.timeout = null;
    this.finishTimer = null;
    this.finished = false;
    this.consumedSpaceDown = false;

    this._click = (event) => {
      if (event.button !== undefined && event.button !== 0) return;
      this._press();
    };
    this._keyDown = (event) => {
      if (event.code !== 'Space' && event.key !== ' ') return;
      // Only repeats belong to a consumed press: a keyup lost to a window blur
      // must not swallow the child's next real press.
      if (this.consumedSpaceDown && event.repeat) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      this.consumedSpaceDown = false;
      if (event.repeat || !this._press()) return;
      this.consumedSpaceDown = true;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    this._keyUp = (event) => {
      if ((event.code !== 'Space' && event.key !== ' ') || !this.consumedSpaceDown) return;
      this.consumedSpaceDown = false;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    this._windowBlur = () => this.cancel();
    this._visibilityChange = () => {
      if (document.hidden) this.cancel();
    };
    button.addEventListener('click', this._click);
    // Capture globally so handled Space presses take priority over world
    // interaction and cannot synthesize a click on a focused button.
    window.addEventListener('keydown', this._keyDown, true);
    window.addEventListener('keyup', this._keyUp, true);
    window.addEventListener('blur', this._windowBlur);
    document.addEventListener('visibilitychange', this._visibilityChange);
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    this.button.disabled = !this.enabled;
    if (!this.enabled) this.cancel();
  }

  _createRecognition() {
    const Implementation = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Implementation) return null;

    const recognition = new Implementation();
    recognition.lang = 'en-US';
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = MAX_ALTERNATIVES;
    recognition.onresult = (event) => {
      const result = event.results[event.results.length - 1];
      if (!result) return;

      const alternatives = [];
      const count = Math.min(result.length, MAX_ALTERNATIVES);
      for (let index = 0; index < count; index += 1) {
        const transcript = result[index]?.transcript;
        if (transcript) alternatives.push(transcript);
      }
      if (!alternatives.length) return;

      this.alternatives = alternatives;
      // Interim results may succeed immediately. A non-match does not stop the
      // recognizer; it remains open until natural completion or the safety cap.
      if (this.active) {
        this.onLiveResult([...alternatives], { isFinal: Boolean(result.isFinal) });
      }
    };
    recognition.onerror = (event) => {
      const reason = event?.error;
      if (reason === 'not-allowed' || reason === 'service-not-allowed') {
        this._giveUp(MIC.DENIED);
      } else if (reason === 'audio-capture') {
        this._giveUp(MIC.ERROR);
      }
    };
    recognition.onend = () => {
      this._finish();
    };
    return recognition;
  }

  _press() {
    if (!this.enabled || this.button.disabled || this.button.hidden) return false;
    if (this.active) {
      this.cancel({ notify: true });
      return true;
    }
    const pressResult = this.onPress();
    if (pressResult === false) return false;
    if (pressResult === 'handled') return true;
    return this._start();
  }

  _start() {
    if (!this.enabled || this.active) return false;
    if (!speechSupported()) {
      this._giveUp(MIC.UNSUPPORTED);
      return true;
    }

    this.recognition = this._createRecognition();
    if (!this.recognition) {
      this._giveUp(MIC.UNSUPPORTED);
      return true;
    }

    this.active = true;
    this.finished = false;
    this.alternatives = [];
    this.startedAt = performance.now();
    this.onState(MIC.LISTENING);
    this.timeout = setTimeout(() => {
      this._stop();
    }, MAX_SESSION_MS);

    try {
      this.recognition.start();
      this.onStarted();
      return true;
    } catch {
      this._giveUp(MIC.ERROR);
      return true;
    }
  }

  _stop() {
    if (!this.active) return;
    this.active = false;
    clearTimeout(this.timeout);
    this.timeout = null;
    this.onState(MIC.IDLE);
    try { this.recognition?.stop(); } catch { this._finish(); }
    // Some engines omit onend after a gesture cancellation.
    this.finishTimer = setTimeout(() => this._finish(), FINISH_GRACE_MS);
  }

  _finish() {
    if (this.finished || this.startedAt === null) return;
    this.finished = true;
    this.active = false;
    clearTimeout(this.timeout);
    clearTimeout(this.finishTimer);
    this.timeout = null;
    this.finishTimer = null;
    const duration = Math.max(0, performance.now() - this.startedAt);
    this.startedAt = null;
    this.onState(MIC.IDLE);
    this.onResult([...this.alternatives], { duration });
    this.recognition = null;
  }

  _giveUp(state) {
    if (this.recognition) {
      this.recognition.onend = null;
      try { this.recognition.abort(); } catch { /* already closed */ }
    }
    this.active = false;
    this.finished = true;
    this.startedAt = null;
    clearTimeout(this.timeout);
    clearTimeout(this.finishTimer);
    this.timeout = null;
    this.finishTimer = null;
    this.recognition = null;
    this.onState(state);
    this.onUnavailable(state);
  }

  cancel({ notify = false } = {}) {
    const wasActive = this.active;
    if (this.recognition) {
      this.recognition.onend = null;
      try { this.recognition.abort(); } catch { /* already closed */ }
    }
    this.active = false;
    this.finished = true;
    this.startedAt = null;
    clearTimeout(this.timeout);
    clearTimeout(this.finishTimer);
    this.timeout = null;
    this.finishTimer = null;
    this.recognition = null;
    this.onState(MIC.IDLE);
    if (notify && wasActive) this.onCancelled();
  }

  dispose() {
    this.cancel();
    const button = this.button;
    button.removeEventListener('click', this._click);
    window.removeEventListener('keydown', this._keyDown, true);
    window.removeEventListener('keyup', this._keyUp, true);
    window.removeEventListener('blur', this._windowBlur);
    document.removeEventListener('visibilitychange', this._visibilityChange);
  }
}

/**
 * Speech facade used by minigames. `setTarget` selects one of the frozen
 * matchers; callers receive accepted/failure events and own all game policy.
 */
export function createSpeechSystem() {
  let press = null;
  let target = null;
  let enabled = true;
  let state = SPEECH_STATE.READY;

  const emitState = (next, detail) => {
    state = next;
    target?.onState?.(next, detail);
  };

  const judge = (alternatives) => {
    if (!target) return null;
    const matcher = target.judge || (target.mode === 'answer'
      ? (text) => matchAnswer(text, target.category)
      : (text) => matchQuestion(text, target.category));
    return matchBest(alternatives, matcher);
  };

  const accept = (result, meta) => {
    if (!target || target.accepted) return;
    target.accepted = true;
    press?.cancel();
    emitState(SPEECH_STATE.ACCEPTED, result);
    target.onAccepted?.(result, meta);
  };

  const bind = (button) => {
    press?.dispose();
    press = new PressToTalk(button, {
      onPress: () => {
        if (!target || target.accepted || !enabled) return false;
        // Commit before any microphone opens: a game may refuse the press (for
        // example a Restaurant customer that can no longer be reserved).
        if (target.onCommit?.() === false || !target) return false;
        const micFree = typeof target.micFree === 'function'
          ? target.micFree()
          : Boolean(target.micFree);
        if (!micFree) return true;
        target.onFallback?.();
        return 'handled';
      },
      onState: (micState) => {
        if (micState === MIC.LISTENING) emitState(SPEECH_STATE.LISTENING);
        else if (micState === MIC.IDLE && state === SPEECH_STATE.LISTENING) {
          emitState(SPEECH_STATE.READY);
        }
      },
      onLiveResult: (alternatives, meta) => {
        if (!target || target.accepted) return;
        emitState(SPEECH_STATE.DETECTED, alternatives);
        target.onDetected?.(alternatives, meta);
        const result = judge(alternatives);
        if (result?.ok) accept(result, { ...meta, interim: !meta.isFinal });
      },
      onResult: (alternatives, meta) => {
        if (!target || target.accepted) return;
        const result = judge(alternatives);
        if (result?.ok) {
          accept(result, { ...meta, interim: false });
          return;
        }
        emitState(SPEECH_STATE.TRY_AGAIN, result);
        target.onFailure?.(result, meta);
      },
      onStarted: () => {},
      onCancelled: () => {
        const cancelledTarget = target;
        cancelledTarget?.onCancel?.();
        if (target === cancelledTarget) emitState(SPEECH_STATE.READY);
      },
      onUnavailable: (reason) => {
        emitState(SPEECH_STATE.TRY_AGAIN, reason);
        target?.onUnavailable?.(reason);
      },
    });
    press.setEnabled(enabled && Boolean(target));
    const boundPress = press;
    return () => {
      boundPress.dispose();
      if (press === boundPress) press = null;
    };
  };

  return {
    bind,
    setTarget(options) {
      target = options ? { mode: 'question', ...options, accepted: false } : null;
      press?.setEnabled(enabled && Boolean(target));
      emitState(SPEECH_STATE.READY);
    },
    clearTarget() {
      target = null;
      press?.setEnabled(false);
      state = SPEECH_STATE.READY;
    },
    setEnabled(nextEnabled) {
      enabled = Boolean(nextEnabled);
      press?.setEnabled(enabled && Boolean(target));
      if (enabled && target) emitState(SPEECH_STATE.READY);
    },
    cancel() {
      press?.cancel();
      if (target) emitState(SPEECH_STATE.READY);
    },
    isSupported: speechSupported,
    get state() { return state; },
    get active() { return Boolean(press?.active); },
    dispose() {
      press?.dispose();
      press = null;
      target = null;
    },
  };
}
