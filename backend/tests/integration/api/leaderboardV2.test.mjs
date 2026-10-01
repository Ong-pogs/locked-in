import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateTestWallet } from '../../helpers/test-auth.mjs';
import { query } from '../../../src/lib/db.mjs';
import {
  __setLockV2FreshReadOverride,
  deriveLockPdaServer,
} from '../../../src/lib/lockPosition.mjs';
import { refreshLeaderboardSnapshot } from '../../../src/modules/progress/repository.mjs';

const COURSE_ID = 'test-kitchen';
const PROGRAM_ID = process.env.VAULT_V2_PROGRAM_ID;
const wallets = {
  activeTen: generateTestWallet(),
  activeTwenty: generateTestWallet(),
  closed: generateTestWallet(),
  mismatch: generateTestWallet(),
  pending: generateTestWallet(),
};
const trackedWallets = Object.values(wallets);
let createdSnapshotAt = null;

function lockAddress(wallet) {
  return deriveLockPdaServer(PROGRAM_ID, wallet, COURSE_ID).toBase58();
}

function activeRead(wallet, principal) {
  return {
    mismatch: false,
    status: 'ACTIVE',
    principal,
    lockStartTs: 1,
    lockAddress: lockAddress(wallet),
  };
}

async function seedRuntimeRow(wallet, streak, lastCompletedDay = null) {
  await query(
    `INSERT INTO lesson.user_course_enrollments (wallet_address, course_id)
     VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [wallet, COURSE_ID],
  );
  await query(
    `INSERT INTO lesson.user_course_runtime_state
       (wallet_address, course_id, fuel_cap, lock_account_address,
        current_streak, last_completed_day, principal_amount, course_completed_at)
     VALUES ($1, $2, 7, $3, $4, $5::date, 999, now())`,
    [wallet, COURSE_ID, lockAddress(wallet), streak, lastCompletedDay],
  );
}

beforeAll(async () => {
  await seedRuntimeRow(wallets.activeTen, 2, '2026-09-30');
  await seedRuntimeRow(wallets.activeTwenty, 1);
  await seedRuntimeRow(wallets.closed, 5);
  await seedRuntimeRow(wallets.mismatch, 4);
  await seedRuntimeRow(wallets.pending, 3);

  const freshReads = new Map([
    [wallets.activeTen, activeRead(wallets.activeTen, 10_000_000n)],
    [wallets.activeTwenty, activeRead(wallets.activeTwenty, 20_000_000n)],
    [wallets.closed, null],
    [wallets.mismatch, { mismatch: true, reason: 'PROGRAM_OWNER_MISMATCH' }],
    [wallets.pending, {
      mismatch: false,
      status: 'PENDING',
      principal: 30_000_000n,
      lockStartTs: 1,
      lockAddress: lockAddress(wallets.pending),
    }],
  ]);

  __setLockV2FreshReadOverride(async (wallet) => freshReads.get(wallet) ?? null);
});

afterAll(async () => {
  __setLockV2FreshReadOverride(null);
  if (createdSnapshotAt) {
    await query(
      `DELETE FROM lesson.leaderboard_snapshots
       WHERE snapshot_at = $1
         AND snapshot_id IN (
           SELECT snapshot_id
           FROM lesson.leaderboard_snapshot_rows
           WHERE wallet_address = ANY($2)
         )`,
      [createdSnapshotAt, trackedWallets],
    );
  }
  await query(
    `DELETE FROM lesson.user_course_runtime_state WHERE wallet_address = ANY($1)`,
    [trackedWallets],
  );
  await query(
    `DELETE FROM lesson.user_course_enrollments WHERE wallet_address = ANY($1)`,
    [trackedWallets],
  );
});

describe('leaderboard v2 lock reads', () => {
  it('counts only active v2 locks and ranks by streak before principal', async () => {
    const result = await refreshLeaderboardSnapshot(10_000);
    createdSnapshotAt = result.snapshotAt;
    const byWallet = new Map(
      result.entries
        .filter((entry) => trackedWallets.includes(entry.walletAddress))
        .map((entry) => [entry.walletAddress, entry]),
    );

    expect(byWallet.size).toBe(5);
    expect(byWallet.get(wallets.activeTen)).toMatchObject({
      streakLength: 2,
      activeCourseCount: 1,
      lockedPrincipalAmount: '10000000',
      recentActivityDate: '2026-09-30',
    });
    expect(byWallet.get(wallets.activeTwenty)).toMatchObject({
      streakLength: 1,
      activeCourseCount: 1,
      lockedPrincipalAmount: '20000000',
    });
    expect(byWallet.get(wallets.activeTen).rank)
      .toBeLessThan(byWallet.get(wallets.activeTwenty).rank);

    for (const wallet of [wallets.closed, wallets.mismatch, wallets.pending]) {
      expect(byWallet.get(wallet)).toMatchObject({
        streakLength: 0,
        activeCourseCount: 0,
        lockedPrincipalAmount: '0',
      });
    }
  });
});
