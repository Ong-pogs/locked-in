// One-shot migration runner for sql/0037 — adds off-chain ichor
// balance columns to user_course_runtime_state.
//
// Run from the Render web shell:
//   node scripts/migrate-ichor-off-chain.mjs
//
// Idempotent — safe to re-run.
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
    name: '0037 — ichor_counter column',
    sql: `alter table lesson.user_course_runtime_state
            add column if not exists ichor_counter bigint not null default 0`,
  },
  {
    name: '0037 — ichor_lifetime_total column',
    sql: `alter table lesson.user_course_runtime_state
            add column if not exists ichor_lifetime_total bigint not null default 0`,
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

console.log('\nIchor off-chain columns applied. Safe to re-run anytime.');
