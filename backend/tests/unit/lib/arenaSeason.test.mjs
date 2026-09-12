import { describe, it, expect } from 'vitest';
import {
  seasonOutcome, penaltyTiersFor, shouldCountMatch, MAX_STAKED_MEETINGS_PER_PAIR,
} from '../../../src/lib/arenaSeason.mjs';

describe('seasonOutcome', () => {
  it('forfeits only on a negative staked delta', () => {
    expect(seasonOutcome({ stakedDelta: -1, lockLive: true })).toBe('FORFEIT');
    expect(seasonOutcome({ stakedDelta: -48, lockLive: true })).toBe('FORFEIT');
  });

  it('keeps on zero — opting in and playing nothing is safe', () => {
    // Load-bearing. A player who opts in and never plays must not be punished
    // for it, or opting in becomes a trap.
    expect(seasonOutcome({ stakedDelta: 0, lockLive: true })).toBe('KEPT');
  });

  it('keeps on a positive delta', () => {
    expect(seasonOutcome({ stakedDelta: 32, lockLive: true })).toBe('KEPT');
  });

  it('voids when the lock is gone, whatever the delta says', () => {
    // A closed lock cannot be penalised retroactively — there is nothing left
    // to take a tier from, and the user already claimed at the old tier.
    expect(seasonOutcome({ stakedDelta: -99, lockLive: false })).toBe('VOID');
    expect(seasonOutcome({ stakedDelta: 99, lockLive: false })).toBe('VOID');
  });

  it('treats an unreadable delta as KEPT, never as a forfeit', () => {
    // Fail safe: a null delta means nothing counted, not that they lost.
    for (const junk of [null, undefined, NaN]) {
      expect(seasonOutcome({ stakedDelta: junk, lockLive: true })).toBe('KEPT');
    }
  });
});

describe('penaltyTiersFor', () => {
  it('costs a tier only on FORFEIT', () => {
    expect(penaltyTiersFor('FORFEIT')).toBe(1);
    expect(penaltyTiersFor('KEPT')).toBe(0);
    expect(penaltyTiersFor('VOID')).toBe(0);
    expect(penaltyTiersFor('PENDING')).toBe(0);
    expect(penaltyTiersFor('anything-else')).toBe(0);
    expect(penaltyTiersFor(undefined)).toBe(0);
  });
});

describe('shouldCountMatch', () => {
  it('counts the first two meetings of a pair, then stops', () => {
    expect(MAX_STAKED_MEETINGS_PER_PAIR).toBe(2);
    expect(shouldCountMatch(0)).toBe(true);
    expect(shouldCountMatch(1)).toBe(true);
    expect(shouldCountMatch(2)).toBe(false);
    expect(shouldCountMatch(9)).toBe(false);
  });

  it('counts an unreadable prior count rather than silently dropping a match', () => {
    for (const junk of [null, undefined, NaN, -1]) {
      expect(shouldCountMatch(junk)).toBe(true);
    }
  });
});
