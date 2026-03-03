import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { asyncStorageAdapter } from './storage';
import { MOCK_COURSES, MOCK_LESSONS } from '@/data/mockCourses';
import type { Course, Lesson, LessonProgress } from '@/types';

interface CourseStore {
  courses: Course[];
  lessons: Record<string, Lesson[]>;
  activeCourseId: string | null;
  lessonProgress: Record<string, LessonProgress>;
  enrolledCourseIds: string[];
  setCourses: (courses: Course[]) => void;
  setLessons: (lessons: Record<string, Lesson[]>) => void;
  setActiveCourse: (courseId: string) => void;
  completeLesson: (lessonId: string, courseId: string, score: number) => void;
  getLessonProgress: (lessonId: string) => LessonProgress | null;
  getLessonsForCourse: (courseId: string) => Lesson[];
  getLesson: (lessonId: string) => Lesson | null;
  getActiveCourse: () => Course | null;
  enrollCourse: (courseId: string) => void;
  unenrollCourse: (courseId: string) => void;
  isEnrolled: (courseId: string) => boolean;
  getEnrolledCourses: () => Course[];
  initializeMockData: () => void;
  reset: () => void;
}

const initialState = {
  courses: [] as Course[],
  lessons: {} as Record<string, Lesson[]>,
  activeCourseId: null as string | null,
  lessonProgress: {} as Record<string, LessonProgress>,
  enrolledCourseIds: [] as string[],
};

export const useCourseStore = create<CourseStore>()(
  persist(
    (set, get) => ({
      ...initialState,

      setCourses: (courses) => set({ courses }),

      setLessons: (lessons) => set({ lessons }),

      setActiveCourse: (courseId) => set({ activeCourseId: courseId }),

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
          set({ enrolledCourseIds: [...state.enrolledCourseIds, courseId] });
        }
      },

      unenrollCourse: (courseId) => {
        const state = get();
        set({ enrolledCourseIds: state.enrolledCourseIds.filter((id) => id !== courseId) });
      },

      isEnrolled: (courseId) => get().enrolledCourseIds.includes(courseId),

      getEnrolledCourses: () => {
        const state = get();
        return state.courses.filter((c) => state.enrolledCourseIds.includes(c.id));
      },

      initializeMockData: () => {
        const state = get();
        if (state.courses.length > 0) return;
        set({ courses: MOCK_COURSES, lessons: MOCK_LESSONS });
      },

      reset: () => set(initialState),
    }),
    {
      name: 'locked-in-courses',
      storage: createJSONStorage(() => asyncStorageAdapter),
    },
  ),
);
