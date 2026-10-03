import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LeaderboardEntry, LeaderboardResponse } from '@/services/api/types';

// The leaderboard paints the board this device saved last time and refreshes
// it in the background. The saved copy must belong to the session showing it:
// a response that lands after a wallet switch is dropped, and signing out
// hides the saved board.

const { getLeaderboard } = vi.hoisted(() => ({ getLeaderboard: vi.fn() }));

vi.mock('@/components/HubButton', () => ({ HubButton: () => null }));
vi.mock('@/services/api/progress/progressApi', () => ({ getLeaderboard }));
vi.mock('@/services/api/httpClient', () => {
  class AuthExpiredError extends Error {}
  return {
    AuthExpiredError,
    // Same contract as the real one: run the request with a token.
    fetchWithAuth: (requestFn: (token: string) => Promise<unknown>) => requestFn('token'),
  };
});

const { default: LeaderboardPage } = await import('@/app/leaderboard/page');
const { useUserStore } = await import('@/stores/userStore');
const { readCachedBoard, writeCachedBoard } = await import('@/lib/leaderboardCache');

const entry = (rank: number, label: string, me = false): LeaderboardEntry => ({
  rank, displayIdentity: label, streakLength: 20 - rank, streakStatus: 'active',
  activeCourseCount: 1, lockedPrincipalAmount: '25000000', lockedPrincipalAmountUi: '25.00',
  projectedCommunityPotShare: '0', projectedCommunityPotShareUi: '0',
  recentActivityDate: '2026-10-02', isCurrentUser: me,
});
const response = (labels: string[]): LeaderboardResponse => ({
  source: 'materialized', snapshotAt: '2026-10-03T00:00:00Z', page: 1, pageSize: 200,
  totalEntries: labels.length, totalPages: 1, currentPotSizeUi: '0',
  nextDistributionWindowLabel: null, currentUser: null,
  entries: labels.map((label, i) => entry(i + 1, label)),
});

/** A request whose answer the test releases by hand. */
function pending<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

beforeEach(() => {
  localStorage.clear();
  getLeaderboard.mockReset();
  useUserStore.setState({ walletAddress: 'WalletA', authToken: 'a', refreshToken: 'r' });
});

describe('leaderboard page with a saved board', () => {
  it('paints the saved board before the refresh answers', async () => {
    writeCachedBoard('WalletA', { entries: [entry(1, 'Saved…0001')], currentUser: null, snapshotAt: null, source: 'materialized' });
    const req = pending<LeaderboardResponse>();
    getLeaderboard.mockReturnValue(req.promise);

    render(<LeaderboardPage />);
    expect(await screen.findAllByText('Saved…0001')).not.toHaveLength(0);

    await act(async () => req.resolve(response(['Fresh…0002'])));
    expect(await screen.findAllByText('Fresh…0002')).not.toHaveLength(0);
  });

  it('drops an answer that lands after the wallet changed', async () => {
    const forA = pending<LeaderboardResponse>();
    const forB = pending<LeaderboardResponse>();
    getLeaderboard.mockReturnValueOnce(forA.promise).mockReturnValueOnce(forB.promise);

    render(<LeaderboardPage />);
    await act(async () => useUserStore.setState({ walletAddress: 'WalletB' }));
    await act(async () => forA.resolve(response(['OldA…0001'])));

    // A's late answer is neither shown nor saved under A.
    expect(screen.queryAllByText('OldA…0001')).toHaveLength(0);
    expect(readCachedBoard('WalletA')).toBeNull();

    await act(async () => forB.resolve(response(['NewB…0002'])));
    expect(await screen.findAllByText('NewB…0002')).not.toHaveLength(0);
    expect(readCachedBoard('WalletB')?.entries[0].displayIdentity).toBe('NewB…0002');
  });

  it('hides the saved board when the session ends', async () => {
    writeCachedBoard('WalletA', { entries: [entry(1, 'Saved…0001')], currentUser: null, snapshotAt: null, source: 'materialized' });
    getLeaderboard.mockReturnValue(pending<LeaderboardResponse>().promise);

    render(<LeaderboardPage />);
    expect(await screen.findAllByText('Saved…0001')).not.toHaveLength(0);

    await act(async () => useUserStore.setState({ authToken: null, refreshToken: null }));
    expect(screen.queryAllByText('Saved…0001')).toHaveLength(0);
    expect(screen.getByText('Connect your wallet to see the leaderboard.')).toBeInTheDocument();
  });
});
