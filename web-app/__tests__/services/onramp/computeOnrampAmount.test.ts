import { describe, it, expect } from 'vitest';
import { computeOnrampAmount } from '@/services/onramp/computeOnrampAmount';

describe('computeOnrampAmount', () => {
  it('throws on zero, negative, and non-finite deficits', () => {
    for (const bad of [0, -5, NaN, Infinity]) {
      expect(() => computeOnrampAmount(bad)).toThrow();
    }
  });

  it('floors at $10 so top-ups are never fee-dominated', () => {
    expect(computeOnrampAmount(0.5)).toBe(10);
    expect(computeOnrampAmount(6)).toBe(10);
  });

  it('uses +$2 under the $20 crossover, 10% above', () => {
    expect(computeOnrampAmount(10)).toBe(12); // 12 > 11
    expect(computeOnrampAmount(20)).toBe(22); // equal at 22
    expect(computeOnrampAmount(50)).toBe(55); // 55 > 52
  });

  it('ceils fractional results', () => {
    expect(computeOnrampAmount(30.5)).toBe(34); // max(32.5, 33.55) → 34
  });
});
