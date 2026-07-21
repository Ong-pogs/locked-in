// Lock-in coverage for the two content-correction migrations that were, until
// now, verified only by hand against a throwaway DB:
//   0057_fix_false_content_claims.sql       — Kamino-only (no Marginfi
//                                              "diversification"); funds are not
//                                              "safe and accessible" from a
//                                              third-party app.
//   0058_fix_principal_guarantee_content.sql — principal is NOT "always
//                                              returned".
//
// The false claims are seeded by 0024/0025/0051 and therefore reappear in ANY
// database rebuilt by replaying the migration chain. This test replays the FULL
// real backend/sql chain (0001..latest) into a throwaway Postgres — exactly
// what a reseed does — and asserts the corrected-away phrases are gone from the
// table the API actually serves (lesson.published_lessons; content/repository
// listModuleLessons reads it), that the repaired graded quiz keys still match
// their own options, and that each migration's own self-verification passed
// (lesson.content_fix_reports, unresolved_count = 0). If a future reseed drops
// 0057/0058 or reintroduces the copy, this fails.
//
// It replays into a per-test scratch database (like tests/unit/scripts/
// migrate.test.mjs) rather than reading the shared lockedin_test, because the
// shared DB is brownfield-baselined (globalSetup baselines a populated-but-
// trackerless DB to the highest file), so 0057/0058 may be recorded as applied
// there without their DO blocks ever having executed — which would make the
// content_fix_reports assertion vacuous. A fresh replay is the only thing that
// proves the migrations themselves do the correction. It lives under the api
// project so the api globalSetup has guaranteed the :5433 Postgres is up and
// lockedin_test exists to create scratch databases against.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { runMigrations } from '../../../scripts/migrate.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const backendRoot = join(__dirname, '..', '..', '..');
const realSqlDir = join(backendRoot, 'sql');

const ADMIN_DB_URL = 'postgresql://test:test@localhost:5433/lockedin_test';

const scratchDbs = [];

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
  const name = `content_fix_test_${randomBytes(6).toString('hex')}`;
  await queryUrl(ADMIN_DB_URL, `create database ${name}`);
  scratchDbs.push(name);
  return `postgresql://test:test@localhost:5433/${name}`;
}

function silentLog() {
  return { info() {}, warn() {}, error() {} };
}

async function countInPublishedLessons(url, needle) {
  const result = await queryUrl(
    url,
    'select count(*)::int as n from lesson.published_lessons where position($1 in payload::text) > 0',
    [needle],
  );
  return result.rows[0].n;
}

afterAll(async () => {
  for (const name of scratchDbs) {
    await queryUrl(ADMIN_DB_URL, `drop database if exists ${name} with (force)`);
  }
});

describe('content-fix migrations 0057 + 0058 (full-chain replay)', () => {
  let url;

  // One replay of the whole chain feeds every assertion below.
  beforeAll(async () => {
    url = await createScratchDb();
    const result = await runMigrations({ databaseUrl: url, log: silentLog() });
    // The migrations under test must actually be part of the chain that ran.
    expect(result.applied.some((f) => f.startsWith('0057'))).toBe(true);
    expect(result.applied.some((f) => f.startsWith('0058'))).toBe(true);
  }, 180_000);

  it('serves a real, populated catalog (guards against a vacuous pass)', async () => {
    const rows = await queryUrl(url, 'select count(*)::int as n from lesson.published_lessons');
    expect(rows.rows[0].n).toBeGreaterThan(0);
  });

  it('has purged the Marginfi "diversification" claims from published lessons', async () => {
    // The false "why two protocols" framing, in prose and in the old graded
    // prompt. Note "Kamino and Marginfi" itself is NOT asserted absent — it
    // survives intentionally as a *wrong* answer option after the fix.
    expect(await countInPublishedLessons(url, 'Why Use Two Protocols? Diversification')).toBe(0);
    expect(
      await countInPublishedLessons(url, 'split your USDC across multiple DeFi protocols'),
    ).toBe(0);
    // And the corrected Kamino-only copy is present — proving the fix ran and
    // this is post-fix content, not a database that never had the claim.
    expect(
      await countInPublishedLessons(url, 'the program rejects any other lending protocol'),
    ).toBeGreaterThan(0);
  });

  it('has removed the "safe and accessible from another interface" custody claim', async () => {
    expect(await countInPublishedLessons(url, 'safe and accessible')).toBe(0);
  });

  it('has removed the "principal is always returned" guarantee', async () => {
    expect(await countInPublishedLessons(url, 'principal is always returned')).toBe(0);
    // 0058's backstop sweep also forbids any other "always returned" wording.
    expect(await countInPublishedLessons(url, 'always returned')).toBe(0);
    // Corrected copy present.
    expect(
      await countInPublishedLessons(url, 'never taken as a penalty, though not guaranteed'),
    ).toBeGreaterThan(0);
  });

  it('keeps every repaired graded key in lockstep with its own options and payload', async () => {
    // Grading is a normalized text match, so a key that drifts from its
    // on-screen option marks the right answer wrong (the 0054 bug). Each key
    // must appear (a) as one of its question's options and (b) in the payload
    // the API serves.
    for (const questionId of ['bw-4-q1', 'df-4-q1', 'bw-5-q1']) {
      const keyRow = await queryUrl(
        url,
        'select correct_answer from lesson.questions where id = $1',
        [questionId],
      );
      expect(keyRow.rows, `question ${questionId} must exist`).toHaveLength(1);
      const key = keyRow.rows[0].correct_answer;
      expect(key, `${questionId} must have a correct_answer`).toBeTruthy();

      const optionMatch = await queryUrl(
        url,
        'select count(*)::int as n from lesson.question_options where question_id = $1 and option_text = $2',
        [questionId, key],
      );
      expect(optionMatch.rows[0].n, `${questionId} key must match one of its options`).toBe(1);

      expect(
        await countInPublishedLessons(url, key),
        `${questionId} key must appear in the served payload`,
      ).toBeGreaterThan(0);
    }
  });

  it('records both migrations as ran clean (unresolved_count = 0)', async () => {
    // Each migration inserts exactly one report row per run; unresolved_count
    // > 0 means a required pattern matched nothing, a no-op, an uncovered
    // "always returned" wording, or a key/payload mismatch — i.e. false content
    // may still be live. On a fresh replay it must be zero.
    const reports = await queryUrl(
      url,
      `select migration, unresolved_count
         from lesson.content_fix_reports
        where migration in ('0057_fix_false_content_claims', '0058_fix_principal_guarantee_content')
        order by migration`,
    );
    expect(reports.rows).toEqual([
      { migration: '0057_fix_false_content_claims', unresolved_count: 0 },
      { migration: '0058_fix_principal_guarantee_content', unresolved_count: 0 },
    ]);
  });
});
