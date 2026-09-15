// Press-to-talk (SPEC §3): in mic-free mode the read-along fallback opens only
// after one deliberate Talk press. Waits for state, never time. `h.ui()` must
// report `talk` (Talk button visible) and `fallback` (visible read-along buttons).
export async function openFallback(h, minimum = 1, timeoutMs = 4000) {
  const state = await h.ui();
  if (state.fallback.length >= minimum) return state;
  if (!state.talk) return null;
  await h.page.click('.lesson-hud__talk');
  return h.waitFor((u) => u.fallback.length >= minimum, timeoutMs,
    'read-along fallback after one Talk press');
}
