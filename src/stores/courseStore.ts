import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { asyncStorageAdapter } from './storage';
import { MOCK_COURSES, MOCK_LESSONS } from '@/data/mockCourses';
import { getCourseRuntime, hasRemoteLessonApi } from '@/services/api';
import type { CourseRuntimeSnapshot } from '@/services/api/types';
import type { LockAccountSnapshot } from '@/services/solana';
import { BREW_MODES } from '@/types';
import type {
  BrewModeId,
  Course,
  CourseModule,
  Lesson,
  LessonProgress,
  FlameState,
} from '@/types';
import { DEFAULT_COURSE_STATE } from '@/types/courseState';
import type { CourseGameState, FuelEarnStatus } from '@/types/courseState';
import { loadHydratedContentSnapshot } from '@/services/repositories';

interface CourseStore {
  // Existing
  courses: Course[];
  modules: Record<string, CourseModule[]>;
  lessons: Record<string, Lesson[]>;
  lessonProgress: Record<string, LessonProgress>;
  enrolledCourseIds: string[];
  contentReleaseId: string | null;
  contentPublishedAt: string | null;
  contentLoading: boolean;
  contentError: string | null;
  contentInitialized: boolean;
  boundWalletAddress: string | null;

  // Per-course game state
  activeCourseId: string | null;
  activeCourseIds: string[]; // ordered list of enrolled/active courses (for tab order)
  courseStates: Record<string, CourseGameState>; // courseId → state

  // Selectors (read from active course)
  getActiveState: () => CourseGameState | null;
  getStreak: () => number;
  getSaverCount: () => number;
  getIchorBalance: () => number;
  getFuelBalance: () => number;
  getFuelCap: () => number;
  getFuelEarnStatus: () => FuelEarnStatus;
  getNextFuelBurnAt: () => string | null;
  getFlameState: () => FlameState;
  isGauntletActive: () => boolean;

  // Mutations
  setActiveCourse: (courseId: string) => void;
  activateCourse: (
    courseId: string,
    lock: {
      amount: number;
      duration: 14 | 30 | 45 | 60 | 90 | 180 | 365;
      lockAccountAddress?: string | null;
      stableMintAddress?: string | null;
      skrAmount?: number;
    },
  ) => void;
  skipGauntletForCourse: (courseId: string) => void;
  deactivateCourse: (courseId: string) => void;

  // Per-course actions
  completeLesson: (lessonId: string, courseId: string, score: number) => void;
  completeDayForCourse: (courseId: string) => void;
  useSaverForCourse: (courseId: string) => boolean;
  startBrewForCourse: (courseId: string, modeId: BrewModeId) => void;
  tickBrewForCourse: (courseId: string) => void;
  cancelBrewForCourse: (courseId: string) => void;

  // Existing helpers
  setCourses: (courses: Course[]) => void;
  bindToWallet: (walletAddress: string | null) => void;
  setModules: (modules: Record<string, CourseModule[]>) => void;
  setLessons: (lessons: Record<string, Lesson[]>) => void;
  getLessonProgress: (lessonId: string) => LessonProgress | null;
  getModulesForCourse: (courseId: string) => CourseModule[];
  getLessonsForCourse: (courseId: string) => Lesson[];
  getLesson: (lessonId: string) => Lesson | null;
  getActiveCourse: () => Course | null;
  enrollCourse: (courseId: string) => void;
  unenrollCourse: (courseId: string) => void;
  isEnrolled: (courseId: string) => boolean;
  getEnrolledCourses: () => Course[];
  syncCourseRuntime: (courseId: string, snapshot: CourseRuntimeSnapshot) => void;
  syncLockSnapshot: (courseId: string, snapshot: LockAccountSnapshot) => void;
  refreshCourseRuntime: (courseId: string, token: string) => Promise<void>;
  resetLessonProgressForCourse: (courseId: string) => void;
  initializeContent: (force?: boolean) => Promise<void>;
  initializeMockData: (errorMessage?: string | null) => void;
  reset: () => void;
}

const initialState = {
  courses: [] as Course[],
  modules: {} as Record<string, CourseModule[]>,
  lessons: {} as Record<string, Lesson[]>,
  activeCourseId: null as string | null,
  activeCourseIds: [] as string[],
  lessonProgress: {} as Record<string, LessonProgress>,
  enrolledCourseIds: [] as string[],
  courseStates: {} as Record<string, CourseGameState>,
  contentReleaseId: null as string | null,
  contentPublishedAt: null as string | null,
  contentLoading: false,
  contentError: null as string | null,
  contentInitialized: false,
  boundWalletAddress: null as string | null,
};

function normalizeCourseGameState(
  state?: Partial<CourseGameState> | null,
): CourseGameState {
  return {
    ...DEFAULT_COURSE_STATE,
    ...state,
  };
}

function deriveFuelEarnStatus(state: CourseGameState): FuelEarnStatus {
  const today = new Date().toISOString().slice(0, 10);
  if (state.saverRecoveryMode) return 'PAUSED_RECOVERY';
  if (state.fuelCounter >= state.fuelCap) return 'AT_CAP';
  if (state.lastFuelCreditDay === today) return 'EARNED_TODAY';
  return 'AVAILABLE';
}

function deriveNextFuelBurnAt(state: CourseGameState): string | null {
  if (state.brewStatus !== 'BREWING' || state.fuelCounter <= 0) {
    return null;
  }

  const anchor = state.lastBrewerBurnTs ?? state.brewStartedAt;
  if (!anchor) {
    return null;
  }

  return new Date(new Date(anchor).getTime() + 24 * 60 * 60 * 1000).toISOString();
}

function getBrewMode(modeId: string | null) {
  if (!modeId) return null;
  return BREW_MODES[modeId as BrewModeId] ?? null;
}

function buildFallbackModules(): Record<string, CourseModule[]> {
  return MOCK_COURSES.reduce<Record<string, CourseModule[]>>((acc, course) => {
    acc[course.id] = [
      {
        id: `${course.id}-module-core`,
        courseId: course.id,
        slug: 'core',
        title: `${course.title} Core`,
        description: 'Core lesson track for this course.',
        order: 1,
        difficulty: course.difficulty,
        totalLessons: (MOCK_LESSONS[course.id] ?? []).length,
        estimatedMinutes: (MOCK_LESSONS[course.id] ?? []).length * 12,
      },
    ];
    return acc;
  }, {});
}

export const useCourseStore = create<CourseStore>()(
  persist(
    (set, get) => ({
      ...initialState,

      // --- Selectors ---
      getActiveState: () => {
        const { activeCourseId, courseStates } = get();
        if (!activeCourseId) return null;
        return courseStates[activeCourseId] ?? null;
      },

      getStreak: () => {
        const state = get().getActiveState();
        return state?.currentStreak ?? 0;
      },

      getSaverCount: () => {
        const state = get().getActiveState();
        return state?.saverCount ?? 0;
      },

      getIchorBalance: () => {
        const state = get().getActiveState();
        return state?.ichorBalance ?? 0;
      },

      getFuelBalance: () => {
        const state = get().getActiveState();
        return state?.fuelCounter ?? 0;
      },

      getFuelCap: () => {
        const state = get().getActiveState();
        return state?.fuelCap ?? DEFAULT_COURSE_STATE.fuelCap;
      },

      getFuelEarnStatus: () => {
        const state = get().getActiveState();
        return state ? deriveFuelEarnStatus(state) : 'AVAILABLE';
      },

      getNextFuelBurnAt: () => {
        const state = get().getActiveState();
        return state ? deriveNextFuelBurnAt(state) : null;
      },

      getFlameState: () => {
        const state = get().getActiveState();
        return state?.flameState ?? 'COLD';
      },

      isGauntletActive: () => {
        const state = get().getActiveState();
        return state?.gauntletActive ?? false;
      },

      // --- Mutations ---
      setActiveCourse: (courseId) => set({ activeCourseId: courseId }),

      activateCourse: (courseId, lock) => {
        const { courseStates, activeCourseIds, enrolledCourseIds } = get();
        const newState: CourseGameState = normalizeCourseGameState({
          lockAmount: lock.amount,
          lockDuration: lock.duration,
          lockStartDate: new Date().toISOString(),
          lockAccountAddress: lock.lockAccountAddress ?? null,
          stableMintAddress: lock.stableMintAddress ?? null,
          skrLockedAmount: lock.skrAmount ?? 0,
        });
        set({
          courseStates: { ...courseStates, [courseId]: newState },
          activeCourseIds: activeCourseIds.includes(courseId)
            ? activeCourseIds
            : [...activeCourseIds, courseId],
          activeCourseId: courseId,
          enrolledCourseIds: enrolledCourseIds.includes(courseId)
            ? enrolledCourseIds
            : [...enrolledCourseIds, courseId],
        });
      },

      skipGauntletForCourse: (courseId: string) => {
        const { courseStates } = get();
        const state = courseStates[courseId];
        if (!state) return;
        set({
          courseStates: {
            ...courseStates,
            [courseId]: { ...state, gauntletActive: false, gauntletDay: 0 },
          },
        });
      },

      deactivateCourse: (courseId) => {
        const { courseStates, activeCourseIds, activeCourseId } = get();
        const newStates = { ...courseStates };
        delete newStates[courseId];
        const newActiveIds = activeCourseIds.filter((id) => id !== courseId);
        set({
          courseStates: newStates,
          activeCourseIds: newActiveIds,
          activeCourseId:
            activeCourseId === courseId
              ? newActiveIds[0] ?? null
              : activeCourseId,
        });
      },

      // --- Per-course actions ---
      completeDayForCourse: (courseId) => {
        const { courseStates } = get();
        const state = courseStates[courseId];
        if (!state) return;

        const today = new Date().toISOString().split('T')[0];
        const newStreak = state.currentStreak + 1;

        set({
          courseStates: {
            ...courseStates,
            [courseId]: {
              ...state,
              currentStreak: newStreak,
              longestStreak: Math.max(state.longestStreak, newStreak),
              lastCompletedDate: today,
              todayCompleted: true,
              gauntletDay: state.gauntletActive
                ? Math.min(state.gauntletDay + 1, 8)
                : state.gauntletDay,
              gauntletActive: state.gauntletActive
                ? state.gauntletDay < 7
                : false,
              // Light flame on first streak
              flameState: newStreak >= 1 ? 'LIT' : state.flameState,
              lightIntensity: newStreak >= 1 ? Math.min(0.3 + newStreak * 0.05, 1.0) : state.lightIntensity,
            },
          },
        });
      },

      useSaverForCourse: (courseId) => {
        const { courseStates } = get();
        const state = courseStates[courseId];
        if (!state || state.saverCount >= 3) return false;
        // Can't use savers during gauntlet
        if (state.gauntletActive) return false;

        set({
          courseStates: {
            ...courseStates,
            [courseId]: {
              ...state,
              saverCount: state.saverCount + 1,
              saverRecoveryMode: true,
            },
          },
        });
        return true;
      },

      startBrewForCourse: (courseId, modeId) => {
        const { courseStates } = get();
        const state = courseStates[courseId];
        if (
          !state ||
          state.brewStatus === 'BREWING' ||
          state.fuelCounter <= 0 ||
          state.gauntletActive
        ) {
          return;
        }

        const mode = BREW_MODES[modeId];
        if (!mode) return;

        const now = new Date();
        const endsAt = new Date(now.getTime() + mode.durationMs);

        set({
          courseStates: {
            ...courseStates,
            [courseId]: {
              ...state,
              brewStatus: 'BREWING',
              brewModeId: modeId,
              brewStartedAt: now.toISOString(),
              brewEndsAt: endsAt.toISOString(),
            },
          },
        });
      },

      tickBrewForCourse: (courseId) => {
        const { courseStates } = get();
        const state = courseStates[courseId];
        if (!state || state.brewStatus !== 'BREWING' || !state.brewEndsAt) return;

        const now = new Date();
        if (now >= new Date(state.brewEndsAt)) {
          // Brew complete — award ichor
          const mode = getBrewMode(state.brewModeId);
          const ichorReward = mode
            ? Math.round(mode.ichorPerHour * (mode.durationMs / (60 * 60 * 1000)))
            : 0;
          set({
            courseStates: {
              ...courseStates,
              [courseId]: {
                ...state,
                brewStatus: 'IDLE',
                brewModeId: null,
                brewStartedAt: null,
                brewEndsAt: null,
                ichorBalance: state.ichorBalance + ichorReward,
                totalIchorProduced: state.totalIchorProduced + ichorReward,
              },
            },
          });
        }
      },

      cancelBrewForCourse: (courseId) => {
        const { courseStates } = get();
        const state = courseStates[courseId];
        if (!state) return;

        const mode = getBrewMode(state.brewModeId);
        const accruedIchor =
          state.brewStatus === 'BREWING' && state.brewStartedAt && mode
            ? Math.floor(
                mode.ichorPerHour *
                  ((Date.now() - new Date(state.brewStartedAt).getTime()) /
                    (60 * 60 * 1000)),
              )
            : 0;

        set({
          courseStates: {
            ...courseStates,
            [courseId]: {
              ...state,
              brewStatus: 'IDLE',
              brewModeId: null,
              brewStartedAt: null,
              brewEndsAt: null,
              ichorBalance: state.ichorBalance + accruedIchor,
              totalIchorProduced: state.totalIchorProduced + accruedIchor,
            },
          },
        });
      },

      // --- Existing methods ---
      setCourses: (courses) => set({ courses }),

      bindToWallet: (walletAddress) =>
        set((state) => {
          if (!walletAddress) {
            return {};
          }

          const hasWalletScopedState =
            state.activeCourseIds.length > 0 ||
            state.enrolledCourseIds.length > 0 ||
            Object.keys(state.courseStates).length > 0 ||
            Object.keys(state.lessonProgress).length > 0;

          if (state.boundWalletAddress === walletAddress) {
            return {};
          }

          if (!hasWalletScopedState && !state.boundWalletAddress) {
            return { boundWalletAddress: walletAddress };
          }

          return {
            boundWalletAddress: walletAddress,
            activeCourseId: null,
            activeCourseIds: [],
            enrolledCourseIds: [],
            courseStates: {},
            lessonProgress: {},
            courses: state.courses.map((course) => ({
              ...course,
              completedLessons: 0,
            })),
          };
        }),

      setModules: (modules) => set({ modules }),

      setLessons: (lessons) => set({ lessons }),

      completeLesson: (lessonId, courseId, score) => {
        const state = get();

        // Idempotency guard: skip if already completed
        if (state.lessonProgress[lessonId]?.completed) {
          // Update score if higher
          if (score > (state.lessonProgress[lessonId].score ?? 0)) {
            set({
              lessonProgress: {
                ...state.lessonProgress,
                [lessonId]: {
                  ...state.lessonProgress[lessonId],
                  score,
                  completedAt: new Date().toISOString(),
                },
              },
            });
          }
          return;
        }

        const progress: LessonProgress = {
          lessonId,
          courseId,
          completed: true,
          score,
          completedAt: new Date().toISOString(),
        };

        const updatedCourses = state.courses.map((c) =>
          c.id === courseId
            ? { ...c, completedLessons: c.completedLessons + 1 }
            : c,
        );

        set({
          lessonProgress: { ...state.lessonProgress, [lessonId]: progress },
          courses: updatedCourses,
        });
      },

      getLessonProgress: (lessonId) => get().lessonProgress[lessonId] ?? null,

      getModulesForCourse: (courseId) => get().modules[courseId] ?? [],

      getLessonsForCourse: (courseId) => get().lessons[courseId] ?? [],

      getLesson: (lessonId) => {
        const state = get();
        for (const lessons of Object.values(state.lessons)) {
          const found = lessons.find((l) => l.id === lessonId);
          if (found) return found;
        }
        return null;
      },

      getActiveCourse: () => {
        const state = get();
        return (
          state.courses.find((c) => c.id === state.activeCourseId) ?? null
        );
      },

      enrollCourse: (courseId) => {
        const state = get();
        if (!state.enrolledCourseIds.includes(courseId)) {
          const newEnrolled = [...state.enrolledCourseIds, courseId];
          const newActiveIds = state.activeCourseIds.includes(courseId)
            ? state.activeCourseIds
            : [...state.activeCourseIds, courseId];

          // Initialize course state if not exists
          const newCourseStates = state.courseStates[courseId]
            ? state.courseStates
            : {
                ...state.courseStates,
                [courseId]: normalizeCourseGameState(),
              };

          set({
            enrolledCourseIds: newEnrolled,
            activeCourseIds: newActiveIds,
            courseStates: newCourseStates,
            // Auto-select if no active course
            activeCourseId: state.activeCourseId ?? courseId,
          });
        }
      },

      unenrollCourse: (courseId) => {
        const state = get();
        set({
          enrolledCourseIds: state.enrolledCourseIds.filter((id) => id !== courseId),
          activeCourseIds: state.activeCourseIds.filter((id) => id !== courseId),
          activeCourseId:
            state.activeCourseId === courseId
              ? state.activeCourseIds.filter((id) => id !== courseId)[0] ?? null
              : state.activeCourseId,
        });
      },

      isEnrolled: (courseId) => get().enrolledCourseIds.includes(courseId),

      getEnrolledCourses: () => {
        const state = get();
        return state.courses.filter((c) => state.enrolledCourseIds.includes(c.id));
      },

      syncCourseRuntime: (courseId, snapshot) => {
        const state = get();
        const existingState = normalizeCourseGameState(state.courseStates[courseId]);

        set({
          courseStates: {
            ...state.courseStates,
            [courseId]: {
              ...existingState,
              currentStreak: snapshot.currentStreak,
              longestStreak: snapshot.longestStreak,
              gauntletActive: snapshot.gauntletActive,
              gauntletDay: snapshot.gauntletDay,
              saverCount: snapshot.saverCount,
              saverRecoveryMode: snapshot.saverRecoveryMode,
              currentYieldRedirectBps: snapshot.currentYieldRedirectBps,
              extensionDays: snapshot.extensionDays,
              fuelCounter: snapshot.fuelCounter,
              fuelCap: snapshot.fuelCap,
              lastFuelCreditDay: snapshot.lastFuelCreditDay,
              lastBrewerBurnTs: snapshot.lastBrewerBurnTs,
            },
          },
        });
      },

      syncLockSnapshot: (courseId, snapshot) => {
        const state = get();
        const existingState = normalizeCourseGameState(state.courseStates[courseId]);

        set({
          courseStates: {
            ...state.courseStates,
            [courseId]: {
              ...existingState,
              lockAccountAddress:
                snapshot.lockAccountAddress ?? existingState.lockAccountAddress,
              lockStartDate: snapshot.lockStartDate,
              extensionDays: snapshot.extensionDays,
              gauntletActive: !snapshot.gauntletComplete,
              gauntletDay: snapshot.gauntletDay,
              saverRecoveryMode: snapshot.saverRecoveryMode,
              currentYieldRedirectBps: snapshot.currentYieldRedirectBps,
              fuelCounter: snapshot.fuelCounter,
              fuelCap: snapshot.fuelCap,
              ichorBalance: snapshot.ichorCounter,
              totalIchorProduced: snapshot.ichorLifetimeTotal,
            },
          },
        });
      },

      refreshCourseRuntime: async (courseId, token) => {
        if (!courseId || !token || !hasRemoteLessonApi()) {
          return;
        }

        const snapshot = await getCourseRuntime(courseId, token);
        get().syncCourseRuntime(courseId, snapshot);
      },

      resetLessonProgressForCourse: (courseId) => {
        const state = get();
        const lessonIdsForCourse = new Set(
          (state.lessons[courseId] ?? []).map((lesson) => lesson.id),
        );

        if (lessonIdsForCourse.size === 0) {
          return;
        }

        const nextLessonProgress = Object.fromEntries(
          Object.entries(state.lessonProgress).filter(
            ([lessonId, progress]) =>
              !lessonIdsForCourse.has(lessonId) && progress.courseId !== courseId,
          ),
        );

        const completedCounts = Object.values(nextLessonProgress).reduce<
          Record<string, number>
        >((acc, progress) => {
          if (!progress.completed) {
            return acc;
          }

          acc[progress.courseId] = (acc[progress.courseId] ?? 0) + 1;
          return acc;
        }, {});

        set({
          lessonProgress: nextLessonProgress,
          courses: state.courses.map((course) => ({
            ...course,
            completedLessons: completedCounts[course.id] ?? 0,
          })),
        });
      },

      initializeContent: async (force = false) => {
        const state = get();
        if (state.contentLoading) {
          if (__DEV__) {
            console.info('[content-sync] skip: already loading');
          }
          return;
        }

        const remoteConfigured = hasRemoteLessonApi();
        const needsRemoteUpgrade =
          remoteConfigured &&
          (state.contentReleaseId === 'local-mock-release' || !state.contentReleaseId);

        if (!force && state.contentInitialized && !needsRemoteUpgrade) {
          if (__DEV__) {
            console.info(
              `[content-sync] skip: initialized=true releaseId=${state.contentReleaseId ?? '(none)'} remoteConfigured=${remoteConfigured} needsRemoteUpgrade=${needsRemoteUpgrade}`,
            );
          }
          return;
        }

        if (__DEV__) {
          console.info(
            `[content-sync] start: force=${force} releaseId=${state.contentReleaseId ?? '(none)'} remoteConfigured=${remoteConfigured} needsRemoteUpgrade=${needsRemoteUpgrade}`,
          );
        }

        set({ contentLoading: true, contentError: null });

        const MAX_RETRIES = 2;
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
          try {
            const snapshot = await loadHydratedContentSnapshot();
            if (__DEV__) {
              console.info(
                `[content-sync] success: releaseId=${snapshot.releaseId} publishedAt=${snapshot.publishedAt}`,
              );
            }
            set({
              courses: snapshot.courses,
              modules: snapshot.modulesByCourse,
              lessons: snapshot.lessonsByCourse,
              contentReleaseId: snapshot.releaseId,
              contentPublishedAt: snapshot.publishedAt,
              contentLoading: false,
              contentError: null,
              contentInitialized: true,
            });
            return;
          } catch (error) {
            const message =
              error instanceof Error
                ? error.message
                : 'Unable to load lesson catalog';

            if (attempt < MAX_RETRIES) {
              if (__DEV__) {
                console.info(`[content-sync] retry ${attempt + 1}/${MAX_RETRIES} after: ${message}`);
              }
              // Brief pause before retry (1s, then 2s)
              await new Promise((r) => setTimeout(r, (attempt + 1) * 1000));
              continue;
            }

            if (__DEV__) {
              console.warn(`[content-sync] error after ${MAX_RETRIES + 1} attempts: ${message}`);
            }
            set({
              contentLoading: false,
              contentError: message,
              contentInitialized: false,
            });

            // Keep the app usable while backend wiring is in progress.
            get().initializeMockData(message);
          }
        }
      },

      initializeMockData: (errorMessage = null) => {
        const state = get();
        if (state.courses.length > 0) return;
        set({
          courses: MOCK_COURSES,
          modules: buildFallbackModules(),
          lessons: MOCK_LESSONS,
          contentReleaseId: 'local-mock-release',
          contentPublishedAt: new Date().toISOString(),
          contentError: errorMessage,
          contentInitialized: true,
        });
      },

      reset: () => set(initialState),
    }),
    {
      name: 'locked-in-courses',
      storage: createJSONStorage(() => asyncStorageAdapter),
      merge: (persisted, current) => {
        const mergedState = {
          ...current,
          ...(persisted as Partial<CourseStore>),
        };

        return {
          ...mergedState,
          courseStates: Object.fromEntries(
            Object.entries(mergedState.courseStates ?? {}).map(([courseId, state]) => [
              courseId,
              normalizeCourseGameState(state),
            ]),
          ),
        };
      },
      partialize: (state) => {
        const { contentLoading, contentError, ...persisted } = state;
        void contentLoading;
        void contentError;
        return persisted;
      },
    },
  ),
);
