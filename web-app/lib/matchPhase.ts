import type { ArenaMatchPlayer } from '../types/arena';

type PlayerIdentity = Pick<ArenaMatchPlayer, 'walletLabel' | 'isMe' | 'walletAddress'>;

/**
 * Is this row the signed-in player? The server's isMe flag wins; the address
 * comparison only covers older responses that still carried full addresses.
 */
export function isMyPlayer(p: PlayerIdentity, myWallet: string | null): boolean {
  if (typeof p.isMe === 'boolean') return p.isMe;
  return Boolean(myWallet) && p.walletAddress === myWallet;
}

/** Short name for a player row: the server's label, else a shortened address. */
export function playerLabel(p: PlayerIdentity): string {
  if (p.walletLabel) return p.walletLabel;
  return p.walletAddress ? `${p.walletAddress.slice(0, 4)}…${p.walletAddress.slice(-4)}` : 'Player';
}

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
  players: (PlayerIdentity & Pick<ArenaMatchPlayer, 'submittedAt' | 'forfeited'>)[];
  myWallet: string | null;
}): MatchPhase {
  const done = (p: { submittedAt: string | null; forfeited?: boolean }) =>
    Boolean(p.submittedAt || p.forfeited);

  if (resolved || (players.length > 0 && players.every(done))) return 'resolved';

  const mine = players.find((p) => isMyPlayer(p, myWallet));
  if (mine && done(mine)) return 'waiting';
  return 'ready';
}
