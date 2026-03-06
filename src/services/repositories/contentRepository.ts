import { getContentProvider } from '@/services/api';
import type { Course, CourseModule, Lesson, QuestionOption } from '@/types';
import type {
  ApiCourseCard,
  ApiLessonBlock,
  ApiLessonPayload,
  ApiQuestionOption,
} from '@/services/api/types';

export interface HydratedContentSnapshot {
  courses: Course[];
  modulesByCourse: Record<string, CourseModule[]>;
  lessonsByCourse: Record<string, Lesson[]>;
  releaseId: string;
  publishedAt: string;
}

function toLessonContent(blocks: ApiLessonBlock[]): string {
  if (blocks.length === 0) {
    return '';
  }

  return blocks
    .sort((a, b) => a.order - b.order)
    .map((block) => block.text ?? '')
    .filter(Boolean)
    .join('\n\n');
}

function toCourse(course: ApiCourseCard): Course {
  return {
    id: course.id,
    slug: course.slug,
    title: course.title,
    description: course.description,
    totalLessons: course.totalLessons,
    completedLessons: 0,
    totalModules: course.totalModules,
    difficulty: course.difficulty,
    category: course.category,
    publishedAt: course.publishedAt,
    imageUrl: course.imageUrl,
  };
}

function toQuestionOptions(
  options?: ApiQuestionOption[],
): QuestionOption[] | undefined {
  return options?.map((option) => ({
    id: option.id,
    text: option.text,
  }));
}

function toLesson(lesson: ApiLessonPayload): Lesson {
  return {
    id: lesson.id,
    courseId: lesson.courseId,
    moduleId: lesson.moduleId,
    title: lesson.title,
    order: lesson.order,
    content: toLessonContent(lesson.blocks),
    blocks: lesson.blocks.map((block) => ({
      id: block.id,
      type: block.type,
      order: block.order,
      text: block.text,
      language: block.language,
      calloutTone: block.calloutTone,
      caption: block.caption,
      imageUrl: block.imageUrl,
    })),
    questions: lesson.questions.map((question) => ({
      id: question.id,
      type: question.type,
      prompt: question.prompt,
      options: toQuestionOptions(question.options),
      correctAnswer: question.correctAnswer,
    })),
    version: lesson.version,
    releaseId: lesson.releaseId,
    contentHash: lesson.contentHash,
  };
}

function groupByCourse<T extends { courseId: string }>(items: T[]): Record<string, T[]> {
  return items.reduce<Record<string, T[]>>((acc, item) => {
    if (!acc[item.courseId]) {
      acc[item.courseId] = [];
    }
    acc[item.courseId].push(item);
    return acc;
  }, {});
}

export async function loadHydratedContentSnapshot(): Promise<HydratedContentSnapshot> {
  const provider = getContentProvider();
  const snapshot = await provider.loadCatalogSnapshot();

  const courses = snapshot.courses.map(toCourse);

  const modulesByCourse = groupByCourse(
    snapshot.modules
      .map((module) => ({
        id: module.id,
        courseId: module.courseId,
        slug: module.slug,
        title: module.title,
        description: module.description,
        order: module.order,
        difficulty: module.difficulty,
        totalLessons: module.totalLessons,
        estimatedMinutes: module.estimatedMinutes,
      }))
      .sort((a, b) => a.order - b.order),
  );

  const lessonsByCourse = groupByCourse(
    snapshot.lessons
      .map(toLesson)
      .sort((a, b) => a.order - b.order),
  );

  return {
    courses,
    modulesByCourse,
    lessonsByCourse,
    releaseId: snapshot.contentVersion.releaseId,
    publishedAt: snapshot.contentVersion.publishedAt,
  };
}
