import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/services/api/httpClient', () => ({
  httpRequest: vi.fn(),
}));

import { httpRequest } from '@/services/api/httpClient';
import {
  getLockEligibility,
  enrollLock,
  getEnrollRetryDetails,
} from '@/services/api/locks/locksApi';
import { ApiError } from '@/services/api/errors';

describe('locksApi', () => {
  beforeEach(() => {
    vi.mocked(httpRequest).mockReset();
  });

  describe('getLockEligibility', () => {
    it('GETs /v1/locks/:courseId/eligibility with the token', async () => {
      vi.mocked(httpRequest).mockResolvedValueOnce({ eligible: true });

      const result = await getLockEligibility('course-1', 'auth-token');

      expect(httpRequest).toHaveBeenCalledWith('/v1/locks/course-1/eligibility', {
        token: 'auth-token',
      });
      expect(result).toEqual({ eligible: true });
    });

    it('returns the ineligible body untouched (code drives the copy)', async () => {
      vi.mocked(httpRequest).mockResolvedValueOnce({
        eligible: false,
        code: 'COURSE_COMPLETED',
      });

      const result = await getLockEligibility('course-1', 'auth-token');

      expect(result).toEqual({ eligible: false, code: 'COURSE_COMPLETED' });
    });
  });

  describe('enrollLock', () => {
    it('POSTs { lockAddress } to /v1/locks/:courseId/enroll', async () => {
      const response = {
        enrolled: true,
        courseId: 'course-1',
        lockAddress: 'Lock111',
        principalUi: '25',
        status: 'ACTIVE',
        freshEnrollment: true,
        engineReset: true,
      };
      vi.mocked(httpRequest).mockResolvedValueOnce(response);

      const result = await enrollLock('course-1', 'Lock111', 'auth-token');

      expect(httpRequest).toHaveBeenCalledWith('/v1/locks/course-1/enroll', {
        method: 'POST',
        body: { lockAddress: 'Lock111' },
        token: 'auth-token',
      });
      expect(result).toEqual(response);
    });

    it('propagates API errors (409 ENROLL_RETRY reaches the caller)', async () => {
      const error = new ApiError('retry', 409, 'ENROLL_RETRY', {
        retryable: true,
        retryAfterMs: 4000,
      });
      vi.mocked(httpRequest).mockRejectedValueOnce(error);

      await expect(enrollLock('course-1', 'Lock111', 'auth-token')).rejects.toBe(error);
    });
  });

  describe('getEnrollRetryDetails', () => {
    it('extracts retryable + retryAfterMs from an ENROLL_RETRY error body', () => {
      const error = new ApiError('retry', 409, 'ENROLL_RETRY', {
        retryable: true,
        retryAfterMs: 4000,
      });

      expect(getEnrollRetryDetails(error)).toEqual({
        retryable: true,
        retryAfterMs: 4000,
      });
    });

    it('returns retryAfterMs null when the body lacks a usable value', () => {
      expect(
        getEnrollRetryDetails(new ApiError('retry', 409, 'ENROLL_RETRY')),
      ).toEqual({ retryable: true, retryAfterMs: null });
      expect(
        getEnrollRetryDetails(
          new ApiError('retry', 409, 'ENROLL_RETRY', { retryAfterMs: -1 }),
        ),
      ).toEqual({ retryable: true, retryAfterMs: null });
      expect(
        getEnrollRetryDetails(
          new ApiError('retry', 409, 'ENROLL_RETRY', { retryAfterMs: 'soon' }),
        ),
      ).toEqual({ retryable: true, retryAfterMs: null });
    });

    it('returns null for non-ENROLL_RETRY errors', () => {
      expect(
        getEnrollRetryDetails(new ApiError('mismatch', 409, 'LOCK_ADDRESS_MISMATCH')),
      ).toBeNull();
      expect(getEnrollRetryDetails(new ApiError('nope', 403, 'COURSE_COMPLETED'))).toBeNull();
      expect(getEnrollRetryDetails(new Error('network'))).toBeNull();
      expect(getEnrollRetryDetails(null)).toBeNull();
    });
  });
});
