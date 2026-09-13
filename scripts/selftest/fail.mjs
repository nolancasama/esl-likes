// Runner self-test scenario: the known-bad case.
//
// Proves scripts/playthrough-run.mjs reports FAIL: the preview is serving, an
// artifact is written, and then the scenario fails on purpose. The runner must
// exit nonzero, still write the manifest with passed: false, and still stop
// the preview. Not a game check.
import { writeFileSync } from 'node:fs';

const [url, prefix] = process.argv.slice(2);
const res = await fetch(url);
console.log(`selftest: preview answered ${res.status}`);
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
writeFileSync(`${prefix}-01-before-failure.png`, Buffer.from(PNG, 'base64'));
console.error('selftest: deliberate failure');
process.exit(1);
