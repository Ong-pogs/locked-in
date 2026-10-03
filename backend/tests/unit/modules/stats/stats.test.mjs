import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { query, hasDatabase, getVaultV2Stats, getYieldStrategyInfo } = vi.hoisted(() => ({
  query: vi.fn(),
  hasDatabase: vi.fn(),
  getVaultV2Stats: vi.fn(),
  getYieldStrategyInfo: vi.fn(),
}));

vi.mock('../../../../src/lib/db.mjs', () => ({ query, hasDatabase }));
vi.mock('../../../../src/lib/vaultV2Stats.mjs', () => ({ getVaultV2Stats }));
vi.mock('../../../../src/lib/yieldStrategy.mjs', () => ({ getYieldStrategyInfo }));
vi.mock('@solana/web3.js', async (importOriginal) => ({
  ...(await importOriginal()),
  Connection: vi.fn(function () { throw new Error('Unexpected RPC connection'); }),
}));

const ALICE = '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin';
const BOB = '9wtYy32vK3hxQeFpWLGXYGRZevEXYQQKYGA3vW2nWLxw';
const NOW = '2026-10-04T03:00:00.000Z';
const NULL_CHAIN = { usdcLocked: null, activeLocks: null, learnersEarningYield: null };
const TOTALS = {
  totalUsers: '11', activeLast7Days: '7', enrollments: '13', lessonsCompleted: '41',
  coursesCompleted: '3', totalXp: '9100', activeStreaks: '4', longestActiveStreak: '12',
  potForfeited: '9007199254740993123456', potPaidOut: '1500000', potRecipients: '2',
  matchesPlayed: '19', players: '8',
};
const ACTIVITY = ['joined', 'started_course', 'finished_course', 'arena_win', 'pot_payout'].map((type, index) => ({
  type,
  walletAddress: index % 2 ? BOB : ALICE,
  courseTitle: ['started_course', 'finished_course', 'pot_payout'].includes(type) ? 'Solana basics' : null,
  at: new Date(Date.parse(NOW) - index * 60_000),
  payoutAmount: '1500000', // Extra private columns must never be copied into the response.
}));

let getStats;
let clearStatsCache;
let statsRoutes;
let app;

function mockRows(totals = TOTALS, activity = ACTIVITY, season = { id: 3, endsAt: new Date('2026-11-01T00:00:00Z') }) {
  query.mockImplementation(async (sql) => {
    if (sql.includes('as "totalUsers"')) return { rows: [totals] };
    if (sql.includes('from arena.seasons')) return { rows: season ? [season] : [] };
    if (sql.includes('limit 20')) return { rows: activity };
    throw new Error(`Unexpected stats SQL: ${sql}`);
  });
}

beforeEach(async () => {
  ({ getStats, clearStatsCache } = await import('../../../../src/modules/stats/repository.mjs'));
  ({ statsRoutes } = await import('../../../../src/modules/stats/routes.mjs'));
  clearStatsCache();
  query.mockReset();
  hasDatabase.mockReturnValue(true);
  getVaultV2Stats.mockReset().mockResolvedValue({ usdcLocked: 1500000n, activeLocks: 3, learnersEarningYield: 2 });
  getYieldStrategyInfo.mockReturnValue({ kamino: { lastApyBps: 425 }, fixedApyBps: 100 });
  mockRows();
});

afterEach(async () => {
  if (app) await app.close();
  app = null;
  clearStatsCache?.();
  vi.useRealTimers();
});

describe('public stats contract', () => {
  it('maps SQL, chain and season data to the exact public shape without losing USDC precision', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const result = await getStats();
    expect(result).toEqual({
      generatedAt: NOW,
      people: { totalUsers: 11, activeLast7Days: 7 },
      learning: { enrollments: 13, lessonsCompleted: 41, coursesCompleted: 3, totalXp: 9100, activeStreaks: 4, longestActiveStreak: 12 },
      money: {
        usdcLocked: '1.500000', activeLocks: 3, learnersEarningYield: 2, currentApyBps: 425,
        potForfeitedUsdc: '9007199254740993.123456', potPaidOutUsdc: '1.500000', potRecipients: 2,
      },
      arena: { matchesPlayed: 19, players: 8, season: { name: 'Season 3', endsAt: '2026-11-01T00:00:00.000Z' } },
      activity: [
        { type: 'joined', wallet: '9xQe…VFin', courseTitle: null, at: NOW },
        { type: 'started_course', wallet: '9wtY…WLxw', courseTitle: 'Solana basics', at: '2026-10-04T02:59:00.000Z' },
        { type: 'finished_course', wallet: '9xQe…VFin', courseTitle: 'Solana basics', at: '2026-10-04T02:58:00.000Z' },
        { type: 'arena_win', wallet: '9wtY…WLxw', courseTitle: null, at: '2026-10-04T02:57:00.000Z' },
        { type: 'pot_payout', wallet: '9xQe…VFin', courseTitle: 'Solana basics', at: '2026-10-04T02:56:00.000Z' },
      ],
    });
    expect(JSON.stringify(result)).not.toMatch(/"[1-9A-HJ-NP-Za-km-z]{32,44}"/);
    expect(result.activity.every((event) => event.wallet.includes('…'))).toBe(true);
    expect(result.activity.every((event) => Object.keys(event).length === 4)).toBe(true);
  });

  it('batches totals, excludes test-kitchen and uses the verified source columns', async () => {
    await getStats();
    expect(query).toHaveBeenCalledTimes(3); // Totals, activity, and the existing season helper.
    const totals = query.mock.calls.find(([sql]) => sql.includes('as "totalUsers"'))[0];
    const activity = query.mock.calls.find(([sql]) => sql.includes('limit 20'))[0];
    expect(totals).toMatch(/user_lesson_attempts[\s\S]*submitted_at >= now\(\) - interval '7 days'[\s\S]*union[\s\S]*arena\.match_players[\s\S]*submitted_at >= now\(\) - interval '7 days'/);
    for (const table of ['user_course_enrollments', 'verified_completion_events', 'user_course_runtime_state', 'community_pot_distribution_snapshots']) {
      expect(totals).toMatch(new RegExp(`${table}[^)]*course_id <> 'test-kitchen'`));
    }
    expect(totals).toContain('sum(xp_total)');
    expect(totals).toContain('sum(to_pot), 0)::text');
    expect(totals).toContain('sum(payout_amount), 0)::text');
    expect(totals).not.toContain('published_');
    expect(activity).toContain("source_id <> 'test-kitchen'");
    expect(activity).toContain("course_id <> 'test-kitchen'");
    expect(activity).toContain('min(created_at)');
    expect(activity).toContain('c.title');
    expect(activity).toContain('order by at desc');
    expect(activity).not.toMatch(/payout_amount|to_pot/);
  });

  it('starts all reads in parallel even if the totals query stalls', async () => {
    let release;
    const pending = new Promise((resolve) => { release = resolve; });
    const normalQuery = query.getMockImplementation();
    query.mockImplementation((sql) => sql.includes('as "totalUsers"') ? pending : normalQuery(sql));
    const reading = getStats();
    expect(query).toHaveBeenCalledTimes(3);
    expect(getVaultV2Stats).toHaveBeenCalledTimes(1);
    release({ rows: [TOTALS] });
    await reading;
  });

  it('returns zero database counts and no activity without querying an unconfigured database', async () => {
    hasDatabase.mockReturnValue(false);
    getVaultV2Stats.mockResolvedValue(NULL_CHAIN);
    getYieldStrategyInfo.mockReturnValue({});
    const result = await getStats();
    expect(result.people).toEqual({ totalUsers: 0, activeLast7Days: 0 });
    expect(result.learning).toEqual({ enrollments: 0, lessonsCompleted: 0, coursesCompleted: 0, totalXp: 0, activeStreaks: 0, longestActiveStreak: 0 });
    expect(result.money).toEqual({
      ...NULL_CHAIN, currentApyBps: null, potForfeitedUsdc: '0.000000', potPaidOutUsdc: '0.000000', potRecipients: 0,
    });
    expect(result.arena).toEqual({ matchesPlayed: 0, players: 0, season: null });
    expect(result.activity).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  it.each([
    [{ kamino: { lastApyBps: 0 }, fixedApyBps: 100 }, 0],
    [{ kamino: { lastApyBps: null }, fixedApyBps: 100 }, 100],
    [{}, null],
  ])('uses the APY fallback without treating zero as missing', async (info, expected) => {
    getYieldStrategyInfo.mockReturnValue(info);
    mockRows(TOTALS, [], null);
    const result = await getStats();
    expect(result.money.currentApyBps).toBe(expected);
    expect(result.arena.season).toBeNull();
  });
});

describe('stats cache', () => {
  it('shares the first load and keeps it for five minutes', async () => {
    vi.useFakeTimers();
    const first = await Promise.all([getStats(), getStats(), getStats()]);
    expect(first[1]).toBe(first[0]);
    expect(query).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(299_999);
    expect(await getStats()).toBe(first[0]);
    expect(query).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    await getStats();
    expect(query).toHaveBeenCalledTimes(6);
    expect(getVaultV2Stats).toHaveBeenCalledTimes(2);
  });

  it.each([NULL_CHAIN, { usdcLocked: 1500000n, activeLocks: null, learnersEarningYield: null }])('retries incomplete chain data after sixty seconds', async (chain) => {
    vi.useFakeTimers();
    getVaultV2Stats.mockResolvedValueOnce(chain);
    const first = await getStats();
    await vi.advanceTimersByTimeAsync(59_999);
    expect(await getStats()).toBe(first);
    expect(query).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect((await getStats()).money.activeLocks).toBe(3);
    expect(query).toHaveBeenCalledTimes(6);
  });

  it('serves stale data on refresh failure and retries the next request', async () => {
    vi.useFakeTimers();
    const first = await getStats();
    await vi.advanceTimersByTimeAsync(300_000);
    query.mockRejectedValue(new Error('Database unavailable'));
    expect(await getStats()).toBe(first);
    mockRows({ ...TOTALS, totalUsers: '12' });
    expect((await getStats()).people.totalUsers).toBe(12);
  });

  it('does not cache a failed first load', async () => {
    query.mockRejectedValue(new Error('Database unavailable'));
    await expect(getStats()).rejects.toThrow('Database unavailable');
    mockRows();
    expect((await getStats()).people.totalUsers).toBe(11);
  });

  it('abandons stalled loads at eight seconds and prevents their late result from replacing recovery', async () => {
    vi.useFakeTimers();
    let release;
    query.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    const outcomes = [getStats(), getStats()].map((read) => read.catch((error) => error.message));
    await vi.advanceTimersByTimeAsync(8_000);
    expect(await Promise.all(outcomes)).toEqual(['STATS_LOAD_TIMEOUT', 'STATS_LOAD_TIMEOUT']);
    mockRows({ ...TOTALS, totalUsers: '12' });
    const recovered = await getStats();
    release({ rows: [] });
    await vi.advanceTimersByTimeAsync(0);
    expect(await getStats()).toBe(recovered);
    expect(recovered.people.totalUsers).toBe(12);
  });

  it('serves stale data when a refresh exceeds the waiter deadline', async () => {
    vi.useFakeTimers();
    const first = await getStats();
    await vi.advanceTimersByTimeAsync(300_000);
    query.mockReturnValue(new Promise(() => {}));
    const refresh = getStats();
    await vi.advanceTimersByTimeAsync(8_000);
    expect(await refresh).toBe(first);
  });

  it('does not let a load from before clearStatsCache overwrite a new load', async () => {
    let release;
    const normalQuery = query.getMockImplementation();
    query.mockImplementation((sql) => sql.includes('as "totalUsers"')
      ? new Promise((resolve) => { release = resolve; }) : normalQuery(sql));
    const oldRead = getStats();
    clearStatsCache();
    mockRows({ ...TOTALS, totalUsers: '12' });
    const fresh = await getStats();
    release({ rows: [TOTALS] });
    await oldRead;
    expect(await getStats()).toBe(fresh);
  });
});

describe('GET /v1/stats', () => {
  async function buildApp() {
    app = Fastify();
    await app.register(rateLimit, { global: false });
    await app.register(statsRoutes);
    return app;
  }

  it('is public, has no Cache-Control header and limits each client to sixty requests per minute', async () => {
    await buildApp();
    const first = await app.inject({ method: 'GET', url: '/v1/stats' });
    expect(first.statusCode).toBe(200);
    expect(first.json().money.usdcLocked).toBe('1.500000');
    expect(first.headers['cache-control']).toBeUndefined();
    for (let i = 1; i < 60; i += 1) {
      expect((await app.inject({ method: 'GET', url: '/v1/stats' })).statusCode).toBe(200);
    }
    expect((await app.inject({ method: 'GET', url: '/v1/stats' })).statusCode).toBe(429);
  });

  it('returns only the public 503 error when a load fails', async () => {
    query.mockRejectedValue(new Error('Private database failure'));
    await buildApp();
    const response = await app.inject({ method: 'GET', url: '/v1/stats' });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'STATS_UNAVAILABLE' });
  });
});
