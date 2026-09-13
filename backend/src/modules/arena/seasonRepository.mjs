// Stake-season data access.
//
// ISOLATION CONTRACT: this module writes arena.* only. The yield tier it
// decides is written to arena.season_entries.outcome; the voucher signer in
// progress/repository.mjs READS it from there. Nothing here writes lesson.*.
// The two reads of lesson.* below are eligibility checks, not writes.
import { query } from '../../lib/db.mjs';
import { HttpError, badRequest, conflict } from '../../lib/errors.mjs';
import { appConfig } from '../../config.mjs';
import { readLockV2AccountFresh } from '../../lib/lockPosition.mjs';
import { ARENA_START_RATING } from '../../lib/arenaRating.mjs';
import { shouldCountMatch } from '../../lib/arenaSeason.mjs';

const ENTRY_COLUMNS = `
  stake_season_id as "stakeSeasonId", wallet_address as "walletAddress",
  course_id as "courseId", lock_address as "lockAddress",
  opted_in_at as "optedInAt", rating_at_start as "ratingAtStart",
  lock_start_ts as "lockStartTs", outcome
`;

// The live season: OPEN *and* inside its own window. The status flag is only
// as punctual as the daily cron, so a season whose ends_at has passed must stop
// accepting opt-ins and stop counting matches immediately rather than at 00:35.
const LIVE_SEASON = `
  select id, starts_at as "startsAt", ends_at as "endsAt", status
    from arena.seasons
   where status = 'OPEN' and starts_at <= now() and ends_at > now()
   limit 1`;

export async function getOpenSeason() {
  const r = await query(LIVE_SEASON);
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
 * Can this wallet stake this course RIGHT NOW?
 *
 * One function so the picker and the gate can never disagree. The dropdown
 * used to filter on the completion stamp alone, which is only a proxy: a
 * course in practice mode has no principal locked and no completion stamp, so
 * it was offered and then refused on submit.
 *
 * Returns a reason rather than throwing, so a listing can skip a course while
 * the opt-in path turns the same reason into the right status code.
 */
export async function courseStakeEligibility(walletAddress, courseId) {
  // A course that is already complete, or already has a signed voucher, cannot
  // be staked: its tier is frozen and a penalty could never reach it.
  //
  // Two separate reads, not one join. The completion freeze is the real gate;
  // the voucher row is belt-and-braces for the rare completer whose freeze
  // stamp never landed. lesson.completion_vouchers is allowed to be
  // unavailable — every other path that touches it degrades to a warning
  // rather than a 500 (voucher-autoissue ruling R11.7).
  const frozen = await query(
    `select 1 from lesson.user_course_runtime_state
      where wallet_address = $1 and course_id = $2 and course_completed_at is not null
      limit 1`,
    [walletAddress, courseId],
  );
  let vouchered = false;
  try {
    const v = await query(
      `select 1 from lesson.completion_vouchers
        where wallet_address = $1 and course_id = $2 and signature is not null
        limit 1`,
      [walletAddress, courseId],
    );
    vouchered = v.rowCount > 0;
  } catch {
    vouchered = false;
  }
  if (frozen.rowCount > 0 || vouchered) {
    return { eligible: false, reason: 'COURSE_SETTLED', lock: null };
  }

  // Eligibility is read from the CHAIN, not the database. Uncached and
  // fail-closed: if we cannot prove a live lock, there is no stake.
  //
  // A read that THROWS is not the same as a read that says "no lock": one is
  // our problem, the other is the user's.
  let lock;
  try {
    lock = await readLockV2AccountFresh(walletAddress, courseId);
  } catch {
    return { eligible: false, reason: 'CHAIN_UNAVAILABLE', lock: null };
  }
  if (!lock || lock.mismatch || lock.status !== 'ACTIVE' || !(BigInt(lock.principal ?? 0n) > 0n)) {
    return { eligible: false, reason: 'NO_LOCK', lock: null };
  }
  return { eligible: true, reason: null, lock };
}

function stakeEligibilityError(reason) {
  if (reason === 'COURSE_SETTLED') {
    return conflict(
      'That course is already finished — its yield tier is locked in and cannot be staked',
      'ARENA_STAKE_COURSE_SETTLED',
    );
  }
  if (reason === 'CHAIN_UNAVAILABLE') {
    return new HttpError(
      503,
      'Could not reach the chain to verify your lock. Try again in a moment.',
      'ARENA_STAKE_CHAIN_UNAVAILABLE',
    );
  }
  return badRequest('You need an active lock on that course to stake it', 'ARENA_STAKE_NO_LOCK');
}

/**
 * The courses this wallet could stake today — the picker's source of truth,
 * evaluated with the very same function the opt-in gate uses.
 */
export async function listStakeableCourses(walletAddress) {
  const enrolled = await query(
    `select course_id as "courseId" from lesson.user_course_enrollments
      where wallet_address = $1`,
    [walletAddress],
  );
  const checked = await Promise.all(enrolled.rows.map(async (r) => {
    const { eligible } = await courseStakeEligibility(walletAddress, r.courseId);
    return eligible ? r.courseId : null;
  }));
  return checked.filter(Boolean);
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

  // One staked course per wallet per season. The season's outcome is a single
  // summed delta for the wallet, so a second entry would take a tier off a
  // second lock for the same lost match — and the panel only ever names one.
  const other = await query(
    `select course_id as "courseId" from arena.season_entries
      where stake_season_id = $1 and wallet_address = $2 limit 1`,
    [season.id, walletAddress],
  );
  if (other.rowCount > 0) {
    throw conflict(
      `You already staked ${other.rows[0].courseId} this season — one course per season`,
      'ARENA_STAKE_ALREADY_STAKED',
    );
  }

  const { eligible, reason, lock } = await courseStakeEligibility(walletAddress, courseId);
  if (!eligible) throw stakeEligibilityError(reason);

  const rating = await query(
    `select rating from arena.ratings where wallet_address = $1 and season = 1`,
    [walletAddress],
  );

  // The insert is conditional on the season still being live, so a season that
  // closed between the read above and this write cannot take a stake nothing
  // will ever settle.
  const inserted = await query(
    `insert into arena.season_entries
       (stake_season_id, wallet_address, course_id, lock_address, lock_start_ts,
        consent_version, rating_at_start, outcome)
     select $1, $2, $3, $4, $5, $6, $7, 'PENDING'
      where exists (
        select 1 from arena.seasons
         where id = $1 and status = 'OPEN' and starts_at <= now() and ends_at > now())
     on conflict (stake_season_id, wallet_address, course_id) do nothing
     returning ${ENTRY_COLUMNS}`,
    [
      season.id, walletAddress, courseId, lock.lockAddress, Number(lock.lockStartTs) || 0,
      consentVersion, rating.rows[0]?.rating ?? ARENA_START_RATING,
    ],
  );

  if (inserted.rowCount === 0) {
    // Either a concurrent duplicate won the race, or the season closed under
    // us. Only the first has a row to return.
    const again = await readEntry(season.id, walletAddress, courseId);
    if (again) return { season, entry: again, created: false };
    throw badRequest('That arena season has closed', 'ARENA_SEASON_CLOSED');
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
    `select id from arena.seasons
      where status = 'OPEN' and starts_at <= now() and ends_at > now() limit 1`,
  );
  if (season.rowCount === 0) return;
  const stakeSeasonId = season.rows[0].id;

  // Both players must have been staked BEFORE this match was created. Without
  // the timestamp, a player could watch a match resolve and then opt in, having
  // already seen the result they were about to be judged on.
  const entries = await client.query(
    `select distinct e.wallet_address from arena.season_entries e
       join arena.matches m on m.id = $3
      where e.stake_season_id = $1 and e.wallet_address = any($2::text[])
        and e.outcome = 'PENDING' and e.opted_in_at <= m.created_at`,
    [stakeSeasonId, wallets, matchId],
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

/**
 * What the UI shows a staked player: the season, their entry, live delta.
 *
 * `lapseCount` rides along because the panel cannot honestly say "keeps half
 * its yield" without it — a player already carrying one lapse is at 50%, and a
 * forfeit takes them to nothing, not to half.
 *
 * `isCurrentSeason` is what lets the panel offer the next season's opt-in to
 * someone whose last stake has already settled, instead of showing them a
 * result forever.
 */
export async function getMyStake(walletAddress) {
  const r = await query(
    `select e.stake_season_id as "stakeSeasonId", e.course_id as "courseId",
            e.lock_address as "lockAddress", e.opted_in_at as "optedInAt",
            e.rating_at_start as "ratingAtStart", e.rating_at_end as "ratingAtEnd",
            e.staked_delta as "settledDelta", e.outcome,
            e.voided_reason as "voidedReason", e.settled_at as "settledAt",
            s.starts_at as "startsAt", s.ends_at as "endsAt", s.status as "seasonStatus",
            coalesce(rt.lapse_count, 0) as "lapseCount",
            (s.status = 'OPEN' and s.starts_at <= now() and s.ends_at > now())
              as "isCurrentSeason"
       from arena.season_entries e
       join arena.seasons s on s.id = e.stake_season_id
       left join lesson.user_course_runtime_state rt
         on rt.wallet_address = e.wallet_address and rt.course_id = e.course_id
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
