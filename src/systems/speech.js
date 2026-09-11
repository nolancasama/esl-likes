import { matchAnswer, matchBest, matchQuestion } from './speechMatch.js';

const MAX_ALTERNATIVES = 5;
const MAX_HOLD_MS = 5000;
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
 * One recognition session per physical hold. This is deliberately a small DOM
 * adapter: matching and attempt/fallback policy live above it.
 */
export class HoldToTalk {
  constructor(button, { onResult, onLiveResult, onState, onUnavailable } = {}) {
    if (!button?.addEventListener) {
      throw new TypeError('HoldToTalk requires a button-like EventTarget.');
    }

    this.button = button;
    this.onResult = onResult || (() => {});
    this.onLiveResult = onLiveResult || (() => {});
    this.onState = onState || (() => {});
    this.onUnavailable = onUnavailable || (() => {});
    this.enabled = true;
    this.active = false;
    this.pointerId = null;
    this.recognition = null;
    this.startedAt = 0;
    this.alternatives = [];
    this.timeout = null;
    this.finishTimer = null;
    this.finished = false;

    this._pointerDown = (event) => {
      if (event.button !== undefined && event.button !== 0) return;
      if (!this.enabled || this.active || this.pointerId !== null) return;
      event.preventDefault();
      this.pointerId = event.pointerId;
      try { button.setPointerCapture(event.pointerId); } catch { /* best effort */ }
      this._start();
    };
    this._pointerEnd = (event) => {
      if (this.pointerId !== null && event.pointerId !== this.pointerId) return;
      event.preventDefault();
      this._releaseCapture();
      this._stop();
    };
    this._pointerLeave = (event) => {
      if (this.active) this._pointerEnd(event);
    };
    this._keyDown = (event) => {
      if (!this.enabled || this.button.disabled || this.button.hidden
        || event.key !== ' ' || event.repeat) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      this._start();
    };
    this._keyUp = (event) => {
      if (event.key !== ' ') return;
      if (!this.active && (!this.enabled || this.button.disabled || this.button.hidden)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      this._stop();
    };
    this._windowBlur = () => this.cancel();
    this._visibilityChange = () => {
      if (document.hidden) this.cancel();
    };
    this._blockTouch = (event) => event.preventDefault();

    button.addEventListener('pointerdown', this._pointerDown);
    button.addEventListener('pointerup', this._pointerEnd);
    button.addEventListener('pointercancel', this._pointerEnd);
    button.addEventListener('lostpointercapture', this._pointerEnd);
    button.addEventListener('pointerleave', this._pointerLeave);
    button.addEventListener('touchstart', this._blockTouch, { passive: false });
    button.addEventListener('touchmove', this._blockTouch, { passive: false });
    button.addEventListener('contextmenu', this._blockTouch);
    // Capture globally while this prompt is enabled. This gives keyboard users
    // true hold parity without requiring them to focus the on-screen button,
    // and prevents Space from also becoming a world interaction in that hold.
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

  _releaseCapture() {
    if (this.pointerId === null) return;
    const pointerId = this.pointerId;
    this.pointerId = null;
    try {
      if (this.button.hasPointerCapture(pointerId)) {
        this.button.releasePointerCapture(pointerId);
      }
    } catch { /* a cancelled pointer may already have lost capture */ }
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
      // recognizer; it remains open until release, cancellation, or the cap.
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
      if (!this.active) this._finish();
    };
    return recognition;
  }

  _start() {
    if (!this.enabled || this.active) return;
    if (!speechSupported()) {
      this._giveUp(MIC.UNSUPPORTED);
      return;
    }

    this.recognition = this._createRecognition();
    if (!this.recognition) {
      this._giveUp(MIC.UNSUPPORTED);
      return;
    }

    this.active = true;
    this.finished = false;
    this.alternatives = [];
    this.startedAt = performance.now();
    this.onState(MIC.LISTENING);
    this.timeout = setTimeout(() => {
      this._releaseCapture();
      this._stop();
    }, MAX_HOLD_MS);

    try {
      this.recognition.start();
    } catch {
      this._giveUp(MIC.ERROR);
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
    if (this.finished || !this.startedAt) return;
    this.finished = true;
    this.active = false;
    clearTimeout(this.timeout);
    clearTimeout(this.finishTimer);
    this.timeout = null;
    this.finishTimer = null;
    const duration = Math.max(0, performance.now() - this.startedAt);
    this.startedAt = 0;
    this.onState(MIC.IDLE);
    this.onResult([...this.alternatives], { duration });
    this.recognition = null;
  }

  _giveUp(state) {
    this._releaseCapture();
    if (this.recognition) {
      this.recognition.onend = null;
      try { this.recognition.abort(); } catch { /* already closed */ }
    }
    this.active = false;
    this.finished = true;
    this.startedAt = 0;
    clearTimeout(this.timeout);
    clearTimeout(this.finishTimer);
    this.timeout = null;
    this.finishTimer = null;
    this.recognition = null;
    this.onState(state);
    this.onUnavailable(state);
  }

  cancel() {
    this._releaseCapture();
    if (this.recognition) {
      this.recognition.onend = null;
      try { this.recognition.abort(); } catch { /* already closed */ }
    }
    this.active = false;
    this.finished = true;
    this.startedAt = 0;
    clearTimeout(this.timeout);
    clearTimeout(this.finishTimer);
    this.timeout = null;
    this.finishTimer = null;
    this.recognition = null;
    this.onState(MIC.IDLE);
  }

  dispose() {
    this.cancel();
    const button = this.button;
    button.removeEventListener('pointerdown', this._pointerDown);
    button.removeEventListener('pointerup', this._pointerEnd);
    button.removeEventListener('pointercancel', this._pointerEnd);
    button.removeEventListener('lostpointercapture', this._pointerEnd);
    button.removeEventListener('pointerleave', this._pointerLeave);
    button.removeEventListener('touchstart', this._blockTouch);
    button.removeEventListener('touchmove', this._blockTouch);
    button.removeEventListener('contextmenu', this._blockTouch);
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
  let hold = null;
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
    hold?.cancel();
    emitState(SPEECH_STATE.ACCEPTED, result);
    target.onAccepted?.(result, meta);
  };

  const bind = (button) => {
    hold?.dispose();
    hold = new HoldToTalk(button, {
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
      onUnavailable: (reason) => {
        emitState(SPEECH_STATE.TRY_AGAIN, reason);
        target?.onUnavailable?.(reason);
      },
    });
    hold.setEnabled(enabled && Boolean(target));
    const boundHold = hold;
    return () => {
      boundHold.dispose();
      if (hold === boundHold) hold = null;
    };
  };

  return {
    bind,
    setTarget(options) {
      target = options ? { mode: 'question', ...options, accepted: false } : null;
      hold?.setEnabled(enabled && Boolean(target));
      emitState(SPEECH_STATE.READY);
    },
    clearTarget() {
      target = null;
      hold?.setEnabled(false);
      state = SPEECH_STATE.READY;
    },
    setEnabled(nextEnabled) {
      enabled = Boolean(nextEnabled);
      hold?.setEnabled(enabled && Boolean(target));
      if (enabled && target) emitState(SPEECH_STATE.READY);
    },
    cancel() {
      hold?.cancel();
      if (target) emitState(SPEECH_STATE.READY);
    },
    isSupported: speechSupported,
    get state() { return state; },
    get active() { return Boolean(hold?.active); },
    dispose() {
      hold?.dispose();
      hold = null;
      target = null;
    },
  };
}
