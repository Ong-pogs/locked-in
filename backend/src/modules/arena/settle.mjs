// Match settlement: rating, XP, season linkage, and exactly-once semantics.
//
// The ONLY lesson.* tables this file may touch are user_xp and user_xp_events,
// via lib/xp.mjs. Nothing here reads or writes principal, yield, shields,
// lapses, streak, the pot, or vouchers — and that is still true with stake
// seasons: this file records WHICH matches a season counts (arena.*), and the
// voucher signer reads the settled outcome from there. The dependency never
// runs the other way.
import { applyElo, ARENA_START_RATING } from '../../lib/arenaRating.mjs';
import { resolveMatch } from '../../lib/arenaScoring.mjs';
import { awardXp, ensureUserXp } from '../../lib/xp.mjs';
import { linkMatchForSeason } from './seasonRepository.mjs';

const XP_WIN = 50;
const XP_DRAW = 25;
const XP_LOSS = 10;
const XP_DAILY_MATCH_CAP = 5;

async function ratingFor(client, wallet, season) {
  await client.query(
    `insert into arena.ratings (wallet_address, season) values ($1, $2)
     on conflict (wallet_address, season) do nothing`,
    [wallet, season],
  );
  const r = await client.query(
    `select rating from arena.ratings where wallet_address = $1 and season = $2`,
    [wallet, season],
  );
  return r.rows[0]?.rating ?? ARENA_START_RATING;
}

// How many times these two have already settled a match inside the damper
// window. Feeds the Elo damper so trading wins with one accomplice stops
// paying.
//
// The window is 24h for unstaked play and the WHOLE OPEN SEASON when both are
// staked. A staked season is decided by a summed delta, so a pair who reset the
// damper every 24 hours could trade a season between themselves at full K.
async function priorMeetings(client, a, b) {
  const staked = await client.query(
    `select count(distinct e.wallet_address)::int as n
       from arena.season_entries e
       join arena.seasons s on s.id = e.stake_season_id and s.status = 'OPEN'
      where e.outcome = 'PENDING' and e.wallet_address = any($1::text[])`,
    [[a, b]],
  );
  const bothStaked = staked.rows[0].n >= 2;

  const r = await client.query(
    `select count(*)::int as n from arena.matches
      where status = 'COMPLETE'
        and resolved_at > case when $3 then
              coalesce(
                (select starts_at from arena.seasons where status = 'OPEN' limit 1),
                now() - interval '24 hours')
            else now() - interval '24 hours' end
        and ((creator = $1 and opponent = $2) or (creator = $2 and opponent = $1))`,
    [a, b, bothStaked],
  );
  return r.rows[0].n;
}

async function xpEarningMatchesToday(client, wallet) {
  const r = await client.query(
    `select count(*)::int as n from lesson.user_xp_events
      where wallet_address = $1
        and source like 'arena\\_%'
        and created_at >= date_trunc('day', (now() at time zone 'utc'))`,
    [wallet],
  );
  return r.rows[0].n;
}

/**
 * Settle a match if both sides are done. Returns true if THIS call settled it.
 *
 * The caller owns the transaction. Exactly-once is enforced by
 * arena.rating_events' unique (match_id, wallet_address): a concurrent second
 * settle violates it and rolls the whole transaction back.
 */
export async function maybeSettleMatch(client, matchId, { log = console } = {}) {
  const m = await client.query(
    `select id, creator, opponent, season, status
       from arena.matches where id = $1 for update`,
    [matchId],
  );
  if (m.rowCount === 0) return false;
  const match = m.rows[0];
  if (match.status === 'COMPLETE' || match.status === 'EXPIRED') return false;
  if (!match.opponent) return false;

  const ps = await client.query(
    `select wallet_address as "walletAddress", submitted_at as "submittedAt",
            coalesce(correct_count, 0) as "correctCount",
            coalesce(total_ms, 0) as "totalMs", forfeited
       from arena.match_players where match_id = $1`,
    [matchId],
  );
  if (ps.rowCount < 2) return false;
  // Someone is still mid-match and the window has not expired — not yet.
  if (ps.rows.some((p) => !p.submittedAt && !p.forfeited)) return false;

  const a = ps.rows.find((p) => p.walletAddress === match.creator);
  const b = ps.rows.find((p) => p.walletAddress === match.opponent);
  if (!a || !b) return false;

  const { outcome, scoreA } = resolveMatch(a, b);

  // Nobody played. Close it out without touching anyone's rating or XP.
  if (outcome === 'VOID') {
    await client.query(
      `update arena.matches set status = 'EXPIRED', resolved_at = now() where id = $1`,
      [matchId],
    );
    return true;
  }

  const ratingA = await ratingFor(client, a.walletAddress, match.season);
  const ratingB = await ratingFor(client, b.walletAddress, match.season);
  const meetings = await priorMeetings(client, a.walletAddress, b.walletAddress);
  const elo = applyElo({ ratingA, ratingB, scoreA, priorMeetings: meetings });

  for (const [wallet, before, after, delta] of [
    [a.walletAddress, ratingA, elo.ratingA, elo.deltaA],
    [b.walletAddress, ratingB, elo.ratingB, elo.deltaB],
  ]) {
    // This insert is the idempotency guard, not bookkeeping.
    await client.query(
      `insert into arena.rating_events
         (match_id, wallet_address, rating_before, rating_after, delta)
       values ($1, $2, $3, $4, $5)`,
      [matchId, wallet, before, after, delta],
    );
    await client.query(
      `update arena.ratings
          set rating = $3, games = games + 1, updated_at = now(),
              wins   = wins   + case when $4 > 0 then 1 else 0 end,
              losses = losses + case when $4 < 0 then 1 else 0 end,
              draws  = draws  + case when $4 = 0 then 1 else 0 end
        where wallet_address = $1 and season = $2`,
      [wallet, match.season, after, delta],
    );
  }

  // Record which season this match belongs to, in the same transaction as the
  // rating events it will later be summed with. Doing it here rather than in a
  // sweep means a link can never disagree with a rating event.
  //
  // Guarded: a missing link costs one match's contribution to a stake, but an
  // exception here would roll back the whole settlement and cost both players
  // their rating and XP for a match they actually played. The stake is the
  // newer, smaller thing — it does not get to break the game underneath it.
  // A SAVEPOINT, not a bare try/catch: a failed statement aborts the whole
  // Postgres transaction, so catching the error would still leave every
  // following query failing with "current transaction is aborted".
  await client.query('savepoint season_link');
  try {
    await linkMatchForSeason(client, matchId, [a.walletAddress, b.walletAddress]);
    await client.query('release savepoint season_link');
  } catch (err) {
    await client.query('rollback to savepoint season_link');
    log?.error?.(
      { matchId, error: err?.message ?? String(err) },
      'arena.season_link_failed',
    );
  }

  for (const [wallet, score] of [
    [a.walletAddress, scoreA],
    [b.walletAddress, 1 - scoreA],
  ]) {
    // Cap stops two accomplices grinding XP even though rating is already
    // damped. Matches past the cap still rate; they just pay nothing.
    if ((await xpEarningMatchesToday(client, wallet)) >= XP_DAILY_MATCH_CAP) continue;
    await ensureUserXp(client, wallet);
    const [amount, source] = score === 1
      ? [XP_WIN, 'arena_win']
      : score === 0.5
        ? [XP_DRAW, 'arena_draw']
        : [XP_LOSS, 'arena_loss'];
    await awardXp(client, wallet, amount, source, matchId);
  }

  await client.query(
    `update arena.matches set status = 'COMPLETE', resolved_at = now() where id = $1`,
    [matchId],
  );
  return true;
}
