import { defineConfig, devices } from '@playwright/test';

if (process.env.YEONI_E2E !== '1' || process.env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:54321') {
  throw new Error('Refusing E2E without the disposable Supabase stack.');
}

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['./tests/e2e/reporter.ts']],
  outputDir: 'test-results',
  use: {
    baseURL: 'http://127.0.0.1:3000',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    timezoneId: 'Asia/Seoul',
    locale: 'ko-KR',
    serviceWorkers: 'block',
    // Raw traces/HAR can contain session tokens; upload only our whitelist.
    trace: 'off', screenshot: 'off', video: 'off',
  },
  projects: [
    { name: 'auth-preservation', testMatch: '**/auth.spec.ts', use: { ...devices['Desktop Chrome'] } },
    { name: 'chromium', testIgnore: '**/auth.spec.ts', dependencies: ['auth-preservation'], use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit-small', testMatch: ['**/drawing.spec.ts', '**/drawing-templates.spec.ts', '**/typing-basics.spec.ts', '**/handwriting-course.spec.ts', '**/workout-voice.spec.ts', '**/roadmap-completion.spec.ts', '**/mobile.spec.ts', '**/diet-favorites.spec.ts', '**/workout-times.spec.ts', '**/p2.spec.ts', '**/free-first.spec.ts', '**/free-advice.spec.ts', '**/budget-improvements.spec.ts', '**/budget-payment-plans.spec.ts', '**/zephyr-guard.spec.ts', '**/zephyr-playback.spec.ts', '**/assistant-commands.spec.ts', '**/assistant-budget-commands.spec.ts', '**/assistant-workout-commands.spec.ts', '**/assistant-workout-cardio-commands.spec.ts', '**/assistant-diet-commands.spec.ts', '**/assistant-diet-meal-commands.spec.ts', '**/assistant-diet-time-commands.spec.ts', '**/assistant-growth-commands.spec.ts', '**/assistant-language-commands.spec.ts', '**/chatgpt-connection.spec.ts'], dependencies: ['auth-preservation'], use: { ...devices['iPhone 13'] } },
  ],
  webServer: {
    command: 'npm run start -- --hostname 127.0.0.1',
    url: 'http://127.0.0.1:3000/diet/settings',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
