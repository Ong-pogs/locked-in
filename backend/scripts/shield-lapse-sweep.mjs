#!/usr/bin/env node
// Daily lapse sweep runner (sweep ruling R16, as amended).
//
// Loops runLapseSweepBatch until nextCursor is null, printing per-batch and
// total counters. Exits nonzero on any error so the Render cron surfaces
// failures. Rollback for the sweep is: disable the cron — day-keyed receipts
// and last_miss_day make every applied day auditable and the system inert
// without the trigger.
//
// Usage:
//   node scripts/shield-lapse-sweep.mjs [--as-of-day YYYY-MM-DD] [--batch-size N]
//
// asOfDay defaults to UTC yesterday and must be strictly before today (UTC):
// the sweep never judges the current day. DO NOT enable the daily cron until
// enroll-on-deposit (registration), the practice gate, and the completion
// exit are deployed — see the ruling's deploy sequence.

if (!process.env.DATABASE_URL) {
  console.error('shield-lapse-sweep: DATABASE_URL is required. Refusing to run.');
  process.exit(1);
}

const { runLapseSweepBatch, utcYesterday } = await import('../src/lib/lapseSweep.mjs');

function parseArgs(argv) {
  const args = { asOfDay: null, batchSize: 200 };
  for (let i = 2; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--as-of-day') {
      args.asOfDay = argv[++i];
    } else if (flag === '--batch-size') {
      args.batchSize = Number.parseInt(argv[++i], 10);
    } else {
      console.error(`shield-lapse-sweep: unknown flag ${flag}`);
      process.exit(1);
    }
  }
  if (args.asOfDay != null && !/^\d{4}-\d{2}-\d{2}$/.test(args.asOfDay)) {
    console.error('shield-lapse-sweep: --as-of-day must be YYYY-MM-DD');
    process.exit(1);
  }
  if (!Number.isFinite(args.batchSize) || args.batchSize < 1 || args.batchSize > 1000) {
    console.error('shield-lapse-sweep: --batch-size must be an integer 1..1000');
    process.exit(1);
  }
  return args;
}

const { asOfDay: asOfDayArg, batchSize } = parseArgs(process.argv);
const asOfDay = asOfDayArg ?? utcYesterday();

const consoleLog = {
  info: (fields, msg) => console.log(`[sweep] ${msg}`, JSON.stringify(fields)),
  warn: (fields, msg) => console.warn(`[sweep] ${msg}`, JSON.stringify(fields)),
};

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
    const batch = await runLapseSweepBatch({ asOfDay, batchSize, cursor, log: consoleLog });
    totals.processed += batch.processed;
    totals.missesApplied += batch.missesApplied;
    totals.lessonDays += batch.lessonDays;
    totals.exemptedCompleted += batch.exemptedCompleted;
    totals.closedLocks += batch.closedLocks;
    totals.skippedUnreadable += batch.skippedUnreadable;
    totals.batches += 1;
    console.log(`[sweep] batch ${totals.batches} complete`, JSON.stringify(batch));
    cursor = batch.nextCursor;
  } while (cursor != null);

  console.log(`[sweep] done asOfDay=${asOfDay}`, JSON.stringify(totals));
  // Unreadable rows were neither punished nor absolved — surface loudly so
  // monitoring re-runs the sweep rather than silently leaving days unjudged.
  if (totals.skippedUnreadable > 0) {
    console.warn(
      `[sweep] ${totals.skippedUnreadable} row(s) skipped as unreadable; they will be retried next run`,
    );
  }
  process.exit(0);
} catch (error) {
  console.error('[sweep] FAILED:', error?.message ?? error);
  process.exit(1);
}
