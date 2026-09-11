// THE ISOLATION CONTRACT.
//
// A completed arena match may write to arena.* and to lesson.user_xp /
// lesson.user_xp_events. Nothing else. If someone ever wires the arena into
// yield, shields, lapses, streak, the pot or vouchers, this fails.
//
// This test IS the contract. The comments in the arena module are signposts.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestServer, closeTestServer } from '../../helpers/test-server.mjs';
import { generateTestWallet, getTestAuthHeaders } from '../../helpers/test-auth.mjs';

let app;
let db;

const MONEY_TABLES = [
  'lesson.user_course_runtime_state',
  'lesson.user_lesson_progress',
  'lesson.user_lesson_attempts',
  'lesson.completion_vouchers',
  'lesson.claim_attempts',
  'lesson.unlock_receipts',
  'lesson.miss_consequence_receipts',
  'lesson.harvest_result_receipts',
  'lesson.user_course_enrollments',
  'lesson.verified_completion_events',
];

async function snapshot() {
  const out = {};
  for (const t of MONEY_TABLES) {
    const r = await db.query(`select count(*)::int as n from ${t}`);
    out[t] = r.rows[0].n;
  }
  return out;
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

async function playFullMatchBothSides() {
  const aAuth = await getTestAuthHeaders(generateTestWallet());
  const bAuth = await getTestAuthHeaders(generateTestWallet());
  const created = (await app.inject({ method: 'POST', url: '/v1/arena/matches', headers: aAuth })).json();
  await app.inject({ method: 'POST', url: `/v1/arena/join/${created.joinCode}`, headers: bAuth });
  for (const [headers, pick] of [[aAuth, 'a'], [bAuth, 'b']]) {
    const started = (await app.inject({
      method: 'POST', url: `/v1/arena/matches/${created.matchId}/start`, headers,
    })).json();
    let current = started.question;
    for (let i = 0; i < 7; i++) {
      const r = (await app.inject({
        method: 'POST', url: `/v1/arena/matches/${created.matchId}/answer`, headers,
        payload: { questionId: current.id, chosenOptionId: pick },
      })).json();
      current = r.question ?? current;
    }
  }
  return created.matchId;
}

beforeAll(async () => {
  app = await createTestServer();
  db = await import('../../../src/lib/db.mjs');
  await seedBank();
});

afterAll(async () => { await closeTestServer(app); });

describe('arena isolation contract', () => {
  it('a full arena match touches NO money table', async () => {
    const before = await snapshot();
    await playFullMatchBothSides();
    const after = await snapshot();
    expect(after).toEqual(before);
  });

  it('a full arena match DOES move XP (proving the test is not vacuous)', async () => {
    const before = (await db.query(`select count(*)::int as n from lesson.user_xp_events`)).rows[0].n;
    await playFullMatchBothSides();
    const after = (await db.query(`select count(*)::int as n from lesson.user_xp_events`)).rows[0].n;
    expect(after).toBeGreaterThan(before);
  });

  it('a full arena match DOES write arena rows (also not vacuous)', async () => {
    const matchId = await playFullMatchBothSides();
    const answers = await db.query(
      `select count(*)::int as n from arena.match_answers where match_id = $1`, [matchId]);
    expect(answers.rows[0].n).toBe(14); // 7 questions x 2 players
  });
});
