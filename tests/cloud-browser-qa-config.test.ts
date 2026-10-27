import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('automatic Vercel deployment suppression is limited to the exact unpublished QA branch', () => {
  const config = JSON.parse(readFileSync('vercel.json', 'utf8'));
  assert.deepEqual(config, {
    $schema: 'https://openapi.vercel.sh/vercel.json',
    git: { deploymentEnabled: { 'agent/yeoni-cloud-browser-qa-20261027': false } },
  });
  // Official contract: unspecified branches retain their existing/default enabled behavior.
  for (const other of ['main', 'agent/fitness-record-priority', 'agent/yeoni-cat-animation-poc', 'agent/drawing-simple']) {
    assert.equal(Object.hasOwn(config.git.deploymentEnabled, other), false);
  }
});

test('focused browser lane keeps loopback fixture, zero retries, no raw traces and narrow public evidence', () => {
  const config = readFileSync('tests/browser-cloud/playwright.config.ts', 'utf8');
  assert.match(config, /baseURL: 'http:\/\/127\.0\.0\.1:3107'/);
  assert.match(config, /retries: 0/);
  assert.match(config, /globalTimeout: 12 \* 60_000/);
  assert.match(config, /trace: 'off', screenshot: 'off', video: 'off'/);
  assert.doesNotMatch(config, /channel:|msedge|ignoreHTTPSErrors/);
  const server = readFileSync('scripts/browser-qa/cloud/server.mjs', 'utf8');
  assert.match(server, /server\.listen\(3107, '127\.0\.0\.1'\)/);
  assert.match(server, /const assets = new Map/);
  assert.doesNotMatch(server, /process\.env\.[A-Z_]*(?:KEY|TOKEN|SECRET)/);
});

test('CI preserves the full suite budget and separate bounded component evidence without deployment authority', () => {
  const workflow = readFileSync('.github/workflows/browser-verification.yml', 'utf8');
  const focused = workflow.split('  focused-components:')[1].split('\n  browser:')[0];
  assert.match(focused, /timeout-minutes: 25/);
  assert.match(focused, /retention-days: 7/);
  assert.match(focused, /\.e2e\/component-browser\/evidence\/results\.json/);
  assert.match(focused, /\.e2e\/component-browser\/evidence\/\*\.png/);
  assert.doesNotMatch(focused, /secrets\.|permissions:|pull_request_target|--prod|supabase|vercel deploy/);
  assert.match(workflow.split('\n  browser:')[1], /timeout-minutes: 105/);
  assert.match(workflow, /permissions:\n  contents: read/);
  assert.match(workflow, /diagnostic-denial\.spec\.ts --project=chromium --project=webkit-diagnostic-denial/);
});
