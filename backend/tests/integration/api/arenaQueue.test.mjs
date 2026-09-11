// Open queue, ladder, and the expiry sweep.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestServer, closeTestServer } from '../../helpers/test-server.mjs';
import { generateTestWallet, getTestAuthHeaders } from '../../helpers/test-auth.mjs';

let app;
let db;

async function seedBank() {
  for (let i = 1; i <= 12; i++) {
    await db.query(
      `insert into arena.questions (id, topic, difficulty, prompt, options, correct_option_id)
       values ($1, 'queue-test', 'easy', $2, $3::jsonb, 'a')
       on conflict (id) do nothing`,
      [
        `queue-q-${i}`, `Queue question ${i}?`,
        JSON.stringify([
          { id: 'a', text: 'Right' }, { id: 'b', text: 'Wrong' }, { id: 'c', text: 'Nope' },
        ]),
      ],
    );
  }
}

beforeAll(async () => {
  app = await createTestServer();
  db = await import('../../../src/lib/db.mjs');
  await seedBank();
  await db.query('delete from arena.queue');
});

afterAll(async () => { await closeTestServer(app); });

describe('arena open queue', () => {
  it('puts a lone player in the queue rather than matching them', async () => {
    const auth = await getTestAuthHeaders(generateTestWallet());
    const res = await app.inject({ method: 'POST', url: '/v1/arena/queue', headers: auth });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.matched).toBe(false);
    expect(body.waiting).toBe(true);
    await app.inject({ method: 'DELETE', url: '/v1/arena/queue', headers: auth });
  });

  it('pairs two queued players into one ACTIVE match', async () => {
    const a = await getTestAuthHeaders(generateTestWallet());
    const b = await getTestAuthHeaders(generateTestWallet());
    await app.inject({ method: 'POST', url: '/v1/arena/queue', headers: a });
    const res = await app.inject({ method: 'POST', url: '/v1/arena/queue', headers: b });
    const body = res.json();
    expect(body.matched).toBe(true);
    expect(body.matchId).toBeDefined();

    const state = (await app.inject({
      method: 'GET', url: `/v1/arena/matches/${body.matchId}`, headers: b,
    })).json();
    expect(state.status).toBe('ACTIVE');
    expect(state.origin).toBe('queue');
    expect(state.questionCount).toBe(7);
  });

  it('empties the queue after a pairing', async () => {
    const r = await db.query(`select count(*)::int as n from arena.queue`);
    expect(r.rows[0].n).toBe(0);
  });

  it('entering the queue twice is idempotent', async () => {
    const auth = await getTestAuthHeaders(generateTestWallet());
    await app.inject({ method: 'POST', url: '/v1/arena/queue', headers: auth });
    await app.inject({ method: 'POST', url: '/v1/arena/queue', headers: auth });
    const r = await db.query(`select count(*)::int as n from arena.queue`);
    expect(r.rows[0].n).toBe(1);
    await app.inject({ method: 'DELETE', url: '/v1/arena/queue', headers: auth });
  });

  it('suggests the link path once the wait passes the threshold', async () => {
    const wallet = generateTestWallet();
    const auth = await getTestAuthHeaders(wallet);
    await app.inject({ method: 'POST', url: '/v1/arena/queue', headers: auth });
    // Backdate the wait rather than sleeping 30s in a test.
    await db.query(
      `update arena.queue set enqueued_at = now() - interval '31 seconds' where wallet_address = $1`,
      [wallet]);
    const body = (await app.inject({ method: 'GET', url: '/v1/arena/queue', headers: auth })).json();
    expect(body.matched).toBe(false);
    expect(body.suggestLink).toBe(true);
    await app.inject({ method: 'DELETE', url: '/v1/arena/queue', headers: auth });
  });
});

describe('arena expiry sweep', () => {
  it('closes an unclaimed link challenge without penalising the creator', async () => {
    const auth = await getTestAuthHeaders(generateTestWallet());
    const created = (await app.inject({ method: 'POST', url: '/v1/arena/matches', headers: auth })).json();
    await db.query(
      `update arena.matches set expires_at = now() - interval '1 minute' where id = $1`,
      [created.matchId]);

    const { runArenaSweep } = await import('../../../src/lib/arenaSweep.mjs');
    await runArenaSweep({ log: { error() {} } });

    const m = await db.query(`select status from arena.matches where id = $1`, [created.matchId]);
    expect(m.rows[0].status).toBe('EXPIRED');
    const ev = await db.query(
      `select count(*)::int as n from arena.rating_events where match_id = $1`, [created.matchId]);
    expect(ev.rows[0].n).toBe(0);
  });

  it('settles a one-sided match as a forfeit win', async () => {
    const winner = generateTestWallet();
    const wAuth = await getTestAuthHeaders(winner);
    const lAuth = await getTestAuthHeaders(generateTestWallet());
    const created = (await app.inject({ method: 'POST', url: '/v1/arena/matches', headers: wAuth })).json();
    await app.inject({ method: 'POST', url: `/v1/arena/join/${created.joinCode}`, headers: lAuth });

    // Winner plays all 7; opponent never starts.
    const started = (await app.inject({
      method: 'POST', url: `/v1/arena/matches/${created.matchId}/start`, headers: wAuth,
    })).json();
    let cur = started.question;
    for (let i = 0; i < 7; i++) {
      const r = (await app.inject({
        method: 'POST', url: `/v1/arena/matches/${created.matchId}/answer`, headers: wAuth,
        payload: { questionId: cur.id, chosenOptionId: 'a' },
      })).json();
      cur = r.question ?? cur;
    }

    await db.query(
      `update arena.matches set expires_at = now() - interval '1 minute' where id = $1`,
      [created.matchId]);
    const { runArenaSweep } = await import('../../../src/lib/arenaSweep.mjs');
    await runArenaSweep({ log: { error() {} } });

    const m = await db.query(`select status from arena.matches where id = $1`, [created.matchId]);
    expect(m.rows[0].status).toBe('COMPLETE');
    const ev = await db.query(
      `select delta from arena.rating_events where match_id = $1 and wallet_address = $2`,
      [created.matchId, winner]);
    expect(ev.rows[0].delta).toBeGreaterThan(0);
  });

  it('is a no-op on a second run', async () => {
    const { runArenaSweep } = await import('../../../src/lib/arenaSweep.mjs');
    const r = await runArenaSweep({ log: { error() {} } });
    expect(r.settled).toBe(0);
  });
});

describe('arena ladder', () => {
  it('returns rated players ordered by rating', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/arena/ladder' });
    expect(res.statusCode).toBe(200);
    const rows = res.json();
    expect(Array.isArray(rows)).toBe(true);
    const ratings = rows.map((r) => r.rating);
    expect([...ratings].sort((x, y) => y - x)).toEqual(ratings);
    expect(rows.length).toBeLessThanOrEqual(100);
  });

  it('gives an unplayed wallet a clean 1200 record rather than an error', async () => {
    const auth = await getTestAuthHeaders(generateTestWallet());
    const body = (await app.inject({ method: 'GET', url: '/v1/arena/me', headers: auth })).json();
    expect(body.rating).toBe(1200);
    expect(body.games).toBe(0);
    expect(body.recentMatches).toEqual([]);
  });
});
