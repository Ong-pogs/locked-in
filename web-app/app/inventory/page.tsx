'use client';

import { useEffect } from 'react';
import {
  Shield,
  Droplet,
  Zap,
  Trophy,
  Star,
  Sparkles,
  FlaskConical,
  Lock,
} from 'lucide-react';
import { useCourseStore, useUserStore } from '@/stores';
import { T } from '@/components/theme';
import { CozyCard, CozySectionLabel } from '@/components/cozy';
import { HubButton } from '@/components/HubButton';

const AMBER = '#FFD580';
const COZY_BORDER = 'rgba(58, 143, 168, 0.45)';

type Rarity = 'common' | 'uncommon' | 'rare' | 'legendary';

type Slot = {
  id: string;
  name: string;
  description: string;
  qty: number;
  Icon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
  iconColor: string;
  category: 'currency' | 'consumable' | 'achievement';
  rarity?: Rarity;
};

const RARITY_COLOR: Record<Rarity, string> = {
  common: 'rgba(255,255,255,0.45)',
  uncommon: '#3EE68A',
  rare: '#2AE8D4',
  legendary: '#FFD580',
};

const RARITY_LABEL: Record<Rarity, string> = {
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  legendary: 'Legendary',
};

export default function InventoryPage() {
  const activeCourseId = useCourseStore((s) => s.activeCourseId);
  const courseStates = useCourseStore((s) => s.courseStates);
  const refreshCourseRuntime = useCourseStore((s) => s.refreshCourseRuntime);
  const authToken = useUserStore((s) => s.authToken);

  // Refresh runtime on mount so balances reflect latest server state.
  useEffect(() => {
    if (activeCourseId && authToken) {
      void refreshCourseRuntime(activeCourseId, authToken).catch(() => {
        // Keep last synced runtime visible if refresh fails.
      });
    }
  }, [activeCourseId, authToken, refreshCourseRuntime]);

  const activeState = activeCourseId ? courseStates[activeCourseId] : null;

  // --- Coffers (currency) ---
  const ichorBalance = Math.floor(activeState?.ichorBalance ?? 0);
  const fuelBalance = activeState?.fuelCounter ?? 0;
  const fuelCap = activeState?.fuelCap ?? 7;

  // --- Consumables ---
  const saversBanked = Math.max(0, 3 - (activeState?.saverCount ?? 0));

  // --- Achievements (use longest streak across ALL course states) ---
  const longestStreak = Math.max(
    ...Object.values(courseStates).map((s) => s?.longestStreak ?? 0),
    0,
  );

  const currency: Slot[] = [
    {
      id: 'ichor',
      name: 'Ichor',
      description: 'Earned from yield',
      qty: ichorBalance,
      Icon: FlaskConical,
      iconColor: '#3EE68A',
      category: 'currency',
    },
    {
      id: 'fuel',
      name: 'Fuel',
      description: `Refines into Ichor · cap ${fuelCap}`,
      qty: fuelBalance,
      Icon: Droplet,
      iconColor: '#E8845A',
      category: 'currency',
    },
  ];

  const consumables: Slot[] = [
    {
      id: 'streak-saver',
      name: 'Streak Saver',
      description: 'Banks one missed day',
      qty: saversBanked,
      Icon: Shield,
      iconColor: '#3EE68A',
      category: 'consumable',
      rarity: 'uncommon',
    },
    {
      id: 'fuel-vial',
      name: 'Fuel Vial',
      description: 'Instant fuel refill · coming soon',
      qty: 0,
      Icon: Droplet,
      iconColor: '#E8845A',
      category: 'consumable',
      rarity: 'common',
    },
    {
      id: 'daily-boost',
      name: 'Daily Boost',
      description: '2x fuel for 24 hours · coming soon',
      qty: 0,
      Icon: Zap,
      iconColor: '#2AE8D4',
      category: 'consumable',
      rarity: 'rare',
    },
  ];

  const achievements: Slot[] = [
    {
      id: 'first-flame',
      name: 'First Flame',
      description: 'Lit your first streak',
      qty: longestStreak >= 1 ? 1 : 0,
      Icon: Sparkles,
      iconColor: AMBER,
      category: 'achievement',
      rarity: 'common',
    },
    {
      id: 'week-walker',
      name: 'Week Walker',
      description: 'Maintained 7 days',
      qty: longestStreak >= 7 ? 1 : 0,
      Icon: Star,
      iconColor: '#3EE68A',
      category: 'achievement',
      rarity: 'uncommon',
    },
    {
      id: 'ember-keeper',
      name: 'Ember Keeper',
      description: 'Maintained 30 days',
      qty: longestStreak >= 30 ? 1 : 0,
      Icon: Trophy,
      iconColor: '#2AE8D4',
      category: 'achievement',
      rarity: 'rare',
    },
    {
      id: 'eternal-flame',
      name: 'Eternal Flame',
      description: 'Maintained 100 days',
      qty: longestStreak >= 100 ? 1 : 0,
      Icon: Trophy,
      iconColor: AMBER,
      category: 'achievement',
      rarity: 'legendary',
    },
  ];

  return (
    <div className="min-h-screen relative" style={{ backgroundColor: T.bg }}>
      {/* Cottage bg — your-personal-stuff vibe */}
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
          Inventory
        </h1>
        <div className="mb-5" />

        {/* Coffers — currency = stat-box style */}
        <CozySectionLabel>Coffers</CozySectionLabel>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
          {currency.map((slot) => (
            <CofferCard key={slot.id} slot={slot} />
          ))}
        </div>

        {/* Consumables — card with description visible */}
        <CozySectionLabel>Consumables</CozySectionLabel>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 mb-6">
          {consumables.map((slot) => (
            <ConsumableTile key={slot.id} slot={slot} />
          ))}
        </div>

        {/* Achievements — badge frame, earned vs locked */}
        <CozySectionLabel>Achievements</CozySectionLabel>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
          {achievements.map((slot) => (
            <AchievementBadge key={slot.id} slot={slot} />
          ))}
        </div>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────
   Section renderers (ported from inventory-prototypes Categorized variant)
   ────────────────────────────────────────────────────────────────────── */

function CofferCard({ slot }: { slot: Slot }) {
  const Icon = slot.Icon;
  return (
    <CozyCard style={{ padding: 18 }}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="flex items-center justify-center rounded-lg flex-shrink-0"
            style={{
              width: 56,
              height: 56,
              backgroundColor: `${slot.iconColor}14`,
              border: `1px solid ${slot.iconColor}55`,
            }}
          >
            <Icon size={32} color={slot.iconColor} strokeWidth={2.2} />
          </div>
          <div className="min-w-0">
            <p
              className="font-pixel-mono text-[10px] uppercase tracking-[1.5px]"
              style={{ color: T.textMuted }}
            >
              {slot.name}
            </p>
            <p
              className="text-3xl font-bold font-pixel-mono leading-tight"
              style={{ color: AMBER, textShadow: '0 1px 2px rgba(0,0,0,0.85)' }}
            >
              {slot.qty.toLocaleString()}
            </p>
            <p className="text-[11px] font-pixel mt-0.5" style={{ color: T.textSecondary }}>
              {slot.description}
            </p>
          </div>
        </div>
      </div>
    </CozyCard>
  );
}

function ConsumableTile({ slot }: { slot: Slot }) {
  const empty = slot.qty === 0;
  const Icon = slot.Icon;
  return (
    <CozyCard style={{ padding: 14, opacity: empty ? 0.6 : 1 }}>
      <div className="flex items-start gap-3">
        <div
          className="flex items-center justify-center rounded-lg flex-shrink-0 relative"
          style={{
            width: 48,
            height: 48,
            backgroundColor: `${slot.iconColor}14`,
            border: `1px solid ${slot.iconColor}55`,
          }}
        >
          <Icon size={28} color={empty ? T.textMuted : slot.iconColor} strokeWidth={2.2} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-1">
            <p
              className="text-[13px] font-bold font-pixel leading-tight truncate"
              style={{ color: AMBER, textShadow: '0 1px 2px rgba(0,0,0,0.85)' }}
            >
              {slot.name}
            </p>
            <span
              className="font-pixel-mono text-[10px] font-bold uppercase tracking-[0.5px] px-1.5 py-0.5 rounded shrink-0"
              style={{
                color: empty ? T.textMuted : AMBER,
                backgroundColor: 'rgba(0,0,0,0.45)',
                border: `1px solid ${empty ? COZY_BORDER : `${AMBER}55`}`,
              }}
            >
              {empty ? '—' : `x${slot.qty}`}
            </span>
          </div>
          <p className="text-[11px] font-pixel mb-2" style={{ color: T.textSecondary }}>
            {slot.description}
          </p>
          {slot.rarity && (
            <span
              className="font-pixel-mono text-[8px] uppercase tracking-[1px] px-2 py-0.5 rounded inline-block"
              style={{
                color: RARITY_COLOR[slot.rarity],
                border: `1px solid ${RARITY_COLOR[slot.rarity]}50`,
                backgroundColor: 'rgba(0,0,0,0.25)',
              }}
            >
              {RARITY_LABEL[slot.rarity]}
            </span>
          )}
        </div>
      </div>
    </CozyCard>
  );
}

function AchievementBadge({ slot }: { slot: Slot }) {
  const earned = slot.qty > 0;
  const Icon = slot.Icon;
  const rarityColor = slot.rarity ? RARITY_COLOR[slot.rarity] : 'rgba(255,255,255,0.30)';
  return (
    <div
      className="relative rounded-lg p-3 flex flex-col items-center text-center"
      style={{
        backgroundColor: 'rgba(14,14,28,0.55)',
        border: `2px solid ${rarityColor}${earned ? '88' : '30'}`,
        backdropFilter: 'blur(20px) saturate(1.4)',
        WebkitBackdropFilter: 'blur(20px) saturate(1.4)',
        boxShadow: earned && slot.rarity === 'legendary'
          ? `0 0 18px ${RARITY_COLOR.legendary}40, inset 0 1px 0 rgba(255,213,128,0.20)`
          : '0 6px 20px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,213,128,0.08)',
      }}
    >
      <div
        className="flex items-center justify-center rounded-full mb-2 mt-1 relative"
        style={{
          width: 64,
          height: 64,
          backgroundColor: earned ? `${rarityColor}18` : 'rgba(0,0,0,0.35)',
          border: `2px solid ${rarityColor}${earned ? '88' : '30'}`,
          filter: earned ? undefined : 'grayscale(1)',
        }}
      >
        <Icon
          size={36}
          color={earned ? slot.iconColor : T.textMuted}
          strokeWidth={2.2}
        />
        {!earned && (
          <div
            className="absolute inset-0 flex items-center justify-center rounded-full"
            style={{ backgroundColor: 'rgba(0,0,0,0.55)' }}
          >
            <Lock size={20} color={T.textMuted} strokeWidth={2.2} />
          </div>
        )}
      </div>
      <p
        className="text-[12px] font-bold font-pixel leading-tight"
        style={{
          color: earned ? AMBER : T.textMuted,
          textShadow: earned ? '0 1px 2px rgba(0,0,0,0.85)' : undefined,
        }}
      >
        {slot.name}
      </p>
      <p
        className="text-[10px] font-pixel mt-0.5 leading-tight"
        style={{ color: earned ? T.textSecondary : T.textMuted }}
      >
        {slot.description}
      </p>
      {slot.rarity && (
        <span
          className="font-pixel-mono text-[8px] uppercase tracking-[1px] px-2 py-0.5 rounded mt-2"
          style={{
            color: rarityColor,
            border: `1px solid ${rarityColor}${earned ? '60' : '30'}`,
            backgroundColor: 'rgba(0,0,0,0.30)',
          }}
        >
          {RARITY_LABEL[slot.rarity]}
        </span>
      )}
    </div>
  );
}
