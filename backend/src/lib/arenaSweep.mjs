// Arena expiry sweep.
//
// Async matches need something to close out windows nobody finished. Mirrors
// lib/lapseSweep.mjs: advisory-locked so two crons cannot run it at once, and
// idempotent so a retry or a duplicate run is a no-op.
import { getPool } from './db.mjs';
import { maybeSettleMatch } from '../modules/arena/settle.mjs';

// Distinct from the migration runner's lock (727274001).
export const ARENA_SWEEP_LOCK_KEY = 727274002;

export async function runArenaSweep({ log = console } = {}) {
  const pool = getPool();
  if (!pool) return { expired: 0, settled: 0, skipped: 'no-database' };

  const client = await pool.connect();
  try {
    const got = await client.query('select pg_try_advisory_lock($1) as ok', [ARENA_SWEEP_LOCK_KEY]);
    if (!got.rows[0].ok) {
      return { expired: 0, settled: 0, skipped: 'lock-held' };
    }

    try {
      const due = await client.query(
        `select id from arena.matches
          where status in ('OPEN', 'ACTIVE') and expires_at < now()
          order by expires_at limit 500`,
      );

      let settled = 0;
      for (const { id } of due.rows) {
        try {
          await client.query('begin');

          // Anyone who never submitted has forfeited their attempt.
          await client.query(
            `update arena.match_players
                set forfeited = true
              where match_id = $1 and submitted_at is null`,
            [id],
          );

          const m = await client.query(
            `select opponent from arena.matches where id = $1`, [id]);

          if (!m.rows[0]?.opponent) {
            // A link challenge nobody ever claimed. Close it; the creator is
            // not penalised for an unanswered invite.
            await client.query(
              `update arena.matches set status = 'EXPIRED', resolved_at = now() where id = $1`,
              [id],
            );
          } else if (await maybeSettleMatch(client, id)) {
            settled += 1;
          }

          await client.query('commit');
        } catch (err) {
          try { await client.query('rollback'); } catch { /* connection gone */ }
          log.error?.(`[arena-sweep] match ${id} failed: ${err?.message ?? err}`);
        }
      }

      return { expired: due.rowCount, settled };
    } finally {
      await client.query('select pg_advisory_unlock($1)', [ARENA_SWEEP_LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}
