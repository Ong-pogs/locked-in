import type { ProgressSubmitLessonResponse } from '@/services/api/types';

/**
 * Build the /lessons/[id]/result query params from a graded submit response.
 *
 * `practice` (practice-mode ruling R10) rides along with score/total/accepted
 * so the results view can render the "Practice — streak, shields and rewards
 * unchanged" notice; it is always present ('true'/'false') for remote submits
 * and simply absent for local scoring (read as false).
 */
export function buildLessonResultParams(
  result: ProgressSubmitLessonResponse,
): URLSearchParams {
  const params = new URLSearchParams({
    score: String(result.score),
    total: String(result.totalQuestions),
    accepted: String(result.accepted),
    practice: String(Boolean(result.practiceMode)),
  });
  if (result.courseRuntime?.fuelAwarded) {
    params.set('fuel', String(result.courseRuntime.fuelAwarded));
    params.set('fuelTotal', String(result.courseRuntime.fuelCounter ?? 0));
  }
  if (result.xp?.xpAwarded) {
    params.set('xp', String(result.xp.xpAwarded));
    params.set('xpTotal', String(result.xp.xpTotal));
    params.set('xpLevel', String(result.xp.xpLevel));
  }
  return params;
}
