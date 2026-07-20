import { describe, it, expect, beforeEach, vi } from 'vitest';
// NOTE: ApiError is imported per-test AFTER vi.resetModules() — a top-level
// import would be a different class identity than the one httpClient sees,
// so `err instanceof ApiError` inside the client would silently never match.
type ApiErrorClass = typeof import('@/services/api/errors').ApiError;

// Session survival across refresh failures (bughunt finding).
//
// The old code treated EVERY doRefresh rejection as session death and wiped
// both tokens, which zustand persist writes straight to localStorage. Two
// real consequences:
//   1. A transient 500/timeout on /v1/auth/refresh discarded a still-valid
//      7-day refresh token and forced a full Privy re-login.
//   2. Refresh tokens are strictly one-time-use server-side. With two open
//      contexts (PWA window + tab), tab A rotates R1→R2; tab B still holds
//      R1 in memory, gets REFRESH_TOKEN_REUSED, and — before this fix —
//      wiped tab A's freshly persisted R2 as collateral damage.

const refreshAuthSession = vi.fn();

vi.mock('@/services/api/config', () => ({
  getLessonApiBaseUrl: () => 'https://api.test.com',
  getLessonApiFallbackBaseUrls: () => [],
  LESSON_API_TIMEOUT_MS: 15000,
  setLessonApiBaseUrl: vi.fn(),
  hasRemoteLessonApi: () => true,
}));

vi.mock('@/services/api/auth/authApi', () => ({
  refreshAuthSession: (...args: unknown[]) => refreshAuthSession(...args),
}));

// Mutable fake store so tests can simulate another tab rotating the token.
const store = {
  authToken: 'access-1' as string | null,
  refreshToken: 'refresh-1' as string | null,
  setAuthSession: vi.fn((a: string | null, r: string | null) => {
    store.authToken = a;
    store.refreshToken = r;
  }),
};

vi.mock('@/stores/userStore', () => ({
  useUserStore: { getState: () => store },
}));

describe('fetchWithAuth — session survives non-auth refresh failures', () => {
  let fetchWithAuth: typeof import('@/services/api/httpClient').fetchWithAuth;
  let ApiError: ApiErrorClass;

  beforeEach(async () => {
    vi.resetModules();
    refreshAuthSession.mockReset();
    store.authToken = 'access-1';
    store.refreshToken = 'refresh-1';
    store.setAuthSession.mockClear();
    ({ ApiError } = await import('@/services/api/errors'));
    ({ fetchWithAuth } = await import('@/services/api/httpClient'));
  });

  const expired = () => new ApiError('expired', 401, 'TOKEN_EXPIRED');

  it('keeps the session when the refresh call fails with a 500', async () => {
    refreshAuthSession.mockRejectedValue(new ApiError('boom', 500, 'SERVER_ERROR'));
    const requestFn = vi.fn().mockRejectedValue(expired());

    await expect(fetchWithAuth(requestFn)).rejects.toThrow();
    // The refresh token is still good — it must NOT be wiped.
    expect(store.setAuthSession).not.toHaveBeenCalledWith(null, null);
    expect(store.refreshToken).toBe('refresh-1');
  });

  it('keeps the session when the refresh call times out / network-fails', async () => {
    refreshAuthSession.mockRejectedValue(new ApiError('timeout', 408, 'TIMEOUT'));
    const requestFn = vi.fn().mockRejectedValue(expired());

    await expect(fetchWithAuth(requestFn)).rejects.toThrow();
    expect(store.setAuthSession).not.toHaveBeenCalledWith(null, null);
    expect(store.refreshToken).toBe('refresh-1');
  });

  it('retries with the token another tab rotated in, instead of wiping it', async () => {
    // This tab holds refresh-1 in memory; another tab already rotated to
    // refresh-2 and persisted it. Our refresh-1 call loses the race.
    refreshAuthSession.mockImplementation(async ({ refreshToken }: { refreshToken: string }) => {
      if (refreshToken === 'refresh-1') {
        // Simulate the other tab's rotation landing in shared storage.
        store.authToken = 'access-2';
        store.refreshToken = 'refresh-2';
        throw new ApiError('reused', 401, 'REFRESH_TOKEN_REUSED');
      }
      return { accessToken: 'access-3', refreshToken: 'refresh-3' };
    });
    const requestFn = vi
      .fn()
      .mockRejectedValueOnce(expired())
      .mockResolvedValue('ok');

    await expect(fetchWithAuth(requestFn)).resolves.toBe('ok');
    expect(store.setAuthSession).not.toHaveBeenCalledWith(null, null);
  });

  it('still kills the session when the refresh token is genuinely rejected', async () => {
    refreshAuthSession.mockRejectedValue(new ApiError('nope', 401, 'INVALID_REFRESH_TOKEN'));
    const requestFn = vi.fn().mockRejectedValue(expired());

    await expect(fetchWithAuth(requestFn)).rejects.toThrow();
    expect(store.setAuthSession).toHaveBeenCalledWith(null, null);
  });
});
