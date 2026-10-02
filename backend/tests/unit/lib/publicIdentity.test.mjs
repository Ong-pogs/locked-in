import { describe, it, expect } from 'vitest';
import {
  walletLabel,
  toPublicLadderRows,
  withoutLeaderboardAddresses,
  toPublicMatchPlayers,
  toPublicPotRecipients,
} from '../../../src/lib/publicIdentity.mjs';

// Address-like 44-character strings (the shape of real Solana wallets).
const ALICE = '7Vt9qL2xR8mK4pN6sJ3wF5hY1cB9dZ0aE2gT7uGDL6';
const BOB = '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin';

// True if any string anywhere in the value equals the full address.
const containsAddress = (value, address) => JSON.stringify(value).includes(address);

describe('walletLabel', () => {
  it('keeps the first 4 and last 4 characters around an ellipsis', () => {
    expect(walletLabel(ALICE)).toBe('7Vt9…GDL6');
  });

  it('never echoes values too short to be a real address', () => {
    expect(walletLabel('abc')).toBe('Player');
    expect(walletLabel('')).toBe('Player');
    expect(walletLabel(null)).toBe('Player');
  });
});

describe('toPublicLadderRows', () => {
  const rows = [
    { walletAddress: ALICE, rating: 1250, games: 3, wins: 2, losses: 1, draws: 0, rank: 1 },
    { walletAddress: BOB, rating: 1190, games: 2, wins: 0, losses: 2, draws: 0, rank: 2 },
  ];

  it('replaces every address with a label and drops the address field', () => {
    const out = toPublicLadderRows(rows);
    expect(out.map((r) => r.walletLabel)).toEqual(['7Vt9…GDL6', '9xQe…VFin']);
    for (const r of out) expect(r).not.toHaveProperty('walletAddress');
    expect(containsAddress(out, ALICE)).toBe(false);
    expect(containsAddress(out, BOB)).toBe(false);
  });

  it('keeps the ranking data unchanged', () => {
    const [first] = toPublicLadderRows(rows);
    expect(first).toMatchObject({ rating: 1250, games: 3, wins: 2, losses: 1, draws: 0, rank: 1 });
  });

  it('flags only the signed-in viewer row, without sending any address', () => {
    const out = toPublicLadderRows(rows, BOB);
    expect(out.map((r) => r.isMe)).toEqual([false, true]);
    expect(containsAddress(out, BOB)).toBe(false);
  });

  it('flags nobody for anonymous visitors', () => {
    expect(toPublicLadderRows(rows, null).every((r) => r.isMe === false)).toBe(true);
  });
});

describe('withoutLeaderboardAddresses', () => {
  const snapshot = {
    source: 'materialized',
    page: 1,
    currentUser: { rank: 2, walletAddress: BOB, displayIdentity: '9xQe...VFin', isCurrentUser: true },
    entries: [
      { rank: 1, walletAddress: ALICE, displayIdentity: '7Vt9...GDL6', lockedPrincipalAmountUi: '25', isCurrentUser: false },
      { rank: 2, walletAddress: BOB, displayIdentity: '9xQe...VFin', lockedPrincipalAmountUi: '10', isCurrentUser: true },
    ],
  };

  it('removes addresses from entries and the current user, keeping everything else', () => {
    const out = withoutLeaderboardAddresses(snapshot);
    expect(containsAddress(out, ALICE)).toBe(false);
    expect(containsAddress(out, BOB)).toBe(false);
    expect(out.entries[0]).toEqual({ rank: 1, displayIdentity: '7Vt9...GDL6', lockedPrincipalAmountUi: '25', isCurrentUser: false });
    expect(out.currentUser).toEqual({ rank: 2, displayIdentity: '9xQe...VFin', isCurrentUser: true });
    expect(out).toMatchObject({ source: 'materialized', page: 1 });
  });

  it('does not mutate the input snapshot (internal callers still need it)', () => {
    withoutLeaderboardAddresses(snapshot);
    expect(snapshot.entries[0].walletAddress).toBe(ALICE);
  });

  it('handles an empty board', () => {
    expect(withoutLeaderboardAddresses({ currentUser: null, entries: [] })).toEqual({ currentUser: null, entries: [] });
  });
});

describe('toPublicMatchPlayers', () => {
  // In a queue match the opponent is a stranger, so their address must not be
  // sent even to the other participant.
  const players = [
    { walletAddress: ALICE, startedAt: null, submittedAt: '2026-10-02T00:00:00Z', correctCount: 5 },
    { walletAddress: BOB, startedAt: null, submittedAt: null },
  ];

  it('labels both players, flags the viewer, and sends no address', () => {
    const out = toPublicMatchPlayers(players, ALICE);
    expect(out.map((p) => p.walletLabel)).toEqual(['7Vt9…GDL6', '9xQe…VFin']);
    expect(out.map((p) => p.isMe)).toEqual([true, false]);
    for (const p of out) expect(p).not.toHaveProperty('walletAddress');
    expect(containsAddress(out, ALICE)).toBe(false);
    expect(containsAddress(out, BOB)).toBe(false);
  });

  it('keeps the score fields unchanged', () => {
    expect(toPublicMatchPlayers(players, BOB)[0]).toMatchObject({
      submittedAt: '2026-10-02T00:00:00Z',
      correctCount: 5,
    });
  });
});

describe('toPublicPotRecipients', () => {
  const recipients = [
    {
      walletAddress: ALICE,
      courseId: 'defi-basics',
      payoutAmountUi: '1.20',
      transactionSignature: 'sigAlice',
      lastError: `failed for ${ALICE}`,
    },
    {
      walletAddress: BOB,
      courseId: 'wallets-101',
      payoutAmountUi: '0.80',
      transactionSignature: 'sigBob',
      lastError: null,
    },
  ];

  it('sends no full address for anyone, including the viewer', () => {
    const out = toPublicPotRecipients(recipients, BOB);
    for (const r of out) expect(r).not.toHaveProperty('walletAddress');
    expect(containsAddress(out, ALICE)).toBe(false);
    expect(containsAddress(out, BOB)).toBe(false);
    expect(out.map((r) => r.displayIdentity)).toEqual(['7Vt9…GDL6', '9xQe…VFin']);
  });

  it('keeps payout signature and error only on the viewer row', () => {
    // A signature or a raw send error names the recipient on a block explorer.
    const [alice, bob] = toPublicPotRecipients(recipients, BOB);
    expect(alice).toMatchObject({ isCurrentUser: false, transactionSignature: null, lastError: null });
    expect(bob).toMatchObject({ isCurrentUser: true, transactionSignature: 'sigBob' });
  });

  it('keeps the payout data for everyone', () => {
    const [alice] = toPublicPotRecipients(recipients, null);
    expect(alice).toMatchObject({ courseId: 'defi-basics', payoutAmountUi: '1.20', isCurrentUser: false });
  });
});
