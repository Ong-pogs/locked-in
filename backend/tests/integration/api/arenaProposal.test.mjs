// Queue pairings are an offer, not a match you are dropped into.
//
// The rule that matters: whoever ACCEPTED must not lose their place because
// the other side went quiet. A queue that punishes you for being at your desk
// is worse than one with no accept step at all.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createTestServer, closeTestServer } from '../../helpers/test-server.mjs';
import { generateTestWallet, getTestAuthHeaders } from '../../helpers/test-auth.mjs';
import { stakedWallet } from '../../helpers/arena-stake.mjs';
import { acquireSuiteLock, releaseSuiteLock } from '../../helpers/suite-lock.mjs';

let app;
let db;
let suiteLock;

const enter = async (h) => app.inject({ method: 'POST', url: '/v1/arena/queue', headers: h });
const poll = async (h) => app.inject({ method: 'GET', url: '/v1/arena/queue', headers: h });
const proposal = async (h) => app.inject({ method: 'GET', url: '/v1/arena/proposal', headers: h });
const accept = async (h, id) =>
  app.inject({ method: 'POST', url: `/v1/arena/proposal/${id}/accept`, headers: h });
const decline = async (h, id) =>
  app.inject({ method: 'POST', url: `/v1/arena/proposal/${id}/decline`, headers: h });

async function seedBank() {
  for (let i = 1; i <= 12; i++) {
    await db.query(
      `insert into arena.questions (id, topic, difficulty, prompt, options, correct_option_id)
       values ($1, 'proposal-test', 'easy', $2, $3::jsonb, 'a')
       on conflict (id) do nothing`,
      [`prop-q-${i}`, `Proposal question ${i}?`, JSON.stringify([
        { id: 'a', text: 'Right' }, { id: 'b', text: 'Wrong' }, { id: 'c', text: 'Nope' },
      ])],
    );
  }
}

/** Two fresh wallets paired through the queue. */
async function pair() {
  const a = await stakedWallet(db);
  const b = await stakedWallet(db);
  const aH = await getTestAuthHeaders(a);
  const bH = await getTestAuthHeaders(b);
  const first = await enter(aH);
  expect(first.json().matched).toBe(false);
  const second = await enter(bH);
  const body = second.json();
  expect(body.matched).toBe(true);
  expect(body.proposal).toBe(true);
  return { a, b, aH, bH, matchId: body.matchId };
}

const statusOf = async (matchId) =>
  (await db.query('select status from arena.matches where id = $1', [matchId])).rows[0].status;
const inQueue = async (wallet) =>
  (await db.query('select 1 from arena.queue where wallet_address = $1', [wallet])).rowCount > 0;

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
beforeEach(async () => { await db.query('delete from arena.queue'); });

describe('a queue pairing is proposed, not started', () => {
  it('creates a PROPOSED match rather than an ACTIVE one', async () => {
    const { matchId } = await pair();
    expect(await statusOf(matchId)).toBe('PROPOSED');
  });

  it('cannot be played before both accept', async () => {
    const { aH, matchId } = await pair();
    const res = await app.inject({
      method: 'POST', url: `/v1/arena/matches/${matchId}/start`, headers: aH });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('ARENA_MATCH_NOT_ACTIVE');
  });

  it('shows both players the offer with time left', async () => {
    const { aH, bH, matchId } = await pair();
    for (const h of [aH, bH]) {
      const p = (await proposal(h)).json();
      expect(p.matchId).toBe(matchId);
      expect(p.msLeft).toBeGreaterThan(0);
      expect(p.accepted).toBe(false);
    }
  });

  it('goes ACTIVE only once BOTH have accepted', async () => {
    const { aH, bH, matchId } = await pair();

    const first = await accept(aH, matchId);
    expect(first.json().ready).toBe(false);
    expect(await statusOf(matchId)).toBe('PROPOSED');

    const second = await accept(bH, matchId);
    expect(second.json().ready).toBe(true);
    expect(await statusOf(matchId)).toBe('ACTIVE');
  });

  it('is idempotent — accepting twice does not break it', async () => {
    const { aH, bH, matchId } = await pair();
    await accept(aH, matchId);
    await accept(aH, matchId);
    await accept(bH, matchId);
    expect(await statusOf(matchId)).toBe('ACTIVE');
  });

  it('reports the match as playable once accepted', async () => {
    const { aH, bH, matchId } = await pair();
    await accept(aH, matchId);
    await accept(bH, matchId);
    const p = (await poll(aH)).json();
    expect(p.matched).toBe(true);
    expect(p.matchId).toBe(matchId);
    expect(p.proposal).toBeUndefined();
  });
});

describe('declining', () => {
  it('kills the match and stops the decliner searching', async () => {
    const { a, aH, matchId } = await pair();
    const res = await decline(aH, matchId);
    expect(res.json().declined).toBe(true);
    expect(await statusOf(matchId)).toBe('EXPIRED');
    expect(await inQueue(a)).toBe(false);
  });

  it('puts an opponent who had already accepted BACK in the queue', async () => {
    // The whole point: being at your desk must not cost you your place.
    const { b, aH, bH, matchId } = await pair();
    await accept(bH, matchId);
    await decline(aH, matchId);

    expect(await statusOf(matchId)).toBe('EXPIRED');
    expect(await inQueue(b)).toBe(true);

    const p = (await poll(bH)).json();
    expect(p.matched).toBe(false);
    expect(p.waiting).toBe(true);
  });

  it('does not requeue an opponent who never answered either', async () => {
    const { b, aH, matchId } = await pair();
    await decline(aH, matchId);
    expect(await inQueue(b)).toBe(false);
  });

  it('refuses to accept a declined offer', async () => {
    const { aH, bH, matchId } = await pair();
    await decline(aH, matchId);
    const res = await accept(bH, matchId);
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('ARENA_PROPOSAL_GONE');
  });
});

describe('timing out', () => {
  it('retires the offer and requeues whoever accepted', async () => {
    const { b, aH, bH, matchId } = await pair();
    await accept(bH, matchId);

    // Wind the window into the past rather than waiting 15 real seconds.
    await db.query(
      `update arena.matches set expires_at = now() - interval '1 second' where id = $1`,
      [matchId]);

    // The poll is what retires it — the sweep runs every 15 minutes and a
    // proposal lives 15 seconds.
    expect((await proposal(bH)).json()).toBeNull();
    expect(await statusOf(matchId)).toBe('EXPIRED');
    expect(await inQueue(b)).toBe(true);

    // And the player who never answered is not dragged back in.
    const stillOffered = (await proposal(aH)).json();
    expect(stillOffered).toBeNull();
  });

  it('refuses an accept that arrives after the window closed', async () => {
    const { aH, matchId } = await pair();
    await db.query(
      `update arena.matches set expires_at = now() - interval '1 second' where id = $1`,
      [matchId]);
    const res = await accept(aH, matchId);
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('ARENA_PROPOSAL_GONE');
  });
});

describe('the countdown and the grace window', () => {
  it('counts down ten seconds, not the full server window', async () => {
    const { aH } = await pair();
    const p = (await proposal(aH)).json();
    // The server holds the offer for longer than it shows, so a click made at
    // 9.9s still lands. Showing the grace would make the bar empty and then
    // keep accepting, which is a lie in the other direction.
    expect(p.msLeft).toBeLessThanOrEqual(10_000);
    expect(p.msLeft).toBeGreaterThan(8_000);
  });

  it('still accepts a click that lands inside the grace window', async () => {
    const { aH, bH, matchId } = await pair();
    // Countdown exhausted, grace not: exactly the in-flight-click case.
    await db.query(
      `update arena.matches set expires_at = now() + interval '2 seconds' where id = $1`,
      [matchId]);

    const shown = (await proposal(aH)).json();
    expect(shown.msLeft).toBe(0);

    expect((await accept(aH, matchId)).statusCode).toBe(200);
    expect((await accept(bH, matchId)).statusCode).toBe(200);
    expect(await statusOf(matchId)).toBe('ACTIVE');
  });
});
