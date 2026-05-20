import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useCourseStore } from '@/stores/courseStore';
import { DEFAULT_COURSE_STATE } from '@/types/courseState';
import { buildCourse } from '../fixtures/courses';

// Mock external dependencies that courseStore imports
vi.mock('@/services/api', () => ({
  getCourseRuntime: vi.fn(),
  hasRemoteLessonApi: vi.fn(() => false),
}));

vi.mock('@/services/api/progress/progressApi', () => ({
  convertFuel: vi.fn(),
}));

vi.mock('@/services/solana', () => ({
  batchCheckLockAccounts: vi.fn().mockResolvedValue(new Map()),
}));

vi.mock('@/services/repositories', () => ({
  loadHydratedContentSnapshot: vi.fn(),
}));

describe('courseStore', () => {
  beforeEach(() => {
    useCourseStore.getState().reset();
  });

  describe('enrollCourse', () => {
    it('adds courseId to enrolledCourseIds', () => {
      useCourseStore.getState().enrollCourse('course-1');

      const state = useCourseStore.getState();
      expect(state.enrolledCourseIds).toContain('course-1');
    });

    it('does not duplicate if already enrolled', () => {
      useCourseStore.getState().enrollCourse('course-1');
      useCourseStore.getState().enrollCourse('course-1');

      const state = useCourseStore.getState();
      expect(state.enrolledCourseIds.filter((id) => id === 'course-1')).toHaveLength(1);
    });

    it('initializes courseState for the enrolled course', () => {
      useCourseStore.getState().enrollCourse('course-1');

      const state = useCourseStore.getState();
      expect(state.courseStates['course-1']).toBeDefined();
      expect(state.courseStates['course-1'].currentStreak).toBe(0);
    });

    it('auto-selects as active if no active course', () => {
      useCourseStore.getState().enrollCourse('course-1');

      expect(useCourseStore.getState().activeCourseId).toBe('course-1');
    });

    it('does not change activeCourseId if one is already set', () => {
      useCourseStore.getState().enrollCourse('course-1');
      useCourseStore.getState().enrollCourse('course-2');

      expect(useCourseStore.getState().activeCourseId).toBe('course-1');
    });
  });

  describe('unenrollCourse', () => {
    it('removes courseId from enrolledCourseIds', () => {
      useCourseStore.getState().enrollCourse('course-1');
      useCourseStore.getState().unenrollCourse('course-1');

      expect(useCourseStore.getState().enrolledCourseIds).not.toContain('course-1');
    });

    it('clears activeCourseId when the active course is unenrolled', () => {
      useCourseStore.getState().enrollCourse('course-1');
      useCourseStore.getState().unenrollCourse('course-1');

      expect(useCourseStore.getState().activeCourseId).toBeNull();
    });

    it('switches to next course when the active is unenrolled', () => {
      useCourseStore.getState().enrollCourse('course-1');
      useCourseStore.getState().enrollCourse('course-2');
      useCourseStore.getState().setActiveCourse('course-1');
      useCourseStore.getState().unenrollCourse('course-1');

      expect(useCourseStore.getState().activeCourseId).toBe('course-2');
    });
  });

  describe('activateCourse', () => {
    it('sets the active course and its lock data', () => {
      useCourseStore.getState().activateCourse('course-1', {
        amount: 50,
        duration: 30,
        lockAccountAddress: 'LockABC123',
        stableMintAddress: 'USDCMint123',
        skrAmount: 10,
      });

      const state = useCourseStore.getState();
      expect(state.activeCourseId).toBe('course-1');
      expect(state.courseStates['course-1'].lockAmount).toBe(50);
      expect(state.courseStates['course-1'].lockDuration).toBe(30);
      expect(state.courseStates['course-1'].lockAccountAddress).toBe('LockABC123');
      expect(state.courseStates['course-1'].stableMintAddress).toBe('USDCMint123');
      expect(state.courseStates['course-1'].skrLockedAmount).toBe(10);
    });

    it('adds to enrolledCourseIds if not already enrolled', () => {
      useCourseStore.getState().activateCourse('course-1', {
        amount: 50,
        duration: 30,
      });

      expect(useCourseStore.getState().enrolledCourseIds).toContain('course-1');
    });

    it('adds to activeCourseIds', () => {
      useCourseStore.getState().activateCourse('course-1', {
        amount: 50,
        duration: 30,
      });

      expect(useCourseStore.getState().activeCourseIds).toContain('course-1');
    });
  });

  describe('completeLesson', () => {
    beforeEach(() => {
      const course = buildCourse({ id: 'course-1', completedLessons: 0 });
      useCourseStore.setState({ courses: [course] });
    });

    it('increments completedLessons in the course state', () => {
      useCourseStore.getState().completeLesson('lesson-1', 'course-1', 100);

      const courses = useCourseStore.getState().courses;
      expect(courses[0].completedLessons).toBe(1);
    });

    it('records lesson progress', () => {
      useCourseStore.getState().completeLesson('lesson-1', 'course-1', 80);

      const progress = useCourseStore.getState().lessonProgress['lesson-1'];
      expect(progress).toBeDefined();
      expect(progress.completed).toBe(true);
      expect(progress.score).toBe(80);
      expect(progress.courseId).toBe('course-1');
    });

    it('is idempotent - calling twice for same lesson does not double-count', () => {
      useCourseStore.getState().completeLesson('lesson-1', 'course-1', 80);
      useCourseStore.getState().completeLesson('lesson-1', 'course-1', 80);

      const courses = useCourseStore.getState().courses;
      expect(courses[0].completedLessons).toBe(1);
    });

    it('updates score if higher on repeated call', () => {
      useCourseStore.getState().completeLesson('lesson-1', 'course-1', 60);
      useCourseStore.getState().completeLesson('lesson-1', 'course-1', 90);

      const progress = useCourseStore.getState().lessonProgress['lesson-1'];
      expect(progress.score).toBe(90);
    });

    it('does not downgrade score on repeated call', () => {
      useCourseStore.getState().completeLesson('lesson-1', 'course-1', 90);
      useCourseStore.getState().completeLesson('lesson-1', 'course-1', 60);

      const progress = useCourseStore.getState().lessonProgress['lesson-1'];
      expect(progress.score).toBe(90);
    });
  });

  describe('completeDayForCourse', () => {
    beforeEach(() => {
      useCourseStore.getState().activateCourse('course-1', {
        amount: 50,
        duration: 30,
      });
    });

    it('increments streak and updates flame state', () => {
      useCourseStore.getState().completeDayForCourse('course-1');

      const state = useCourseStore.getState().courseStates['course-1'];
      expect(state.currentStreak).toBe(1);
      expect(state.flameState).toBe('LIT');
      expect(state.todayCompleted).toBe(true);
    });

    it('transitions to BURNING at streak 3', () => {
      // Manually set streak to 2 so completing day pushes to 3
      useCourseStore.setState({
        courseStates: {
          'course-1': {
            ...DEFAULT_COURSE_STATE,
            currentStreak: 2,
            lastCompletedDate: '2024-01-01', // Different from today
          },
        },
      });

      useCourseStore.getState().completeDayForCourse('course-1');

      const state = useCourseStore.getState().courseStates['course-1'];
      expect(state.currentStreak).toBe(3);
      expect(state.flameState).toBe('BURNING');
    });

    it('is idempotent within same day', () => {
      useCourseStore.getState().completeDayForCourse('course-1');
      useCourseStore.getState().completeDayForCourse('course-1');

      const state = useCourseStore.getState().courseStates['course-1'];
      expect(state.currentStreak).toBe(1);
    });

    it('updates longestStreak when surpassing previous', () => {
      useCourseStore.setState({
        courseStates: {
          'course-1': {
            ...DEFAULT_COURSE_STATE,
            currentStreak: 5,
            longestStreak: 3,
            lastCompletedDate: '2024-01-01',
          },
        },
      });

      useCourseStore.getState().completeDayForCourse('course-1');

      const state = useCourseStore.getState().courseStates['course-1'];
      expect(state.longestStreak).toBe(6);
    });

    it('clears saverRecoveryMode on completion', () => {
      useCourseStore.setState({
        courseStates: {
          'course-1': {
            ...DEFAULT_COURSE_STATE,
            saverRecoveryMode: true,
            lastCompletedDate: '2024-01-01',
          },
        },
      });

      useCourseStore.getState().completeDayForCourse('course-1');

      const state = useCourseStore.getState().courseStates['course-1'];
      expect(state.saverRecoveryMode).toBe(false);
    });
  });

  describe('useSaverForCourse', () => {
    beforeEach(() => {
      useCourseStore.setState({
        courseStates: {
          'course-1': {
            ...DEFAULT_COURSE_STATE,
            saverCount: 0,
          },
        },
      });
    });

    it('increments saverCount and returns true', () => {
      const result = useCourseStore.getState().useSaverForCourse('course-1');

      expect(result).toBe(true);
      expect(useCourseStore.getState().courseStates['course-1'].saverCount).toBe(1);
    });

    it('sets saverRecoveryMode to true', () => {
      useCourseStore.getState().useSaverForCourse('course-1');

      expect(useCourseStore.getState().courseStates['course-1'].saverRecoveryMode).toBe(true);
    });

    it('returns false when saverCount is already at max (3)', () => {
      useCourseStore.setState({
        courseStates: {
          'course-1': {
            ...DEFAULT_COURSE_STATE,
            saverCount: 3,
          },
        },
      });

      const result = useCourseStore.getState().useSaverForCourse('course-1');
      expect(result).toBe(false);
    });

    it('does not increment beyond 3', () => {
      useCourseStore.setState({
        courseStates: {
          'course-1': {
            ...DEFAULT_COURSE_STATE,
            saverCount: 3,
          },
        },
      });

      useCourseStore.getState().useSaverForCourse('course-1');
      expect(useCourseStore.getState().courseStates['course-1'].saverCount).toBe(3);
    });
  });

  describe('syncLockSnapshot', () => {
    it('merges on-chain data into course state', () => {
      useCourseStore.setState({
        courseStates: {
          'course-1': {
            ...DEFAULT_COURSE_STATE,
            currentStreak: 5, // should be preserved
          },
        },
      });

      useCourseStore.getState().syncLockSnapshot('course-1', {
        lockAccountAddress: 'OnChainLock123',
        principalAmountUi: '100',
        skrLockedAmountUi: '50',
        lockStartDate: '2024-01-01T00:00:00Z',
        lockEndDate: '2024-02-01T00:00:00Z',
        gauntletComplete: true,
        gauntletDay: 7,
        fuelCounter: 3,
        fuelCap: 7,
        saverRecoveryMode: false,
        currentYieldRedirectBps: 1000,
        extensionDays: 2,
        ichorCounter: 500,
        ichorLifetimeTotal: 1000,
        conversionBps: 9000,
        conversionRateLabel: '0.90 USDC',
        unlockEligible: false,
        status: 1,
      });

      const state = useCourseStore.getState().courseStates['course-1'];
      expect(state.lockAccountAddress).toBe('OnChainLock123');
      expect(state.lockStartDate).toBe('2024-01-01T00:00:00Z');
      expect(state.fuelCounter).toBe(3);
      expect(state.fuelCap).toBe(7);
      expect(state.ichorBalance).toBe(500);
      expect(state.totalIchorProduced).toBe(1000);
      expect(state.extensionDays).toBe(2);
      expect(state.currentYieldRedirectBps).toBe(1000);
      // currentStreak preserved from existing state
      expect(state.currentStreak).toBe(5);
    });
  });

  describe('reset', () => {
    it('returns to initial state', () => {
      useCourseStore.getState().enrollCourse('course-1');
      useCourseStore.getState().activateCourse('course-2', {
        amount: 100,
        duration: 60,
      });

      useCourseStore.getState().reset();

      const state = useCourseStore.getState();
      expect(state.enrolledCourseIds).toEqual([]);
      expect(state.activeCourseId).toBeNull();
      expect(state.activeCourseIds).toEqual([]);
      expect(state.courseStates).toEqual({});
      expect(state.courses).toEqual([]);
    });
  });

  describe('selectors', () => {
    it('getActiveState returns null when no active course', () => {
      expect(useCourseStore.getState().getActiveState()).toBeNull();
    });

    it('getActiveState returns the active course state', () => {
      useCourseStore.getState().activateCourse('course-1', {
        amount: 50,
        duration: 30,
      });

      const activeState = useCourseStore.getState().getActiveState();
      expect(activeState).toBeDefined();
      expect(activeState!.lockAmount).toBe(50);
    });

    it('getStreak returns 0 when no active course', () => {
      expect(useCourseStore.getState().getStreak()).toBe(0);
    });

    it('getFlameState returns COLD when no active course', () => {
      expect(useCourseStore.getState().getFlameState()).toBe('COLD');
    });
  });

  describe('deactivateCourse', () => {
    it('removes course from active state', () => {
      useCourseStore.getState().activateCourse('course-1', { amount: 50, duration: 30 });
      useCourseStore.getState().deactivateCourse('course-1');

      const state = useCourseStore.getState();
      expect(state.courseStates['course-1']).toBeUndefined();
      expect(state.activeCourseIds).not.toContain('course-1');
    });

    it('switches activeCourseId to next available', () => {
      useCourseStore.getState().activateCourse('course-1', { amount: 50, duration: 30 });
      useCourseStore.getState().activateCourse('course-2', { amount: 50, duration: 30 });
      useCourseStore.getState().setActiveCourse('course-1');
      useCourseStore.getState().deactivateCourse('course-1');

      expect(useCourseStore.getState().activeCourseId).toBe('course-2');
    });
  });
});
