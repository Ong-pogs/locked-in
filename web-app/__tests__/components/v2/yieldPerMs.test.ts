import { describe, expect, it } from 'vitest';
import { yieldPerMs } from '@/components/v2/PositionCard';

describe('yieldPerMs', () => {
  it('uses the live APY: 5.49% on 50 USDC', () => {
    expect(yieldPerMs(50, 5.49)).toBeCloseTo((50 * 0.0549) / 31_536_000_000, 18);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['NaN', Number.NaN],
    ['zero', 0],
    ['negative', -3],
  ])('returns 0 for %s APY', (_label, apy) => {
    expect(yieldPerMs(50, apy)).toBe(0);
  });
});
