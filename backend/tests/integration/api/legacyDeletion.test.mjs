// Legacy-deletion phase-2 DB-integration tests (legacy-deletion ruling,
// 2026-07-10). Replaces brewery.test.mjs (those routes are deleted).
//
// T2: two lesson submits on the same UTC day advance current_streak exactly
//     once, completedToday stays true, longest_streak is maintained — and
//     the stop-write leaves every doomed legacy column untouched.
// T3: an unjudged gap day is settled at submit (R13 catch-up) with a
//     miss_consequence_receipts row carrying literal-0 saver/extension
//     constants and REAL redirect_bps before/after; lapse_count advances
//     past the shields (money path intact). Same assertions for the
//     lapse-sweep writer (applyMissConsequenceForSweep).
// T4: the six deleted routes return 404.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestServer, closeTestServer } from '../../helpers/test-server.mjs';
import { getTestAuthHeaders, generateTestWallet, enrollWalletForTest } from '../../helpers/test-auth.mjs';
import { query, withTransactionAsWallet } from '../../../src/lib/db.mjs';
import {
  applyMissConsequenceForSweep,
  lockRuntimeStateForSweep,
} from '../../../src/modules/progress/repository.mjs';
import { autoMissEventId } from '../../../src/lib/missEvents.mjs';

const COURSE_ID = 'test-kitchen';
// MCQ-only lessons of test-kitchen — gradable without the LLM validator.
const LESSON_1 = { id: 'tk-1', answers: [
  { questionId: 'tk-1-q1', answerText: 'chain-cards' },
  { questionId: 'tk-1-q2', answerText: 'Green' },
] };
const LESSON_3 = { id: 'tk-3', answers: [
  { questionId: 'tk-3-q1', answerText: 'Yes' },
  { questionId: 'tk-3-q2', answerText: '10' },
] };

function utcDay(offset = 0) {
  return new Date(Date.now() + offset * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

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

async function submitLesson(headers, lesson, attemptId = randomUUID()) {
  const res = await app.inject({
    method: 'POST',
    url: `/v1/progress/lessons/${lesson.id}/submit`,
    headers,
    payload: { attemptId, answers: lesson.answers },
  });
  expect(res.statusCode).toBe(200);
  return { attemptId, body: res.json() };
}

async function runtimeRow(wallet) {
  const res = await query(
    `SELECT * FROM lesson.user_course_runtime_state WHERE wallet_address = $1 AND course_id = $2`,
    [wallet, COURSE_ID],
  );
  return res.rows[0] ?? null;
}

async function missReceipts(wallet) {
  const res = await query(
    `SELECT miss_day::text AS day, reason,
            saver_count_before AS "saverCountBefore",
            saver_count_after AS "saverCountAfter",
            redirect_bps_before AS "redirectBpsBefore",
            redirect_bps_after AS "redirectBpsAfter",
            extension_days_before AS "extensionDaysBefore",
            extension_days_after AS "extensionDaysAfter"
     FROM lesson.miss_consequence_receipts
     WHERE wallet_address = $1 AND course_id = $2 ORDER BY miss_day ASC`,
    [wallet, COURSE_ID],
  );
  return res.rows;
}

// ── T4: the six deleted routes 404 ──────────────────────────────────────

describe('deleted legacy routes return 404 (T4)', () => {
  it('the four public brewery/shop routes are gone even with valid auth', async () => {
    const headers = await getTestAuthHeaders(newTestWallet());
    const cases = [
      { method: 'GET', url: `/v1/progress/brewery?courseId=${COURSE_ID}` },
      { method: 'POST', url: '/v1/progress/brewery/feed' },
      { method: 'POST', url: '/v1/progress/brewery/claim' },
      { method: 'POST', url: '/v1/progress/shop/buy-saver' },
    ];
    for (const { method, url } of cases) {
      const res = await app.inject({
        method,
        url,
        headers,
        ...(method === 'POST' ? { payload: { courseId: COURSE_ID } } : {}),
      });
      expect(res.statusCode).toBe(404);
    }
  });

  it('the two internal fuel routes are gone even with the scheduler key', async () => {
    const cases = [
      { url: '/v1/internal/fuel/burn' },
      { url: '/v1/internal/lock-vault/fuel-burn/publish' },
    ];
    for (const { url } of cases) {
      const res = await app.inject({
        method: 'POST',
        url,
        headers: { 'x-scheduler-key': process.env.SCHEDULER_SECRET },
        payload: { walletAddress: 'w', courseId: COURSE_ID, cycleId: 'c' },
      });
      expect(res.statusCode).toBe(404);
    }
  });
});

// ── T2: same-day completion stop-writes ─────────────────────────────────

describe('completion stop-writes (T2)', () => {
  it('two same-UTC-day submits advance current_streak exactly once; legacy columns untouched', async () => {
    const wallet = newTestWallet();
    const headers = await getTestAuthHeaders(wallet);
    await enrollWalletForTest(query, wallet, COURSE_ID); // lessons require a staked course

    const first = await submitLesson(headers, LESSON_1);
    expect(first.body.accepted).toBe(true);
    expect(first.body.courseRuntime.currentStreak).toBe(1);
    expect(first.body.courseRuntime.longestStreak).toBe(1);

    const second = await submitLesson(headers, LESSON_3);
    expect(second.body.accepted).toBe(true);
    // Same UTC day: streak advanced exactly once across both submits.
    expect(second.body.courseRuntime.currentStreak).toBe(1);
    expect(second.body.courseRuntime.longestStreak).toBe(1);

    const row = await runtimeRow(wallet);
    expect(Number(row.current_streak)).toBe(1);
    expect(Number(row.longest_streak)).toBe(1);
    const dayRes = await query(
      `SELECT last_completed_day::text AS day FROM lesson.user_course_runtime_state
       WHERE wallet_address = $1 AND course_id = $2`,
      [wallet, COURSE_ID],
    );
    expect(dayRes.rows[0].day).toBe(utcDay(0));

    // Stop-write proof: the doomed legacy columns keep their 0005/0007
    // defaults — completions no longer write fuel/ichor/gauntlet.
    expect(Number(row.fuel_counter)).toBe(0);
    expect(Number(row.ichor_counter ?? 0)).toBe(0);
    expect(Number(row.ichor_lifetime_total ?? 0)).toBe(0);
    expect(row.gauntlet_active).toBe(true); // untouched column default
    expect(Number(row.gauntlet_day)).toBe(1);
    expect(Number(row.saver_count)).toBe(0);

    // completedToday stays true on the course snapshot after both submits.
    const snapshot = await app.inject({
      method: 'GET',
      url: `/v1/progress/runtime/courses/${COURSE_ID}`,
      headers,
    });
    expect(snapshot.statusCode).toBe(200);
    expect(snapshot.json().completedToday).toBe(true);
    expect(snapshot.json().currentStreak).toBe(1);
  });
});

// ── T3: miss path writes literal-0 legacy constants, real redirect ──────

describe('miss receipt constants + lapse advance (T3)', () => {
  it('R13 catch-up on an unshielded gap day: receipt zeros, redirect 0->5000, lapse_count advances', async () => {
    const wallet = newTestWallet();
    const headers = await getTestAuthHeaders(wallet);
    await enrollWalletForTest(query, wallet, COURSE_ID); // lessons require a staked course

    await submitLesson(headers, LESSON_1);
    // One unjudged gap day (yesterday), shields exhausted so the miss lapses.
    await query(
      `UPDATE lesson.user_course_runtime_state
       SET last_completed_day = $3::date, current_streak = 5, shields = 0
       WHERE wallet_address = $1 AND course_id = $2`,
      [wallet, COURSE_ID, utcDay(-2)],
    );

    const res = await submitLesson(headers, LESSON_3);
    expect(res.body.accepted).toBe(true); // submit succeeds despite catch-up

    const receipts = await missReceipts(wallet);
    expect(receipts.length).toBe(1);
    expect(receipts[0]).toMatchObject({
      day: utcDay(-1),
      reason: 'LAPSE_APPLIED',
      saverCountBefore: 0,
      saverCountAfter: 0,
      extensionDaysBefore: 0,
      extensionDaysAfter: 0,
      redirectBpsBefore: 0,
      redirectBpsAfter: 5000, // lapse 1 -> user keeps 50%
    });

    const row = await runtimeRow(wallet);
    expect(Number(row.lapse_count)).toBe(1); // money path intact
    expect(Number(row.current_yield_redirect_bps)).toBe(5000);
    // The lesson-day after the lapse restarts the streak at 1.
    expect(Number(row.current_streak)).toBe(1);
  });

  it('R13 catch-up on a shielded gap day: receipt zeros, redirect untouched, shield burns', async () => {
    const wallet = newTestWallet();
    const headers = await getTestAuthHeaders(wallet);
    await enrollWalletForTest(query, wallet, COURSE_ID); // lessons require a staked course

    await submitLesson(headers, LESSON_1);
    await query(
      `UPDATE lesson.user_course_runtime_state
       SET last_completed_day = $3::date, current_streak = 5
       WHERE wallet_address = $1 AND course_id = $2`,
      [wallet, COURSE_ID, utcDay(-2)],
    );

    const res = await submitLesson(headers, LESSON_3);
    expect(res.body.accepted).toBe(true);

    const receipts = await missReceipts(wallet);
    expect(receipts.length).toBe(1);
    expect(receipts[0]).toMatchObject({
      day: utcDay(-1),
      reason: 'SHIELD_ABSORBED',
      saverCountBefore: 0,
      saverCountAfter: 0,
      extensionDaysBefore: 0,
      extensionDaysAfter: 0,
      redirectBpsBefore: 0,
      redirectBpsAfter: 0, // a shielded miss never touches yield routing
    });

    const row = await runtimeRow(wallet);
    expect(Number(row.shields)).toBe(2); // shield burned
    expect(Number(row.lapse_count)).toBe(0); // shielded: no lapse yet
    expect(Number(row.current_streak)).toBe(6); // paused at 5, lesson-day -> 6
  });

  it('the lapse-sweep writer (applyMissConsequenceForSweep) writes the same constants', async () => {
    const wallet = newTestWallet();
    const headers = await getTestAuthHeaders(wallet);
    await enrollWalletForTest(query, wallet, COURSE_ID); // lessons require a staked course

    await submitLesson(headers, LESSON_1);
    await query(
      `UPDATE lesson.user_course_runtime_state
       SET last_completed_day = $3::date, current_streak = 5, shields = 0
       WHERE wallet_address = $1 AND course_id = $2`,
      [wallet, COURSE_ID, utcDay(-2)],
    );

    const day = utcDay(-1);
    const result = await withTransactionAsWallet(wallet, async (client) => {
      const state = await lockRuntimeStateForSweep(client, wallet, COURSE_ID);
      return applyMissConsequenceForSweep(
        client,
        state,
        day,
        autoMissEventId(wallet, COURSE_ID, day),
      );
    });
    expect(result.applied).toBe(true);
    expect(result.reason).toBe('LAPSE_APPLIED');

    const receipts = await missReceipts(wallet);
    expect(receipts.length).toBe(1);
    expect(receipts[0]).toMatchObject({
      day,
      saverCountBefore: 0,
      saverCountAfter: 0,
      extensionDaysBefore: 0,
      extensionDaysAfter: 0,
      redirectBpsBefore: 0,
      redirectBpsAfter: 5000,
    });

    const row = await runtimeRow(wallet);
    expect(Number(row.lapse_count)).toBe(1); // lapse_count advances (money path)
    expect(Number(row.current_streak)).toBe(0);
    expect(Number(row.current_yield_redirect_bps)).toBe(5000);
  });
});
