// One-shot monthly community-pot cycle for cron services. Closes the previous
// (fully elapsed) UTC month's distribution window and pays winners — fully
// automatic, no manual trigger. Idempotent + advisory-locked, so a duplicate
// run is a benign no-op.
//
// Render cron: schedule "0 3 1 * *" (03:00 UTC on day 1 → targets the month
// that just ended), command: npm run cron:pot-cycle
import { config as loadEnv } from 'dotenv';

loadEnv();

const apiBaseUrl = process.env.POT_CYCLE_BASE_URL
  ?? process.env.API_BASE_URL
  ?? `http://127.0.0.1:${process.env.PORT ?? '3001'}`;
const runUrl = process.env.POT_CYCLE_RUN_URL
  ?? `${apiBaseUrl.replace(/\/+$/, '')}/v1/internal/pot-cycle/run`;
const schedulerSecret = process.env.SCHEDULER_SECRET;

if (!schedulerSecret) {
  console.error('SCHEDULER_SECRET is required to run the pot cycle.');
  process.exit(1);
}

// execute:true = actually close + distribute (not preview). windowId omitted →
// the cycle targets the previous UTC month itself; NEVER the current/future
// month (enforced in runPotCycle).
const payload = { execute: true };

try {
  const response = await fetch(runUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-scheduler-key': schedulerSecret },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  let body = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = text; }
  }

  // The endpoint returns 500 only for non-benign failures; benign exits
  // (NOTHING_TO_DISTRIBUTE, ALREADY_CLOSED, NO_PENDING_RECIPIENTS) are 200.
  if (!response.ok) {
    console.error('Pot cycle failed.', { status: response.status, body });
    process.exit(1);
  }

  console.log('Pot cycle complete.', {
    windowId: body?.windowId ?? null,
    benign: body?.benign ?? null,
    reason: body?.reason ?? null,
    execute: body?.execute ?? null,
  });
} catch (error) {
  console.error('Pot cycle request failed:', error instanceof Error ? error.message : error);
  process.exit(1);
}
