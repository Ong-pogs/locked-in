#!/usr/bin/env node
// Mainnet cutover reset — purge devnet-era per-user state, preserve all content.
//
// This is NOT a migration and MUST NOT be placed in backend/sql. Migrations run
// unattended via `npm run migrate` on every deploy; this DELETES user rows and
// may only ever run under a human with a typed confirmation.
//
// WHY THIS EXISTS
// ---------------
// Mainnet reuses the devnet-prod Postgres. Completion vouchers are derived
// PURELY from DB rows — issueCourseCompletionVoucher (src/modules/progress/
// repository.mjs) reads user_course_runtime_state.course_completed_at and
// .lapse_count and never asks the chain which cluster that progress was earned
// on. Carrying devnet rows into mainnet therefore means:
//   (a) every wallet that finished a course on devnet is permanently
//       COURSE_COMPLETED / not lockable and can never deposit on it again —
//       and only 3 courses have real content;
//   (b) devnet lapse_count is embedded in the signed voucher and directly cuts
//       a real user's real payout;
//   (c) sol_drips.wallet_address is UNIQUE with no round column, so a
//       devnet-dripped wallet can never receive the mainnet drip and lands
//       with 0 SOL and no way to pay fees;
//   (d) devnet XP/streaks become the mainnet leaderboard.
//
// Usage:
//   node scripts/mainnet-cutover-reset.mjs                      DRY RUN (default)
//   node scripts/mainnet-cutover-reset.mjs --execute \
//        --confirm-target <host>/<database> \
//        --confirm "PURGE DEVNET USER STATE"
//
// Mirrors scripts/migrate.mjs (R17): its OWN pg.Client with the same
// local-vs-remote ssl heuristic as src/lib/db.mjs, no statement_timeout, and it
// never imports the app pool.

import process from 'node:process';
import { pathToFileURL } from 'node:url';
import pg from 'pg';

// Typed by the operator, verbatim, to mutate. Deliberately not a flag value
// that shell history or a runbook copy-paste can supply by accident.
export const CONFIRMATION_PHRASE = 'PURGE DEVNET USER STATE';

// Per-user / per-cluster state, ordered children-before-parents so the counts
// are attributable per table rather than absorbed by ON DELETE CASCADE.
export const PURGE_TABLES = [
  // Attempt tree (all FK -> user_lesson_attempts ON DELETE CASCADE).
  'lesson.answer_validation_decisions',
  'lesson.user_question_checks',
  'lesson.user_question_attempts',
  'lesson.user_lesson_attempts',
  'lesson.user_lesson_progress',
  // The voucher inputs — (a) and (b) above live in these two tables.
  'lesson.completion_vouchers',
  'lesson.user_course_runtime_state',
  'lesson.user_course_enrollments',
  // Devnet claim telemetry, keyed to locks on the wrong cluster.
  'lesson.claim_attempts',
  // Leaderboard identity (d).
  'lesson.user_xp_events',
  'lesson.user_xp',
  // Devnet on-chain receipts: every signature/lock address in here belongs to
  // a program on the wrong cluster.
  'lesson.verified_completion_events',
  'lesson.miss_consequence_receipts',
  'lesson.harvest_result_receipts',
  'lesson.unlock_receipts',
  'lesson.fuel_burn_cycle_receipts',
  'lesson.fuel_conversion_receipts',
  // Faucet + drip (c). Purging clears the UNIQUE(wallet_address) that would
  // otherwise permanently bar a returning wallet from the mainnet drip.
  'lesson.faucet_claims',
  'lesson.sol_drips',
  // Leaderboard snapshots (rows FK -> snapshots ON DELETE CASCADE).
  'lesson.leaderboard_snapshot_rows',
  'lesson.leaderboard_snapshots',
  // Community-pot accounting, all denominated in devnet USDC.
  'lesson.community_pot_distribution_snapshots',
  'lesson.pot_cycle_runs',
  'lesson.v2_pot_settle_events',
  // Chain cursors: these hold devnet signatures/slots. Left in place, the
  // indexer and pot bridge resume from a signature that does not exist on
  // mainnet.
  'lesson.v2_pot_scan_state',
  'lesson.unlock_indexer_state',
  // Sessions minted against the devnet JWT secret.
  'lesson_auth.refresh_sessions',
  'lesson_auth.wallet_challenges',
];

// Content + authoring. Counted before AND after the deletes inside the same
// transaction; any drift aborts. This is the mechanical proof that a bad
// PURGE_TABLES edit cannot quietly eat the catalog.
export const PRESERVE_TABLES = [
  'lesson.courses',
  'lesson.modules',
  'lesson.course_modules',
  'lesson.lessons',
  'lesson.module_lessons',
  'lesson.lesson_versions',
  'lesson.lesson_blocks',
  'lesson.questions',
  'lesson.question_options',
  'lesson.publish_releases',
  'lesson.published_modules',
  'lesson.published_lessons',
  'lesson.published_lesson_payloads',
  'lesson.source_attributions',
  'lesson.content_review_tasks',
  'lesson.ingestion_sources',
  'lesson.ingestion_jobs',
  'lesson.ingestion_job_items',
  'lesson.schema_migrations',
];

// User-scoped but NOT purged, because deleting them destroys something the
// purge cannot recreate. Reported at every run so the decision stays explicit
// rather than implicit-by-omission.
export const REVIEW_TABLES = [
  {
    table: 'lesson.user_consents',
    reason:
      'legal record that a wallet accepted a terms version. Purging destroys the ' +
      'consent audit trail; KEEPING it means a wallet that consented on devnet is ' +
      'never re-prompted before risking real money. Decide per your terms — if ' +
      'mainnet ships a new terms_version, the existing rows do not satisfy it and ' +
      'no purge is needed.',
  },
];

// A cutover against a database with no catalog is a wrong-DATABASE_URL typo,
// not a cutover. Refuse rather than "successfully" purge a stranger's rows.
const REQUIRED_NON_EMPTY = ['lesson.courses', 'lesson.published_lessons'];

export class CutoverError extends Error {
  constructor(message, code, options) {
    super(message, options);
    this.name = 'CutoverError';
    this.code = code;
  }
}

/**
 * host/database for the confirmation double-entry, without ever surfacing the
 * password. Falls back to the raw string when DATABASE_URL is not a parseable
 * URL (libpq key=value form) so the operator still gets an exact token to echo.
 */
export function describeTarget(databaseUrl) {
  try {
    const url = new URL(databaseUrl);
    const database = decodeURIComponent(url.pathname.replace(/^\//, '')) || '(default)';
    return { host: url.host, database, token: `${url.host}/${database}` };
  } catch {
    return { host: '(unparseable)', database: '(unparseable)', token: databaseUrl };
  }
}

async function regclassExists(client, qualifiedName) {
  const result = await client.query('select to_regclass($1) as oid', [qualifiedName]);
  return result.rows[0].oid != null;
}

async function countRows(client, qualifiedName) {
  const result = await client.query(`select count(*)::bigint as n from ${qualifiedName}`);
  return Number(result.rows[0].n);
}

/**
 * Purge per-user devnet state. Dry run unless `execute` is true, in which case
 * `confirmTarget` must equal the target's host/database and `confirm` must be
 * CONFIRMATION_PHRASE verbatim.
 *
 * Returns { dryRun, target, purged, preserved, totalPurged, skipped }.
 */
export async function runCutoverReset({
  databaseUrl = process.env.DATABASE_URL,
  execute = false,
  confirmTarget = null,
  confirm = null,
  log = console,
} = {}) {
  if (!databaseUrl) {
    throw new CutoverError(
      'DATABASE_URL is not configured — refusing to run (set the env var or pass databaseUrl)',
      'NO_DATABASE_URL',
    );
  }

  const target = describeTarget(databaseUrl);

  if (execute) {
    if (confirmTarget !== target.token) {
      throw new CutoverError(
        `--confirm-target does not match the database in DATABASE_URL.\n` +
          `  expected: ${target.token}\n` +
          `  received: ${confirmTarget ?? '(nothing)'}`,
        'TARGET_MISMATCH',
      );
    }
    if (confirm !== CONFIRMATION_PHRASE) {
      throw new CutoverError(
        `--confirm must be exactly "${CONFIRMATION_PHRASE}" (received: ${confirm ?? '(nothing)'})`,
        'NOT_CONFIRMED',
      );
    }
  }

  const isLocalDb = /@(?:localhost|127\.0\.0\.1|\[::1\])(?::|\/)/i.test(databaseUrl);
  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: isLocalDb ? false : { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    log.info('[cutover] ---------------------------------------------');
    log.info(`[cutover] target host     : ${target.host}`);
    log.info(`[cutover] target database : ${target.database}`);
    log.info(`[cutover] mode            : ${execute ? 'EXECUTE (destructive)' : 'DRY RUN'}`);
    log.info('[cutover] ---------------------------------------------');

    await client.query('begin');

    // user_* and completion_vouchers carry FORCE ROW LEVEL SECURITY with a
    // policy keyed on request.jwt.claim.wallet_address. Unset, that setting is
    // NULL, so `NULL = wallet_address` is NULL — every row is invisible and a
    // DELETE silently removes ZERO rows while reporting success. That is the
    // one failure mode that would let an operator believe the cutover ran while
    // every devnet completion freeze survived into mainnet. row_security=off
    // makes Postgres ERROR instead if this role cannot bypass RLS: loud beats
    // silent for a step whose whole job is to not be skipped.
    await client.query('set local row_security = off');

    const missingContent = [];
    for (const table of REQUIRED_NON_EMPTY) {
      if (!(await regclassExists(client, table))) {
        missingContent.push(`${table} (absent)`);
        continue;
      }
      if ((await countRows(client, table)) === 0) missingContent.push(`${table} (empty)`);
    }
    if (missingContent.length > 0) {
      throw new CutoverError(
        `refusing to purge: this database has no content catalog — ${missingContent.join(', ')}. ` +
          'Check DATABASE_URL and that migrations have run.',
        'NO_CONTENT_CATALOG',
      );
    }

    const preservedBefore = new Map();
    for (const table of PRESERVE_TABLES) {
      if (await regclassExists(client, table)) {
        preservedBefore.set(table, await countRows(client, table));
      }
    }

    const purged = [];
    const skipped = [];
    for (const table of PURGE_TABLES) {
      if (!(await regclassExists(client, table))) {
        skipped.push(table);
        continue;
      }
      const before = await countRows(client, table);
      if (execute) {
        const result = await client.query(`delete from ${table}`);
        purged.push({ table, rows: result.rowCount });
      } else {
        purged.push({ table, rows: before });
      }
    }

    const review = [];
    for (const entry of REVIEW_TABLES) {
      if (await regclassExists(client, entry.table)) {
        review.push({ ...entry, rows: await countRows(client, entry.table) });
      }
    }

    // Content must be byte-identical across the deletes. A cascade or a
    // mistaken PURGE_TABLES entry that touched the catalog rolls the whole
    // thing back here.
    const damaged = [];
    for (const [table, before] of preservedBefore) {
      const after = await countRows(client, table);
      if (after !== before) damaged.push(`${table}: ${before} -> ${after}`);
    }
    if (damaged.length > 0) {
      throw new CutoverError(
        `content tables changed during the purge — rolling back: ${damaged.join(', ')}`,
        'CONTENT_DAMAGED',
      );
    }

    if (execute) {
      await client.query('commit');
    } else {
      await client.query('rollback');
    }

    const totalPurged = purged.reduce((sum, entry) => sum + entry.rows, 0);
    const width = Math.max(...purged.map((entry) => entry.table.length));

    log.info(execute ? '[cutover] PURGED:' : '[cutover] would purge:');
    for (const entry of purged) {
      log.info(`[cutover]   ${entry.table.padEnd(width)}  ${String(entry.rows).padStart(8)}`);
    }
    for (const table of skipped) {
      log.info(`[cutover]   (absent, skipped) ${table}`);
    }
    log.info(`[cutover] total rows ${execute ? 'deleted' : 'to delete'}: ${totalPurged}`);
    log.info(`[cutover] content tables preserved intact: ${preservedBefore.size}`);

    for (const entry of review) {
      log.warn(
        `[cutover] NOT PURGED — decide manually: ${entry.table} (${entry.rows} rows) — ${entry.reason}`,
      );
    }

    if (execute) {
      log.info('[cutover] COMMITTED. Devnet user state is gone; catalog untouched.');
    } else {
      log.info('[cutover] DRY RUN — nothing was written (transaction rolled back).');
      log.info(
        `[cutover] to execute: node scripts/mainnet-cutover-reset.mjs --execute ` +
          `--confirm-target ${target.token} --confirm "${CONFIRMATION_PHRASE}"`,
      );
    }

    return {
      dryRun: !execute,
      target,
      purged,
      skipped,
      review,
      totalPurged,
      preserved: Object.fromEntries(preservedBefore),
    };
  } catch (error) {
    try {
      await client.query('rollback');
    } catch {
      // Connection state unknown — client.end() in finally closes it anyway.
    }
    if (/row-level security/i.test(error.message ?? '')) {
      throw new CutoverError(
        `this database role cannot bypass row-level security, so the purge would silently ` +
          `delete nothing. Re-run as the table owner with BYPASSRLS (or a superuser). ` +
          `Underlying error: ${error.message}`,
        'RLS_WOULD_HIDE_ROWS',
        { cause: error },
      );
    }
    throw error;
  } finally {
    await client.end();
  }
}

export function parseCliArgs(argv) {
  const options = { execute: false, confirmTarget: null, confirm: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--execute') {
      options.execute = true;
    } else if (arg === '--dry-run') {
      options.execute = false;
    } else if (arg === '--confirm-target' || arg === '--confirm') {
      const value = argv[i + 1];
      i += 1;
      if (!value) {
        throw new CutoverError(`${arg} requires a value`, 'BAD_ARGS');
      }
      if (arg === '--confirm-target') options.confirmTarget = value;
      else options.confirm = value;
    } else {
      throw new CutoverError(
        `unknown argument: ${arg} ` +
          '(supported: --execute, --dry-run, --confirm-target <host/db>, --confirm <phrase>)',
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
    await runCutoverReset(options);
  } catch (error) {
    console.error(`[cutover] ERROR: ${error.message}`);
    process.exit(1);
  }
}
