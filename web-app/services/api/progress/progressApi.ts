import { httpRequest } from '../httpClient';
import type {
  BreweryStateResponse,
  BreweryFeedResponse,
  BreweryClaimResponse,
  BuyStreakSaverResponse,
  CompletionVoucherResponse,
  CourseRuntimeSnapshot,
  LockPositionResponse,
  XpSnapshot,
  CommunityPotHistoryResponse,
  LeaderboardResponse,
  CommunityPotWindowDetailResponse,
  ProgressStartLessonRequest,
  ProgressStartLessonResponse,
  ProgressSubmitLessonRequest,
  ProgressSubmitLessonResponse,
  RuntimeHistoryResponse,
  UnlockReceiptHistoryResponse,
  YieldHistoryResponse,
  UserEnrollmentsResponse,
} from '../types';

export function startLesson(
  lessonId: string,
  payload: ProgressStartLessonRequest,
  token: string,
): Promise<ProgressStartLessonResponse> {
  return httpRequest<ProgressStartLessonResponse>(
    `/v1/progress/lessons/${lessonId}/start`,
    {
    method: 'POST',
    body: payload,
    token,
    },
  );
}

// DEV-ONLY (devnet gate on the server): force-complete a course at 100% to test
// the claim flow. Returns 404 off devnet. REMOVE before mainnet.
export function devCompleteCourse(
  courseId: string,
  token: string,
): Promise<{ courseId: string; lessonsCompleted: number }> {
  return httpRequest<{ courseId: string; lessonsCompleted: number }>(
    '/v1/progress/dev/complete-course',
    // 8 lessons of grading in one request — give it well past the 15s default.
    { method: 'POST', body: { courseId }, token, timeoutMs: 120_000 },
  );
}

export interface QuestionCheckResponse {
  questionId: string;
  /** True when a prior check already locked this question (verdict is the original one). */
  locked: boolean;
  lockedAnswerText: string;
  isCorrect: boolean;
  questionScore: number;
  correctAnswer: string | null;
}

// Instant per-question feedback. The FIRST check locks the answer server-side
// for this attempt — the submit will grade the locked answer regardless of
// what is sent later, so the reveal can't be gamed.
export function checkLessonQuestion(
  lessonId: string,
  payload: { attemptId: string; questionId: string; answerText: string },
  token: string,
): Promise<QuestionCheckResponse> {
  return httpRequest<QuestionCheckResponse>(
    `/v1/progress/lessons/${lessonId}/check`,
    { method: 'POST', body: payload, token },
  );
}

// Stateless recall verdict — no attempt, nothing locked. Only answers for
// lessons the caller already completed (server 403s otherwise).
export function checkRecallQuestion(
  lessonId: string,
  payload: { questionId: string; answerText: string },
  token: string,
): Promise<{ questionId: string; isCorrect: boolean; correctAnswer: string }> {
  return httpRequest(
    `/v1/progress/lessons/${lessonId}/recall-check`,
    { method: 'POST', body: payload, token },
  );
}

export function submitLesson(
  lessonId: string,
  payload: ProgressSubmitLessonRequest,
  token: string,
): Promise<ProgressSubmitLessonResponse> {
  return httpRequest<ProgressSubmitLessonResponse>(
    `/v1/progress/lessons/${lessonId}/submit`,
    {
      method: 'POST',
      body: payload,
      token,
    },
  );
}

/* ── Brewery (fire-timer model) ─────────────────────────────────────── */

export function getBreweryState(
  courseId: string,
  token: string,
): Promise<BreweryStateResponse> {
  const query = new URLSearchParams({ courseId });
  return httpRequest<BreweryStateResponse>(
    `/v1/progress/brewery?${query.toString()}`,
    { token },
  );
}

export function feedFire(
  courseId: string,
  token: string,
): Promise<BreweryFeedResponse> {
  return httpRequest<BreweryFeedResponse>('/v1/progress/brewery/feed', {
    method: 'POST',
    body: { courseId },
    token,
  });
}

export function claimYield(
  courseId: string,
  token: string,
): Promise<BreweryClaimResponse> {
  return httpRequest<BreweryClaimResponse>('/v1/progress/brewery/claim', {
    method: 'POST',
    body: { courseId },
    token,
  });
}

export function buyStreakSaver(
  courseId: string,
  token: string,
): Promise<BuyStreakSaverResponse> {
  return httpRequest<BuyStreakSaverResponse>('/v1/progress/shop/buy-saver', {
    method: 'POST',
    body: { courseId },
    token,
  });
}

export function getUserXp(token: string): Promise<XpSnapshot> {
  return httpRequest<XpSnapshot>('/v1/progress/xp', { token });
}

/** Fetch all enrolled courses + runtime + lesson progress for the authenticated user */
export function getUserEnrollments(
  token: string,
): Promise<UserEnrollmentsResponse> {
  return httpRequest<UserEnrollmentsResponse>('/v1/progress/enrollments', { token });
}

/** Live lock position — the card's headline value + CLAIM arming status. */
export function getLockPosition(
  courseId: string,
  token: string,
): Promise<LockPositionResponse> {
  return httpRequest<LockPositionResponse>(`/v1/locks/${courseId}/position`, { token });
}

/** Request a signed completion voucher (403 until every lesson is complete). */
export function getCompletionVoucher(
  courseId: string,
  token: string,
): Promise<CompletionVoucherResponse> {
  return httpRequest<CompletionVoucherResponse>(
    `/v1/progress/courses/${courseId}/voucher`,
    { method: 'POST', token },
  );
}

export function getCourseRuntime(
  courseId: string,
  token: string,
): Promise<CourseRuntimeSnapshot> {
  return httpRequest<CourseRuntimeSnapshot>(
    `/v1/progress/runtime/courses/${courseId}`,
    {
      token,
    },
  );
}

export function getCourseRuntimeHistory(
  courseId: string,
  token: string,
): Promise<RuntimeHistoryResponse> {
  return httpRequest<RuntimeHistoryResponse>(
    `/v1/progress/runtime/courses/${courseId}/history`,
    {
      token,
    },
  );
}

export function getCommunityPotHistory(token: string): Promise<CommunityPotHistoryResponse> {
  return httpRequest<CommunityPotHistoryResponse>('/v1/progress/community-pot/history', {
    token,
  });
}

export function getCommunityPotWindowDetail(
  windowId: number,
  token: string,
): Promise<CommunityPotWindowDetailResponse> {
  return httpRequest<CommunityPotWindowDetailResponse>(
    `/v1/progress/community-pot/windows/${windowId}`,
    { token },
  );
}

export function getLeaderboard(
  token: string,
  options?: { page?: number; pageSize?: number },
): Promise<LeaderboardResponse> {
  const query = new URLSearchParams();
  if (options?.page) {
    query.set('page', String(options.page));
  }
  if (options?.pageSize) {
    query.set('pageSize', String(options.pageSize));
  }
  const suffix = query.size > 0 ? `?${query.toString()}` : '';

  return httpRequest<LeaderboardResponse>(`/v1/progress/leaderboard${suffix}`, {
    token,
  });
}

export function getYieldHistory(
  courseId: string,
  token: string,
): Promise<YieldHistoryResponse> {
  return httpRequest<YieldHistoryResponse>(`/v1/progress/yield/courses/${courseId}/history`, {
    token,
  });
}

export function getUnlockReceipts(token: string): Promise<UnlockReceiptHistoryResponse> {
  return httpRequest<UnlockReceiptHistoryResponse>('/v1/progress/unlocks', {
    token,
  });
}
