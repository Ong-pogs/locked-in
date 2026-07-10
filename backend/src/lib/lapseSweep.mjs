// Daily lapse sweep (spec §4.2; 2026-07-10 lapse-sweep ruling as amended by
// the enroll ruling R17 and the practice ruling R15/R16).
//
// The sweep is the server-side judge of every completed UTC day per
// verified-ACTIVE v2 lock. Governing principles, applied verbatim:
//   1. FAIL CLOSED ON PUNISHMENT — a miss-day applies only when the lock is
//      verified ACTIVE on a FRESH on-chain read, the course is not complete,
//      the day is a fully elapsed UTC day, and the day-keyed receipt was
//      claimed atomically in the same transaction as the state transition.
//   2. FAIL CLOSED ON ABSOLUTION — the day cursor (last_miss_day /
//      last_completed_day) only advances through judgments; an unreadable
//      chain skips the row (retried next run) and never absolves it.
//   3. ONE SPINE — receipts keyed (wallet, course, miss_day) with ids from
//      missEvents.mjs; the ONE transition writer is the miss core inside
//      progress/repository.mjs (applyMissConsequenceLocked, which wraps the
//      exported applyShieldLapseTransition); never reimplemented here.
//
// Population (enroll ruling R17): enrollment rows JOINed to runtime rows that
// are v2-armed — lock_account_address equals the re-derived v2 PDA.
// `lock_account_address is not null` alone is NEVER sufficient (stale v1
// rows); rows armed with a legacy PDA belong to the legacy worker. Account
// missing or status != ACTIVE on the fresh read → tombstone (null the lock
// address, zero the principal) and apply NO miss: claim_v2/force_return_v2
// close the PDA, so account-missing IS the settled state and CLOSED is never
// observable. The tombstone makes the universe self-healing.

import { appConfig } from '../config.mjs';
import { HttpError } from './errors.mjs';
import { hasDatabase, query, withTransactionAsWallet } from './db.mjs';
import {
  deriveLockPdaServer,
  hasPositionConfig,
  readLockV2AccountFresh,
} from './lockPosition.mjs';
import { autoMissEventId } from './missEvents.mjs';
import {
  applyMissConsequenceForSweep,
  lockRuntimeStateForSweep,
  rereadRuntimeStateForSweep,
  markCourseCompletedIfComplete,
} from '../modules/progress/repository.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;
// Catch-up processes AT MOST this many days per row per run, day-by-day in
// ascending order, and NEVER skips days — a cron outage is caught up, not
// absolved. A truncated catch-up resumes next run from last_miss_day.
const MAX_CATCHUP_DAYS = 30;

function addUtcDays(dayText, delta) {
  const date = new Date(`${dayText}T00:00:00.000Z`);
  return new Date(date.getTime() + delta * DAY_MS).toISOString().slice(0, 10);
}

function toUtcDay(value) {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function maxUtcDay(...days) {
  return days.filter(Boolean).sort().at(-1) ?? null;
}

function minUtcDay(a, b) {
  return a <= b ? a : b;
}

export function currentUtcDay() {
  return new Date().toISOString().slice(0, 10);
}

export function utcYesterday() {
  return addUtcDays(currentUtcDay(), -1);
}

function parseCursor(cursor) {
  if (cursor == null) return { walletAddress: null, courseId: null };
  if (typeof cursor !== 'string' || !cursor.includes('|')) {
    throw new HttpError(400, 'cursor must be "{wallet}|{courseId}"', 'INVALID_SWEEP_CURSOR');
  }
  const separator = cursor.indexOf('|');
  return {
    walletAddress: cursor.slice(0, separator),
    courseId: cursor.slice(separator + 1),
  };
}

/**
 * Run ONE bounded sweep batch. Callers loop until nextCursor is null.
 * Per-row transactions mean a timeout or cron retry can never truncate
 * mid-row or double-apply (receipts + the row lock are the idempotency
 * spine). The sweep never judges the current UTC day.
 *
 * `readLockFresh` is injectable for deterministic tests; the default is the
 * uncached on-chain reader.
 */
export async function runLapseSweepBatch({
  asOfDay = utcYesterday(),
  batchSize = 200,
  cursor = null,
  log = null,
  readLockFresh = readLockV2AccountFresh,
} = {}) {
  if (!hasDatabase()) {
    throw new HttpError(503, 'Lapse sweep requires the database', 'DB_UNAVAILABLE');
  }
  if (!hasPositionConfig()) {
    throw new HttpError(503, 'Lapse sweep requires the v2 program id', 'POSITION_UNCONFIGURED');
  }
  if (typeof asOfDay !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(asOfDay)) {
    throw new HttpError(400, 'asOfDay must be YYYY-MM-DD', 'INVALID_SWEEP_DAY');
  }
  // The sweep NEVER judges today — today is still in progress everywhere.
  if (asOfDay >= currentUtcDay()) {
    throw new HttpError(400, 'asOfDay must be strictly before today (UTC)', 'SWEEP_DAY_IN_FUTURE');
  }
  const boundedBatch = Math.min(1000, Math.max(1, Number(batchSize) || 200));
  const after = parseCursor(cursor);

  // Population predicate: enrollments JOIN v2-armed, not-completed runtime
  // rows, keyset-paginated so a timeout/retry resumes exactly where it left.
  const candidates = await query(
    `
      select
        runtime.wallet_address as "walletAddress",
        runtime.course_id as "courseId",
        runtime.lock_account_address as "lockAccountAddress"
      from lesson.user_course_enrollments enrollment
      join lesson.user_course_runtime_state runtime
        on runtime.wallet_address = enrollment.wallet_address
       and runtime.course_id = enrollment.course_id
      where runtime.lock_account_address is not null
        and runtime.course_completed_at is null
        and (
          $2::text is null
          or (runtime.wallet_address, runtime.course_id) > ($2::text, $3::text)
        )
      order by runtime.wallet_address asc, runtime.course_id asc
      limit $1
    `,
    [boundedBatch, after.walletAddress, after.courseId],
  );

  const counters = {
    asOfDay,
    processed: 0,
    missesApplied: 0,
    lessonDays: 0,
    exemptedCompleted: 0,
    closedLocks: 0,
    skippedUnreadable: 0,
    nextCursor: null,
  };

  for (const candidate of candidates.rows) {
    const { walletAddress, courseId, lockAccountAddress } = candidate;

    // v2-armed check: the stored custody address must be THIS wallet+course's
    // derived v2 PDA. Legacy-PDA rows belong to the legacy worker — skipped.
    let derived;
    try {
      derived = deriveLockPdaServer(
        appConfig.vaultV2ProgramId,
        walletAddress,
        courseId,
      ).toBase58();
    } catch {
      counters.skippedUnreadable += 1;
      continue;
    }
    if (lockAccountAddress !== derived) continue;

    counters.processed += 1;

    // FRESH on-chain read — punishment is fail-closed on liveness. Unreadable
    // chain: leave the row untouched (no punish, no absolve; retried next run).
    let account;
    try {
      account = await readLockFresh(walletAddress, courseId);
    } catch (error) {
      counters.skippedUnreadable += 1;
      log?.warn?.(
        {
          walletAddress,
          courseId,
          error: error instanceof Error ? error.message : String(error),
        },
        'lapse_sweep.position_unreadable',
      );
      continue;
    }

    if (!account || account.mismatch || account.status !== 'ACTIVE') {
      // Settled (PDA closed), never-funded PENDING, or config-skewed —
      // tombstone and apply NO miss. A closed/withdrawn lock is never punished.
      await withTransactionAsWallet(walletAddress, (client) =>
        client.query(
          `update lesson.user_course_runtime_state
           set lock_account_address = null,
               principal_amount = 0,
               updated_at = now()
           where wallet_address = $1 and course_id = $2`,
          [walletAddress, courseId],
        ),
      );
      counters.closedLocks += 1;
      log?.info?.(
        { walletAddress, courseId, status: account?.status ?? 'MISSING' },
        'lapse_sweep.lock_tombstoned',
      );
      continue;
    }

    // Judge this row's elapsed days inside ONE wallet-scoped transaction —
    // every state mutation and its receipt commit or roll back together.
    const rowOutcome = await withTransactionAsWallet(walletAddress, async (client) => {
      const state = await lockRuntimeStateForSweep(client, walletAddress, courseId);

      // Completed-course exit (lazy backfill): a finished-but-unclaimed user
      // must never accrue lapses that cut their signed voucher bps.
      if (state.courseCompletedAt != null) return { exempted: true };
      if (await markCourseCompletedIfComplete(client, walletAddress, courseId)) {
        return { exempted: true };
      }

      const lockStartDay =
        toUtcDay(state.lockStartAt) ??
        toUtcDay(new Date(Number(account.lockStartTs) * 1000));
      // The lock-start day itself is never judged; the first judged day is
      // the first FULL UTC day after lock start.
      const baseDay = maxUtcDay(
        state.lastCompletedDay,
        state.lastMissDay,
        lockStartDay ? addUtcDays(lockStartDay, -1) : null,
      );
      if (baseDay == null) return { skipped: true };

      const startDay = addUtcDays(baseDay, 1);
      const endDay = minUtcDay(asOfDay, addUtcDays(baseDay, MAX_CATCHUP_DAYS));
      if (startDay > endDay) return { upToDate: true };

      // This row's lesson-days, loaded once — deliberately unbounded above so
      // completions after endDay (including today) stay visible.
      const completionRows = await client.query(
        `select distinct completion_day::text as day
         from lesson.verified_completion_events
         where wallet_address = $1 and course_id = $2 and completion_day >= $3::date`,
        [walletAddress, courseId, startDay],
      );
      const lessonDaySet = new Set(completionRows.rows.map((row) => row.day));

      let misses = 0;
      let lessonDays = 0;
      let rowState = state;
      for (let day = startDay; day <= endDay; day = addUtcDays(day, 1)) {
        if (lessonDaySet.has(day)) {
          // Lesson-day: the completion handler already ran applyLessonDay
          // eagerly — no transition here.
          lessonDays += 1;
          continue;
        }
        const result = await applyMissConsequenceForSweep(
          client,
          rowState,
          day,
          autoMissEventId(walletAddress, courseId, day),
        );
        if (result.applied && !result.duplicate) misses += 1;
        if (result.duplicate) {
          // Another engine already punished this day — no transition, but the
          // day cursor still advances so the sweep does not rescan it forever.
          await client.query(
            `update lesson.user_course_runtime_state
             set last_miss_day = greatest(coalesce(last_miss_day, $3::date), $3::date)
             where wallet_address = $1 and course_id = $2`,
            [walletAddress, courseId, day],
          );
        }
        rowState = await rereadRuntimeStateForSweep(client, walletAddress, courseId);
      }
      return { misses, lessonDays };
    });

    if (rowOutcome.exempted) counters.exemptedCompleted += 1;
    counters.missesApplied += rowOutcome.misses ?? 0;
    counters.lessonDays += rowOutcome.lessonDays ?? 0;
    if ((rowOutcome.misses ?? 0) > 0) {
      log?.info?.(
        { walletAddress, courseId, missesApplied: rowOutcome.misses, asOfDay },
        'lapse_sweep.misses_applied',
      );
    }
  }

  if (candidates.rows.length === boundedBatch) {
    const last = candidates.rows[candidates.rows.length - 1];
    counters.nextCursor = `${last.walletAddress}|${last.courseId}`;
  }

  return counters;
}
