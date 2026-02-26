import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { asyncStorageAdapter } from './storage';
import type { Course, LessonProgress } from '@/types';

interface CourseStore {
  courses: Course[];
  activeCourseId: string | null;
  lessonProgress: Record<string, LessonProgress>;
  setCourses: (courses: Course[]) => void;
  setActiveCourse: (courseId: string) => void;
  completeLesson: (lessonId: string, courseId: string, score: number) => void;
  getLessonProgress: (lessonId: string) => LessonProgress | null;
  getActiveCourse: () => Course | null;
  reset: () => void;
}

const initialState = {
  courses: [] as Course[],
  activeCourseId: null as string | null,
  lessonProgress: {} as Record<string, LessonProgress>,
};

export const useCourseStore = create<CourseStore>()(
  persist(
    (set, get) => ({
      ...initialState,

      setCourses: (courses) => set({ courses }),

      setActiveCourse: (courseId) => set({ activeCourseId: courseId }),

      completeLesson: (lessonId, courseId, score) => {
        const state = get();
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

      getActiveCourse: () => {
        const state = get();
        return (
          state.courses.find((c) => c.id === state.activeCourseId) ?? null
        );
      },

      reset: () => set(initialState),
    }),
    {
      name: 'locked-in-courses',
      storage: createJSONStorage(() => asyncStorageAdapter),
    },
  ),
);
