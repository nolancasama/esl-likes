/**
 * Returns a self-contained Playwright init script:
 *
 *   await page.addInitScript(createMockSpeechInitScript());
 *
 * In the page, queue one plan per recognition session with
 * `__mockSpeech.queueTranscript('hello')` or `queueSilence()`. A transcript
 * emits an interim result followed by a final result; both may contain an
 * array of alternatives. Permission defaults to `granted` so an installed
 * playthrough mock is immediately eligible for auto-listen, and can be changed
 * with `setPermission('granted' | 'prompt' | 'denied')`.
 */
export function createMockSpeechInitScript() {
  return function installMockSpeech() {
    const plans = [];
    const counts = { starts: 0, aborts: 0, stops: 0, lastStartAt: null };
    let permission = 'granted';

    const normalizeAlternatives = (value) => {
      const values = Array.isArray(value) ? value : [value];
      return values.map((transcript) => String(transcript)).filter(Boolean);
    };

    const resultFor = (alternatives, isFinal) => {
      const result = alternatives.map((transcript) => ({ transcript, confidence: 0.9 }));
      result.isFinal = isFinal;
      return result;
    };

    class FakeSpeechRecognition {
      constructor() {
        this.continuous = false;
        this.interimResults = false;
        this.maxAlternatives = 1;
        this._timers = [];
        this._closed = false;
      }

      _later(callback, delay) {
        const timer = setTimeout(() => {
          this._timers = this._timers.filter((item) => item !== timer);
          if (!this._closed) callback();
        }, delay);
        this._timers.push(timer);
      }

      _clear() {
        this._timers.forEach(clearTimeout);
        this._timers = [];
      }

      _end() {
        if (this._closed) return;
        this._closed = true;
        this._clear();
        this.onend?.();
      }

      start() {
        counts.starts += 1;
        counts.lastStartAt = performance.now();
        this._closed = false;
        this.onstart?.();

        if (permission === 'denied') {
          this._later(() => {
            this.onerror?.({ error: 'not-allowed', message: 'Microphone permission denied' });
            this._end();
          }, 0);
          return;
        }

        const plan = plans.shift() ?? { type: 'silence' };
        if (plan.type === 'silence') {
          this._later(() => this._end(), 20);
          return;
        }

        this._later(() => {
          this.onresult?.({ results: [resultFor(plan.alternatives, false)] });
        }, 10);
        this._later(() => {
          this.onresult?.({ results: [resultFor(plan.alternatives, true)] });
        }, 20);
        if (!this.continuous) this._later(() => this._end(), 30);
      }

      stop() {
        counts.stops += 1;
        this._end();
      }

      abort() {
        counts.aborts += 1;
        this._closed = true;
        this._clear();
      }
    }

    const originalPermissions = navigator.permissions;
    const originalQuery = originalPermissions?.query?.bind(originalPermissions);
    const microphoneStatus = {
      get state() { return permission; },
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
    };
    const permissions = Object.create(originalPermissions || null);
    permissions.query = (descriptor) => {
      if (descriptor?.name === 'microphone') return Promise.resolve(microphoneStatus);
      return originalQuery
        ? originalQuery(descriptor)
        : Promise.reject(new TypeError('Unsupported permission descriptor'));
    };
    Object.defineProperty(navigator, 'permissions', {
      configurable: true,
      value: permissions,
    });

    window.SpeechRecognition = FakeSpeechRecognition;
    window.webkitSpeechRecognition = FakeSpeechRecognition;
    window.__mockSpeech = {
      queueTranscript(transcriptOrAlternatives) {
        plans.push({
          type: 'transcript',
          alternatives: normalizeAlternatives(transcriptOrAlternatives),
        });
      },
      queueTranscripts(...transcripts) {
        transcripts.forEach((transcript) => this.queueTranscript(transcript));
      },
      queueSilence() {
        plans.push({ type: 'silence' });
      },
      setPermission(next) {
        if (!['granted', 'prompt', 'denied'].includes(next)) {
          throw new TypeError(`Invalid microphone permission: ${next}`);
        }
        permission = next;
        microphoneStatus.onchange?.();
      },
      get starts() { return counts.starts; },
      get aborts() { return counts.aborts; },
      get stops() { return counts.stops; },
      get lastStartAt() { return counts.lastStartAt; },
      getCounters() { return { ...counts }; },
    };
  };
}

export default createMockSpeechInitScript;
