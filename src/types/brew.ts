export type BrewModeId = 'slow' | 'focused' | 'intense' | 'overdrive';

export type BrewStatus = 'IDLE' | 'BREWING';

export interface BrewModeConfig {
  id: BrewModeId;
  label: string;
  symbol: string;
  cost: number;
  durationMs: number;
  durationLabel: string;
  ichorPerHour: number;
  bonusPercent: number;
}

export interface BrewData {
  status: BrewStatus;
  activeModeId: BrewModeId | null;
  startedAt: string | null;
  endsAt: string | null;
  ichorBalance: number;
  totalIchorProduced: number;
  brewsCompleted: number;
}

export const BREW_MODES: Record<BrewModeId, BrewModeConfig> = {
  slow: {
    id: 'slow',
    label: 'Slow Drip',
    symbol: '\u{1F9EA}',
    cost: 1,
    durationMs: 24 * 60 * 60 * 1000,
    durationLabel: '24h',
    ichorPerHour: 100,
    bonusPercent: 0,
  },
  focused: {
    id: 'focused',
    label: 'Focused Brew',
    symbol: '\u{2697}',
    cost: 1,
    durationMs: 8 * 60 * 60 * 1000,
    durationLabel: '8h',
    ichorPerHour: 108,
    bonusPercent: 8,
  },
  intense: {
    id: 'intense',
    label: 'Intense Boil',
    symbol: '\u{1F525}',
    cost: 1,
    durationMs: 4 * 60 * 60 * 1000,
    durationLabel: '4h',
    ichorPerHour: 115,
    bonusPercent: 15,
  },
  overdrive: {
    id: 'overdrive',
    label: 'Overdrive',
    symbol: '\u{26A1}',
    cost: 1,
    durationMs: 1 * 60 * 60 * 1000,
    durationLabel: '1h',
    ichorPerHour: 125,
    bonusPercent: 25,
  },
};

export const BREW_MODE_LIST: BrewModeConfig[] = [
  BREW_MODES.slow,
  BREW_MODES.focused,
  BREW_MODES.intense,
  BREW_MODES.overdrive,
];
