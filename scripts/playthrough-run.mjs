import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCENARIOS = Object.freeze({
  restaurant: 'scripts/playthrough.mjs',
  'drink-stand': 'scripts/playthrough-drink.mjs',
  zoo: 'scripts/playthrough-zoo.mjs',
  coloring: 'scripts/playthrough-coloring.mjs',
  sports: 'scripts/playthrough-sports.mjs',
  // Runner self-tests (known-good / known-bad), not game checks:
  //   npm run build && npm run playthrough -- selftest-pass   -> exit 0
  //   npm run build && npm run playthrough -- selftest-fail   -> exit 1
  'selftest-pass': 'scripts/selftest/pass.mjs',
  'selftest-fail': 'scripts/selftest/fail.mjs',
});
const PREVIEW_TIMEOUT_MS = 30_000;

let previewProcess = null;
let scenarioProcess = null;
let receivedSignal = null;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function waitForClose(child, timeoutMs) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    child.once('close', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function terminateChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await waitForClose(child, 3_000);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await waitForClose(child, 1_000);
  }
}

async function chooseFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : null;
      server.close((error) => {
        if (error) reject(error);
        else if (port === null) reject(new Error('Could not determine a free preview port.'));
        else resolve(port);
      });
    });
  });
}

function urlAnswers(url) {
  return new Promise((resolve) => {
    const parsed = new URL(url);
    const socket = net.createConnection({
      host: parsed.hostname,
      port: Number(parsed.port),
      timeout: 1_000,
    });
    let settled = false;
    const finish = (answered) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(answered);
    };

    socket.once('connect', () => {
      socket.write(`GET ${parsed.pathname || '/'} HTTP/1.1\r\nHost: ${parsed.host}\r\nConnection: close\r\n\r\n`);
    });
    socket.once('data', () => finish(true));
    socket.once('error', () => finish(false));
    socket.once('timeout', () => finish(false));
    socket.once('end', () => finish(false));
  });
}

async function waitForPreview(url, getPreviewError) {
  const deadline = Date.now() + PREVIEW_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (receivedSignal) throw new Error(`Interrupted by ${receivedSignal}.`);
    const previewError = getPreviewError();
    if (previewError) throw previewError;
    if (previewProcess.exitCode !== null || previewProcess.signalCode !== null) {
      throw new Error('Preview exited before it became ready.');
    }
    if (await urlAnswers(url)) return;
    await delay(200);
  }
  throw new Error('Preview did not become ready within 30 seconds.');
}

async function hasBuiltDist() {
  try {
    const stat = await fs.stat(path.join(PROJECT_ROOT, 'dist'));
    if (!stat.isDirectory()) return false;
    return (await fs.readdir(path.join(PROJECT_ROOT, 'dist'))).length > 0;
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false;
    throw error;
  }
}

async function collectScreenshots(runDirectory) {
  const entries = await fs.readdir(runDirectory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.png'))
    .map((entry) => path.relative(PROJECT_ROOT, path.join(runDirectory, entry.name)).replaceAll(path.sep, '/'))
    .sort();
}

function runScenario(script, url, outputPrefix, extraArgs = []) {
  return new Promise((resolve) => {
    let spawnError = null;
    scenarioProcess = spawn(process.execPath, [script, url, outputPrefix, ...extraArgs], {
      cwd: PROJECT_ROOT,
      stdio: 'inherit',
    });
    scenarioProcess.once('error', (error) => {
      spawnError = error;
    });
    scenarioProcess.once('close', (code) => {
      scenarioProcess = null;
      resolve({ exitCode: code ?? 1, spawnError });
    });
  });
}

async function main() {
  const scenario = process.argv[2];
  const extraArgs = process.argv.slice(3);
  const script = SCENARIOS[scenario];
  if (!script) {
    console.error(`Unknown scenario "${scenario ?? ''}". Valid scenarios: ${Object.keys(SCENARIOS).join(', ')}`);
    return 2;
  }

  if (!(await hasBuiltDist())) {
    console.error('dist/ is missing or empty; run npm run build first.');
    return 1;
  }

  const runDirectory = path.join(PROJECT_ROOT, '.tmp', 'playthrough', scenario);
  const relativePrefix = path.posix.join('.tmp', 'playthrough', scenario, scenario);
  await fs.rm(runDirectory, { recursive: true, force: true });
  await fs.mkdir(runDirectory, { recursive: true });

  const port = await chooseFreePort();
  const url = `http://127.0.0.1:${port}/`;
  // Vite's own JS entry, run by this Node directly. Going through the
  // node_modules/.bin shim needs a shell on Windows, and killing that shell
  // leaves the real vite process orphaned and still listening.
  const viteEntry = path.join(PROJECT_ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  await fs.access(viteEntry);

  console.log(`Preview port: ${port}`);
  console.log('Waiting for preview...');

  let previewError = null;
  previewProcess = spawn(process.execPath, [
    viteEntry,
    'preview',
    '--host', '127.0.0.1',
    '--port', String(port),
    '--strictPort',
  ], {
    cwd: PROJECT_ROOT,
    stdio: 'ignore',
    windowsHide: true,
  });
  previewProcess.once('error', (error) => {
    previewError = error;
  });

  const startedAt = new Date();
  try {
    await waitForPreview(url, () => previewError);
    const result = await runScenario(script, url, relativePrefix, extraArgs);
    const endedAt = new Date();
    const screenshots = await collectScreenshots(runDirectory);
    const command = `node ${script} ${url} ${relativePrefix}${extraArgs.length ? ` ${extraArgs.join(' ')}` : ''}`;
    let harnessReport = null;
    if (scenario === 'zoo' || scenario === 'restaurant') {
      try {
        harnessReport = JSON.parse(await fs.readFile(
          path.join(PROJECT_ROOT, `${relativePrefix}-results.json`),
          'utf8',
        ));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    const manifest = {
      ...(harnessReport ? { schema: 'acceptance-manifest/1' } : {}),
      scenario,
      command,
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      durationSeconds: Number(((endedAt - startedAt) / 1_000).toFixed(3)),
      exitCode: result.exitCode,
      passed: result.exitCode === 0,
      ...(harnessReport ? {
        seed: harnessReport.seed,
        result: harnessReport.result,
        counts: {
          checks: harnessReport.checks.length,
          passed: harnessReport.checks.filter((check) => check.result === 'PASS').length,
          failed: harnessReport.checks.filter((check) => check.result !== 'PASS').length,
        },
        sections: harnessReport.sections,
        checks: harnessReport.checks,
        ...(harnessReport.trace ? { trace: harnessReport.trace } : {}),
        ...(scenario === 'restaurant' ? {
          fixedTotal: harnessReport.fixedTotal,
          forcedMissPickup: harnessReport.forcedMissPickup,
        } : { forcedWalkShort: harnessReport.forcedWalkShort }),
      } : {}),
      url,
      screenshots,
    };
    await fs.writeFile(
      path.join(runDirectory, 'manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf8',
    );

    console.log(`Scenario exit: ${result.exitCode}`);
    console.log('Screenshots:');
    if (screenshots.length === 0) console.log('  (none)');
    else for (const screenshot of screenshots) console.log(`  ${screenshot}`);

    if (result.spawnError) throw result.spawnError;
    return receivedSignal ? (receivedSignal === 'SIGINT' ? 130 : 143) : result.exitCode;
  } finally {
    await terminateChild(previewProcess);
    previewProcess = null;
  }
}

function handleSignal(signal) {
  if (receivedSignal) return;
  receivedSignal = signal;
  void terminateChild(scenarioProcess);
  void terminateChild(previewProcess);
}

process.on('SIGINT', () => handleSignal('SIGINT'));
process.on('SIGTERM', () => handleSignal('SIGTERM'));

try {
  process.exitCode = await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = receivedSignal === 'SIGINT' ? 130 : receivedSignal === 'SIGTERM' ? 143 : 1;
} finally {
  process.removeAllListeners('SIGINT');
  process.removeAllListeners('SIGTERM');
}
