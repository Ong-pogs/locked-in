// One-shot arena stake-season tick for cron services.
// Render cron: schedule "35 0 * * *", command: npm run cron:arena-season
//
// Runs after 00:30 UTC so a season ending on a UTC day boundary has fully
// closed before this reads it — the same reasoning as run-lapse-sweep.mjs.
//
// Same HTTP pattern as cron:arena-sweep: hit the scheduler-gated endpoint on
// the running web service, which owns the DB and RPC env. This job needs only
// the base URL and the scheduler secret.
import { config as loadEnv } from 'dotenv';

loadEnv();

const apiBaseUrl = process.env.ARENA_SWEEP_BASE_URL
  ?? process.env.API_BASE_URL
  ?? `http://127.0.0.1:${process.env.PORT ?? '3001'}`;
const url = `${apiBaseUrl.replace(/\/+$/, '')}/v1/internal/arena/season`;
const schedulerSecret = process.env.SCHEDULER_SECRET;

if (!schedulerSecret) {
  console.error('SCHEDULER_SECRET is required to run the arena season tick.');
  process.exit(1);
}

const res = await fetch(url, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-scheduler-key': schedulerSecret },
  body: '{}',
});

if (!res.ok) {
  console.error(`[arena-season] ${res.status}: ${await res.text()}`);
  process.exit(1);
}

const b = await res.json();
console.log(
  `[arena-season] opened=${b.opened} closed=${b.closed} settled=${b.settled} `
  + `failed=${b.failed}${b.skipped ? ` skipped=${b.skipped}` : ''}`,
);
