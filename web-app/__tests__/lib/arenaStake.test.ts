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
  lapseCount: 0,
  isCurrentSeason: true,
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
    expect(d.detail).toMatch(/50% of its yield instead of 100%/);
    expect(d.detail).toMatch(/deposit/i);
  });

  it('tells a player who already has a lapse the truth about their own ladder', () => {
    // "half its yield" is a lie to someone at 50% — a forfeit takes them to
    // nothing.
    const d = describeStake({ ...entry('FORFEIT', -30), lapseCount: 1, settledAt: 'x' });
    expect(d.detail).toMatch(/none of its yield instead of 50%/);
    expect(d.detail).not.toMatch(/half/i);
  });

  it('quotes the same ladder while the season is still running', () => {
    const clean = describeStake(entry('PENDING', -8));
    expect(clean.detail).toMatch(/50% of its yield instead of 100%/);
    const lapsed = describeStake({ ...entry('PENDING', -8), lapseCount: 1 });
    expect(lapsed.detail).toMatch(/none of its yield instead of 50%/);
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
