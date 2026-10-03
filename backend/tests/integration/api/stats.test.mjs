// Public stats endpoint against the fully migrated schema. The unit tests mock
// SQL, so this suite is what proves every table and column name in the stats
// queries really exists. The chain read is mocked to keep CI off the network.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createTestServer, closeTestServer } from '../../helpers/test-server.mjs';
import { acquireSuiteLock, releaseSuiteLock } from '../../helpers/suite-lock.mjs';

vi.mock('../../../src/lib/vaultV2Stats.mjs', () => ({
  getVaultV2Stats: async () => ({ usdcLocked: 2_500_000n, activeLocks: 1, learnersEarningYield: 1 }),
}));

let app;
let suiteLock;
let db;

// A real-looking base58 wallet that must only ever come back shortened.
const WALLET = 'StatsWa11et1111111111111111111111111111111';

beforeAll(async () => {
  suiteLock = await acquireSuiteLock();
  app = await createTestServer();
  db = await import('../../../src/lib/db.mjs');
  await db.query(
    `insert into lesson_auth.refresh_sessions (token_id, wallet_address, expires_at)
     values (gen_random_uuid(), $1, now() + interval '1 day')`,
    [WALLET],
  );
  const { clearStatsCache } = await import('../../../src/modules/stats/repository.mjs');
  clearStatsCache();
});

afterAll(async () => {
  await db.query('delete from lesson_auth.refresh_sessions where wallet_address = $1', [WALLET]);
  await closeTestServer(app);
  await releaseSuiteLock(suiteLock);
});

describe('GET /v1/stats', () => {
  it('answers without auth and runs every stats query on the real schema', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/stats' });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(Number.isFinite(Date.parse(body.generatedAt))).toBe(true);
    for (const value of [
      body.people.totalUsers, body.people.activeLast7Days,
      body.learning.enrollments, body.learning.lessonsCompleted, body.learning.coursesCompleted,
      body.learning.totalXp, body.learning.activeStreaks, body.learning.longestActiveStreak,
      body.money.potRecipients, body.arena.matchesPlayed, body.arena.players,
    ]) {
      expect(Number.isSafeInteger(value) && value >= 0).toBe(true);
    }
    expect(body.money.usdcLocked).toBe('2.500000');
    expect(body.money.potForfeitedUsdc).toMatch(/^\d+\.\d{6}$/);
    expect(body.money.potPaidOutUsdc).toMatch(/^\d+\.\d{6}$/);
    expect(Array.isArray(body.activity)).toBe(true);
    expect(body.activity.length).toBeLessThanOrEqual(20);
  });

  it('lists the sign-in with a shortened wallet and never a full address', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/stats' });
    expect(res.payload).not.toContain(WALLET);
    expect(res.payload).not.toMatch(/"[1-9A-HJ-NP-Za-km-z]{32,44}"/);
    expect(res.json().activity).toContainEqual(
      expect.objectContaining({ type: 'joined', wallet: 'Stat\u20261111' }),
    );
  });
});
