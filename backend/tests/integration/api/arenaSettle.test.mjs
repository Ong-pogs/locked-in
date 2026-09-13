// Settlement: rating, XP, exactly-once, and the VOID path.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestServer, closeTestServer } from '../../helpers/test-server.mjs';
import { generateTestWallet, getTestAuthHeaders } from '../../helpers/test-auth.mjs';
import { stakedWallet } from '../../helpers/arena-stake.mjs';
import { acquireSuiteLock, releaseSuiteLock } from '../../helpers/suite-lock.mjs';

let app;
let db;
let suiteLock;

async function seedBank() {
  for (let i = 1; i <= 12; i++) {
    await db.query(
      `insert into arena.questions (id, topic, difficulty, prompt, options, correct_option_id)
       values ($1, 'settle-test', 'easy', $2, $3::jsonb, 'a')
       on conflict (id) do nothing`,
      [
        `settle-q-${i}`,
        `Settle question ${i}?`,
        JSON.stringify([
          { id: 'a', text: 'Right' }, { id: 'b', text: 'Wrong' }, { id: 'c', text: 'Also wrong' },
        ]),
      ],
    );
  }
}

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

async function playAll(matchId, headers, mode) {
  const started = (await app.inject({
    method: 'POST', url: `/v1/arena/matches/${matchId}/start`, headers,
  })).json();
  let current = started.question;
  for (let i = 0; i < 7; i++) {
    const r = (await app.inject({
      method: 'POST', url: `/v1/arena/matches/${matchId}/answer`, headers,
      payload: {
        questionId: current.id,
        chosenOptionId: mode === 'correct' ? await keyFor(current.id) : await wrongFor(current.id),
      },
    })).json();
    current = r.question ?? current;
  }
}

/** Creates a decided match: winner gets 7/7, loser 0/7. */
async function decidedMatch() {
  const winner = await stakedWallet(db);
  const loser = await stakedWallet(db);
  const wAuth = await getTestAuthHeaders(winner);
  const lAuth = await getTestAuthHeaders(loser);
  const created = (await app.inject({ method: 'POST', url: '/v1/arena/matches', headers: wAuth })).json();
  await app.inject({ method: 'POST', url: `/v1/arena/join/${created.joinCode}`, headers: lAuth });
  await playAll(created.matchId, wAuth, 'correct');
  await playAll(created.matchId, lAuth, 'wrong');
  return { matchId: created.matchId, winner, loser };
}

beforeAll(async () => {
  suiteLock = await acquireSuiteLock();
  app = await createTestServer();
  db = await import('../../../src/lib/db.mjs');
  await seedBank();
});

afterAll(async () => {
  await closeTestServer(app);
  await releaseSuiteLock(suiteLock);
});

describe('arena settlement', () => {
  it('writes exactly one rating event per player', async () => {
    const { matchId } = await decidedMatch();
    const r = await db.query(
      `select count(*)::int as n from arena.rating_events where match_id = $1`, [matchId]);
    expect(r.rows[0].n).toBe(2);
  });

  it('applies a zero-sum rating change', async () => {
    const { matchId, winner, loser } = await decidedMatch();
    const r = await db.query(
      `select wallet_address, delta from arena.rating_events where match_id = $1`, [matchId]);
    const byWallet = Object.fromEntries(r.rows.map((x) => [x.wallet_address, x.delta]));
    expect(byWallet[winner]).toBeGreaterThan(0);
    expect(byWallet[loser]).toBeLessThan(0);
    expect(byWallet[winner] + byWallet[loser]).toBe(0);
  });

  it('updates the ladder row for both players', async () => {
    const { winner, loser } = await decidedMatch();
    const w = await db.query(
      `select rating, games, wins, losses from arena.ratings where wallet_address = $1`, [winner]);
    const l = await db.query(
      `select rating, games, wins, losses from arena.ratings where wallet_address = $1`, [loser]);
    expect(w.rows[0].wins).toBe(1);
    expect(w.rows[0].rating).toBeGreaterThan(1200);
    expect(l.rows[0].losses).toBe(1);
    expect(l.rows[0].rating).toBeLessThan(1200);
  });

  it('awards 50 XP to the winner and 10 to the loser', async () => {
    const { matchId, winner, loser } = await decidedMatch();
    const r = await db.query(
      `select wallet_address, xp_amount, source from lesson.user_xp_events where source_id = $1`,
      [matchId]);
    const byWallet = Object.fromEntries(r.rows.map((x) => [x.wallet_address, x]));
    expect(byWallet[winner].xp_amount).toBe(50);
    expect(byWallet[winner].source).toBe('arena_win');
    expect(byWallet[loser].xp_amount).toBe(10);
    expect(byWallet[loser].source).toBe('arena_loss');
  });

  it('settles exactly once even when settle is called again', async () => {
    const { matchId } = await decidedMatch();
    const { maybeSettleMatch } = await import('../../../src/modules/arena/settle.mjs');
    const pool = db.getPool();
    const client = await pool.connect();
    let settledAgain = true;
    try {
      await client.query('begin');
      settledAgain = await maybeSettleMatch(client, matchId);
      await client.query('commit');
    } finally { client.release(); }

    expect(settledAgain).toBe(false);
    const ratings = await db.query(
      `select count(*)::int as n from arena.rating_events where match_id = $1`, [matchId]);
    expect(ratings.rows[0].n).toBe(2);
    const xp = await db.query(
      `select count(*)::int as n from lesson.user_xp_events where source_id = $1`, [matchId]);
    expect(xp.rows[0].n).toBe(2);
  });

  it('VOIDs a double forfeit — no rating, no XP', async () => {
    const alice = await stakedWallet(db);
    const bob = await stakedWallet(db);
    const aAuth = await getTestAuthHeaders(alice);
    const bAuth = await getTestAuthHeaders(bob);
    const created = (await app.inject({ method: 'POST', url: '/v1/arena/matches', headers: aAuth })).json();
    await app.inject({ method: 'POST', url: `/v1/arena/join/${created.joinCode}`, headers: bAuth });

    // Neither played; the window closes and the sweep marks both forfeited.
    await db.query(
      `update arena.matches set expires_at = now() - interval '1 minute' where id = $1`,
      [created.matchId]);
    await db.query(
      `update arena.match_players set forfeited = true where match_id = $1`, [created.matchId]);

    const { maybeSettleMatch } = await import('../../../src/modules/arena/settle.mjs');
    const pool = db.getPool();
    const client = await pool.connect();
    try {
      await client.query('begin');
      await maybeSettleMatch(client, created.matchId);
      await client.query('commit');
    } finally { client.release(); }

    const m = await db.query(`select status from arena.matches where id = $1`, [created.matchId]);
    expect(m.rows[0].status).toBe('EXPIRED');
    const ratings = await db.query(
      `select count(*)::int as n from arena.rating_events where match_id = $1`, [created.matchId]);
    expect(ratings.rows[0].n).toBe(0);
    const xp = await db.query(
      `select count(*)::int as n from lesson.user_xp_events where source_id = $1`, [created.matchId]);
    expect(xp.rows[0].n).toBe(0);
  });
});
