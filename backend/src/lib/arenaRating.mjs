// Elo rating for the arena ladder. Pure — no database, no clock, no I/O.
//
// Rating used to buy nothing, and that was what made the damper below a
// sufficient anti-collusion measure on its own. As of the stake seasons (0065)
// it is no longer true: a player may stake one course lock on a season, and a
// season finishing behind costs that lock a yield tier.
//
// The damper is therefore no longer the only control. A staked season is scored
// on linked matches only, and the third meeting of a pair within one season
// stops counting entirely — see lib/arenaSeason.mjs. Rating still buys no
// shields, no pot share and no principal.

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
