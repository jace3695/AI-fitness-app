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

test('standalone practice bundle explicitly isolates environment without replacing product components or external-origin denial', () => {
  const lint = readFileSync('eslint.config.mjs', 'utf8');
  assert.ok(lint.includes('".e2e/component-browser/site/**"'));
  assert.doesNotMatch(lint, /["'](?:tests|scripts\/browser-qa\/cloud|app)\/\*\*["']/);
  const build = readFileSync('scripts/browser-qa/cloud/build.mjs', 'utf8');
  const expected = {
    NODE_ENV: '"production"',
    NEXT_PUBLIC_SUPABASE_URL: 'undefined',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'undefined',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'undefined',
    __NEXT_ROUTER_BASEPATH: '""',
    __NEXT_I18N_SUPPORT: 'false',
    __NEXT_LINK_NO_TOUCH_START: 'false',
    __NEXT_MANUAL_CLIENT_BASE_PATH: 'false',
    __NEXT_MANUAL_TRAILING_SLASH: 'false',
    __NEXT_TRAILING_SLASH: 'false',
  };
  for (const [key, value] of Object.entries(expected)) assert.ok(build.includes(`'process.env.${key}': '${value}'`), key);
  assert.equal(build.match(/'process\.env\./g)?.length, Object.keys(expected).length);
  assert.doesNotMatch(build, /\.\.\.process\.env|JSON\.stringify\(process\.env|plugins:|alias:|inject:/);
  assert.match(build, /entryPoints: \['scripts\/browser-qa\/cloud\/entry\.tsx'\]/);
  assert.match(build, /outputDirectory = resolve\('\.e2e\/component-browser\/site'\)/);
  const practice = readFileSync('scripts/browser-qa/cloud/PracticeFixture.tsx', 'utf8');
  assert.match(practice, /import PracticeWorkspace from '\.\.\/\.\.\/\.\.\/app\/language\/practice\/PracticeWorkspace'/);
  assert.match(practice, /<PracticeWorkspace key=\{`\$\{owner\}:\$\{mount\}`\} owner=\{owner\} transport=\{transport\}/);
  const isolation = readFileSync('tests/browser-cloud/fixture.ts', 'utf8');
  assert.match(isolation, /url\.origin === 'http:\/\/127\.0\.0\.1:3107'/);
  assert.match(isolation, /route\.abort\('blockedbyclient'\)/);
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
  const handwriting = '      - name: Verify handwriting course in Chromium and WebKit';
  assert.equal(workflow.split(handwriting).length, 2, 'run the complete handwriting batch once');
  assert.ok(workflow.indexOf(handwriting) > workflow.indexOf('Keep hosted-only speech diagnostics denied'));
  assert.ok(workflow.indexOf(handwriting) < workflow.indexOf('Verify beginner drawing flow'));
});
