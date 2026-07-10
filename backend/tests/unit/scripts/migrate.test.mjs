// R23(h) coverage for the schema-migrations runner (scripts/migrate.mjs):
// fresh-DB full apply, baseline refused on empty DB, probes leave 0038/0039
// pending, missing-recorded-file exit 1 without --allow-missing, checksum-drift
// warn, CONCURRENTLY refusal, dry-run touches nothing.
//
// These tests need a real Postgres. They connect to the shared test instance
// on :5433 ONLY to CREATE/DROP per-test scratch databases (migrate_test_*) —
// lockedin_test itself is never migrated, truncated, or dropped here.
import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFile, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { runMigrations } from '../../../scripts/migrate.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const backendRoot = join(__dirname, '..', '..', '..');
const realSqlDir = join(backendRoot, 'sql');
const migrateCli = join(backendRoot, 'scripts', 'migrate.mjs');

const ADMIN_DB_URL = 'postgresql://test:test@localhost:5433/lockedin_test';

const scratchDbs = [];
const tempDirs = [];

async function queryUrl(url, sql, params = []) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await client.query(sql, params);
  } finally {
    await client.end();
  }
}

async function createScratchDb() {
  const name = `migrate_test_${randomBytes(6).toString('hex')}`;
  await queryUrl(ADMIN_DB_URL, `create database ${name}`);
  scratchDbs.push(name);
  return { name, url: `postgresql://test:test@localhost:5433/${name}` };
}

async function makeSqlDir(files) {
  const dir = await mkdtemp(join(tmpdir(), 'migrate-sql-'));
  tempDirs.push(dir);
  for (const [name, sql] of Object.entries(files)) {
    await writeFile(join(dir, name), sql);
  }
  return dir;
}

function silentLog() {
  const entries = { info: [], warn: [], error: [] };
  return {
    entries,
    info: (...args) => entries.info.push(args.join(' ')),
    warn: (...args) => entries.warn.push(args.join(' ')),
    error: (...args) => entries.error.push(args.join(' ')),
  };
}

async function listRealSqlFiles() {
  return (await readdir(realSqlDir)).filter(f => f.endsWith('.sql')).sort();
}

// Deliberately non-idempotent seed (0002): re-executing it violates the PK,
// mirroring the real seed migrations. The tracker is what must prevent re-runs.
const FIXTURES = {
  '0001_widgets.sql': 'create table if not exists lesson.widgets (id int primary key, label text not null);\n',
  '0002_seed_widgets.sql': "insert into lesson.widgets (id, label) values (1, 'alpha');\n",
  '0003_gadgets.sql': 'create table if not exists lesson.gadgets (id int primary key);\n',
};

afterAll(async () => {
  for (const name of scratchDbs) {
    await queryUrl(ADMIN_DB_URL, `drop database if exists ${name} with (force)`);
  }
  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe('runMigrations (scripts/migrate.mjs)', () => {
  it('fresh DB: applies every backend/sql file through the tracker, then no-ops on re-run', async () => {
    const db = await createScratchDb();
    const log = silentLog();
    const diskFiles = await listRealSqlFiles();

    const first = await runMigrations({ databaseUrl: db.url, log });
    expect(first.mode).toBe('apply');
    expect(first.applied).toEqual(diskFiles);

    const rows = await queryUrl(
      db.url,
      'select filename, checksum from lesson.schema_migrations order by filename',
    );
    expect(rows.rows.map(r => r.filename)).toEqual(diskFiles);
    expect(rows.rows.every(r => /^[0-9a-f]{64}$/.test(r.checksum))).toBe(true);

    // Spot-check a real schema effect landed.
    const courses = await queryUrl(db.url, "select to_regclass('lesson.courses') as t");
    expect(courses.rows[0].t).toBe('lesson.courses');

    // Re-run: nothing re-executes (the seed files are not idempotent — a
    // re-execution would blow unique constraints, so this proves the tracker).
    const second = await runMigrations({ databaseUrl: db.url, log });
    expect(second.applied).toEqual([]);
    expect(second.alreadyApplied).toEqual(diskFiles);
  }, 180_000);

  it('baseline: refused on an empty database', async () => {
    const db = await createScratchDb();
    await expect(
      runMigrations({ databaseUrl: db.url, baseline: '0042', log: silentLog() }),
    ).rejects.toMatchObject({
      code: 'BASELINE_EMPTY_DB',
      message: expect.stringContaining('refusing to baseline an empty database'),
    });
    // Nothing was recorded (schema+tracker creation per R18(2,3) is allowed,
    // but the tracker must be empty).
    const rows = await queryUrl(db.url, 'select count(*)::int as n from lesson.schema_migrations');
    expect(rows.rows[0].n).toBe(0);
  });

  it('baseline probes leave 0038/0039 pending on a pre-drop DB; a normal run then applies them', async () => {
    const db = await createScratchDb();
    const log = silentLog();

    // Build a prod-like DB: everything before 0038 applied, then drop the
    // tracker to simulate a database migrated before the tracker existed.
    const all = await listRealSqlFiles();
    const pre = all.filter(f => f.slice(0, 4) < '0038');
    const preDir = await mkdtemp(join(tmpdir(), 'migrate-pre0038-'));
    tempDirs.push(preDir);
    for (const f of pre) {
      await copyFile(join(realSqlDir, f), join(preDir, f));
    }
    await runMigrations({ databaseUrl: db.url, sqlDir: preDir, log });
    await queryUrl(db.url, 'drop table lesson.schema_migrations');

    // Sanity: the columns 0038/0039 drop are still present pre-baseline.
    const sanity = await queryUrl(
      db.url,
      `select
         (select count(*) from information_schema.columns
           where table_schema='lesson' and table_name='harvest_result_receipts'
             and column_name='yield_splitter_status')::int as ys,
         (select count(*) from information_schema.columns
           where table_schema='lesson' and table_name='user_course_runtime_state'
             and column_name='skr_locked_amount')::int as skr`,
    );
    expect(sanity.rows[0]).toEqual({ ys: 1, skr: 1 });

    // Baseline <= 0039 against the FULL sql dir: probes must report 0038/0039
    // unapplied (their drops have not run here) and leave them pending.
    const baselineRun = await runMigrations({
      databaseUrl: db.url,
      baseline: '0039',
      sqlDir: realSqlDir,
      log,
    });
    expect(baselineRun.mode).toBe('baseline');
    expect(baselineRun.baselined).toEqual(pre);
    expect(baselineRun.probePending).toEqual([
      '0038_drop_yield_splitter_columns.sql',
      '0039_drop_skr_columns.sql',
    ]);
    expect(baselineRun.pending).toContain('0038_drop_yield_splitter_columns.sql');
    expect(baselineRun.pending).toContain('0039_drop_skr_columns.sql');

    // Normal run applies the probe-pending files (0038, 0039 first, plus any
    // later migrations on disk) without re-executing the baselined seeds.
    const applyRun = await runMigrations({ databaseUrl: db.url, sqlDir: realSqlDir, log });
    expect(applyRun.applied.slice(0, 2)).toEqual([
      '0038_drop_yield_splitter_columns.sql',
      '0039_drop_skr_columns.sql',
    ]);
    const after = await queryUrl(
      db.url,
      `select
         (select count(*) from information_schema.columns
           where table_schema='lesson' and table_name='harvest_result_receipts'
             and column_name='yield_splitter_status')::int as ys,
         (select count(*) from information_schema.columns
           where table_schema='lesson' and table_name='user_course_runtime_state'
             and column_name='skr_locked_amount')::int as skr`,
    );
    expect(after.rows[0]).toEqual({ ys: 0, skr: 0 });
  }, 180_000);

  it('missing recorded file: fails (exit-1 path) without --allow-missing, warns and continues with it', async () => {
    const db = await createScratchDb();
    const dir = await makeSqlDir(FIXTURES);
    await runMigrations({ databaseUrl: db.url, sqlDir: dir, log: silentLog() });

    await rm(join(dir, '0002_seed_widgets.sql'));

    await expect(
      runMigrations({ databaseUrl: db.url, sqlDir: dir, log: silentLog() }),
    ).rejects.toMatchObject({
      code: 'MISSING_FILES',
      message: expect.stringContaining('0002_seed_widgets.sql'),
    });

    const log = silentLog();
    const result = await runMigrations({ databaseUrl: db.url, sqlDir: dir, allowMissing: true, log });
    expect(result.missing).toEqual(['0002_seed_widgets.sql']);
    expect(result.applied).toEqual([]);
    expect(log.entries.warn.join('\n')).toContain('0002_seed_widgets.sql');
  });

  it('checksum drift: warns and lists by default (no re-execution), exits 1 under --strict-checksums', async () => {
    const db = await createScratchDb();
    const dir = await makeSqlDir(FIXTURES);
    await runMigrations({ databaseUrl: db.url, sqlDir: dir, log: silentLog() });

    await writeFile(
      join(dir, '0001_widgets.sql'),
      `${FIXTURES['0001_widgets.sql']}-- edited after apply\n`,
    );

    const log = silentLog();
    const result = await runMigrations({ databaseUrl: db.url, sqlDir: dir, log });
    expect(result.drifted).toEqual(['0001_widgets.sql']);
    expect(result.applied).toEqual([]);
    expect(
      log.entries.warn.some(w => w.includes('drift') && w.includes('0001_widgets.sql')),
    ).toBe(true);

    await expect(
      runMigrations({ databaseUrl: db.url, sqlDir: dir, strictChecksums: true, log: silentLog() }),
    ).rejects.toMatchObject({ code: 'CHECKSUM_DRIFT' });
  });

  it('CONCURRENTLY refusal: refuses the run before executing anything', async () => {
    const db = await createScratchDb();
    const dir = await makeSqlDir({
      '0001_widgets.sql': FIXTURES['0001_widgets.sql'],
      '0002_bad_index.sql':
        'create index concurrently widgets_label_idx on lesson.widgets (label);\n',
    });

    await expect(
      runMigrations({ databaseUrl: db.url, sqlDir: dir, log: silentLog() }),
    ).rejects.toMatchObject({
      code: 'CONCURRENTLY_REFUSED',
      message: expect.stringContaining('0002_bad_index.sql'),
    });

    // Refusal happens before any file executes — even the clean 0001.
    const widgets = await queryUrl(db.url, "select to_regclass('lesson.widgets') as t");
    expect(widgets.rows[0].t).toBeNull();
    const rows = await queryUrl(db.url, 'select count(*)::int as n from lesson.schema_migrations');
    expect(rows.rows[0].n).toBe(0);
  });

  it('dry-run: reports everything pending and touches nothing (tolerates absent tracker)', async () => {
    const db = await createScratchDb();
    const dir = await makeSqlDir(FIXTURES);
    const log = silentLog();

    const result = await runMigrations({ databaseUrl: db.url, dryRun: true, sqlDir: dir, log });
    expect(result.mode).toBe('dry-run');
    expect(result.pending).toEqual(Object.keys(FIXTURES).sort());
    expect(result.applied).toEqual([]);

    // Nothing was created: no lesson schema, no tracker, no fixture tables.
    const state = await queryUrl(
      db.url,
      `select
         (select count(*) from information_schema.schemata where schema_name = 'lesson')::int as schemas,
         to_regclass('lesson.schema_migrations') as tracker,
         to_regclass('lesson.widgets') as widgets`,
    );
    expect(state.rows[0]).toEqual({ schemas: 0, tracker: null, widgets: null });
  });

  it('failing migration: rolls back atomically, records nothing for it, leaves later files untouched', async () => {
    const db = await createScratchDb();
    const dir = await makeSqlDir({
      '0001_ok.sql': 'create table lesson.aaa (id int primary key);\n',
      '0002_bad.sql': 'create table lesson.bbb (id int primary key);\nselect boom_no_such_function();\n',
      '0003_never.sql': 'create table lesson.ccc (id int primary key);\n',
    });

    await expect(
      runMigrations({ databaseUrl: db.url, sqlDir: dir, log: silentLog() }),
    ).rejects.toMatchObject({
      code: 'APPLY_FAILED',
      message: expect.stringContaining('0002_bad.sql'),
    });

    const state = await queryUrl(
      db.url,
      `select to_regclass('lesson.aaa') as aaa,
              to_regclass('lesson.bbb') as bbb,
              to_regclass('lesson.ccc') as ccc`,
    );
    expect(state.rows[0]).toEqual({ aaa: 'lesson.aaa', bbb: null, ccc: null });
    const rows = await queryUrl(
      db.url,
      'select filename from lesson.schema_migrations order by filename',
    );
    expect(rows.rows.map(r => r.filename)).toEqual(['0001_ok.sql']);
  });
});

describe('migrate.mjs CLI', () => {
  it('exits 1 with the refusal message when baselining an empty database', async () => {
    const db = await createScratchDb();
    const proc = spawnSync(process.execPath, [migrateCli, '--baseline', '0042'], {
      env: { ...process.env, DATABASE_URL: db.url },
      encoding: 'utf8',
    });
    expect(proc.status).toBe(1);
    expect(proc.stderr).toContain('refusing to baseline an empty database');
  });

  it('exits 0 on --dry-run against an empty database and reports pending files', async () => {
    const db = await createScratchDb();
    const proc = spawnSync(process.execPath, [migrateCli, '--dry-run'], {
      env: { ...process.env, DATABASE_URL: db.url },
      cwd: backendRoot,
      encoding: 'utf8',
    });
    expect(proc.status).toBe(0);
    expect(proc.stdout).toContain('dry-run:');
    expect(proc.stdout).toContain('pending');
    // Dry-run created nothing.
    const state = await queryUrl(db.url, "select to_regclass('lesson.schema_migrations') as t");
    expect(state.rows[0].t).toBeNull();
  });

  it('exits 1 on an unknown flag', async () => {
    const proc = spawnSync(process.execPath, [migrateCli, '--frobnicate'], {
      env: { ...process.env, DATABASE_URL: 'postgresql://test:test@localhost:5433/postgres' },
      encoding: 'utf8',
    });
    expect(proc.status).toBe(1);
    expect(proc.stderr).toContain('unknown argument');
  });
});
