// Arena match creation and joining.
//
// The last test here is load-bearing: the arena reuses its question bank across
// many matches, so unlike the lesson path (which returns correctAnswer to the
// client after submit, progress/repository.mjs:1390) the key must never ship.
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
       values ($1, 'test', 'easy', $2, $3::jsonb, 'a')
       on conflict (id) do nothing`,
      [
        `match-q-${i}`,
        `Match question ${i}?`,
        JSON.stringify([
          { id: 'a', text: 'Right' },
          { id: 'b', text: 'Wrong one' },
          { id: 'c', text: 'Wrong two' },
        ]),
      ],
    );
  }
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

async function createChallenge(headers = aliceAuth) {
  const res = await app.inject({ method: 'POST', url: '/v1/arena/matches', headers });
  expect(res.statusCode).toBe(201);
  return res.json();
}

describe('arena match creation and joining', () => {
  it('creates a link challenge with a join code', async () => {
    const body = await createChallenge();
    expect(body.matchId).toBeDefined();
    expect(body.joinCode).toMatch(/^[A-Z0-9]{8}$/);
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('rejects an unauthenticated create', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/arena/matches' });
    expect(res.statusCode).toBe(401);
  });

  it('lets a second player join by code', async () => {
    const created = await createChallenge();
    const res = await app.inject({
      method: 'POST', url: `/v1/arena/join/${created.joinCode}`, headers: bobAuth,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().matchId).toBe(created.matchId);
  });

  it('refuses to let the creator join their own match', async () => {
    const created = await createChallenge();
    const res = await app.inject({
      method: 'POST', url: `/v1/arena/join/${created.joinCode}`, headers: aliceAuth,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('ARENA_SELF_JOIN');
  });

  it('refuses a third player', async () => {
    const carolAuth = await getTestAuthHeaders(await stakedWallet(db));
    const created = await createChallenge();
    await app.inject({ method: 'POST', url: `/v1/arena/join/${created.joinCode}`, headers: bobAuth });
    const res = await app.inject({
      method: 'POST', url: `/v1/arena/join/${created.joinCode}`, headers: carolAuth,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('ARENA_MATCH_FULL');
  });

  it('404s an unknown join code', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/arena/join/ZZZZZZZZ', headers: bobAuth });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('ARENA_MATCH_NOT_FOUND');
  });

  it('hides match state from a wallet that is not a participant', async () => {
    const strangerAuth = await getTestAuthHeaders(await stakedWallet(db));
    const created = await createChallenge();
    const res = await app.inject({
      method: 'GET', url: `/v1/arena/matches/${created.matchId}`, headers: strangerAuth,
    });
    expect(res.statusCode).toBe(404);
  });

  it('never exposes question ids or answer keys in match state', async () => {
    const created = await createChallenge();
    const res = await app.inject({
      method: 'GET', url: `/v1/arena/matches/${created.matchId}`, headers: aliceAuth,
    });
    expect(res.statusCode).toBe(200);
    expect(res.payload).not.toContain('correct_option_id');
    expect(res.payload).not.toContain('correctOptionId');
    expect(res.payload).not.toContain('questionIds');
    expect(res.payload).not.toContain('match-q-');
  });
});
