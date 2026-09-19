import { describe, it, expect } from 'vitest';
import {
  computeQuotedYieldFromApy,
  deriveHarvestBucketTimestamp,
  createFixedApyStrategyAdapter,
  getYieldStrategyInfo,
  sanitizeRpcUrl,
} from '../../../src/lib/yieldStrategy.mjs';

describe('yieldStrategy', () => {
  describe('computeQuotedYieldFromApy', () => {
    it('computes correct yield for 100 USDC at 8% for 1 day', () => {
      // 100 USDC = 100_000_000 (6 decimals)
      // 800 bps = 8% APY
      // 86400 seconds = 1 day
      // Expected: (100_000_000 * 800 * 86400) / (10000 * 31536000)
      //         = 6_912_000_000_000 / 315_360_000_000
      //         = 21n (integer division)
      const result = computeQuotedYieldFromApy({
        principalAmount: 100_000_000,
        elapsedSeconds: 86_400,
        apyBps: 800,
      });

      const expected = (100_000_000n * 800n * 86_400n) / (10_000n * 365n * 24n * 60n * 60n);
      expect(result).toBe(expected);
    });

    it('returns 0n when principal is zero', () => {
      const result = computeQuotedYieldFromApy({
        principalAmount: 0,
        elapsedSeconds: 86_400,
        apyBps: 800,
      });

      expect(result).toBe(0n);
    });

    it('returns 0n when elapsed seconds is zero', () => {
      const result = computeQuotedYieldFromApy({
        principalAmount: 100_000_000,
        elapsedSeconds: 0,
        apyBps: 800,
      });

      expect(result).toBe(0n);
    });

    it('returns 0n when apyBps is zero', () => {
      const result = computeQuotedYieldFromApy({
        principalAmount: 100_000_000,
        elapsedSeconds: 86_400,
        apyBps: 0,
      });

      expect(result).toBe(0n);
    });

    it('returns 0n when principal is null/undefined', () => {
      const result = computeQuotedYieldFromApy({
        principalAmount: null,
        elapsedSeconds: 86_400,
        apyBps: 800,
      });

      expect(result).toBe(0n);
    });

    it('returns 0n when elapsed is negative', () => {
      const result = computeQuotedYieldFromApy({
        principalAmount: 100_000_000,
        elapsedSeconds: -100,
        apyBps: 800,
      });

      expect(result).toBe(0n);
    });

    it('handles large principal amounts correctly', () => {
      // 1,000,000 USDC at 10% for 365 days should give ~100,000 USDC
      const result = computeQuotedYieldFromApy({
        principalAmount: 1_000_000_000_000, // 1M USDC in 6 decimals
        elapsedSeconds: 365 * 24 * 60 * 60,
        apyBps: 1000, // 10%
      });

      // (1_000_000_000_000 * 1000 * 31_536_000) / (10_000 * 31_536_000)
      // = 1_000_000_000_000 * 1000 / 10_000
      // = 100_000_000_000 (100,000 USDC)
      expect(result).toBe(100_000_000_000n);
    });
  });

  describe('deriveHarvestBucketTimestamp', () => {
    it('rounds down to the bucket boundary for daily interval', () => {
      const intervalSeconds = 86_400; // 1 day
      // Use a timestamp that is 1 hour into a day
      const now = new Date('2024-01-15T01:00:00Z');
      const bucket = deriveHarvestBucketTimestamp(now, intervalSeconds);

      // Should round down to start of the 86400-second bucket
      const nowSeconds = Math.floor(now.getTime() / 1000);
      const expectedSeconds = Math.floor(nowSeconds / intervalSeconds) * intervalSeconds;
      expect(bucket.getTime()).toBe(expectedSeconds * 1000);
    });

    it('returns exact timestamp when already at bucket boundary', () => {
      const intervalSeconds = 3600; // 1 hour
      // Unix epoch is a boundary for any interval
      const now = new Date(0);
      const bucket = deriveHarvestBucketTimestamp(now, intervalSeconds);

      expect(bucket.getTime()).toBe(0);
    });

    it('handles hourly intervals correctly', () => {
      const intervalSeconds = 3600; // 1 hour
      // 30 minutes into an hour
      const now = new Date('2024-06-01T14:30:00Z');
      const bucket = deriveHarvestBucketTimestamp(now, intervalSeconds);

      // Should round down to 14:00:00
      expect(bucket).toEqual(new Date('2024-06-01T14:00:00Z'));
    });

    it('handles short intervals', () => {
      const intervalSeconds = 60; // 1 minute
      const now = new Date('2024-01-01T00:00:45Z');
      const bucket = deriveHarvestBucketTimestamp(now, intervalSeconds);

      expect(bucket).toEqual(new Date('2024-01-01T00:00:00Z'));
    });
  });

  describe('createFixedApyStrategyAdapter', () => {
    it('returns adapter with correct kind', () => {
      const adapter = createFixedApyStrategyAdapter();

      expect(adapter.kind).toBe('fixed_apy_v1');
    });

    it('returns adapter with intervalSeconds', () => {
      const adapter = createFixedApyStrategyAdapter();

      expect(adapter.intervalSeconds).toBeGreaterThan(0);
    });

    it('quoteHarvest returns grossYieldAmount as string and apyBps', async () => {
      const adapter = createFixedApyStrategyAdapter();
      const result = await adapter.quoteHarvest({
        principalAmount: 100_000_000,
        elapsedSeconds: 86_400,
      });

      expect(typeof result.grossYieldAmount).toBe('string');
      expect(typeof result.apyBps).toBe('number');
    });

    it('quoteHarvest returns 0 for zero principal', async () => {
      const adapter = createFixedApyStrategyAdapter();
      const result = await adapter.quoteHarvest({
        principalAmount: 0,
        elapsedSeconds: 86_400,
      });

      expect(result.grossYieldAmount).toBe('0');
    });
  });

  describe('sanitizeRpcUrl', () => {
    it('keeps only the RPC origin', () => {
      expect(sanitizeRpcUrl('https://rpc.example.com:8899/')).toBe(
        'https://rpc.example.com:8899',
      );
    });

    it('removes credentials from userinfo, path, query, and fragment', () => {
      expect(
        sanitizeRpcUrl('https://user:password@rpc.example.com/provider-token?api-key=secret#debug'),
      ).toBe('https://rpc.example.com');
    });

    it('rejects invalid and non-HTTP URLs', () => {
      expect(sanitizeRpcUrl('not a URL?api-key=secret')).toBeNull();
      expect(sanitizeRpcUrl('file:///tmp/rpc-token')).toBeNull();
      expect(sanitizeRpcUrl(null)).toBeNull();
    });
  });

  describe('getYieldStrategyInfo', () => {
    it('exposes the public custody program and mint for deployment verification', () => {
      expect(getYieldStrategyInfo().custody).toEqual({
        programId: 'EUABEbHUjiUn9NijapRJT2MVqQ5nSdqH3gSzTxyGucsN',
        usdcMint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
      });
    });
  });
});
