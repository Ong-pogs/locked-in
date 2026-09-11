// Elo rating for the arena ladder. Pure — no database, no clock, no I/O.
//
// Rating buys nothing: it is not convertible into yield, shields, pot share or
// principal. That is deliberate, and it is what makes the damper below a
// sufficient anti-collusion measure rather than a partial one.

export const ARENA_START_RATING = 1200;
export const ARENA_BASE_K = 32;

export function expectedScore(ratingA, ratingB) {
  return 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
}

// Anti-collusion: the nth rated match against the SAME opponent inside the
// rolling window is worth K/n. Two accounts trading wins converge on zero gain
// within a handful of games, while a genuine rivalry's first meetings still
// count fully.
export function effectiveK(recentMatchesVsSameOpponent) {
  const n = Math.max(0, Math.floor(recentMatchesVsSameOpponent || 0)) + 1;
  return Math.max(1, Math.round(ARENA_BASE_K / n));
}

// scoreA: 1 win, 0.5 draw, 0 loss (from A's perspective).
export function applyElo({ ratingA, ratingB, scoreA, priorMeetings = 0 }) {
  const k = effectiveK(priorMeetings);
  const deltaA = Math.round(k * (scoreA - expectedScore(ratingA, ratingB)));
  // Derive B's delta by negation rather than rounding a second time, so the
  // ladder stays exactly zero-sum and cannot inflate through rounding drift.
  return {
    ratingA: ratingA + deltaA,
    ratingB: ratingB - deltaA,
    deltaA,
    deltaB: -deltaA,
  };
}
