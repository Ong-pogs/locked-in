import { MOCK_COURSES, MOCK_LESSONS } from '@/data/mockCourses';
import type { ContentProvider } from './contentProvider';
import type {
  ApiContentVersion,
  ApiCourseCard,
  ApiLessonBlock,
  ApiLessonPayload,
  ApiModuleCard,
  CourseCatalogSnapshot,
} from '../types';

const LOCAL_RELEASE_ID = 'local-mock-release';

function createContentHash(value: unknown): string {
  const source = JSON.stringify(value);
  let hash = 0;

  for (let i = 0; i < source.length; i += 1) {
    hash = (hash * 31 + source.charCodeAt(i)) >>> 0;
  }

  return `mock-${hash.toString(16)}`;
}

function makeBlocks(content: string): ApiLessonBlock[] {
  const parts = content
    .split('\n\n')
    .map((part) => part.trim())
    .filter(Boolean);

  return parts.map((text, index) => ({
    id: `block-${index + 1}`,
    type: 'paragraph',
    order: index + 1,
    text,
  }));
}

function toApiCourses(): ApiCourseCard[] {
  return MOCK_COURSES.map((course) => ({
    id: course.id,
    slug: course.id,
    title: course.title,
    description: course.description,
    difficulty: course.difficulty,
    category: course.category,
    imageUrl: course.imageUrl,
    totalModules: 1,
    totalLessons: course.totalLessons,
    publishedAt: null,
  }));
}

function toApiModules(): ApiModuleCard[] {
  return MOCK_COURSES.map((course) => ({
    id: `${course.id}-module-core`,
    courseId: course.id,
    slug: 'core',
    title: `${course.title} Core`,
    description: 'Core lesson track for this course.',
    order: 1,
    difficulty: course.difficulty,
    totalLessons: (MOCK_LESSONS[course.id] ?? []).length,
    estimatedMinutes: (MOCK_LESSONS[course.id] ?? []).length * 12,
  }));
}

function toApiLessons(modules: ApiModuleCard[]): ApiLessonPayload[] {
  const moduleByCourse = new Map<string, string>();
  modules.forEach((module) => {
    moduleByCourse.set(module.courseId, module.id);
  });

  return Object.values(MOCK_LESSONS)
    .flat()
    .map((lesson) => {
      const payload: ApiLessonPayload = {
        id: lesson.id,
        courseId: lesson.courseId,
        moduleId:
          moduleByCourse.get(lesson.courseId) ?? `${lesson.courseId}-module-core`,
        title: lesson.title,
        order: lesson.order,
        version: 1,
        releaseId: LOCAL_RELEASE_ID,
        blocks: makeBlocks(lesson.content),
        questions: lesson.questions.map((question) => ({
          id: question.id,
          type: question.type,
          prompt: question.prompt,
          options: question.options?.map((option, index) => ({
            id: typeof option === 'string' ? `option-${index + 1}` : option.id,
            text: typeof option === 'string' ? option : option.text,
          })),
          correctAnswer: question.correctAnswer,
        })),
        contentHash: '',
      };

      return {
        ...payload,
        contentHash: createContentHash({
          ...payload,
          contentHash: undefined,
        }),
      };
    });
}

export class MockContentProvider implements ContentProvider {
  async loadCatalogSnapshot(): Promise<CourseCatalogSnapshot> {
    const courses = toApiCourses();
    const modules = toApiModules();
    const lessons = toApiLessons(modules);
    const contentVersion: ApiContentVersion = {
      releaseId: LOCAL_RELEASE_ID,
      publishedAt: new Date().toISOString(),
    };

    return {
      courses,
      modules,
      lessons,
      contentVersion,
    };
  }
}
