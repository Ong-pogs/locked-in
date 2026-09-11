import { describe, it, expect } from 'vitest';
import { xpToLevel, XP_LEVEL_THRESHOLDS } from '../../../src/lib/xp.mjs';

describe('xpToLevel', () => {
  it('starts at level 1 with no xp', () => {
    expect(xpToLevel(0)).toBe(1);
  });

  it('returns level 1 just below the first threshold', () => {
    expect(xpToLevel(499)).toBe(1);
  });

  it('steps up exactly at each threshold', () => {
    XP_LEVEL_THRESHOLDS.forEach((threshold, i) => {
      expect(xpToLevel(threshold)).toBe(i + 1);
    });
  });

  it('caps at the highest level beyond the last threshold', () => {
    expect(xpToLevel(1_000_000)).toBe(XP_LEVEL_THRESHOLDS.length);
  });
});
