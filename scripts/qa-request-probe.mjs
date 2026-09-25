import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { nativeLabel } from './qa-native-labels.mjs';
import { observeNetworkLibraries } from './qa-browser-environment.mjs';

if (process.env.YEONI_E2E !== '1' || process.env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:54321') throw new Error('Non-isolated probe refused');
mkdirSync('.e2e/evidence', { recursive: true });
const native = [];
let dropped = 0;
const libraries = observeNetworkLibraries();
const libraryTimer = setInterval(libraries.sample, 200);
const child = spawn(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', '--config=playwright.probe.config.ts'], {
  env: { ...process.env, DEBUG: 'pw:browser', QA_HTTP_OBSERVER: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const capture = stream => {
  const lines = createInterface({ input: stream });
  lines.on('line', line => {
    const label = nativeLabel(line);
    if (label) {
      if (native.length === 2000) { native.shift(); dropped++; }
      native.push({ at: Date.now(), label });
      if (label !== 'other-native') console.log('QA_NATIVE ' + JSON.stringify({ at: Date.now(), label }));
    }
    // Discard raw output, including console/URL/exception text. Test summaries
    // and fixture evidence are already saved separately by the safe reporter.
  });
};
capture(child.stdout); capture(child.stderr);
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
child.on('error', () => { console.error('Probe process could not start'); process.exitCode = 1; });
child.on('close', code => {
  clearInterval(libraryTimer);
  libraries.sample();
  const loaded = libraries.snapshot();
  const expectedVersion = process.env.QA_SOUP_VARIANT === 'fixed' ? 'libsoup/3.6.6' : 'libsoup/3.6.5';
  const environmentVerified = loaded.length > 0 && loaded.every(row => row.versions.length === 1 && row.versions[0] === expectedVersion);
  writeFileSync('.e2e/evidence/browser-environment.json', JSON.stringify({ commit: process.env.QA_HEAD_SHA,
    variant: process.env.QA_SOUP_VARIANT, node: process.version, arch: process.arch, expectedVersion,
    environmentVerified, loaded }, null, 2));
  if (!environmentVerified) { console.error('QA_BROWSER_ENVIRONMENT_UNVERIFIED'); process.exitCode = 1; }
  writeFileSync('.e2e/evidence/native-process.json', JSON.stringify({ commit: process.env.QA_HEAD_SHA, dropped, events: native }, null, 2));
  try {
    const report = JSON.parse(readFileSync('.e2e/evidence/results.json', 'utf8'));
    console.log('QA_PROBE_RESULT ' + JSON.stringify({ commit: report.commit, status: report.status,
      passed: report.results.filter(row => row.status === 'passed').length,
      failed: report.results.filter(row => row.status !== 'passed').length }));
  } catch { console.error('Probe result missing'); process.exitCode = 1; }
  process.exitCode = code === 0 && !process.exitCode ? 0 : 1;
});
