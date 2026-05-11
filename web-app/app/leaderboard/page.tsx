'use client';

import { useCallback, useEffect, useState } from 'react';
import { Flame } from 'lucide-react';
import { T } from '@/components/theme';
import { CozyCard } from '@/components/cozy';
import { HubButton } from '@/components/HubButton';
import { fetchWithAuth, AuthExpiredError } from '@/services/api/httpClient';
import { getLeaderboard } from '@/services/api/progress/progressApi';
import type { LeaderboardEntry } from '@/services/api/types';

const AMBER = '#FFD580';

/* ──────────────────────────────────────────────────────────────────────
   Streak-only leaderboard. The backend's /v1/progress/leaderboard returns
   real users sorted by streakLength (with currentUser pre-extracted).
   XP and Ichor totals aren't in that endpoint — those tabs were dropped
   until the backend exposes per-user aggregates.
   ────────────────────────────────────────────────────────────────────── */

export default function LeaderboardPage() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [currentUser, setCurrentUser] = useState<LeaderboardEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBoard = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const resp = await fetchWithAuth((token) =>
        getLeaderboard(token, { page: 1, pageSize: 10 }),
      );
      if (signal?.aborted) return;
      setEntries(resp.entries);
      setCurrentUser(resp.currentUser);
      setError(null);
      setLoading(false);
    } catch (err) {
      if (signal?.aborted) return;
      if (err instanceof AuthExpiredError) {
        setError('Connect your wallet to see the leaderboard.');
      } else {
        setError(err instanceof Error ? err.message : 'Failed to load.');
      }
      setEntries([]);
      setCurrentUser(null);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchBoard(controller.signal);
    return () => {
      controller.abort();
    };
  }, [fetchBoard]);

  const top3 = entries.slice(0, 3);
  const rest = entries.slice(3, 10);
  const [first, second, third] = top3;

  return (
    <div className="min-h-screen relative" style={{ backgroundColor: T.bg }}>
      {/* Tavern bg — most "social" location, fits leaderboard theme */}
      <div aria-hidden className="fixed inset-0 z-0 pointer-events-none">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/images/tavern/tavernbackground.png"
          alt=""
          draggable={false}
          className="w-full h-full object-cover select-none"
          style={{ imageRendering: 'pixelated' }}
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = 'none';
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(180deg, rgba(14,14,28,0.30) 0%, rgba(14,14,28,0.55) 60%, rgba(14,14,28,0.78) 100%)',
          }}
        />
      </div>

      <HubButton />

      <div className="relative z-10 max-w-[1100px] mx-auto px-[18px] pb-10">
        <div className="pt-20" />

        <h1
          className="text-3xl font-bold tracking-wide font-pixel"
          style={{ color: AMBER, textShadow: '0 1px 2px rgba(0,0,0,0.85)' }}
        >
          Leaderboard
        </h1>
        <div className="mb-5" />

        {loading ? (
          <CozyCard>
            <p className="font-pixel-mono text-[12px]" style={{ color: T.textSecondary }}>
              Reading the rolls of honor...
            </p>
          </CozyCard>
        ) : error ? (
          <CozyCard>
            <p className="font-pixel-mono text-[12px]" style={{ color: AMBER }}>
              {error}
            </p>
            <button
              onClick={() => {
                setError(null);
                void fetchBoard();
              }}
              className="mt-3 px-4 py-2 rounded-md border text-[11px] font-semibold uppercase tracking-wide font-pixel cursor-pointer"
              style={{
                borderColor: 'rgba(255,213,128,0.45)',
                backgroundColor: 'rgba(255,213,128,0.10)',
                color: AMBER,
              }}
            >
              Retry
            </button>
          </CozyCard>
        ) : entries.length === 0 ? (
          <CozyCard>
            <p className="font-pixel-mono text-[12px]" style={{ color: T.textSecondary }}>
              No streaks recorded yet. Be the first.
            </p>
          </CozyCard>
        ) : (
          <>
            <SectionHeader>The Champions</SectionHeader>

            {/* Podium row — silver | gold (center, tallest) | bronze. Each
                slot only renders if there's an entry for that rank, so an
                under-3-entry leaderboard still looks intentional. */}
            <div className="grid grid-cols-3 gap-3 mb-6 items-end">
              {second ? (
                <PodiumCard entry={second} place="silver" height={220} />
              ) : (
                <div />
              )}
              {first ? (
                <PodiumCard entry={first} place="gold" height={260} />
              ) : (
                <div />
              )}
              {third ? (
                <PodiumCard entry={third} place="bronze" height={200} />
              ) : (
                <div />
              )}
            </div>

            {rest.length > 0 && (
              <>
                <SectionHeader muted>The Pursuers</SectionHeader>
                <CozyCard style={{ padding: 0, overflow: 'hidden' }} className="mb-5">
                  {rest.map((entry, i) => (
                    <PursuerRow key={entry.walletAddress} entry={entry} alt={i % 2 === 0} />
                  ))}
                </CozyCard>
              </>
            )}
          </>
        )}

        {/* Your Standing — only show when current user is on the board */}
        {currentUser && (
          <>
            <SectionHeader muted>Your Standing</SectionHeader>
            <CozyCard
              style={{
                padding: 16,
                border: `2px solid ${AMBER}`,
                boxShadow:
                  '0 6px 20px rgba(0,0,0,0.45), 0 0 24px rgba(255,213,128,0.20), inset 0 1px 0 rgba(255,213,128,0.20)',
              }}
            >
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    className="font-pixel-mono text-[18px] font-bold shrink-0"
                    style={{ color: AMBER, textShadow: '0 1px 2px rgba(0,0,0,0.85)' }}
                  >
                    #{currentUser.rank}
                  </span>
                  <p
                    className="text-[14px] font-bold font-pixel truncate"
                    style={{ color: AMBER, textShadow: '0 1px 2px rgba(0,0,0,0.85)' }}
                  >
                    {currentUser.displayIdentity}
                  </p>
                  <span
                    className="font-pixel-mono text-[8px] uppercase tracking-[1px] px-1.5 py-0.5 rounded shrink-0"
                    style={{ color: '#1A1000', backgroundColor: AMBER }}
                  >
                    you
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Flame size={14} color="#E8845A" strokeWidth={2.5} />
                  <span
                    className="font-pixel-mono text-[14px] font-bold"
                    style={{ color: '#E8845A', textShadow: '0 1px 2px rgba(0,0,0,0.85)' }}
                  >
                    {currentUser.streakLength}
                  </span>
                  <span
                    className="font-pixel-mono text-[10px] uppercase tracking-[1px]"
                    style={{ color: T.textMuted }}
                  >
                    {currentUser.streakStatus === 'broken' ? 'broken' : 'day streak'}
                  </span>
                </div>
              </div>
            </CozyCard>
          </>
        )}
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────
   Shared bits
   ────────────────────────────────────────────────────────────────────── */

function SectionHeader({ children, muted }: { children: React.ReactNode; muted?: boolean }) {
  return (
    <p
      className="font-pixel-mono text-[12px] font-bold uppercase tracking-[2px] mb-3"
      style={{
        color: muted ? T.textMuted : AMBER,
        textShadow: muted ? undefined : '0 1px 2px rgba(0,0,0,0.85)',
        opacity: muted ? 0.7 : 0.85,
      }}
    >
      {children}
    </p>
  );
}

const PLACE_THEME: Record<
  'gold' | 'silver' | 'bronze',
  { stripe: string; glow: string; rank: number; medal: string; label: string }
> = {
  gold: {
    stripe: '#FFD700',
    glow: 'rgba(255,215,0,0.35)',
    rank: 1,
    medal: '🥇',
    label: 'Champion',
  },
  silver: {
    stripe: '#C0C0C0',
    glow: 'rgba(192,192,192,0.30)',
    rank: 2,
    medal: '🥈',
    label: 'Runner-up',
  },
  bronze: {
    stripe: '#CD7F32',
    glow: 'rgba(205,127,50,0.30)',
    rank: 3,
    medal: '🥉',
    label: 'Third',
  },
};

function PodiumCard({
  entry,
  place,
  height,
}: {
  entry: LeaderboardEntry;
  place: 'gold' | 'silver' | 'bronze';
  height: number;
}) {
  const theme = PLACE_THEME[place];
  const broken = entry.streakStatus === 'broken';
  return (
    <CozyCard
      className="flex flex-col items-center text-center"
      style={{
        padding: 0,
        overflow: 'hidden',
        minHeight: height,
        border: `2px solid ${theme.stripe}80`,
        boxShadow: `0 6px 20px rgba(0,0,0,0.45), 0 0 24px ${theme.glow}, inset 0 1px 0 rgba(255,213,128,0.12)`,
      }}
    >
      {/* Top stripe */}
      <div
        className="w-full py-1.5 font-pixel-mono text-[10px] uppercase tracking-[2px] font-bold"
        style={{
          color: '#1A1000',
          backgroundColor: theme.stripe,
        }}
      >
        {theme.label}
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-3 py-4 gap-2">
        <span className="text-[28px] leading-none">{theme.medal}</span>
        <span
          className="font-pixel-mono text-[36px] font-bold leading-none"
          style={{ color: theme.stripe, textShadow: '0 1px 2px rgba(0,0,0,0.85)' }}
        >
          #{entry.rank}
        </span>
        <p
          className="text-[13px] font-bold font-pixel truncate w-full"
          style={{ color: AMBER, textShadow: '0 1px 2px rgba(0,0,0,0.85)' }}
        >
          {entry.displayIdentity}
        </p>
        <div className="mt-1 flex flex-col items-center">
          <span
            className="font-pixel-mono text-[9px] uppercase tracking-[1.5px]"
            style={{ color: T.textMuted }}
          >
            {broken ? 'Streak broken' : 'Streak'}
          </span>
          <span
            className="font-pixel-mono text-[18px] font-bold"
            style={{
              color: broken ? T.crimson : '#E8845A',
              textShadow: '0 1px 2px rgba(0,0,0,0.85)',
            }}
          >
            {entry.streakLength}
          </span>
        </div>
      </div>
    </CozyCard>
  );
}

function PursuerRow({ entry, alt }: { entry: LeaderboardEntry; alt?: boolean }) {
  const broken = entry.streakStatus === 'broken';
  return (
    <div
      className="grid items-center gap-3 px-4 py-2.5"
      style={{
        gridTemplateColumns: '50px 1fr 110px',
        borderBottom: `1px dashed rgba(255,213,128,0.10)`,
        background: alt ? 'rgba(255,213,128,0.025)' : 'transparent',
      }}
    >
      <span
        className="font-pixel-mono text-[13px] font-bold"
        style={{ color: AMBER, textShadow: '0 1px 2px rgba(0,0,0,0.85)' }}
      >
        #{entry.rank}
      </span>
      <p
        className="text-[12px] font-bold font-pixel truncate"
        style={{
          color: entry.isCurrentUser ? AMBER : 'rgba(255,255,255,0.92)',
          textShadow: '0 1px 2px rgba(0,0,0,0.85)',
        }}
      >
        {entry.displayIdentity}
        {entry.isCurrentUser && (
          <span
            className="font-pixel-mono text-[8px] uppercase tracking-[1px] px-1.5 py-0.5 rounded ml-2"
            style={{ color: '#1A1000', backgroundColor: AMBER }}
          >
            you
          </span>
        )}
      </p>
      <div className="text-right">
        <span
          className="font-pixel-mono text-[13px] font-bold"
          style={{
            color: broken ? T.crimson : '#E8845A',
            textShadow: '0 1px 2px rgba(0,0,0,0.85)',
          }}
        >
          {entry.streakLength}
        </span>
      </div>
    </div>
  );
}
