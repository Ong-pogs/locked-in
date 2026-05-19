'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Flame, Coins, Droplet } from 'lucide-react';
import { useCourseStore } from '@/stores';
import { T } from '@/components/theme';
import { CozyCard, CozySectionLabel } from '@/components/cozy';
import { HubButton } from '@/components/HubButton';
import { fetchWithAuth, AuthExpiredError } from '@/services/api/httpClient';
import {
  getBreweryState,
  feedFire,
  claimYield,
} from '@/services/api/progress/progressApi';
import type {
  BreweryStateResponse,
  BreweryDayStripEntry,
} from '@/services/api/types';

const AMBER = '#FFD580';
const RUST = '#E8845A';
const GREEN = '#3EE68A';
const USDC_DECIMALS = 1_000_000; // base units per USDC

function formatUsdc(baseUnits: string | number): string {
  const n = typeof baseUnits === 'string' ? Number(baseUnits) : baseUnits;
  if (!Number.isFinite(n) || n <= 0) return '0.000000';
  return (n / USDC_DECIMALS).toFixed(6);
}

function formatRemaining(ms: number): string {
  if (ms <= 0) return 'Out';
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatDayLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString(undefined, { weekday: 'short' });
}

export default function BreweryPage() {
  const activeCourseId = useCourseStore((s) => s.activeCourseId);

  const [state, setState] = useState<BreweryStateResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedingBusy, setFeedingBusy] = useState(false);
  const [claimingBusy, setClaimingBusy] = useState(false);
  const [justClaimed, setJustClaimed] = useState<string | null>(null);
  const [claimSignature, setClaimSignature] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  // 1s tick for countdown re-render
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const fetchState = useCallback(async () => {
    if (!activeCourseId) return;
    try {
      const data = await fetchWithAuth((token) => getBreweryState(activeCourseId, token));
      setState(data);
      setError(null);
    } catch (err) {
      if (err instanceof AuthExpiredError) {
        setError('Connect your wallet to enter the brewery.');
      } else {
        setError(err instanceof Error ? err.message : 'Failed to load brewery.');
      }
    } finally {
      setLoading(false);
    }
  }, [activeCourseId]);

  useEffect(() => {
    void fetchState();
    const id = setInterval(fetchState, 60_000);
    return () => clearInterval(id);
  }, [fetchState]);

  const handleFeed = useCallback(async () => {
    if (!activeCourseId || feedingBusy) return;
    setFeedingBusy(true);
    setError(null);
    try {
      const result = await fetchWithAuth((token) => feedFire(activeCourseId, token));
      if (!result.applied) {
        setError(result.reason === 'NO_FUEL' ? 'No fuel to feed the fire.' : 'Could not feed the fire.');
      }
      await fetchState();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Feed failed.');
    } finally {
      setFeedingBusy(false);
    }
  }, [activeCourseId, feedingBusy, fetchState]);

  const handleClaim = useCallback(async () => {
    if (!activeCourseId || claimingBusy) return;
    setClaimingBusy(true);
    setError(null);
    setClaimSignature(null);
    try {
      const result = await fetchWithAuth((token) => claimYield(activeCourseId, token));
      if (result.applied) {
        setJustClaimed(formatUsdc(result.claimedAmount));
        if (result.transfer?.signature) {
          setClaimSignature(result.transfer.signature);
        }
        setTimeout(() => {
          setJustClaimed(null);
          setClaimSignature(null);
        }, 20_000);
      } else if (result.reason === 'NOTHING_TO_CLAIM') {
        setError('Nothing to claim yet.');
      }
      await fetchState();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Claim failed.');
    } finally {
      setClaimingBusy(false);
    }
  }, [activeCourseId, claimingBusy, fetchState]);

  const fireRemainingMs = useMemo(() => {
    if (!state?.fireLitUntil) return 0;
    void tick; // re-evaluated each tick
    return new Date(state.fireLitUntil).getTime() - Date.now();
  }, [state, tick]);

  const isLit = fireRemainingMs > 0;
  const fuelCounter = state?.fuelCounter ?? 0;
  const fuelCap = state?.fuelCap ?? 7;
  const unclaimedUsdc = state ? formatUsdc(state.unclaimedYieldAmount) : '0.000000';
  const last7Days = state?.last7Days ?? [];

  return (
    <div className="min-h-screen relative" style={{ backgroundColor: T.bg }}>
      <div aria-hidden className="fixed inset-0 z-0 pointer-events-none">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/images/apothecary/brewerbg.png"
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

      <div className="relative z-10 max-w-[720px] mx-auto px-[18px] pb-24">
        <div className="pt-20" />

        <h1
          className="text-3xl font-bold tracking-wide font-pixel mb-5"
          style={{ color: AMBER, textShadow: '0 1px 2px rgba(0,0,0,0.85)' }}
        >
          Brewery
        </h1>

        {loading ? (
          <CozyCard>
            <p className="font-pixel-mono text-[12px]" style={{ color: T.textSecondary }}>
              Stirring the embers...
            </p>
          </CozyCard>
        ) : (
          <>
            {/* Hero: fire visualization + timer */}
            <CozyCard className="mb-5 flex flex-col items-center" style={{ padding: 24 }}>
              <div className="relative w-[180px] h-[180px] flex items-center justify-center mb-3">
                <div
                  className="absolute rounded-full"
                  style={{
                    inset: 30,
                    background: isLit
                      ? 'radial-gradient(circle, rgba(232,132,90,0.28) 0%, rgba(255,213,128,0.10) 50%, rgba(255,213,128,0) 80%)'
                      : 'radial-gradient(circle, rgba(80,80,90,0.18) 0%, rgba(80,80,90,0) 70%)',
                    transition: 'all 600ms',
                  }}
                />
                <Flame
                  size={86}
                  color={isLit ? RUST : T.textMuted}
                  strokeWidth={1.8}
                  style={{
                    filter: isLit
                      ? `drop-shadow(0 0 18px ${RUST}88) drop-shadow(0 4px 14px rgba(232,132,90,0.5))`
                      : 'none',
                    opacity: isLit ? 1 : 0.5,
                    animation: isLit ? 'brewery-fire-flicker 1.8s ease-in-out infinite' : 'none',
                  }}
                />
              </div>

              <p
                className="font-pixel-mono text-[10px] uppercase tracking-[2px] mb-1"
                style={{ color: isLit ? AMBER : T.textMuted, opacity: 0.85 }}
              >
                {isLit ? 'Fire burning' : 'Fire out'}
              </p>
              <p
                className="font-pixel-mono text-2xl font-bold"
                style={{
                  color: isLit ? AMBER : T.textMuted,
                  textShadow: isLit ? '0 1px 2px rgba(0,0,0,0.85)' : 'none',
                }}
              >
                {formatRemaining(fireRemainingMs)}
              </p>
              <p
                className="font-pixel-mono text-[10px] mt-1"
                style={{ color: T.textMuted }}
              >
                {isLit ? "yield routing to your wallet" : 'yield routing to community pot'}
              </p>
            </CozyCard>

            {/* Fuel + Feed */}
            <CozyCard className="mb-5" style={{ padding: 18 }}>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p
                    className="font-pixel-mono text-[10px] uppercase tracking-[1.5px]"
                    style={{ color: AMBER, opacity: 0.75 }}
                  >
                    Fuel
                  </p>
                  <p
                    className="font-pixel-mono text-2xl font-bold"
                    style={{ color: RUST, textShadow: '0 1px 2px rgba(0,0,0,0.85)' }}
                  >
                    {fuelCounter}/{fuelCap}
                  </p>
                </div>
                <Droplet size={28} color={RUST} strokeWidth={2.2} />
              </div>

              <div className="flex items-center gap-1.5 mb-4">
                {Array.from({ length: fuelCap }).map((_, i) => (
                  <div
                    key={i}
                    className="flex-1 h-2.5 rounded-sm"
                    style={{
                      backgroundColor:
                        i < fuelCounter ? RUST : 'rgba(255,255,255,0.08)',
                      boxShadow: i < fuelCounter ? `0 0 6px ${RUST}80` : undefined,
                    }}
                  />
                ))}
              </div>

              <button
                onClick={handleFeed}
                disabled={fuelCounter <= 0 || feedingBusy}
                className="w-full py-3.5 rounded-lg font-bold text-base uppercase tracking-[2px] font-pixel cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 hover:brightness-110 transition-all"
                style={{
                  border: `1px solid ${AMBER}`,
                  background:
                    'linear-gradient(180deg, rgba(255,213,128,0.22) 0%, rgba(255,213,128,0.10) 100%)',
                  color: AMBER,
                  textShadow: '0 1px 2px rgba(0,0,0,0.85)',
                  boxShadow:
                    '0 0 24px rgba(255,213,128,0.28), inset 0 1px 0 rgba(255,255,255,0.18)',
                }}
              >
                {feedingBusy
                  ? 'Feeding...'
                  : fuelCounter <= 0
                    ? '◆ No Fuel ◆'
                    : '🪵 Feed the Fire (−1 fuel, +24h)'}
              </button>
            </CozyCard>

            {/* Unclaimed USDC + Claim */}
            <CozyCard
              className="mb-5"
              style={{
                padding: 18,
                border: `2px solid ${GREEN}55`,
                boxShadow: `0 0 24px rgba(62,230,138,0.10)`,
              }}
            >
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p
                    className="font-pixel-mono text-[10px] uppercase tracking-[1.5px]"
                    style={{ color: AMBER, opacity: 0.75 }}
                  >
                    Unclaimed Yield
                  </p>
                  <p
                    className="font-pixel-mono text-2xl font-bold"
                    style={{ color: GREEN, textShadow: '0 1px 2px rgba(0,0,0,0.85)' }}
                  >
                    {unclaimedUsdc} USDC
                  </p>
                </div>
                <Coins size={28} color={GREEN} strokeWidth={2.2} />
              </div>
              <button
                onClick={handleClaim}
                disabled={Number(state?.unclaimedYieldAmount ?? '0') <= 0 || claimingBusy}
                className="w-full py-3 rounded-lg font-bold text-sm uppercase tracking-[2px] font-pixel cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 hover:brightness-110 transition-all"
                style={{
                  border: `1px solid ${GREEN}`,
                  background:
                    'linear-gradient(180deg, rgba(62,230,138,0.18) 0%, rgba(62,230,138,0.08) 100%)',
                  color: GREEN,
                  textShadow: '0 1px 2px rgba(0,0,0,0.85)',
                }}
              >
                {claimingBusy
                  ? 'Claiming...'
                  : justClaimed
                    ? `+${justClaimed} USDC claimed!`
                    : 'Claim to Wallet'}
              </button>
              {claimSignature && (
                <a
                  href={`https://explorer.solana.com/tx/${claimSignature}?cluster=devnet`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block mt-2 text-center font-pixel-mono text-[10px] uppercase tracking-[1.5px] underline hover:brightness-125"
                  style={{ color: GREEN }}
                >
                  View transaction ↗
                </a>
              )}
            </CozyCard>

            {/* 7-day strip */}
            {last7Days.length > 0 && (
              <CozyCard className="mb-5" style={{ padding: 14 }}>
                <CozySectionLabel>Last 7 Days</CozySectionLabel>
                <div className="flex flex-col gap-1.5 mt-2">
                  {last7Days.map((entry) => (
                    <SevenDayRow key={entry.day} entry={entry} />
                  ))}
                </div>
              </CozyCard>
            )}

            {error && (
              <p
                className="text-[12px] text-center mt-3 font-pixel-mono"
                style={{ color: T.crimson }}
              >
                {error}
              </p>
            )}
          </>
        )}
      </div>

      <style jsx>{`
        @keyframes brewery-fire-flicker {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.05); opacity: 0.92; }
        }
      `}</style>
    </div>
  );
}

function SevenDayRow({ entry }: { entry: BreweryDayStripEntry }) {
  const user = Number(entry.userAmount);
  const pot = Number(entry.potAmount);
  const total = user + pot;
  const userPct = total > 0 ? (user / total) * 100 : 0;
  const wasLit = user > 0;

  return (
    <div className="grid items-center gap-3" style={{ gridTemplateColumns: '50px 1fr 90px' }}>
      <span
        className="font-pixel-mono text-[10px] uppercase tracking-[1px]"
        style={{ color: T.textMuted }}
      >
        {formatDayLabel(entry.day)}
      </span>
      <div
        className="h-2 rounded-full overflow-hidden"
        style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}
      >
        <div
          className="h-full"
          style={{
            width: `${Math.max(2, userPct)}%`,
            background: `linear-gradient(90deg, ${GREEN}99 0%, ${GREEN} 100%)`,
            boxShadow: wasLit ? `0 0 6px ${GREEN}55` : 'none',
            transition: 'width 400ms',
          }}
        />
      </div>
      <span
        className="font-pixel-mono text-[10px] text-right"
        style={{ color: wasLit ? GREEN : T.textMuted }}
      >
        {wasLit ? `+$${formatUsdc(user)}` : '→ pot'}
      </span>
    </div>
  );
}
