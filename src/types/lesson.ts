export type QuestionType = 'mcq' | 'short_text';
export type LessonBlockType = 'paragraph' | 'code' | 'callout' | 'image';

export interface LessonBlock {
  id: string;
  type: LessonBlockType;
  order: number;
  text?: string;
  language?: string;
  calloutTone?: 'info' | 'warning' | 'tip';
  caption?: string;
  imageUrl?: string;
}

export interface QuestionOption {
  id: string;
  text: string;
}

export interface Question {
  id: string;
  type: QuestionType;
  prompt: string;
  options?: Array<QuestionOption | string>;
  // Mock/offline lessons can still carry a local answer key.
  correctAnswer?: string;
}

export interface Lesson {
  id: string;
  courseId: string;
  moduleId?: string;
  title: string;
  order: number;
  content: string;
  blocks?: LessonBlock[];
  questions: Question[];
  version?: number;
  releaseId?: string;
  contentHash?: string;
}

export interface LessonProgress {
  lessonId: string;
  courseId: string;
  completed: boolean;
  score: number | null;
  completedAt: string | null;
}
