// Arena data access.
//
// ISOLATION CONTRACT: this module writes to arena.* and (via settle.mjs) to
// lesson.user_xp / lesson.user_xp_events. It must never write any other
// lesson.* table. See tests/integration/api/arenaIsolation.test.mjs — that
// test is the contract, this comment is only a signpost.
import { randomBytes } from 'node:crypto';
import { query, getPool } from '../../lib/db.mjs';
import { badRequest, notFound, conflict } from '../../lib/errors.mjs';
import { ARENA_QUESTION_COUNT, ARENA_QUESTION_TIMEOUT_MS, clampElapsed } from '../../lib/arenaScoring.mjs';
import { maybeSettleMatch } from './settle.mjs';

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

// ---------------------------------------------------------------------------
// Play
// ---------------------------------------------------------------------------

// Deliberately omits correct_option_id. Arena questions are reused across many
// matches, so a key that ships once is burned forever.
function publicQuestion(row, order) {
  return {
    id: row.id,
    order,
    prompt: row.prompt,
    options: row.options,
    timeoutMs: ARENA_QUESTION_TIMEOUT_MS,
  };
}

async function loadPlayerMatch(client, matchId, walletAddress) {
  const r = await client.query(
    `select m.id, m.status, m.question_ids as "questionIds",
            m.expires_at as "expiresAt",
            p.started_at as "startedAt", p.submitted_at as "submittedAt"
       from arena.matches m
       join arena.match_players p
         on p.match_id = m.id and p.wallet_address = $2
      where m.id = $1
      for update of m`,
    [matchId, walletAddress],
  );
  if (r.rowCount === 0) throw notFound('Match not found', 'ARENA_MATCH_NOT_FOUND');
  const row = r.rows[0];
  if (new Date(row.expiresAt).getTime() < Date.now()) {
    throw conflict('This match has expired', 'ARENA_MATCH_EXPIRED');
  }
  return row;
}

// Inserts a placeholder row at SERVE time so served_at is stamped by the
// server. The client's clock never contributes to the score.
async function serveNext(client, matchId, walletAddress, questionIds) {
  const answered = await client.query(
    `select question_id, answered_at from arena.match_answers
      where match_id = $1 and wallet_address = $2`,
    [matchId, walletAddress],
  );
  const done = new Set(answered.rows.filter((r) => r.answered_at).map((r) => r.question_id));
  const nextId = questionIds.find((id) => !done.has(id));
  if (!nextId) {
    return { question: null, answered: done.size, total: questionIds.length };
  }

  const order = questionIds.indexOf(nextId) + 1;
  await client.query(
    `insert into arena.match_answers
       (match_id, wallet_address, question_id, question_order, served_at)
     values ($1, $2, $3, $4, now())
     on conflict (match_id, wallet_address, question_id) do nothing`,
    [matchId, walletAddress, nextId, order],
  );

  const q = await client.query(
    `select id, prompt, options from arena.questions where id = $1`,
    [nextId],
  );
  return {
    question: publicQuestion(q.rows[0], order),
    answered: done.size,
    total: questionIds.length,
  };
}

export async function startAttempt(walletAddress, matchId) {
  return withTransaction(async (client) => {
    const match = await loadPlayerMatch(client, matchId, walletAddress);
    if (match.startedAt) {
      throw conflict('You have already started this match', 'ARENA_ALREADY_STARTED');
    }
    if (match.status !== 'ACTIVE') {
      throw conflict('This match is not ready to play yet', 'ARENA_MATCH_NOT_ACTIVE');
    }
    await client.query(
      `update arena.match_players set started_at = now()
        where match_id = $1 and wallet_address = $2`,
      [matchId, walletAddress],
    );
    const served = await serveNext(client, matchId, walletAddress, match.questionIds);
    return { questionsTotal: match.questionIds.length, ...served };
  });
}

export async function nextQuestion(walletAddress, matchId) {
  return withTransaction(async (client) => {
    const match = await loadPlayerMatch(client, matchId, walletAddress);
    if (!match.startedAt) {
      throw conflict('Start the match first', 'ARENA_NOT_STARTED');
    }
    const served = await serveNext(client, matchId, walletAddress, match.questionIds);
    return { questionsTotal: match.questionIds.length, ...served };
  });
}

export async function submitAnswer(walletAddress, matchId, questionId, chosenOptionId) {
  if (!questionId || typeof questionId !== 'string') {
    throw badRequest('questionId is required', 'ARENA_BAD_ANSWER');
  }
  return withTransaction(async (client) => {
    const match = await loadPlayerMatch(client, matchId, walletAddress);
    if (!match.startedAt) throw conflict('Start the match first', 'ARENA_NOT_STARTED');
    if (match.submittedAt) throw conflict('You have already finished', 'ARENA_ALREADY_SUBMITTED');
    if (!match.questionIds.includes(questionId)) {
      throw badRequest('That question is not part of this match', 'ARENA_UNKNOWN_QUESTION');
    }

    const existing = await client.query(
      `select served_at, answered_at from arena.match_answers
        where match_id = $1 and wallet_address = $2 and question_id = $3
        for update`,
      [matchId, walletAddress, questionId],
    );
    if (existing.rowCount === 0) {
      throw badRequest('That question has not been served to you', 'ARENA_QUESTION_NOT_SERVED');
    }
    if (existing.rows[0].answered_at) {
      throw conflict('You already answered that question', 'ARENA_ALREADY_ANSWERED');
    }

    // Grading and timing are both server-side. The client sends only a choice.
    const key = await client.query(
      `select correct_option_id as "correctOptionId" from arena.questions where id = $1`,
      [questionId],
    );
    const isCorrect = chosenOptionId != null
      && chosenOptionId === key.rows[0].correctOptionId;
    const elapsedMs = clampElapsed(Date.now() - new Date(existing.rows[0].served_at).getTime());

    await client.query(
      `update arena.match_answers
          set answered_at = now(), chosen_option_id = $4,
              is_correct = $5, elapsed_ms = $6
        where match_id = $1 and wallet_address = $2 and question_id = $3`,
      [matchId, walletAddress, questionId, chosenOptionId ?? null, isCorrect, elapsedMs],
    );

    const tally = await client.query(
      `select count(*) filter (where answered_at is not null)::int as answered,
              count(*) filter (where is_correct)::int as correct,
              coalesce(sum(elapsed_ms) filter (where answered_at is not null), 0)::int as "totalMs"
         from arena.match_answers where match_id = $1 and wallet_address = $2`,
      [matchId, walletAddress],
    );
    const { answered, correct, totalMs } = tally.rows[0];
    const done = answered >= match.questionIds.length;

    if (done) {
      await client.query(
        `update arena.match_players
            set submitted_at = now(), correct_count = $3, total_ms = $4
          where match_id = $1 and wallet_address = $2`,
        [matchId, walletAddress, correct, totalMs],
      );
      await maybeSettleMatch(client, matchId);
      return { isCorrect, answered, correctCount: correct, totalMs, done: true, question: null };
    }

    const served = await serveNext(client, matchId, walletAddress, match.questionIds);
    return { isCorrect, answered, correctCount: correct, totalMs, done: false, question: served.question };
  });
}
