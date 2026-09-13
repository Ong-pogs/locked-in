// Serializes the test files that fight over genuinely global database state.
//
// Vitest runs test FILES in parallel forks against one shared database. Most
// files coexist fine because they scope everything to their own random wallets.
// Two kinds of file cannot:
//
//   1. The stake-season files. Only one arena season may be OPEN at a time —
//      arena_seasons_single_open_idx enforces it, and both opt-in and match
//      linking resolve "the current season" by selecting where status = 'OPEN'.
//      That singleton is the production semantic, so it cannot be made
//      per-wallet the way the arena isolation test was.
//
//   2. voucherAutoIssue, which DROPS lesson.completion_vouchers to prove the
//      R11.7 "table absent" behaviour. While it is dropped, any other file that
//      reads or writes a voucher sees a table that does not exist.
//
//   3. The queue files. arena.queue is one shared table with no per-test
//      scoping available: enterQueue pairs you with whoever is waiting, so two
//      files queueing players will pair them ACROSS files and each will see a
//      match it did not create.
//
// A session-level Postgres advisory lock, held on a dedicated connection for
// the lifetime of the file, makes those files queue instead of collide.
//
// Distinct from the migration runner (727274001), the match sweep (727274002)
// and the season cron (727274003).
import pg from 'pg';

const SUITE_LOCK_KEY = 727274004;

export async function acquireSuiteLock() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  // Blocking, not try_: waiting is the whole point.
  await client.query('select pg_advisory_lock($1)', [SUITE_LOCK_KEY]);
  return client;
}

export async function releaseSuiteLock(client) {
  if (!client) return;
  try {
    await client.query('select pg_advisory_unlock($1)', [SUITE_LOCK_KEY]);
  } catch {
    // Connection already gone — the lock dies with the session anyway.
  }
  try { await client.end(); } catch { /* already closed */ }
}
