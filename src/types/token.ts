export interface TokenData {
  /** Accumulated fragments (0.1–0.4 per activity) */
  fragments: number;
  /** Full M tokens (1 fragment = 1 when fragments >= 1) */
  fullTokens: number;
  /** Tokens earned today (cap: 1/day) */
  dailyEarned: number;
  /** Max tokens held in wallet (cap: 7–14) */
  walletCap: number;
}

export interface EarnHistoryEntry {
  date: string;
  amount: number;
  source: 'lesson' | 'quiz' | 'streak_bonus';
}
