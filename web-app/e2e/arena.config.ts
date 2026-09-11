// Arena e2e. Unlike the other configs this one does NOT start a webServer or
// mock the API: the stack (throwaway Postgres + real Fastify + real JWTs) is
// launched separately, so these tests exercise the genuine end-to-end path.
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests-arena',
  fullyParallel: false,       // one shared backend and one question bank
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: '../test-results-arena-run',
  expect: { timeout: 15_000 },
  timeout: 120_000,
  use: {
    baseURL: process.env.ARENA_WEB_URL ?? 'http://localhost:39300',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 15_000,
    serviceWorkers: 'block',
  },
  projects: [
    { name: 'arena-desktop', use: { ...devices['Desktop Chrome'] } },
  ],
});
