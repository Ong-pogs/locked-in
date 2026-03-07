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

export function getLeaderboard(token: string): Promise<LeaderboardResponse> {
  return httpRequest<LeaderboardResponse>('/v1/progress/leaderboard', {
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
