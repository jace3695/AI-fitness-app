import { defineConfig, devices } from '@playwright/test';
import baseline from './playwright.config';

export default defineConfig({
  ...baseline,
  testMatch: '**/navigation-probe.spec.ts',
  grep: /navigation probe [1-3]:/,
  projects: [
    { name: 'probe-webkit', use: { ...devices['iPhone 13'] } },
  ],
  webServer: {
    command: 'node --import ./scripts/qa-http-observer.mjs node_modules/next/dist/bin/next start --hostname 127.0.0.1',
    url: 'http://127.0.0.1:3000/diet/settings',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
