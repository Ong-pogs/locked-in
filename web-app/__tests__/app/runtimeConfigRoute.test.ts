import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/runtime-config/route';

describe('GET /api/runtime-config', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('exposes only the public custody configuration', async () => {
    vi.stubEnv('NEXT_PUBLIC_SOLANA_CLUSTER', 'test-cluster');
    vi.stubEnv('NEXT_PUBLIC_VAULT_V2_PROGRAM_ID', 'test-program');
    vi.stubEnv('NEXT_PUBLIC_LOCK_VAULT_USDC_MINT', 'test-mint');
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');

    const response = GET();
    const body = await response.json();

    expect(body).toEqual({
      cluster: 'test-cluster',
      vaultV2ProgramId: 'test-program',
      usdcMint: 'test-mint',
      globalTvlCapUsdc: 1000,
      buildRevision: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    });
  });
});
