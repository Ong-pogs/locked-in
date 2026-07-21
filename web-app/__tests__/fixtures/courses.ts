import type { Course, CourseLockPolicy, CourseModule, Lesson, LessonBlock, Question } from '@/types';

export function buildLockPolicy(overrides?: Partial<CourseLockPolicy>): CourseLockPolicy {
  return {
    minPrincipalAmountUi: '10',
    maxPrincipalAmountUi: '100',
    demoPrincipalAmountUi: '1',
    minLockDurationDays: 10,
    maxLockDurationDays: 30,
    ...overrides,
  };
}

export function buildCourse(overrides?: Partial<Course>): Course {
  return {
    id: 'course-1',
    title: 'Solana 101',
    description: 'Learn Solana fundamentals',
    totalLessons: 10,
    completedLessons: 0,
    difficulty: 'beginner',
    category: 'solana',
    imageUrl: null,
    lockPolicy: buildLockPolicy(),
    ...overrides,
  };
}

export function buildLesson(overrides?: Partial<Lesson>): Lesson {
  return {
    id: 'lesson-1',
    courseId: 'course-1',
    moduleId: 'module-1',
    title: 'What is Solana?',
    order: 1,
    content: 'Solana is a high-performance blockchain.',
    blocks: [],
    questions: [],
    ...overrides,
  };
}

export function buildModule(overrides?: Partial<CourseModule>): CourseModule {
  return {
    id: 'module-1',
    courseId: 'course-1',
    slug: 'introduction',
    title: 'Introduction',
    description: 'Getting started with Solana',
    order: 1,
    difficulty: 'beginner',
    totalLessons: 3,
    estimatedMinutes: 15,
    ...overrides,
  };
}

export function buildQuestion(overrides?: Partial<Question>): Question {
  return {
    id: 'question-1',
    type: 'mcq',
    prompt: 'What consensus mechanism does Solana use?',
    options: [
      { id: 'a', text: 'Proof of History' },
      { id: 'b', text: 'Proof of Work' },
      { id: 'c', text: 'Proof of Stake' },
    ],
    correctAnswer: 'a',
    ...overrides,
  };
}

export function buildBlock(overrides?: Partial<LessonBlock>): LessonBlock {
  return {
    id: 'block-1',
    type: 'paragraph',
    order: 1,
    text: 'This is a lesson paragraph.',
    ...overrides,
  };
}
