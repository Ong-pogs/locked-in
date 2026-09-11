import { describe, it, expect } from 'vitest';
import {
  resolveMatch,
  clampElapsed,
  ARENA_QUESTION_COUNT,
  ARENA_QUESTION_TIMEOUT_MS,
} from '../../../src/lib/arenaScoring.mjs';

const p = (over = {}) => ({
  walletAddress: 'W',
  correctCount: 0,
  totalMs: 0,
  forfeited: false,
  ...over,
});

describe('match shape constants', () => {
  it('is a 7-question match with a 20s per-question cap', () => {
    expect(ARENA_QUESTION_COUNT).toBe(7);
    expect(ARENA_QUESTION_TIMEOUT_MS).toBe(20_000);
  });
});

describe('clampElapsed', () => {
  it('caps at the per-question timeout', () => {
    expect(clampElapsed(999_999)).toBe(ARENA_QUESTION_TIMEOUT_MS);
  });

  it('floors a negative clock skew at 0', () => {
    expect(clampElapsed(-5)).toBe(0);
  });

  it('passes a normal value through', () => {
    expect(clampElapsed(4321)).toBe(4321);
  });

  it('fails garbage SAFE — to the cap, never to a perfect time', () => {
    // A NaN elapsed (e.g. a null served_at) resolving to 0 would award an
    // unbeatable time. Unparseable input must score as the worst case.
    expect(clampElapsed(Number.NaN)).toBe(ARENA_QUESTION_TIMEOUT_MS);
    expect(clampElapsed(Number.POSITIVE_INFINITY)).toBe(ARENA_QUESTION_TIMEOUT_MS);
    expect(clampElapsed(undefined)).toBe(ARENA_QUESTION_TIMEOUT_MS);
    expect(clampElapsed(null)).toBe(ARENA_QUESTION_TIMEOUT_MS);
  });
});

describe('resolveMatch', () => {
  it('awards the win on correct count first', () => {
    const r = resolveMatch(
      p({ correctCount: 5, totalMs: 60_000 }),
      p({ correctCount: 4, totalMs: 10_000 }),
    );
    expect(r.outcome).toBe('A');
    expect(r.scoreA).toBe(1);
  });

  it('breaks a tie on total time, faster wins', () => {
    const r = resolveMatch(
      p({ correctCount: 5, totalMs: 30_000 }),
      p({ correctCount: 5, totalMs: 29_999 }),
    );
    expect(r.outcome).toBe('B');
    expect(r.scoreA).toBe(0);
  });

  it('is a draw only when correct count AND time are identical', () => {
    const r = resolveMatch(
      p({ correctCount: 5, totalMs: 30_000 }),
      p({ correctCount: 5, totalMs: 30_000 }),
    );
    expect(r.outcome).toBe('DRAW');
    expect(r.scoreA).toBe(0.5);
  });

  it('counts a single forfeit as a loss for the absentee', () => {
    const r = resolveMatch(
      p({ correctCount: 0, totalMs: 140_000, forfeited: true }),
      p({ correctCount: 1, totalMs: 5_000 }),
    );
    expect(r.outcome).toBe('B');
  });

  it('VOIDs a double forfeit instead of reading it as a draw', () => {
    const r = resolveMatch(
      p({ correctCount: 0, totalMs: 140_000, forfeited: true }),
      p({ correctCount: 0, totalMs: 140_000, forfeited: true }),
    );
    expect(r.outcome).toBe('VOID');
    expect(r.scoreA).toBeNull();
  });

  it('still beats a forfeiter even with zero correct, because they showed up', () => {
    const r = resolveMatch(
      p({ correctCount: 0, totalMs: 30_000 }),
      p({ correctCount: 0, totalMs: 140_000, forfeited: true }),
    );
    expect(r.outcome).toBe('A');
  });
});
