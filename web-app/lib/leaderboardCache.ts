import type { LeaderboardEntry, LeaderboardSource } from '../services/api/types';

/**
 * The last leaderboard this device loaded, so a repeat visit paints at once
 * and refreshes quietly in the background. The board itself changes once a
 * day (a daily snapshot), so the saved copy is almost always current.
 *
 * Saved per wallet, so a different signed-in wallet never sees another's
 * "your standing" row. Entries hold display labels only: the API never sends
 * other players' addresses. Storage can throw or be empty (private mode,
 * cleared site data), so every access is guarded and a miss just means the
 * normal loading state.
 */
export interface CachedBoard {
  entries: LeaderboardEntry[];
  currentUser: LeaderboardEntry | null;
  snapshotAt: string | null;
  source: LeaderboardSource;
}

const keyFor = (wallet: string) => `locked-in:leaderboard:v1:${wallet}`;

/** The fields the page renders. Anything else is not a row this page saved. */
function isEntry(value: unknown): value is LeaderboardEntry {
  if (!value || typeof value !== 'object') return false;
  const e = value as Partial<LeaderboardEntry>;
  return (
    typeof e.rank === 'number' &&
    typeof e.displayIdentity === 'string' &&
    typeof e.streakLength === 'number' &&
    typeof e.streakStatus === 'string' &&
    typeof e.isCurrentUser === 'boolean'
  );
}

export function readCachedBoard(wallet: string | null): CachedBoard | null {
  if (!wallet) return null;
  try {
    const raw = localStorage.getItem(keyFor(wallet));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedBoard>;
    const currentUser = parsed.currentUser ?? null;
    // A malformed copy would crash the page on every visit until the refresh
    // replaced it, so it is a miss and is removed.
    if (
      !Array.isArray(parsed.entries) ||
      !parsed.entries.every(isEntry) ||
      (currentUser !== null && !isEntry(currentUser))
    ) {
      clearCachedBoard(wallet);
      return null;
    }
    return {
      entries: parsed.entries,
      currentUser,
      snapshotAt: typeof parsed.snapshotAt === 'string' ? parsed.snapshotAt : null,
      source: parsed.source === 'live' ? 'live' : 'materialized',
    };
  } catch {
    clearCachedBoard(wallet);
    return null;
  }
}

export function writeCachedBoard(wallet: string | null, board: CachedBoard): void {
  if (!wallet) return;
  try {
    localStorage.setItem(keyFor(wallet), JSON.stringify(board));
  } catch {
    // Full or blocked storage: the page still works, just without the instant paint.
  }
}

export function clearCachedBoard(wallet: string | null): void {
  if (!wallet) return;
  try {
    localStorage.removeItem(keyFor(wallet));
  } catch {
    // Nothing to clear when storage is unavailable.
  }
}
