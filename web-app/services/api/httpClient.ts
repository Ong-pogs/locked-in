import {
  getLessonApiBaseUrl,
  getLessonApiFallbackBaseUrls,
  LESSON_API_TIMEOUT_MS,
  setLessonApiBaseUrl,
} from './config';
import { ApiError } from './errors';
import { refreshAuthSession } from './auth/authApi';
import { useUserStore } from '@/stores/userStore';

export class AuthExpiredError extends Error {
  constructor() {
    super('Authentication expired');
    this.name = 'AuthExpiredError';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  token?: string;
  signal?: AbortSignal;
  /** Override the default 15s abort timeout (long-running dev/admin calls). */
  timeoutMs?: number;
}

interface ErrorPayload {
  message?: string;
  code?: string;
}

/**
 * Transient-failure retry policy.
 *
 * WHY this exists: the daily lapse sweep is the sole judge of a miss. A lesson
 * submit lost to a Render cold start or a restart mid-POST is not a UI
 * annoyance — it becomes a judged miss the next morning, burning a shield or
 * triggering a lapse that forfeits 50-100% of that user's yield. Real money,
 * lost to an infra blip. A few hundred ms of backoff is the cheap side of that
 * trade.
 *
 * WHY only these statuses: 502/503/504 come from the edge (Render/Cloudflare)
 * when no healthy instance answered — strong evidence the request never
 * reached application code, so replaying it cannot double-apply. A 500 is the
 * opposite: the app ran and threw, so the write may well have landed; retrying
 * it would be a guess with someone's stake. 429 is retried because the server
 * is explicitly telling us when to come back.
 */
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 400;
const RETRY_MAX_DELAY_MS = 4_000;
/** Cap on an honoured Retry-After — a hostile/absurd value must not hang the UI. */
const RETRY_AFTER_CAP_MS = 10_000;

/**
 * POST paths that are safe to replay, and only these.
 *
 * A retry is safe when the server keys the write on a CLIENT-supplied id, so a
 * replay collapses onto the same row instead of creating a second one:
 *   - lessons/:id/start   — keyed by the client's attemptId
 *   - lessons/:id/check   — keyed by (attemptId, questionId); the first check
 *                           locks the answer and repeats return that same
 *                           verdict, so a replay cannot change a grade
 *   - lessons/:id/submit  — keyed by attemptId; a second submit is rejected
 *                           409 ATTEMPT_ALREADY_SUBMITTED, never double-graded
 *   - lessons/:id/recall-check — stateless verdict, writes nothing
 *   - courses/:id/voucher — signs a voucher from current progress; issuance is
 *                           not consumption (the chain enforces single use)
 *
 * Deliberately ABSENT, each for its own reason:
 *   - /v1/auth/refresh   — refresh tokens are strictly one-time-use. A replay
 *                          of a request the server actually processed burns
 *                          the token and signs the user out.
 *   - /v1/auth/verify, /privy-session, /challenge — session mints; a duplicate
 *                          is at best wasted, at worst confusing state.
 *   - /v1/faucet/claim   — drips tokens with no client-side idempotency key.
 *   - brewery feed/claim, shop/buy-saver — balance mutations with no key; a
 *                          replay can burn fuel twice or double-spend.
 *   - /v1/locks/:id/enroll — already has its own ladder (enrollLockWithRetry,
 *                          honouring 409 ENROLL_RETRY's retryAfterMs). Nesting
 *                          two backoffs would multiply the wait, not the
 *                          reliability.
 */
const RETRY_SAFE_POST_PATHS: readonly RegExp[] = [
  /^\/v1\/progress\/lessons\/[^/]+\/start$/,
  /^\/v1\/progress\/lessons\/[^/]+\/check$/,
  /^\/v1\/progress\/lessons\/[^/]+\/recall-check$/,
  /^\/v1\/progress\/lessons\/[^/]+\/submit$/,
  /^\/v1\/progress\/courses\/[^/]+\/voucher$/,
];

/**
 * Retry-After, carried out-of-band. ApiError's shape is shared with callers and
 * a transport-level hint has no business in it, so park it beside the error.
 */
const retryAfterMsByError = new WeakMap<ApiError, number>();

function parseRetryAfterMs(headerValue: string | null): number | null {
  if (!headerValue) return null;
  const seconds = Number(headerValue);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1_000, RETRY_AFTER_CAP_MS);
  }
  const date = Date.parse(headerValue);
  if (Number.isNaN(date)) return null;
  return Math.min(Math.max(date - Date.now(), 0), RETRY_AFTER_CAP_MS);
}

function isRetrySafeRequest(
  method: 'GET' | 'POST',
  path: string,
  isAbsolutePath: boolean,
): boolean {
  // GETs mutate nothing, wherever they point.
  if (method === 'GET') return true;
  // An absolute URL bypasses our route table — we cannot reason about whether
  // replaying it is safe, so we don't.
  if (isAbsolutePath) return false;
  const pathname = path.split('?')[0] ?? path;
  return RETRY_SAFE_POST_PATHS.some((pattern) => pattern.test(pathname));
}

/**
 * Backoff for this failure, or null when the error is not one we retry.
 * Exponential with equal jitter — the fixed half keeps a floor under the wait,
 * the random half stops every client in a cold-start thundering herd from
 * returning in lockstep.
 */
function retryDelayMs(error: unknown, attempt: number): number | null {
  if (!(error instanceof ApiError)) return null;

  // Timeouts are NOT retried: an abort means the server most likely IS still
  // working on the request, so a replay races the original rather than
  // replacing it. Only a hard transport failure (status 0) proves nothing
  // landed.
  const isRetryable =
    RETRYABLE_STATUSES.has(error.status) ||
    (error.status === 0 && error.code === 'NETWORK_ERROR');
  if (!isRetryable) return null;

  const serverHint = retryAfterMsByError.get(error);
  if (serverHint !== undefined) return serverHint;

  const ceiling = Math.min(RETRY_BASE_DELAY_MS * 2 ** attempt, RETRY_MAX_DELAY_MS);
  return ceiling / 2 + Math.random() * (ceiling / 2);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function joinPath(path: string, baseUrl: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }
  if (!baseUrl) {
    throw new Error('Missing NEXT_PUBLIC_API_URL');
  }
  return `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

export async function httpRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const method = options.method ?? 'GET';
  const isAbsolutePath = path.startsWith('http://') || path.startsWith('https://');
  const retrySafe = isRetrySafeRequest(method, path, isAbsolutePath);

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await sendOnce<T>(path, options, method, isAbsolutePath);
    } catch (error) {
      if (!retrySafe || attempt >= MAX_RETRY_ATTEMPTS) throw error;
      // A caller-initiated abort is a decision, not a failure to paper over.
      if (options.signal?.aborted) throw error;
      const delay = retryDelayMs(error, attempt);
      if (delay === null) throw error;
      if (process.env.NODE_ENV === 'development') {
        console.warn(
          `[lesson-api] retry ${attempt + 1}/${MAX_RETRY_ATTEMPTS} in ${Math.round(delay)}ms: ${method} ${path}`,
        );
      }
      await sleep(delay);
    }
  }
}

/**
 * One full attempt: walks the candidate hosts and either resolves or throws.
 * Each attempt gets its own abort timer so a retry is judged on its own
 * timeoutMs rather than inheriting a budget the first try already spent.
 */
async function sendOnce<T>(
  path: string,
  options: RequestOptions,
  method: 'GET' | 'POST',
  isAbsolutePath: boolean,
): Promise<T> {
  const startedAt = Date.now();

  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? LESSON_API_TIMEOUT_MS;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const headers: Record<string, string> = {
    Accept: 'application/json',
  };

  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }

  const primaryBaseUrl = getLessonApiBaseUrl();
  const candidateBaseUrls = isAbsolutePath
    ? ['']
    : [primaryBaseUrl, ...getLessonApiFallbackBaseUrls(primaryBaseUrl)];

  let lastError: unknown = null;

  try {
    for (let index = 0; index < candidateBaseUrls.length; index += 1) {
      const baseUrl = candidateBaseUrls[index] ?? '';
      const url = joinPath(path, baseUrl);
      const isLastCandidate = index === candidateBaseUrls.length - 1;

      if (process.env.NODE_ENV === 'development') {
        console.info(`[lesson-api] -> ${method} ${url}`);
      }

      try {
        const response = await fetch(url, {
          method,
          headers,
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
          signal: options.signal ?? controller.signal,
        });

        const text = await response.text();
        let data: unknown = null;
        if (text) {
          try {
            data = JSON.parse(text) as unknown;
          } catch {
            data = text;
          }
        }

        if (process.env.NODE_ENV === 'development') {
          console.info(
            `[lesson-api] <- ${response.status} ${method} ${url} (${Date.now() - startedAt}ms)`,
          );
        }

        if (!response.ok) {
          const errorPayload = (data ?? {}) as ErrorPayload;
          const apiError = new ApiError(
            errorPayload.message ??
              (typeof data === 'string' && data.trim().length > 0
                ? data
                : `Request failed with status ${response.status}`),
            response.status,
            errorPayload.code,
            // Full parsed body: contracts like ENROLL_RETRY carry extra
            // fields ({ retryable, retryAfterMs }) beyond message/code.
            data,
          );
          const retryAfter = parseRetryAfterMs(response.headers?.get('Retry-After') ?? null);
          if (retryAfter !== null) retryAfterMsByError.set(apiError, retryAfter);
          throw apiError;
        }

        if (!isAbsolutePath && baseUrl) {
          if (baseUrl !== primaryBaseUrl) {
            setLessonApiBaseUrl(baseUrl);
            if (process.env.NODE_ENV === 'development') {
              console.info(`[lesson-api] switched active baseUrl=${baseUrl}`);
            }
          }
        }

        return data as T;
      } catch (error) {
        lastError = error;

        if (error instanceof ApiError) {
          if (process.env.NODE_ENV === 'development') {
            console.warn(
              `[lesson-api] !! ${method} ${url} -> ${error.status} ${error.code ?? ''} ${error.message}`,
            );
          }
          throw error;
        }

        // Retry network failures across candidate hosts for reads and auth bootstrap.
        const isAuthBootstrapRequest =
          !isAbsolutePath &&
          method === 'POST' &&
          (path.startsWith('/v1/auth/challenge') || path.startsWith('/v1/auth/refresh'));
        const shouldTryNextHost =
          (method === 'GET' || isAuthBootstrapRequest) && !isLastCandidate;
        if (shouldTryNextHost) {
          if (process.env.NODE_ENV === 'development') {
            console.warn(`[lesson-api] retry host after network error: ${url}`);
          }
          continue;
        }

        if (error instanceof Error && error.name === 'AbortError') {
          if (process.env.NODE_ENV === 'development') {
            console.warn(
              `[lesson-api] !! ${method} ${url} -> timeout after ${timeoutMs}ms`,
            );
          }
          throw new ApiError('Request timed out', 408, 'REQUEST_TIMEOUT');
        }

        if (error instanceof Error) {
          const message = `Network request failed (${method} ${url}): ${error.message}`;
          if (process.env.NODE_ENV === 'development') {
            console.warn(`[lesson-api] !! ${message}`);
          }
          throw new ApiError(message, 0, 'NETWORK_ERROR');
        }

        throw new ApiError(
          `Network request failed (${method} ${url})`,
          0,
          'NETWORK_ERROR',
        );
      }
    }

    if (lastError instanceof ApiError) {
      throw lastError;
    }
    throw new ApiError('Network request failed', 0, 'NETWORK_ERROR');
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Execute an authenticated request with automatic token refresh on 401.
 *
 * 1. Reads the current authToken from userStore.
 * 2. Calls `requestFn(token)`.
 * 3. On 401 / TOKEN_EXPIRED, refreshes the session, updates the store, and retries once.
 * 4. Returns `null` when no token is available or refresh fails (lets callers handle gracefully).
 * 5. Re-throws non-auth errors so callers can display them.
 */
// Mutex for token refresh — prevents concurrent refresh calls
let refreshPromise: Promise<{ accessToken: string; refreshToken: string }> | null = null;

async function doRefresh(currentRefreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = refreshAuthSession({ refreshToken: currentRefreshToken }).finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

/**
 * Is this refresh failure proof the SESSION is dead, or just proof the CALL
 * failed? Only an auth-level rejection of the refresh token itself kills the
 * session. A 500 / timeout / offline blip must never discard a still-valid
 * 7-day refresh token — doing so forced a full re-login on every hiccup.
 */
function isSessionDead(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 401 || err.status === 403);
}

/**
 * Refresh, tolerating the one-time-use rotation race.
 *
 * Refresh tokens are strictly one-time-use server-side, and each browsing
 * context (PWA window, tabs) holds its own in-memory copy. When another
 * context rotates R1→R2 first, ours gets 401 REFRESH_TOKEN_REUSED — but the
 * store already holds the winner's R2. Retry with it instead of wiping, which
 * would have signed this context out AND clobbered the valid token in shared
 * storage.
 *
 * Throws on genuine failure; the caller decides whether to wipe via
 * isSessionDead().
 */
async function refreshWithRotationRecovery(
  attemptedToken: string,
): Promise<{ accessToken: string; refreshToken: string }> {
  try {
    return await doRefresh(attemptedToken);
  } catch (err) {
    const latest = useUserStore.getState().refreshToken;
    if (isSessionDead(err) && latest && latest !== attemptedToken) {
      // Another context rotated while we were in flight — use the winner's.
      return doRefresh(latest);
    }
    throw err;
  }
}

export async function fetchWithAuth<T>(
  requestFn: (token: string) => Promise<T>,
): Promise<T> {
  const { authToken, refreshToken, setAuthSession } = useUserStore.getState();

  // If we have no access token, try a proactive refresh before giving up.
  let token = authToken;
  if (!token) {
    if (!refreshToken) throw new AuthExpiredError();
    try {
      const session = await refreshWithRotationRecovery(refreshToken);
      setAuthSession(session.accessToken, session.refreshToken);
      token = session.accessToken;
    } catch (err) {
      // Only a genuine auth rejection kills the session (see isSessionDead).
      if (isSessionDead(err)) setAuthSession(null, null);
      throw new AuthExpiredError();
    }
  }

  try {
    return await requestFn(token);
  } catch (err) {
    // Only intercept auth errors; anything else bubbles up.
    if (
      err instanceof ApiError &&
      (err.status === 401 || err.code === 'TOKEN_EXPIRED')
    ) {
      const currentRefreshToken = useUserStore.getState().refreshToken;
      if (!currentRefreshToken) throw new AuthExpiredError();
      // Only a REFRESH failure means the session is truly dead.
      let session: { accessToken: string; refreshToken: string };
      try {
        session = await refreshWithRotationRecovery(currentRefreshToken);
        setAuthSession(session.accessToken, session.refreshToken);
      } catch (err) {
        // A transient refresh failure must not discard a valid session.
        if (isSessionDead(err)) setAuthSession(null, null);
        throw new AuthExpiredError();
      }
      // Retry with the fresh token. A NON-auth failure here (e.g. 409
      // ENROLL_RETRY on a post-deposit enroll, a 500, a network blip) must
      // NOT destroy the now-valid session — bubble it up so the caller's own
      // retry/error handling runs. Only a second 401 kills the session.
      try {
        return await requestFn(session.accessToken);
      } catch (retryErr) {
        if (
          retryErr instanceof ApiError &&
          (retryErr.status === 401 || retryErr.code === 'TOKEN_EXPIRED')
        ) {
          setAuthSession(null, null);
          throw new AuthExpiredError();
        }
        throw retryErr;
      }
    }
    throw err;
  }
}
