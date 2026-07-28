// @vitest-environment node
// (jsdom breaks web3.js PDA/ATA derivation — "Unable to find a viable program
// address nonce" — same reason vaultV2.test.ts runs in node.)
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getAccountInfo = vi.fn();
const getTokenAccountBalance = vi.fn();
vi.mock('@/services/solana/connection', () => ({
  connection: {
    getAccountInfo: (...a: unknown[]) => getAccountInfo(...a),
    getTokenAccountBalance: (...a: unknown[]) => getTokenAccountBalance(...a),
  },
  CLUSTER: 'mainnet-beta',
  RPC_ENDPOINT: 'http://mock',
}));

const OWNER = 'C5D95rPis3kw4Vpig3A3fUFryA1FNzSLRbAQG7uLKkkB';

// vaultV2 reads its NEXT_PUBLIC_* env at module load — set it, reset the
// module graph, and import fresh (same pattern as vaultV2.test.ts).
describe('readWalletUsdcUi', () => {
  let readWalletUsdcUi: typeof import('@/services/solana/vaultV2')['readWalletUsdcUi'];

  beforeEach(async () => {
    getAccountInfo.mockReset();
    getTokenAccountBalance.mockReset();
    process.env.NEXT_PUBLIC_LOCK_VAULT_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
    process.env.NEXT_PUBLIC_VAULT_V2_PROGRAM_ID = 'FAuFtXbTAT9SiJTghxdZ1ZD4ShgrdTk2EqgyPxfq2gZ6';
    vi.resetModules();
    ({ readWalletUsdcUi } = await import('@/services/solana/vaultV2'));
  });

  it('returns "0" when the ATA does not exist (fresh embedded wallet)', async () => {
    getAccountInfo.mockResolvedValue(null);
    await expect(readWalletUsdcUi(OWNER)).resolves.toBe('0');
    expect(getTokenAccountBalance).not.toHaveBeenCalled();
  });

  it('returns the balance when the ATA exists', async () => {
    getAccountInfo.mockResolvedValue({ data: Buffer.alloc(0) });
    getTokenAccountBalance.mockResolvedValue({ value: { uiAmountString: '12.5' } });
    await expect(readWalletUsdcUi(OWNER)).resolves.toBe('12.5');
  });

  it('returns null on RPC failure (unknown, not zero)', async () => {
    getAccountInfo.mockRejectedValue(new Error('429'));
    await expect(readWalletUsdcUi(OWNER)).resolves.toBeNull();
  });
});
