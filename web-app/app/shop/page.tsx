'use client';

import { useCallback, useEffect, useState } from 'react';
import { useCourseStore, useUserStore } from '@/stores';
import { buyStreakSaver, getYieldHistory } from '@/services/api/progress/progressApi';
import { fetchWithAuth } from '@/services/api/httpClient';
import type { YieldHistoryResponse } from '@/services/api/types';
import { T } from '@/components/theme';
import { CozyCard } from '@/components/cozy';
import { HubButton } from '@/components/HubButton';
import { Coins, Shield } from 'lucide-react';

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

const COZY_BORDER = 'rgba(58, 143, 168, 0.45)';
const AMBER = '#FFD580';

/* ── Page ───────────────────────────────────────────────────────────── */

const STREAK_SAVER_COST = 500;

export default function ShopPage() {
  const activeCourseId = useCourseStore((s) => s.activeCourseId);
  const courseStates = useCourseStore((s) => s.courseStates);
  const refreshCourseRuntime = useCourseStore((s) => s.refreshCourseRuntime);
  const authToken = useUserStore((s) => s.authToken);
  const activeState = activeCourseId ? courseStates[activeCourseId] ?? null : null;
  const ichorBalance = activeState?.ichorBalance ?? 0;
  const saversUsed = activeState?.saverCount ?? 0;
  const saversBanked = Math.max(0, 3 - saversUsed);

  const [yieldHistory, setYieldHistory] = useState<YieldHistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [buyingSaver, setBuyingSaver] = useState(false);
  const [saverMessage, setSaverMessage] = useState<string | null>(null);

  const handleBuySaver = useCallback(async () => {
    if (!activeCourseId || buyingSaver) return;
    setBuyingSaver(true);
    setSaverMessage(null);
    try {
      const result = await fetchWithAuth((token) => buyStreakSaver(activeCourseId, token));
      if (!result) return;
      if (result.applied) {
        setSaverMessage('Saver acquired.');
      } else if (result.reason === 'SAVERS_FULL') {
        setSaverMessage('Saver inventory already full (3/3).');
      } else if (result.reason === 'INSUFFICIENT_ICHOR') {
        setSaverMessage(`Need ${result.required} ichor (you have ${result.have}).`);
      } else {
        setSaverMessage('Could not buy saver.');
      }
      if (authToken) {
        await refreshCourseRuntime(activeCourseId, authToken).catch(() => {});
      }
    } catch (err) {
      setSaverMessage(err instanceof Error ? err.message : 'Buy failed.');
    } finally {
      setBuyingSaver(false);
    }
  }, [activeCourseId, authToken, buyingSaver, refreshCourseRuntime]);

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
          Shop
        </h1>
        <div className="mb-5" />

        {/* Ichor balance hero — your purse */}
        <PurseHero balance={ichorBalance} />

        {/* Streak Saver — the one real, buyable item right now */}
        <SectionHeader>Streak Savers</SectionHeader>
        <StreakSaverCard
          ichorBalance={ichorBalance}
          saversUsed={saversUsed}
          saversBanked={saversBanked}
          busy={buyingSaver}
          onBuy={handleBuySaver}
          message={saverMessage}
        />

        {/* Earnings + activity */}
        <SectionHeader>Earnings &amp; Activity</SectionHeader>
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

/* ── Purse hero ─────────────────────────────────────────────────────── */

function PurseHero({ balance }: { balance: number }) {
  return (
    <CozyCard className="mb-5" style={{ padding: 18 }}>
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
            {balance.toLocaleString()} <span className="text-sm opacity-70">ichor</span>
          </p>
        </div>
      </div>
    </CozyCard>
  );
}

/* ── Section header ─────────────────────────────────────────────────── */

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

/* ── Streak Saver card ─────────────────────────────────────────────── */

function StreakSaverCard({
  ichorBalance,
  saversUsed,
  saversBanked,
  busy,
  onBuy,
  message,
}: {
  ichorBalance: number;
  saversUsed: number;
  saversBanked: number;
  busy: boolean;
  onBuy: () => void;
  message: string | null;
}) {
  const inventoryFull = saversUsed <= 0;
  const canAfford = ichorBalance >= STREAK_SAVER_COST;
  const disabled = busy || inventoryFull || !canAfford;
  const buttonLabel = busy
    ? 'Buying...'
    : inventoryFull
      ? 'Inventory full (3/3)'
      : !canAfford
        ? `Need ${STREAK_SAVER_COST - ichorBalance} more ichor`
        : `◆ Buy 1 Saver (500 ichor) ◆`;

  return (
    <CozyCard
      className="mb-6"
      style={{
        padding: 18,
        border: `2px solid ${T.green}55`,
        boxShadow: `0 0 24px rgba(62,230,138,0.10)`,
      }}
    >
      <div className="flex items-start gap-4">
        <div
          className="flex items-center justify-center rounded-xl shrink-0"
          style={{
            width: 64,
            height: 64,
            backgroundColor: 'rgba(62,230,138,0.10)',
            border: `1px solid ${T.green}55`,
          }}
        >
          <Shield size={32} color={T.green} strokeWidth={2.2} />
        </div>
        <div className="flex-1 min-w-0">
          <p
            className="text-[15px] font-bold font-pixel mb-1"
            style={{ color: T.green, textShadow: '0 1px 2px rgba(0,0,0,0.85)' }}
          >
            Streak Saver
          </p>
          <p className="text-[11px] font-pixel mb-2" style={{ color: T.textSecondary }}>
            Auto-consumes on a missed day. Protects your streak and lowers yield redirect.
          </p>
          <div className="flex items-center gap-3 mb-3 flex-wrap">
            {[0, 1, 2].map((i) => {
              const owned = i < saversBanked;
              return (
                <div
                  key={i}
                  className="flex items-center justify-center rounded-md"
                  style={{
                    width: 30,
                    height: 30,
                    backgroundColor: owned ? 'rgba(62,230,138,0.12)' : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${owned ? 'rgba(62,230,138,0.50)' : 'rgba(255,255,255,0.10)'}`,
                    opacity: owned ? 1 : 0.45,
                  }}
                >
                  <Shield size={16} color={owned ? T.green : T.textMuted} strokeWidth={2.4} />
                </div>
              );
            })}
            <span className="font-pixel-mono text-[10px]" style={{ color: T.textMuted }}>
              {saversBanked}/3 banked
            </span>
          </div>
          <button
            type="button"
            onClick={onBuy}
            disabled={disabled}
            className="w-full sm:w-auto px-5 py-2.5 rounded-lg font-bold text-xs uppercase tracking-[1.5px] font-pixel cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 hover:brightness-110 transition-all"
            style={{
              border: `1px solid ${T.green}`,
              background: 'linear-gradient(180deg, rgba(62,230,138,0.18) 0%, rgba(62,230,138,0.08) 100%)',
              color: T.green,
              textShadow: '0 1px 2px rgba(0,0,0,0.85)',
            }}
          >
            {buttonLabel}
          </button>
          {message && (
            <p
              className="text-[11px] mt-2 font-pixel-mono"
              style={{ color: message.startsWith('Saver acquired') ? T.green : AMBER }}
            >
              {message}
            </p>
          )}
        </div>
      </div>
    </CozyCard>
  );
}
