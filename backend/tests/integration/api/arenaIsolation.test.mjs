// THE ISOLATION CONTRACT.
//
// A completed arena match may write to arena.* and to lesson.user_xp /
// lesson.user_xp_events. Nothing else. If someone ever wires the arena into
// yield, shields, lapses, streak, the pot or vouchers, this fails.
//
// Scoped to the two wallets that played, NOT to global row counts: the suite
// runs files in parallel and other tests legitimately write money rows, so a
// global before/after snapshot fails for reasons that have nothing to do with
// the arena. Per-wallet is also the stronger assertion — it proves the arena
// created nothing for ITS OWN players.
//
// The table list is discovered from the schema rather than hardcoded, so a
// money table added later is covered without anyone remembering to edit this.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestServer, closeTestServer } from '../../helpers/test-server.mjs';
import { generateTestWallet, getTestAuthHeaders } from '../../helpers/test-auth.mjs';

let app;
let db;

// The only lesson.* tables the arena is permitted to touch.
const ALLOWED = new Set(['user_xp', 'user_xp_events']);

async function walletScopedLessonTables() {
  const r = await db.query(
    `select table_name from information_schema.columns
      where table_schema = 'lesson' and column_name = 'wallet_address'
      order by table_name`,
  );
  return r.rows.map((x) => x.table_name).filter((t) => !ALLOWED.has(t));
}

async function seedBank() {
  for (let i = 1; i <= 12; i++) {
    await db.query(
      `insert into arena.questions (id, topic, difficulty, prompt, options, correct_option_id)
       values ($1, 'iso-test', 'easy', $2, $3::jsonb, 'a')
       on conflict (id) do nothing`,
      [
        `iso-q-${i}`,
        `Isolation question ${i}?`,
        JSON.stringify([
          { id: 'a', text: 'Right' }, { id: 'b', text: 'Wrong' }, { id: 'c', text: 'Nope' },
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

/** Plays a complete match and returns the two wallets plus the match id. */
async function playFullMatchBothSides() {
  const alice = generateTestWallet();
  const bob = generateTestWallet();
  const aAuth = await getTestAuthHeaders(alice);
  const bAuth = await getTestAuthHeaders(bob);

  const created = (await app.inject({
    method: 'POST', url: '/v1/arena/matches', headers: aAuth,
  })).json();
  await app.inject({
    method: 'POST', url: `/v1/arena/join/${created.joinCode}`, headers: bAuth,
  });

  for (const headers of [aAuth, bAuth]) {
    const started = (await app.inject({
      method: 'POST', url: `/v1/arena/matches/${created.matchId}/start`, headers,
    })).json();
    let current = started.question;
    for (let i = 0; i < 7; i++) {
      const r = (await app.inject({
        method: 'POST', url: `/v1/arena/matches/${created.matchId}/answer`, headers,
        payload: { questionId: current.id, chosenOptionId: await keyFor(current.id) },
      })).json();
      current = r.question ?? current;
    }
  }
  return { matchId: created.matchId, wallets: [alice, bob] };
}

beforeAll(async () => {
  app = await createTestServer();
  db = await import('../../../src/lib/db.mjs');
  await seedBank();
});

afterAll(async () => { await closeTestServer(app); });

describe('arena isolation contract', () => {
  it('creates NO row in any wallet-scoped money table for its players', async () => {
    const { wallets } = await playFullMatchBothSides();
    const tables = await walletScopedLessonTables();
    expect(tables.length).toBeGreaterThan(3); // guard against a vacuous pass

    const offenders = [];
    for (const t of tables) {
      const r = await db.query(
        `select count(*)::int as n from lesson.${t} where wallet_address = any($1::text[])`,
        [wallets],
      );
      if (r.rows[0].n > 0) offenders.push(`lesson.${t}=${r.rows[0].n}`);
    }
    expect(offenders, `arena wrote to money table(s): ${offenders.join(', ')}`).toEqual([]);
  });

  it('DOES write XP for its players (so the check above is not vacuous)', async () => {
    const { matchId, wallets } = await playFullMatchBothSides();
    const xp = await db.query(
      `select count(*)::int as n from lesson.user_xp_events
        where wallet_address = any($1::text[]) and source_id = $2`,
      [wallets, matchId],
    );
    expect(xp.rows[0].n).toBe(2);
  });

  it('DOES write arena rows (also not vacuous)', async () => {
    const { matchId } = await playFullMatchBothSides();
    const answers = await db.query(
      `select count(*)::int as n from arena.match_answers where match_id = $1`, [matchId]);
    expect(answers.rows[0].n).toBe(14); // 7 questions x 2 players
  });
});
