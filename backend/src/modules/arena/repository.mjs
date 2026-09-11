// Arena data access.
//
// ISOLATION CONTRACT: this module writes to arena.* and (via settle.mjs) to
// lesson.user_xp / lesson.user_xp_events. It must never write any other
// lesson.* table. See tests/integration/api/arenaIsolation.test.mjs — that
// test is the contract, this comment is only a signpost.
import { randomBytes } from 'node:crypto';
import { query, getPool } from '../../lib/db.mjs';
import { badRequest, notFound, conflict } from '../../lib/errors.mjs';
import { ARENA_QUESTION_COUNT } from '../../lib/arenaScoring.mjs';

// Crockford-style: no I, O, 0 or 1, so a code read aloud or retyped from a
// screenshot cannot silently resolve to a different match.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const JOIN_CODE_LENGTH = 8;

function newJoinCode() {
  const bytes = randomBytes(JOIN_CODE_LENGTH);
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

async function drawQuestionIds(client, walletAddress) {
  // Prefer questions this wallet has not seen, then fill with random actives.
  // Without the "unseen first" ordering a heavy player sees repeats quickly,
  // which quietly advantages whoever has played more.
  const result = await client.query(
    `with seen as (
       select distinct question_id from arena.match_answers where wallet_address = $1
     )
     select q.id
       from arena.questions q
      where q.active
      order by (q.id in (select question_id from seen)) asc, random()
      limit $2`,
    [walletAddress, ARENA_QUESTION_COUNT],
  );
  if (result.rowCount < ARENA_QUESTION_COUNT) {
    throw badRequest(
      'The arena question bank is too small to start a match',
      'ARENA_BANK_EMPTY',
    );
  }
  return result.rows.map((r) => r.id);
}

async function withTransaction(fn) {
  const pool = getPool();
  if (!pool) throw badRequest('Database is not configured', 'NO_DATABASE');
  const client = await pool.connect();
  try {
    await client.query('begin');
    const out = await fn(client);
    await client.query('commit');
    return out;
  } catch (err) {
    try { await client.query('rollback'); } catch { /* connection already gone */ }
    throw err;
  } finally {
    client.release();
  }
}

export async function createLinkMatch(walletAddress) {
  return withTransaction(async (client) => {
    const questionIds = await drawQuestionIds(client, walletAddress);
    const inserted = await client.query(
      `insert into arena.matches
         (join_code, origin, status, creator, question_ids, expires_at)
       values ($1, 'link', 'OPEN', $2, $3, now() + interval '24 hours')
       returning id as "matchId", join_code as "joinCode", expires_at as "expiresAt"`,
      [newJoinCode(), walletAddress, questionIds],
    );
    const match = inserted.rows[0];
    await client.query(
      `insert into arena.match_players (match_id, wallet_address) values ($1, $2)`,
      [match.matchId, walletAddress],
    );
    return match;
  });
}

export async function joinMatchByCode(walletAddress, joinCode) {
  const code = String(joinCode ?? '').toUpperCase();
  return withTransaction(async (client) => {
    // `for update` so two people racing the same link cannot both become the
    // opponent.
    const found = await client.query(
      `select id, creator, opponent, status from arena.matches
        where join_code = $1 for update`,
      [code],
    );
    if (found.rowCount === 0) {
      throw notFound('Challenge not found', 'ARENA_MATCH_NOT_FOUND');
    }
    const match = found.rows[0];
    if (match.creator === walletAddress) {
      throw badRequest('You cannot join your own challenge', 'ARENA_SELF_JOIN');
    }
    if (match.opponent) {
      throw conflict('This challenge already has an opponent', 'ARENA_MATCH_FULL');
    }
    if (match.status !== 'OPEN') {
      throw conflict('This challenge is no longer open', 'ARENA_MATCH_CLOSED');
    }

    await client.query(
      `update arena.matches set status = 'ACTIVE', opponent = $2 where id = $1`,
      [match.id, walletAddress],
    );
    await client.query(
      `insert into arena.match_players (match_id, wallet_address) values ($1, $2)
       on conflict (match_id, wallet_address) do nothing`,
      [match.id, walletAddress],
    );
    return { matchId: match.id };
  });
}

export async function getMatchState(walletAddress, matchId) {
  const result = await query(
    `select m.id as "matchId", m.status, m.origin, m.join_code as "joinCode",
            m.creator, m.opponent, m.season,
            m.expires_at as "expiresAt", m.resolved_at as "resolvedAt",
            coalesce(array_length(m.question_ids, 1), 0) as "questionCount"
       from arena.matches m
      where m.id = $1 and (m.creator = $2 or m.opponent = $2)`,
    [matchId, walletAddress],
  );
  // A non-participant gets 404, not 403: whether a given match id exists is
  // itself not their business.
  if (result.rowCount === 0) {
    throw notFound('Match not found', 'ARENA_MATCH_NOT_FOUND');
  }
  const match = result.rows[0];

  const players = await query(
    `select wallet_address as "walletAddress", started_at as "startedAt",
            submitted_at as "submittedAt", correct_count as "correctCount",
            total_ms as "totalMs", forfeited
       from arena.match_players where match_id = $1 order by joined_at`,
    [matchId],
  );

  // Scores stay hidden until the match resolves, so a player cannot peek at
  // the opponent's result and decide whether it is worth playing.
  const resolved = match.status === 'COMPLETE' || match.status === 'EXPIRED';
  return {
    ...match,
    resolved,
    players: players.rows.map((p) => (resolved ? p : {
      walletAddress: p.walletAddress,
      startedAt: p.startedAt,
      submittedAt: p.submittedAt,
    })),
  };
}
