import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPublicStats, type PublicStats } from '@/services/api/statsApi';

vi.mock('@/services/api/config', () => ({ getLessonApiBaseUrl: () => 'https://stats.invalid' }));

function statsFixture(): PublicStats {
  return {
    generatedAt: '2026-10-04T03:00:00.000Z',
    people: { totalUsers: 0, activeLast7Days: 0 },
    learning: {
      enrollments: 0, lessonsCompleted: 0, coursesCompleted: 0,
      totalXp: 0, activeStreaks: 0, longestActiveStreak: 0,
    },
    money: {
      usdcLocked: '0.000000', activeLocks: 0, learnersEarningYield: 0,
      currentApyBps: 0, potForfeitedUsdc: '0.000000', potPaidOutUsdc: '0.000000', potRecipients: 0,
    },
    arena: { matchesPlayed: 0, players: 0, season: null },
    activity: [],
  };
}

const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('getPublicStats', () => {
  it('fetches without auth with five-minute caching and a ten-second timeout', async () => {
    const body = statsFixture();
    const signal = new AbortController().signal;
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(signal);
    fetchMock.mockResolvedValue(Response.json(body));
    await expect(getPublicStats()).resolves.toEqual(body);
    expect(timeout).toHaveBeenCalledWith(10_000);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('https://stats.invalid/v1/stats', {
      next: { revalidate: 300 }, signal,
    });
  });

  it('accepts nullable chain data, season dates, and every activity type', async () => {
    const body = statsFixture();
    Object.assign(body.money, { usdcLocked: null, activeLocks: null, learnersEarningYield: null, currentApyBps: null });
    body.arena.season = { name: 'Season 1', endsAt: null };
    const types: PublicStats['activity'][number]['type'][] = ['joined', 'started_course', 'finished_course', 'arena_win', 'pot_payout'];
    body.activity = types.map((type) => ({ type, wallet: '7xKX…a9Fq', courseTitle: null, at: body.generatedAt }));
    fetchMock.mockResolvedValue(Response.json(body));
    await expect(getPublicStats()).resolves.toEqual(body);
  });

  it('accepts populated season dates and decimal amounts beyond safe number precision', async () => {
    const body = statsFixture();
    body.arena.season = { name: 'Season 1', endsAt: '2026-10-31T18:00:00.000Z' };
    body.money.usdcLocked = '9007199254740993.125000';
    fetchMock.mockResolvedValue(Response.json(body));
    await expect(getPublicStats()).resolves.toEqual(body);
  });

  it.each([401, 503])('rejects HTTP %s', async (status) => {
    fetchMock.mockResolvedValue(new Response('', { status }));
    await expect(getPublicStats()).rejects.toThrow(`Stats request failed (${status}).`);
  });

  it('propagates network and timeout failures', async () => {
    const error = new DOMException('Request timed out', 'TimeoutError');
    fetchMock.mockRejectedValue(error);
    await expect(getPublicStats()).rejects.toBe(error);
  });

  it('rejects invalid JSON', async () => {
    fetchMock.mockResolvedValue(new Response('not json'));
    await expect(getPublicStats()).rejects.toThrow();
  });

  it.each([
    ['null', () => null],
    ['array', () => []],
    ['missing sections', () => ({ generatedAt: '2026-10-04T03:00:00.000Z' })],
    ['missing count', () => ({ ...statsFixture(), people: { totalUsers: 0 } })],
    ['non-integer count', () => ({ ...statsFixture(), people: { totalUsers: 0.5, activeLast7Days: 0 } })],
    ['invalid timestamp', () => ({ ...statsFixture(), generatedAt: 'invalid' })],
    ['numeric USDC', () => ({ ...statsFixture(), money: { ...statsFixture().money, usdcLocked: 1.5 } })],
    ['invalid decimal', () => ({ ...statsFixture(), money: { ...statsFixture().money, potPaidOutUsdc: '1e6' } })],
    ['missing nullable field', () => ({ ...statsFixture(), money: { ...statsFixture().money, activeLocks: undefined } })],
    ['malformed season', () => ({ ...statsFixture(), arena: { ...statsFixture().arena, season: { name: 'Season 1', endsAt: 'invalid' } } })],
    ['malformed activity', () => ({ ...statsFixture(), activity: [{}] })],
    ['unknown activity type', () => ({ ...statsFixture(), activity: [{ type: 'deposit', wallet: '7xKX…a9Fq', courseTitle: null, at: statsFixture().generatedAt }] })],
    ['too many activities', () => ({ ...statsFixture(), activity: Array.from({ length: 21 }, () => ({ type: 'joined', wallet: '7xKX…a9Fq', courseTitle: null, at: statsFixture().generatedAt })) })],
  ])('rejects a malformed body: %s', async (_label, makeBody) => {
    fetchMock.mockResolvedValue(Response.json(makeBody()));
    await expect(getPublicStats()).rejects.toThrow('Invalid public stats response.');
  });
});
