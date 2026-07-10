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
}

interface ErrorPayload {
  message?: string;
  code?: string;
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
  const startedAt = Date.now();
  const isAbsolutePath = path.startsWith('http://') || path.startsWith('https://');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LESSON_API_TIMEOUT_MS);

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
          throw new ApiError(
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
              `[lesson-api] !! ${method} ${url} -> timeout after ${LESSON_API_TIMEOUT_MS}ms`,
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

export async function fetchWithAuth<T>(
  requestFn: (token: string) => Promise<T>,
): Promise<T> {
  const { authToken, refreshToken, setAuthSession } = useUserStore.getState();

  // If we have no access token, try a proactive refresh before giving up.
  let token = authToken;
  if (!token) {
    if (!refreshToken) throw new AuthExpiredError();
    try {
      const session = await doRefresh(refreshToken);
      setAuthSession(session.accessToken, session.refreshToken);
      token = session.accessToken;
    } catch {
      setAuthSession(null, null);
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
      try {
        const session = await doRefresh(currentRefreshToken);
        setAuthSession(session.accessToken, session.refreshToken);
        return await requestFn(session.accessToken);
      } catch {
        setAuthSession(null, null);
        throw new AuthExpiredError();
      }
    }
    throw err;
  }
}
