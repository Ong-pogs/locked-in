import { httpRequest } from '../httpClient';
import type {
  CourseRuntimeSnapshot,
  CourseProgressSnapshot,
  CommunityPotHistoryResponse,
  LeaderboardResponse,
  CommunityPotWindowDetailResponse,
  ModuleProgressSnapshot,
  ProgressStartLessonRequest,
  ProgressStartLessonResponse,
  ProgressSubmitLessonRequest,
  ProgressSubmitLessonResponse,
  RuntimeHistoryResponse,
  UnlockReceiptHistoryResponse,
  UnlockReceiptPayload,
  UnlockReceiptRecord,
  YieldHistoryResponse,
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

export function getCourseProgress(
  courseId: string,
  token: string,
): Promise<CourseProgressSnapshot> {
  return httpRequest<CourseProgressSnapshot>(`/v1/progress/courses/${courseId}`, {
    token,
  });
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

export function getModuleProgress(
  moduleId: string,
  token: string,
): Promise<ModuleProgressSnapshot> {
  return httpRequest<ModuleProgressSnapshot>(`/v1/progress/modules/${moduleId}`, {
    token,
  });
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

export function createUnlockReceipt(
  payload: UnlockReceiptPayload,
  token: string,
): Promise<UnlockReceiptRecord> {
  return httpRequest<UnlockReceiptRecord>('/v1/progress/unlocks', {
    method: 'POST',
    body: payload,
    token,
  });
}
