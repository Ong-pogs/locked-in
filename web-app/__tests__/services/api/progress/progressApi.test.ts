import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/services/api/httpClient', () => ({
  httpRequest: vi.fn(),
}));

import { httpRequest } from '@/services/api/httpClient';
import {
  startLesson,
  submitLesson,
  getLeaderboard,
  getCourseRuntime,
  getUserXp,
  getUserEnrollments,
} from '@/services/api/progress/progressApi';

describe('progressApi', () => {
  beforeEach(() => {
    vi.mocked(httpRequest).mockReset();
  });

  describe('startLesson', () => {
    it('sends POST with attemptId to /v1/progress/lessons/:id/start', async () => {
      const mockResponse = {
        lessonId: 'lesson-1',
        attemptId: 'attempt-abc',
        startedAt: '2024-01-01T00:00:00Z',
      };
      vi.mocked(httpRequest).mockResolvedValueOnce(mockResponse);

      const result = await startLesson(
        'lesson-1',
        { attemptId: 'attempt-abc' },
        'auth-token',
      );

      expect(httpRequest).toHaveBeenCalledWith(
        '/v1/progress/lessons/lesson-1/start',
        {
          method: 'POST',
          body: { attemptId: 'attempt-abc' },
          token: 'auth-token',
        },
      );
      expect(result).toEqual(mockResponse);
    });
  });

  describe('submitLesson', () => {
    it('sends POST with answers array to /v1/progress/lessons/:id/submit', async () => {
      const mockResponse = {
        lessonId: 'lesson-1',
        attemptId: 'attempt-abc',
        accepted: true,
        score: 80,
        totalQuestions: 5,
        correctAnswers: 4,
        completedAt: '2024-01-01T00:05:00Z',
      };
      vi.mocked(httpRequest).mockResolvedValueOnce(mockResponse);

      const answers = [
        { questionId: 'q1', answerText: 'A' },
        { questionId: 'q2', answerText: 'B' },
      ];

      const result = await submitLesson(
        'lesson-1',
        { attemptId: 'attempt-abc', answers },
        'auth-token',
      );

      expect(httpRequest).toHaveBeenCalledWith(
        '/v1/progress/lessons/lesson-1/submit',
        {
          method: 'POST',
          body: { attemptId: 'attempt-abc', answers },
          token: 'auth-token',
        },
      );
      expect(result.accepted).toBe(true);
      expect(result.score).toBe(80);
    });
  });


  describe('getLeaderboard', () => {
    it('appends correct query params for page and pageSize', async () => {
      const mockResponse = {
        source: 'materialized',
        snapshotAt: null,
        page: 2,
        pageSize: 20,
        totalEntries: 100,
        totalPages: 5,
        currentPotSizeUi: '500',
        nextDistributionWindowLabel: null,
        currentUser: null,
        entries: [],
      };
      vi.mocked(httpRequest).mockResolvedValueOnce(mockResponse);

      await getLeaderboard('auth-token', { page: 2, pageSize: 20 });

      expect(httpRequest).toHaveBeenCalledWith(
        '/v1/progress/leaderboard?page=2&pageSize=20',
        { token: 'auth-token' },
      );
    });

    it('no query params when options not provided', async () => {
      vi.mocked(httpRequest).mockResolvedValueOnce({
        entries: [],
        page: 1,
        pageSize: 50,
        totalEntries: 0,
        totalPages: 0,
        source: 'materialized',
        snapshotAt: null,
        currentPotSizeUi: '0',
        nextDistributionWindowLabel: null,
        currentUser: null,
      });

      await getLeaderboard('auth-token');

      expect(httpRequest).toHaveBeenCalledWith(
        '/v1/progress/leaderboard',
        { token: 'auth-token' },
      );
    });
  });

  describe('getCourseRuntime', () => {
    it('hits GET /v1/progress/runtime/courses/:courseId with token', async () => {
      const mockRuntime = {
        courseId: 'course-1',
        currentStreak: 5,
        longestStreak: 10,
      };
      vi.mocked(httpRequest).mockResolvedValueOnce(mockRuntime);

      const result = await getCourseRuntime('course-1', 'auth-token');

      expect(httpRequest).toHaveBeenCalledWith(
        '/v1/progress/runtime/courses/course-1',
        { token: 'auth-token' },
      );
      expect(result.currentStreak).toBe(5);
    });
  });

  describe('getUserXp', () => {
    it('hits GET /v1/progress/xp with token', async () => {
      const mockXp = { xpTotal: 1500, xpLevel: 3 };
      vi.mocked(httpRequest).mockResolvedValueOnce(mockXp);

      const result = await getUserXp('auth-token');

      expect(httpRequest).toHaveBeenCalledWith('/v1/progress/xp', { token: 'auth-token' });
      expect(result.xpTotal).toBe(1500);
    });
  });

  describe('getUserEnrollments', () => {
    it('hits GET /v1/progress/enrollments with token', async () => {
      const mockResponse = {
        enrollments: [{ courseId: 'course-1', enrolledAt: '2024-01-01', runtime: null }],
        lessonProgress: [],
      };
      vi.mocked(httpRequest).mockResolvedValueOnce(mockResponse);

      const result = await getUserEnrollments('auth-token');

      expect(httpRequest).toHaveBeenCalledWith('/v1/progress/enrollments', { token: 'auth-token' });
      expect(result.enrollments).toHaveLength(1);
    });
  });
});
