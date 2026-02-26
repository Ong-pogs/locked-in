export type FlameState = 'COLD' | 'LIT' | 'BURNING' | 'SPUTTERING';

export interface FlameData {
  flameState: FlameState;
  /** M tokens remaining as fuel (burns 1/day) */
  fuelRemaining: number;
  /** Timestamp of last fuel tick */
  lastTickAt: string | null;
  /** Light intensity 0-1 derived from flame state */
  lightIntensity: number;
}
