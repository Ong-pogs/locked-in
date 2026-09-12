// The money tier. This is the only function allowed to decide the bps that a
// completion voucher signs, so its whole input space is asserted here rather
// than sampled — a wrong cell in this table is a user losing real yield.
import { describe, it, expect } from 'vitest';
import { effectiveYieldBps, VALID_YIELD_BPS } from '../../../src/lib/claimVoucher.mjs';

describe('effectiveYieldBps', () => {
  it('reproduces the lapse-only ladder when nothing is staked', () => {
    expect(effectiveYieldBps({ lapseCount: 0 })).toBe(10_000);
    expect(effectiveYieldBps({ lapseCount: 1 })).toBe(5_000);
    expect(effectiveYieldBps({ lapseCount: 2 })).toBe(0);
    expect(effectiveYieldBps({ lapseCount: 7 })).toBe(0);
  });

  it('an arena forfeit costs exactly one tier', () => {
    expect(effectiveYieldBps({ lapseCount: 0, arenaPenaltyTiers: 1 })).toBe(5_000);
    expect(effectiveYieldBps({ lapseCount: 1, arenaPenaltyTiers: 1 })).toBe(0);
  });

  it('never drops below the floor however the inputs are stacked', () => {
    expect(effectiveYieldBps({ lapseCount: 2, arenaPenaltyTiers: 1 })).toBe(0);
    expect(effectiveYieldBps({ lapseCount: 99, arenaPenaltyTiers: 99 })).toBe(0);
  });

  it('clamps arenaPenaltyTiers to 0..1 — penalties never accumulate', () => {
    // A 180-day lock can span six seasons. If tiers accumulated, season 3
    // would zero a lock whose owner lapsed nothing.
    expect(effectiveYieldBps({ lapseCount: 0, arenaPenaltyTiers: 2 })).toBe(5_000);
    expect(effectiveYieldBps({ lapseCount: 0, arenaPenaltyTiers: 6 })).toBe(5_000);
  });

  it('treats garbage as no penalty rather than as a penalty', () => {
    for (const junk of [undefined, null, NaN, -1, 'x', {}]) {
      expect(effectiveYieldBps({ lapseCount: 0, arenaPenaltyTiers: junk })).toBe(10_000);
      expect(effectiveYieldBps({ lapseCount: junk })).toBe(10_000);
    }
  });

  it('is callable with no arguments at all', () => {
    expect(effectiveYieldBps()).toBe(10_000);
    expect(effectiveYieldBps({})).toBe(10_000);
  });

  it('always returns a bps the program will accept', () => {
    for (let l = 0; l <= 4; l++) {
      for (let a = 0; a <= 3; a++) {
        expect(VALID_YIELD_BPS).toContain(effectiveYieldBps({ lapseCount: l, arenaPenaltyTiers: a }));
      }
    }
  });
});
