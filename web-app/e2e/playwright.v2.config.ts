import { defineConfig, devices } from '@playwright/test';

// v2 functional e2e — separate config so the dev server always boots with the
// v2 world switch + e2e tx stub + sentinel RPC. The default config/specs stay
// untouched (they cover the legacy world).

const PORT = 3200;
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

const V2_ENV = {
  NEXT_PUBLIC_API_URL: 'http://localhost:3001',
  NEXT_PUBLIC_VAULT_V2_PROGRAM_ID: 'EUABEbHUjiUn9NijapRJT2MVqQ5nSdqH3gSzTxyGucsN',
  NEXT_PUBLIC_LOCK_VAULT_USDC_MINT: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
  NEXT_PUBLIC_LOCK_VAULT_PROGRAM_ID: '3RC9XkPZNSgXksp9Fb7J4LE7cQNYUUQdxkaaQnz6kBav',
  // RFC 2606 sentinel — can never resolve; any real RPC attempt fails loudly.
  NEXT_PUBLIC_SOLANA_RPC_URL: 'http://e2e-rpc.invalid',
  NEXT_PUBLIC_E2E_TX_STUB: '1',
};

export default defineConfig({
  testDir: './tests-v2',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [process.env.CI ? ['github'] : ['list']],
  outputDir: '../test-results-v2',
  expect: { timeout: 10_000 },
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
    {
      name: 'mobile-iphone-se',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 375, height: 667 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  // Production build, NOT `npm run dev`: on-demand route compilation in dev
  // races the first navigation to each route and produces slow-response
  // flakes. A prod build is deterministic (all routes prebuilt).
  webServer: {
    command: `npm run build && npm run start -- -p ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    env: V2_ENV,
  },
});
