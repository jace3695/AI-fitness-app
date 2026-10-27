import { defineConfig, devices } from '@playwright/test';

if (process.env.YEONI_COMPONENT_QA !== '1' || process.env.VERCEL) throw new Error('Explicit isolated component QA mode required.');
const fixedLibrary = process.env.QA_SOUP_LIBRARY;
if (process.env.CI && (!fixedLibrary?.startsWith(`${process.env.RUNNER_TEMP}/webkit-soup/`) || process.env.QA_SOUP_VARIANT !== 'fixed')) throw new Error('Existing pinned WebKit library required in CI.');
const browserEnv = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
export default defineConfig({
  testDir: '.', testMatch: '**/*.spec.ts', fullyParallel: false, workers: 1,
  retries: 0, forbidOnly: true, timeout: 45_000, globalTimeout: 12 * 60_000,
  expect: { timeout: 10_000 }, reporter: [['./reporter.ts']],
  outputDir: '../../.e2e/component-browser/test-results',
  use: { baseURL: 'http://127.0.0.1:3107', locale: 'ko-KR', timezoneId: 'Asia/Seoul',
    permissions: [], serviceWorkers: 'block', trace: 'off', screenshot: 'off', video: 'off',
    actionTimeout: 10_000, navigationTimeout: 20_000 },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } } },
    { name: 'webkit-small', use: { ...devices['iPhone 13'], ...(fixedLibrary ? { launchOptions: { env: { ...browserEnv, LD_PRELOAD: fixedLibrary } } } : {}) } },
  ],
  webServer: { command: 'node scripts/browser-qa/cloud/server.mjs', cwd: '../..',
    url: 'http://127.0.0.1:3107', reuseExistingServer: false, timeout: 90_000 },
});
