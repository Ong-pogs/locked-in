/**
 * Wallet privacy for responses that list OTHER players (arena ladder, leaderboard).
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
