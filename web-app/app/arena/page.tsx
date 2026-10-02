'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { T } from '../../components/theme';
import {
  CozyButton, CozyCard, CozySectionLabel, COZY_BORDER, COZY_TEXT, COZY_TEXT_SHADOW,
} from '../../components/cozy';
import { ArenaBackground } from './ArenaBackground';
import { StakePanel } from './StakePanel';
import { fetchWithAuth } from '../../services/api/httpClient';
import { ApiError } from '../../services/api/errors';
import {
  createChallenge, getLadder, getMyArena, enterQueue, pollQueue, leaveQueue,
  getProposal, acceptProposal, declineProposal, type ArenaProposal,
} from '../../services/api/arena/arenaApi';
import { MatchProposal, useCountdown } from './MatchProposal';

// Matches PROPOSAL_COUNTDOWN_MS on the server; the window it enforces is a
// few seconds longer so a click already in flight still lands.
const PROPOSAL_COUNTDOWN_MS = 10_000;
import type { ArenaLadderRow, ArenaProfile, ArenaStakeEntry } from '../../types/arena';

// Secondary copy on the frosted glass: the stronger muted white plus the cozy
// shadow, which is what keeps small text legible over the tavern art.
const MUTED_TEXT = { color: T.textMutedStrong, textShadow: COZY_TEXT_SHADOW };
// Card eyebrow labels ("Your rating", "Your challenge code") in the cozy amber.
const EYEBROW_TEXT = { color: COZY_TEXT, textShadow: COZY_TEXT_SHADOW };

function shortWallet(address: string) {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

export default function ArenaPage() {
  const router = useRouter();
  const [ladder, setLadder] = useState<ArenaLadderRow[] | null>(null);
  const [profile, setProfile] = useState<ArenaProfile | null>(null);
  const [joinCode, setJoinCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [queueing, setQueueing] = useState(false);
  const [suggestLink, setSuggestLink] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // undefined until the panel has looked: a player whose stake is still
  // loading must not be told they have none, and must not be let through
  // the door on the assumption that they have one.
  const [liveStake, setLiveStake] = useState<ArenaStakeEntry | null | undefined>(undefined);
  // The pairing offer, if one is open. Held as a deadline rather than a
  // countdown so a backgrounded tab cannot show time that has already gone.
  const [proposal, setProposal] = useState<ArenaProposal | null>(null);
  const [deadlineAt, setDeadlineAt] = useState<number | null>(null);
  const [proposalBusy, setProposalBusy] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    getLadder().then(setLadder).catch(() => setLadder([]));
    fetchWithAuth((t) => getMyArena(t)).then(setProfile).catch(() => setProfile(null));
  }, []);

  // Leaving the queue behind on unmount would keep pairing people with someone
  // who has navigated away.
  const stopPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  }, []);

  useEffect(() => () => {
    stopPolling();
    if (queueing) fetchWithAuth((t) => leaveQueue(t)).catch(() => {});
  }, [queueing, stopPolling]);

  // A stake can lapse between the panel loading and the button being pressed,
  // so the server's refusal gets its own sentence rather than "try again".
  const NEEDS_STAKE = 'Stake a course above before entering the Arena.';
  const failureText = (err: unknown, fallback: string) =>
    err instanceof ApiError && err.code === 'ARENA_STAKE_REQUIRED' ? NEEDS_STAKE : fallback;

  async function onCreate() {
    setError(null);
    try {
      const match = await fetchWithAuth((t) => createChallenge(t));
      setJoinCode(match.joinCode);
      setCopied(false);
    } catch (err) {
      setError(failureText(err, 'Could not create a challenge. Try again in a moment.'));
    }
  }

  async function onCopy() {
    if (!joinCode) return;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/arena/join/${joinCode}`);
      setCopied(true);
    } catch {
      // Clipboard can be blocked; the code is on screen to type either way.
      setCopied(false);
    }
  }

  // Turn a paired response into an open offer rather than navigating into a
  // match the other player may never turn up for.
  const openProposal = useCallback((p: ArenaProposal) => {
    setProposal(p);
    setDeadlineAt(Date.now() + p.msLeft);
  }, []);

  const closeProposal = useCallback(() => {
    setProposal(null);
    setDeadlineAt(null);
  }, []);

  const tick = useCallback(async () => {
    try {
      // An open offer is the only thing worth asking about while it stands.
      const p = await fetchWithAuth((t) => getProposal(t));
      if (p) {
        setProposal((prev) => {
          // Re-anchor the deadline only when the offer changes, so the bar
          // does not jitter on every poll.
          if (!prev || prev.matchId !== p.matchId) setDeadlineAt(Date.now() + p.msLeft);
          return p;
        });
        return;
      }
      closeProposal();

      const state = await fetchWithAuth((t) => pollQueue(t));
      if (state.matched && state.matchId && !state.proposal) {
        // Both accepted — the match is live.
        stopPolling();
        setQueueing(false);
        router.push(`/arena/${state.matchId}`);
      } else if (!state.matched && !state.waiting) {
        // Dropped out of the queue entirely (declined, or someone else took
        // the offer). Stop pretending to search.
        stopPolling();
        setQueueing(false);
      } else if (state.suggestLink) {
        setSuggestLink(true);
      }
    } catch {
      stopPolling();
      setQueueing(false);
      closeProposal();
    }
  }, [closeProposal, router, stopPolling]);

  async function onFindOpponent() {
    setError(null);
    setSuggestLink(false);
    setQueueing(true);
    try {
      const first = await fetchWithAuth((t) => enterQueue(t));
      if (first.matched && first.matchId) {
        const p = await fetchWithAuth((t) => getProposal(t));
        if (p) openProposal(p);
      }
      pollRef.current = setInterval(tick, 2000);
    } catch (err) {
      setQueueing(false);
      setError(failureText(err, 'Could not join the queue.'));
    }
  }

  async function onAcceptProposal() {
    if (!proposal) return;
    setProposalBusy(true);
    try {
      const res = await fetchWithAuth((t) => acceptProposal(t, proposal.matchId));
      if (res.ready) {
        stopPolling();
        closeProposal();
        setQueueing(false);
        router.push(`/arena/${proposal.matchId}`);
      } else {
        setProposal((p) => (p ? { ...p, accepted: true } : p));
      }
    } catch {
      // The offer died under us — fall back to searching.
      closeProposal();
      setError('That match offer expired. Still searching…');
    } finally {
      setProposalBusy(false);
    }
  }

  const onDeclineProposal = useCallback(async () => {
    const current = proposal;
    if (!current) return;
    setProposalBusy(true);
    stopPolling();
    closeProposal();
    setQueueing(false);
    setSuggestLink(false);
    try {
      await fetchWithAuth((t) => declineProposal(t, current.matchId));
    } catch {
      // Declining is best-effort: the window closes on its own either way.
    } finally {
      setProposalBusy(false);
    }
  }, [proposal, stopPolling, closeProposal]);

  // The client gate is a courtesy — the server refuses all three entrances
  // outright. Both exist: this one explains, that one enforces.
  const stakeKnown = liveStake !== undefined;
  const canPlay = Boolean(liveStake);

  const msLeft = useCountdown(deadlineAt);

  // Running out is a decline you did not have to click. Without this the offer
  // would sit on screen looking live while the server had already retired it.
  useEffect(() => {
    if (!proposal || deadlineAt == null || msLeft > 0) return;
    onDeclineProposal();
  }, [proposal, deadlineAt, msLeft, onDeclineProposal]);

  async function onCancelQueue() {
    stopPolling();
    closeProposal();
    setQueueing(false);
    setSuggestLink(false);
    await fetchWithAuth((t) => leaveQueue(t)).catch(() => {});
  }

  return (
    <ArenaBackground>
      <div className="mx-auto w-full max-w-2xl px-4 pb-8 pt-20">
        {/* Backed rather than bare: the tavern art is at its busiest behind the
            header, and small muted copy straight on top of it was hard to read.
            The backing is the shared frosted CozyCard, so the Arena matches the
            rest of the app. <header> stays the outer element for its semantics. */}
        <header className="mb-6">
          <CozyCard>
            <h1
              className="font-pixel text-2xl font-bold tracking-wide"
              style={{ color: COZY_TEXT, textShadow: COZY_TEXT_SHADOW }}
              data-testid="arena-title"
            >
              The Arena
            </h1>
            <p className="mt-1.5 font-pixel-mono text-[12px] leading-relaxed" style={MUTED_TEXT}>
              Head-to-head recall. Seven questions, twenty seconds each, fastest correct wins.
              Stake a course to enter. A losing season costs that course one yield tier —
              never your deposit, streak or shields.
            </p>
          </CozyCard>
        </header>

        {/* Your standing. The <section> keeps its test id; the glass is the
            CozyCard inside it (CozyCard always renders a <div>). */}
        <section className="mb-5" data-testid="arena-profile">
          <CozyCard>
            <div className="flex items-baseline justify-between">
              <span className="font-pixel-mono text-[10px] uppercase tracking-[1px]" style={EYEBROW_TEXT}>
                Your rating
              </span>
              {/* Silkscreen, like every stat number on the cozy pages. */}
              <span
                className="font-pixel-mono text-2xl font-bold"
                style={{ color: T.teal, textShadow: COZY_TEXT_SHADOW, fontVariantNumeric: 'tabular-nums' }}
                data-testid="arena-my-rating"
              >
                {profile?.rating ?? 1200}
              </span>
            </div>
            <div className="mt-1 font-pixel-mono text-[11px]" style={MUTED_TEXT}>
              {profile && profile.games > 0
                ? `${profile.games} played · ${profile.wins}W ${profile.losses}L ${profile.draws}D`
                : 'Unranked — play your first match to join the ladder'}
            </div>
          </CozyCard>
        </section>

        <StakePanel onLiveStakeChange={setLiveStake} />

        {proposal && (
          <MatchProposal
            msLeft={msLeft}
            totalMs={PROPOSAL_COUNTDOWN_MS}
            accepted={proposal.accepted}
            busy={proposalBusy}
            onAccept={onAcceptProposal}
            onDecline={onDeclineProposal}
          />
        )}

        {/* Actions. The header is load-bearing: these two buttons used to sit
            here with nothing saying what pressing one cost. Both are shut
            until a stake is riding, so the badge has to say which it is.
            Baseline-aligned so the badge text sits on the label's line; the
            label's own bottom margin spaces the row from what follows. */}
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <CozySectionLabel>Play a match</CozySectionLabel>
          {/* Sits straight on the art, so it gets the same dark glass base as a
              tinted CozyButton, with the tone mixed in when a stake is riding. */}
          <span
            data-testid="arena-match-mode"
            className="rounded-full px-2.5 py-1 font-pixel-mono text-[10px] uppercase tracking-[1px]"
            style={{
              background: canPlay
                ? `color-mix(in srgb, ${T.crimson} 14%, rgba(14, 14, 28, 0.82))`
                : 'rgba(14, 14, 28, 0.82)',
              border: `1px solid ${canPlay ? 'rgba(255,68,102,0.55)' : COZY_BORDER}`,
              color: canPlay ? T.crimson : T.textMutedStrong,
              textShadow: COZY_TEXT_SHADOW,
            }}
          >
            {!stakeKnown
              ? 'Checking your stake…'
              : canPlay
                ? 'Counts toward your stake'
                : 'Stake a course to enter'}
          </span>
        </div>

        {stakeKnown && !canPlay && (
          // Notices are compact CozyCards with an amber edge, so they read as
          // a note rather than another panel.
          <CozyCard
            className="mb-3 font-pixel-mono text-[12px] leading-relaxed"
            style={{
              padding: 14,
              borderColor: 'rgba(255,213,128,0.45)',
              color: T.textPrimary,
              textShadow: COZY_TEXT_SHADOW,
            }}
            data-testid="arena-stake-required"
          >
            The Arena only takes challengers with something on the line. Stake a course
            above to unlock both.
          </CozyCard>
        )}

        {/* Two-line tiles on the shared CozyButton (tint: glass, safe on the
            art). Its disabled state replaces the old inline 0.6 opacity, which
            tracked `disabled` exactly. A single block child keeps the button's
            centered row layout from pulling the title and hint apart. */}
        <section className="mb-6 grid gap-3 sm:grid-cols-2">
          <CozyButton
            tone="amber"
            onClick={onCreate}
            disabled={!canPlay}
            data-testid="arena-create-challenge"
            className="w-full"
          >
            <span className="block w-full text-left">
              <span className="block">Challenge a friend</span>
              <span className="mt-1 block text-[10px] leading-relaxed tracking-normal" style={MUTED_TEXT}>
                {canPlay
                  ? 'Get a link. Whoever opens it plays your exact questions.'
                  : 'Needs a staked course.'}
              </span>
            </span>
          </CozyButton>

          <CozyButton
            tone="teal"
            onClick={queueing ? onCancelQueue : onFindOpponent}
            disabled={!canPlay && !queueing}
            data-testid="arena-find-opponent"
            className="w-full"
          >
            <span className="block w-full text-left">
              <span className="block">
                {queueing ? 'Searching… tap to cancel' : 'Find an opponent'}
              </span>
              <span className="mt-1 block text-[10px] leading-relaxed tracking-normal" style={MUTED_TEXT}>
                {queueing
                  ? 'Looking for someone else in the queue.'
                  : canPlay
                    ? 'Pairs you with anyone else waiting.'
                    : 'Needs a staked course.'}
              </span>
            </span>
          </CozyButton>
        </section>

        {/* The queue is usually empty at this size — say so instead of spinning. */}
        {suggestLink && (
          <CozyCard
            className="mb-5 font-pixel-mono text-[12px] leading-relaxed"
            style={{
              padding: 14,
              borderColor: 'rgba(255,213,128,0.45)',
              color: T.textPrimary,
              textShadow: COZY_TEXT_SHADOW,
            }}
            data-testid="arena-queue-suggest-link"
          >
            Nobody else is in the queue right now. Challenging a friend by link works
            straight away — they do not need an account to open it.
          </CozyCard>
        )}

        {joinCode && (
          <CozyCard className="mb-6" data-testid="arena-challenge-created">
            <div className="font-pixel-mono text-[10px] uppercase tracking-[1px]" style={EYEBROW_TEXT}>
              Your challenge code
            </div>
            {/* Geist Mono, like the wallet addresses: the code alphabet has both
                S and 5, and both pixel faces draw them as the same glyph. A code
                people retype has to be unambiguous. */}
            <div
              className="mt-1 font-mono text-2xl font-bold tracking-[3px]"
              style={{ color: COZY_TEXT, textShadow: COZY_TEXT_SHADOW }}
              data-testid="arena-join-code"
            >
              {joinCode}
            </div>
            <CozyButton size="sm" onClick={onCopy} data-testid="arena-copy-link" className="mt-3">
              {copied ? 'Link copied' : 'Copy invite link'}
            </CozyButton>
            <div className="mt-2 font-pixel-mono text-[10px]" style={MUTED_TEXT}>
              Expires in 24 hours. You can play your half any time before then.
            </div>
          </CozyCard>
        )}

        {error && (
          <div
            className="mb-5 font-pixel-mono text-[12px]"
            style={{ color: T.crimson, textShadow: COZY_TEXT_SHADOW }}
            data-testid="arena-error"
          >
            {error}
          </div>
        )}

        {/* Ladder */}
        <section>
          {/* Kept an <h2> for heading navigation, so CozySectionLabel (which
              renders a <p>) is not used here; its look is mirrored instead. */}
          <h2
            className="mb-2.5 mt-1 font-pixel-mono text-[13px] font-bold uppercase tracking-[2px]"
            style={{ color: COZY_TEXT, textShadow: COZY_TEXT_SHADOW, opacity: 0.85 }}
          >
            Ladder
          </h2>
          {/* Flush rows inside one glass card, as on /leaderboard. */}
          <CozyCard style={{ padding: 0, overflow: 'hidden' }}>
            {ladder === null && (
              <div className="p-4 font-pixel-mono text-[12px]" style={MUTED_TEXT}>Loading…</div>
            )}
            {ladder?.length === 0 && (
              <div className="p-5 text-center" data-testid="arena-ladder-empty">
                <div className="font-pixel text-[14px]" style={{ color: COZY_TEXT, textShadow: COZY_TEXT_SHADOW }}>
                  Nobody has played yet
                </div>
                <div className="mt-1 font-pixel-mono text-[11px]" style={MUTED_TEXT}>
                  Win the first match and the top of this board is yours.
                </div>
              </div>
            )}
            {/* Dashed amber dividers like /leaderboard, with none above the
                first row so it does not double up with the card's own edge. */}
            {ladder?.map((row, i) => (
              <div
                key={row.walletAddress}
                data-testid="arena-ladder-row"
                className="flex items-center justify-between px-4 py-2.5"
                style={{ borderTop: i === 0 ? undefined : '1px dashed rgba(255,213,128,0.10)' }}
              >
                <span
                  className="font-pixel-mono text-[12px] font-bold"
                  style={{ color: COZY_TEXT, textShadow: COZY_TEXT_SHADOW, fontVariantNumeric: 'tabular-nums' }}
                >
                  #{row.rank}
                </span>
                {/* Geist Mono, not Silkscreen: base58 is case-sensitive and
                    Silkscreen has no lowercase glyphs, so "7Vt9" rendered as
                    "7VT9" — a different address than the one it names. */}
                <span
                  className="flex-1 px-3 font-mono text-[11px]"
                  style={{ color: T.textPrimary, textShadow: COZY_TEXT_SHADOW }}
                >
                  {shortWallet(row.walletAddress)}
                </span>
                <span
                  className="font-pixel-mono text-[11px]"
                  style={{ ...MUTED_TEXT, fontVariantNumeric: 'tabular-nums' }}
                >
                  {row.wins}W {row.losses}L
                </span>
                <span
                  className="ml-3 font-pixel-mono text-[14px] font-bold"
                  style={{ color: T.teal, textShadow: COZY_TEXT_SHADOW, fontVariantNumeric: 'tabular-nums' }}
                >
                  {row.rating}
                </span>
              </div>
            ))}
          </CozyCard>
        </section>
      </div>
    </ArenaBackground>
  );
}
