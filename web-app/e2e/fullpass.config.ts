import { defineConfig, devices } from '@playwright/test';
import { BASE_URL, PORT, V2_ENV } from './playwright.v2.config';

// Full-pass functional e2e — happy AND sad paths across the whole product
// surface (recall → lesson → quiz → result, dashboard position tabs, courses
// completed badge, claim). Runs on its OWN scenario fixture
// (e2e/fixtures/fullpass.fixture.ts) so the v2/content suites stay untouched.
//
// The webServer block is IDENTICAL to the v2 config (same port, same env), so
// `reuseExistingServer` lets back-to-back v2/content/fullpass runs share one
// build.
//
// Run: npx playwright test -c e2e/fullpass.config.ts

export default defineConfig({
  testDir: './tests-fullpass',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [process.env.CI ? ['github'] : ['list']],
  outputDir: '../test-results-fullpass',
  expect: { timeout: 10_000 },
  // A full lesson walkthrough spans recall + reading + quiz + submit.
  timeout: 90_000,
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    actionTimeout: 15_000,
    // Receipt/expiry dates render via toLocaleDateString — pin the zone so
    // "Jul 14"/"Jul 17, 2026" assertions hold on any machine.
    timezoneId: 'UTC',
    // Serwist registers with clientsClaim — once active it intercepts fetches
    // and silently bypasses page.route mocks. Block SWs in e2e entirely.
    serviceWorkers: 'block',
  },
  projects: [
    {
      name: 'desktop-chrome',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } },
    },
    {
      name: 'mobile-iphone',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  // Production build, NOT `npm run dev` — see playwright.v2.config for why.
  webServer: {
    command: `npm run build && npm run start -- -p ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    env: V2_ENV,
  },
});
