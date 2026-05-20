'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Home,
  LayoutDashboard,
  BookOpen,
  Beer,
  FlaskConical,
  ShoppingBag,
  Backpack,
  Trophy,
  Coins,
  GraduationCap,
} from 'lucide-react';
import { T } from '@/components/theme';
import { CozyCard, CozySectionLabel } from '@/components/cozy';

const AMBER = '#FFD580';
const COZY_BORDER = 'rgba(58, 143, 168, 0.45)';

type Entry = {
  route: string;
  label: string;
  blurb: string;
  Icon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
  building?: string;
  status?: 'live' | 'unmapped' | 'legacy';
};

const HUB_PAGES: Entry[] = [
  { route: '/village', label: 'Village Hub', blurb: 'Painted hub with hover-glow buildings', Icon: Home, status: 'live' },
  { route: '/dashboard', label: 'Dashboard', blurb: 'Identity + streak + fuel + ichor + heatmap + flame mgmt + courses + activity (merged from /profile). Reached via top-bar profile button.', Icon: LayoutDashboard, status: 'live' },
];

const BUILDING_PAGES: Entry[] = [
  { route: '/courses', label: 'Courses', blurb: 'Cozy course list on academy interior', Icon: BookOpen, building: 'Academy (left tudor)', status: 'live' },
  { route: '/community-pot', label: 'Community Pot', blurb: 'Yield distribution from broken streaks', Icon: Beer, building: 'Tavern (right-center)', status: 'live' },
  { route: '/alchemy', label: 'Brewery', blurb: 'Brew fuel into ichor', Icon: FlaskConical, building: 'Apothecary (right-end church)', status: 'live' },
  { route: '/shop', label: 'Shop', blurb: 'Cards (TCG) variant on market interior', Icon: ShoppingBag, building: 'Cottage (left-middle tudor)', status: 'live' },
];


const PLAYER_PAGES: Entry[] = [
  { route: '/inventory', label: 'Inventory', blurb: 'Categorized — Coffers / Consumables / Achievements', Icon: Backpack, building: 'Center awning stall', status: 'live' },
  { route: '/leaderboard', label: 'Leaderboard', blurb: 'Podium — top 3 hero + ranks 4-10', Icon: Trophy, building: 'Notice board', status: 'live' },
];

const ONBOARDING_PAGES: Entry[] = [
  { route: '/onboarding/deposit', label: 'Onboarding · Deposit', blurb: 'First-lock deposit flow (production, current wood/parchment styling)', Icon: Coins, status: 'live' },
  { route: '/onboarding/tutorial', label: 'Onboarding · Tutorial', blurb: 'New-user tutorial', Icon: GraduationCap, status: 'live' },
];



// Decorative-only village masks (no route, no hover-glow).
const UNUSED_BUILDINGS = [
  { id: 'clock', label: 'Clock tower', mask: 'mask-clock.png', suggestion: 'decorative' },
  { id: 'storage', label: 'Far-right tall structure', mask: 'mask-storage.png', suggestion: 'decorative (was wrong building for inventory)' },
];

export default function MenuPage() {
  const router = useRouter();

  return (
    <div className="min-h-screen relative" style={{ backgroundColor: T.bg }}>
      {/* Cottage interior bg as subtle backdrop. */}
      <div aria-hidden className="fixed inset-0 z-0 pointer-events-none">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/images/cottage/profilebackground.png"
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
              'linear-gradient(180deg, rgba(14,14,28,0.50) 0%, rgba(14,14,28,0.70) 60%, rgba(14,14,28,0.85) 100%)',
          }}
        />
      </div>

      {/* Top-left back button */}
      <button
        type="button"
        onClick={() => router.push('/village')}
        aria-label="Back to village hub"
        className="fixed top-4 left-4 z-40 flex items-center gap-2 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
        style={{
          padding: '8px 14px 8px 10px',
          borderRadius: 12,
          backgroundColor: 'rgba(14, 14, 28, 0.82)',
          border: `1px solid ${COZY_BORDER}`,
          boxShadow: '0 6px 20px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,213,128,0.12)',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
        }}
      >
        <ArrowLeft size={16} color={AMBER} strokeWidth={2.5} />
        <span
          className="font-pixel"
          style={{
            fontSize: 13, fontWeight: 600, letterSpacing: 0.4,
            color: AMBER, textShadow: '0 1px 2px rgba(0,0,0,0.85)',
          }}
        >
          Hub
        </span>
      </button>

      <div className="relative z-10 max-w-[1200px] mx-auto px-[18px] pt-20 pb-10">
        <h1
          className="text-3xl font-bold tracking-wide mb-1 font-pixel"
          style={{ color: AMBER, textShadow: '0 1px 2px rgba(0,0,0,0.85)' }}
        >
          Menu
        </h1>
        <p className="text-sm leading-[18px] mb-6" style={{ color: 'rgba(255,255,255,0.65)' }}>
          Quick access to every production page. Use this to verify designs without going through the village.
        </p>

        <CozySectionLabel>Hub</CozySectionLabel>
        <Grid entries={HUB_PAGES} />

        <CozySectionLabel>Buildings — currently mapped</CozySectionLabel>
        <Grid entries={BUILDING_PAGES} />

        <CozySectionLabel>Player pages</CozySectionLabel>
        <Grid entries={PLAYER_PAGES} />

        <CozySectionLabel>Onboarding</CozySectionLabel>
        <Grid entries={ONBOARDING_PAGES} />

        <CozySectionLabel>Unmapped buildings — pick what to assign</CozySectionLabel>
        <CozyCard style={{ padding: 18 }}>
          <p className="text-sm font-pixel mb-3" style={{ color: T.textSecondary }}>
            These village buildings exist as masks but aren&apos;t wired to any route yet. Tell me which page should live in which building and I&apos;ll wire them in <code className="font-pixel-mono">VillageScene.tsx</code>.
          </p>
          <div className="flex flex-col gap-2">
            {UNUSED_BUILDINGS.map((b) => (
              <div
                key={b.id}
                className="flex items-center justify-between gap-3 py-2 px-3 rounded"
                style={{ borderBottom: '1px dashed rgba(255,255,255,0.06)' }}
              >
                <div>
                  <p
                    className="text-[13px] font-bold font-pixel"
                    style={{ color: AMBER, textShadow: '0 1px 2px rgba(0,0,0,0.85)' }}
                  >
                    {b.label}
                  </p>
                  <p className="font-pixel-mono text-[10px]" style={{ color: T.textMuted }}>
                    {b.mask}
                  </p>
                </div>
                <span className="font-pixel-mono text-[10px] text-right" style={{ color: T.textMuted }}>
                  → {b.suggestion}
                </span>
              </div>
            ))}
          </div>
        </CozyCard>

        <p
          className="mt-8 text-[11px] font-pixel-mono uppercase tracking-[1.5px] text-center"
          style={{ color: T.textMuted, opacity: 0.6 }}
        >
          Note: This is a dev menu. Delete /menu route before shipping if you want.
        </p>
      </div>
    </div>
  );
}

function Grid({ entries }: { entries: Entry[] }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
      {entries.map((e) => <Card key={e.route} e={e} />)}
    </div>
  );
}

function Card({ e }: { e: Entry }) {
  const dim = e.status === 'legacy';
  return (
    <Link href={e.route} className="block group">
      <CozyCard style={{ padding: 16, opacity: dim ? 0.65 : 1 }}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div
              className="flex items-center justify-center rounded-lg shrink-0"
              style={{
                width: 40, height: 40,
                backgroundColor: 'rgba(255,213,128,0.10)',
                border: `1px solid ${COZY_BORDER}`,
              }}
            >
              <e.Icon size={22} color={AMBER} strokeWidth={2.2} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <p
                  className="text-[14px] font-bold font-pixel leading-tight"
                  style={{ color: AMBER, textShadow: '0 1px 2px rgba(0,0,0,0.85)' }}
                >
                  {e.label}
                </p>
                {e.status === 'unmapped' && (
                  <span
                    className="font-pixel-mono text-[8px] uppercase tracking-[1px] px-1.5 py-0.5 rounded"
                    style={{
                      color: '#E8845A',
                      border: '1px solid rgba(232,132,90,0.45)',
                      backgroundColor: 'rgba(232,132,90,0.10)',
                    }}
                  >
                    No building
                  </span>
                )}
                {e.status === 'legacy' && (
                  <span
                    className="font-pixel-mono text-[8px] uppercase tracking-[1px] px-1.5 py-0.5 rounded"
                    style={{
                      color: T.textMuted,
                      border: `1px solid ${COZY_BORDER}`,
                      backgroundColor: 'rgba(0,0,0,0.25)',
                    }}
                  >
                    Legacy
                  </span>
                )}
              </div>
              <p
                className="font-pixel-mono text-[10px] uppercase tracking-[1.5px] mt-0.5"
                style={{ color: T.textMuted }}
              >
                {e.route}
              </p>
              <p className="text-[11px] font-pixel mt-1" style={{ color: T.textSecondary }}>
                {e.blurb}
              </p>
              {e.building && (
                <p
                  className="text-[10px] font-pixel-mono mt-1.5"
                  style={{ color: '#3EE68A', opacity: 0.85 }}
                >
                  ⛨ {e.building}
                </p>
              )}
            </div>
          </div>
          <span
            className="text-base font-pixel-mono shrink-0 self-center"
            style={{ color: AMBER }}
          >
            ›
          </span>
        </div>
      </CozyCard>
    </Link>
  );
}
