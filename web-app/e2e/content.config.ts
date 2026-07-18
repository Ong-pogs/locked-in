import { defineConfig, devices } from '@playwright/test';
import { BASE_URL, PORT, V2_ENV } from './playwright.v2.config';

// Content-verification e2e — walks EVERY seeded lesson (reading blocks +
// quiz) against the real catalog snapshot (e2e/fixtures/content-snapshot.json,
// regenerate with `node e2e/scripts/snapshot-content.mjs`).
//
// Separate config from the v2 functional suite because:
// - 37 lessons × full walkthrough is heavy; one mobile project keeps the
//   matrix sane (mobile is the PWA's primary form factor AND the viewport
//   where horizontal-overflow bugs live).
// - screenshots land in test-results-content/ as a per-lesson visual record.
//
// The webServer block is IDENTICAL to the v2 config (same port, same env), so
// `reuseExistingServer` lets back-to-back v2/content runs share one build.
//
// Run: npx playwright test -c e2e/content.config.ts

export default defineConfig({
  testDir: './tests-content',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [process.env.CI ? ['github'] : ['list']],
  outputDir: '../test-results-content',
  expect: { timeout: 10_000 },
  // A lesson walkthrough is many navigations + sections + questions.
  timeout: 120_000,
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    actionTimeout: 15_000,
    // Serwist registers with clientsClaim — once active it intercepts fetches
    // and silently bypasses page.route mocks. Block SWs in e2e entirely.
    serviceWorkers: 'block',
  },
  projects: [
    {
      name: 'content-mobile',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: {
    command: `npm run build && npm run start -- -p ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    env: V2_ENV,
  },
});
