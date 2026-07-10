import { execSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { runMigrations } from '../../scripts/migrate.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const backendRoot = join(__dirname, '..', '..');
const sqlDir = join(backendRoot, 'sql');
const composeFile = join(backendRoot, 'docker-compose.test.yml');

const TEST_DB_URL = 'postgresql://test:test@localhost:5433/lockedin_test';

async function waitForDb(maxRetries = 15) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const pool = new pg.Pool({ connectionString: TEST_DB_URL });
      await pool.query('SELECT 1');
      await pool.end();
      return;
    } catch {
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  throw new Error('Test database did not become ready in time');
}

// R22 (single executor): scripts/migrate.mjs is the ONLY code path that
// executes files from backend/sql. The local runMigrations() loop this file
// used to carry is deleted — a fresh test DB applies everything through the
// tracker, exercising the runner on every test run.
//
// Brownfield note (R19/R22): lockedin_test may predate the tracker — every sql
// file was applied by direct execution (this file's old migration loop, or the
// CI workflow's psql loop), so lesson.courses exists but
// lesson.schema_migrations does not. R19 forbids the runner from ever
// baselining implicitly ("auto-backfill is STRUCK"), so the EXPLICIT baseline
// decision is made here, once: baseline to the highest file present on disk (a
// trackerless-but-populated test DB is by definition fully applied by prior
// direct execution), then run a normal apply pass so probe-pending files and
// anything newer than the baseline still go through the tracker. Re-executing
// already-applied files would violate the seed migrations' unique constraints,
// which is exactly what the baseline prevents. A fresh/empty DB skips the
// baseline entirely and applies everything through the tracker.
async function ensureMigrated() {
  const client = new pg.Client({ connectionString: TEST_DB_URL });
  await client.connect();
  let hasCourses = false;
  let hasTracker = false;
  try {
    const res = await client.query(
      `select to_regclass('lesson.courses') as courses,
              to_regclass('lesson.schema_migrations') as tracker`,
    );
    hasCourses = res.rows[0].courses != null;
    hasTracker = res.rows[0].tracker != null;
  } finally {
    await client.end();
  }

  if (hasCourses && !hasTracker) {
    const files = (await readdir(sqlDir)).filter(f => f.endsWith('.sql')).sort();
    const highest = files.length > 0 ? files[files.length - 1].slice(0, 4) : null;
    if (highest) {
      await runMigrations({ databaseUrl: TEST_DB_URL, baseline: highest });
    }
  }

  // allowMissing: the local test DB is shared across git worktrees, so a
  // sibling worktree's migration can be recorded in the tracker while its
  // file is absent from THIS checkout. That must warn, not abort (the strict
  // MISSING_FILES failure still protects real deployments, where migrate.mjs
  // runs without the flag).
  await runMigrations({ databaseUrl: TEST_DB_URL, allowMissing: true });
}

// Check if DB is already running (e.g., CI service container)
async function isDbReady() {
  try {
    const pool = new pg.Pool({ connectionString: TEST_DB_URL });
    await pool.query('SELECT 1');
    await pool.end();
    return true;
  } catch {
    return false;
  }
}

let startedDocker = false;

export async function setup() {
  if (await isDbReady()) {
    // DB already running (CI service container or a local shared instance) —
    // still reconcile through the tracker so the runner stays the single
    // executor (R22).
    await ensureMigrated();
    return;
  }

  // Local dev — start Docker
  execSync(`docker compose -f "${composeFile}" up -d --wait`, {
    stdio: 'pipe',
    cwd: backendRoot,
  });
  startedDocker = true;
  await waitForDb();
  await ensureMigrated();
}

export async function teardown() {
  if (!startedDocker) return;
  execSync(`docker compose -f "${composeFile}" down -v`, {
    stdio: 'pipe',
    cwd: backendRoot,
  });
}
