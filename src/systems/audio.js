const SFX = Object.freeze({
  accept: { frequency: 660, endFrequency: 880, duration: 0.16 },
  complete: { frequency: 523, endFrequency: 1047, duration: 0.28 },
  interact: { frequency: 440, endFrequency: 520, duration: 0.08 },
  retry: { frequency: 260, endFrequency: 210, duration: 0.14 },
  stamp: { frequency: 740, endFrequency: 520, duration: 0.18 },
});

function readVolume(settings) {
  const value = typeof settings?.get === 'function'
    ? settings.get('volume')
    : settings?.volume;
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1;
}

/** Optional, fire-and-forget sound and en-US speech synthesis. */
export function createAudio(settings = {}) {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  const synth = window.speechSynthesis ?? null;
  let context = null;
  let masterGain = null;
  let ducked = false;
  let destroyed = false;

  function ensureContext() {
    if (!AudioContext || destroyed) return false;
    try {
      context ||= new AudioContext();
      if (!masterGain) {
        masterGain = context.createGain();
        masterGain.connect(context.destination);
      }
      if (context.state === 'suspended') context.resume().catch(() => {});
      return true;
    } catch {
      return false;
    }
  }

  function syncVolume() {
    if (!masterGain || !context) return;
    const level = readVolume(settings) * (ducked ? 0.35 : 1);
    masterGain.gain.setTargetAtTime(level, context.currentTime, 0.015);
  }

  function findEnglishVoice() {
    const voices = synth?.getVoices?.() ?? [];
    return voices.find((voice) => /^en-US\b/i.test(voice.lang))
      ?? voices.find((voice) => /^en\b/i.test(voice.lang))
      ?? null;
  }

  function stop() {
    try { synth?.cancel(); } catch { /* Audio is always best effort. */ }
    ducked = false;
    syncVolume();
  }

  function speak(text, options = {}) {
    stop();
    const volume = readVolume(settings);
    if (!synth || typeof SpeechSynthesisUtterance === 'undefined' || !text || volume <= 0 || destroyed) {
      queueMicrotask(() => options.onEnd?.());
      return { cancel() {} };
    }

    try {
      const utterance = new SpeechSynthesisUtterance(String(text));
      utterance.lang = 'en-US';
      utterance.voice = findEnglishVoice();
      utterance.volume = volume;
      utterance.rate = options.rate ?? 0.88;
      utterance.pitch = options.pitch ?? 1;
      utterance.onstart = () => {
        ducked = true;
        syncVolume();
        options.onStart?.();
      };
      utterance.onboundary = (event) => {
        const beforeBoundary = utterance.text.slice(0, event.charIndex).trim();
        const wordIndex = beforeBoundary ? beforeBoundary.split(/\s+/).length : 0;
        const detail = {
          charIndex: event.charIndex,
          charLength: event.charLength,
          name: event.name,
          wordIndex,
        };
        options.onWord?.(wordIndex, detail);
        options.onBoundary?.(wordIndex, detail);
      };
      const finish = (event) => {
        ducked = false;
        syncVolume();
        options.onEnd?.(event);
      };
      utterance.onend = finish;
      utterance.onerror = finish;
      synth.speak(utterance);
      return { cancel: stop, utterance };
    } catch {
      queueMicrotask(() => options.onEnd?.());
      return { cancel() {} };
    }
  }

  function playSfx(name, options = {}) {
    const definition = SFX[name] ?? options;
    if (!definition?.frequency || readVolume(settings) <= 0 || !ensureContext()) return;
    try {
      syncVolume();
      const now = context.currentTime;
      const duration = definition.duration ?? 0.1;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = definition.type ?? 'sine';
      oscillator.frequency.setValueAtTime(definition.frequency, now);
      oscillator.frequency.exponentialRampToValueAtTime(
        Math.max(1, definition.endFrequency ?? definition.frequency),
        now + duration,
      );
      gain.gain.setValueAtTime(options.gain ?? 0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      oscillator.connect(gain);
      gain.connect(masterGain);
      oscillator.start(now);
      oscillator.stop(now + duration);
    } catch {
      // A blocked AudioContext never blocks play.
    }
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    stop();
    if (context) context.close().catch(() => {});
    context = null;
    masterGain = null;
  }

  return { speak, stop, playSfx, syncVolume, destroy };
}
