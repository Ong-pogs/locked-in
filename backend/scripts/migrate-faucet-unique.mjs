// Fix for "no unique or exclusion constraint matching ON CONFLICT" on
// /v1/faucet/claim. The reserveClaim function uses
// INSERT ... ON CONFLICT (wallet_address, round) DO NOTHING which needs
// a UNIQUE INDEX on (wallet_address, round). Migration 0034 was supposed
// to add this; if it never ran or the constraint was dropped, the
// faucet 500s.
//
// Run from the Render web shell:
//   node scripts/migrate-faucet-unique.mjs
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

async function main() {
  // 1. Confirm the table exists. If it doesn't, migration 0031 was
  //    never run and we're in deeper trouble.
  const tableExists = await pool.query(
    `select to_regclass('lesson.faucet_claims') is not null as exists`,
  );
  if (!tableExists.rows[0]?.exists) {
    console.error('✗ lesson.faucet_claims table does not exist. Run migrations 0031-0034 first.');
    process.exit(1);
  }
  console.log('✓ lesson.faucet_claims exists');

  // 2. Check for existing duplicates on (wallet_address, round). If we
  //    try to create a UNIQUE index while duplicates exist, it errors.
  const dupes = await pool.query(
    `select wallet_address, round, count(*)::int as n
       from lesson.faucet_claims
       group by wallet_address, round
       having count(*) > 1
       limit 10`,
  );
  if (dupes.rowCount > 0) {
    console.log(`Found ${dupes.rowCount} (wallet, round) groups with duplicates. Deduping (keep oldest)...`);
    const cleanup = await pool.query(
      `delete from lesson.faucet_claims a
         using lesson.faucet_claims b
         where a.wallet_address = b.wallet_address
           and a.round = b.round
           and a.created_at > b.created_at`,
    );
    console.log(`✓ Removed ${cleanup.rowCount} duplicate rows`);
  } else {
    console.log('✓ No duplicates to clean');
  }

  // 3. Add the unique index. CREATE UNIQUE INDEX IF NOT EXISTS is the
  //    idempotent form (ADD CONSTRAINT IF NOT EXISTS doesn't exist in
  //    Postgres). A unique index satisfies ON CONFLICT just as well as
  //    a unique constraint.
  await pool.query(
    `create unique index if not exists faucet_claims_wallet_round_unique
       on lesson.faucet_claims (wallet_address, round)`,
  );
  console.log('✓ Unique index on (wallet_address, round) is in place');

  // 4. Verify by listing indexes on the table.
  const idx = await pool.query(
    `select indexname, indexdef
       from pg_indexes
       where schemaname = 'lesson' and tablename = 'faucet_claims'
       order by indexname`,
  );
  console.log('\nFinal index list:');
  for (const row of idx.rows) {
    console.log(`  ${row.indexname}`);
  }
}

try {
  await main();
  console.log('\nFaucet ON CONFLICT fix applied. Try claiming again.');
} catch (err) {
  console.error('Migration failed:', err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
