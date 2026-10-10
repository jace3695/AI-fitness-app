import { defineConfig } from '@playwright/test';
import defaults from './playwright.config';
import { ROOT, readPhaseConfiguration } from './scripts/qa-legacy-evidence-browser.mjs';

// The runner record, not an arbitrary cwd/URL/command, chooses one fixed phase.
// The driver and existing account fixture always remain in the checkout.
const phase = readPhaseConfiguration(ROOT, process.env);
const phaseTag = phase.phase === 'inactive'
  ? /(?:^|\s)@b2-inactive(?:\s|$)/
  : /(?:^|\s)@b2-enabled(?:\s|$)/;
const projects = ['auth-preservation', 'chromium', 'webkit-small'].map(name => {
  const project = defaults.projects?.find(candidate => candidate.name === name);
  if (!project) throw new Error('Missing required B2 browser project.');
  return name === 'auth-preservation'
    // Keep all four unchanged auth dependency cases in both invocations.
    ? { ...project, testMatch: '**/auth.spec.ts', grep: /.*/, grepInvert: [] }
    : { ...project, testMatch: '**/legacy-evidence-review.spec.ts', grep: phaseTag,
      grepInvert: phase.phase === 'enabled' ? [] : defaults.grepInvert };
});

export default defineConfig({
  ...defaults,
  testMatch: ['**/auth.spec.ts', '**/legacy-evidence-review.spec.ts'],
  grepInvert: phase.phase === 'enabled' ? [] : defaults.grepInvert,
  outputDir: phase.outputDir,
  projects,
  // Discovery starts no server or browser and never replaces execution reports.
  // Playwright merges webServer.env with process.env; the fixed serve launcher
  // therefore constructs the actual Next child's closed environment itself.
  webServer: phase.discovery ? undefined : {
    command: 'node scripts/qa-legacy-evidence-browser.mjs serve',
    cwd: ROOT,
    env: { B2_PHASE: phase.phase },
    url: 'http://127.0.0.1:3000/diet/settings',
    reuseExistingServer: false,
    timeout: 120_000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 15_000 },
    stdout: 'ignore',
    stderr: 'ignore',
  },
});
