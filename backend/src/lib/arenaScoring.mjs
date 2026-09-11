// Pure match scoring for the arena. No database, no clock, no I/O.

export const ARENA_QUESTION_COUNT = 7;
export const ARENA_QUESTION_TIMEOUT_MS = 20_000;

// Elapsed time is always derived from the server's own served_at stamp, but it
// still gets clamped: a clock that jumps backwards must not produce a negative
// (and therefore unbeatable) time, and an abandoned tab must not produce a
// multi-hour one.
//
// Garbage fails SAFE, to the cap rather than to zero. A NaN (say, a null
// served_at) resolving to 0 would hand out a perfect, unbeatable time — the
// exact wrong direction for a value that decides who wins.
export function clampElapsed(ms) {
  if (Number.isNaN(ms) || ms === undefined || ms === null) return ARENA_QUESTION_TIMEOUT_MS;
  if (ms < 0) return 0;
  if (!Number.isFinite(ms)) return ARENA_QUESTION_TIMEOUT_MS;
  return Math.min(Math.round(ms), ARENA_QUESTION_TIMEOUT_MS);
}

// Returns { outcome, scoreA } where outcome is 'A' | 'B' | 'DRAW' | 'VOID'.
// 'VOID' means: settle the match, but change nobody's rating and award no XP.
export function resolveMatch(a, b) {
  // Neither player ever played. Without this branch the comparator below reads
  // two forfeits as a legitimate draw and moves the Elo of two people who
  // never entered the match.
  if (a.forfeited && b.forfeited) {
    return { outcome: 'VOID', scoreA: null };
  }

  if (a.correctCount !== b.correctCount) {
    return a.correctCount > b.correctCount
      ? { outcome: 'A', scoreA: 1 }
      : { outcome: 'B', scoreA: 0 };
  }

  if (a.totalMs !== b.totalMs) {
    return a.totalMs < b.totalMs
      ? { outcome: 'A', scoreA: 1 }
      : { outcome: 'B', scoreA: 0 };
  }

  return { outcome: 'DRAW', scoreA: 0.5 };
}
