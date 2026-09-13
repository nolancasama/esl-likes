// Runner self-test scenario: the known-good case.
//
// Proves scripts/playthrough-run.mjs reports PASS on a scenario that passes:
// the preview it started is really serving, one artifact is written under the
// run's own prefix, and the exit status is 0. Not a game check.
import { writeFileSync } from 'node:fs';

const [url, prefix] = process.argv.slice(2);
const res = await fetch(url);
if (!res.ok) {
  console.error(`selftest: preview answered ${res.status}`);
  process.exit(1);
}
// A valid 1x1 PNG, so the manifest has a real artifact to list.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
writeFileSync(`${prefix}-01-selftest.png`, Buffer.from(PNG, 'base64'));
console.log('selftest: preview served, artifact written');
