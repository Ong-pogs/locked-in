export type CourseDifficulty = 'beginner' | 'intermediate' | 'advanced';
export type CourseCategory = 'solana' | 'web3' | 'defi' | 'security' | 'rust';

export interface CourseLockPolicy {
  minPrincipalAmountUi: string;
  maxPrincipalAmountUi: string | null;
  demoPrincipalAmountUi: string | null;
  minLockDurationDays: number;
  maxLockDurationDays: number;
}

export function defaultCourseLockPolicyForDifficulty(
  difficulty: CourseDifficulty,
): CourseLockPolicy {
  switch (difficulty) {
    case 'advanced':
      return {
        minPrincipalAmountUi: '100',
        maxPrincipalAmountUi: null,
        demoPrincipalAmountUi: '1',
        minLockDurationDays: 90,
        maxLockDurationDays: 365,
      };
    case 'intermediate':
      return {
        minPrincipalAmountUi: '25',
        maxPrincipalAmountUi: '250',
        demoPrincipalAmountUi: '1',
        minLockDurationDays: 30,
        maxLockDurationDays: 90,
      };
    case 'beginner':
    default:
      return {
        minPrincipalAmountUi: '10',
        maxPrincipalAmountUi: '100',
        demoPrincipalAmountUi: '1',
        minLockDurationDays: 10,
        maxLockDurationDays: 30,
      };
  }
}

export interface Course {
  id: string;
  slug?: string;
  title: string;
  description: string;
  totalLessons: number;
  completedLessons: number;
  totalModules?: number;
  difficulty: CourseDifficulty;
  category: CourseCategory;
  publishedAt?: string | null;
  imageUrl: string | null;
  lockPolicy: CourseLockPolicy;
}
