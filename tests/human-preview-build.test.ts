import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const expectationPath = join(root, 'scripts/browser-qa/human-preview-sha256.json');

// Unlike the checker-fixture tests, this gate bundles every actual transitive
// input and embeds the saved artwork/audio through the same exporters as CI.
// It runs in npm test, never starts a browser, and never refreshes expectations.
for (const kind of ['motion', 'speech'] as const) {
  test(`current human ${kind} export matches the source-reviewed complete-HTML digest`, { timeout: 70_000 }, t => {
    assert.ok(existsSync(join(root, 'scripts/browser-qa/node_modules/esbuild/lib/main.js')),
      'Install the pinned exporter dependency first: npm --prefix scripts/browser-qa ci --ignore-scripts');
    const directory = mkdtempSync(join(tmpdir(), `yeoni-current-preview-${kind}-`));
    const expectation = readFileSync(expectationPath, 'utf8');
    t.after(() => {
      rmSync(directory, { recursive: true, force: true });
      assert.equal(readFileSync(expectationPath, 'utf8'), expectation, 'The build gate must never refresh reviewed digests');
    });
    // Do not inherit application credentials, NODE_OPTIONS, ESBUILD_BINARY_PATH,
    // a caller's preview destination, or provider configuration into the build.
    const env: NodeJS.ProcessEnv = { NODE_ENV: 'production', YEONI_PREVIEW_ROOT: directory };
    for (const key of ['PATH', 'SystemRoot', 'TMPDIR', 'TEMP', 'TMP']) {
      if (process.env[key] !== undefined) env[key] = process.env[key];
    }
    const run = (args: string[]) => {
      const result = spawnSync(process.execPath, args, {
        cwd: root, env, encoding: 'utf8', timeout: 30_000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024,
      });
      assert.equal(result.error, undefined, `${args.join(' ')}: ${result.error?.message}`);
      assert.equal(result.status, 0, `${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
    };
    run([`scripts/yeoni-human-${kind}/export.mjs`]);
    run(['scripts/browser-qa/check-human-preview.mjs', kind]);
  });
}
