// One-shot daily lapse sweep for cron services (sweep ruling R16).
// Render cron: schedule "30 0 * * *" (daily, 00:30 UTC — after the UTC day
// rolls so the sweep judges the fully-elapsed previous day), command:
//   npm run cron:lapse-sweep
//
// HTTP pattern (same as cron:leaderboard-refresh / cron:pot-cycle): hits the
// scheduler-gated internal endpoint on the running web service, looping
// batches until nextCursor is null. The web service owns the DB + RPC env;
// this job only needs the base URL and the scheduler secret.
import { config as loadEnv } from 'dotenv';

loadEnv();

const apiBaseUrl = process.env.LAPSE_SWEEP_BASE_URL
  ?? process.env.API_BASE_URL
  ?? `http://127.0.0.1:${process.env.PORT ?? '3001'}`;
const sweepUrl = `${apiBaseUrl.replace(/\/+$/, '')}/v1/internal/lapse/sweep`;
const schedulerSecret = process.env.SCHEDULER_SECRET;
const batchSize = Number.parseInt(process.env.LAPSE_SWEEP_BATCH_SIZE ?? '200', 10);

if (!schedulerSecret) {
  console.error('SCHEDULER_SECRET is required to run the lapse sweep.');
  process.exit(1);
}

const totals = {
  processed: 0,
  missesApplied: 0,
  lessonDays: 0,
  exemptedCompleted: 0,
  closedLocks: 0,
  skippedUnreadable: 0,
  batches: 0,
};

try {
  let cursor = null;
  do {
    const response = await fetch(sweepUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-scheduler-key': schedulerSecret,
      },
      body: JSON.stringify({
        batchSize: Number.isFinite(batchSize) && batchSize > 0 ? batchSize : 200,
        ...(cursor ? { cursor } : {}),
      }),
    });

    const text = await response.text();
    let body = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }

    if (!response.ok) {
      console.error('Lapse sweep batch failed.', { status: response.status, body });
      process.exit(1);
    }

    totals.processed += body?.processed ?? 0;
    totals.missesApplied += body?.missesApplied ?? 0;
    totals.lessonDays += body?.lessonDays ?? 0;
    totals.exemptedCompleted += body?.exemptedCompleted ?? 0;
    totals.closedLocks += body?.closedLocks ?? 0;
    totals.skippedUnreadable += body?.skippedUnreadable ?? 0;
    totals.batches += 1;
    console.log(`[sweep] batch ${totals.batches}`, JSON.stringify(body));
    cursor = body?.nextCursor ?? null;
  } while (cursor != null);

  console.log('[sweep] done', JSON.stringify(totals));
  // Unreadable rows were neither punished nor absolved — exit nonzero so the
  // cron surfaces it and the next run retries them.
  if (totals.skippedUnreadable > 0) {
    console.warn(`[sweep] ${totals.skippedUnreadable} row(s) unreadable; retried next run`);
    process.exit(2);
  }
} catch (error) {
  console.error('Lapse sweep request failed:', error instanceof Error ? error.message : error);
  process.exit(1);
}
