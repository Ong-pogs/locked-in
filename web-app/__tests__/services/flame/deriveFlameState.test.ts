import { describe, it, expect } from 'vitest';
import { deriveFlameState, yieldKeptBps } from '@/services/flame/deriveFlameState';

const base = { shields: 3, lapseCount: 0, lapseOpen: false, completedToday: false };

describe('deriveFlameState', () => {
  it('blazing: lesson done today, full shields, no lapses', () => {
    expect(deriveFlameState({ ...base, completedToday: true })).toBe('blazing');
  });

  it('flickering: no lesson yet today', () => {
    expect(deriveFlameState(base)).toBe('flickering');
  });

  it('flickering: done today but shields burning (a miss was absorbed)', () => {
    expect(deriveFlameState({ ...base, completedToday: true, shields: 2 })).toBe('flickering');
  });

  it('dark: exactly one lapse regardless of day state', () => {
    expect(deriveFlameState({ ...base, lapseCount: 1 })).toBe('dark');
    expect(deriveFlameState({ ...base, lapseCount: 1, completedToday: true })).toBe('dark');
  });

  it('extinguished: two or more lapses', () => {
    expect(deriveFlameState({ ...base, lapseCount: 2 })).toBe('extinguished');
    expect(deriveFlameState({ ...base, lapseCount: 5, completedToday: true })).toBe('extinguished');
  });

  it('every shield/lapse/day combination maps to exactly one state', () => {
    for (const shields of [0, 1, 2, 3])
      for (const lapseCount of [0, 1, 2, 3])
        for (const completedToday of [true, false])
          for (const lapseOpen of [true, false]) {
            const s = deriveFlameState({ shields, lapseCount, lapseOpen, completedToday });
            expect(['blazing', 'flickering', 'dark', 'extinguished']).toContain(s);
            if (lapseCount >= 2) expect(s).toBe('extinguished');
            else if (lapseCount === 1) expect(s).toBe('dark');
          }
  });
});

describe('yieldKeptBps', () => {
  it('one-mercy tiers', () => {
    expect(yieldKeptBps(0)).toBe(10_000);
    expect(yieldKeptBps(1)).toBe(5_000);
    expect(yieldKeptBps(2)).toBe(0);
    expect(yieldKeptBps(9)).toBe(0);
  });
});
