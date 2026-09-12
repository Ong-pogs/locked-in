import { describe, it, expect } from 'vitest';
import { describeStake, daysRemaining } from '../../lib/arenaStake';
import type { ArenaStakeEntry } from '../../types/arena';

const base: Omit<ArenaStakeEntry, 'outcome' | 'stakedDelta'> = {
  stakeSeasonId: 1,
  courseId: 'swaps-and-dexs',
  lockAddress: 'L',
  optedInAt: '2026-09-01T00:00:00Z',
  ratingAtStart: 1200,
  ratingAtEnd: null,
  voidedReason: null,
  settledAt: null,
  startsAt: '2026-09-01T00:00:00Z',
  endsAt: '2026-10-01T00:00:00Z',
  seasonStatus: 'OPEN',
  matchesCounted: 2,
};

const entry = (o: ArenaStakeEntry['outcome'], stakedDelta: number): ArenaStakeEntry =>
  ({ ...base, outcome: o, stakedDelta });

describe('describeStake', () => {
  it('says plainly that a tier is at risk while behind', () => {
    const d = describeStake(entry('PENDING', -12));
    expect(d.tone).toBe('danger');
    expect(d.headline).toMatch(/behind/i);
  });

  it('is calm while ahead', () => {
    expect(describeStake(entry('PENDING', 18)).tone).toBe('good');
  });

  it('treats level as safe — a tie keeps the tier', () => {
    // Zero settles as KEPT, so the copy must not imply danger at zero.
    expect(describeStake(entry('PENDING', 0)).tone).not.toBe('danger');
  });

  it('never omits the deposit-safety sentence while a stake is live', () => {
    for (const delta of [-12, 0, 18]) {
      const d = describeStake(entry('PENDING', delta));
      expect(`${d.headline} ${d.detail}`).toMatch(/deposit/i);
    }
  });

  it('states the consequence after a forfeit, and that the deposit is intact', () => {
    const d = describeStake({ ...entry('FORFEIT', -30), settledAt: 'x' });
    expect(d.tone).toBe('danger');
    expect(d.detail).toMatch(/half/i);
    expect(d.detail).toMatch(/deposit/i);
  });

  it('says nothing was taken on a void', () => {
    const d = describeStake({ ...entry('VOID', -30), settledAt: 'x' });
    expect(d.detail).toMatch(/nothing/i);
    expect(d.tone).not.toBe('danger');
  });

  it('confirms the tier was kept', () => {
    expect(describeStake({ ...entry('KEPT', 12), settledAt: 'x' }).tone).toBe('good');
  });

  it('uses singular wording for a single counted match', () => {
    const d = describeStake({ ...entry('PENDING', -4), matchesCounted: 1 });
    expect(d.detail).toMatch(/1 staked match\b/);
    expect(d.detail).not.toMatch(/1 staked matches/);
  });
});

describe('daysRemaining', () => {
  it('counts whole days and never goes negative', () => {
    expect(daysRemaining('2026-09-11T00:00:00Z', new Date('2026-09-01T00:00:00Z'))).toBe(10);
    expect(daysRemaining('2026-09-01T00:00:00Z', new Date('2026-09-30T00:00:00Z'))).toBe(0);
  });

  it('is zero rather than NaN for an unparseable date', () => {
    expect(daysRemaining('not-a-date', new Date('2026-09-01T00:00:00Z'))).toBe(0);
  });
});
