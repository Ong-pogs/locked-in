import { describe, it, expect } from 'vitest';
import { buildLessonResultParams } from '@/services/lessons/resultParams';
import type { ProgressSubmitLessonResponse } from '@/services/api/types';

const baseResult: ProgressSubmitLessonResponse = {
  lessonId: 'lesson-1',
  attemptId: 'attempt-1',
  accepted: true,
  score: 80,
  totalQuestions: 5,
  correctAnswers: 4,
  completedAt: '2026-07-10T00:00:00Z',
};

describe('buildLessonResultParams', () => {
  it('always carries score, total, accepted', () => {
    const params = buildLessonResultParams(baseResult);

    expect(params.get('score')).toBe('80');
    expect(params.get('total')).toBe('5');
    expect(params.get('accepted')).toBe('true');
  });

  it('passes practice=true when the submit response says practiceMode (ruling R10)', () => {
    const params = buildLessonResultParams({ ...baseResult, practiceMode: true });

    expect(params.get('practice')).toBe('true');
  });

  it('passes practice=false when practiceMode is false or absent', () => {
    expect(
      buildLessonResultParams({ ...baseResult, practiceMode: false }).get('practice'),
    ).toBe('false');
    // Older backends omit the field entirely — must read as NOT practice.
    expect(buildLessonResultParams(baseResult).get('practice')).toBe('false');
  });

  it('includes fuel params only when fuel was awarded', () => {
    expect(buildLessonResultParams(baseResult).get('fuel')).toBeNull();

    const params = buildLessonResultParams({
      ...baseResult,
      courseRuntime: { fuelAwarded: 1, fuelCounter: 3 } as never,
    });
    expect(params.get('fuel')).toBe('1');
    expect(params.get('fuelTotal')).toBe('3');
  });

  it('includes xp params only when xp was awarded', () => {
    expect(buildLessonResultParams(baseResult).get('xp')).toBeNull();

    const params = buildLessonResultParams({
      ...baseResult,
      xp: { xpAwarded: 50, xpTotal: 150, xpLevel: 2 },
    });
    expect(params.get('xp')).toBe('50');
    expect(params.get('xpTotal')).toBe('150');
    expect(params.get('xpLevel')).toBe('2');
  });
});
