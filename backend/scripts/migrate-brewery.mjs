// One-shot migration runner for the brewery pivot (sql/0035 + sql/0036).
// Uses DATABASE_URL from the Render environment. Idempotent — safe to
// run multiple times.
//
// Run from the Render web shell:
//   node scripts/migrate-brewery.mjs
import pg from 'pg';

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error('DATABASE_URL not set — run this inside the Render service shell.');
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: dbUrl,
  ssl: dbUrl.includes('localhost') ? false : { rejectUnauthorized: false },
});

const steps = [
  {
    name: '0035 — fire_lit_until column',
    sql: `alter table lesson.user_course_runtime_state
            add column if not exists fire_lit_until timestamptz`,
  },
  {
    name: '0035 — fire_lit_until index',
    sql: `create index if not exists user_course_runtime_state_fire_lit_until_idx
            on lesson.user_course_runtime_state (fire_lit_until)`,
  },
  {
    name: '0036 — harvest_result_receipts.claimed_at column',
    sql: `alter table lesson.harvest_result_receipts
            add column if not exists claimed_at timestamptz`,
  },
  {
    name: '0036 — unclaimed receipts partial index',
    sql: `create index if not exists harvest_result_receipts_unclaimed_idx
            on lesson.harvest_result_receipts (wallet_address, course_id)
            where claimed_at is null`,
  },
];

let failures = 0;
for (const step of steps) {
  try {
    await pool.query(step.sql);
    console.log(`✓ ${step.name}`);
  } catch (err) {
    failures += 1;
    console.error(`✗ ${step.name}: ${err.message}`);
  }
}

await pool.end();

if (failures > 0) {
  console.error(`\n${failures} step(s) failed.`);
  process.exit(1);
}

console.log('\nBrewery migrations applied. Safe to re-run anytime.');
