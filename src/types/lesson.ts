export type QuestionType = 'mcq' | 'short_text';

export interface Question {
  id: string;
  type: QuestionType;
  prompt: string;
  options?: string[];
  correctAnswer: string;
}

export interface Lesson {
  id: string;
  courseId: string;
  title: string;
  order: number;
  content: string;
  questions: Question[];
}

export interface LessonProgress {
  lessonId: string;
  courseId: string;
  completed: boolean;
  score: number | null;
  completedAt: string | null;
}
