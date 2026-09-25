import { defineConfig, devices } from '@playwright/test';
import baseline from './playwright.config';

const fixed = process.env.QA_SOUP_VARIANT === 'fixed';
if (fixed && (!process.env.QA_SOUP_LIBRARY?.startsWith(`${process.env.RUNNER_TEMP}/webkit-soup/`) || process.env.GITHUB_ACTIONS !== 'true')) throw new Error('Fixed library must be built in the isolated runner');
const browserEnv = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));

export default defineConfig({
  ...baseline,
  testMatch: '**/navigation-probe.spec.ts',
  projects: [
    { name: 'probe-webkit', use: { ...devices['iPhone 13'], ...(fixed ? { launchOptions: { env: { ...browserEnv, LD_PRELOAD: process.env.QA_SOUP_LIBRARY! } } } : {}) } },
  ],
  webServer: {
    command: 'node --import ./scripts/qa-http-observer.mjs node_modules/next/dist/bin/next start --hostname 127.0.0.1',
    url: 'http://127.0.0.1:3000/diet/settings',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
