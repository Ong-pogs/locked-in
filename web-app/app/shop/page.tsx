'use client';

import { useCallback, useEffect, useState } from 'react';
import { useCourseStore } from '@/stores';
import { getYieldHistory } from '@/services/api/progress/progressApi';
import { fetchWithAuth } from '@/services/api/httpClient';
import type { YieldHistoryResponse } from '@/services/api/types';
import { T } from '@/components/theme';
import { CozyCard } from '@/components/cozy';
import { HubButton } from '@/components/HubButton';
import { Coins, Wallet, Package, Crown, Shield, Droplet, Zap } from 'lucide-react';

/* ── Helpers ────────────────────────────────────────────────────────── */

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function getConversionRate(ichorLifetime: number): number {
  if (ichorLifetime <= 9_999) return 0.9;
  if (ichorLifetime <= 49_999) return 1.0;
  if (ichorLifetime <= 99_999) return 1.1;
  return 1.25;
}

function getTierLabel(ichorLifetime: number): string {
  if (ichorLifetime <= 9_999) return 'Tier 1';
  if (ichorLifetime <= 49_999) return 'Tier 2';
  if (ichorLifetime <= 99_999) return 'Tier 3';
  return 'Tier 4';
}

const COZY_BORDER = 'rgba(58, 143, 168, 0.45)';
const AMBER = '#FFD580';

/* ── Shop catalog ───────────────────────────────────────────────────── */

type ShopItem = {
  id: string;
  name: string;
  description: string;
  cost: number;
  Icon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
  iconColor: string;
  category: 'usdc' | 'utility';
  comingSoon?: boolean;
};

const USDC_ITEMS: ShopItem[] = [
  {
    id: 'small-pouch',
    name: 'Small Coin Pouch',
    description: 'A modest handful of coin',
    cost: 250,
    Icon: Coins,
    iconColor: '#FFD580',
    category: 'usdc',
  },
  {
    id: 'medium-pouch',
    name: 'Medium Coin Pouch',
    description: 'A solid sack of coin',
    cost: 1000,
    Icon: Wallet,
    iconColor: '#FFD580',
    category: 'usdc',
  },
  {
    id: 'large-pouch',
    name: 'Large Coin Pouch',
    description: 'A heavy purse worth carrying',
    cost: 5000,
    Icon: Package,
    iconColor: '#FFD580',
    category: 'usdc',
  },
  {
    id: 'travelers-stash',
    name: "Trader's Stash",
    description: "A merchant's lifetime savings",
    cost: 10000,
    Icon: Crown,
    iconColor: '#FFD580',
    category: 'usdc',
  },
];

const UTILITY_ITEMS: ShopItem[] = [
  {
    id: 'streak-saver',
    name: 'Streak Saver',
    description: 'Banks one missed day',
    cost: 500,
    Icon: Shield,
    iconColor: '#3EE68A',
    category: 'utility',
    comingSoon: true,
  },
  {
    id: 'fuel-vial',
    name: 'Fuel Vial',
    description: 'Instant fuel refill',
    cost: 200,
    Icon: Droplet,
    iconColor: '#E8845A',
    category: 'utility',
    comingSoon: true,
  },
  {
    id: 'daily-boost',
    name: 'Daily Boost',
    description: '2x fuel for 24 hours',
    cost: 2000,
    Icon: Zap,
    iconColor: '#2AE8D4',
    category: 'utility',
    comingSoon: true,
  },
];

/* ── Page ───────────────────────────────────────────────────────────── */

export default function ShopPage() {
  const activeCourseId = useCourseStore((s) => s.activeCourseId);
  const courseStates = useCourseStore((s) => s.courseStates);
  const activeState = activeCourseId ? courseStates[activeCourseId] ?? null : null;
  const ichorBalance = activeState?.ichorBalance ?? 0;
  const lifetimeIchor = activeState?.totalIchorProduced ?? 0;

  const [yieldHistory, setYieldHistory] = useState<YieldHistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const rate = getConversionRate(lifetimeIchor);
  const tierLabel = getTierLabel(lifetimeIchor);

  const fetchShopData = useCallback(async (courseId: string | null, signal?: AbortSignal) => {
    if (!courseId) {
      setYieldHistory(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const resp = await fetchWithAuth((token) => getYieldHistory(courseId, token));
      if (signal?.aborted) return;
      if (!resp) { setError('Connect wallet to view wares.'); setLoading(false); return; }
      setYieldHistory(resp);
      setError(null);
      setLoading(false);
    } catch (err) {
      if (!signal?.aborted) { setError(err instanceof Error ? err.message : 'Failed to load.'); setLoading(false); }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchShopData(activeCourseId, controller.signal);
    return () => { controller.abort(); };
  }, [activeCourseId, fetchShopData]);

  const recentHarvests = yieldHistory?.entries ?? [];

  return (
    <div className="min-h-screen relative" style={{ backgroundColor: T.bg }}>
      {/* Market interior backdrop. */}
      <div aria-hidden className="fixed inset-0 z-0 pointer-events-none">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/images/market/shop.png"
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
          Trader&apos;s Stall
        </h1>
        <p className="text-sm leading-[18px] mb-5" style={{ color: 'rgba(255,255,255,0.6)' }}>
          Spend ichor on coin pouches and rare goods
        </p>

        {/* Ichor balance hero — your purse */}
        <CozyCard className="mb-5" style={{ padding: 18 }}>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <Coins size={28} color={AMBER} strokeWidth={2.2} />
              <div>
                <p className="font-pixel-mono text-[10px] uppercase tracking-[1.5px]" style={{ color: T.textMuted }}>
                  Your Purse
                </p>
                <p
                  className="text-3xl font-bold font-pixel-mono leading-tight"
                  style={{ color: AMBER, textShadow: '0 1px 2px rgba(0,0,0,0.85)' }}
                >
                  {ichorBalance.toLocaleString()} <span className="text-sm opacity-70">ichor</span>
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span
                className="font-pixel-mono text-[10px] px-2.5 py-1 rounded-xl"
                style={{ color: T.teal, background: 'rgba(42,232,212,0.10)', border: '1px solid rgba(42,232,212,0.35)' }}
              >
                {tierLabel}
              </span>
              <span className="font-pixel-mono text-[10px]" style={{ color: T.textMuted }}>
                1,000 ichor = {rate.toFixed(2)} USDC
              </span>
            </div>
          </div>
        </CozyCard>

        {/* On Offer — USDC bundles */}
        <p
          className="font-pixel-mono text-[12px] font-bold uppercase tracking-[2px] mb-3"
          style={{ color: AMBER, textShadow: '0 1px 2px rgba(0,0,0,0.85)', opacity: 0.85 }}
        >
          On Offer
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
          {USDC_ITEMS.map((item) => {
            const payout = ((item.cost / 1000) * rate).toFixed(2);
            const canAfford = ichorBalance >= item.cost;
            return (
              <ShopTile
                key={item.id}
                item={item}
                canAfford={canAfford}
                primaryRight={`+${payout} USDC`}
                primaryRightColor={T.green}
              />
            );
          })}
        </div>

        {/* Coming Soon — utility items */}
        <p
          className="font-pixel-mono text-[12px] font-bold uppercase tracking-[2px] mb-3"
          style={{ color: T.textMuted, opacity: 0.7 }}
        >
          Coming Soon
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
          {UTILITY_ITEMS.map((item) => (
            <ShopTile
              key={item.id}
              item={item}
              canAfford={false}
              primaryRight={null}
              primaryRightColor={T.textMuted}
            />
          ))}
        </div>

        {/* Trader's Ledger — earnings + activity */}
        <p
          className="font-pixel-mono text-[12px] font-bold uppercase tracking-[2px] mb-3"
          style={{ color: AMBER, textShadow: '0 1px 2px rgba(0,0,0,0.85)', opacity: 0.85 }}
        >
          Trader&apos;s Ledger
        </p>
        {loading ? (
          <CozyCard><p className="text-sm" style={{ color: T.textSecondary }}>Loading earnings...</p></CozyCard>
        ) : error ? (
          <CozyCard>
            <p className="text-xs" style={{ color: AMBER }}>{error}</p>
            <button
              onClick={() => { setError(null); void fetchShopData(activeCourseId); }}
              className="mt-3 px-4 py-2 rounded-md border text-[11px] font-semibold uppercase tracking-wide font-pixel"
              style={{ borderColor: COZY_BORDER, backgroundColor: 'rgba(255,213,128,0.10)', color: AMBER }}
            >
              Retry
            </button>
          </CozyCard>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Earnings stats */}
            <CozyCard style={{ padding: 16 }}>
              <p
                className="font-pixel-mono text-[10px] font-bold uppercase tracking-[2px] mb-3"
                style={{ color: T.textMuted }}
              >
                Earnings
              </p>
              <LedgerRow label="Total Yield" value={`${yieldHistory?.totalGrossYieldUi ?? '0'} USDC`} valueColor={T.green} />
              <LedgerRow label="Fees" value={`${yieldHistory?.totalPlatformFeeUi ?? '0'} USDC`} valueColor={T.textSecondary} />
              <LedgerRow label="Redirected" value={`${yieldHistory?.totalRedirectedUi ?? '0'} USDC`} valueColor={T.rust} />
              <LedgerRow label="Ichor Earned" value={Number(yieldHistory?.totalIchorAwarded ?? '0').toLocaleString()} valueColor={AMBER} />
              <LedgerRow label="Harvests" value={`${yieldHistory?.totalHarvests ?? 0} total`} valueColor={T.textPrimary} last />
            </CozyCard>

            {/* Recent activity */}
            <CozyCard style={{ padding: 16 }}>
              <p
                className="font-pixel-mono text-[10px] font-bold uppercase tracking-[2px] mb-3"
                style={{ color: T.textMuted }}
              >
                Recent Trades
              </p>
              {recentHarvests.length === 0 ? (
                <p className="text-sm" style={{ color: T.textSecondary }}>No activity yet.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {recentHarvests.slice(0, 5).map((entry) => (
                    <div
                      key={entry.harvestId}
                      className="flex justify-between items-center py-2"
                      style={{ borderBottom: '1px dashed rgba(255,255,255,0.06)' }}
                    >
                      <div>
                        <p className="text-[12px] font-semibold font-pixel" style={{ color: T.textPrimary }}>Yield Earned</p>
                        <p className="font-pixel-mono text-[9px] mt-0.5" style={{ color: T.textMuted }}>{relativeTime(entry.harvestedAt)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[12px] font-bold font-pixel-mono" style={{ color: T.green }}>+{entry.grossYieldAmountUi} USDC</p>
                        <p className="font-pixel-mono text-[9px] mt-0.5" style={{ color: T.textMuted }}>+{Number(entry.ichorAwarded).toLocaleString()} Ichor</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CozyCard>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Shop tile (one item card) ─────────────────────────────────────── */

function ShopTile({
  item,
  canAfford,
  primaryRight,
  primaryRightColor,
}: {
  item: ShopItem;
  canAfford: boolean;
  primaryRight: string | null;
  primaryRightColor: string;
}) {
  const disabled = item.comingSoon || !canAfford;
  const buttonLabel = item.comingSoon
    ? 'Coming Soon'
    : canAfford
      ? '◆ Buy ◆'
      : 'Not Enough Ichor';
  const Icon = item.Icon;

  return (
    <CozyCard
      style={{
        padding: 16,
        opacity: item.comingSoon ? 0.55 : 1,
      }}
    >
      <div className="flex items-start gap-3 mb-3">
        <div
          className="flex items-center justify-center rounded-lg flex-shrink-0"
          style={{
            width: 44,
            height: 44,
            backgroundColor: 'rgba(255,213,128,0.08)',
            border: '1px solid rgba(255,213,128,0.20)',
          }}
        >
          <Icon size={22} color={item.iconColor} strokeWidth={2.2} />
        </div>
        <div className="flex-1 min-w-0">
          <p
            className="text-[14px] font-bold font-pixel leading-tight"
            style={{ color: AMBER, textShadow: '0 1px 2px rgba(0,0,0,0.85)' }}
          >
            {item.name}
          </p>
          <p className="text-[11px] mt-0.5 font-pixel" style={{ color: T.textSecondary }}>
            {item.description}
          </p>
        </div>
      </div>

      {/* Price + payout row */}
      <div
        className="flex items-center justify-between rounded-lg px-3 py-2 mb-3"
        style={{
          background: 'rgba(0,0,0,0.25)',
          border: `1px solid ${COZY_BORDER}`,
        }}
      >
        <div>
          <p className="font-pixel-mono text-[8px] uppercase tracking-[1px]" style={{ color: T.textMuted }}>Cost</p>
          <p className="font-pixel-mono text-[14px] font-bold" style={{ color: AMBER }}>
            {item.cost.toLocaleString()} <span className="text-[10px] opacity-70">ichor</span>
          </p>
        </div>
        {primaryRight && (
          <div className="text-right">
            <p className="font-pixel-mono text-[8px] uppercase tracking-[1px]" style={{ color: T.textMuted }}>You get</p>
            <p className="font-pixel-mono text-[14px] font-bold" style={{ color: primaryRightColor }}>
              {primaryRight}
            </p>
          </div>
        )}
      </div>

      <button
        disabled={disabled}
        className="w-full py-2.5 rounded-lg text-center text-[12px] font-bold uppercase tracking-[1.5px] font-pixel transition-colors"
        style={{
          border: `1px solid ${disabled ? COZY_BORDER : AMBER}`,
          background: disabled ? 'transparent' : 'rgba(255,213,128,0.12)',
          color: disabled ? T.textMuted : AMBER,
          opacity: disabled ? 0.5 : 1,
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
      >
        {buttonLabel}
      </button>
    </CozyCard>
  );
}

/* ── Ledger row helper ─────────────────────────────────────────────── */

function LedgerRow({
  label,
  value,
  valueColor,
  last,
}: {
  label: string;
  value: string;
  valueColor: string;
  last?: boolean;
}) {
  return (
    <div
      className="flex justify-between items-center py-1.5"
      style={{ borderBottom: last ? 'none' : '1px dashed rgba(255,255,255,0.06)' }}
    >
      <span className="text-[12px] font-pixel" style={{ color: T.textSecondary }}>{label}</span>
      <span
        className="text-[13px] font-bold font-pixel-mono"
        style={{ color: valueColor, textShadow: '0 1px 2px rgba(0,0,0,0.85)' }}
      >
        {value}
      </span>
    </div>
  );
}
