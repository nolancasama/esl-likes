import { defineConfig } from 'vite';

// GitHub Pages serves a project site from /<repo>/, so the built asset URLs need
// that prefix — but only there. Locally (dev, preview, the scripted
// playthroughs) the site is served from the root, and hard-coding the prefix
// would break every one of those. The game's own asset loads already go through
// import.meta.env.BASE_URL, so this one setting covers both.
export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? '/esl-likes/' : '/',
});
