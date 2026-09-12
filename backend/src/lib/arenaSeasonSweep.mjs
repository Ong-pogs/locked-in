// Arena stake-season cron: open, close, settle.
//
// Mirrors lib/arenaSweep.mjs — advisory-locked so two crons cannot run it at
// once, idempotent so a retry or a duplicate run is a no-op.
//
// WHY EACH ENTRY GETS ITS OWN TRANSACTION
//
// Settling one entry needs a fresh on-chain read (readLockV2AccountFresh), and
// this backend runs in us-east against a Supabase instance in ap-southeast-1 —
// roughly 230ms per round trip. One long transaction across every entry would
// hold locks for the whole run and lose all of it to a single RPC hiccup. Per
// entry, a failure leaves settled entries settled and retries only PENDING.
import { getPool } from './db.mjs';
import { seasonOutcome } from './arenaSeason.mjs';
import { readLockV2AccountFresh } from './lockPosition.mjs';
import { ensureOpenSeason, computeStakedDelta } from '../modules/arena/seasonRepository.mjs';

// Distinct from the migration runner (727274001) and the match sweep (727274002).
export const ARENA_SEASON_LOCK_KEY = 727274003;

export async function runArenaSeasonSweep({ log = console } = {}) {
  const pool = getPool();
  if (!pool) {
    return { opened: 0, closed: 0, settled: 0, failed: 0, seasonsSettled: 0, skipped: 'no-database' };
  }

  const client = await pool.connect();
  try {
    const got = await client.query(
      'select pg_try_advisory_lock($1) as ok',
      [ARENA_SEASON_LOCK_KEY],
    );
    if (!got.rows[0].ok) {
      return { opened: 0, closed: 0, settled: 0, failed: 0, seasonsSettled: 0, skipped: 'lock-held' };
    }

    try {
      let settled = 0;
      let failed = 0;

      // 1. Close any season whose window has passed. CLOSED stops new opt-ins
      //    and new links while its entries are still being settled.
      const closing = await client.query(
        `update arena.seasons set status = 'CLOSED'
          where status = 'OPEN' and ends_at <= now()
        returning id`,
      );
      const closed = closing.rowCount;

      // 2. Settle every PENDING entry of every CLOSED season, one transaction
      //    each.
      const due = await client.query(
        // SETTLED as well as CLOSED: an opt-in can land on a season this sweep
        // has already marked SETTLED, and an entry nothing ever settles would
        // sit PENDING forever, holding a stake that can never resolve.
        `select e.stake_season_id as "stakeSeasonId", e.wallet_address as "walletAddress",
                e.course_id as "courseId", e.lock_address as "lockAddress",
                e.lock_start_ts as "lockStartTs"
           from arena.season_entries e
           join arena.seasons s on s.id = e.stake_season_id
          where s.status in ('CLOSED', 'SETTLED') and e.outcome = 'PENDING'
          order by e.stake_season_id, e.wallet_address
          limit 1000`,
      );

      for (const entry of due.rows) {
        try {
          const { stakedDelta } = await computeStakedDelta(
            client, entry.stakeSeasonId, entry.walletAddress,
          );

          // Fresh chain read. If this throws we do NOT guess — the catch below
          // leaves the entry PENDING for the next run.
          const lock = await readLockV2AccountFresh(entry.walletAddress, entry.courseId);

          // A mismatch means the account did not look like this wallet's lock
          // at all — an unreadable answer, not "the lock is gone". Settling it
          // as VOID would make a config skew silently forgive every penalty in
          // the season, so it is thrown back to the retry path instead.
          if (lock?.mismatch) {
            throw new Error(`lock read mismatch: ${lock.reason ?? 'unknown'}`);
          }

          // lock_address is the same PDA across relocks, so the position is
          // identified by when it started. A lock that was closed and reopened
          // is a different position and voids the stake rather than inheriting
          // its consequence.
          const lockLive = Boolean(
            lock && lock.status === 'ACTIVE'
            && lock.lockAddress === entry.lockAddress
            && Number(lock.lockStartTs) === Number(entry.lockStartTs),
          );

          const outcome = seasonOutcome({ stakedDelta, lockLive });

          await client.query('begin');
          const rating = await client.query(
            `select rating from arena.ratings where wallet_address = $1 and season = 1`,
            [entry.walletAddress],
          );
          const updated = await client.query(
            `update arena.season_entries
                set outcome = $4, staked_delta = $5, rating_at_end = $6,
                    voided_reason = $7, settled_at = now()
              where stake_season_id = $1 and wallet_address = $2 and course_id = $3
                and outcome = 'PENDING'`,
            [
              entry.stakeSeasonId, entry.walletAddress, entry.courseId,
              outcome, stakedDelta, rating.rows[0]?.rating ?? null,
              outcome === 'VOID' ? 'LOCK_NOT_ACTIVE' : null,
            ],
          );
          await client.query('commit');
          // Only count a row this run actually moved. The `outcome = 'PENDING'`
          // guard is what makes settlement exactly-once, so a zero here means
          // it was already settled — counting it anyway would make the cron's
          // own log the least trustworthy account of what happened.
          if (updated.rowCount > 0) settled += 1;
        } catch (err) {
          try { await client.query('rollback'); } catch { /* connection gone */ }
          failed += 1;
          // Fails CLOSED. The entry stays PENDING and is retried on the next
          // run; it is never resolved by guessing.
          log.error?.(
            `[arena-season] entry ${entry.walletAddress}/${entry.courseId} failed: ${err?.message ?? err}`,
          );
        }
      }

      // 3. A CLOSED season with nothing left PENDING is SETTLED.
      const done = await client.query(
        `update arena.seasons s set status = 'SETTLED'
          where s.status = 'CLOSED'
            and not exists (
              select 1 from arena.season_entries e
               where e.stake_season_id = s.id and e.outcome = 'PENDING')
        returning id`,
      );

      // 4. Open the next one so players are never between seasons.
      //
      // No explicit transaction: the insert is atomic on its own, and
      // ensureOpenSeason recovers from a lost race by re-reading — which it
      // could not do inside a transaction the failed insert had aborted.
      // Non-fatal either way: every entry above is already committed, and
      // failing to open tomorrow's season must not discard today's settlement.
      let opened = 0;
      try {
        const before = await client.query(
          `select count(*)::int as n from arena.seasons where status = 'OPEN'`,
        );
        await ensureOpenSeason(client);
        opened = before.rows[0].n === 0 ? 1 : 0;
      } catch (err) {
        log.error?.(`[arena-season] could not open the next season: ${err?.message ?? err}`);
      }

      return { opened, closed, settled, failed, seasonsSettled: done.rowCount };
    } finally {
      await client.query('select pg_advisory_unlock($1)', [ARENA_SEASON_LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}
