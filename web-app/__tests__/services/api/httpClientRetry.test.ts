import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Bounded retry on transient upstream failures (money-path resilience).
//
// The daily lapse sweep is the sole miss judge: a lesson submit lost to a
// Render cold start / restart becomes a judged miss the next morning — a
// burned shield, or a lapse forfeiting 50-100% of that user's yield. A 502
// from the edge must therefore cost a few hundred ms of backoff, not a day of
// someone's stake.
//
// The counterweight is double-apply: only requests the server keys by a
// client-supplied id (or that mutate nothing) may be replayed.

vi.mock('@/services/api/config', () => ({
  getLessonApiBaseUrl: () => 'https://api.test.com',
  getLessonApiFallbackBaseUrls: () => [],
  LESSON_API_TIMEOUT_MS: 15000,
  setLessonApiBaseUrl: vi.fn(),
  hasRemoteLessonApi: () => true,
}));

vi.mock('@/services/api/auth/authApi', () => ({
  refreshAuthSession: vi.fn(),
}));

vi.mock('@/stores/userStore', () => ({
  useUserStore: {
    getState: () => ({
      authToken: 'test-access',
      refreshToken: 'test-refresh',
      setAuthSession: vi.fn(),
    }),
  },
}));

const SUBMIT_PATH = '/v1/progress/lessons/lesson-1/submit';

function res(status: number, body: unknown, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response;
}

describe('httpRequest — transient-failure retry', () => {
  let httpRequest: typeof import('@/services/api/httpClient').httpRequest;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn());
    ({ httpRequest } = await import('@/services/api/httpClient'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** Drive a call to completion while fake timers swallow the backoff sleeps. */
  async function settle<T>(promise: Promise<T>): Promise<T> {
    const tracked = promise.then(
      (value) => ({ ok: true as const, value }),
      (error) => ({ ok: false as const, error }),
    );
    for (let i = 0; i < 12; i += 1) {
      await vi.advanceTimersByTimeAsync(30_000);
    }
    const outcome = await tracked;
    if (!outcome.ok) throw outcome.error;
    return outcome.value;
  }

  it('retries a 503 on lesson submit and returns the eventual success', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(res(503, 'service unavailable'))
      .mockResolvedValueOnce(res(200, { scorePercent: 100 }));

    const result = await settle(
      httpRequest(SUBMIT_PATH, {
        method: 'POST',
        body: { attemptId: 'attempt-1' },
        token: 't',
      }),
    );

    expect(result).toEqual({ scorePercent: 100 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('retries 502 and 504 too, then gives up with the last ApiError', async () => {
    vi.mocked(fetch).mockResolvedValue(res(502, { message: 'bad gateway' }));

    await expect(
      settle(httpRequest(SUBMIT_PATH, { method: 'POST', body: { attemptId: 'a' } })),
    ).rejects.toMatchObject({ status: 502 });

    // Bounded: the original attempt plus a fixed number of retries, never a loop.
    expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(1);
    expect(vi.mocked(fetch).mock.calls.length).toBeLessThanOrEqual(4);
  });

  it('retries a network failure on a replay-safe POST', async () => {
    vi.mocked(fetch)
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(res(200, { ok: true }));

    const result = await settle(
      httpRequest(SUBMIT_PATH, { method: 'POST', body: { attemptId: 'a' } }),
    );

    expect(result).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('honours Retry-After on a 429', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(res(429, { message: 'slow down' }, { 'retry-after': '2' }))
      .mockResolvedValueOnce(res(200, { ok: true }));

    await settle(httpRequest('/v1/progress/enrollments', { token: 't' }));

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('retries GETs', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(res(503, ''))
      .mockResolvedValueOnce(res(200, { data: 1 }));

    const result = await settle(httpRequest('/v1/progress/enrollments', { token: 't' }));

    expect(result).toEqual({ data: 1 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('never retries a 4xx that is not 429', async () => {
    vi.mocked(fetch).mockResolvedValue(res(409, { code: 'ATTEMPT_ALREADY_SUBMITTED' }));

    await expect(
      settle(httpRequest(SUBMIT_PATH, { method: 'POST', body: { attemptId: 'a' } })),
    ).rejects.toMatchObject({ status: 409 });

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('never retries a 500 — an application error, not a transient edge failure', async () => {
    vi.mocked(fetch).mockResolvedValue(res(500, { message: 'boom' }));

    await expect(
      settle(httpRequest(SUBMIT_PATH, { method: 'POST', body: { attemptId: 'a' } })),
    ).rejects.toMatchObject({ status: 500 });

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  describe('replay safety — POSTs that must never be repeated', () => {
    const unsafe: Array<[string, string]> = [
      ['auth refresh (one-time-use token)', '/v1/auth/refresh'],
      ['faucet claim (drips real tokens)', '/v1/faucet/claim'],
      ['brewery claim (moves yield)', '/v1/progress/brewery/claim'],
      ['brewery feed (burns fuel)', '/v1/progress/brewery/feed'],
      ['streak saver purchase (spends tokens)', '/v1/progress/shop/buy-saver'],
      ['lock enroll (has its own retry ladder)', '/v1/locks/course-1/enroll'],
    ];

    it.each(unsafe)('does not retry %s', async (_label, path) => {
      vi.mocked(fetch).mockResolvedValue(res(503, { message: 'cold start' }));

      await expect(
        settle(httpRequest(path, { method: 'POST', body: {} })),
      ).rejects.toMatchObject({ status: 503 });

      expect(fetch).toHaveBeenCalledTimes(1);
    });
  });

  it('stops retrying when the caller aborts', async () => {
    const controller = new AbortController();
    vi.mocked(fetch).mockImplementation(async () => {
      controller.abort();
      return res(503, '');
    });

    await expect(
      settle(
        httpRequest(SUBMIT_PATH, {
          method: 'POST',
          body: { attemptId: 'a' },
          signal: controller.signal,
        }),
      ),
    ).rejects.toMatchObject({ status: 503 });

    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
