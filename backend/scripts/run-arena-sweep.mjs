// One-shot arena expiry sweep for cron services.
// Render cron: schedule "*/15 * * * *", command: npm run cron:arena-sweep
//
// Same HTTP pattern as cron:lapse-sweep — hit the scheduler-gated endpoint on
// the running web service, which owns the DB env. This job needs only the base
// URL and the scheduler secret.
import { config as loadEnv } from 'dotenv';

loadEnv();

const apiBaseUrl = process.env.ARENA_SWEEP_BASE_URL
  ?? process.env.API_BASE_URL
  ?? `http://127.0.0.1:${process.env.PORT ?? '3001'}`;
const sweepUrl = `${apiBaseUrl.replace(/\/+$/, '')}/v1/internal/arena/sweep`;
const schedulerSecret = process.env.SCHEDULER_SECRET;

if (!schedulerSecret) {
  console.error('SCHEDULER_SECRET is required to run the arena sweep.');
  process.exit(1);
}

const res = await fetch(sweepUrl, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-scheduler-key': schedulerSecret },
  body: '{}',
});

if (!res.ok) {
  console.error(`[arena-sweep] ${res.status}: ${await res.text()}`);
  process.exit(1);
}

const body = await res.json();
console.log(`[arena-sweep] expired=${body.expired} settled=${body.settled}${body.skipped ? ` skipped=${body.skipped}` : ''}`);
