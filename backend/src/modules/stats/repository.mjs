import { hasDatabase, query } from '../../lib/db.mjs';
import { walletLabel } from '../../lib/publicIdentity.mjs';
import { getVaultV2Stats } from '../../lib/vaultV2Stats.mjs';
import { getYieldStrategyInfo, readKaminoSupplyApyBpsSafe } from '../../lib/yieldStrategy.mjs';
import { getOpenSeason } from '../arena/seasonRepository.mjs';

// Scalar subqueries avoid both cross-continent round trips and join fan-out.
const TOTALS_SQL = `
  select
    (select count(distinct wallet_address) from lesson_auth.refresh_sessions) as "totalUsers",
    (select count(*) from (
      select wallet_address from lesson.user_lesson_attempts
      where submitted_at >= now() - interval '7 days'
      union
      select wallet_address from arena.match_players
      where submitted_at >= now() - interval '7 days'
    ) active_wallets) as "activeLast7Days",
    (select count(*) from lesson.user_course_enrollments
      where course_id <> 'test-kitchen') as "enrollments",
    (select count(*) from lesson.verified_completion_events
      where course_id <> 'test-kitchen') as "lessonsCompleted",
    (select count(*) from lesson.user_course_runtime_state
      where course_id <> 'test-kitchen' and course_completed_at is not null) as "coursesCompleted",
    (select coalesce(sum(xp_total), 0) from lesson.user_xp) as "totalXp",
    (select count(distinct wallet_address) from lesson.user_course_runtime_state
      where course_id <> 'test-kitchen' and current_streak > 0
        and lock_account_address is not null and course_completed_at is null) as "activeStreaks",
    (select coalesce(max(current_streak), 0) from lesson.user_course_runtime_state
      where course_id <> 'test-kitchen' and current_streak > 0
        and lock_account_address is not null and course_completed_at is null) as "longestActiveStreak",
    (select coalesce(sum(to_pot), 0)::text from lesson.v2_pot_settle_events) as "potForfeited",
    (select coalesce(sum(payout_amount), 0)::text from lesson.community_pot_distribution_snapshots
      where course_id <> 'test-kitchen' and status = 'distributed') as "potPaidOut",
    (select count(distinct wallet_address) from lesson.community_pot_distribution_snapshots
      where course_id <> 'test-kitchen' and status = 'distributed') as "potRecipients",
    (select count(*) from arena.matches where status = 'COMPLETE') as "matchesPlayed",
    (select count(*) from arena.ratings where games > 0) as "players"
`;

// course_complete uses source_id as the course ID; arena_win uses a match ID.
// Wallet-labelled payouts plus exact cumulative pot totals reveal individual
// payouts with one recipient or one new payout between snapshots. Omit them.
const ACTIVITY_SQL = `
  select type, wallet_address as "walletAddress", course_title as "courseTitle", at
  from (
    select 'joined' as type, wallet_address, null::text as course_title, min(created_at) as at
    from lesson_auth.refresh_sessions
    group by wallet_address
    union all
    select 'started_course', e.wallet_address, c.title, e.enrolled_at
    from lesson.user_course_enrollments e
    left join lesson.courses c on c.id = e.course_id
    where e.course_id <> 'test-kitchen'
    union all
    select 'finished_course', e.wallet_address, c.title, e.created_at
    from lesson.user_xp_events e
    left join lesson.courses c on c.id = e.source_id
    where e.source = 'course_complete' and (e.source_id is null or e.source_id <> 'test-kitchen')
    union all
    select 'arena_win', wallet_address, null::text, created_at
    from lesson.user_xp_events
    where source = 'arena_win'
  ) events
  where at is not null
  order by at desc
  limit 20
`;

const CACHE_TTL_MS = 5 * 60_000;
const PARTIAL_CHAIN_TTL_MS = 60_000;
const LOAD_DEADLINE_MS = 8_000;
const FAILURE_COOLDOWN_MS = 30_000;
let statsCache = null; // { loadedAt, ttl, value }
let statsCacheLoad = null; // { promise, abandoned }
let statsCacheFailure = null; // { retryAt, error }
let statsCacheGeneration = 0;

function formatUsdc(baseUnits) {
  const amount = BigInt(baseUnits);
  const magnitude = amount < 0n ? -amount : amount;
  return `${amount < 0n ? '-' : ''}${magnitude / 1_000_000n}.${String(magnitude % 1_000_000n).padStart(6, '0')}`;
}

// The Kamino read has no timeout of its own, so cap it below the load
// deadline. A slow read shows no APY instead of failing the whole page.
const APY_READ_TIMEOUT_MS = 5_000;
function readLiveApyBps() {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), APY_READ_TIMEOUT_MS);
  });
  return Promise.race([readKaminoSupplyApyBpsSafe(), timeout]).finally(() => clearTimeout(timer));
}

async function loadStats() {
  const databaseConfigured = hasDatabase();
  const [totalsResult, activityResult, season, chain, apyBps] = await Promise.all([
    databaseConfigured ? query(TOTALS_SQL) : { rows: [] },
    databaseConfigured ? query(ACTIVITY_SQL) : { rows: [] },
    databaseConfigured ? getOpenSeason().catch(() => null) : null,
    getVaultV2Stats(),
    readLiveApyBps(),
  ]);
  const totals = totalsResult.rows[0] ?? {};
  const info = getYieldStrategyInfo();
  return {
    generatedAt: new Date().toISOString(),
    people: {
      totalUsers: Number(totals.totalUsers ?? 0),
      activeLast7Days: Number(totals.activeLast7Days ?? 0),
    },
    learning: {
      enrollments: Number(totals.enrollments ?? 0),
      lessonsCompleted: Number(totals.lessonsCompleted ?? 0),
      coursesCompleted: Number(totals.coursesCompleted ?? 0),
      totalXp: Number(totals.totalXp ?? 0),
      activeStreaks: Number(totals.activeStreaks ?? 0),
      longestActiveStreak: Number(totals.longestActiveStreak ?? 0),
    },
    money: {
      usdcLocked: chain.usdcLocked == null ? null : formatUsdc(chain.usdcLocked),
      activeLocks: chain.activeLocks,
      learnersEarningYield: chain.learnersEarningYield,
      currentApyBps: info.kind === 'kamino_klend_reserve_v1' && apyBps != null ? apyBps : null,
      potForfeitedUsdc: formatUsdc(totals.potForfeited ?? '0'),
      potPaidOutUsdc: formatUsdc(totals.potPaidOut ?? '0'),
      potRecipients: Number(totals.potRecipients ?? 0),
    },
    arena: {
      matchesPlayed: Number(totals.matchesPlayed ?? 0),
      players: Number(totals.players ?? 0),
      season: season ? { name: `Season ${season.id}`, endsAt: season.endsAt == null ? null : new Date(season.endsAt).toISOString() } : null,
    },
    activity: activityResult.rows.map((row) => ({
      type: row.type,
      wallet: walletLabel(row.walletAddress),
      courseTitle: row.courseTitle ?? null,
      at: new Date(row.at).toISOString(),
    })),
  };
}

function waitForStatsLoad(inFlight) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      inFlight.abandoned = true;
      if (statsCacheLoad === inFlight) statsCacheLoad = null;
      reject(new Error('STATS_LOAD_TIMEOUT'));
    }, LOAD_DEADLINE_MS);
  });
  return Promise.race([inFlight.promise, deadline]).finally(() => clearTimeout(timer));
}

export function clearStatsCache() {
  statsCacheGeneration += 1;
  statsCache = null;
  statsCacheLoad = null;
  statsCacheFailure = null;
}

export async function getStats() {
  if (statsCache && Date.now() - statsCache.loadedAt < statsCache.ttl) return statsCache.value;
  if (statsCacheFailure && Date.now() < statsCacheFailure.retryAt) {
    if (statsCache) return statsCache.value;
    throw statsCacheFailure.error;
  }
  if (!statsCacheLoad) {
    const generation = statsCacheGeneration;
    const inFlight = { promise: loadStats(), abandoned: false };
    // Share one deadline and cooldown across all waiters for this load.
    inFlight.promise = waitForStatsLoad(inFlight).then((value) => {
      // A timed-out or cleared load cannot overwrite a newer cache entry.
      if (!inFlight.abandoned && generation === statsCacheGeneration) {
        const partialChain = value.money.usdcLocked == null || value.money.activeLocks == null || value.money.learnersEarningYield == null;
        statsCache = { loadedAt: Date.now(), ttl: partialChain ? PARTIAL_CHAIN_TTL_MS : CACHE_TTL_MS, value };
        statsCacheFailure = null;
      }
      return value;
    }, (error) => {
      if (generation === statsCacheGeneration) {
        statsCacheFailure = { retryAt: Date.now() + FAILURE_COOLDOWN_MS, error };
      }
      throw error;
    });
    statsCacheLoad = inFlight;
    const clearMarker = () => {
      if (statsCacheLoad === inFlight) statsCacheLoad = null;
    };
    inFlight.promise.then(clearMarker, clearMarker);
  }
  try {
    return await statsCacheLoad.promise;
  } catch (error) {
    // Preserve the last good snapshot while failed refreshes cool down.
    if (statsCache) return statsCache.value;
    throw error;
  }
}
