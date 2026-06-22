import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock solana connection
vi.mock('@/services/solana/connection', () => ({
  connection: {
    getAccountInfo: vi.fn().mockResolvedValue(null),
    getMultipleAccountsInfo: vi.fn().mockResolvedValue([]),
    getBalance: vi.fn().mockResolvedValue(0),
    getLatestBlockhash: vi.fn().mockResolvedValue({
      blockhash: 'FakeBlockhash',
      lastValidBlockHeight: 100,
    }),
    getTokenAccountBalance: vi.fn().mockResolvedValue({
      value: { amount: '0', decimals: 6, uiAmount: 0, uiAmountString: '0' },
    }),
  },
  CLUSTER: 'devnet',
}));

describe('lockVault', () => {
  let lockVault: typeof import('@/services/solana/lockVault');

  beforeEach(async () => {
    vi.resetModules();
    // Re-import to get fresh module state with env vars
    lockVault = await import('@/services/solana/lockVault');
  });

  describe('hasLockVaultConfig', () => {
    it('returns false with empty env vars', () => {
      // The env vars are empty by default in test environment
      expect(lockVault.hasLockVaultConfig()).toBe(false);
    });
  });

  describe('parseUiTokenAmount', () => {
    it('parses whole number correctly', () => {
      const result = lockVault.parseUiTokenAmount('100', 6);
      expect(result).toBe(100_000_000n);
    });

    it('parses decimal amount correctly', () => {
      const result = lockVault.parseUiTokenAmount('1.5', 6);
      expect(result).toBe(1_500_000n);
    });

    it('parses very small decimal correctly', () => {
      const result = lockVault.parseUiTokenAmount('0.000001', 6);
      expect(result).toBe(1n);
    });

    it('throws on invalid numeric format', () => {
      expect(() => lockVault.parseUiTokenAmount('abc', 6)).toThrow('Enter a valid numeric amount');
    });

    it('throws on too many decimal places', () => {
      expect(() => lockVault.parseUiTokenAmount('1.1234567', 6)).toThrow(
        'Amount supports at most 6 decimal places',
      );
    });

    it('handles amount with no fractional part', () => {
      const result = lockVault.parseUiTokenAmount('42', 6);
      expect(result).toBe(42_000_000n);
    });

    it('trims whitespace', () => {
      const result = lockVault.parseUiTokenAmount('  10  ', 6);
      expect(result).toBe(10_000_000n);
    });

    it('handles zero', () => {
      const result = lockVault.parseUiTokenAmount('0', 6);
      expect(result).toBe(0n);
    });
  });

  describe('formatDepositAmountUi', () => {
    it('formats atomic amount to UI string', () => {
      const result = lockVault.formatDepositAmountUi('1500000', 6);
      expect(result).toBe('1.5');
    });

    it('formats whole number without decimals', () => {
      const result = lockVault.formatDepositAmountUi('100000000', 6);
      expect(result).toBe('100');
    });

    it('formats zero', () => {
      const result = lockVault.formatDepositAmountUi('0', 6);
      expect(result).toBe('0');
    });

    it('removes trailing zeros from fractional part', () => {
      const result = lockVault.formatDepositAmountUi('1100000', 6);
      expect(result).toBe('1.1');
    });
  });
});
