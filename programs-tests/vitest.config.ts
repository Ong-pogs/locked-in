import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Single integration test that chains 17 real transactions. Worst case
    // ~10s but allow 60s for cold builds.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Run tests serially — LiteSVM has shared state per-svm.
    fileParallelism: false,
    pool: 'forks',
  },
});
