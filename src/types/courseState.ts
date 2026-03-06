import type { FlameState } from './flame';

export type FuelEarnStatus =
  | 'PAUSED_RECOVERY'
  | 'AT_CAP'
  | 'EARNED_TODAY'
  | 'AVAILABLE';

export interface CourseGameState {
  // Lock
  lockAmount: number;
  lockDuration: 30 | 60 | 90;
  lockStartDate: string | null;
  extensionDays: number;

  // Gauntlet
  gauntletActive: boolean;
  gauntletDay: number; // 1-7, 0 if complete

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

  // Brew
  brewStatus: 'IDLE' | 'BREWING';
  brewModeId: string | null;
  brewStartedAt: string | null;
  brewEndsAt: string | null;
  ichorBalance: number;
  totalIchorProduced: number;

  // Flame (visual state, derived from streak)
  flameState: FlameState;
  lightIntensity: number;
}

export const DEFAULT_COURSE_STATE: CourseGameState = {
  lockAmount: 0,
  lockDuration: 30,
  lockStartDate: null,
  extensionDays: 0,
  gauntletActive: true,
  gauntletDay: 1,
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
  brewStatus: 'IDLE',
  brewModeId: null,
  brewStartedAt: null,
  brewEndsAt: null,
  ichorBalance: 0,
  totalIchorProduced: 0,
  flameState: 'COLD',
  lightIntensity: 0.05,
};
