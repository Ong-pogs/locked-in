import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The materialized leaderboard changes once a day, but every read used to cost
// three database queries (latest snapshot, page rows, viewer row). The API runs
// in Virginia and the database in Singapore, so each one is a ~0.2s ocean
// round trip. The latest snapshot is now held in memory; these tests pin that
// repeated reads do not touch the database, and that a refresh or an explicit
// clear makes the next read pick up the new snapshot.

const { query } = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock('../../../../src/lib/db.mjs', async (importOriginal) => ({
  ...(await importOriginal()),
  hasDatabase: () => true,
  query,
}));

const {
  getLeaderboardSnapshot,
  clearLeaderboardSnapshotCache,
} = await import('../../../../src/modules/progress/repository.mjs');

const ALICE = '7Vt9qL2xR8mK4pN6sJ3wF5hY1cB9dZ0aE2gT7uGDL6';
const BOB = '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin';

const row = (rank, walletAddress, displayIdentity) => ({
  rank,
  walletAddress,
  displayIdentity,
  streakLength: 10 - rank,
  streakStatus: 'active',
  activeCourseCount: 1,
  lockedPrincipalAmount: '25000000',
  projectedCommunityPotShare: '0',
  recentActivityDate: '2026-10-02',
});

function mockSnapshot(snapshotId, rows) {
  query.mockImplementation(async (sql) => {
    if (sql.includes('from lesson.leaderboard_snapshots')) {
      return {
        rows: [{
          snapshotId,
          snapshotAt: `2026-10-0${snapshotId}T00:00:00.000Z`,
          currentPotAmount: '0',
          nextDistributionWindowLabel: null,
          entryCount: rows.length,
        }],
      };
    }
    if (sql.includes('from lesson.leaderboard_snapshot_rows')) return { rows };
    throw new Error(`unexpected query: ${sql}`);
  });
}

beforeEach(() => {
  query.mockReset();
  clearLeaderboardSnapshotCache();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('leaderboard snapshot cache', () => {
  it('serves repeated reads from memory without querying the database', async () => {
    mockSnapshot(1, [row(1, ALICE, '7Vt9…GDL6'), row(2, BOB, '9xQe…VFin')]);

    const first = await getLeaderboardSnapshot(ALICE, 1, 200);
    const queriesAfterFirst = query.mock.calls.length;
    const second = await getLeaderboardSnapshot(BOB, 1, 200);

    expect(queriesAfterFirst).toBeGreaterThan(0);
    expect(query.mock.calls.length).toBe(queriesAfterFirst);
    expect(first.source).toBe('materialized');
    expect(second.entries.map((e) => e.rank)).toEqual([1, 2]);
  });

  it('still shapes the response per viewer and per page from the cached rows', async () => {
    mockSnapshot(1, [row(1, ALICE, '7Vt9…GDL6'), row(2, BOB, '9xQe…VFin')]);

    const asBob = await getLeaderboardSnapshot(BOB, 2, 1);
    expect(asBob.page).toBe(2);
    expect(asBob.totalPages).toBe(2);
    expect(asBob.entries.map((e) => e.displayIdentity)).toEqual(['9xQe…VFin']);
    expect(asBob.entries[0].isCurrentUser).toBe(true);
    expect(asBob.currentUser).toMatchObject({ rank: 2, isCurrentUser: true });

    const asAlice = await getLeaderboardSnapshot(ALICE, 1, 1);
    expect(asAlice.entries[0]).toMatchObject({ rank: 1, isCurrentUser: true });
    expect(asAlice.currentUser).toMatchObject({ rank: 1 });
  });

  it('picks up a new snapshot after the cache is cleared', async () => {
    mockSnapshot(1, [row(1, ALICE, '7Vt9…GDL6')]);
    const before = await getLeaderboardSnapshot(ALICE, 1, 200);

    mockSnapshot(2, [row(1, BOB, '9xQe…VFin'), row(2, ALICE, '7Vt9…GDL6')]);
    const stillCached = await getLeaderboardSnapshot(ALICE, 1, 200);
    clearLeaderboardSnapshotCache();
    const after = await getLeaderboardSnapshot(ALICE, 1, 200);

    expect(stillCached.snapshotAt).toBe(before.snapshotAt);
    expect(after.snapshotAt).not.toBe(before.snapshotAt);
    expect(after.entries).toHaveLength(2);
    expect(after.currentUser).toMatchObject({ rank: 2 });
  });

  it('shares one database load between concurrent first reads', async () => {
    mockSnapshot(1, [row(1, ALICE, '7Vt9…GDL6')]);

    await Promise.all([
      getLeaderboardSnapshot(ALICE, 1, 200),
      getLeaderboardSnapshot(BOB, 1, 200),
      getLeaderboardSnapshot(null, 1, 200),
    ]);

    // One snapshot query and one rows query, not three of each.
    expect(query.mock.calls.length).toBe(2);
  });
});

describe('leaderboard snapshot cache: a stalled load', () => {
  // One shared load serves every reader, so a query that never answers (a
  // silently dead connection) must not hold every later request hostage.
  it('lets later reads recover after the load deadline, and drops the late answer', async () => {
    vi.useFakeTimers();
    let releaseStuck;
    const stuck = new Promise((resolve) => { releaseStuck = resolve; });
    let calls = 0;
    query.mockImplementation(async (sql) => {
      calls += 1;
      if (calls === 1) return stuck; // the first snapshot query hangs
      if (sql.includes('from lesson.leaderboard_snapshots')) {
        return { rows: [{ snapshotId: 2, snapshotAt: 'fresh', currentPotAmount: '0', nextDistributionWindowLabel: null, entryCount: 1 }] };
      }
      return { rows: [row(1, BOB, '9xQe…VFin')] };
    });

    const firstRead = getLeaderboardSnapshot(ALICE, 1, 200);
    const firstOutcome = firstRead.then(() => 'ok', (err) => err.message);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await firstOutcome).toMatch(/LEADERBOARD_LOAD_TIMEOUT/);

    const recovered = await getLeaderboardSnapshot(ALICE, 1, 200);
    expect(recovered.snapshotAt).toBe('fresh');

    // The stuck query finally answers with an old snapshot: the abandoned
    // load sends no further SQL (its connection is not held for a rows query)
    // and must not overwrite the fresh cache.
    const callsBeforeRelease = calls;
    releaseStuck({ rows: [{ snapshotId: 1, snapshotAt: 'stale', currentPotAmount: '0', nextDistributionWindowLabel: null, entryCount: 0 }] });
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(callsBeforeRelease);
    const after = await getLeaderboardSnapshot(ALICE, 1, 200);
    expect(after.snapshotAt).toBe('fresh');
  });
});
