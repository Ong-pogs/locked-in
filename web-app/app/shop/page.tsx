'use client';

import { useCallback, useEffect, useState } from 'react';
import { useCourseStore } from '@/stores';
import { getYieldHistory } from '@/services/api/progress/progressApi';
import { fetchWithAuth } from '@/services/api/httpClient';
import type { YieldHistoryResponse } from '@/services/api/types';
import { T } from '@/components/theme';
import { CozyCard } from '@/components/cozy';
import { HubButton } from '@/components/HubButton';

/* ── Inline SVG Icons ──────────────────────────────────────────────── */

function ArrowUpIcon({ color = '#3EE68A' }: { color?: string }) {
  return (
    <svg viewBox="0 0 14 14" width={12} height={12} fill="none">
      <path d="M7 1v12M3 5l4-4 4 4" stroke={color} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MinusBoxIcon() {
  return (
    <svg viewBox="0 0 14 14" width={12} height={12} fill="none">
      <rect x="2.5" y="2.5" width="9" height="9" rx="2" stroke="rgba(255,255,255,0.3)" strokeWidth="1.1" />
      <path d="M5 7h4" stroke="rgba(255,255,255,0.3)" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

function DoubleChevronIcon() {
  return (
    <svg viewBox="0 0 14 14" width={12} height={12} fill="none">
      <path d="M3 11l4-4 4 4M3 7l4-4 4 4" stroke="#E8845A" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SmallPotionIcon() {
  return (
    <svg viewBox="0 0 14 14" width={12} height={12} fill="none">
      <path d="M5 2.5h4v2.5l3 5c.4.8 0 1.5-.5 2S9.5 13.5 7 13.5s-3.5-.5-4-1-.9-1.2-.5-2l3-5V2.5z" stroke="#D4A04A" strokeWidth="1.1" />
    </svg>
  );
}

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

const PRESETS = [250, 500, 1000] as const;

const COZY_BORDER = 'rgba(58, 143, 168, 0.45)';
const AMBER = '#FFD580';

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
  const [ichorAmount, setIchorAmount] = useState('1000');

  const rate = getConversionRate(lifetimeIchor);
  const tierLabel = getTierLabel(lifetimeIchor);
  const parsedAmount = Number(ichorAmount) || 0;
  const payout = parsedAmount > 0 ? ((parsedAmount / 1000) * rate).toFixed(2) : '--';
  const balanceWorth = ((ichorBalance / 1000) * rate).toFixed(2);

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
      if (!resp) { setError('Connect wallet to view rewards.'); setLoading(false); return; }
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
      {/* Market interior backdrop slot — drop marketbackground.png in
          /public/images/market/ to activate. */}
      <div aria-hidden className="fixed inset-0 z-0 pointer-events-none">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/images/market/marketbackground.png"
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
          Rewards
        </h1>
        <p className="text-sm leading-[18px] mb-5" style={{ color: 'rgba(255,255,255,0.6)' }}>
          Redeem ichor for USDC
        </p>

        {/* 2-column layout on desktop */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* ── Left: Redemption UI ── */}
          <CozyCard style={{ padding: 24 }}>
            {/* Ichor hero */}
            <div className="text-center mb-5">
              <p
                className="text-4xl font-bold font-pixel-mono"
                style={{ color: T.green, textShadow: '0 1px 2px rgba(0,0,0,0.85)' }}
              >
                {ichorBalance.toLocaleString()}
              </p>
              <p
                className="font-pixel-mono text-[10px] uppercase tracking-[1px] mt-1"
                style={{ color: T.textMuted }}
              >
                Ichor Balance
              </p>
              <div className="flex items-center justify-center gap-2 mt-2">
                <span
                  className="font-pixel-mono text-[10px] px-2.5 py-1 rounded-xl"
                  style={{ color: T.teal, background: 'rgba(42,232,212,0.08)', border: '1px solid rgba(42,232,212,0.25)' }}
                >
                  {tierLabel}
                </span>
                <span className="font-pixel-mono text-[10px]" style={{ color: T.textMuted }}>
                  1,000 = {rate.toFixed(2)} USDC
                </span>
              </div>
              <p className="text-[14px] font-bold font-pixel-mono mt-2" style={{ color: T.teal }}>
                Worth ~${balanceWorth} USDC
              </p>
            </div>

            {/* Redeem section */}
            <p
              className="font-pixel-mono text-[10px] font-bold uppercase tracking-[2px] text-center mb-3"
              style={{ color: T.textMuted }}
            >
              Redeem Ichor
            </p>

            {/* Amount input */}
            <div
              className="rounded-[10px] border px-3.5 py-3 flex items-center justify-center mb-3"
              style={{ backgroundColor: 'rgba(0,0,0,0.3)', borderColor: COZY_BORDER }}
            >
              <input
                type="number"
                min={0}
                value={ichorAmount}
                onChange={(e) => {
                  const val = Math.max(0, Number(e.target.value));
                  setIchorAmount(String(val));
                }}
                placeholder="1000"
                className="bg-transparent outline-none text-2xl font-bold font-pixel-mono text-center w-full"
                style={{ color: AMBER }}
              />
              <span className="text-[11px] ml-2 flex-shrink-0 font-pixel-mono" style={{ color: T.textMuted }}>ICHOR</span>
            </div>

            {/* Preset pills */}
            <div className="flex justify-center gap-2 mb-4">
              {PRESETS.map((preset) => {
                const selected = parsedAmount === preset;
                return (
                  <button
                    key={preset}
                    onClick={() => setIchorAmount(String(preset))}
                    className="px-3.5 py-1.5 rounded-lg text-[11px] font-pixel-mono font-bold border transition-colors"
                    style={{
                      borderColor: selected ? AMBER : COZY_BORDER,
                      backgroundColor: selected ? 'rgba(255,213,128,0.10)' : 'transparent',
                      color: selected ? AMBER : T.textSecondary,
                    }}
                  >
                    {preset.toLocaleString()}
                  </button>
                );
              })}
              <button
                onClick={() => setIchorAmount(String(ichorBalance))}
                className="px-3.5 py-1.5 rounded-lg text-[11px] font-pixel-mono font-bold border transition-colors"
                style={{
                  borderColor: parsedAmount === ichorBalance && ichorBalance > 0 ? AMBER : COZY_BORDER,
                  backgroundColor: parsedAmount === ichorBalance && ichorBalance > 0 ? 'rgba(255,213,128,0.10)' : 'transparent',
                  color: parsedAmount === ichorBalance && ichorBalance > 0 ? AMBER : T.textSecondary,
                }}
              >
                All
              </button>
            </div>

            {/* Payout preview */}
            <div
              className="rounded-lg p-3.5 text-center mb-4"
              style={{ background: 'rgba(62,230,138,0.04)', border: '1px solid rgba(62,230,138,0.15)' }}
            >
              <p className="font-pixel-mono text-[10px] uppercase tracking-[1px]" style={{ color: T.textMuted }}>Payout</p>
              <p
                className="text-[22px] font-bold font-pixel-mono mt-1"
                style={{ color: T.green, textShadow: '0 1px 2px rgba(0,0,0,0.85)' }}
              >
                {payout === '--' ? '--' : `${payout} USDC`}
              </p>
            </div>

            {/* Claim button (disabled) */}
            <button
              className="w-full py-3 rounded-lg text-center font-bold text-sm uppercase tracking-[1px] font-pixel"
              style={{
                border: `1px solid ${AMBER}`,
                background: 'rgba(255,213,128,0.12)',
                color: AMBER,
                opacity: 0.4,
                cursor: 'not-allowed',
              }}
              disabled
            >
              ◆ Coming Soon ◆
            </button>
            <p className="text-center text-[10px] mt-2" style={{ color: T.textMuted }}>
              On-chain redemption launching soon
            </p>
          </CozyCard>

          {/* ── Right: Earnings + Activity ── */}
          <div>
            {/* Earnings stats 2x2 */}
            {loading ? (
              <p className="text-sm" style={{ color: T.textSecondary }}>Loading earnings...</p>
            ) : error ? (
              <div>
                <p className="text-xs" style={{ color: AMBER }}>{error}</p>
                <button
                  onClick={() => { setError(null); void fetchShopData(activeCourseId); }}
                  className="mt-3 px-4 py-2 rounded-md border text-[11px] font-semibold uppercase tracking-wide font-pixel"
                  style={{ borderColor: COZY_BORDER, backgroundColor: 'rgba(255,213,128,0.10)', color: AMBER }}
                >
                  Retry
                </button>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2.5 mb-3">
                  <StatCard icon={<ArrowUpIcon />} label="Total Yield" value={`${yieldHistory?.totalGrossYieldUi ?? '0'}`} unit="USDC" />
                  <StatCard icon={<MinusBoxIcon />} label="Fees" value={`${yieldHistory?.totalPlatformFeeUi ?? '0'}`} unit="USDC" />
                  <StatCard icon={<DoubleChevronIcon />} label="Redirected" value={`${yieldHistory?.totalRedirectedUi ?? '0'}`} unit="USDC" />
                  <StatCard icon={<SmallPotionIcon />} label="Ichor Earned" value={Number(yieldHistory?.totalIchorAwarded ?? '0').toLocaleString()} valueColor={AMBER} />
                </div>
                <CozyCard className="text-center mb-4" style={{ padding: 12 }}>
                  <p className="font-pixel-mono text-[9px] uppercase tracking-[1.5px]" style={{ color: T.textMuted }}>Harvests</p>
                  <p
                    className="text-base font-bold font-pixel-mono mt-0.5"
                    style={{ color: AMBER, textShadow: '0 1px 2px rgba(0,0,0,0.85)' }}
                  >
                    {yieldHistory?.totalHarvests ?? 0} harvests total
                  </p>
                </CozyCard>
              </>
            )}

            {/* Recent Activity */}
            <CozyCard style={{ padding: 16 }}>
              <p
                className="font-pixel-mono text-[10px] font-bold uppercase tracking-[2px] mb-3"
                style={{ color: T.textMuted }}
              >
                Recent Activity
              </p>
              {loading ? (
                <p className="text-sm" style={{ color: T.textSecondary }}>Loading...</p>
              ) : recentHarvests.length === 0 ? (
                <p className="text-sm" style={{ color: T.textSecondary }}>No activity yet.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {recentHarvests.map((entry) => (
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
        </div>
      </div>
    </div>
  );
}

/* ── Stat Card Component ───────────────────────────────────────────── */

function StatCard({
  icon,
  label,
  value,
  unit,
  valueColor,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  unit?: string;
  valueColor?: string;
}) {
  return (
    <CozyCard style={{ padding: 14 }}>
      <div className="flex items-center gap-1.5 mb-1.5">
        {icon}
        <span
          className="font-pixel-mono text-[8px] uppercase tracking-[1px]"
          style={{ color: 'rgba(255,255,255,0.45)' }}
        >
          {label}
        </span>
      </div>
      <span
        className="text-[17px] font-bold font-pixel-mono"
        style={{ color: valueColor ?? T.textPrimary, textShadow: '0 1px 2px rgba(0,0,0,0.85)' }}
      >
        {value}
        {unit && (
          <span className="text-[10px] ml-1" style={{ color: 'rgba(255,255,255,0.45)' }}>
            {unit}
          </span>
        )}
      </span>
    </CozyCard>
  );
}
