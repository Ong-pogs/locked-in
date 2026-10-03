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
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

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

  it('removes a full 44-character wallet address while preserving valid activity and stats', async () => {
    const body = statsFixture();
    const masked = { type: 'joined' as const, wallet: '7xKX…a9Fq', courseTitle: null, at: body.generatedAt };
    const player = { ...masked, wallet: 'Player' };
    body.activity = [masked, { ...masked, wallet: '7xKX'.repeat(11) }, player];
    fetchMock.mockResolvedValue(Response.json(body));

    await expect(getPublicStats()).resolves.toEqual({ ...body, activity: [masked, player] });
  });

  it.each([
    '', 'player', '7xK…a9Fq', '7xKXX…a9Fq', '7xKX…a9F', '7xKX…a9Fqq',
    '7xKX...a9Fq', '0xKX…a9Fq', '7xKX…O9Fq', 'IxKX…a9Fq', '7xKX…l9Fq',
  ])('removes activity with an invalid wallet mask: %j', async (wallet) => {
    const body = statsFixture();
    body.activity = [{ type: 'joined', wallet, courseTitle: null, at: body.generatedAt }];
    fetchMock.mockResolvedValue(Response.json(body));

    await expect(getPublicStats()).resolves.toEqual({ ...body, activity: [] });
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

  describe('request deadline', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      // Simulate revalidation ignoring the fetch signal.
      vi.spyOn(AbortSignal, 'timeout').mockReturnValue(new AbortController().signal);
    });

    it.each(['fetch', 'JSON parsing'])('rejects after ten seconds when %s never resolves', async (stage) => {
      if (stage === 'fetch') {
        fetchMock.mockReturnValue(new Promise<Response>(() => {}));
      } else {
        const response = Response.json(statsFixture());
        vi.spyOn(response, 'json').mockReturnValue(new Promise(() => {}));
        // JSON parsing gets only the time remaining after the headers arrive.
        fetchMock.mockImplementation(() => new Promise((resolve) => {
          setTimeout(() => resolve(response), 6_000);
        }));
      }

      const onRejected = vi.fn();
      const result = getPublicStats();
      void result.catch(onRejected);

      await vi.advanceTimersByTimeAsync(9_999);
      expect(onRejected).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(onRejected).toHaveBeenCalledOnce();
      await expect(result).rejects.toThrow('Stats request timed out after 10 seconds.');
      expect(vi.getTimerCount()).toBe(0);
    });

    it('clears the deadline after success', async () => {
      const body = statsFixture();
      fetchMock.mockResolvedValue(Response.json(body));

      await expect(getPublicStats()).resolves.toEqual(body);
      expect(vi.getTimerCount()).toBe(0);
    });

    it.each(['network', 'HTTP', 'JSON', 'validation'])('clears the deadline after a %s failure', async (stage) => {
      if (stage === 'network') fetchMock.mockRejectedValue(new Error('Network unavailable'));
      else if (stage === 'HTTP') fetchMock.mockResolvedValue(new Response('', { status: 503 }));
      else if (stage === 'JSON') fetchMock.mockResolvedValue(new Response('not json'));
      else fetchMock.mockResolvedValue(Response.json(null));

      await expect(getPublicStats()).rejects.toThrow();
      expect(vi.getTimerCount()).toBe(0);
    });
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
