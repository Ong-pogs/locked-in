import type { FlameState } from './flame';

export type FuelEarnStatus =
  | 'PAUSED_RECOVERY'
  | 'AT_CAP'
  | 'EARNED_TODAY'
  | 'AVAILABLE';

export interface CourseGameState {
  // Lock
  lockAmount: number;
  lockDuration: 14 | 30 | 45 | 60 | 90 | 180 | 365;
  lockStartDate: string | null;
  lockAccountAddress: string | null;
  stableMintAddress: string | null;
  extensionDays: number;

  // Streak
  currentStreak: number;
  longestStreak: number;
  // Legacy-compatible: number of savers already consumed (0-3).
  saverCount: number;
  saverRecoveryMode: boolean;
  lastCompletedDate: string | null;
  todayCompleted: boolean;
  currentYieldRedirectBps: number;

  // Fuel
  fuelCounter: number;
  fuelCap: number;
  lastFuelCreditDay: string | null;
  lastBrewerBurnTs: string | null;
  fuelFragmentsToday: number;

  // Ichor
  ichorBalance: number;
  totalIchorProduced: number;

  // Flame (visual state, derived from streak)
  flameState: FlameState;
  lightIntensity: number;

  // Local completion timestamp (epoch ms) for sync guard
  lastLocalCompletionAt: number | null;

  // v2 shield/lapse engine (spec §4.2) — synced from the backend snapshot.
  shields: number;
  lapseCount: number;
  lapseOpen: boolean;
  consecutiveLessonDays: number;
  completedToday: boolean;
  dayEndsAtUtc: string | null;
  voucherAvailable: boolean;
}

export const DEFAULT_COURSE_STATE: CourseGameState = {
  lockAmount: 0,
  lockDuration: 30,
  lockStartDate: null,
  lockAccountAddress: null,
  stableMintAddress: null,
  extensionDays: 0,
  currentStreak: 0,
  longestStreak: 0,
  saverCount: 0,
  saverRecoveryMode: false,
  lastCompletedDate: null,
  todayCompleted: false,
  currentYieldRedirectBps: 0,
  fuelCounter: 0,
  fuelCap: 7,
  lastFuelCreditDay: null,
  lastBrewerBurnTs: null,
  fuelFragmentsToday: 0,
  ichorBalance: 0,
  totalIchorProduced: 0,
  flameState: 'COLD',
  lightIntensity: 0.05,
  lastLocalCompletionAt: null,
  shields: 3,
  lapseCount: 0,
  lapseOpen: false,
  consecutiveLessonDays: 0,
  completedToday: false,
  dayEndsAtUtc: null,
  voucherAvailable: false,
};
