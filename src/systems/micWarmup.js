// Asks for the microphone once, shortly after load, so the browser's permission
// prompt does not land in the middle of the child's first question. The stream
// is stopped the moment it arrives: nothing is recorded or kept. Every failure
// (denied, blocked by a managed Chromebook, no API, prompt ignored) is harmless;
// the first real Talk still asks SpeechRecognition, and the read-along fallback
// stays the safety net.

let attempted = false;

export const MIC_WARMUP = Object.freeze({
  SKIPPED_MIC_FREE: 'skipped-mic-free',
  SKIPPED_REPEAT: 'skipped-repeat',
  UNAVAILABLE: 'unavailable',
  GRANTED: 'granted',
  FAILED: 'failed',
});

export function warmUpMicrophone({
  mediaDevices = globalThis.navigator?.mediaDevices,
  isMicFree = () => false,
} = {}) {
  if (isMicFree()) return Promise.resolve(MIC_WARMUP.SKIPPED_MIC_FREE);
  if (attempted) return Promise.resolve(MIC_WARMUP.SKIPPED_REPEAT);
  if (typeof mediaDevices?.getUserMedia !== 'function') return Promise.resolve(MIC_WARMUP.UNAVAILABLE);
  attempted = true;
  let request;
  try {
    request = mediaDevices.getUserMedia({ audio: true });
  } catch {
    return Promise.resolve(MIC_WARMUP.FAILED);
  }
  return Promise.resolve(request).then((stream) => {
    for (const track of stream?.getTracks?.() ?? []) track.stop();
    return MIC_WARMUP.GRANTED;
  }, () => MIC_WARMUP.FAILED);
}

/** Tests only. */
export function resetMicWarmupForTests() {
  attempted = false;
}
