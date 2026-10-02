/**
 * Wallet privacy for responses that list OTHER players (arena ladder and matches,
 * leaderboard, community pot recipients).
 *
 * Full wallet addresses must never be sent in those lists: even when the UI only
 * shows a shortened address, the browser's Network tab would expose the full one.
 * These pure helpers shape the rows on the server, before anything is sent.
 */

/**
 * Short display label, the same shape the Arena UI has always shown:
 * first 4 + "…" + last 4 (for example "7Vt9…GDL6"). Values too short to be a
 * real address get a neutral label instead of being echoed back.
 */
export function walletLabel(address) {
  if (typeof address !== 'string' || address.length <= 8) return 'Player';
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

/**
 * Public ladder rows: each row's address becomes a label, plus `isMe`, which is
 * true only on the signed-in viewer's own row. The viewer never needs anyone's
 * full address (including their own) to highlight their row.
 */
export function toPublicLadderRows(rows, viewerWallet = null) {
  return rows.map(({ walletAddress, ...rest }) => ({
    ...rest,
    walletLabel: walletLabel(walletAddress),
    isMe: Boolean(viewerWallet) && walletAddress === viewerWallet,
  }));
}

/**
 * Arena match players: same shape as the ladder (a label plus `isMe`). The
 * other participant is often a stranger from the queue, so even a player in
 * the match never gets their opponent's full address.
 */
export const toPublicMatchPlayers = toPublicLadderRows;

/**
 * Community pot recipients: a label instead of the address for everyone. The
 * payout signature and raw send error are kept only on the viewer's own row,
 * because either one names the recipient's wallet on a block explorer.
 */
export function toPublicPotRecipients(rows, viewerWallet = null) {
  return rows.map(({ walletAddress, transactionSignature, lastError, ...rest }) => {
    const isCurrentUser = Boolean(viewerWallet) && walletAddress === viewerWallet;
    return {
      ...rest,
      displayIdentity: walletLabel(walletAddress),
      transactionSignature: isCurrentUser ? transactionSignature ?? null : null,
      lastError: isCurrentUser ? lastError ?? null : null,
      isCurrentUser,
    };
  });
}

/**
 * Leaderboard response without wallet addresses. The UI already uses
 * `displayIdentity` (a shortened address) and `isCurrentUser`, so nothing else
 * changes. Internal callers keep using the full snapshot.
 */
export function withoutLeaderboardAddresses(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return snapshot;
  const strip = (entry) => {
    if (!entry || typeof entry !== 'object') return entry;
    const { walletAddress: _omit, ...rest } = entry;
    return rest;
  };
  return {
    ...snapshot,
    currentUser: snapshot.currentUser ? strip(snapshot.currentUser) : snapshot.currentUser,
    entries: Array.isArray(snapshot.entries) ? snapshot.entries.map(strip) : snapshot.entries,
  };
}
