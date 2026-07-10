// Voucher auto-issue + storage DB-integration tests (voucher-autoissue
// ruling R11; migration renumbered 0047 per the round-3 coordination header).
//
// Covers: (R11.1) a voucher failure never touches the completing submit —
// sign+store is strictly post-commit, never inside withTransactionAsWallet;
// (R11.2) fresh completion stores the full 8-field voucher; (R11.3) the
// position read lazily heals a completed course with no stored row (the
// pre-0047 completer path); (R11.4) NONE/PENDING/CLOSED get voucher:null
// with zero DB writes; (R11.5) an expired stored row is re-signed at the
// identical bps; (R11.6) manufactured bps drift logs at error and serves the
// stored voucher unchanged — never a silent re-sign; (R11.7) with the table
// absent, submit / GET position / POST voucher behave exactly like current
// master; plus the R5/R8 idempotent UPSERT through the POST endpoint.

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import nacl from 'tweetnacl';
import bs58Module from 'bs58';
import { PublicKey } from '@solana/web3.js';
import { createTestServer, closeTestServer } from '../../helpers/test-server.mjs';
import { getTestAuthHeaders, generateTestWallet } from '../../helpers/test-auth.mjs';
import { query } from '../../../src/lib/db.mjs';
import { yieldBpsForLapses } from '../../../src/lib/claimVoucher.mjs';
import {
  deriveLockPdaServer,
  primeLockPositionCache,
  __clearPositionCache,
} from '../../../src/lib/lockPosition.mjs';
import { getStoredCompletionVoucher } from '../../../src/modules/progress/repository.mjs';

const bs58 = bs58Module.decode ? bs58Module : bs58Module.default;

const COURSE_ID = 'test-kitchen'; // smallest seeded course (1 module, 3 lessons)
const PROGRAM_ID = process.env.VAULT_V2_PROGRAM_ID;
const WORKER_PUBKEY = new PublicKey(
  bs58.decode(process.env.LOCK_VAULT_WORKER_PRIVATE_KEY).slice(32),
).toBase58();

// MCQ-only lessons of test-kitchen — gradable without the LLM validator.
const LESSON_3 = { id: 'tk-3', answers: [
  { questionId: 'tk-3-q1', answerText: 'Yes' },
  { questionId: 'tk-3-q2', answerText: '10' },
] };

function derivedPda(wallet, courseId = COURSE_ID) {
  return deriveLockPdaServer(PROGRAM_ID, wallet, courseId).toBase58();
}

function clientCourseHash(courseId) {
  return createHash('sha256').update(courseId, 'utf8').digest();
}
function clientLockPda(owner, courseId = COURSE_ID) {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('lock-v2'), new PublicKey(owner).toBuffer(), clientCourseHash(courseId)],
    new PublicKey(PROGRAM_ID),
  );
  return pda.toBase58();
}

function activePosition(wallet) {
  return {
    courseId: COURSE_ID,
    status: 'ACTIVE',
    lockAddress: derivedPda(wallet),
    principalUi: '5',
    principalAtomic: '5000000',
    lockStartTs: 1_750_000_000,
    liveValueUi: null,
    asOf: new Date().toISOString(),
  };
}

function inertPosition(status) {
  return {
    courseId: COURSE_ID,
    status,
    lockAddress: null,
    principalUi: null,
    principalAtomic: null,
    lockStartTs: null,
    liveValueUi: null,
    asOf: new Date().toISOString(),
  };
}

// Complete every lesson EXCEPT tk-3 by direct seed so the REAL submit of
// tk-3 is the course-completing one (same pattern as practiceMode tests).
async function seedAllButLast(wallet) {
  const lessons = await query(
    `SELECT DISTINCT pl.lesson_id
       FROM lesson.published_modules pm
       JOIN lesson.published_lessons pl
         ON pl.module_id = pm.module_id AND pl.release_id = pm.release_id
      WHERE pm.course_id = $1 AND pl.lesson_id <> 'tk-3'`,
    [COURSE_ID],
  );
  for (const { lesson_id } of lessons.rows) {
    await query(
      `INSERT INTO lesson.user_lesson_progress (wallet_address, lesson_id, completed, score, completed_at, updated_at)
       VALUES ($1, $2, true, 100, now(), now())
       ON CONFLICT (wallet_address, lesson_id) DO UPDATE SET completed = true`,
      [wallet, lesson_id],
    );
  }
}

// Fully-completed course WITHOUT going through submit — plus the runtime row
// stamped course_completed_at and NO voucher row: the pre-0047 completer.
async function seedCompletedCourse(wallet) {
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
      `INSERT INTO lesson.user_lesson_progress (wallet_address, lesson_id, completed, score, completed_at, updated_at)
       VALUES ($1, $2, true, 100, now(), now())
       ON CONFLICT (wallet_address, lesson_id) DO UPDATE SET completed = true`,
      [wallet, lesson_id],
    );
  }
  await query(
    `INSERT INTO lesson.user_course_runtime_state (wallet_address, course_id)
     VALUES ($1, $2) ON CONFLICT (wallet_address, course_id) DO NOTHING`,
    [wallet, COURSE_ID],
  );
  await query(
    `UPDATE lesson.user_course_runtime_state
     SET course_completed_at = coalesce(course_completed_at, now()), updated_at = now()
     WHERE wallet_address = $1 AND course_id = $2`,
    [wallet, COURSE_ID],
  );
}

// The position route fires a fire-and-forget enroll heal for ACTIVE locks
// with no enrollment row (real devnet RPC) — seed the row to keep tests
// deterministic and offline.
async function suppressEnrollHeal(wallet) {
  await query(
    `INSERT INTO lesson.user_course_enrollments (wallet_address, course_id)
     VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [wallet, COURSE_ID],
  );
}

async function voucherRows(wallet) {
  const res = await query(
    `SELECT wallet_address, course_id, lock_address, lapse_count, bps, expiry,
            authority_pubkey, message, signature, issued_at
       FROM lesson.completion_vouchers
      WHERE wallet_address = $1 AND course_id = $2`,
    [wallet, COURSE_ID],
  );
  return res.rows;
}

async function submitLesson(headers, lesson, attemptId = randomUUID()) {
  const res = await app.inject({
    method: 'POST',
    url: `/v1/progress/lessons/${lesson.id}/submit`,
    headers,
    payload: { attemptId, answers: lesson.answers },
  });
  expect(res.statusCode).toBe(200);
  return res.json();
}

// R9/R11.7 simulation: hide the voucher table so every completion_vouchers
// statement throws exactly like a fresh deploy racing the migration.
async function hideVoucherTable() {
  await query(`ALTER TABLE lesson.completion_vouchers RENAME TO completion_vouchers_hidden`);
}
async function restoreVoucherTable() {
  await query(`ALTER TABLE lesson.completion_vouchers_hidden RENAME TO completion_vouchers`);
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
    await query(`DELETE FROM lesson.completion_vouchers WHERE wallet_address = ANY($1)`, [trackedWallets]);
    await query(`DELETE FROM lesson.user_course_runtime_state WHERE wallet_address = ANY($1)`, [trackedWallets]);
    await query(`DELETE FROM lesson.user_course_enrollments WHERE wallet_address = ANY($1)`, [trackedWallets]);
  }
  await closeTestServer(app);
});
afterEach(() => { __clearPositionCache(); });

describe('auto-issue on the completing submit (R4)', () => {
  it('(R11.2) fresh course completion stores the full 8-field voucher post-commit', async () => {
    const wallet = newTestWallet();
    const headers = await getTestAuthHeaders(wallet);
    await seedAllButLast(wallet);

    const body = await submitLesson(headers, LESSON_3);
    expect(body.accepted).toBe(true);
    expect(body.xp.courseComplete).toBe(true);

    const rows = await voucherRows(wallet);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.lock_address).toBe(clientLockPda(wallet));
    expect(row.authority_pubkey).toBe(WORKER_PUBKEY);
    expect(Number(row.lapse_count)).toBe(0);
    expect(Number(row.bps)).toBe(yieldBpsForLapses(Number(row.lapse_count)));
    expect(Number(row.expiry) * 1000).toBeGreaterThan(Date.now());
    // The stored signature must be the on-chain-valid one, byte for byte.
    expect(
      nacl.sign.detached.verify(
        Buffer.from(row.message, 'base64'),
        Buffer.from(row.signature, 'base64'),
        new PublicKey(row.authority_pubkey).toBytes(),
      ),
    ).toBe(true);
  });

  it('(R11.1/R11.7 submit leg) a voucher-storage failure never touches the completing submit', async () => {
    const wallet = newTestWallet();
    const headers = await getTestAuthHeaders(wallet);
    await seedAllButLast(wallet);

    await hideVoucherTable();
    let body;
    try {
      body = await submitLesson(headers, LESSON_3);
    } finally {
      await restoreVoucherTable();
    }

    // The submit is byte-for-byte a normal completing submit.
    expect(body.accepted).toBe(true);
    expect(body.practiceMode).toBe(false);
    expect(body.xp.courseComplete).toBe(true);

    // The transaction COMMITTED: final-lesson progress + the completion freeze.
    const progress = await query(
      `SELECT completed FROM lesson.user_lesson_progress WHERE wallet_address = $1 AND lesson_id = 'tk-3'`,
      [wallet],
    );
    expect(progress.rows[0]?.completed).toBe(true);
    const runtime = await query(
      `SELECT course_completed_at FROM lesson.user_course_runtime_state
       WHERE wallet_address = $1 AND course_id = $2`,
      [wallet, COURSE_ID],
    );
    expect(runtime.rows[0]?.course_completed_at).not.toBeNull();

    // Nothing was stored (the hook failed, best-effort) — the position read
    // heals this later (R7d).
    expect(await voucherRows(wallet)).toHaveLength(0);
  });
});

describe('GET /v1/locks/:courseId/position voucher embed (R6/R7)', () => {
  it('(R11.3) lazy-issues on read for a completed course with no stored row (pre-0047 heal)', async () => {
    const wallet = newTestWallet();
    const headers = await getTestAuthHeaders(wallet);
    await seedCompletedCourse(wallet);
    await suppressEnrollHeal(wallet);
    primeLockPositionCache(wallet, COURSE_ID, activePosition(wallet));

    const res = await app.inject({ method: 'GET', url: `/v1/locks/${COURSE_ID}/position`, headers });
    expect(res.statusCode).toBe(200);
    const position = res.json();
    expect(position.status).toBe('ACTIVE');

    const v = position.voucher;
    expect(v).not.toBeNull();
    // Full CompletionVoucherResponse shape — expiry MUST be a JSON number
    // (pg bigint-as-string cast, ruling R7).
    expect(v.courseId).toBe(COURSE_ID);
    expect(typeof v.expiry).toBe('number');
    expect(typeof v.lapseCount).toBe('number');
    expect(typeof v.bps).toBe('number');
    expect(v.lock).toBe(clientLockPda(wallet));
    expect(v.authorityPubkey).toBe(WORKER_PUBKEY);
    expect(v.bps).toBe(10_000);
    expect(typeof v.message).toBe('string');
    expect(typeof v.signature).toBe('string');

    // The heal persisted the row.
    expect(await voucherRows(wallet)).toHaveLength(1);
  });

  it('(R11.4) NONE/PENDING/CLOSED -> voucher null and zero rows written', async () => {
    const wallet = newTestWallet();
    const headers = await getTestAuthHeaders(wallet);
    // Even a completed course must not be signed for a settled/absent lock.
    await seedCompletedCourse(wallet);

    for (const status of ['NONE', 'PENDING', 'CLOSED']) {
      __clearPositionCache();
      primeLockPositionCache(wallet, COURSE_ID, inertPosition(status));
      const res = await app.inject({ method: 'GET', url: `/v1/locks/${COURSE_ID}/position`, headers });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe(status);
      expect(res.json().voucher).toBeNull();
    }
    expect(await voucherRows(wallet)).toHaveLength(0);
  });

  it('(R7a) ACTIVE but course not complete -> voucher null, nothing signed or stored', async () => {
    const wallet = newTestWallet();
    const headers = await getTestAuthHeaders(wallet);
    // Runtime row exists but course_completed_at is NULL.
    await query(
      `INSERT INTO lesson.user_course_runtime_state (wallet_address, course_id)
       VALUES ($1, $2) ON CONFLICT (wallet_address, course_id) DO NOTHING`,
      [wallet, COURSE_ID],
    );
    await suppressEnrollHeal(wallet);
    primeLockPositionCache(wallet, COURSE_ID, activePosition(wallet));

    const res = await app.inject({ method: 'GET', url: `/v1/locks/${COURSE_ID}/position`, headers });
    expect(res.statusCode).toBe(200);
    expect(res.json().voucher).toBeNull();
    expect(await voucherRows(wallet)).toHaveLength(0);
  });

  it('(R11.5) an expired stored voucher is re-signed at the identical bps and the row updated', async () => {
    const wallet = newTestWallet();
    const headers = await getTestAuthHeaders(wallet);
    await seedCompletedCourse(wallet);
    await suppressEnrollHeal(wallet);

    // Store a real voucher, then force it expired.
    const post = await app.inject({ method: 'POST', url: `/v1/progress/courses/${COURSE_ID}/voucher`, headers });
    expect(post.statusCode).toBe(200);
    const staleExpiry = Math.floor(Date.now() / 1000) - 60;
    await query(
      `UPDATE lesson.completion_vouchers SET expiry = $3
       WHERE wallet_address = $1 AND course_id = $2`,
      [wallet, COURSE_ID, staleExpiry],
    );

    primeLockPositionCache(wallet, COURSE_ID, activePosition(wallet));
    const res = await app.inject({ method: 'GET', url: `/v1/locks/${COURSE_ID}/position`, headers });
    expect(res.statusCode).toBe(200);
    const v = res.json().voucher;
    expect(v).not.toBeNull();
    expect(v.expiry * 1000).toBeGreaterThan(Date.now()); // fresh, not the stale one
    expect(v.bps).toBe(post.json().bps); // frozen lapse_count -> identical tier

    const rows = await voucherRows(wallet);
    expect(rows).toHaveLength(1); // UPSERT, never a second row
    expect(Number(rows[0].expiry)).toBe(v.expiry);
    expect(Number(rows[0].expiry)).toBeGreaterThan(staleExpiry);
  });

  it('(R11.6) manufactured bps drift: error log, stored voucher served byte-identical, no UPSERT', async () => {
    const wallet = newTestWallet();
    await seedCompletedCourse(wallet); // runtime lapse_count = 0 -> expected 10000

    // Manufacture drift: stored voucher at the 5000 tier, unexpired.
    const expiry = Math.floor(Date.now() / 1000) + 3600;
    await query(
      `INSERT INTO lesson.completion_vouchers
         (wallet_address, course_id, lock_address, lapse_count, bps, expiry,
          authority_pubkey, message, signature)
       VALUES ($1, $2, $3, 1, 5000, $4, $5, 'drift-message', 'drift-signature')`,
      [wallet, COURSE_ID, derivedPda(wallet), expiry, WORKER_PUBKEY],
    );
    const before = await voucherRows(wallet);

    const errors = [];
    const log = { error: (...args) => errors.push(args) };
    const v = await getStoredCompletionVoucher(wallet, COURSE_ID, { log });

    // Served unchanged — the GET never silently re-signs a finished user to a
    // worse (or different) tier.
    expect(v).toEqual({
      courseId: COURSE_ID,
      lapseCount: 1,
      lock: derivedPda(wallet),
      authorityPubkey: WORKER_PUBKEY,
      bps: 5000,
      expiry,
      message: 'drift-message',
      signature: 'drift-signature',
    });
    expect(errors).toHaveLength(1);
    expect(errors[0][1]).toBe('voucher.bps_drift');
    expect(errors[0][0]).toMatchObject({ storedBps: 5000, expectedBps: 10_000 });

    // No UPSERT happened.
    expect(await voucherRows(wallet)).toEqual(before);
  });

  it('(R11.7 read leg) table absent -> GET position returns voucher:null, never a 500', async () => {
    const wallet = newTestWallet();
    const headers = await getTestAuthHeaders(wallet);
    await seedCompletedCourse(wallet);
    await suppressEnrollHeal(wallet);
    primeLockPositionCache(wallet, COURSE_ID, activePosition(wallet));

    await hideVoucherTable();
    let res;
    try {
      res = await app.inject({ method: 'GET', url: `/v1/locks/${COURSE_ID}/position`, headers });
    } finally {
      await restoreVoucherTable();
    }
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('ACTIVE');
    expect(res.json().voucher).toBeNull();
  });
});

describe('POST /v1/progress/courses/:courseId/voucher persist (R8)', () => {
  it('persists after signing; a repeat POST is an idempotent single-row UPSERT (R5)', async () => {
    const wallet = newTestWallet();
    const headers = await getTestAuthHeaders(wallet);
    await seedCompletedCourse(wallet);

    const first = await app.inject({ method: 'POST', url: `/v1/progress/courses/${COURSE_ID}/voucher`, headers });
    expect(first.statusCode).toBe(200);
    const rowsAfterFirst = await voucherRows(wallet);
    expect(rowsAfterFirst).toHaveLength(1);
    expect(rowsAfterFirst[0].signature).toBe(first.json().signature);

    const second = await app.inject({ method: 'POST', url: `/v1/progress/courses/${COURSE_ID}/voucher`, headers });
    expect(second.statusCode).toBe(200);
    // Contract unchanged: idempotent on-demand re-issue at the frozen tier.
    expect(second.json().bps).toBe(first.json().bps);
    expect(second.json().lock).toBe(first.json().lock);

    const rowsAfterSecond = await voucherRows(wallet);
    expect(rowsAfterSecond).toHaveLength(1); // UPSERT, same PK row
    expect(rowsAfterSecond[0].signature).toBe(second.json().signature);
    expect(new Date(rowsAfterSecond[0].issued_at).getTime()).toBeGreaterThanOrEqual(
      new Date(rowsAfterFirst[0].issued_at).getTime(),
    );
  });

  it('(R11.7 POST leg) table absent -> POST still signs and returns the full voucher', async () => {
    const wallet = newTestWallet();
    const headers = await getTestAuthHeaders(wallet);
    await seedCompletedCourse(wallet);

    await hideVoucherTable();
    let res;
    try {
      res = await app.inject({ method: 'POST', url: `/v1/progress/courses/${COURSE_ID}/voucher`, headers });
    } finally {
      await restoreVoucherTable();
    }
    expect(res.statusCode).toBe(200);
    const v = res.json();
    expect(v.courseId).toBe(COURSE_ID);
    expect(v.lock).toBe(clientLockPda(wallet));
    expect(v.authorityPubkey).toBe(WORKER_PUBKEY);
    expect(v.bps).toBe(10_000);
    expect(typeof v.expiry).toBe('number');
    expect(typeof v.message).toBe('string');
    expect(typeof v.signature).toBe('string');
    // Storage was skipped, not faked.
    expect(await voucherRows(wallet)).toHaveLength(0);
  });
});
