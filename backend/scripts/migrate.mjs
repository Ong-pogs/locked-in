// Production database migration runner.
//
// Applies backend/sql/*.sql in filename order against $DATABASE_URL, recording
// each applied file in public.schema_migrations so every migration runs exactly
// once. Safe to run on every deploy — wire it as a Render pre-deploy/release cmd.
//
// Usage (run from backend/, or anywhere DATABASE_URL is set):
//   node scripts/migrate.mjs              # apply pending migrations
//   node scripts/migrate.mjs --status     # list applied vs pending, change nothing
//   node scripts/migrate.mjs --dry-run    # show what WOULD apply, change nothing
//   node scripts/migrate.mjs --baseline   # adopt an existing DB: record ALL
//                                          #   current files as applied, run NONE
//   node scripts/migrate.mjs --baseline --through <file>
//                                          # baseline only up to+including <file>
//
// WHY --baseline exists: a prod DB created before this runner has no ledger.
// Several early migrations are seed files (0002, 0015, 0022…) whose INSERTs are
// NOT re-runnable. So we must NOT blind-apply history. Adopt the DB by baselining
// through the last migration it already has, then apply only what's newer:
//   node scripts/migrate.mjs --baseline --through 0038_drop_yield_splitter_columns.sql
//   node scripts/migrate.mjs            # applies 0039 (and anything added later)
import { config as loadEnv } from 'dotenv';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

loadEnv(); // local .env; on Render the real env already wins (dotenv won't override)

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqlDir = join(__dirname, '..', 'sql');

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error('DATABASE_URL not set — set it in the environment (e.g. Render service env).');
  process.exit(1);
}

// --- tiny CLI flag parsing -------------------------------------------------
const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const valueOf = (flag) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : null;
};
const MODE_STATUS = has('--status');
const MODE_DRYRUN = has('--dry-run');
const MODE_BASELINE = has('--baseline');
const THROUGH = valueOf('--through');
const FORCE = has('--force');

const pool = new pg.Pool({
  connectionString: dbUrl,
  // Mirrors the app's own connection in src/lib/db.mjs: local needs no SSL;
  // Render's managed Postgres uses a self-signed chain, so rejectUnauthorized
  // is false to keep the wire ENCRYPTED (just not cert-verified). Must match
  // db.mjs or this runner couldn't connect to the same database.
  ssl: dbUrl.includes('localhost') ? false : { rejectUnauthorized: false },
});

async function listSqlFiles() {
  // Filenames are zero-padded (0001…0039) so lexicographic sort == apply order.
  return (await readdir(sqlDir)).filter((f) => f.endsWith('.sql')).sort();
}

async function ensureLedger() {
  // Tracking table lives in `public` (always present) to avoid a chicken-and-egg
  // with the `lesson` schema that migration 0001 creates.
  await pool.query(`
    create table if not exists public.schema_migrations (
      filename text primary key,
      applied_at timestamptz not null default now()
    )
  `);
}

async function appliedSet() {
  const { rows } = await pool.query('select filename from public.schema_migrations');
  return new Set(rows.map((r) => r.filename));
}

async function dbAlreadyPopulated() {
  // Heuristic: a core app table exists → this DB predates the ledger.
  const { rows } = await pool.query(
    "select to_regclass('lesson.user_course_runtime_state') as t",
  );
  return rows[0]?.t != null;
}

async function markBaselined(files) {
  for (const f of files) {
    await pool.query(
      'insert into public.schema_migrations(filename) values ($1) on conflict do nothing',
      [f],
    );
    console.log(`baselined (not executed): ${f}`);
  }
}

async function applyFile(f) {
  const sql = await readFile(join(sqlDir, f), 'utf8');
  const client = await pool.connect();
  try {
    // One transaction per file: the migration + its ledger row commit together,
    // so a failure leaves the file un-applied AND un-recorded (clean retry).
    await client.query('begin');
    await client.query(sql);
    await client.query('insert into public.schema_migrations(filename) values ($1)', [f]);
    await client.query('commit');
    console.log(`✓ applied ${f}`);
    return true;
  } catch (err) {
    await client.query('rollback').catch(() => {});
    console.error(`✗ failed ${f}: ${err.message}`);
    return false;
  } finally {
    client.release();
  }
}

async function main() {
  const files = await listSqlFiles();
  await ensureLedger();
  const applied = await appliedSet();

  if (MODE_STATUS) {
    for (const f of files) console.log(`${applied.has(f) ? '✓ applied' : '· pending'}  ${f}`);
    console.log(`\n${applied.size}/${files.length} applied.`);
    return;
  }

  if (MODE_BASELINE) {
    const cutoff = THROUGH ?? files[files.length - 1];
    if (!files.includes(cutoff)) {
      throw new Error(`--through '${cutoff}' is not a known sql file in ${sqlDir}`);
    }
    const toMark = files.filter((f) => f <= cutoff && !applied.has(f));
    await markBaselined(toMark);
    console.log(
      `\nBaselined ${toMark.length} file(s) through ${cutoff}. ` +
        'Run again with no flag to apply anything newer.',
    );
    return;
  }

  const pending = files.filter((f) => !applied.has(f));

  // Footgun guard: an empty ledger on a populated DB means we'd be about to
  // re-run historical (incl. non-idempotent seed) migrations. Refuse → baseline.
  if (applied.size === 0 && pending.length > 0 && !FORCE && (await dbAlreadyPopulated())) {
    console.error(
      'Refusing to run: this database already has app tables but no migration ledger.\n' +
        'It predates this runner. Adopt it first by baselining through the last migration\n' +
        'it already has, e.g.:\n' +
        '  node scripts/migrate.mjs --baseline --through 0038_drop_yield_splitter_columns.sql\n' +
        '  node scripts/migrate.mjs            # then applies only newer migrations\n' +
        '(--force overrides and runs everything — NOT recommended; seed files will conflict.)',
    );
    process.exitCode = 2;
    return;
  }

  if (pending.length === 0) {
    console.log('No pending migrations. Database is up to date.');
    return;
  }

  if (MODE_DRYRUN) {
    console.log('Would apply:');
    for (const f of pending) console.log(`  ${f}`);
    return;
  }

  for (const f of pending) {
    const ok = await applyFile(f);
    if (!ok) {
      console.error('Aborting — no further migrations applied.');
      process.exitCode = 1;
      return;
    }
  }
  console.log(`\nApplied ${pending.length} migration(s). Database is up to date.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
