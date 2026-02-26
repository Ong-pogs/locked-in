export interface StreakState {
  currentStreak: number;
  longestStreak: number;
  saverCount: 0 | 1 | 2 | 3;
  saverRecoveryMode: boolean;
  lastCompletedDate: string | null;
  /** Day number in the gauntlet/program (1-indexed) */
  dayNumber: number;
  /** Whether today's lesson has been completed */
  todayCompleted: boolean;
}
