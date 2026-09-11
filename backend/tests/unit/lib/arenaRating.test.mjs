import { describe, it, expect } from 'vitest';
import {
  expectedScore,
  effectiveK,
  applyElo,
  ARENA_START_RATING,
  ARENA_BASE_K,
} from '../../../src/lib/arenaRating.mjs';

describe('expectedScore', () => {
  it('is 0.5 between equal ratings', () => {
    expect(expectedScore(1200, 1200)).toBeCloseTo(0.5, 10);
  });

  it('favours the higher rating', () => {
    expect(expectedScore(1400, 1200)).toBeGreaterThan(0.5);
  });

  it('is symmetric', () => {
    expect(expectedScore(1400, 1200) + expectedScore(1200, 1400)).toBeCloseTo(1, 10);
  });
});

describe('effectiveK — repeat-opponent damping', () => {
  it('is the full K on a first meeting', () => {
    expect(effectiveK(0)).toBe(ARENA_BASE_K);
  });

  it('halves on the second meeting', () => {
    expect(effectiveK(1)).toBe(16);
  });

  it('keeps shrinking and never goes below 1', () => {
    expect(effectiveK(2)).toBeLessThan(16);
    expect(effectiveK(500)).toBeGreaterThanOrEqual(1);
  });
});

describe('applyElo', () => {
  it('starts players at 1200', () => {
    expect(ARENA_START_RATING).toBe(1200);
  });

  it('is zero-sum', () => {
    const r = applyElo({ ratingA: 1200, ratingB: 1200, scoreA: 1, priorMeetings: 0 });
    expect(r.deltaA + r.deltaB).toBe(0);
  });

  it('moves an even win by K/2', () => {
    const r = applyElo({ ratingA: 1200, ratingB: 1200, scoreA: 1, priorMeetings: 0 });
    expect(r.deltaA).toBe(16);
    expect(r.ratingA).toBe(1216);
    expect(r.ratingB).toBe(1184);
  });

  it('gives no movement for an even draw', () => {
    const r = applyElo({ ratingA: 1200, ratingB: 1200, scoreA: 0.5, priorMeetings: 0 });
    expect(r.deltaA).toBe(0);
  });

  it('makes farming the same opponent converge toward nothing', () => {
    const first = applyElo({ ratingA: 1200, ratingB: 1200, scoreA: 1, priorMeetings: 0 });
    const tenth = applyElo({ ratingA: 1200, ratingB: 1200, scoreA: 1, priorMeetings: 9 });
    expect(tenth.deltaA).toBeLessThan(first.deltaA);
    expect(tenth.deltaA).toBeLessThanOrEqual(2);
  });

  it('rewards beating a stronger opponent more than a weaker one', () => {
    const upset = applyElo({ ratingA: 1000, ratingB: 1600, scoreA: 1, priorMeetings: 0 });
    const expectedWin = applyElo({ ratingA: 1600, ratingB: 1000, scoreA: 1, priorMeetings: 0 });
    expect(upset.deltaA).toBeGreaterThan(expectedWin.deltaA);
  });

  it('punishes losing to a weaker opponent more than to a stronger one', () => {
    const badLoss = applyElo({ ratingA: 1600, ratingB: 1000, scoreA: 0, priorMeetings: 0 });
    const okLoss = applyElo({ ratingA: 1000, ratingB: 1600, scoreA: 0, priorMeetings: 0 });
    expect(badLoss.deltaA).toBeLessThan(okLoss.deltaA);
  });
});
