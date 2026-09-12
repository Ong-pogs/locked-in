export interface ArenaOption {
  id: string;
  text: string;
}

/** What the server serves for one question. Deliberately has no answer key. */
export interface ArenaQuestion {
  id: string;
  order: number;
  prompt: string;
  options: ArenaOption[];
  timeoutMs: number;
}

export type ArenaMatchStatus = 'OPEN' | 'ACTIVE' | 'COMPLETE' | 'EXPIRED';

export interface ArenaMatchPlayer {
  walletAddress: string;
  startedAt: string | null;
  submittedAt: string | null;
  /** Only present once the match has resolved. */
  correctCount?: number;
  totalMs?: number;
  forfeited?: boolean;
}

export interface ArenaMatchState {
  matchId: string;
  status: ArenaMatchStatus;
  origin: 'link' | 'queue';
  joinCode: string | null;
  creator: string;
  opponent: string | null;
  season: number;
  expiresAt: string;
  resolvedAt: string | null;
  questionCount: number;
  resolved: boolean;
  players: ArenaMatchPlayer[];
}

export interface ArenaCreatedMatch {
  matchId: string;
  joinCode: string;
  expiresAt: string;
}

export interface ArenaStartResponse {
  questionsTotal: number;
  question: ArenaQuestion | null;
  answered: number;
  total: number;
}

export interface ArenaAnswerResponse {
  isCorrect: boolean;
  answered: number;
  correctCount: number;
  totalMs: number;
  done: boolean;
  question: ArenaQuestion | null;
}

export interface ArenaLadderRow {
  walletAddress: string;
  rating: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  rank: number;
}

export interface ArenaRecentMatch {
  matchId: string;
  status: ArenaMatchStatus;
  origin: 'link' | 'queue';
  resolvedAt: string | null;
  delta: number | null;
  correctCount: number | null;
  totalMs: number | null;
}

export interface ArenaProfile {
  rating: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  recentMatches: ArenaRecentMatch[];
}

export interface ArenaQueueState {
  matched: boolean;
  matchId?: string;
  waiting?: boolean;
  waitedMs?: number;
  /** True once the wait is long enough that a link challenge is the better bet. */
  suggestLink?: boolean;
}

export type ArenaStakeOutcome = 'PENDING' | 'KEPT' | 'FORFEIT' | 'VOID';

export interface ArenaSeason {
  id: number;
  startsAt: string;
  endsAt: string;
  status: 'OPEN' | 'CLOSED' | 'SETTLED';
}

export interface ArenaStakeEntry {
  stakeSeasonId: number;
  courseId: string;
  lockAddress: string;
  optedInAt: string;
  ratingAtStart: number;
  ratingAtEnd: number | null;
  outcome: ArenaStakeOutcome;
  voidedReason: string | null;
  settledAt: string | null;
  startsAt: string;
  endsAt: string;
  seasonStatus: ArenaSeason['status'];
  /** Summed rating delta over counted staked matches — this decides the season. */
  stakedDelta: number;
  matchesCounted: number;
  /** Missed-day lapses on the staked course. A forfeit costs a tier ON TOP. */
  lapseCount: number;
  /** False once this entry's season has ended — the next one can be staked. */
  isCurrentSeason: boolean;
}

export interface ArenaStakeResult {
  season: ArenaSeason;
  entry: ArenaStakeEntry;
  created: boolean;
}
