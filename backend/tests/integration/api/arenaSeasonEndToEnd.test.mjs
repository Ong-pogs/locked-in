// The whole loop, driven through the API rather than seeded.
//
// Everything else in the season suite inserts rating events and links by hand,
// which proves the settlement maths but NOT that a real match ever produces a
// link. This file plays an actual match between two staked wallets and follows
// it all the way to the bps signed into the loser's voucher.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestServer, closeTestServer } from '../../helpers/test-server.mjs';
import { generateTestWallet, getTestAuthHeaders } from '../../helpers/test-auth.mjs';
import { acquireSuiteLock, releaseSuiteLock } from '../../helpers/suite-lock.mjs';
import { __setLockV2FreshReadOverride, deriveLockPdaServer } from '../../../src/lib/lockPosition.mjs';
import { runArenaSeasonSweep } from '../../../src/lib/arenaSeasonSweep.mjs';
import { issueCourseCompletionVoucher } from '../../../src/modules/progress/repository.mjs';

let app;
let db;
let suiteLock;

const COURSE = 'test-kitchen';
const SEASON = 777;
const quiet = { log: { error: () => {} } };

const lockFor = (wallet, courseId = COURSE) =>
  deriveLockPdaServer(process.env.VAULT_V2_PROGRAM_ID, wallet, courseId).toBase58();

async function seedBank() {
  for (let i = 1; i <= 12; i++) {
    await db.query(
      `insert into arena.questions (id, topic, difficulty, prompt, options, correct_option_id)
       values ($1, 'e2e-season', 'easy', $2, $3::jsonb, 'a')
       on conflict (id) do nothing`,
      [
        `e2e-season-q-${i}`,
        `Season E2E question ${i}?`,
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

async function openSeason() {
  await db.query(
    `update arena.seasons set status = 'SETTLED' where status = 'OPEN' and id <> $1`, [SEASON]);
  await db.query(
    `insert into arena.seasons (id, starts_at, ends_at, status)
     values ($1, now() - interval '1 hour', now() + interval '30 days', 'OPEN')
     on conflict (id) do update set status = 'OPEN',
       starts_at = excluded.starts_at, ends_at = excluded.ends_at`,
    [SEASON],
  );
}

async function optIn(wallet) {
  const res = await app.inject({
    method: 'POST', url: '/v1/arena/stake',
    headers: await getTestAuthHeaders(wallet),
    payload: { courseId: COURSE, consentVersion: 'arena-stake-v1' },
  });
  expect(res.statusCode).toBe(201);
  return res.json();
}

async function completeCourse(wallet) {
  const lessons = await db.query(
    `select distinct pl.lesson_id
       from lesson.published_modules pm
       join lesson.published_lessons pl
         on pl.module_id = pm.module_id and pl.release_id = pm.release_id
      where pm.course_id = $1`,
    [COURSE],
  );
  for (const { lesson_id } of lessons.rows) {
    await db.query(
      `insert into lesson.user_lesson_progress
         (wallet_address, lesson_id, completed, completed_at, updated_at)
       values ($1, $2, true, now(), now())
       on conflict (wallet_address, lesson_id)
       do update set completed = true, completed_at = now(), updated_at = now()`,
      [wallet, lesson_id],
    );
  }
}

beforeAll(async () => {
  suiteLock = await acquireSuiteLock();
  app = await createTestServer();
  db = await import('../../../src/lib/db.mjs');
  await seedBank();
});

afterAll(async () => {
  __setLockV2FreshReadOverride(null);
  await closeTestServer(app);
  await releaseSuiteLock(suiteLock);
});

describe('a real staked match decides a real season', () => {
  it('links, settles, and signs the loser down one tier', async () => {
    await openSeason();

    const winner = generateTestWallet();
    const loser = generateTestWallet();
    __setLockV2FreshReadOverride(async (w, c) => ({
      mismatch: false, status: 'ACTIVE', principal: 10_000_000n,
      lockStartTs: 0, lockAddress: lockFor(w, c),
    }));

    await optIn(winner);
    await optIn(loser);

    // Play it for real, through the same endpoints a browser uses.
    const wAuth = await getTestAuthHeaders(winner);
    const lAuth = await getTestAuthHeaders(loser);
    const created = (await app.inject({
      method: 'POST', url: '/v1/arena/matches', headers: wAuth,
    })).json();
    await app.inject({
      method: 'POST', url: `/v1/arena/join/${created.joinCode}`, headers: lAuth });
    await playAll(created.matchId, wAuth, 'correct');
    await playAll(created.matchId, lAuth, 'wrong');

    // maybeSettleMatch must have linked it — nothing else in this test does.
    const links = await db.query(
      `select wallet_address, counted from arena.season_match_links
        where stake_season_id = $1 and match_id = $2 order by wallet_address`,
      [SEASON, created.matchId],
    );
    expect(links.rowCount).toBe(2);
    expect(links.rows.every((r) => r.counted)).toBe(true);

    // The live view already shows each side where they stand.
    const liveLoser = (await app.inject({
      method: 'GET', url: '/v1/arena/stake', headers: lAuth })).json();
    expect(liveLoser.outcome).toBe('PENDING');
    expect(liveLoser.stakedDelta).toBeLessThan(0);
    expect(liveLoser.matchesCounted).toBe(1);

    const liveWinner = (await app.inject({
      method: 'GET', url: '/v1/arena/stake', headers: wAuth })).json();
    expect(liveWinner.stakedDelta).toBeGreaterThan(0);

    // Close the season and settle it.
    await db.query(
      `update arena.seasons set ends_at = now() - interval '1 second' where id = $1`, [SEASON]);
    await runArenaSeasonSweep(quiet);

    const outcomes = await db.query(
      `select wallet_address, outcome, staked_delta from arena.season_entries
        where stake_season_id = $1 and wallet_address = any($2::text[])`,
      [SEASON, [winner, loser]],
    );
    const byWallet = Object.fromEntries(outcomes.rows.map((r) => [r.wallet_address, r]));
    expect(byWallet[loser].outcome).toBe('FORFEIT');
    expect(byWallet[loser].staked_delta).toBeLessThan(0);
    expect(byWallet[winner].outcome).toBe('KEPT');

    // And the consequence lands in the signed bytes, for the loser only.
    await completeCourse(loser);
    await completeCourse(winner);

    const loserVoucher = await issueCourseCompletionVoucher(loser, COURSE);
    expect(loserVoucher.arenaPenaltyTiers).toBe(1);
    expect(loserVoucher.bps).toBe(5_000);
    expect(Buffer.from(loserVoucher.message, 'base64').readUInt16LE(81)).toBe(5_000);

    const winnerVoucher = await issueCourseCompletionVoucher(winner, COURSE);
    expect(winnerVoucher.arenaPenaltyTiers).toBe(0);
    expect(winnerVoucher.bps).toBe(10_000);
    expect(Buffer.from(winnerVoucher.message, 'base64').readUInt16LE(81)).toBe(10_000);
  });

  it('turns an unstaked wallet away at the door', async () => {
    await openSeason();
    const auth = await getTestAuthHeaders(generateTestWallet());

    // Every way into the Spire, not just the one the UI happens to use.
    for (const url of ['/v1/arena/matches', '/v1/arena/queue']) {
      const res = await app.inject({ method: 'POST', url, headers: auth });
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('ARENA_STAKE_REQUIRED');
    }

    // Including someone else's invite link, which bypasses the lobby entirely.
    const staked = generateTestWallet();
    __setLockV2FreshReadOverride(async (w, c) => ({
      mismatch: false, status: 'ACTIVE', principal: 10_000_000n,
      lockStartTs: 0, lockAddress: lockFor(w, c),
    }));
    await optIn(staked);
    const created = (await app.inject({
      method: 'POST', url: '/v1/arena/matches',
      headers: await getTestAuthHeaders(staked) })).json();
    const joined = await app.inject({
      method: 'POST', url: `/v1/arena/join/${created.joinCode}`, headers: auth });
    expect(joined.statusCode).toBe(403);
    expect(joined.json().code).toBe('ARENA_STAKE_REQUIRED');
  });

  it('does not count a match against someone who staked after seeing it', async () => {
    await openSeason();

    const early = generateTestWallet();
    const late = generateTestWallet();
    __setLockV2FreshReadOverride(async (w, c) => ({
      mismatch: false, status: 'ACTIVE', principal: 10_000_000n,
      lockStartTs: 0, lockAddress: lockFor(w, c),
    }));
    await optIn(early);

    // `late` opens the invite, watches the match exist, and only then stakes.
    const eAuth = await getTestAuthHeaders(early);
    const created = (await app.inject({
      method: 'POST', url: '/v1/arena/matches', headers: eAuth })).json();
    await optIn(late);
    const lAuth = await getTestAuthHeaders(late);
    await app.inject({
      method: 'POST', url: `/v1/arena/join/${created.joinCode}`, headers: lAuth });
    await playAll(created.matchId, eAuth, 'correct');
    await playAll(created.matchId, lAuth, 'wrong');

    // Staking into a match already in flight must not move a season.
    const links = await db.query(
      `select 1 from arena.season_match_links where match_id = $1`, [created.matchId]);
    expect(links.rowCount).toBe(0);

    const live = (await app.inject({
      method: 'GET', url: '/v1/arena/stake', headers: lAuth })).json();
    expect(live.stakedDelta).toBe(0);
    expect(live.matchesCounted).toBe(0);
  });

  it('stops counting a pair after their second meeting', async () => {
    await openSeason();

    const a = generateTestWallet();
    const b = generateTestWallet();
    __setLockV2FreshReadOverride(async (w, c) => ({
      mismatch: false, status: 'ACTIVE', principal: 10_000_000n,
      lockStartTs: 0, lockAddress: lockFor(w, c),
    }));
    await optIn(a);
    await optIn(b);

    const aAuth = await getTestAuthHeaders(a);
    const bAuth = await getTestAuthHeaders(b);
    const counted = [];
    for (let i = 0; i < 3; i++) {
      const created = (await app.inject({
        method: 'POST', url: '/v1/arena/matches', headers: aAuth })).json();
      await app.inject({
        method: 'POST', url: `/v1/arena/join/${created.joinCode}`, headers: bAuth });
      await playAll(created.matchId, aAuth, 'correct');
      await playAll(created.matchId, bAuth, 'wrong');
      const r = await db.query(
        `select counted from arena.season_match_links
          where stake_season_id = $1 and match_id = $2 and wallet_address = $3`,
        [SEASON, created.matchId, a],
      );
      counted.push(r.rows[0].counted);
    }

    // Two colluding wallets are the whole population at this size, so the
    // third meeting onward is recorded and ignored.
    expect(counted).toEqual([true, true, false]);
  });
});
