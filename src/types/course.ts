export type CourseDifficulty = 'beginner' | 'intermediate' | 'advanced';
export type CourseCategory = 'solana' | 'web3' | 'defi' | 'security';

export interface Course {
  id: string;
  title: string;
  description: string;
  totalLessons: number;
  completedLessons: number;
  difficulty: CourseDifficulty;
  category: CourseCategory;
  imageUrl: string | null;
}
