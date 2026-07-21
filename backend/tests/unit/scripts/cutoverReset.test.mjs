// Coverage for the mainnet cutover reset (scripts/mainnet-cutover-reset.mjs) —
// the hand-run, destructive DELETE step that purges devnet-era per-user state
// off the reused Postgres before mainnet. This exercises ONLY what is pure and
// DB-free: the confirmation-token gating (which runs BEFORE the script ever
// opens a connection) and the purge-vs-preserve table classification. The
// destructive DB path is deliberately out of scope here — a unit test must not
// be able to delete rows.
import { describe, it, expect } from 'vitest';
import {
  CONFIRMATION_PHRASE,
  PURGE_TABLES,
  PRESERVE_TABLES,
  REVIEW_TABLES,
  describeTarget,
  parseCliArgs,
  runCutoverReset,
  CutoverError,
} from '../../../scripts/mainnet-cutover-reset.mjs';

// A syntactically valid connection string whose host/db is known, so the
// gating can be checked without a reachable database. These tests never reach
// client.connect(): every assertion below throws inside runCutoverReset's
// confirmation block, which precedes `new pg.Client`.
const FAKE_URL = 'postgresql://u:secret@db.example.com:5432/mydb';
const FAKE_TARGET = 'db.example.com:5432/mydb';

describe('describeTarget', () => {
  it('extracts host/database/token from a URL without leaking the password', () => {
    const target = describeTarget(FAKE_URL);
    expect(target).toEqual({
      host: 'db.example.com:5432',
      database: 'mydb',
      token: FAKE_TARGET,
    });
    // The double-entry token is what the operator must echo; it must never
    // carry the credential.
    expect(target.token).not.toContain('secret');
  });

  it('falls back to the raw string for a non-URL (libpq key=value) DATABASE_URL', () => {
    const target = describeTarget('host=localhost dbname=foo');
    expect(target.host).toBe('(unparseable)');
    expect(target.token).toBe('host=localhost dbname=foo');
  });
});

describe('parseCliArgs', () => {
  it('defaults to a dry run', () => {
    expect(parseCliArgs([])).toEqual({ execute: false, confirmTarget: null, confirm: null });
  });

  it('collects --execute and the two confirmation values', () => {
    expect(parseCliArgs(['--execute', '--confirm-target', 'h/db', '--confirm', 'PHRASE'])).toEqual({
      execute: true,
      confirmTarget: 'h/db',
      confirm: 'PHRASE',
    });
  });

  it('--dry-run overrides a preceding --execute', () => {
    expect(parseCliArgs(['--execute', '--dry-run']).execute).toBe(false);
  });

  it('rejects a flag that is missing its value', () => {
    expect(() => parseCliArgs(['--confirm-target'])).toThrow(CutoverError);
    expect(() => parseCliArgs(['--confirm-target'])).toThrowError(/requires a value/);
  });

  it('rejects an unknown argument', () => {
    try {
      parseCliArgs(['--frobnicate']);
      throw new Error('expected parseCliArgs to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(CutoverError);
      expect(error.code).toBe('BAD_ARGS');
    }
  });
});

describe('runCutoverReset — confirmation gating (never touches the database)', () => {
  it('refuses when DATABASE_URL is absent', async () => {
    // Empty string, not undefined: the function defaults an `undefined` arg to
    // process.env.DATABASE_URL (which the test env sets), so `undefined` would
    // connect to the shared test DB. An empty string is the DB-free way to hit
    // the missing-URL guard.
    await expect(runCutoverReset({ databaseUrl: '' })).rejects.toMatchObject({
      code: 'NO_DATABASE_URL',
    });
  });

  it('refuses --execute when --confirm-target does not match the DATABASE_URL', async () => {
    await expect(
      runCutoverReset({
        databaseUrl: FAKE_URL,
        execute: true,
        confirmTarget: 'some-other-host/otherdb',
        confirm: CONFIRMATION_PHRASE,
      }),
    ).rejects.toMatchObject({ code: 'TARGET_MISMATCH' });
  });

  it('refuses --execute when the typed phrase is not exactly CONFIRMATION_PHRASE', async () => {
    await expect(
      runCutoverReset({
        databaseUrl: FAKE_URL,
        execute: true,
        confirmTarget: FAKE_TARGET,
        confirm: 'purge devnet user state', // wrong case
      }),
    ).rejects.toMatchObject({ code: 'NOT_CONFIRMED' });

    await expect(
      runCutoverReset({
        databaseUrl: FAKE_URL,
        execute: true,
        confirmTarget: FAKE_TARGET,
        confirm: null, // phrase omitted entirely
      }),
    ).rejects.toMatchObject({ code: 'NOT_CONFIRMED' });
  });

  it('pins the confirmation phrase so a runbook copy-paste cannot drift from it', () => {
    // If this literal ever changes, every operator runbook and this gate must
    // change together — that is the whole point of the double-entry.
    expect(CONFIRMATION_PHRASE).toBe('PURGE DEVNET USER STATE');
  });
});

describe('purge-vs-preserve classification', () => {
  const purge = new Set(PURGE_TABLES);
  const preserve = new Set(PRESERVE_TABLES);

  it('never lists a table in both PURGE and PRESERVE', () => {
    const overlap = PURGE_TABLES.filter((table) => preserve.has(table));
    expect(overlap).toEqual([]);
  });

  it('preserves the content catalog — courses, lessons, and every published_* table', () => {
    for (const table of [
      'lesson.courses',
      'lesson.lessons',
      'lesson.modules',
      'lesson.questions',
      'lesson.question_options',
      'lesson.published_modules',
      'lesson.published_lessons',
      'lesson.published_lesson_payloads',
    ]) {
      expect(preserve.has(table), `${table} must be preserved`).toBe(true);
      expect(purge.has(table), `${table} must NOT be purged`).toBe(false);
    }
    // Every published_* table the API serves from is on the preserve side.
    expect(PRESERVE_TABLES.filter((t) => t.startsWith('lesson.published_')).length).toBeGreaterThan(
      0,
    );
  });

  it('purges the per-user devnet state — the user_* / vouchers / attempt tree', () => {
    for (const table of [
      'lesson.user_lesson_attempts',
      'lesson.user_lesson_progress',
      'lesson.user_course_runtime_state',
      'lesson.user_course_enrollments',
      'lesson.user_xp',
      'lesson.user_xp_events',
      'lesson.completion_vouchers',
    ]) {
      expect(purge.has(table), `${table} must be purged`).toBe(true);
      expect(preserve.has(table), `${table} must NOT be preserved`).toBe(false);
    }
  });

  it('keeps every user_* table out of the preserve set (nothing user-scoped survives by omission)', () => {
    const leaked = PRESERVE_TABLES.filter((table) => /(^|\.)user_/.test(table));
    expect(leaked).toEqual([]);
  });

  it('carries user_consents in REVIEW, not PURGE — a manual decision, not a silent delete', () => {
    const reviewTables = REVIEW_TABLES.map((entry) => entry.table);
    expect(reviewTables).toContain('lesson.user_consents');
    expect(purge.has('lesson.user_consents')).toBe(false);
    expect(preserve.has('lesson.user_consents')).toBe(false);
  });
});
