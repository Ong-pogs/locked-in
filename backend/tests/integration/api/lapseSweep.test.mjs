// Lapse-sweep + scheduler-fence DB-integration tests (sweep ruling R22 as
// amended; enroll ruling R11/R17/R18).
//
// The on-chain reader is dependency-injected so every judgment is
// deterministic. Covers: the day-fold (shields burn, consecutive dark days
// coalesce to ONE lapse, redirect from the lapse tier), lesson-day skip,
// receipt-conflict skip (no double transition), completed-course exemption,
// tombstoning of settled/PENDING locks (never punished), the never-judge-today
// guard, the 30-day catch-up cap with cursor resume, the internal endpoint's
// auth + validation, and the legacy scheduler fence.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Keypair } from '@solana/web3.js';
import { createTestServer, closeTestServer } from '../../helpers/test-server.mjs';
import { getTestAuthHeaders, generateTestWallet, enrollWalletForTest } from '../../helpers/test-auth.mjs';
import { query } from '../../../src/lib/db.mjs';
import { deriveLockPdaServer } from '../../../src/lib/lockPosition.mjs';
import { runLapseSweepBatch } from '../../../src/lib/lapseSweep.mjs';
import { processRuntimeCandidate } from '../../../src/workers/runtimeSchedulerWorker.mjs';
import { autoMissEventId } from '../../../src/lib/missEvents.mjs';

const COURSE_ID = 'test-kitchen';
const PROGRAM_ID = process.env.VAULT_V2_PROGRAM_ID;
const DAY_MS = 24 * 60 * 60 * 1000;

function utcDay(offset = 0) {
  return new Date(Date.now() + offset * DAY_MS).toISOString().slice(0, 10);
}

function derivedPda(wallet) {
  return deriveLockPdaServer(PROGRAM_ID, wallet, COURSE_ID).toBase58();
}

function activeAccount(wallet, lockStartOffsetDays) {
  return {
    mismatch: false,
    status: 'ACTIVE',
    principal: 5_000_000n,
    lockStartTs: Math.floor((Date.now() + lockStartOffsetDays * DAY_MS) / 1000),
    lockAddress: derivedPda(wallet),
  };
}

// Arm a (wallet, course) exactly the way enroll does: enrollment row + v2 PDA
// custody + lock_start_at.
async function armV2(wallet, lockStartOffsetDays, extra = {}) {
  await enrollWalletForTest(query, wallet, COURSE_ID);
  await query(
    `INSERT INTO lesson.user_course_runtime_state
       (wallet_address, course_id, fuel_cap, lock_account_address, lock_start_at, principal_amount)
     VALUES ($1, $2, 7, $3, $4, 5000000)
     ON CONFLICT (wallet_address, course_id) DO UPDATE
       SET lock_account_address = $3, lock_start_at = $4`,
    [wallet, COURSE_ID, extra.lockAddress ?? derivedPda(wallet),
     new Date(Date.now() + lockStartOffsetDays * DAY_MS).toISOString()],
  );
}

async function runtimeRow(wallet) {
  const res = await query(
    `SELECT *, last_miss_day::text AS last_miss_day_text
     FROM lesson.user_course_runtime_state WHERE wallet_address = $1 AND course_id = $2`,
    [wallet, COURSE_ID],
  );
  return res.rows[0] ?? null;
}

async function receipts(wallet) {
  const res = await query(
    `SELECT miss_day::text AS day, miss_event_id AS id, reason
     FROM lesson.miss_consequence_receipts
     WHERE wallet_address = $1 AND course_id = $2 ORDER BY miss_day ASC`,
    [wallet, COURSE_ID],
  );
  return res.rows;
}

// Sweep a single wallet deterministically: the DI reader answers only for
// that wallet; other candidates in the shared test DB read as unreadable and
// are skipped untouched (fail closed, never punished).
async function sweepWallet(wallet, account, { asOfDay = utcDay(-1), batchSize = 500 } = {}) {
  const readLockFresh = async (w) => {
    if (w !== wallet) throw new Error('not under test');
    return account;
  };
  let cursor = null;
  const totals = { missesApplied: 0, lessonDays: 0, exemptedCompleted: 0, closedLocks: 0, processed: 0 };
  do {
    const batch = await runLapseSweepBatch({ asOfDay, batchSize, cursor, readLockFresh });
    totals.missesApplied += batch.missesApplied;
    totals.lessonDays += batch.lessonDays;
    totals.exemptedCompleted += batch.exemptedCompleted;
    totals.closedLocks += batch.closedLocks;
    totals.processed += batch.processed;
    cursor = batch.nextCursor;
  } while (cursor != null);
  return totals;
}

// Track wallets so afterAll can drop their runtime rows: the leaderboard
// computation does one devnet RPC per runtime row across ALL wallets, so
// leftover test rows slow every later suite run.
const trackedWallets = [];
function newTestWallet() {
  const wallet = generateTestWallet();
  trackedWallets.push(wallet);
  return wallet;
}

let app;
beforeAll(async () => { app = await createTestServer(); });
afterAll(async () => {
  if (trackedWallets.length > 0) {
    await query(`DELETE FROM lesson.user_course_runtime_state WHERE wallet_address = ANY($1)`, [trackedWallets]);
    await query(`DELETE FROM lesson.user_course_enrollments WHERE wallet_address = ANY($1)`, [trackedWallets]);
  }
  await closeTestServer(app);
});

describe('runLapseSweepBatch — day-fold', () => {
  it('never judges today or the future', async () => {
    for (const asOfDay of [utcDay(0), utcDay(3)]) {
      await expect(runLapseSweepBatch({ asOfDay })).rejects.toMatchObject({
        code: 'SWEEP_DAY_IN_FUTURE',
      });
    }
  });

  it('dark days burn shields then coalesce into ONE lapse; redirect from the lapse tier', async () => {
    const wallet = newTestWallet();
    await armV2(wallet, -5); // lock started 5 days ago, zero activity since

    const totals = await sweepWallet(wallet, activeAccount(wallet, -5));
    // Judged: lock-start day .. yesterday = 5 days (practice R13 day-fold).
    expect(totals.missesApplied).toBe(5);

    const rows = await receipts(wallet);
    expect(rows.map((r) => r.day)).toEqual([utcDay(-5), utcDay(-4), utcDay(-3), utcDay(-2), utcDay(-1)]);
    expect(rows.map((r) => r.reason)).toEqual([
      'SHIELD_ABSORBED', 'SHIELD_ABSORBED', 'SHIELD_ABSORBED',
      'LAPSE_APPLIED', 'LAPSE_ALREADY_OPEN',
    ]);
    expect(rows.map((r) => r.id)).toEqual(
      rows.map((r) => autoMissEventId(wallet, COURSE_ID, r.day)),
    );

    const row = await runtimeRow(wallet);
    expect(Number(row.shields)).toBe(0);
    expect(Number(row.lapse_count)).toBe(1); // consecutive dark days = ONE lapse
    expect(row.lapse_open).toBe(true);
    expect(Number(row.current_streak)).toBe(0); // no immortal leaderboard streaks
    expect(Number(row.current_yield_redirect_bps)).toBe(5000); // lapse 1 -> keep 50%
    expect(Number(row.saver_count)).toBe(0); // legacy saver ramp never stacked
    expect(row.last_miss_day).not.toBeNull();

    // Re-run: fully idempotent — every day already judged.
    const again = await sweepWallet(wallet, activeAccount(wallet, -5));
    expect(again.missesApplied).toBe(0);
    expect((await receipts(wallet)).length).toBe(5);
  });

  it('a lesson-day inside the window is skipped (no receipt, no transition)', async () => {
    const wallet = newTestWallet();
    const headers = await getTestAuthHeaders(wallet);
    // The submit below precedes armV2, so establish the staked-course
    // precondition the lesson routes require up front.
    await enrollWalletForTest(query, wallet, COURSE_ID);
    // Real completion (creates the verified_completion_events row), backdated
    // into the middle of the dark window.
    const submit = await app.inject({
      method: 'POST',
      url: '/v1/progress/lessons/tk-1/submit',
      headers,
      payload: {
        attemptId: randomUUID(),
        answers: [
          { questionId: 'tk-1-q1', answerText: 'chain-cards' },
          { questionId: 'tk-1-q2', answerText: 'Green' },
        ],
      },
    });
    expect(submit.statusCode).toBe(200);
    await query(
      `UPDATE lesson.verified_completion_events SET completion_day = $3::date
       WHERE wallet_address = $1 AND course_id = $2`,
      [wallet, COURSE_ID, utcDay(-3)],
    );
    await query(
      `UPDATE lesson.user_course_runtime_state
       SET last_completed_day = NULL, current_streak = 0, last_miss_day = NULL
       WHERE wallet_address = $1 AND course_id = $2`,
      [wallet, COURSE_ID],
    );
    await armV2(wallet, -5);

    const totals = await sweepWallet(wallet, activeAccount(wallet, -5));
    expect(totals.lessonDays).toBe(1);
    expect(totals.missesApplied).toBe(4); // D-5, D-4, D-2, D-1 — not D-3

    const rows = await receipts(wallet);
    expect(rows.map((r) => r.day)).toEqual([utcDay(-5), utcDay(-4), utcDay(-2), utcDay(-1)]);
  });

  it('receipt-conflict skip: a day already judged by another engine causes no second transition', async () => {
    const wallet = newTestWallet();
    await armV2(wallet, -2);
    // Another producer (ad-hoc id) already punished yesterday.
    await query(
      `INSERT INTO lesson.miss_consequence_receipts
         (wallet_address, course_id, miss_event_id, miss_day, applied, reason,
          saver_count_before, saver_count_after, redirect_bps_before, redirect_bps_after,
          extension_days_before, extension_days_after)
       VALUES ($1, $2, $3, $4::date, true, 'SHIELD_ABSORBED', 0, 0, 0, 0, 0, 0)`,
      [wallet, COURSE_ID, `legacy:${randomUUID()}`, utcDay(-1)],
    );

    const totals = await sweepWallet(wallet, activeAccount(wallet, -2));
    // Only D-2 newly judged; D-1's pre-existing receipt blocks the transition.
    expect(totals.missesApplied).toBe(1);
    const row = await runtimeRow(wallet);
    expect(Number(row.shields)).toBe(2); // exactly ONE shield burned by the sweep
    expect((await receipts(wallet)).length).toBe(2);
    // The day cursor still advanced past the duplicate day.
    expect(row.last_miss_day_text).toBe(utcDay(-1));
  });

  it('completed course is exempt (lazy backfill) and never accrues lapses', async () => {
    const wallet = newTestWallet();
    const lessons = await query(
      `SELECT DISTINCT pl.lesson_id FROM lesson.published_modules pm
       JOIN lesson.published_lessons pl ON pl.module_id = pm.module_id AND pl.release_id = pm.release_id
       WHERE pm.course_id = $1`,
      [COURSE_ID],
    );
    for (const { lesson_id } of lessons.rows) {
      await query(
        `INSERT INTO lesson.user_lesson_progress (wallet_address, lesson_id, completed, completed_at, updated_at)
         VALUES ($1, $2, true, now(), now()) ON CONFLICT (wallet_address, lesson_id) DO UPDATE SET completed = true`,
        [wallet, lesson_id],
      );
    }
    await armV2(wallet, -10); // course complete but course_completed_at not yet stamped

    const totals = await sweepWallet(wallet, activeAccount(wallet, -10));
    expect(totals.exemptedCompleted).toBe(1);
    expect(totals.missesApplied).toBe(0);
    expect((await receipts(wallet)).length).toBe(0);
    const row = await runtimeRow(wallet);
    expect(row.course_completed_at).not.toBeNull(); // backfilled by the sweep
    expect(Number(row.lapse_count)).toBe(0);
  });

  it.each([
    ['settled (account missing)', () => null],
    ['PENDING (never funded)', (wallet) => ({ mismatch: false, status: 'PENDING', principal: 0n, lockStartTs: 1, lockAddress: derivedPda(wallet) })],
  ])('%s -> tombstone, NO miss ever applied', async (_label, accountFor) => {
    const wallet = newTestWallet();
    await armV2(wallet, -7);

    const totals = await sweepWallet(wallet, accountFor(wallet));
    expect(totals.closedLocks).toBe(1);
    expect(totals.missesApplied).toBe(0);
    expect((await receipts(wallet)).length).toBe(0);

    const row = await runtimeRow(wallet);
    expect(row.lock_account_address).toBeNull(); // self-healing universe
    expect(row.principal_amount).toBe('0');
  });

  it('legacy-PDA rows are never judged by the sweep', async () => {
    const wallet = newTestWallet();
    const legacyAddress = Keypair.generate().publicKey.toBase58();
    await armV2(wallet, -7, { lockAddress: legacyAddress });

    await sweepWallet(wallet, activeAccount(wallet, -7));
    // 7 dark days, yet nothing judged and custody untouched — the row is the
    // legacy worker's, not the sweep's.
    expect((await receipts(wallet)).length).toBe(0);
    const row = await runtimeRow(wallet);
    expect(row.lock_account_address).toBe(legacyAddress);
    expect(Number(row.shields)).toBe(3);
  });

  it('catch-up is capped at 30 days per run and resumes from the cursor next run', async () => {
    const wallet = newTestWallet();
    await armV2(wallet, -40);

    const first = await sweepWallet(wallet, activeAccount(wallet, -40));
    expect(first.missesApplied).toBe(30);
    let row = await runtimeRow(wallet);
    expect(row.last_miss_day_text).toBe(utcDay(-11)); // D-40 .. D-11 judged

    const second = await sweepWallet(wallet, activeAccount(wallet, -40));
    expect(second.missesApplied).toBe(10); // D-10 .. D-1
    row = await runtimeRow(wallet);
    expect(row.last_miss_day_text).toBe(utcDay(-1));
    expect((await receipts(wallet)).length).toBe(40);
    // 40 dark days still coalesce into ONE lapse (no lesson-day in between).
    expect(Number(row.lapse_count)).toBe(1);
  });
});

describe('POST /v1/internal/lapse/sweep', () => {
  it('requires the scheduler key', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/internal/lapse/sweep',
      headers: { 'x-scheduler-key': 'not-the-secret' },
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a same-day or future asOfDay', async () => {
    for (const asOfDay of [utcDay(0), utcDay(1), 'not-a-date']) {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/internal/lapse/sweep',
        headers: { 'x-scheduler-key': process.env.SCHEDULER_SECRET },
        payload: { asOfDay },
      });
      expect(res.statusCode).toBe(400);
    }
  });

  it('rejects an out-of-range batchSize', async () => {
    for (const batchSize of [0, 1001, 'nope']) {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/internal/lapse/sweep',
        headers: { 'x-scheduler-key': process.env.SCHEDULER_SECRET },
        payload: { batchSize },
      });
      expect(res.statusCode).toBe(400);
    }
  });

  it('returns the batch counters and a null cursor on the final batch', async () => {
    // No DI here: candidates read the real (devnet) chain — every armed row
    // in the shared DB either tombstones or skips unreadable; the response
    // contract is what is under test.
    const res = await app.inject({
      method: 'POST',
      url: '/v1/internal/lapse/sweep',
      headers: { 'x-scheduler-key': process.env.SCHEDULER_SECRET },
      payload: { batchSize: 1000, asOfDay: utcDay(-1) },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ asOfDay: utcDay(-1) });
    for (const key of ['processed', 'missesApplied', 'lessonDays', 'exemptedCompleted', 'closedLocks', 'skippedUnreadable']) {
      expect(typeof body[key]).toBe('number');
    }
    expect(body.nextCursor === null || typeof body.nextCursor === 'string').toBe(true);
  }, 60_000);
});

describe('runtime scheduler fence (enroll R11)', () => {
  function fakeApp() {
    return { log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } };
  }

  it('a v2-armed candidate is skipped, touched, and its custody columns never clobbered', async () => {
    const wallet = newTestWallet();
    await armV2(wallet, -1);
    const before = await runtimeRow(wallet);

    const app2 = fakeApp();
    const result = await processRuntimeCandidate(
      app2,
      {
        walletAddress: wallet,
        courseId: COURSE_ID,
        lockAccountAddress: derivedPda(wallet), // v2 PDA != legacy PDA
        updatedAt: before.updated_at,
        lastCompletedDay: null,
        lastMissDay: null,
        courseCompletedAt: null,
      },
      new Date(),
    );
    expect(result).toEqual({ harvestProcessed: 0, missProcessed: 0 });
    expect(app2.log.info).toHaveBeenCalledWith(
      expect.objectContaining({ walletAddress: wallet }),
      'runtime_scheduler.skipped_v2_lock',
    );

    const after = await runtimeRow(wallet);
    // Custody untouched (sync never ran), queue position released.
    expect(after.lock_account_address).toBe(before.lock_account_address);
    expect(after.principal_amount).toBe(before.principal_amount);
    expect(new Date(after.updated_at).getTime()).toBeGreaterThan(new Date(before.updated_at).getTime());
    // No miss receipts from the legacy engine.
    expect((await receipts(wallet)).length).toBe(0);
  });

  it('a legacy candidate whose lock read fails is touched so it cannot pin the queue', async () => {
    const wallet = newTestWallet();
    const { deriveLegacyLockAccountAddress } = await import('../../../src/lib/lockVault.mjs');
    const legacyPda = deriveLegacyLockAccountAddress(wallet, COURSE_ID);
    await armV2(wallet, -1, { lockAddress: legacyPda });
    const before = await runtimeRow(wallet);

    const app2 = fakeApp();
    // Random wallet -> no legacy lock account on devnet -> snapshot read throws.
    const result = await processRuntimeCandidate(
      app2,
      {
        walletAddress: wallet,
        courseId: COURSE_ID,
        lockAccountAddress: legacyPda,
        updatedAt: before.updated_at,
        lastCompletedDay: null,
        lastMissDay: null,
        courseCompletedAt: null,
      },
      new Date(),
    );
    expect(result).toEqual({ harvestProcessed: 0, missProcessed: 0 });
    expect(app2.log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ walletAddress: wallet }),
      'runtime_scheduler.lock_missing',
    );
    const after = await runtimeRow(wallet);
    expect(new Date(after.updated_at).getTime()).toBeGreaterThan(new Date(before.updated_at).getTime());
  }, 30_000);
});
