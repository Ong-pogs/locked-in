import { describe, it, expect } from 'vitest';
import { useCourseStore } from '@/stores/courseStore';

// Live-prod finding: /lessons/<unknown-id> rendered "This page couldn't load"
// with React error #185 (Maximum update depth exceeded) instead of the page's
// graceful "Lesson not found" branch.
//
// Cause: these getters are consumed as Zustand selectors
// (useCourseStore((s) => s.getLessonsForCourse(id))). `?? []` allocated a NEW
// array on every call for a missing key, so useSyncExternalStore saw a changed
// snapshot every render and looped forever. Selector returns for the
// not-found case must be referentially stable.

describe('courseStore selector identity for missing keys', () => {
  it('getLessonsForCourse returns the SAME empty array across calls', () => {
    const s = useCourseStore.getState();
    const a = s.getLessonsForCourse('no-such-course');
    const b = s.getLessonsForCourse('no-such-course');
    expect(a).toHaveLength(0);
    expect(a).toBe(b); // reference equality — not just deep equality
  });

  it('getModulesForCourse returns the SAME empty array across calls', () => {
    const s = useCourseStore.getState();
    const a = s.getModulesForCourse('no-such-course');
    const b = s.getModulesForCourse('no-such-course');
    expect(a).toHaveLength(0);
    expect(a).toBe(b);
  });

  it('is stable for the empty-string courseId the lesson page passes when the lesson is unknown', () => {
    // app/lessons/[id]/page.tsx does getLessonsForCourse(lesson?.courseId ?? '')
    const s = useCourseStore.getState();
    expect(s.getLessonsForCourse('')).toBe(s.getLessonsForCourse(''));
  });
});
