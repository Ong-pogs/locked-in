import { describe, expect, it } from 'vitest';
import { GET } from '@/app/api/runtime-config/route';

describe('GET /api/runtime-config', () => {
  it('exposes only the public custody configuration', async () => {
    const response = GET();
    const body = await response.json();

    expect(Object.keys(body).sort()).toEqual(['cluster', 'usdcMint', 'vaultV2ProgramId']);
    expect(body.cluster).toBe(process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? null);
    expect(JSON.stringify(body)).not.toMatch(/secret|private|rpc/i);
  });
});
