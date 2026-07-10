// v2 pot-cycle DB-integration tests (pot-cycle ruling 2026-07-10, R14).
//
// The on-chain lock reader is dependency-injected through
// __setLockV2FreshReadOverride (the same pattern the lapse-sweep tests use);
// the pot-program readers/relay legs are injected through each function's
// deps/overrides surface. ZERO on-chain sends happen anywhere in this file.
//
// Covers: the closeCommunityPotWindowAndSnapshotV2 eligibility matrix
// (null/mismatch/non-ACTIVE excluded, completed-but-unclaimed ACTIVE
// included, legacy-PDA rows skipped, weight = on-chain principal x DB
// streak), the zero-payout filter preserving the exact total, the
// fail-closed abort on a thrown read, the R2 closed-window re-book path,
// orchestrator benign-vs-non-benign reasons per R7's taxonomy, the
// stale-'publishing' reclaim's 15-minute/target-window fences, and the
// internal endpoint's auth.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Keypair } from '@solana/web3.js';
import { createTestServer, closeTestServer } from '../../helpers/test-server.mjs';
import { generateTestWallet } from '../../helpers/test-auth.mjs';
import { getPool, query } from '../../../src/lib/db.mjs';
import {
  deriveLockPdaServer,
  __setLockV2FreshReadOverride,
} from '../../../src/lib/lockPosition.mjs';
import { deriveCommunityPotWindowId } from '../../../src/lib/communityPot.mjs';
import { closeCommunityPotWindowAndSnapshotV2 } from '../../../src/modules/progress/repository.mjs';
import {
  POT_CYCLE_ADVISORY_LOCK_KEY,
  reclaimStalePublishingRows,
  runPotCycle,
} from '../../../src/lib/potCycle.mjs';
import { recordPendingSettleEvents } from '../../../src/lib/potBridge.mjs';

const COURSE_ID = 'test-kitchen';
const PROGRAM_ID = process.env.VAULT_V2_PROGRAM_ID;
const silentLog = { info: () => {}, warn: () => {}, error: () => {} };

// All test windows are valid, long-past UTC months (year 1900+) so they can
// never collide with real windows or violate WINDOW_NOT_PAST.
const W_MATRIX = 190001;
const W_DUST = 190002;
const W_ABORT = 190003;
const W_NOTHING = 190101;
const W_UNDERFUNDED = 190103;
const W_RESUMED = 190104;
const W_INCOMPLETE = 190105;
const W_LOCKED = 190106;
const W_RECLAIM = 190201;
const W_RECLAIM_OTHER = 190202;
const W_REBOOK = 190301;
const W_OPEN = 190302;
const W_NO_SIG = 190303;
const W_PREVIEW = 190304;
const ALL_WINDOWS = [
  W_MATRIX, W_DUST, W_ABORT, W_NOTHING, W_UNDERFUNDED, W_RESUMED,
  W_INCOMPLETE, W_LOCKED, W_RECLAIM, W_RECLAIM_OTHER, W_REBOOK, W_OPEN,
  W_NO_SIG, W_PREVIEW,
];

function derivedPda(wallet) {
  return deriveLockPdaServer(PROGRAM_ID, wallet, COURSE_ID).toBase58();
}

// Per-wallet injected fresh reads. Unknown wallets (concurrent suites share
// the DB) read as null = settled → quietly excluded, never punished/paid.
const freshReads = new Map();
function installFreshReadOverride() {
  __setLockV2FreshReadOverride(async (walletAddress) => {
    const entry = freshReads.get(walletAddress);
    if (entry === 'THROW') throw new Error('RPC boom');
    return entry ?? null;
  });
}

function activeRead(wallet, principal) {
  return {
    mismatch: false,
    status: 'ACTIVE',
    principal,
    lockStartTs: 1,
    lockAddress: derivedPda(wallet),
  };
}

const trackedWallets = [];

// Arm a runtime row. course_completed_at is set on EVERY row: closeV2's
// eligibility deliberately ignores it (completed-but-unclaimed ACTIVE locks
// stay eligible), and it also fences these rows out of any concurrently
// running lapse-sweep test (its candidate query filters completed rows), so
// a parallel suite can never tombstone them mid-test.
async function armRow(wallet, { streak = 1, lockAddress = null, principalDb = 999 } = {}) {
  trackedWallets.push(wallet);
  await query(
    `INSERT INTO lesson.user_course_enrollments (wallet_address, course_id)
     VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [wallet, COURSE_ID],
  );
  await query(
    `INSERT INTO lesson.user_course_runtime_state
       (wallet_address, course_id, fuel_cap, lock_account_address,
        current_streak, principal_amount, course_completed_at)
     VALUES ($1, $2, 7, $3, $4, $5, now())
     ON CONFLICT (wallet_address, course_id) DO UPDATE
       SET lock_account_address = $3, current_streak = $4,
           principal_amount = $5, course_completed_at = now()`,
    [wallet, COURSE_ID, lockAddress ?? derivedPda(wallet), streak, principalDb],
  );
}

async function seedSnapshotRow(windowId, wallet, { status, payout = 100, minutesAgo = 0 } = {}) {
  trackedWallets.push(wallet);
  await query(
    `INSERT INTO lesson.community_pot_distribution_snapshots
       (window_id, wallet_address, course_id, current_streak,
        principal_amount, weight, payout_amount, status, updated_at)
     VALUES ($1, $2, $3, 1, 1000000, 1000000, $4, $5, now() - ($6 || ' minutes')::interval)`,
    [windowId, wallet, COURSE_ID, payout, status, String(minutesAgo)],
  );
}

async function snapshotRows(windowId) {
  const result = await query(
    `SELECT wallet_address as "walletAddress", course_id as "courseId",
            current_streak as "currentStreak", principal_amount as "principalAmount",
            weight, payout_amount as "payoutAmount", status,
            distribution_last_error as "distributionLastError"
     FROM lesson.community_pot_distribution_snapshots
     WHERE window_id = $1 ORDER BY wallet_address ASC`,
    [windowId],
  );
  return result.rows;
}

async function settleEventRow(txSignature, lockAddress) {
  const result = await query(
    `SELECT window_id as "windowId", record_status as "recordStatus",
            record_signature as "recordSignature", record_last_error as "recordLastError"
     FROM lesson.v2_pot_settle_events
     WHERE tx_signature = $1 AND lock_address = $2`,
    [txSignature, lockAddress],
  );
  return result.rows[0] ?? null;
}

// Preflight-passing orchestrator stubs; every on-chain leg is injected.
const okPreflight = {
  readPotConfig: async () => ({ authority: 'TEST-AUTH' }),
  relayAuthority: () => 'TEST-AUTH',
  ensureVaultAta: async () => ({ created: false }),
  scanSettleEvents: async () => ({ scannedSignatures: 0, settleEventsFound: 0, newestSignature: null }),
  recordSettleEvents: async () => ({ executed: true, pending: 0, published: 0, rebooked: 0, failed: 0 }),
};

let app;
beforeAll(async () => {
  app = await createTestServer();
  installFreshReadOverride();
});
afterAll(async () => {
  __setLockV2FreshReadOverride(null);
  await query(`DELETE FROM lesson.community_pot_distribution_snapshots WHERE window_id = ANY($1)`, [ALL_WINDOWS]);
  await query(`DELETE FROM lesson.pot_cycle_runs WHERE window_id = ANY($1)`, [ALL_WINDOWS]);
  await query(`DELETE FROM lesson.v2_pot_settle_events WHERE tx_signature LIKE 'test-potcycle-%'`, []);
  if (trackedWallets.length > 0) {
    await query(`DELETE FROM lesson.user_course_runtime_state WHERE wallet_address = ANY($1)`, [trackedWallets]);
    await query(`DELETE FROM lesson.user_course_enrollments WHERE wallet_address = ANY($1)`, [trackedWallets]);
  }
  await closeTestServer(app);
});

describe('closeCommunityPotWindowAndSnapshotV2 — eligibility matrix', () => {
  it('throws WINDOW_NOT_PAST for the current UTC month', async () => {
    const current = deriveCommunityPotWindowId(new Date());
    await expect(
      closeCommunityPotWindowAndSnapshotV2(current, null, {}),
    ).rejects.toMatchObject({ code: 'WINDOW_NOT_PAST' });
  });

  it('includes only verified-ACTIVE v2 locks (completed-but-unclaimed too); weight = on-chain principal x DB streak', async () => {
    const included = generateTestWallet();
    const includedCompleted = generateTestWallet();
    const nullRead = generateTestWallet();
    const mismatch = generateTestWallet();
    const pending = generateTestWallet();
    const legacy = generateTestWallet();

    // DB principal_amount is a deliberately wrong 999 everywhere — the
    // snapshot must carry the ON-CHAIN principal.
    await armRow(included, { streak: 3 });
    await armRow(includedCompleted, { streak: 2 });
    await armRow(nullRead, { streak: 4 });
    await armRow(mismatch, { streak: 4 });
    await armRow(pending, { streak: 4 });
    await armRow(legacy, { streak: 4, lockAddress: Keypair.generate().publicKey.toBase58() });

    freshReads.set(included, activeRead(included, 5_000_000n));
    freshReads.set(includedCompleted, activeRead(includedCompleted, 2_000_000n));
    freshReads.set(nullRead, null);
    freshReads.set(mismatch, { mismatch: true, reason: 'PROGRAM_OWNER_MISMATCH' });
    freshReads.set(pending, { mismatch: false, status: 'PENDING', principal: 0n, lockStartTs: 1 });
    // `legacy` gets no entry: the derive fence must skip it BEFORE any read.
    freshReads.set(legacy, 'THROW');

    let closeArgs = null;
    const result = await closeCommunityPotWindowAndSnapshotV2(W_MATRIX, null, {
      execute: true,
      readDistributionWindow: async () => null,
      readPotWindow: async () => ({ windowId: W_MATRIX, totalRedirectedAmount: '1000003' }),
      closeDistributionWindow: async (args) => {
        closeArgs = args;
        return { signature: 'test-close-sig' };
      },
    });

    expect(result.processed).toBe(true);
    expect(result.reason).toBe('CLOSED');
    expect(result.signature).toBe('test-close-sig');

    const rows = await snapshotRows(W_MATRIX);
    expect(rows.map((r) => r.walletAddress).sort()).toEqual(
      [included, includedCompleted].sort(),
    );
    const byWallet = new Map(rows.map((r) => [r.walletAddress, r]));
    // weight = on-chain principal x DB streak (NOT the DB's 999 principal)
    expect(byWallet.get(included).principalAmount).toBe('5000000');
    expect(byWallet.get(included).weight).toBe('15000000');
    expect(byWallet.get(included).currentStreak).toBe(3);
    expect(byWallet.get(includedCompleted).principalAmount).toBe('2000000');
    expect(byWallet.get(includedCompleted).weight).toBe('4000000');
    // Payouts stay pinned to the pot total, exactly.
    const paid = rows.reduce((sum, r) => sum + BigInt(r.payoutAmount), 0n);
    expect(paid).toBe(1000003n);

    expect(closeArgs).toMatchObject({
      windowId: W_MATRIX,
      totalWeight: '19000000',
      eligibleRecipientCount: 2,
    });

    // Clear this test's injected reads so the rows read as settled (null)
    // in the later closeV2 tests of this file.
    for (const wallet of [included, includedCompleted, nullRead, mismatch, pending, legacy]) {
      freshReads.delete(wallet);
    }
  });

  it('zero-payout rows are filtered while the seeded sum still equals the exact total', async () => {
    const wallets = [generateTestWallet(), generateTestWallet(), generateTestWallet(), generateTestWallet()];
    for (const wallet of wallets) {
      await armRow(wallet, { streak: 1 });
      freshReads.set(wallet, activeRead(wallet, 1_000_000n));
    }

    let closeArgs = null;
    const result = await closeCommunityPotWindowAndSnapshotV2(W_DUST, null, {
      execute: true,
      readDistributionWindow: async () => null,
      // A 3-unit pot across 4 equal weights: one recipient computes to 0.
      readPotWindow: async () => ({ windowId: W_DUST, totalRedirectedAmount: '3' }),
      closeDistributionWindow: async (args) => {
        closeArgs = args;
        return { signature: 'test-close-sig-dust' };
      },
    });

    expect(result.reason).toBe('CLOSED');
    const rows = await snapshotRows(W_DUST);
    expect(rows.length).toBe(3); // the zero-payout row was dropped
    expect(rows.reduce((sum, r) => sum + BigInt(r.payoutAmount), 0n)).toBe(3n);
    for (const row of rows) {
      expect(BigInt(row.payoutAmount) > 0n).toBe(true);
    }
    // The close is pinned to the FILTERED set.
    expect(closeArgs.eligibleRecipientCount).toBe(3);
    expect(closeArgs.totalWeight).toBe('3000000');

    for (const wallet of wallets) freshReads.delete(wallet);
  });

  it('a thrown on-chain read aborts the ENTIRE run — nothing seeded, nothing closed', async () => {
    const healthy = generateTestWallet();
    const broken = generateTestWallet();
    await armRow(healthy, { streak: 2 });
    await armRow(broken, { streak: 2 });
    freshReads.set(healthy, activeRead(healthy, 1_000_000n));
    freshReads.set(broken, 'THROW');

    let closeCalled = false;
    await expect(
      closeCommunityPotWindowAndSnapshotV2(W_ABORT, null, {
        execute: true,
        readDistributionWindow: async () => null,
        readPotWindow: async () => ({ windowId: W_ABORT, totalRedirectedAmount: '1000000' }),
        closeDistributionWindow: async () => {
          closeCalled = true;
          return { signature: 'never' };
        },
      }),
    ).rejects.toThrow('RPC boom');

    expect(closeCalled).toBe(false);
    expect((await snapshotRows(W_ABORT)).length).toBe(0);

    freshReads.delete(healthy);
    freshReads.delete(broken);
  });
});

describe('runPotCycle — benign vs non-benign reasons (R7 taxonomy)', () => {
  it('NOTHING_TO_DISTRIBUTE is a benign success and writes a receipt row', async () => {
    const result = await runPotCycle({
      windowId: W_NOTHING,
      execute: true,
      log: silentLog,
      deps: {
        ...okPreflight,
        readPotWindow: async () => null,
        readDistributionWindow: async () => null,
        readVaultBalance: async () => ({ potVault: 'stub', balanceAtomic: '0' }),
      },
    });
    expect(result).toMatchObject({ ok: true, benign: true, reason: 'NOTHING_TO_DISTRIBUTE' });

    const receipts = await query(
      `SELECT status, finished_at FROM lesson.pot_cycle_runs WHERE window_id = $1`,
      [W_NOTHING],
    );
    expect(receipts.rows.length).toBe(1);
    expect(receipts.rows[0].status).toBe('NOTHING_TO_DISTRIBUTE');
    expect(receipts.rows[0].finished_at).not.toBeNull();
  });

  it('POT_VAULT_UNDERFUNDED fails (never rescales) and names the bridge script', async () => {
    await query(
      `INSERT INTO lesson.v2_pot_settle_events
         (tx_signature, lock_address, to_pot, block_time, window_id, record_status)
       VALUES ('test-potcycle-underfunded', 'LockUF', 1000, '1901-03-15T00:00:00Z', $1, 'published')
       ON CONFLICT DO NOTHING`,
      [W_UNDERFUNDED],
    );

    const result = await runPotCycle({
      windowId: W_UNDERFUNDED,
      execute: false, // zero sends — the solvency gate fires either way
      log: silentLog,
      deps: {
        ...okPreflight,
        readPotWindow: async (id) =>
          Number(id) === W_UNDERFUNDED
            ? { windowId: W_UNDERFUNDED, totalRedirectedAmount: '1000' }
            : null,
        readDistributionWindow: async () => null,
        readVaultBalance: async () => ({ potVault: 'stub', balanceAtomic: '999' }),
      },
    });
    expect(result).toMatchObject({ ok: false, benign: false, reason: 'POT_VAULT_UNDERFUNDED' });
    expect(result.detail.requiredAtomic).toBe('1000');
    expect(result.detail.balanceAtomic).toBe('999');
    expect(result.detail.remedy).toContain('bridge-v2-pot-transfer.mjs --execute');
  });

  it('ALREADY_CLOSED with seeded rows and nothing pending is benign', async () => {
    await seedSnapshotRow(W_RESUMED, generateTestWallet(), { status: 'distributed' });
    await seedSnapshotRow(W_RESUMED, generateTestWallet(), { status: 'distributed' });

    const existingDistributionWindow = {
      windowId: W_RESUMED,
      totalRedirectedAmount: 1000,
      totalWeight: 2000000,
      eligibleRecipientCount: 2,
      distributedAmount: 1000,
      distributionCount: 2,
      status: 2,
    };
    const result = await runPotCycle({
      windowId: W_RESUMED,
      execute: true,
      log: silentLog,
      deps: {
        ...okPreflight,
        readPotWindow: async (id) =>
          Number(id) === W_RESUMED
            ? { windowId: W_RESUMED, totalRedirectedAmount: '1000' }
            : null,
        readDistributionWindow: async (id) =>
          Number(id) === W_RESUMED ? existingDistributionWindow : null,
        readVaultBalance: async () => ({ potVault: 'stub', balanceAtomic: '0' }),
        distributeBatch: async () => ({ processed: false, reason: 'NO_PENDING_RECIPIENTS' }),
      },
    });
    expect(result).toMatchObject({ ok: true, benign: true, reason: 'ALREADY_CLOSED' });
  });

  it('a row that never reaches distributed makes the final audit FAIL the run', async () => {
    await seedSnapshotRow(W_INCOMPLETE, generateTestWallet(), { status: 'distributed' });
    await seedSnapshotRow(W_INCOMPLETE, generateTestWallet(), { status: 'failed' });

    const existingDistributionWindow = {
      windowId: W_INCOMPLETE,
      totalRedirectedAmount: 1000,
      totalWeight: 2000000,
      eligibleRecipientCount: 2,
      distributedAmount: 500,
      distributionCount: 1,
      status: 1,
    };
    const result = await runPotCycle({
      windowId: W_INCOMPLETE,
      execute: true,
      log: silentLog,
      deps: {
        ...okPreflight,
        readPotWindow: async (id) =>
          Number(id) === W_INCOMPLETE
            ? { windowId: W_INCOMPLETE, totalRedirectedAmount: '1000' }
            : null,
        readDistributionWindow: async (id) =>
          Number(id) === W_INCOMPLETE ? existingDistributionWindow : null,
        readVaultBalance: async () => ({ potVault: 'stub', balanceAtomic: '1000' }),
        // The batch claims nothing (simulates a distribute path that cannot
        // make progress) — the audit must still fail the run.
        distributeBatch: async () => ({ processed: false, reason: 'NO_PENDING_RECIPIENTS' }),
      },
    });
    expect(result).toMatchObject({ ok: false, benign: false, reason: 'DISTRIBUTION_INCOMPLETE' });
    expect(result.detail.snapshotRows.notDistributed).toBe(1);
  });

  it('a concurrently held advisory lock yields POT_CYCLE_ALREADY_RUNNING', async () => {
    const holder = await getPool().connect();
    try {
      await holder.query('select pg_advisory_lock($1, $2)', [
        POT_CYCLE_ADVISORY_LOCK_KEY,
        W_LOCKED,
      ]);
      const result = await runPotCycle({
        windowId: W_LOCKED,
        execute: false,
        log: silentLog,
        deps: {
          ...okPreflight,
          readPotWindow: async () => null,
          readDistributionWindow: async () => null,
          readVaultBalance: async () => ({ potVault: 'stub', balanceAtomic: '0' }),
        },
      });
      expect(result).toMatchObject({
        ok: false,
        benign: false,
        reason: 'POT_CYCLE_ALREADY_RUNNING',
      });
    } finally {
      await holder.query('select pg_advisory_unlock($1, $2)', [
        POT_CYCLE_ADVISORY_LOCK_KEY,
        W_LOCKED,
      ]);
      holder.release();
    }
  });
});

describe('reclaimStalePublishingRows — 15-minute and window fences', () => {
  it('reclaims only >15-minute-old publishing rows of the target window', async () => {
    const stale = generateTestWallet();
    const fresh = generateTestWallet();
    const otherWindow = generateTestWallet();
    await seedSnapshotRow(W_RECLAIM, stale, { status: 'publishing', minutesAgo: 20 });
    await seedSnapshotRow(W_RECLAIM, fresh, { status: 'publishing', minutesAgo: 5 });
    await seedSnapshotRow(W_RECLAIM_OTHER, otherWindow, { status: 'publishing', minutesAgo: 20 });

    const reclaimed = await reclaimStalePublishingRows(W_RECLAIM);
    expect(reclaimed).toEqual([{ walletAddress: stale, courseId: COURSE_ID }]);

    const targetRows = await snapshotRows(W_RECLAIM);
    const byWallet = new Map(targetRows.map((r) => [r.walletAddress, r]));
    expect(byWallet.get(stale).status).toBe('failed');
    expect(byWallet.get(stale).distributionLastError).toBe('reclaimed stale publishing');
    expect(byWallet.get(fresh).status).toBe('publishing');
    expect((await snapshotRows(W_RECLAIM_OTHER))[0].status).toBe('publishing');
  });
});

describe('recordPendingSettleEvents — R2 closed-window re-book', () => {
  it('re-books an event whose window is already closed into the current open month, then publishes', async () => {
    await query(
      `INSERT INTO lesson.v2_pot_settle_events
         (tx_signature, lock_address, to_pot, block_time, window_id)
       VALUES ('test-potcycle-rebook', 'LockRB', 500, '1903-01-15T00:00:00Z', $1)
       ON CONFLICT DO NOTHING`,
      [W_REBOOK],
    );

    const published = [];
    const result = await recordPendingSettleEvents({
      execute: true,
      log: silentLog,
      deps: {
        readDistributionWindow: async (id) =>
          Number(id) === W_REBOOK ? { windowId: W_REBOOK, status: 1 } : null,
        publishRedirect: async (args) => {
          published.push(args);
          return { signature: 'test-record-sig' };
        },
      },
    });

    const currentWindow = deriveCommunityPotWindowId(new Date());
    expect(result.rebooked).toBe(1);
    expect(result.published).toBeGreaterThanOrEqual(1);

    const call = published.find(
      (args) => args.redirectEventId === 'v2-settle:test-potcycle-rebook:LockRB',
    );
    expect(call).toBeDefined();
    expect(call.redirectedAmount).toBe('500');
    // The re-booked harvestedAt must land inside the CURRENT open month.
    expect(deriveCommunityPotWindowId(call.harvestedAt)).toBe(currentWindow);

    const row = await settleEventRow('test-potcycle-rebook', 'LockRB');
    expect(Number(row.windowId)).toBe(currentWindow);
    expect(row.recordStatus).toBe('published');
    expect(row.recordSignature).toBe('test-record-sig');
  });

  it('an open window is NOT re-booked and keeps its block-time attribution', async () => {
    await query(
      `INSERT INTO lesson.v2_pot_settle_events
         (tx_signature, lock_address, to_pot, block_time, window_id)
       VALUES ('test-potcycle-open', 'LockOP', 700, '1903-02-15T00:00:00Z', $1)
       ON CONFLICT DO NOTHING`,
      [W_OPEN],
    );

    const published = [];
    await recordPendingSettleEvents({
      execute: true,
      log: silentLog,
      deps: {
        readDistributionWindow: async () => null, // nothing is closed
        publishRedirect: async (args) => {
          published.push(args);
          return { signature: 'test-record-sig-2' };
        },
      },
    });

    const call = published.find(
      (args) => args.redirectEventId === 'v2-settle:test-potcycle-open:LockOP',
    );
    expect(call).toBeDefined();
    expect(deriveCommunityPotWindowId(call.harvestedAt)).toBe(W_OPEN);

    const row = await settleEventRow('test-potcycle-open', 'LockOP');
    expect(Number(row.windowId)).toBe(W_OPEN);
    expect(row.recordStatus).toBe('published');
  });

  it('never marks published without a confirmed signature', async () => {
    await query(
      `INSERT INTO lesson.v2_pot_settle_events
         (tx_signature, lock_address, to_pot, block_time, window_id)
       VALUES ('test-potcycle-nosig', 'LockNS', 900, '1903-03-15T00:00:00Z', $1)
       ON CONFLICT DO NOTHING`,
      [W_NO_SIG],
    );

    await recordPendingSettleEvents({
      execute: true,
      log: silentLog,
      deps: {
        readDistributionWindow: async () => null,
        publishRedirect: async (args) =>
          args.redirectEventId === 'v2-settle:test-potcycle-nosig:LockNS'
            ? {} // no signature — must NOT count as published
            : { signature: 'other' },
      },
    });

    const row = await settleEventRow('test-potcycle-nosig', 'LockNS');
    expect(row.recordStatus).toBe('failed');
    expect(row.recordSignature).toBeNull();
    expect(row.recordLastError).toContain('no signature');
  });

  it('execute=false publishes nothing and mutates nothing', async () => {
    await query(
      `INSERT INTO lesson.v2_pot_settle_events
         (tx_signature, lock_address, to_pot, block_time, window_id)
       VALUES ('test-potcycle-preview', 'LockPV', 800, '1903-04-15T00:00:00Z', $1)
       ON CONFLICT DO NOTHING`,
      [W_PREVIEW],
    );

    const published = [];
    const result = await recordPendingSettleEvents({
      execute: false,
      log: silentLog,
      deps: {
        readDistributionWindow: async () => ({ windowId: W_PREVIEW }), // even "closed"…
        publishRedirect: async (args) => {
          published.push(args);
          return { signature: 'never' };
        },
      },
    });

    expect(result.executed).toBe(false);
    expect(published.length).toBe(0);
    const row = await settleEventRow('test-potcycle-preview', 'LockPV');
    expect(Number(row.windowId)).toBe(W_PREVIEW); // …no re-book either
    expect(row.recordStatus).toBe('pending');
  });
});

describe('POST /v1/internal/pot-cycle/run', () => {
  it('requires the scheduler key', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/internal/pot-cycle/run',
      headers: { 'x-scheduler-key': 'not-the-secret' },
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a non-numeric windowId', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/internal/pot-cycle/run',
      headers: { 'x-scheduler-key': process.env.SCHEDULER_SECRET },
      payload: { windowId: 'nope' },
    });
    expect(res.statusCode).toBe(400);
  });
});
