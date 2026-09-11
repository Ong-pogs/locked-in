// Match settlement: rating, XP, and exactly-once semantics.
//
// The ONLY lesson.* tables this file may touch are user_xp and user_xp_events,
// via lib/xp.mjs. Nothing here reads or writes principal, yield, shields,
// lapses, streak, the pot, or vouchers.
import { applyElo, ARENA_START_RATING } from '../../lib/arenaRating.mjs';
import { resolveMatch } from '../../lib/arenaScoring.mjs';
import { awardXp, ensureUserXp } from '../../lib/xp.mjs';

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

// How many times these two have already settled a match in the last 24h. Feeds
// the Elo damper so trading wins with one accomplice stops paying.
async function priorMeetings(client, a, b) {
  const r = await client.query(
    `select count(*)::int as n from arena.matches
      where status = 'COMPLETE'
        and resolved_at > now() - interval '24 hours'
        and ((creator = $1 and opponent = $2) or (creator = $2 and opponent = $1))`,
    [a, b],
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
export async function maybeSettleMatch(client, matchId) {
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
