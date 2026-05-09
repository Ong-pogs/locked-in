'use client';

import { useEffect, useState } from 'react';
import { Flame, Sparkles, Droplet } from 'lucide-react';
import { T } from '@/components/theme';
import { CozyCard } from '@/components/cozy';
import { HubButton } from '@/components/HubButton';
import { useCourseStore, useUserStore } from '@/stores';
import { fetchWithAuth } from '@/services/api/httpClient';
import { getUserXp } from '@/services/api/progress/progressApi';

const AMBER = '#FFD580';
const COZY_BORDER = 'rgba(58, 143, 168, 0.45)';

/* ──────────────────────────────────────────────────────────────────────
   Player + metric types
   ────────────────────────────────────────────────────────────────────── */

type Player = {
  rank: number;
  handle: string;
  streak: number;
  xp: number;
  ichor: number;
  isMe?: boolean;
};

type Metric = 'streak' | 'xp' | 'ichor';

const METRIC_OPTIONS: {
  id: Metric;
  label: string;
  Icon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
  color: string;
}[] = [
  { id: 'streak', label: 'Streak', Icon: Flame, color: '#E8845A' },
  { id: 'xp', label: 'XP', Icon: Sparkles, color: '#FFD580' },
  { id: 'ichor', label: 'Ichor', Icon: Droplet, color: '#2AE8D4' },
];

// TODO: replace with real leaderboard API once backend exposes streak/xp/ichor
// ranking endpoint. Existing GET /v1/progress/leaderboard returns streak +
// locked-principal data only — no XP or ichor totals — so the top-10 list
// here is mocked. The user's own row pulls live data from Zustand + getUserXp.
const MOCK_TOP_10: Player[] = [
  { rank: 1, handle: 'EmberKnight', streak: 124, xp: 14820, ichor: 9300 },
  { rank: 2, handle: 'mossbinder', streak: 98, xp: 13100, ichor: 7400 },
  { rank: 3, handle: 'lanternFox', streak: 87, xp: 11200, ichor: 6850 },
  { rank: 4, handle: 'wickwitch', streak: 72, xp: 9800, ichor: 5500 },
  { rank: 5, handle: 'cinderscholar', streak: 64, xp: 8420, ichor: 4900 },
  { rank: 6, handle: 'pyrekeeper', streak: 51, xp: 7300, ichor: 4100 },
  { rank: 7, handle: 'ashveil', streak: 47, xp: 6200, ichor: 3550 },
  { rank: 8, handle: 'tindersprite', streak: 42, xp: 5800, ichor: 3210 },
  { rank: 9, handle: 'flickerquill', streak: 38, xp: 5100, ichor: 2980 },
  { rank: 10, handle: 'kindlemoth', streak: 34, xp: 4700, ichor: 2700 },
];

/* ──────────────────────────────────────────────────────────────────────
   Helpers
   ────────────────────────────────────────────────────────────────────── */

function metricValue(p: Player, m: Metric) {
  return p[m];
}

function metricColor(m: Metric) {
  return METRIC_OPTIONS.find((o) => o.id === m)!.color;
}

function metricLabel(m: Metric) {
  return METRIC_OPTIONS.find((o) => o.id === m)!.label;
}

function truncateWallet(addr: string | null): string {
  if (!addr) return 'you (Adventurer)';
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
}

/* ──────────────────────────────────────────────────────────────────────
   Page
   ────────────────────────────────────────────────────────────────────── */

export default function LeaderboardPage() {
  const [selectedMetric, setSelectedMetric] = useState<Metric>('streak');

  // Real user data
  const displayName = useUserStore((s) => s.displayName);
  const walletAddress = useUserStore((s) => s.walletAddress);
  const courseStates = useCourseStore((s) => s.courseStates);

  const [xpTotal, setXpTotal] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchWithAuth(getUserXp)
      .then((data) => {
        if (!cancelled && data) setXpTotal(data.xpTotal);
      })
      .catch(() => {
        /* leave xpTotal at 0 if call fails */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Streak: longest across all course states
  const userStreak = Math.max(
    0,
    ...Object.values(courseStates).map((s) => s?.longestStreak ?? 0),
  );

  // Ichor: sum across all course states
  const userIchor = Object.values(courseStates).reduce(
    (acc, s) => acc + (s?.ichorBalance ?? 0),
    0,
  );

  const userHandle = displayName || truncateWallet(walletAddress);

  // TODO: replace with real backend rank lookup once leaderboard API
  // returns a per-user rank for arbitrary metrics.
  const ME: Player = {
    rank: 47,
    handle: userHandle,
    streak: userStreak,
    xp: xpTotal,
    ichor: userIchor,
    isMe: true,
  };

  const sorted = [...MOCK_TOP_10].sort(
    (a, b) => metricValue(b, selectedMetric) - metricValue(a, selectedMetric),
  );
  const top3 = sorted.slice(0, 3).map((p, i) => ({ ...p, rank: i + 1 }));
  const rest = sorted.slice(3, 10).map((p, i) => ({ ...p, rank: i + 4 }));
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
        <p className="text-sm leading-[18px] mb-5" style={{ color: 'rgba(255,255,255,0.6)' }}>
          Top players by streak, XP, and ichor
        </p>

        <MetricTabs selected={selectedMetric} onChange={setSelectedMetric} />
        <SectionHeader>The Champions</SectionHeader>

        {/* Podium row — silver | gold (center, tallest) | bronze */}
        <div className="grid grid-cols-3 gap-3 mb-6 items-end">
          <PodiumCard player={second} metric={selectedMetric} place="silver" height={220} />
          <PodiumCard player={first} metric={selectedMetric} place="gold" height={260} />
          <PodiumCard player={third} metric={selectedMetric} place="bronze" height={200} />
        </div>

        <SectionHeader muted>The Pursuers</SectionHeader>
        <CozyCard style={{ padding: 0, overflow: 'hidden' }} className="mb-5">
          {rest.map((p, i) => (
            <PodiumListRow
              key={p.handle}
              player={p}
              metric={selectedMetric}
              alt={i % 2 === 0}
            />
          ))}
        </CozyCard>

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
                #{ME.rank}
              </span>
              <p
                className="text-[14px] font-bold font-pixel truncate"
                style={{ color: AMBER, textShadow: '0 1px 2px rgba(0,0,0,0.85)' }}
              >
                {ME.handle}
              </p>
              <span
                className="font-pixel-mono text-[8px] uppercase tracking-[1px] px-1.5 py-0.5 rounded shrink-0"
                style={{ color: '#1A1000', backgroundColor: AMBER }}
              >
                you
              </span>
            </div>
            <div className="flex items-center gap-4">
              {METRIC_OPTIONS.map((opt) => {
                const Icon = opt.Icon;
                return (
                  <div key={opt.id} className="flex items-center gap-1.5">
                    <Icon size={12} color={opt.color} strokeWidth={2.5} />
                    <span
                      className="font-pixel-mono text-[13px] font-bold"
                      style={{ color: opt.color, textShadow: '0 1px 2px rgba(0,0,0,0.85)' }}
                    >
                      {ME[opt.id].toLocaleString()}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </CozyCard>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────
   Shared bits
   ────────────────────────────────────────────────────────────────────── */

function MetricTabs({
  selected,
  onChange,
}: {
  selected: Metric;
  onChange: (m: Metric) => void;
}) {
  return (
    <div className="flex items-center gap-2 mb-4 flex-wrap">
      {METRIC_OPTIONS.map((opt) => {
        const active = selected === opt.id;
        const Icon = opt.Icon;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(opt.id)}
            className="flex items-center gap-2 px-4 py-2 rounded-full text-[11px] font-bold uppercase tracking-[1.5px] font-pixel-mono transition-colors cursor-pointer"
            style={{
              color: active ? '#1A1000' : AMBER,
              backgroundColor: active ? AMBER : 'rgba(14,14,28,0.50)',
              border: `1px solid ${active ? AMBER : COZY_BORDER}`,
              backdropFilter: 'blur(10px)',
              WebkitBackdropFilter: 'blur(10px)',
            }}
          >
            <Icon size={12} color={active ? '#1A1000' : opt.color} strokeWidth={2.5} />
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

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

/* ──────────────────────────────────────────────────────────────────────
   Podium card (top-3 hero) + list row (4-10)
   ────────────────────────────────────────────────────────────────────── */

const PLACE_THEME: Record<
  'gold' | 'silver' | 'bronze',
  { stripe: string; glow: string; rank: number; medal: string }
> = {
  gold: { stripe: '#FFD700', glow: 'rgba(255,215,0,0.35)', rank: 1, medal: '🥇' },
  silver: { stripe: '#C0C0C0', glow: 'rgba(192,192,192,0.30)', rank: 2, medal: '🥈' },
  bronze: { stripe: '#CD7F32', glow: 'rgba(205,127,50,0.30)', rank: 3, medal: '🥉' },
};

function PodiumCard({
  player,
  metric,
  place,
  height,
}: {
  player: Player;
  metric: Metric;
  place: 'gold' | 'silver' | 'bronze';
  height: number;
}) {
  const theme = PLACE_THEME[place];
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
        {place === 'gold' ? 'Champion' : place === 'silver' ? 'Runner-up' : 'Third'}
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-3 py-4 gap-2">
        <span className="text-[28px] leading-none">{theme.medal}</span>
        <span
          className="font-pixel-mono text-[36px] font-bold leading-none"
          style={{ color: theme.stripe, textShadow: '0 1px 2px rgba(0,0,0,0.85)' }}
        >
          #{theme.rank}
        </span>
        <p
          className="text-[13px] font-bold font-pixel truncate w-full"
          style={{ color: AMBER, textShadow: '0 1px 2px rgba(0,0,0,0.85)' }}
        >
          {player.handle}
        </p>
        <div className="mt-1 flex flex-col items-center">
          <span
            className="font-pixel-mono text-[9px] uppercase tracking-[1.5px]"
            style={{ color: T.textMuted }}
          >
            {metricLabel(metric)}
          </span>
          <span
            className="font-pixel-mono text-[18px] font-bold"
            style={{
              color: metricColor(metric),
              textShadow: '0 1px 2px rgba(0,0,0,0.85)',
            }}
          >
            {metricValue(player, metric).toLocaleString()}
          </span>
        </div>
      </div>
    </CozyCard>
  );
}

function PodiumListRow({
  player,
  metric,
  alt,
}: {
  player: Player;
  metric: Metric;
  alt?: boolean;
}) {
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
        #{player.rank}
      </span>
      <p
        className="text-[12px] font-bold font-pixel truncate"
        style={{ color: 'rgba(255,255,255,0.92)', textShadow: '0 1px 2px rgba(0,0,0,0.85)' }}
      >
        {player.handle}
      </p>
      <div className="text-right">
        <span
          className="font-pixel-mono text-[13px] font-bold"
          style={{
            color: metricColor(metric),
            textShadow: '0 1px 2px rgba(0,0,0,0.85)',
          }}
        >
          {metricValue(player, metric).toLocaleString()}
        </span>
      </div>
    </div>
  );
}
