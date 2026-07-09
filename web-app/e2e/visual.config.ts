import { defineConfig, devices } from '@playwright/test';

// Isolated visual-snapshot suite. Runs against a PRODUCTION build (deterministic
// — no dev on-demand compile) with the v2 world switch + tx stub. Two chromium
// projects only. Baselines are darwin-suffixed and committed; linux CI needs a
// one-time --update-snapshots regeneration (no screenshot CI runner exists yet).

const PORT = 3300;
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

const V2_ENV = {
  NEXT_PUBLIC_API_URL: 'http://localhost:3001',
  NEXT_PUBLIC_VAULT_V2_PROGRAM_ID: 'EUABEbHUjiUn9NijapRJT2MVqQ5nSdqH3gSzTxyGucsN',
  NEXT_PUBLIC_LOCK_VAULT_USDC_MINT: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
  NEXT_PUBLIC_LOCK_VAULT_PROGRAM_ID: '3RC9XkPZNSgXksp9Fb7J4LE7cQNYUUQdxkaaQnz6kBav',
  NEXT_PUBLIC_SOLANA_RPC_URL: 'http://e2e-rpc.invalid',
  NEXT_PUBLIC_E2E_TX_STUB: '1',
};

export default defineConfig({
  testDir: './visual',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [process.env.CI ? ['github'] : ['list']],
  outputDir: '../test-results-visual',
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFileName}/{arg}-{projectName}-{platform}{ext}',
  expect: {
    timeout: 10_000,
    toHaveScreenshot: { animations: 'disabled', caret: 'hide', scale: 'css', maxDiffPixels: 200 },
  },
  use: {
    baseURL: BASE_URL,
    serviceWorkers: 'block',
    colorScheme: 'dark',
    timezoneId: 'UTC',
    locale: 'en-US',
    // reducedMotion is enforced per-test in the fixture's settle() via
    // page.emulateMedia (config-level typing rejects it in this PW version).
    contextOptions: { reducedMotion: 'reduce' },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } } },
    {
      name: 'mobile',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2,
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
