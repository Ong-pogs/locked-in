import { describe, it, expect, vi, beforeEach } from 'vitest';

// Keep the store/auth chain out of these unit tests — every enroll call is
// injected, so the default fetchWithAuth path never executes.
vi.mock('@/services/api/httpClient', () => ({
  httpRequest: vi.fn(),
  fetchWithAuth: vi.fn(),
}));

import { ApiError } from '@/services/api/errors';
import {
  PENDING_ENROLL_PREFIX,
  pendingEnrollKey,
  parsePendingEnrollRecord,
  writePendingEnroll,
  clearPendingEnroll,
  readPendingEnrolls,
  classifyEnrollError,
  enrollLockWithRetry,
  retryPendingEnrolls,
  ENROLL_RETRY_LADDER_MS,
} from '@/services/enroll/pendingEnroll';
import type { EnrollLockResponse } from '@/services/api/types';

const RECORD = {
  lockAddress: 'Lock111',
  walletAddress: 'Wallet111',
  attemptedAt: '2026-07-10T00:00:00.000Z',
};

const ENROLLED: EnrollLockResponse = {
  enrolled: true,
  courseId: 'course-1',
  lockAddress: 'Lock111',
  principalUi: '25',
  status: 'ACTIVE',
  freshEnrollment: true,
  engineReset: true,
};

const enrollRetryError = (retryAfterMs?: number) =>
  new ApiError('retry', 409, 'ENROLL_RETRY', {
    retryable: true,
    ...(retryAfterMs != null ? { retryAfterMs } : {}),
  });

describe('pendingEnroll storage', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('uses the ruled localStorage key shape', () => {
    expect(pendingEnrollKey('course-1')).toBe('locked-in-pending-enroll:course-1');
  });

  it('write → read → clear roundtrip', () => {
    writePendingEnroll('course-1', RECORD);

    expect(readPendingEnrolls()).toEqual([{ courseId: 'course-1', record: RECORD }]);

    clearPendingEnroll('course-1');
    expect(readPendingEnrolls()).toEqual([]);
  });

  it('parse rejects malformed JSON and incomplete records', () => {
    expect(parsePendingEnrollRecord(null)).toBeNull();
    expect(parsePendingEnrollRecord('not json')).toBeNull();
    expect(parsePendingEnrollRecord('{}')).toBeNull();
    expect(
      parsePendingEnrollRecord(JSON.stringify({ lockAddress: 'Lock111' })),
    ).toBeNull();
  });

  it('parse fills a missing attemptedAt instead of rejecting', () => {
    const parsed = parsePendingEnrollRecord(
      JSON.stringify({ lockAddress: 'Lock111', walletAddress: 'Wallet111' }),
    );
    expect(parsed?.lockAddress).toBe('Lock111');
    expect(typeof parsed?.attemptedAt).toBe('string');
  });

  it('readPendingEnrolls only scans prefixed keys and skips corrupt values', () => {
    window.localStorage.setItem('unrelated-key', 'x');
    window.localStorage.setItem(`${PENDING_ENROLL_PREFIX}bad`, 'not json');
    writePendingEnroll('course-2', RECORD);

    expect(readPendingEnrolls()).toEqual([{ courseId: 'course-2', record: RECORD }]);
  });
});

describe('classifyEnrollError', () => {
  it('ENROLL_RETRY is retryable and carries retryAfterMs', () => {
    expect(classifyEnrollError(enrollRetryError(4000))).toEqual({
      kind: 'retryable',
      retryAfterMs: 4000,
    });
    expect(classifyEnrollError(enrollRetryError())).toEqual({
      kind: 'retryable',
      retryAfterMs: null,
    });
  });

  it('403/404 are terminal (server ruled the course — R13 "until 200 or 403")', () => {
    expect(classifyEnrollError(new ApiError('done', 403, 'COURSE_COMPLETED'))).toEqual({
      kind: 'terminal',
    });
    expect(classifyEnrollError(new ApiError('nope', 403, 'COURSE_NOT_LOCKABLE'))).toEqual({
      kind: 'terminal',
    });
    expect(classifyEnrollError(new ApiError('gone', 404, 'COURSE_NOT_FOUND'))).toEqual({
      kind: 'terminal',
    });
  });

  it('everything else is transient (kept pending for later heal)', () => {
    expect(
      classifyEnrollError(new ApiError('skew', 409, 'LOCK_ADDRESS_MISMATCH')),
    ).toEqual({ kind: 'transient' });
    expect(classifyEnrollError(new ApiError('down', 503, 'DB_UNAVAILABLE'))).toEqual({
      kind: 'transient',
    });
    expect(classifyEnrollError(new ApiError('net', 0, 'NETWORK_ERROR'))).toEqual({
      kind: 'transient',
    });
    expect(classifyEnrollError(new Error('boom'))).toEqual({ kind: 'transient' });
  });
});

describe('enrollLockWithRetry', () => {
  it('returns enrolled on first success without sleeping', async () => {
    const enroll = vi.fn().mockResolvedValue(ENROLLED);
    const sleep = vi.fn().mockResolvedValue(undefined);

    const outcome = await enrollLockWithRetry('course-1', 'Lock111', { enroll, sleep });

    expect(outcome).toEqual({ status: 'enrolled', response: ENROLLED });
    expect(enroll).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('waits the server retryAfterMs between ENROLL_RETRY attempts', async () => {
    const enroll = vi
      .fn()
      .mockRejectedValueOnce(enrollRetryError(4000))
      .mockRejectedValueOnce(enrollRetryError(4000))
      .mockResolvedValueOnce(ENROLLED);
    const sleep = vi.fn().mockResolvedValue(undefined);

    const outcome = await enrollLockWithRetry('course-1', 'Lock111', { enroll, sleep });

    expect(outcome.status).toBe('enrolled');
    expect(enroll).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[4000], [4000]]);
  });

  it('falls back to the 2s/5s/10s ladder when the body has no retryAfterMs', async () => {
    const enroll = vi.fn().mockRejectedValue(enrollRetryError());
    const sleep = vi.fn().mockResolvedValue(undefined);

    const outcome = await enrollLockWithRetry('course-1', 'Lock111', { enroll, sleep });

    // initial attempt + 3 retries, then give up as pending
    expect(outcome.status).toBe('pending');
    expect(enroll).toHaveBeenCalledTimes(4);
    expect(sleep.mock.calls).toEqual([
      [ENROLL_RETRY_LADDER_MS[0]],
      [ENROLL_RETRY_LADDER_MS[1]],
      [ENROLL_RETRY_LADDER_MS[2]],
    ]);
  });

  it('stops immediately on terminal refusals — no retries', async () => {
    const error = new ApiError('done', 403, 'COURSE_COMPLETED');
    const enroll = vi.fn().mockRejectedValue(error);
    const sleep = vi.fn().mockResolvedValue(undefined);

    const outcome = await enrollLockWithRetry('course-1', 'Lock111', { enroll, sleep });

    expect(outcome).toEqual({ status: 'terminal', error });
    expect(enroll).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('resolves pending (never throws) on transient failures like network errors', async () => {
    const error = new ApiError('net', 0, 'NETWORK_ERROR');
    const enroll = vi.fn().mockRejectedValue(error);

    const outcome = await enrollLockWithRetry('course-1', 'Lock111', { enroll });

    expect(outcome).toEqual({ status: 'pending', error });
    expect(enroll).toHaveBeenCalledTimes(1);
  });
});

describe('retryPendingEnrolls', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('clears the record on success', async () => {
    writePendingEnroll('course-1', RECORD);
    const enroll = vi.fn().mockResolvedValue(ENROLLED);

    await retryPendingEnrolls('Wallet111', { enroll });

    expect(enroll).toHaveBeenCalledWith('course-1', 'Lock111');
    expect(readPendingEnrolls()).toEqual([]);
  });

  it('clears the record on terminal 403 (server ruled — nothing retryable)', async () => {
    writePendingEnroll('course-1', RECORD);
    const enroll = vi.fn().mockRejectedValue(new ApiError('done', 403, 'COURSE_COMPLETED'));

    await retryPendingEnrolls('Wallet111', { enroll });

    expect(readPendingEnrolls()).toEqual([]);
  });

  it('keeps the record on retryable/transient failures for the next mount', async () => {
    writePendingEnroll('course-1', RECORD);
    const enroll = vi.fn().mockRejectedValue(enrollRetryError(4000));

    await retryPendingEnrolls('Wallet111', { enroll });

    expect(readPendingEnrolls()).toEqual([{ courseId: 'course-1', record: RECORD }]);
  });

  it('skips records owned by a different wallet', async () => {
    writePendingEnroll('course-1', { ...RECORD, walletAddress: 'OtherWallet' });
    const enroll = vi.fn().mockResolvedValue(ENROLLED);

    await retryPendingEnrolls('Wallet111', { enroll });

    expect(enroll).not.toHaveBeenCalled();
    expect(readPendingEnrolls()).toHaveLength(1);
  });

  it('does nothing without a wallet address', async () => {
    writePendingEnroll('course-1', RECORD);
    const enroll = vi.fn();

    await retryPendingEnrolls(null, { enroll });

    expect(enroll).not.toHaveBeenCalled();
    expect(readPendingEnrolls()).toHaveLength(1);
  });
});
