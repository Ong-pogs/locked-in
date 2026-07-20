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
 * Phases the claim audit trail accepts. Mirrors CLAIM_PHASES in
 * backend/src/modules/locks/routes.mjs — an unknown value is a 400, so this
 * union is the contract, not a hint.
 */
export type ClaimResultPhase = 'started' | 'signed' | 'submitted' | 'confirmed' | 'failed';

/** POST /v1/locks/:courseId/claim-result 200 body. `recorded: false` means the
 * server could not persist the attempt (DB outage) — never a client failure. */
export interface ClaimResultResponse {
  recorded: boolean;
}

/**
 * Claim audit trail. executeClaim runs entirely in the browser, so without this
 * the server never learns a user even TRIED to get their money out and "my
 * claim failed" is unanswerable.
 *
 * TELEMETRY ONLY — callers MUST fire-and-forget it. It must never gate, delay
 * or fail a claim: a rejected promise here means we lost a log line, not that
 * anything happened to the user's funds.
 */
export function reportClaimResult(
  courseId: string,
  body: { phase: ClaimResultPhase; signature?: string | null; errorMessage?: string | null },
  token: string,
): Promise<ClaimResultResponse> {
  return httpRequest<ClaimResultResponse>(`/v1/locks/${courseId}/claim-result`, {
    method: 'POST',
    body: {
      phase: body.phase,
      signature: body.signature ?? null,
      errorMessage: body.errorMessage ?? null,
    },
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
