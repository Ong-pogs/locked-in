import { describe, it, expect } from 'vitest';
import { resolveMatchPhase, isMyPlayer, playerLabel } from '../../lib/matchPhase';

const ME = 'MeWa11et1111111111111111111111111111111111';
const THEM = 'ThemWa11et22222222222222222222222222222222';

const player = (walletAddress: string, submittedAt: string | null, forfeited = false) =>
  ({ walletAddress, startedAt: null, submittedAt, forfeited });

describe('resolveMatchPhase', () => {
  it('shows the ready screen when I have not played', () => {
    expect(resolveMatchPhase({
      resolved: false,
      players: [player(ME, null), player(THEM, null)],
      myWallet: ME,
    })).toBe('ready');
  });

  it('WAITS when I am done and my opponent is not', () => {
    // The regression: this used to return 'ready', so a player who finished
    // and reloaded was asked "Ready?" for a match they had already played.
    expect(resolveMatchPhase({
      resolved: false,
      players: [player(ME, '2026-09-13T00:00:00Z'), player(THEM, null)],
      myWallet: ME,
    })).toBe('waiting');
  });

  it('still waits when my row is second in the array', () => {
    // The old check found the first player with submittedAt, which could be
    // the opponent — so the answer depended on array order.
    expect(resolveMatchPhase({
      resolved: false,
      players: [player(THEM, null), player(ME, '2026-09-13T00:00:00Z')],
      myWallet: ME,
    })).toBe('waiting');
  });

  it('does NOT wait when only my opponent has played', () => {
    expect(resolveMatchPhase({
      resolved: false,
      players: [player(ME, null), player(THEM, '2026-09-13T00:00:00Z')],
      myWallet: ME,
    })).toBe('ready');
  });

  it('resolves once both have played', () => {
    expect(resolveMatchPhase({
      resolved: false,
      players: [player(ME, '2026-09-13T00:00:00Z'), player(THEM, '2026-09-13T00:01:00Z')],
      myWallet: ME,
    })).toBe('resolved');
  });

  it('trusts the server when it says the match is resolved', () => {
    expect(resolveMatchPhase({
      resolved: true,
      players: [player(ME, null), player(THEM, null)],
      myWallet: ME,
    })).toBe('resolved');
  });

  it('treats a forfeit as having played', () => {
    expect(resolveMatchPhase({
      resolved: false,
      players: [player(ME, null, true), player(THEM, null)],
      myWallet: ME,
    })).toBe('waiting');
    expect(resolveMatchPhase({
      resolved: false,
      players: [player(ME, null, true), player(THEM, null, true)],
      myWallet: ME,
    })).toBe('resolved');
  });

  it('falls back to ready when my wallet is not on an unfinished match', () => {
    // A stale session should not be told it is waiting on a match it is not in.
    expect(resolveMatchPhase({
      resolved: false,
      players: [player(THEM, '2026-09-13T00:00:00Z'), player(ME, null)],
      myWallet: null,
    })).toBe('ready');
  });

  it('reports a finished match as resolved even to a stranger', () => {
    // Everyone having played IS the definition of resolved; who is looking
    // does not change that.
    expect(resolveMatchPhase({
      resolved: false,
      players: [player(THEM, '2026-09-13T00:00:00Z')],
      myWallet: null,
    })).toBe('resolved');
  });
});

// The server now sends a label and an isMe flag instead of full addresses, so
// an opponent's wallet never reaches the browser. Older responses still carry
// walletAddress, and both shapes must work during the rollout.
describe('server-labelled players (no addresses)', () => {
  const labelled = (isMe: boolean, submittedAt: string | null) =>
    ({ walletLabel: isMe ? 'MeWa…1111' : 'Them…2222', isMe, startedAt: null, submittedAt });

  it('finds my row by the server isMe flag', () => {
    expect(resolveMatchPhase({
      resolved: false,
      players: [labelled(false, null), labelled(true, '2026-09-13T00:00:00Z')],
      myWallet: ME,
    })).toBe('waiting');
  });

  it('trusts isMe over a matching address', () => {
    expect(isMyPlayer({ isMe: false, walletAddress: ME }, ME)).toBe(false);
    expect(isMyPlayer({ isMe: true }, null)).toBe(true);
  });

  it('falls back to the address on older responses', () => {
    expect(isMyPlayer({ walletAddress: ME }, ME)).toBe(true);
    expect(isMyPlayer({ walletAddress: THEM }, ME)).toBe(false);
    expect(isMyPlayer({ walletAddress: ME }, null)).toBe(false);
  });

  it('labels a player from the server label, else a shortened address', () => {
    expect(playerLabel({ walletLabel: 'Them…2222' })).toBe('Them…2222');
    expect(playerLabel({ walletAddress: THEM })).toBe('Them…2222');
    expect(playerLabel({})).toBe('Player');
  });
});
