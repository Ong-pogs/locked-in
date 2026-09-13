// Arena play — the anti-cheat surface.
//
// Questions are served one at a time and the answer key never leaves the
// server. This deliberately inverts the lesson path, which returns
// correctAnswer to the client after submit (progress/repository.mjs:1390),
// because arena questions are reused across many matches.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestServer, closeTestServer } from '../../helpers/test-server.mjs';
import { generateTestWallet, getTestAuthHeaders } from '../../helpers/test-auth.mjs';
import { stakedWallet } from '../../helpers/arena-stake.mjs';
import { acquireSuiteLock, releaseSuiteLock } from '../../helpers/suite-lock.mjs';

let app;
let db;
let suiteLock;
let aliceAuth;
let bobAuth;

async function seedBank() {
  const { query } = await import('../../../src/lib/db.mjs');
  for (let i = 1; i <= 12; i++) {
    await query(
      `insert into arena.questions (id, topic, difficulty, prompt, options, correct_option_id)
       values ($1, 'play-test', 'easy', $2, $3::jsonb, 'a')
       on conflict (id) do nothing`,
      [
        `play-q-${i}`,
        `Play question ${i}?`,
        JSON.stringify([
          { id: 'a', text: 'Right' },
          { id: 'b', text: 'Wrong one' },
          { id: 'c', text: 'Wrong two' },
        ]),
      ],
    );
  }
}

async function makeActiveMatch() {
  const created = (await app.inject({
    method: 'POST', url: '/v1/arena/matches', headers: aliceAuth,
  })).json();
  await app.inject({
    method: 'POST', url: `/v1/arena/join/${created.joinCode}`, headers: bobAuth,
  });
  return created.matchId;
}

// The draw prefers unseen questions, so a match may contain anything in the
// bank. Tests therefore look the key up rather than assuming a fixed option —
// otherwise they silently depend on which fixtures happen to be seeded.
async function keyFor(questionId) {
  const r = await db.query(
    'select correct_option_id as k from arena.questions where id = $1', [questionId]);
  return r.rows[0].k;
}

async function wrongFor(questionId) {
  const r = await db.query(
    'select options, correct_option_id as k from arena.questions where id = $1', [questionId]);
  return r.rows[0].options.map((o) => o.id).find((id) => id !== r.rows[0].k);
}

/** Plays a full attempt. mode 'correct' answers every question right, 'wrong' every one wrong. */
async function playAll(matchId, headers, mode = 'correct') {
  const started = (await app.inject({
    method: 'POST', url: `/v1/arena/matches/${matchId}/start`, headers,
  })).json();
  let current = started.question;
  let last;
  for (let i = 0; i < 7; i++) {
    const pick = mode === 'correct' ? await keyFor(current.id) : await wrongFor(current.id);
    last = (await app.inject({
      method: 'POST', url: `/v1/arena/matches/${matchId}/answer`, headers,
      payload: { questionId: current.id, chosenOptionId: pick },
    })).json();
    current = last.question ?? current;
  }
  return last;
}

beforeAll(async () => {
  suiteLock = await acquireSuiteLock();
  app = await createTestServer();
  db = await import('../../../src/lib/db.mjs');
  await seedBank();
  aliceAuth = await getTestAuthHeaders(await stakedWallet(db));
  bobAuth = await getTestAuthHeaders(await stakedWallet(db));
});

afterAll(async () => {
  await closeTestServer(app);
});

describe('arena play', () => {
  it('serves exactly one question at a time, with no answer key', async () => {
    const matchId = await makeActiveMatch();
    const res = await app.inject({
      method: 'POST', url: `/v1/arena/matches/${matchId}/start`, headers: aliceAuth,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.questionsTotal).toBe(7);
    expect(body.question.options).toHaveLength(3);
    expect(body.question.timeoutMs).toBe(20_000);
    expect(res.payload).not.toContain('correct_option_id');
    expect(res.payload).not.toContain('correctOptionId');
    // One question, not the whole set.
    expect(Array.isArray(body.questions)).toBe(false);
  });

  it('rejects a second start', async () => {
    const matchId = await makeActiveMatch();
    await app.inject({ method: 'POST', url: `/v1/arena/matches/${matchId}/start`, headers: aliceAuth });
    const res = await app.inject({
      method: 'POST', url: `/v1/arena/matches/${matchId}/start`, headers: aliceAuth,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('ARENA_ALREADY_STARTED');
  });

  it('grades an answer and advances', async () => {
    const matchId = await makeActiveMatch();
    const started = (await app.inject({
      method: 'POST', url: `/v1/arena/matches/${matchId}/start`, headers: aliceAuth,
    })).json();
    const res = await app.inject({
      method: 'POST', url: `/v1/arena/matches/${matchId}/answer`, headers: aliceAuth,
      payload: { questionId: started.question.id, chosenOptionId: await keyFor(started.question.id) },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.isCorrect).toBe(true);
    expect(body.answered).toBe(1);
    expect(body.done).toBe(false);
    expect(body.question.id).not.toBe(started.question.id);
  });

  it('marks a wrong option incorrect', async () => {
    const matchId = await makeActiveMatch();
    const started = (await app.inject({
      method: 'POST', url: `/v1/arena/matches/${matchId}/start`, headers: aliceAuth,
    })).json();
    const res = await app.inject({
      method: 'POST', url: `/v1/arena/matches/${matchId}/answer`, headers: aliceAuth,
      payload: { questionId: started.question.id, chosenOptionId: await wrongFor(started.question.id) },
    });
    expect(res.json().isCorrect).toBe(false);
  });

  it('rejects answering the same question twice', async () => {
    const matchId = await makeActiveMatch();
    const started = (await app.inject({
      method: 'POST', url: `/v1/arena/matches/${matchId}/start`, headers: aliceAuth,
    })).json();
    const payload = { questionId: started.question.id, chosenOptionId: await keyFor(started.question.id) };
    await app.inject({ method: 'POST', url: `/v1/arena/matches/${matchId}/answer`, headers: aliceAuth, payload });
    const res = await app.inject({
      method: 'POST', url: `/v1/arena/matches/${matchId}/answer`, headers: aliceAuth, payload,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('ARENA_ALREADY_ANSWERED');
  });

  it('rejects answering a question that was never served', async () => {
    const matchId = await makeActiveMatch();
    await app.inject({ method: 'POST', url: `/v1/arena/matches/${matchId}/start`, headers: aliceAuth });
    // Ask the match which 7 it drew and pick one it did NOT. Naming a fixed id
    // here made the test fail roughly one run in twenty, because a 7-of-N draw
    // from a growing bank will sometimes contain whichever id you picked.
    const drawn = await db.query(
      'select question_ids from arena.matches where id = $1', [matchId]);
    const outsider = (await db.query(
      `select id from arena.questions where active and not (id = any($1::text[])) limit 1`,
      [drawn.rows[0].question_ids],
    )).rows[0].id;

    const res = await app.inject({
      method: 'POST', url: `/v1/arena/matches/${matchId}/answer`, headers: aliceAuth,
      payload: { questionId: outsider, chosenOptionId: 'a' },
    });
    expect([400, 409]).toContain(res.statusCode);
  });

  it('completes an attempt after 7 answers', async () => {
    const matchId = await makeActiveMatch();
    const last = await playAll(matchId, aliceAuth);
    expect(last.done).toBe(true);
    expect(last.answered).toBe(7);
    expect(last.correctCount).toBe(7);
  });

  it('keeps the opponent score hidden until both have played', async () => {
    const matchId = await makeActiveMatch();
    await playAll(matchId, aliceAuth);
    const res = await app.inject({
      method: 'GET', url: `/v1/arena/matches/${matchId}`, headers: aliceAuth,
    });
    const body = res.json();
    expect(body.resolved).toBe(false);
    for (const p of body.players) {
      expect(p.correctCount).toBeUndefined();
      expect(p.totalMs).toBeUndefined();
    }
  });

  it('resolves the match once both sides finish', async () => {
    const matchId = await makeActiveMatch();
    await playAll(matchId, aliceAuth, 'correct');
    await playAll(matchId, bobAuth, 'wrong');
    const body = (await app.inject({
      method: 'GET', url: `/v1/arena/matches/${matchId}`, headers: aliceAuth,
    })).json();
    expect(body.status).toBe('COMPLETE');
    expect(body.resolved).toBe(true);
    const scores = Object.fromEntries(body.players.map((p) => [p.walletAddress, p.correctCount]));
    expect(Object.values(scores).sort()).toEqual([0, 7]);
  });
});
