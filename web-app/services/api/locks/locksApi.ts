import { httpRequest } from '../httpClient';
import { ApiError } from '../errors';
import type {
  EnrollLockResponse,
  EnrollRetryErrorDetails,
  LockEligibilityResponse,
} from '../types';

// Client for the enroll-on-deposit endpoints ruled in
// docs/superpowers/rulings/2026-07-10-backend-round2-rulings.md (R12/R13).

/**
 * R12 eligibility pre-gate. DepositV2 MUST call this before building any
 * transaction and fail closed: only `{ eligible: true }` unblocks the deposit
 * — a thrown error (network, 5xx, timeout) blocks it too.
 */
export function getLockEligibility(
  courseId: string,
  token: string,
): Promise<LockEligibilityResponse> {
  return httpRequest<LockEligibilityResponse>(
    `/v1/locks/${courseId}/eligibility`,
    { token },
  );
}

/**
 * R13 enroll-on-deposit. Called after executeDeposit resolves (fresh success
 * AND alreadyLocked). The lockAddress is only a config-skew tripwire server
 * side (R4) — acceptance is decided from server-derived on-chain data.
 */
export function enrollLock(
  courseId: string,
  lockAddress: string,
  token: string,
): Promise<EnrollLockResponse> {
  return httpRequest<EnrollLockResponse>(`/v1/locks/${courseId}/enroll`, {
    method: 'POST',
    body: { lockAddress },
    token,
  });
}

/**
 * Extract the `{ retryable, retryAfterMs }` body of a 409 ENROLL_RETRY error
 * (ruling R6). Returns null for any other error. `retryAfterMs` is null when
 * the body did not carry a usable value — callers fall back to the R13
 * 2s/5s/10s ladder.
 */
export function getEnrollRetryDetails(
  error: unknown,
): { retryable: boolean; retryAfterMs: number | null } | null {
  if (!(error instanceof ApiError) || error.code !== 'ENROLL_RETRY') {
    return null;
  }
  const details = (error.details ?? null) as Partial<EnrollRetryErrorDetails> | null;
  const retryAfterMs =
    typeof details?.retryAfterMs === 'number' &&
    Number.isFinite(details.retryAfterMs) &&
    details.retryAfterMs > 0
      ? details.retryAfterMs
      : null;
  return { retryable: details?.retryable !== false, retryAfterMs };
}
