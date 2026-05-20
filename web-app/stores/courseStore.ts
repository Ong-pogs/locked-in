import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { webStorageAdapter } from './storage';
import { getCourseRuntime, hasRemoteLessonApi } from '@/services/api';
import type { CourseRuntimeSnapshot, UserEnrollmentsResponse } from '@/services/api/types';
import { batchCheckLockAccounts } from '@/services/solana';
import type { LockAccountSnapshot } from '@/services/solana';
import type {
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
  courseStates: Record<string, CourseGameState>; // courseId -> state

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
  deactivateCourse: (courseId: string) => void;

  // Per-course actions
  completeLesson: (lessonId: string, courseId: string, score: number) => void;
  completeDayForCourse: (courseId: string) => void;
  useSaverForCourse: (courseId: string) => boolean;

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
  syncOnChainEnrollments: (walletAddress: string) => Promise<void>;
  initializeContent: (force?: boolean) => Promise<void>;
  initializeMockData: (errorMessage?: string | null) => void;
  restoreFromBackend: (data: UserEnrollmentsResponse) => void;
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
  // Fuel is +1 per lesson with no daily cap now — only the fuel cap
  // gates earning.
  if (state.fuelCounter >= state.fuelCap) return 'AT_CAP';
  return 'AVAILABLE';
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function deriveNextFuelBurnAt(_state: CourseGameState): string | null {
  // Fuel conversion is now instant — no scheduled burn
  return null;
}


let enrollmentSyncInProgress = false;

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
        const state = get();
        const existing = normalizeCourseGameState(state.courseStates[courseId]);
        const today = new Date().toISOString().split('T')[0];
        if (existing.lastCompletedDate === today) return; // already done today

        const newStreak = existing.currentStreak + 1;
        const flameState = newStreak >= 3 ? 'BURNING' : newStreak >= 1 ? 'LIT' : 'COLD';
        const INTENSITY: Record<string, number> = { BURNING: 1.0, LIT: 0.6, COLD: 0.15 };

        set({
          courseStates: {
            ...state.courseStates,
            [courseId]: {
              ...existing,
              currentStreak: newStreak,
              longestStreak: Math.max(newStreak, existing.longestStreak),
              lastCompletedDate: today,
              todayCompleted: true,
              saverRecoveryMode: false,
              flameState: flameState as CourseGameState['flameState'],
              lightIntensity: INTENSITY[flameState] ?? 0.15,
              lastLocalCompletionAt: Date.now(),
            },
          },
        });
      },

      useSaverForCourse: (courseId) => {
        const { courseStates } = get();
        const state = courseStates[courseId];
        if (!state || state.saverCount >= 3) return false;

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
            modules: {},
            lessons: {},
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
        const existing = state.courseStates[courseId];

        // Don't overwrite streak if we just completed locally (within last 10 seconds)
        if (existing?.lastLocalCompletionAt && Date.now() - existing.lastLocalCompletionAt < 10_000) {
          return;
        }

        const existingState = normalizeCourseGameState(existing);

        set({
          courseStates: {
            ...state.courseStates,
            [courseId]: {
              ...existingState,
              currentStreak: snapshot.currentStreak,
              longestStreak: snapshot.longestStreak,
              saverCount: snapshot.saverCount,
              saverRecoveryMode: snapshot.saverRecoveryMode,
              currentYieldRedirectBps: snapshot.currentYieldRedirectBps,
              extensionDays: snapshot.extensionDays,
              fuelCounter: snapshot.fuelCounter,
              fuelCap: snapshot.fuelCap,
              lastFuelCreditDay: snapshot.lastFuelCreditDay,
              lastBrewerBurnTs: snapshot.lastBrewerBurnTs,
              fuelFragmentsToday: snapshot.fuelFragmentsToday ?? 0,
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

      syncOnChainEnrollments: async (walletAddress) => {
        if (enrollmentSyncInProgress) return;
        enrollmentSyncInProgress = true;
        try {
          const { courses, enrolledCourseIds, courseStates } = get();
          if (!walletAddress || courses.length === 0) return;

          // Only check courses not already enrolled
          const unenrolledCourseIds = courses
            .map((c) => c.id)
            .filter((id) => !enrolledCourseIds.includes(id) || !courseStates[id]?.lockAccountAddress);

          if (unenrolledCourseIds.length === 0) return;

          try {
            const lockMap = await batchCheckLockAccounts(walletAddress, unenrolledCourseIds);

            for (const [courseId, snapshot] of lockMap) {
              // Enroll + activate with lock data from chain
              const derivedDuration = snapshot.lockEndDate && snapshot.lockStartDate
                ? Math.round((new Date(snapshot.lockEndDate).getTime() - new Date(snapshot.lockStartDate).getTime()) / 86400000)
                : 30;
              get().activateCourse(courseId, {
                amount: parseFloat(snapshot.principalAmountUi),
                duration: derivedDuration as 14 | 30 | 45 | 60 | 90 | 180 | 365,
                lockAccountAddress: snapshot.lockAccountAddress,
              });
              get().syncLockSnapshot(courseId, snapshot);
            }
          } catch (error) {
            console.warn('[on-chain-sync] Failed to check lock accounts:', error);
          }
        } finally {
          enrollmentSyncInProgress = false;
        }
      },

      initializeContent: async (force = false) => {
        const state = get();
        if (state.contentLoading) {
          console.info('[content-sync] skip: already loading');
          return;
        }

        const remoteConfigured = hasRemoteLessonApi();
        const needsRemoteUpgrade = remoteConfigured;

        if (!force && state.contentInitialized && !needsRemoteUpgrade) {
          console.info(
            `[content-sync] skip: initialized=true releaseId=${state.contentReleaseId ?? '(none)'} remoteConfigured=${remoteConfigured} needsRemoteUpgrade=${needsRemoteUpgrade}`,
          );
          return;
        }

        console.info(
          `[content-sync] start: force=${force} releaseId=${state.contentReleaseId ?? '(none)'} remoteConfigured=${remoteConfigured} needsRemoteUpgrade=${needsRemoteUpgrade}`,
        );

        set({ contentLoading: true, contentError: null });

        const MAX_RETRIES = 2;
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
          try {
            const snapshot = await loadHydratedContentSnapshot();
            console.info(
              `[content-sync] success: releaseId=${snapshot.releaseId} publishedAt=${snapshot.publishedAt}`,
            );
            // Recalculate completedLessons from local lessonProgress so
            // content refresh doesn't reset counts to 0
            const currentProgress = get().lessonProgress;
            const coursesWithProgress = snapshot.courses.map((course) => {
              const courseLessons = snapshot.lessonsByCourse[course.id] ?? [];
              const completedCount = courseLessons.filter(
                (l) => currentProgress[l.id]?.completed,
              ).length;
              return { ...course, completedLessons: completedCount };
            });

            set({
              courses: coursesWithProgress,
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
              console.info(`[content-sync] retry ${attempt + 1}/${MAX_RETRIES} after: ${message}`);
              // Brief pause before retry (1s, then 2s)
              await new Promise((r) => setTimeout(r, (attempt + 1) * 1000));
              continue;
            }

            console.warn(`[content-sync] error after ${MAX_RETRIES + 1} attempts: ${message}`);
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
        // No mock data on web — just mark as initialized with error
        const state = get();
        if (state.courses.length > 0) return;
        set({
          contentError: errorMessage,
          contentInitialized: true,
        });
      },

      /** Restore enrollments, runtime, and lesson progress from backend after fresh login */
      restoreFromBackend: (data) => {
        const state = get();
        const enrolledIds = data.enrollments.map((e) => e.courseId);

        // Only add new enrollments — don't remove existing local ones
        const mergedEnrolled = [...new Set([...state.enrolledCourseIds, ...enrolledIds])];
        const mergedActive = [...new Set([...state.activeCourseIds, ...enrolledIds])];

        // Sync runtime state for each enrollment that has it
        const mergedCourseStates = { ...state.courseStates };
        for (const enrollment of data.enrollments) {
          if (enrollment.runtime) {
            const existing = normalizeCourseGameState(mergedCourseStates[enrollment.courseId]);
            mergedCourseStates[enrollment.courseId] = {
              ...existing,
              currentStreak: enrollment.runtime.currentStreak,
              longestStreak: enrollment.runtime.longestStreak,
              saverCount: enrollment.runtime.saverCount,
              saverRecoveryMode: enrollment.runtime.saverRecoveryMode,
              currentYieldRedirectBps: enrollment.runtime.currentYieldRedirectBps,
              extensionDays: enrollment.runtime.extensionDays,
              fuelCounter: enrollment.runtime.fuelCounter,
              fuelCap: enrollment.runtime.fuelCap,
            };
          }
        }

        // Restore lesson progress
        const mergedProgress = { ...state.lessonProgress };
        for (const lp of data.lessonProgress) {
          // Only update if backend has newer/better data
          const existing = mergedProgress[lp.lessonId];
          if (!existing || !existing.completed) {
            mergedProgress[lp.lessonId] = {
              lessonId: lp.lessonId,
              courseId: '', // Will be resolved by course content
              completed: lp.completed,
              score: lp.score,
              completedAt: lp.completedAt,
            };
          }
        }

        // Update completed lesson counts on courses
        const updatedCourses = state.courses.map((course) => {
          const courseLessons = state.lessons[course.id] ?? [];
          const completedCount = courseLessons.filter(
            (l) => mergedProgress[l.id]?.completed,
          ).length;
          return { ...course, completedLessons: completedCount };
        });

        set({
          enrolledCourseIds: mergedEnrolled,
          activeCourseIds: mergedActive,
          courseStates: mergedCourseStates,
          lessonProgress: mergedProgress,
          courses: updatedCourses,
          activeCourseId: state.activeCourseId ?? enrolledIds[0] ?? null,
        });
      },

      reset: () => set(initialState),
    }),
    {
      name: 'locked-in-courses',
      storage: createJSONStorage(() => webStorageAdapter),
      version: 1,
      // Stub migrator — no schema changes between v0 and v1, but adding
      // `version` now means future bumps have a hook to land migrations
      // instead of silently wiping returning users' state.
      migrate: (persistedState) => persistedState,
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
