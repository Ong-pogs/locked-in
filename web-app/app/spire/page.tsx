'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { T } from '../../components/theme';
import { SpireBackground } from './SpireBackground';
import { StakePanel } from './StakePanel';
import { fetchWithAuth } from '../../services/api/httpClient';
import {
  createChallenge, getLadder, getMyArena, enterQueue, pollQueue, leaveQueue,
  getProposal, acceptProposal, declineProposal, type ArenaProposal,
} from '../../services/api/arena/arenaApi';
import { MatchProposal, useCountdown } from './MatchProposal';

// Matches PROPOSAL_COUNTDOWN_MS on the server; the window it enforces is a
// few seconds longer so a click already in flight still lands.
const PROPOSAL_COUNTDOWN_MS = 10_000;
import type { ArenaLadderRow, ArenaProfile, ArenaStakeEntry } from '../../types/arena';

function shortWallet(address: string) {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

export default function SpirePage() {
  const router = useRouter();
  const [ladder, setLadder] = useState<ArenaLadderRow[] | null>(null);
  const [profile, setProfile] = useState<ArenaProfile | null>(null);
  const [joinCode, setJoinCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [queueing, setQueueing] = useState(false);
  const [suggestLink, setSuggestLink] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Null unless a stake is riding on this season — decides whether a match
  // here is free or counts against the player's yield.
  const [liveStake, setLiveStake] = useState<ArenaStakeEntry | null>(null);
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

  async function onCreate() {
    setError(null);
    try {
      const match = await fetchWithAuth((t) => createChallenge(t));
      setJoinCode(match.joinCode);
      setCopied(false);
    } catch {
      setError('Could not create a challenge. Try again in a moment.');
    }
  }

  async function onCopy() {
    if (!joinCode) return;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/spire/join/${joinCode}`);
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
        router.push(`/spire/${state.matchId}`);
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
    } catch {
      setQueueing(false);
      setError('Could not join the queue.');
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
        router.push(`/spire/${proposal.matchId}`);
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
    <SpireBackground>
      <div className="mx-auto w-full max-w-2xl px-4 pb-8 pt-20">
        {/* Backed rather than bare: the tavern art is at its busiest behind the
            header, and small muted copy straight on top of it was hard to read. */}
        <header
          className="mb-6 rounded-lg px-4 py-3"
          style={{ background: 'rgba(6,6,12,0.62)', border: `1px solid ${T.borderDormant}` }}
        >
          <h1
            className="font-pixel text-xl tracking-wide"
            style={{ color: T.amber }}
            data-testid="arena-title"
          >
            Clockwork Spire
          </h1>
          <p className="mt-1 text-[12px]" style={{ color: T.textMutedStrong }}>
            Head-to-head recall. Seven questions, twenty seconds each, fastest correct wins.
            Free to play for rating and XP. Stake a course and a losing season costs it one
            yield tier — never your deposit, streak or shields.
          </p>
        </header>

        {/* Your standing */}
        <section
          className="mb-5 rounded-lg p-4"
          style={{ background: T.bgCard, border: `1px solid ${T.borderAlive}` }}
          data-testid="arena-profile"
        >
          <div className="flex items-baseline justify-between">
            <span className="font-pixel-mono text-[10px] uppercase tracking-[1px]" style={{ color: T.textMuted }}>
              Your rating
            </span>
            <span
              className="text-2xl font-bold"
              style={{ color: T.teal, fontVariantNumeric: 'tabular-nums' }}
              data-testid="arena-my-rating"
            >
              {profile?.rating ?? 1200}
            </span>
          </div>
          <div className="mt-1 font-pixel-mono text-[11px]" style={{ color: T.textMuted }}>
            {profile && profile.games > 0
              ? `${profile.games} played · ${profile.wins}W ${profile.losses}L ${profile.draws}D`
              : 'Unranked — play your first match to join the ladder'}
          </div>
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
            here with nothing saying whether pressing one cost anything, so a
            player could not tell free play from a staked match. */}
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span
            className="font-pixel-mono text-[10px] uppercase tracking-[1px]"
            style={{ color: T.textMuted }}
          >
            Play a match
          </span>
          <span
            data-testid="arena-match-mode"
            className="rounded-full px-2.5 py-1 text-[10px] font-semibold"
            style={{
              background: liveStake ? 'rgba(255,68,102,0.10)' : 'rgba(255,255,255,0.05)',
              border: `1px solid ${liveStake ? 'rgba(255,68,102,0.35)' : T.borderDormant}`,
              color: liveStake ? T.crimson : T.textMutedStrong,
            }}
          >
            {liveStake
              ? 'Counts toward your stake'
              : 'Free play · nothing at stake'}
          </span>
        </div>

        <section className="mb-6 grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={onCreate}
            data-testid="arena-create-challenge"
            className="rounded-lg px-4 py-3 text-left transition-colors"
            style={{ background: T.bgCardActive, border: `1px solid ${T.borderAlive}`, color: T.textPrimary }}
          >
            <span className="block font-pixel text-[13px]" style={{ color: T.amber }}>Challenge a friend</span>
            <span className="mt-1 block text-[11px]" style={{ color: T.textMuted }}>
              Get a link. Whoever opens it plays your exact questions.
            </span>
          </button>

          <button
            type="button"
            onClick={queueing ? onCancelQueue : onFindOpponent}
            data-testid="arena-find-opponent"
            className="rounded-lg px-4 py-3 text-left transition-colors"
            style={{ background: T.bgCardActive, border: `1px solid ${T.borderDormant}`, color: T.textPrimary }}
          >
            <span className="block font-pixel text-[13px]" style={{ color: T.teal }}>
              {queueing ? 'Searching… tap to cancel' : 'Find an opponent'}
            </span>
            <span className="mt-1 block text-[11px]" style={{ color: T.textMuted }}>
              {queueing ? 'Looking for someone else in the queue.' : 'Pairs you with anyone else waiting.'}
            </span>
          </button>
        </section>

        {/* The queue is usually empty at this size — say so instead of spinning. */}
        {suggestLink && (
          <div
            className="mb-5 rounded-lg p-3 text-[12px]"
            style={{ background: 'rgba(212,160,74,0.06)', border: `1px solid ${T.borderAlive}`, color: T.textPrimary }}
            data-testid="arena-queue-suggest-link"
          >
            Nobody else is in the queue right now. Challenging a friend by link works
            straight away — they do not need an account to open it.
          </div>
        )}

        {joinCode && (
          <div
            className="mb-6 rounded-lg p-4"
            style={{ background: T.bgCard, border: `1px solid ${T.borderAlive}` }}
            data-testid="arena-challenge-created"
          >
            <div className="font-pixel-mono text-[10px] uppercase tracking-[1px]" style={{ color: T.textMuted }}>
              Your challenge code
            </div>
            <div
              className="mt-1 font-pixel text-2xl tracking-[3px]"
              style={{ color: T.amber }}
              data-testid="arena-join-code"
            >
              {joinCode}
            </div>
            <button
              type="button"
              onClick={onCopy}
              data-testid="arena-copy-link"
              className="mt-3 rounded px-3 py-2 font-pixel-mono text-[11px]"
              style={{ background: T.bgCardActive, border: `1px solid ${T.borderAlive}`, color: T.textPrimary }}
            >
              {copied ? 'Link copied' : 'Copy invite link'}
            </button>
            <div className="mt-2 text-[11px]" style={{ color: T.textMuted }}>
              Expires in 24 hours. You can play your half any time before then.
            </div>
          </div>
        )}

        {error && (
          <div className="mb-5 text-[12px]" style={{ color: T.crimson }} data-testid="arena-error">
            {error}
          </div>
        )}

        {/* Ladder */}
        <section>
          <h2 className="mb-2 font-pixel-mono text-[10px] uppercase tracking-[1px]" style={{ color: T.textMuted }}>
            Ladder
          </h2>
          <div
            className="overflow-hidden rounded-lg"
            style={{ background: T.bgCard, border: `1px solid ${T.borderDormant}` }}
          >
            {ladder === null && (
              <div className="p-4 text-[12px]" style={{ color: T.textMuted }}>Loading…</div>
            )}
            {ladder?.length === 0 && (
              <div className="p-5 text-center" data-testid="arena-ladder-empty">
                <div className="font-pixel text-[13px]" style={{ color: T.textPrimary }}>
                  Nobody has played yet
                </div>
                <div className="mt-1 text-[11px]" style={{ color: T.textMuted }}>
                  Win the first match and the top of this board is yours.
                </div>
              </div>
            )}
            {ladder?.map((row) => (
              <div
                key={row.walletAddress}
                data-testid="arena-ladder-row"
                className="flex items-center justify-between px-4 py-2"
                style={{ borderTop: `1px solid ${T.borderDormant}` }}
              >
                <span className="font-pixel-mono text-[11px]" style={{ color: T.textMuted }}>
                  #{row.rank}
                </span>
                <span className="flex-1 px-3 font-pixel-mono text-[11px]" style={{ color: T.textPrimary }}>
                  {shortWallet(row.walletAddress)}
                </span>
                <span className="font-pixel-mono text-[11px]" style={{ color: T.textMuted }}>
                  {row.wins}W {row.losses}L
                </span>
                <span
                  className="ml-3 text-[14px] font-bold"
                  style={{ color: T.teal, fontVariantNumeric: 'tabular-nums' }}
                >
                  {row.rating}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </SpireBackground>
  );
}
