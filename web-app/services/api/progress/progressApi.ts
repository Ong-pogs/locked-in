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
