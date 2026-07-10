// Enroll-on-deposit DB-integration tests (enroll ruling R18).
//
// The fresh on-chain reader is dependency-injected (repository option or the
// lockPosition test override) so every acceptance decision is deterministic —
// no RPC. Covers: retryable states never persist (PENDING / missing /
// principal-0), gates fire before any RPC (completed / unknown / lessonless
// course), PDA tripwire, the engine-reset matrix keyed to on-chain lock
// identity, the eligibility pre-gate, and the route contract.

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Keypair } from '@solana/web3.js';
import { createTestServer, closeTestServer } from '../../helpers/test-server.mjs';
import { getTestAuthHeaders, generateTestWallet } from '../../helpers/test-auth.mjs';
import { query } from '../../../src/lib/db.mjs';
import {
  deriveLockPdaServer,
  readLockPosition,
  __setLockV2FreshReadOverride,
  __clearPositionCache,
} from '../../../src/lib/lockPosition.mjs';
import { enrollActiveLockServerSide } from '../../../src/modules/progress/repository.mjs';

const COURSE_ID = 'test-kitchen';
const PROGRAM_ID = process.env.VAULT_V2_PROGRAM_ID;

function derivedPda(wallet, courseId = COURSE_ID) {
  return deriveLockPdaServer(PROGRAM_ID, wallet, courseId).toBase58();
}

function activeAccount(wallet, { principal = 5_000_000n, lockStartTs = 1_750_000_000 } = {}) {
  return {
    mismatch: false,
    status: 'ACTIVE',
    principal,
    lockStartTs,
    lockAddress: derivedPda(wallet),
  };
}

async function enrollmentRow(wallet) {
  const res = await query(
    `SELECT 1 FROM lesson.user_course_enrollments WHERE wallet_address = $1 AND course_id = $2`,
    [wallet, COURSE_ID],
  );
  return res.rowCount;
}

async function runtimeRow(wallet) {
  const res = await query(
    `SELECT * FROM lesson.user_course_runtime_state WHERE wallet_address = $1 AND course_id = $2`,
    [wallet, COURSE_ID],
  );
  return res.rows[0] ?? null;
}

async function seedCourseComplete(wallet) {
  const lessons = await query(
    `SELECT DISTINCT pl.lesson_id
       FROM lesson.published_modules pm
       JOIN lesson.published_lessons pl
         ON pl.module_id = pm.module_id AND pl.release_id = pm.release_id
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
afterEach(() => {
  __setLockV2FreshReadOverride(null);
  __clearPositionCache();
});

describe('enrollActiveLockServerSide — retryable states never persist (R6)', () => {
  it.each([
    ['PENDING', (wallet) => ({ mismatch: false, status: 'PENDING', principal: 0n, lockStartTs: 1, lockAddress: derivedPda(wallet) })],
    ['account missing', () => null],
    ['ACTIVE with principal 0', (wallet) => ({ ...activeAccount(wallet), principal: 0n })],
  ])('%s -> ENROLL_RETRY after bounded re-reads, zero DB writes', async (_label, accountFor) => {
    const wallet = newTestWallet();
    let calls = 0;
    const readLockFresh = async () => { calls += 1; return accountFor(wallet); };

    let error;
    try {
      await enrollActiveLockServerSide(wallet, COURSE_ID, { readLockFresh, retryDelayMs: 1 });
    } catch (e) { error = e; }

    expect(error?.code).toBe('ENROLL_RETRY');
    expect(error?.statusCode).toBe(409);
    expect(error?.retryable).toBe(true);
    expect(error?.retryAfterMs).toBe(4000);
    expect(calls).toBe(4); // initial read + 3 re-reads
    expect(await enrollmentRow(wallet)).toBe(0);
    expect(await runtimeRow(wallet)).toBeNull();
  });
});

describe('enrollActiveLockServerSide — gates before any RPC (R2/R3)', () => {
  it('completed course -> 403 COURSE_COMPLETED with the reader never called', async () => {
    const wallet = newTestWallet();
    await seedCourseComplete(wallet);
    let calls = 0;
    let error;
    try {
      await enrollActiveLockServerSide(wallet, COURSE_ID, {
        readLockFresh: async () => { calls += 1; return activeAccount(wallet); },
        retryDelayMs: 1,
      });
    } catch (e) { error = e; }
    expect(error?.code).toBe('COURSE_COMPLETED');
    expect(error?.statusCode).toBe(403);
    expect(calls).toBe(0);
    expect(await enrollmentRow(wallet)).toBe(0);
  });

  it('unknown course -> 404 COURSE_NOT_FOUND with the reader never called', async () => {
    const wallet = newTestWallet();
    let calls = 0;
    let error;
    try {
      await enrollActiveLockServerSide(wallet, 'no-such-course', {
        readLockFresh: async () => { calls += 1; return null; },
        retryDelayMs: 1,
      });
    } catch (e) { error = e; }
    expect(error?.code).toBe('COURSE_NOT_FOUND');
    expect(error?.statusCode).toBe(404);
    expect(calls).toBe(0);
  });

  it('lessonless placeholder course -> 403 COURSE_NOT_LOCKABLE (never a lapse trap)', async () => {
    const placeholderId = `placeholder-${randomUUID().slice(0, 8)}`;
    await query(
      `INSERT INTO lesson.courses (id, slug, title, description, category, difficulty)
       VALUES ($1, $1, 'Placeholder', 'No lessons yet', 'web3', 'beginner')`,
      [placeholderId],
    );
    const wallet = newTestWallet();
    let calls = 0;
    let error;
    try {
      await enrollActiveLockServerSide(wallet, placeholderId, {
        readLockFresh: async () => { calls += 1; return null; },
        retryDelayMs: 1,
      });
    } catch (e) { error = e; }
    expect(error?.code).toBe('COURSE_NOT_LOCKABLE');
    expect(error?.statusCode).toBe(403);
    expect(calls).toBe(0);
  });
});

describe('enrollActiveLockServerSide — engine-reset matrix (R8)', () => {
  async function seedRuntime(wallet, fields) {
    await query(
      `INSERT INTO lesson.user_course_runtime_state
         (wallet_address, course_id, fuel_cap, current_streak, shields, lapse_count, lapse_open,
          consecutive_lesson_days, lock_account_address, lock_start_at, stable_mint, lock_end_at)
       VALUES ($1, $2, 7, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (wallet_address, course_id) DO UPDATE SET
         current_streak = $3, shields = $4, lapse_count = $5, lapse_open = $6,
         consecutive_lesson_days = $7, lock_account_address = $8, lock_start_at = $9,
         stable_mint = $10, lock_end_at = $11`,
      [
        wallet, COURSE_ID,
        fields.streak, fields.shields, fields.lapseCount, fields.lapseOpen,
        fields.consecutive, fields.lockAddress, fields.lockStartAt,
        fields.stableMint ?? null, fields.lockEndAt ?? null,
      ],
    );
  }

  it('stored NULL -> full reset + custody armed with the derived PDA', async () => {
    const wallet = newTestWallet();
    await seedRuntime(wallet, {
      streak: 7, shields: 0, lapseCount: 2, lapseOpen: true, consecutive: 2,
      lockAddress: null, lockStartAt: null,
      stableMint: 'So11111111111111111111111111111111111111112',
      lockEndAt: new Date().toISOString(),
    });

    const result = await enrollActiveLockServerSide(wallet, COURSE_ID, {
      readLockFresh: async () => activeAccount(wallet),
      retryDelayMs: 1,
    });
    expect(result.enrolled).toBe(true);
    expect(result.engineReset).toBe(true);
    expect(result.freshEnrollment).toBe(true);
    expect(result.lockAddress).toBe(derivedPda(wallet));
    expect(result.status).toBe('ACTIVE');
    expect(result.principalUi).toBe('5');

    const row = await runtimeRow(wallet);
    expect(Number(row.current_streak)).toBe(0);
    expect(Number(row.shields)).toBe(3);
    expect(Number(row.lapse_count)).toBe(0);
    expect(row.lapse_open).toBe(false);
    expect(Number(row.consecutive_lesson_days)).toBe(0);
    expect(row.lock_account_address).toBe(derivedPda(wallet));
    expect(row.principal_amount).toBe('5000000');
    // v2 has neither field — never fabricated, and cleared on reset.
    expect(row.stable_mint).toBeNull();
    expect(row.lock_end_at).toBeNull();
    expect(await enrollmentRow(wallet)).toBe(1);
  });

  it('stored legacy PDA -> full reset (legacy punishment state never inherited)', async () => {
    const wallet = newTestWallet();
    await seedRuntime(wallet, {
      streak: 4, shields: 1, lapseCount: 1, lapseOpen: true, consecutive: 1,
      lockAddress: Keypair.generate().publicKey.toBase58(), // old-program PDA
      lockStartAt: new Date('2026-01-01T00:00:00Z').toISOString(),
    });

    const result = await enrollActiveLockServerSide(wallet, COURSE_ID, {
      readLockFresh: async () => activeAccount(wallet),
      retryDelayMs: 1,
    });
    expect(result.engineReset).toBe(true);
    const row = await runtimeRow(wallet);
    expect(Number(row.lapse_count)).toBe(0);
    expect(Number(row.shields)).toBe(3);
  });

  it('replay (same PDA, same lock_start_ts) -> NO reset; lapse_count preserved', async () => {
    const wallet = newTestWallet();
    const lockStartTs = 1_750_000_000;
    await enrollActiveLockServerSide(wallet, COURSE_ID, {
      readLockFresh: async () => activeAccount(wallet, { lockStartTs }),
      retryDelayMs: 1,
    });
    // Live lock accrues engine state...
    await query(
      `UPDATE lesson.user_course_runtime_state
       SET lapse_count = 1, current_streak = 4, shields = 1
       WHERE wallet_address = $1 AND course_id = $2`,
      [wallet, COURSE_ID],
    );

    // ...then the client replays enroll against the SAME live lock.
    const replay = await enrollActiveLockServerSide(wallet, COURSE_ID, {
      readLockFresh: async () => activeAccount(wallet, { lockStartTs, principal: 7_000_000n }),
      retryDelayMs: 1,
    });
    expect(replay.engineReset).toBe(false);
    expect(replay.freshEnrollment).toBe(false);

    const row = await runtimeRow(wallet);
    expect(Number(row.lapse_count)).toBe(1); // replay can never wipe lapses
    expect(Number(row.current_streak)).toBe(4);
    expect(row.principal_amount).toBe('7000000'); // principal refreshed
  });

  it('same PDA + changed lock_start_ts -> relock-after-settlement reset', async () => {
    const wallet = newTestWallet();
    await enrollActiveLockServerSide(wallet, COURSE_ID, {
      readLockFresh: async () => activeAccount(wallet, { lockStartTs: 1_750_000_000 }),
      retryDelayMs: 1,
    });
    await query(
      `UPDATE lesson.user_course_runtime_state SET lapse_count = 2, current_streak = 9
       WHERE wallet_address = $1 AND course_id = $2`,
      [wallet, COURSE_ID],
    );

    // PDA closed (force-return) and re-inited -> new immutable lock_start_ts.
    const relock = await enrollActiveLockServerSide(wallet, COURSE_ID, {
      readLockFresh: async () => activeAccount(wallet, { lockStartTs: 1_760_000_000 }),
      retryDelayMs: 1,
    });
    expect(relock.engineReset).toBe(true);
    const row = await runtimeRow(wallet);
    expect(Number(row.lapse_count)).toBe(0);
    expect(Number(row.current_streak)).toBe(0);
  });
});

describe('POST /v1/locks/:courseId/enroll (route contract, R1/R4)', () => {
  it('requires auth', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/locks/${COURSE_ID}/enroll`,
      payload: { lockAddress: Keypair.generate().publicKey.toBase58() },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects an unparseable lockAddress with 400 INVALID_LOCK_ADDRESS', async () => {
    const headers = await getTestAuthHeaders(newTestWallet());
    const res = await app.inject({
      method: 'POST',
      url: `/v1/locks/${COURSE_ID}/enroll`,
      headers,
      payload: { lockAddress: 'not-a-pubkey' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('INVALID_LOCK_ADDRESS');
  });

  it('client PDA mismatch -> 409 LOCK_ADDRESS_MISMATCH, nothing persisted (config-skew tripwire)', async () => {
    const wallet = newTestWallet();
    const headers = await getTestAuthHeaders(wallet);
    let calls = 0;
    __setLockV2FreshReadOverride(async () => { calls += 1; return activeAccount(wallet); });

    const res = await app.inject({
      method: 'POST',
      url: `/v1/locks/${COURSE_ID}/enroll`,
      headers,
      payload: { lockAddress: Keypair.generate().publicKey.toBase58() },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('LOCK_ADDRESS_MISMATCH');
    expect(calls).toBe(0); // tripwire fires before any chain read
    expect(await enrollmentRow(wallet)).toBe(0);
  });

  it('on-chain owner mismatch from the fresh read -> 409 LOCK_ADDRESS_MISMATCH', async () => {
    const wallet = newTestWallet();
    const headers = await getTestAuthHeaders(wallet);
    __setLockV2FreshReadOverride(async () => ({
      mismatch: true, reason: 'LOCK_OWNER_MISMATCH', lockAddress: derivedPda(wallet),
    }));

    const res = await app.inject({
      method: 'POST',
      url: `/v1/locks/${COURSE_ID}/enroll`,
      headers,
      payload: { lockAddress: derivedPda(wallet) },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('LOCK_ADDRESS_MISMATCH');
    expect(await enrollmentRow(wallet)).toBe(0);
  });

  it('ENROLL_RETRY carries the retry pacing body', async () => {
    const wallet = newTestWallet();
    const headers = await getTestAuthHeaders(wallet);
    __setLockV2FreshReadOverride(async () => null);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/locks/${COURSE_ID}/enroll`,
      headers,
      payload: { lockAddress: derivedPda(wallet) },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      code: 'ENROLL_RETRY',
      retryable: true,
      retryAfterMs: 4000,
    });
  });

  it('verified ACTIVE lock -> 200, enrollment + custody armed, position cache primed', async () => {
    const wallet = newTestWallet();
    const headers = await getTestAuthHeaders(wallet);
    __setLockV2FreshReadOverride(async () => activeAccount(wallet));

    const res = await app.inject({
      method: 'POST',
      url: `/v1/locks/${COURSE_ID}/enroll`,
      headers,
      payload: { lockAddress: derivedPda(wallet) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      enrolled: true,
      courseId: COURSE_ID,
      status: 'ACTIVE',
      freshEnrollment: true,
      engineReset: true,
      lockAddress: derivedPda(wallet),
    });
    expect(await enrollmentRow(wallet)).toBe(1);

    // R10: the primed cache serves ACTIVE immediately (no RPC — the override
    // is NOT consulted by a cache hit).
    const cached = await readLockPosition(wallet, COURSE_ID);
    expect(cached.status).toBe('ACTIVE');
    expect(cached.lockAddress).toBe(derivedPda(wallet));
  });
});

describe('GET /v1/locks/:courseId/eligibility (R12 pre-gate)', () => {
  it('fresh wallet on a lockable course -> eligible', async () => {
    const headers = await getTestAuthHeaders(newTestWallet());
    const res = await app.inject({
      method: 'GET',
      url: `/v1/locks/${COURSE_ID}/eligibility`,
      headers,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ eligible: true });
  });

  it('completed course -> eligible false with COURSE_COMPLETED', async () => {
    const wallet = newTestWallet();
    await seedCourseComplete(wallet);
    const headers = await getTestAuthHeaders(wallet);
    const res = await app.inject({
      method: 'GET',
      url: `/v1/locks/${COURSE_ID}/eligibility`,
      headers,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ eligible: false, code: 'COURSE_COMPLETED' });
  });

  it('unknown course -> eligible false with COURSE_NOT_FOUND', async () => {
    const headers = await getTestAuthHeaders(newTestWallet());
    const res = await app.inject({
      method: 'GET',
      url: '/v1/locks/course-that-does-not-exist/eligibility',
      headers,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ eligible: false, code: 'COURSE_NOT_FOUND' });
  });
});
