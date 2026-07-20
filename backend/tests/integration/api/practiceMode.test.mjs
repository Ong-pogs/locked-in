// Practice-mode + miss-engine DB-integration tests (practice ruling R23).
//
// Covers: (a) replay writes nothing; (b) first-time completion unchanged +
// course_completed_at freeze on the completing submit; (c) miss on a
// completed course refuses with zero writes and the voucher tier is frozen;
// (d) shielded miss preserves the streak / unshielded miss zeroes it and sets
// the lapse-tier redirect; (e) same missDay from two producers -> one receipt,
// one transition; (f) unprocessed gap days are settled at submit (catch-up);
// (g) resubmitting a practice attempt stays practice; (i) concurrent double
// submit of the same first-time lesson awards XP once.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestServer, closeTestServer } from '../../helpers/test-server.mjs';
import { getTestAuthHeaders, generateTestWallet, enrollWalletForTest } from '../../helpers/test-auth.mjs';
import { query } from '../../../src/lib/db.mjs';
import { consumeSaverOrApplyFullConsequence } from '../../../src/modules/progress/repository.mjs';

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

// Complete every lesson EXCEPT tk-3 by direct seed (tk-2 contains a
// short_text question the offline grader fails closed on), so the REAL
// submit of tk-3 is the course-completing one.
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

async function runtimeRow(wallet) {
  const res = await query(
    `SELECT * FROM lesson.user_course_runtime_state WHERE wallet_address = $1 AND course_id = $2`,
    [wallet, COURSE_ID],
  );
  return res.rows[0] ?? null;
}

async function tableCounts(wallet) {
  const [progress, events, xp] = await Promise.all([
    query(`SELECT count(*)::int AS n FROM lesson.user_lesson_progress WHERE wallet_address = $1`, [wallet]),
    query(`SELECT count(*)::int AS n FROM lesson.verified_completion_events WHERE wallet_address = $1`, [wallet]),
    query(`SELECT count(*)::int AS n FROM lesson.user_xp_events WHERE wallet_address = $1`, [wallet]),
  ]);
  return { progress: progress.rows[0].n, events: events.rows[0].n, xp: xp.rows[0].n };
}

describe('practice mode (R23 a, g)', () => {
  it('(a) replay submit grades but writes NOTHING to progress/runtime/events/XP', async () => {
    const wallet = newTestWallet();
    const headers = await getTestAuthHeaders(wallet);
    await enrollWalletForTest(query, wallet, COURSE_ID); // lessons require a staked course

    const first = await submitLesson(headers, LESSON_1);
    expect(first.body.accepted).toBe(true);
    expect(first.body.practiceMode).toBe(false);
    expect(first.body.completionEventId).toBeTruthy();
    expect(first.body.courseRuntime).toBeTruthy();
    expect(first.body.courseRuntime.currentStreak).toBe(1);

    const progressBefore = await query(
      `SELECT completed, score, completed_at, updated_at FROM lesson.user_lesson_progress
       WHERE wallet_address = $1 AND lesson_id = $2`,
      [wallet, LESSON_1.id],
    );
    const runtimeBefore = await runtimeRow(wallet);
    const countsBefore = await tableCounts(wallet);

    const replay = await submitLesson(headers, LESSON_1);
    expect(replay.body.accepted).toBe(true);
    expect(replay.body.practiceMode).toBe(true);
    expect(replay.body.completionEventId).toBeNull();
    expect(replay.body.xp).toBeNull();
    // courseRuntime present and UNMODIFIED so the client keeps
    // serverHandled=true and never double-bumps the local streak.
    expect(replay.body.courseRuntime).toBeTruthy();
    expect(replay.body.courseRuntime.currentStreak).toBe(1);

    const progressAfter = await query(
      `SELECT completed, score, completed_at, updated_at FROM lesson.user_lesson_progress
       WHERE wallet_address = $1 AND lesson_id = $2`,
      [wallet, LESSON_1.id],
    );
    expect(progressAfter.rows).toEqual(progressBefore.rows);
    expect(await runtimeRow(wallet)).toEqual(runtimeBefore);
    expect(await tableCounts(wallet)).toEqual(countsBefore);
  });

  it('(g) resubmitting a practice attempt id stays practice with completionEventId null', async () => {
    const wallet = newTestWallet();
    const headers = await getTestAuthHeaders(wallet);
    await enrollWalletForTest(query, wallet, COURSE_ID); // lessons require a staked course

    await submitLesson(headers, LESSON_1);
    const practice = await submitLesson(headers, LESSON_1);
    expect(practice.body.practiceMode).toBe(true);

    // Same attemptId again — the idempotent-resubmit branch (R9).
    const resubmit = await submitLesson(headers, LESSON_1, practice.attemptId);
    expect(resubmit.body.practiceMode).toBe(true);
    expect(resubmit.body.completionEventId).toBeNull();
    expect(resubmit.body.courseRuntime).toBeTruthy();

    // The first-time attempt resubmitted stays NON-practice (its event exists).
    const firstAttempt = await query(
      `SELECT lesson_attempt_id::text AS id FROM lesson.verified_completion_events WHERE wallet_address = $1`,
      [wallet],
    );
    const originalResubmit = await submitLesson(headers, LESSON_1, firstAttempt.rows[0].id);
    expect(originalResubmit.body.practiceMode).toBe(false);
    expect(originalResubmit.body.completionEventId).toBeTruthy();
  });
});

describe('course completion freeze (R23 b, c)', () => {
  it('(b) the completing submit stamps course_completed_at in the same transaction', async () => {
    const wallet = newTestWallet();
    const headers = await getTestAuthHeaders(wallet);
    await enrollWalletForTest(query, wallet, COURSE_ID); // lessons require a staked course
    await seedAllButLast(wallet);

    const res = await submitLesson(headers, LESSON_3);
    expect(res.body.accepted).toBe(true);
    expect(res.body.practiceMode).toBe(false);
    expect(res.body.xp.courseComplete).toBe(true);

    const row = await runtimeRow(wallet);
    expect(row.course_completed_at).not.toBeNull();
  });

  it('(c) a miss on a completed course refuses with zero writes; voucher tier is frozen', async () => {
    const wallet = newTestWallet();
    const headers = await getTestAuthHeaders(wallet);
    await enrollWalletForTest(query, wallet, COURSE_ID); // lessons require a staked course
    await seedAllButLast(wallet);
    await submitLesson(headers, LESSON_3);

    const before = await runtimeRow(wallet);
    const result = await consumeSaverOrApplyFullConsequence(
      wallet,
      COURSE_ID,
      `auto-miss:${wallet}:${COURSE_ID}:${utcDay(-1)}`,
      utcDay(-1),
    );
    expect(result.applied).toBe(false);
    expect(result.reason).toBe('COURSE_COMPLETED');

    const after = await runtimeRow(wallet);
    expect(after).toEqual(before);
    const receipts = await query(
      `SELECT count(*)::int AS n FROM lesson.miss_consequence_receipts WHERE wallet_address = $1`,
      [wallet],
    );
    expect(receipts.rows[0].n).toBe(0);

    // Days between completion and claim cannot cut the signed voucher bps.
    const voucher = await app.inject({
      method: 'POST',
      url: `/v1/progress/courses/${COURSE_ID}/voucher`,
      headers,
    });
    expect(voucher.statusCode).toBe(200);
    expect(voucher.json().lapseCount).toBe(0);
    expect(voucher.json().bps).toBe(10_000);
  });
});

describe('miss semantics (R23 d, e)', () => {
  it('(d) shielded miss is free: streak pauses then continues N -> N+1, redirect untouched', async () => {
    const wallet = newTestWallet();
    const headers = await getTestAuthHeaders(wallet);
    await enrollWalletForTest(query, wallet, COURSE_ID); // lessons require a staked course

    // Real completion, then backdate it two days so yesterday is a gap.
    await submitLesson(headers, LESSON_1);
    await query(
      `UPDATE lesson.user_course_runtime_state
       SET last_completed_day = $3::date, current_streak = 5
       WHERE wallet_address = $1 AND course_id = $2`,
      [wallet, COURSE_ID, utcDay(-2)],
    );

    const missed = await consumeSaverOrApplyFullConsequence(
      wallet,
      COURSE_ID,
      `auto-miss:${wallet}:${COURSE_ID}:${utcDay(-1)}`,
      utcDay(-1),
    );
    expect(missed.applied).toBe(true);
    expect(missed.reason).toBe('SHIELD_ABSORBED');

    let row = await runtimeRow(wallet);
    expect(Number(row.shields)).toBe(2);
    expect(Number(row.current_streak)).toBe(5); // paused, NOT reset
    expect(Number(row.current_yield_redirect_bps)).toBe(0); // untouched
    expect(Number(row.saver_count)).toBe(0); // never touched by a miss

    // Next-day completion continues the streak from the engine: 5 -> 6.
    const next = await submitLesson(headers, LESSON_3);
    expect(next.body.courseRuntime.currentStreak).toBe(6);
    row = await runtimeRow(wallet);
    expect(Number(row.current_yield_redirect_bps)).toBe(0);
  });

  it('(d) unshielded miss: streak 0, redirect 5000 at lapse 1', async () => {
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

    const missed = await consumeSaverOrApplyFullConsequence(
      wallet,
      COURSE_ID,
      `auto-miss:${wallet}:${COURSE_ID}:${utcDay(-1)}`,
      utcDay(-1),
    );
    expect(missed.applied).toBe(true);
    expect(missed.reason).toBe('LAPSE_APPLIED');

    const row = await runtimeRow(wallet);
    expect(Number(row.current_streak)).toBe(0);
    expect(Number(row.lapse_count)).toBe(1);
    expect(row.lapse_open).toBe(true);
    expect(Number(row.current_yield_redirect_bps)).toBe(5000);
  });

  it('(e) the same missDay from two producers yields ONE receipt and ONE transition', async () => {
    const wallet = newTestWallet();
    const headers = await getTestAuthHeaders(wallet);
    await enrollWalletForTest(query, wallet, COURSE_ID); // lessons require a staked course
    await submitLesson(headers, LESSON_1);

    const day = utcDay(-1);
    const first = await consumeSaverOrApplyFullConsequence(
      wallet, COURSE_ID, `auto-miss:${wallet}:${COURSE_ID}:${day}`, day,
    );
    expect(first.applied).toBe(true);
    expect(first.reason).toBe('SHIELD_ABSORBED');

    // Different (ad-hoc) event id, same day — the day is already judged.
    const second = await consumeSaverOrApplyFullConsequence(
      wallet, COURSE_ID, `legacy-worker:${randomUUID()}`, day,
    );
    expect(second.applied).toBe(false);
    expect(second.reason).toBe('DUPLICATE_MISS_DAY');

    const receipts = await query(
      `SELECT count(*)::int AS n FROM lesson.miss_consequence_receipts
       WHERE wallet_address = $1 AND course_id = $2 AND miss_day = $3::date`,
      [wallet, COURSE_ID, day],
    );
    expect(receipts.rows[0].n).toBe(1);
    const row = await runtimeRow(wallet);
    expect(Number(row.shields)).toBe(2); // burned exactly once
  });
});

describe('catch-up misses at submit (R23 f)', () => {
  it('(f) a 2-day unprocessed gap settles as two auto-miss receipts before the lesson-day', async () => {
    const wallet = newTestWallet();
    const headers = await getTestAuthHeaders(wallet);
    await enrollWalletForTest(query, wallet, COURSE_ID); // lessons require a staked course

    await submitLesson(headers, LESSON_1);
    await query(
      `UPDATE lesson.user_course_runtime_state
       SET last_completed_day = $3::date, current_streak = 1
       WHERE wallet_address = $1 AND course_id = $2`,
      [wallet, COURSE_ID, utcDay(-3)],
    );

    const res = await submitLesson(headers, LESSON_3);
    expect(res.body.accepted).toBe(true);

    const receipts = await query(
      `SELECT miss_day::text AS day, miss_event_id AS id, reason
       FROM lesson.miss_consequence_receipts
       WHERE wallet_address = $1 AND course_id = $2
       ORDER BY miss_day ASC`,
      [wallet, COURSE_ID],
    );
    expect(receipts.rows.map((r) => r.day)).toEqual([utcDay(-2), utcDay(-1)]);
    expect(receipts.rows.map((r) => r.id)).toEqual([
      `auto-miss:${wallet}:${COURSE_ID}:${utcDay(-2)}`,
      `auto-miss:${wallet}:${COURSE_ID}:${utcDay(-1)}`,
    ]);
    expect(receipts.rows.every((r) => r.reason === 'SHIELD_ABSORBED')).toBe(true);

    // Engine output: streak paused at 1 through both shielded misses, then
    // the lesson-day advances it to 2. Two shields burned.
    const row = await runtimeRow(wallet);
    expect(Number(row.shields)).toBe(1);
    expect(Number(row.current_streak)).toBe(2);
    expect(row.last_miss_day).not.toBeNull();
    expect(res.body.courseRuntime.currentStreak).toBe(2);
  });
});

describe('XP idempotency (R23 i)', () => {
  it('(i) concurrent double submit of the same first-time lesson awards XP once', async () => {
    const wallet = newTestWallet();
    const headers = await getTestAuthHeaders(wallet);
    await enrollWalletForTest(query, wallet, COURSE_ID); // lessons require a staked course

    const [a, b] = await Promise.all([
      app.inject({
        method: 'POST',
        url: `/v1/progress/lessons/${LESSON_1.id}/submit`,
        headers,
        payload: { attemptId: randomUUID(), answers: LESSON_1.answers },
      }),
      app.inject({
        method: 'POST',
        url: `/v1/progress/lessons/${LESSON_1.id}/submit`,
        headers,
        payload: { attemptId: randomUUID(), answers: LESSON_1.answers },
      }),
    ]);
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);

    const xpEvents = await query(
      `SELECT count(*)::int AS n FROM lesson.user_xp_events
       WHERE wallet_address = $1 AND source = 'lesson_complete' AND source_id = $2`,
      [wallet, LESSON_1.id],
    );
    expect(xpEvents.rows[0].n).toBe(1);

    const xpTotal = await query(
      `SELECT xp_total FROM lesson.user_xp WHERE wallet_address = $1`,
      [wallet],
    );
    expect(Number(xpTotal.rows[0].xp_total)).toBe(100);

    // Exactly one verified completion event survives the race.
    const events = await query(
      `SELECT count(*)::int AS n FROM lesson.verified_completion_events WHERE wallet_address = $1`,
      [wallet],
    );
    expect(events.rows[0].n).toBe(1);
  });
});

describe('internal miss endpoint hardening (sweep R20)', () => {
  it('rejects a missing/future/current missDay', async () => {
    const wallet = newTestWallet();
    for (const missDay of [undefined, 'not-a-date', utcDay(0), utcDay(2)]) {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/internal/consequences/miss',
        headers: { 'x-scheduler-key': process.env.SCHEDULER_SECRET },
        payload: { walletAddress: wallet, courseId: COURSE_ID, missDay },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('INVALID_MISS_DAY');
    }
  });

  it('derives the miss_event_id server-side, ignoring caller-supplied ids', async () => {
    const wallet = newTestWallet();
    const headers = await getTestAuthHeaders(wallet);
    await enrollWalletForTest(query, wallet, COURSE_ID); // lessons require a staked course
    await submitLesson(headers, LESSON_1);

    const day = utcDay(-1);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/internal/consequences/miss',
      headers: { 'x-scheduler-key': process.env.SCHEDULER_SECRET },
      payload: { walletAddress: wallet, courseId: COURSE_ID, missDay: day, missEventId: 'attacker-chosen' },
    });
    expect(res.statusCode).toBe(200);
    const receipts = await query(
      `SELECT miss_event_id AS id FROM lesson.miss_consequence_receipts
       WHERE wallet_address = $1 AND course_id = $2`,
      [wallet, COURSE_ID],
    );
    expect(receipts.rows).toEqual([{ id: `auto-miss:${wallet}:${COURSE_ID}:${day}` }]);
  });
});
