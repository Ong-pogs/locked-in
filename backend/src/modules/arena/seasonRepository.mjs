// Stake-season data access.
//
// ISOLATION CONTRACT: this module writes arena.* only. The yield tier it
// decides is written to arena.season_entries.outcome; the voucher signer in
// progress/repository.mjs READS it from there. Nothing here writes lesson.*.
// The two reads of lesson.* below are eligibility checks, not writes.
import { query } from '../../lib/db.mjs';
import { badRequest, conflict } from '../../lib/errors.mjs';
import { appConfig } from '../../config.mjs';
import { readLockV2AccountFresh } from '../../lib/lockPosition.mjs';
import { ARENA_START_RATING } from '../../lib/arenaRating.mjs';
import { shouldCountMatch } from '../../lib/arenaSeason.mjs';

const ENTRY_COLUMNS = `
  stake_season_id as "stakeSeasonId", wallet_address as "walletAddress",
  course_id as "courseId", lock_address as "lockAddress",
  opted_in_at as "optedInAt", rating_at_start as "ratingAtStart", outcome
`;

export async function getOpenSeason() {
  const r = await query(
    `select id, starts_at as "startsAt", ends_at as "endsAt", status
       from arena.seasons where status = 'OPEN' limit 1`,
  );
  return r.rows[0] ?? null;
}

/**
 * Open a season if none is open. Caller owns the transaction.
 *
 * Starts on a UTC day boundary so the cron, which runs after 00:30 UTC, always
 * sees a season that has fully closed rather than one ending mid-run.
 */
export async function ensureOpenSeason(client) {
  const readOpen = async () => {
    const r = await client.query(
      `select id, starts_at as "startsAt", ends_at as "endsAt", status
         from arena.seasons where status = 'OPEN' limit 1`,
    );
    return r.rows[0] ?? null;
  };

  const open = await readOpen();
  if (open) return open;

  try {
    const inserted = await client.query(
      `insert into arena.seasons (id, starts_at, ends_at, status)
       values (
         coalesce((select max(id) from arena.seasons), 0) + 1,
         date_trunc('day', now() at time zone 'utc'),
         date_trunc('day', now() at time zone 'utc')
           + ($1::int * interval '1 day') + interval '1 second',
         'OPEN'
       )
       returning id, starts_at as "startsAt", ends_at as "endsAt", status`,
      [appConfig.arenaSeasonDays],
    );
    return inserted.rows[0];
  } catch (err) {
    // 23505: someone else opened a season (or claimed this id) between the read
    // and the insert. arena_seasons_single_open_idx is what makes "exactly one
    // OPEN season" true, so losing this race is a correct outcome, not an
    // error — re-read and use theirs. Opening a season must never be the thing
    // that fails a settlement run.
    if (err?.code !== '23505') throw err;
    return readOpen();
  }
}

async function readEntry(stakeSeasonId, walletAddress, courseId) {
  const r = await query(
    `select ${ENTRY_COLUMNS} from arena.season_entries
      where stake_season_id = $1 and wallet_address = $2 and course_id = $3`,
    [stakeSeasonId, walletAddress, courseId],
  );
  return r.rows[0] ?? null;
}

/**
 * Stake one course lock on the open season.
 *
 * BINDING HAPPENS HERE, not after N matches. A threshold is under the losing
 * player's control — current rating is readable any time from GET /v1/arena/me,
 * so "play three then it counts" means play two, check, and stop if behind.
 * Binding at opt-in makes the commitment real; a player who then plays nothing
 * has a zero staked delta and forfeits nothing, so opting in stays safe.
 */
export async function optIntoSeason(walletAddress, courseId, consentVersion) {
  const season = await getOpenSeason();
  if (!season) {
    throw badRequest('No arena season is open right now', 'ARENA_SEASON_CLOSED');
  }

  const existing = await readEntry(season.id, walletAddress, courseId);
  if (existing) return { season, entry: existing, created: false };

  // A course that is already complete, or already has a signed voucher, cannot
  // be staked: its tier is frozen and a penalty could never reach it. Refusing
  // is the honest answer — silently accepting a stake that can never be
  // collected would be worse than saying no.
  const settled = await query(
    `select 1
       from lesson.user_course_runtime_state r
       left join lesson.completion_vouchers v
         on v.wallet_address = r.wallet_address and v.course_id = r.course_id
      where r.wallet_address = $1 and r.course_id = $2
        and (r.course_completed_at is not null or v.signature is not null)
      limit 1`,
    [walletAddress, courseId],
  );
  if (settled.rowCount > 0) {
    throw conflict(
      'That course is already finished — its yield tier is locked in and cannot be staked',
      'ARENA_STAKE_COURSE_SETTLED',
    );
  }

  // Eligibility is read from the CHAIN, not the database. Uncached and
  // fail-closed: if we cannot prove a live lock, there is no stake.
  const lock = await readLockV2AccountFresh(walletAddress, courseId);
  if (!lock || lock.mismatch || lock.status !== 'ACTIVE' || !(BigInt(lock.principal ?? 0n) > 0n)) {
    throw badRequest(
      'You need an active lock on that course to stake it',
      'ARENA_STAKE_NO_LOCK',
    );
  }

  const rating = await query(
    `select rating from arena.ratings where wallet_address = $1 and season = 1`,
    [walletAddress],
  );

  const inserted = await query(
    `insert into arena.season_entries
       (stake_season_id, wallet_address, course_id, lock_address,
        consent_version, rating_at_start, outcome)
     values ($1, $2, $3, $4, $5, $6, 'PENDING')
     on conflict (stake_season_id, wallet_address, course_id) do nothing
     returning ${ENTRY_COLUMNS}`,
    [
      season.id, walletAddress, courseId, lock.lockAddress,
      consentVersion, rating.rows[0]?.rating ?? ARENA_START_RATING,
    ],
  );

  // A concurrent duplicate lost the race; re-read rather than error.
  if (inserted.rowCount === 0) {
    return { season, entry: await readEntry(season.id, walletAddress, courseId), created: false };
  }
  return { season, entry: inserted.rows[0], created: true };
}

/**
 * Sum of this wallet's rating deltas over COUNTED linked matches.
 *
 * `runner` is anything with a .query(text, params) — a pool client inside the
 * cron's transaction, or the module-level pool helper for a read.
 */
export async function computeStakedDelta(runner, stakeSeasonId, walletAddress) {
  const r = await runner.query(
    `select coalesce(sum(e.delta), 0)::int as "stakedDelta",
            count(*)::int as "matchesCounted"
       from arena.season_match_links l
       join arena.rating_events e
         on e.match_id = l.match_id and e.wallet_address = l.wallet_address
      where l.stake_season_id = $1 and l.wallet_address = $2 and l.counted`,
    [stakeSeasonId, walletAddress],
  );
  return { stakedDelta: r.rows[0].stakedDelta, matchesCounted: r.rows[0].matchesCounted };
}

/**
 * Link a settled match to the open season for its players.
 * Caller owns the transaction — this runs inside maybeSettleMatch's.
 *
 * Only matches where BOTH players hold a PENDING entry are linked. A staked
 * player beating an unstaked one moves the ladder but not the season:
 * otherwise the cheapest way to win a season is to farm people who have
 * nothing at risk.
 */
export async function linkMatchForSeason(client, matchId, wallets) {
  const season = await client.query(
    `select id from arena.seasons where status = 'OPEN' limit 1`,
  );
  if (season.rowCount === 0) return;
  const stakeSeasonId = season.rows[0].id;

  const entries = await client.query(
    `select distinct wallet_address from arena.season_entries
      where stake_season_id = $1 and wallet_address = any($2::text[])
        and outcome = 'PENDING'`,
    [stakeSeasonId, wallets],
  );
  if (entries.rowCount < 2) return;

  // How many times this pair has already COUNTED against each other this
  // season. The third meeting onwards is recorded but contributes nothing.
  const prior = await client.query(
    `select count(*)::int as n
       from arena.season_match_links l
       join arena.matches m on m.id = l.match_id
      where l.stake_season_id = $1 and l.counted and l.wallet_address = $2
        and (m.creator = $3 or m.opponent = $3)`,
    [stakeSeasonId, wallets[0], wallets[1]],
  );
  const counted = shouldCountMatch(prior.rows[0].n);

  for (const wallet of wallets) {
    await client.query(
      `insert into arena.season_match_links
         (stake_season_id, match_id, wallet_address, counted)
       values ($1, $2, $3, $4)
       on conflict (stake_season_id, match_id, wallet_address) do nothing`,
      [stakeSeasonId, matchId, wallet, counted],
    );
  }
}

/** What the UI shows a staked player: the season, their entry, live delta. */
export async function getMyStake(walletAddress) {
  const r = await query(
    `select e.stake_season_id as "stakeSeasonId", e.course_id as "courseId",
            e.lock_address as "lockAddress", e.opted_in_at as "optedInAt",
            e.rating_at_start as "ratingAtStart", e.rating_at_end as "ratingAtEnd",
            e.staked_delta as "settledDelta", e.outcome,
            e.voided_reason as "voidedReason", e.settled_at as "settledAt",
            s.starts_at as "startsAt", s.ends_at as "endsAt", s.status as "seasonStatus"
       from arena.season_entries e
       join arena.seasons s on s.id = e.stake_season_id
      where e.wallet_address = $1
      order by e.stake_season_id desc
      limit 1`,
    [walletAddress],
  );
  const entry = r.rows[0];
  if (!entry) return null;

  // A settled entry reports the delta it was settled on, so the number the
  // player sees is the one the outcome was actually decided by.
  if (entry.outcome !== 'PENDING') {
    return { ...entry, stakedDelta: entry.settledDelta ?? 0, matchesCounted: 0 };
  }
  const live = await computeStakedDelta({ query }, entry.stakeSeasonId, walletAddress);
  return { ...entry, ...live };
}
