#!/usr/bin/env node
// Schema-migrations runner + tracker.
//
// Binding spec: docs/superpowers/rulings/2026-07-10-backend-round2-rulings.md,
// section "Design: practice-mode", R17 (runner), R18 (sequence), R19 (baseline
// probes), R20 (npm scripts), R22 (single executor). This file is the ONLY
// code path allowed to execute files from backend/sql (R22).
//
// Usage:
//   node scripts/migrate.mjs                     apply all pending sql/*.sql
//   node scripts/migrate.mjs --dry-run           print applied/pending/drifted, execute nothing
//   node scripts/migrate.mjs --baseline 0042     record files <= 0042 as applied WITHOUT executing
//                                                (probe-verified; refuses on an empty database)
//   node scripts/migrate.mjs --allow-missing     warn (instead of exit 1) on recorded files
//                                                that are missing from disk
//   node scripts/migrate.mjs --strict-checksums  exit 1 on checksum drift instead of warning
//
// R17: uses its OWN pg.Client with the same local-vs-remote ssl heuristic as
// src/lib/db.mjs but NO statement_timeout and NO RLS wallet-claim plumbing.
// Never imports the app pool from src/lib/db.mjs.

import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import process from 'node:process';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_SQL_DIR = join(__dirname, '..', 'sql');

// R18(1): one session-level advisory lock guards concurrent runs everywhere.
export const MIGRATION_ADVISORY_LOCK_KEY = 727274001;

export class MigrationError extends Error {
  constructor(message, code, options) {
    super(message, options);
    this.name = 'MigrationError';
    this.code = code;
  }
}

function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function columnExists(client, tableSchema, tableName, columnName) {
  const result = await client.query(
    `select 1
       from information_schema.columns
      where table_schema = $1 and table_name = $2 and column_name = $3`,
    [tableSchema, tableName, columnName],
  );
  return result.rowCount > 0;
}

async function regclassExists(client, qualifiedName) {
  const result = await client.query('select to_regclass($1) as oid', [qualifiedName]);
  return result.rows[0].oid != null;
}

// R19 binding baseline probes, keyed by the 4-digit migration number. A probe
// resolves true when the migration's effect is already present in the database
// (safe to record without executing); false leaves the file pending so a
// normal run applies it. Files without probes are recorded as-is under the
// explicit operator flag.
const BASELINE_PROBES = {
  // 0038 applied iff yield_splitter_status is ABSENT from harvest_result_receipts.
  '0038': async (client) =>
    !(await columnExists(client, 'lesson', 'harvest_result_receipts', 'yield_splitter_status')),
  // 0039 applied iff skr_locked_amount is ABSENT from user_course_runtime_state.
  '0039': async (client) =>
    !(await columnExists(client, 'lesson', 'user_course_runtime_state', 'skr_locked_amount')),
  // 0040 applied iff user_course_runtime_state has lapse_count.
  '0040': async (client) =>
    columnExists(client, 'lesson', 'user_course_runtime_state', 'lapse_count'),
  // 0041 applied iff user_course_runtime_state has shields.
  '0041': async (client) =>
    columnExists(client, 'lesson', 'user_course_runtime_state', 'shields'),
  // 0042 applied iff lesson.sol_drips exists.
  '0042': async (client) => regclassExists(client, 'lesson.sol_drips'),
};

/**
 * Run the migration sequence per R18. Returns a summary:
 * { mode, files, alreadyApplied, applied, baselined, probePending, pending, drifted, missing }.
 * Throws MigrationError (the CLI maps any throw to exit 1).
 *
 * `sqlDir` and `log` are not part of the CLI surface — they are injection
 * points for the test suite (R23h).
 */
export async function runMigrations({
  databaseUrl = process.env.DATABASE_URL,
  dryRun = false,
  baseline = null,
  allowMissing = false,
  strictChecksums = false,
  sqlDir = DEFAULT_SQL_DIR,
  log = console,
} = {}) {
  if (!databaseUrl) {
    throw new MigrationError(
      'DATABASE_URL is not configured — refusing to run (set the env var or pass databaseUrl)',
      'NO_DATABASE_URL',
    );
  }
  if (baseline != null && !/^\d{4}$/.test(String(baseline))) {
    throw new MigrationError(
      `--baseline expects a 4-digit migration number (e.g. --baseline 0042), got: ${baseline}`,
      'BAD_BASELINE',
    );
  }

  // R18(4): backend/sql/*.sql sorted lexicographically.
  // R18(6): checksum = sha256 hex of the raw file bytes.
  const filenames = (await readdir(sqlDir)).filter((f) => f.endsWith('.sql')).sort();
  const fileByName = new Map();
  for (const filename of filenames) {
    const bytes = await readFile(join(sqlDir, filename));
    fileByName.set(filename, { sql: bytes.toString('utf8'), checksum: sha256Hex(bytes) });
  }

  // Same local-vs-remote ssl heuristic as src/lib/db.mjs (R17); dedicated
  // client, no statement_timeout, no RLS claim.
  const isLocalDb = /@(?:localhost|127\.0\.0\.1|\[::1\])(?::|\/)/i.test(databaseUrl);
  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: isLocalDb ? false : { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    if (!dryRun) {
      // R18(1): advisory lock held for the whole run; the session end in the
      // finally block releases it. Skipped under --dry-run.
      await client.query('select pg_advisory_lock(727274001)');
      // R18(2)+(3)
      await client.query('create schema if not exists lesson');
      await client.query(
        `create table if not exists lesson.schema_migrations (
           filename text primary key,
           checksum text not null,
           applied_at timestamptz not null default now()
         )`,
      );
    }

    // R18(8): --dry-run tolerates an absent tracker table (everything pending).
    const recorded = new Map();
    if (await regclassExists(client, 'lesson.schema_migrations')) {
      const result = await client.query('select filename, checksum from lesson.schema_migrations');
      for (const row of result.rows) {
        recorded.set(row.filename, row.checksum);
      }
    }

    // R18(5): recorded-but-missing-from-disk files.
    const missing = [...recorded.keys()].filter((f) => !fileByName.has(f)).sort();
    if (missing.length > 0) {
      const message = `recorded migrations missing from disk: ${missing.join(', ')}`;
      if (!allowMissing && !dryRun) {
        throw new MigrationError(message, 'MISSING_FILES');
      }
      log.warn(`[migrate] WARNING: ${message}`);
    }

    // R18(6): checksum drift between recorded and disk.
    const drifted = filenames.filter(
      (f) => recorded.has(f) && recorded.get(f) !== fileByName.get(f).checksum,
    );
    if (drifted.length > 0) {
      const message = `checksum drift between recorded and on-disk migrations: ${drifted.join(', ')}`;
      if (strictChecksums) {
        throw new MigrationError(message, 'CHECKSUM_DRIFT');
      }
      log.warn(`[migrate] WARNING: ${message}`);
    }

    const alreadyApplied = filenames.filter((f) => recorded.has(f));

    // R19: --baseline <NNNN> is the ONLY seeding path (auto-backfill is
    // struck — the runner never seeds on "first run"). Records files <= NNNN
    // as applied with current checksums WITHOUT executing them, except files
    // whose probe reports unapplied — those stay pending for a normal run.
    if (baseline != null) {
      if (!(await regclassExists(client, 'lesson.courses'))) {
        throw new MigrationError('refusing to baseline an empty database', 'BASELINE_EMPTY_DB');
      }
      const candidates = filenames.filter(
        (f) => f.slice(0, 4) <= String(baseline) && !recorded.has(f),
      );
      const baselined = [];
      const probePending = [];
      for (const filename of candidates) {
        const probe = BASELINE_PROBES[filename.slice(0, 4)];
        if (probe && !(await probe(client))) {
          probePending.push(filename);
        } else {
          baselined.push(filename);
        }
      }

      if (!dryRun && baselined.length > 0) {
        await client.query('begin');
        try {
          for (const filename of baselined) {
            await client.query(
              'insert into lesson.schema_migrations (filename, checksum) values ($1, $2)',
              [filename, fileByName.get(filename).checksum],
            );
          }
          await client.query('commit');
        } catch (error) {
          await client.query('rollback');
          throw new MigrationError(`baseline recording failed: ${error.message}`, 'BASELINE_FAILED', {
            cause: error,
          });
        }
      }

      const pending = filenames.filter((f) => !recorded.has(f) && !baselined.includes(f));
      for (const filename of baselined) {
        log.info(`[migrate] baselined ${filename} (recorded without executing)`);
      }
      for (const filename of probePending) {
        log.info(`[migrate] probe reports NOT applied — left pending: ${filename}`);
      }
      log.info(
        `[migrate] baseline <= ${baseline}: recorded ${baselined.length}, probe-pending ${probePending.length}, ` +
          `still pending ${pending.length}${dryRun ? ' (dry-run: nothing written)' : ''}`,
      );
      return {
        mode: 'baseline',
        dryRun,
        files: filenames,
        alreadyApplied,
        applied: [],
        baselined,
        probePending,
        pending,
        drifted,
        missing,
      };
    }

    const pending = filenames.filter((f) => !recorded.has(f));

    // R18: refuse any file containing the token CONCURRENTLY (case-insensitive)
    // — CREATE INDEX CONCURRENTLY cannot run inside the per-file transaction.
    // Checked across ALL pending files before anything executes, so a refusal
    // never leaves a partial apply behind.
    const concurrentlyFiles = pending.filter((f) => /concurrently/i.test(fileByName.get(f).sql));
    if (concurrentlyFiles.length > 0) {
      const message =
        'refusing to run migrations containing CONCURRENTLY ' +
        `(cannot run inside a transaction): ${concurrentlyFiles.join(', ')}`;
      if (!dryRun) {
        throw new MigrationError(message, 'CONCURRENTLY_REFUSED');
      }
      log.warn(`[migrate] WARNING: ${message}`);
    }

    if (dryRun) {
      log.info(
        `[migrate] dry-run: ${alreadyApplied.length} applied, ${pending.length} pending, ` +
          `${drifted.length} drifted, ${missing.length} missing`,
      );
      for (const filename of pending) log.info(`[migrate]   pending: ${filename}`);
      for (const filename of drifted) log.info(`[migrate]   drifted: ${filename}`);
      for (const filename of missing) log.info(`[migrate]   missing: ${filename}`);
      return {
        mode: 'dry-run',
        dryRun: true,
        files: filenames,
        alreadyApplied,
        applied: [],
        baselined: [],
        probePending: [],
        pending,
        drifted,
        missing,
      };
    }

    // R18(7): per pending file — BEGIN, single query with the file contents,
    // tracker INSERT, COMMIT. First error rolls back and aborts immediately;
    // later files stay untouched.
    const applied = [];
    for (const filename of pending) {
      const { sql, checksum } = fileByName.get(filename);
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query(
          'insert into lesson.schema_migrations (filename, checksum) values ($1, $2)',
          [filename, checksum],
        );
        await client.query('commit');
      } catch (error) {
        try {
          await client.query('rollback');
        } catch {
          // Connection state unknown — client.end() in finally closes it anyway.
        }
        throw new MigrationError(`migration ${filename} failed: ${error.message}`, 'APPLY_FAILED', {
          cause: error,
        });
      }
      applied.push(filename);
      log.info(`[migrate] applied ${filename}`);
    }

    log.info(`[migrate] done: ${applied.length} applied, ${alreadyApplied.length} previously applied`);
    return {
      mode: 'apply',
      dryRun: false,
      files: filenames,
      alreadyApplied,
      applied,
      baselined: [],
      probePending: [],
      pending: [],
      drifted,
      missing,
    };
  } finally {
    // Session end releases pg_advisory_lock(727274001).
    await client.end();
  }
}

function parseCliArgs(argv) {
  const options = { dryRun: false, baseline: null, allowMissing: false, strictChecksums: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--allow-missing') {
      options.allowMissing = true;
    } else if (arg === '--strict-checksums') {
      options.strictChecksums = true;
    } else if (arg === '--baseline') {
      const value = argv[i + 1];
      i += 1;
      if (!value || !/^\d{4}$/.test(value)) {
        throw new MigrationError(
          `--baseline requires a 4-digit migration number (e.g. --baseline 0042), got: ${value ?? '(nothing)'}`,
          'BAD_ARGS',
        );
      }
      options.baseline = value;
    } else {
      throw new MigrationError(
        `unknown argument: ${arg} (supported: --dry-run, --baseline <NNNN>, --allow-missing, --strict-checksums)`,
        'BAD_ARGS',
      );
    }
  }
  return options;
}

const invokedAsCli =
  process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedAsCli) {
  try {
    const options = parseCliArgs(process.argv.slice(2));
    await runMigrations(options);
  } catch (error) {
    console.error(`[migrate] ERROR: ${error.message}`);
    process.exit(1);
  }
}
