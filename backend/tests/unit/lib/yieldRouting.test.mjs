import { describe, it, expect } from 'vitest';
import {
  SAVER_REDIRECT_BPS_BY_COUNT,
  getSaverRedirectBps,
  isFireLit,
  computeRedirectedAmount,
  computeNextFireLitUntil,
} from '../../../src/lib/yieldRouting.mjs';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

describe('yieldRouting', () => {
  describe('getSaverRedirectBps', () => {
    it('maps saver tiers to the right redirect bps', () => {
      expect(getSaverRedirectBps(0)).toBe(0); // 3 banked → 0%
      expect(getSaverRedirectBps(1)).toBe(1000); // 2 banked → 10%
      expect(getSaverRedirectBps(2)).toBe(1500); // 1 banked → 15%
      expect(getSaverRedirectBps(3)).toBe(2000); // 0 banked → 20%
    });

    it('falls back to 100% redirect for out-of-range counts', () => {
      expect(getSaverRedirectBps(4)).toBe(10_000);
      expect(getSaverRedirectBps(99)).toBe(10_000);
    });

    it('the exported table matches the documented tiers', () => {
      expect(SAVER_REDIRECT_BPS_BY_COUNT).toEqual({ 0: 0, 1: 1000, 2: 1500, 3: 2000 });
    });
  });

  describe('isFireLit', () => {
    const now = 1_000_000_000_000;

    it('is false when fireLitUntil is null/undefined', () => {
      expect(isFireLit(null, now)).toBe(false);
      expect(isFireLit(undefined, now)).toBe(false);
    });

    it('is false when the timer is in the past', () => {
      expect(isFireLit(new Date(now - HOUR_MS).toISOString(), now)).toBe(false);
    });

    it('is true when the timer is in the future', () => {
      expect(isFireLit(new Date(now + HOUR_MS).toISOString(), now)).toBe(true);
    });

    it('accepts Date, ISO string, and epoch ms', () => {
      expect(isFireLit(new Date(now + HOUR_MS), now)).toBe(true);
      expect(isFireLit(new Date(now + HOUR_MS).toISOString(), now)).toBe(true);
      expect(isFireLit(now + HOUR_MS, now)).toBe(true);
    });

    it('is false at exactly now (strictly greater than required)', () => {
      expect(isFireLit(now, now)).toBe(false);
    });

    it('is false for an unparseable value', () => {
      expect(isFireLit('not-a-date', now)).toBe(false);
    });
  });

  describe('computeRedirectedAmount', () => {
    it('routes 100% to pot when the fire is out', () => {
      expect(computeRedirectedAmount('1000', false, 0)).toBe('1000');
      expect(computeRedirectedAmount('1000', false, 2000)).toBe('1000'); // bps ignored when out
    });

    it('routes 0 to pot when fire is lit and no savers used', () => {
      expect(computeRedirectedAmount('1000', true, 0)).toBe('0');
    });

    it('redirects the saver-tier fraction when fire is lit', () => {
      expect(computeRedirectedAmount('1000', true, 1000)).toBe('100'); // 10%
      expect(computeRedirectedAmount('1000', true, 1500)).toBe('150'); // 15%
      expect(computeRedirectedAmount('1000', true, 2000)).toBe('200'); // 20%
    });

    it('floors fractional redirects (bigint-safe)', () => {
      // 7 * 1000 / 10000 = 0.7 → floor 0
      expect(computeRedirectedAmount('7', true, 1000)).toBe('0');
      // 19 * 1500 / 10000 = 2.85 → floor 2
      expect(computeRedirectedAmount('19', true, 1500)).toBe('2');
    });

    it('handles large gross amounts without precision loss', () => {
      // 1 USDC-hour at ~7.52% etc — use a big number
      const gross = '123456789012345';
      const expected = ((BigInt(gross) * 2000n) / 10_000n).toString();
      expect(computeRedirectedAmount(gross, true, 2000)).toBe(expected);
    });
  });

  describe('computeNextFireLitUntil', () => {
    const now = new Date('2026-01-01T00:00:00Z');

    it('starts 24h from now when the fire is out (null)', () => {
      const next = computeNextFireLitUntil(null, now);
      expect(next.getTime()).toBe(now.getTime() + DAY_MS);
    });

    it('starts 24h from now when the previous timer is in the past', () => {
      const past = new Date(now.getTime() - 5 * HOUR_MS);
      const next = computeNextFireLitUntil(past, now);
      expect(next.getTime()).toBe(now.getTime() + DAY_MS);
    });

    it('stacks additively when the fire is still lit', () => {
      // 6h remaining → feeding adds 24h on top → 30h from now
      const sixHoursLeft = new Date(now.getTime() + 6 * HOUR_MS);
      const next = computeNextFireLitUntil(sixHoursLeft, now);
      expect(next.getTime()).toBe(now.getTime() + 6 * HOUR_MS + DAY_MS);
    });

    it('respects a custom hours-to-add', () => {
      const next = computeNextFireLitUntil(null, now, 12);
      expect(next.getTime()).toBe(now.getTime() + 12 * HOUR_MS);
    });

    it('accepts ISO string input', () => {
      const next = computeNextFireLitUntil(now.toISOString(), now);
      // now is not > now, so base = now → now + 24h
      expect(next.getTime()).toBe(now.getTime() + DAY_MS);
    });
  });
});
