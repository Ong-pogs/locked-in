import type { ArenaMatchPlayer } from '../types/arena';

export type MatchPhase = 'ready' | 'playing' | 'waiting' | 'resolved' | 'error' | 'loading';

/**
 * Which screen a match should show, given what the server says about it.
 *
 * Pulled out of the page because getting it wrong is invisible: the old
 * version looked for "a player with submittedAt" rather than MY player, so it
 * matched the opponent just as readily, and its only other outcome was
 * 'ready'. A player who had finished and reloaded — or came back to check on
 * the match — was asked "Ready?" for a match they had already played, while
 * the waiting screen was unreachable except by submitting in that same
 * session.
 */
export function resolveMatchPhase({
  resolved,
  players,
  myWallet,
}: {
  resolved: boolean;
  players: Pick<ArenaMatchPlayer, 'walletAddress' | 'submittedAt' | 'forfeited'>[];
  myWallet: string | null;
}): MatchPhase {
  const done = (p: { submittedAt: string | null; forfeited?: boolean }) =>
    Boolean(p.submittedAt || p.forfeited);

  if (resolved || (players.length > 0 && players.every(done))) return 'resolved';

  const mine = players.find((p) => p.walletAddress === myWallet);
  if (mine && done(mine)) return 'waiting';
  return 'ready';
}
