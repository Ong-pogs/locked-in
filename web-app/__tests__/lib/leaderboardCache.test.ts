import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readCachedBoard, writeCachedBoard, clearCachedBoard } from '../../lib/leaderboardCache';
import type { LeaderboardEntry } from '../../services/api/types';

// The leaderboard changes once a day, so a repeat visit can paint the last
// board immediately and refresh it in the background.

const entry = (rank: number, me = false): LeaderboardEntry => ({
  rank, displayIdentity: `Wal${rank}…abcd`, streakLength: 10 - rank, streakStatus: 'active',
  activeCourseCount: 1, lockedPrincipalAmount: '25000000', lockedPrincipalAmountUi: '25.00',
  projectedCommunityPotShare: '0', projectedCommunityPotShareUi: '0',
  recentActivityDate: '2026-10-02', isCurrentUser: me,
});
const board = { entries: [entry(1), entry(2, true)], currentUser: entry(2, true), snapshotAt: '2026-10-03T00:00:00Z', source: 'materialized' as const };

describe('leaderboard device cache', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips the last board for the same wallet', () => {
    writeCachedBoard('WalletA', board);
    expect(readCachedBoard('WalletA')).toEqual(board);
  });

  it('never shows one wallet the board saved for another', () => {
    writeCachedBoard('WalletA', board);
    expect(readCachedBoard('WalletB')).toBeNull();
  });

  it('has nothing to show for a signed-out visitor', () => {
    writeCachedBoard(null, board);
    expect(readCachedBoard(null)).toBeNull();
  });

  it('ignores a corrupt or wrong-shaped entry', () => {
    localStorage.setItem('locked-in:leaderboard:v1:WalletA', '{nope');
    expect(readCachedBoard('WalletA')).toBeNull();
    localStorage.setItem('locked-in:leaderboard:v1:WalletA', JSON.stringify({ entries: 'x' }));
    expect(readCachedBoard('WalletA')).toBeNull();
  });

  it('clears the saved board', () => {
    writeCachedBoard('WalletA', board);
    clearCachedBoard('WalletA');
    expect(readCachedBoard('WalletA')).toBeNull();
  });

  it('survives storage that throws (private mode, blocked site data)', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    expect(() => writeCachedBoard('WalletA', board)).not.toThrow();
    expect(readCachedBoard('WalletA')).toBeNull();
    get.mockRestore(); set.mockRestore();
  });
});
