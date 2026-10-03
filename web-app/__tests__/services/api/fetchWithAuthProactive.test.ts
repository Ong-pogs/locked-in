import { describe, it, expect, beforeEach, vi } from 'vitest';

// Access tokens live 15 minutes. fetchWithAuth used to send the stored token
// regardless, so the first request after a break was rejected (401), then the
// session refreshed, then the request was sent again: three trips to an API
// an ocean away. It now reads the token's own expiry (the JWT payload is
// readable without any secret) and refreshes first when it has run out.

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

const store = {
  authToken: null as string | null,
  refreshToken: 'refresh-1' as string | null,
  setAuthSession: vi.fn((a: string | null, r: string | null) => {
    store.authToken = a;
    store.refreshToken = r;
  }),
};

vi.mock('@/stores/userStore', () => ({
  useUserStore: { getState: () => store },
}));

/** A JWT-shaped token whose payload carries `exp` (seconds). Signature is irrelevant client-side. */
function jwt(expSecondsFromNow: number): string {
  const b64 = (o: object) =>
    btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  const now = Math.floor(Date.now() / 1000);
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'w', iat: now, exp: now + expSecondsFromNow })}.sig`;
}

describe('fetchWithAuth: refresh an expired access token before the request', () => {
  let fetchWithAuth: typeof import('@/services/api/httpClient').fetchWithAuth;

  beforeEach(async () => {
    vi.resetModules();
    refreshAuthSession.mockReset();
    store.refreshToken = 'refresh-1';
    store.setAuthSession.mockClear();
    ({ fetchWithAuth } = await import('@/services/api/httpClient'));
  });

  it('refreshes first when the stored token has expired, then sends one request', async () => {
    store.authToken = jwt(-60);
    const fresh = jwt(900);
    refreshAuthSession.mockResolvedValue({ accessToken: fresh, refreshToken: 'refresh-2' });
    const requestFn = vi.fn().mockResolvedValue('board');

    await expect(fetchWithAuth(requestFn)).resolves.toBe('board');
    expect(refreshAuthSession).toHaveBeenCalledTimes(1);
    expect(requestFn).toHaveBeenCalledTimes(1);
    expect(requestFn).toHaveBeenCalledWith(fresh);
  });

  it('also refreshes a token that expires within the next few seconds', async () => {
    store.authToken = jwt(5);
    refreshAuthSession.mockResolvedValue({ accessToken: jwt(900), refreshToken: 'refresh-2' });
    const requestFn = vi.fn().mockResolvedValue('ok');

    await fetchWithAuth(requestFn);
    expect(refreshAuthSession).toHaveBeenCalledTimes(1);
    expect(requestFn).toHaveBeenCalledTimes(1);
  });

  it('does not refresh a token with plenty of time left', async () => {
    const live = jwt(600);
    store.authToken = live;
    const requestFn = vi.fn().mockResolvedValue('ok');

    await fetchWithAuth(requestFn);
    expect(refreshAuthSession).not.toHaveBeenCalled();
    expect(requestFn).toHaveBeenCalledWith(live);
  });

  it('sends tokens it cannot read as-is (old behaviour)', async () => {
    store.authToken = 'not-a-jwt';
    const requestFn = vi.fn().mockResolvedValue('ok');

    await fetchWithAuth(requestFn);
    expect(refreshAuthSession).not.toHaveBeenCalled();
    expect(requestFn).toHaveBeenCalledWith('not-a-jwt');
  });

  it('falls back to the stored token when the early refresh fails transiently', async () => {
    const { ApiError } = await import('@/services/api/errors');
    const stale = jwt(-60);
    store.authToken = stale;
    refreshAuthSession.mockRejectedValue(new ApiError('boom', 500, 'SERVER_ERROR'));
    const requestFn = vi.fn().mockResolvedValue('ok');

    await expect(fetchWithAuth(requestFn)).resolves.toBe('ok');
    expect(requestFn).toHaveBeenCalledWith(stale);
    expect(store.setAuthSession).not.toHaveBeenCalledWith(null, null);
  });

  it('stops refreshing early when the device clock makes fresh tokens look expired', async () => {
    // Clock far ahead: even a just-issued token reads as expired.
    store.authToken = jwt(-60);
    refreshAuthSession.mockResolvedValue({ accessToken: jwt(-30), refreshToken: 'refresh-2' });
    const requestFn = vi.fn().mockResolvedValue('ok');

    await fetchWithAuth(requestFn);
    await fetchWithAuth(requestFn);
    await fetchWithAuth(requestFn);
    // One early refresh detected the skew; later calls send the token as-is.
    expect(refreshAuthSession).toHaveBeenCalledTimes(1);
    expect(requestFn).toHaveBeenCalledTimes(3);
  });
});
