import { ApiError } from '@/services/api/errors';
import { fetchWithAuth } from '@/services/api/httpClient';
import { enrollLock, getEnrollRetryDetails } from '@/services/api/locks/locksApi';
import type { EnrollLockResponse } from '@/services/api/types';

// Pending-enroll queue (backend round-2 ruling R13): when the server-side
// enroll fails after a successful on-chain deposit, the deposit flow persists
// a pending-enroll record and continues — funds are safe on-chain, and the
// backend also heals lazily via GET /v1/locks/:courseId/position (R14).
// DashboardV2 mounts retryPendingEnrolls() so every dashboard visit retries
// until the server accepts (200) or terminally refuses (403/404).

export interface PendingEnrollRecord {
  lockAddress: string;
  walletAddress: string;
  attemptedAt: string; // ISO timestamp of the failed enroll attempt
}

export interface PendingEnrollEntry {
  courseId: string;
  record: PendingEnrollRecord;
}

export const PENDING_ENROLL_PREFIX = 'locked-in-pending-enroll:';

export function pendingEnrollKey(courseId: string): string {
  return `${PENDING_ENROLL_PREFIX}${courseId}`;
}

export function parsePendingEnrollRecord(
  raw: string | null,
): PendingEnrollRecord | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<PendingEnrollRecord> | null;
    if (
      typeof value?.lockAddress === 'string' &&
      value.lockAddress.length > 0 &&
      typeof value?.walletAddress === 'string' &&
      value.walletAddress.length > 0
    ) {
      return {
        lockAddress: value.lockAddress,
        walletAddress: value.walletAddress,
        attemptedAt:
          typeof value.attemptedAt === 'string'
            ? value.attemptedAt
            : new Date(0).toISOString(),
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function writePendingEnroll(
  courseId: string,
  record: PendingEnrollRecord,
): void {
  try {
    window.localStorage.setItem(pendingEnrollKey(courseId), JSON.stringify(record));
  } catch {
    // Storage full/blocked — the R14 server lazy heal still covers this lock.
  }
}

export function clearPendingEnroll(courseId: string): void {
  try {
    window.localStorage.removeItem(pendingEnrollKey(courseId));
  } catch {
    // ignore
  }
}

export function readPendingEnrolls(): PendingEnrollEntry[] {
  const entries: PendingEnrollEntry[] = [];
  try {
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (!key || !key.startsWith(PENDING_ENROLL_PREFIX)) continue;
      const courseId = key.slice(PENDING_ENROLL_PREFIX.length);
      const record = parsePendingEnrollRecord(window.localStorage.getItem(key));
      if (courseId && record) entries.push({ courseId, record });
    }
  } catch {
    // storage unavailable — nothing to retry
  }
  return entries;
}

/**
 * Classify an enroll failure:
 * - 'retryable' — 409 ENROLL_RETRY (RPC propagation lag, ruling R6); retry
 *   after `retryAfterMs`, falling back to the R13 2s/5s/10s ladder.
 * - 'terminal'  — 403/404 (COURSE_COMPLETED / COURSE_NOT_LOCKABLE /
 *   COURSE_NOT_FOUND): the server judged the course; retrying cannot change
 *   it, so any pending record is cleared (R13: "until 200 or 403").
 * - 'transient' — everything else (network, 5xx, LOCK_ADDRESS_MISMATCH
 *   config skew, auth expiry): keep the pending record for a later mount;
 *   the R14 server lazy heal also covers it.
 */
export type EnrollFailureClass =
  | { kind: 'retryable'; retryAfterMs: number | null }
  | { kind: 'terminal' }
  | { kind: 'transient' };

export function classifyEnrollError(error: unknown): EnrollFailureClass {
  const retry = getEnrollRetryDetails(error);
  if (retry) return { kind: 'retryable', retryAfterMs: retry.retryAfterMs };
  if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
    return { kind: 'terminal' };
  }
  return { kind: 'transient' };
}

export interface EnrollAttemptOutcome {
  status: 'enrolled' | 'terminal' | 'pending';
  response?: EnrollLockResponse;
  error?: unknown;
}

// R13 fallback ladder when the ENROLL_RETRY body carries no retryAfterMs.
export const ENROLL_RETRY_LADDER_MS = [2_000, 5_000, 10_000] as const;

type EnrollFn = (courseId: string, lockAddress: string) => Promise<EnrollLockResponse>;

function defaultEnroll(courseId: string, lockAddress: string): Promise<EnrollLockResponse> {
  return fetchWithAuth((token) => enrollLock(courseId, lockAddress, token));
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Enroll with the R13 retry policy: on 409 ENROLL_RETRY, wait the server's
 * retryAfterMs (else the 2s/5s/10s ladder) and retry, up to `maxRetries`
 * additional attempts. Terminal refusals (403/404) stop immediately; anything
 * else (network, config skew) resolves to 'pending' — the caller persists a
 * pending-enroll record and moves on. Never throws.
 */
export async function enrollLockWithRetry(
  courseId: string,
  lockAddress: string,
  options: {
    maxRetries?: number;
    enroll?: EnrollFn;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<EnrollAttemptOutcome> {
  const { maxRetries = 3, enroll = defaultEnroll, sleep = defaultSleep } = options;
  let retriesUsed = 0;
  for (;;) {
    try {
      const response = await enroll(courseId, lockAddress);
      return { status: 'enrolled', response };
    } catch (error) {
      const failure = classifyEnrollError(error);
      if (failure.kind === 'terminal') return { status: 'terminal', error };
      if (failure.kind === 'retryable' && retriesUsed < maxRetries) {
        const waitMs =
          failure.retryAfterMs ??
          ENROLL_RETRY_LADDER_MS[
            Math.min(retriesUsed, ENROLL_RETRY_LADDER_MS.length - 1)
          ];
        retriesUsed += 1;
        await sleep(waitMs);
        continue;
      }
      return { status: 'pending', error };
    }
  }
}

let retryInFlight = false;

/**
 * Retry every pending-enroll record owned by the current wallet — one attempt
 * per record per call (DashboardV2 mounts this). Clears on success and on
 * terminal 403/404; keeps the record otherwise so the next mount retries.
 */
export async function retryPendingEnrolls(
  currentWalletAddress: string | null,
  options: { enroll?: EnrollFn } = {},
): Promise<void> {
  if (typeof window === 'undefined' || !currentWalletAddress) return;
  if (retryInFlight) return;
  retryInFlight = true;
  const { enroll = defaultEnroll } = options;
  try {
    for (const { courseId, record } of readPendingEnrolls()) {
      // Records written by another wallet stay put for that wallet's session
      // (the auth token is wallet-bound; the server would 409 the PDA anyway).
      if (record.walletAddress !== currentWalletAddress) continue;
      try {
        await enroll(courseId, record.lockAddress);
        clearPendingEnroll(courseId);
      } catch (error) {
        if (classifyEnrollError(error).kind === 'terminal') {
          clearPendingEnroll(courseId);
        }
        // retryable/transient: keep the record; retried on the next mount.
      }
    }
  } finally {
    retryInFlight = false;
  }
}
