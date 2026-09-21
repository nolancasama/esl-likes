/**
 * Whether development tools may run at all.
 *
 * The game goes to Japanese elementary classrooms, where `P` is exactly the
 * sort of key a seven-year-old presses to see what happens. A dev tool that
 * opens on a bare keypress is a tool a child will open.
 *
 * So the gate is two-part. This flag decides whether the key does anything,
 * and the tool itself is loaded with a dynamic `import()`, which keeps the
 * whole editor out of the production bundle rather than merely hidden inside
 * it — nothing to find, and nothing to pay for at load time.
 *
 * On during `npm run dev`. Off in a build unless the URL carries `?editor=1`,
 * which is how you open it against a real production build when you need to.
 */
export const DEV_TOOLS_ENABLED = (() => {
  try {
    if (import.meta.env?.DEV) return true;
    return new URLSearchParams(window.location.search).has('editor');
  } catch {
    return false;
  }
})();
