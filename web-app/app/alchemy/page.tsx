'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { FlaskConical } from 'lucide-react';
import { useCourseStore, useUserStore } from '@/stores';
import { T } from '@/components/theme';
import { CozyCard, CozyStatBox, CozySectionLabel } from '@/components/cozy';
import { HubButton } from '@/components/HubButton';

const AMBER = '#FFD580';
const ICHOR_PER_FUEL = 100;

export default function AlchemyPage() {
  const activeCourseId = useCourseStore((s) => s.activeCourseId);
  const courseStates = useCourseStore((s) => s.courseStates);
  const convertFuelForCourse = useCourseStore((s) => s.convertFuelForCourse);
  const authToken = useUserStore((s) => s.authToken);
  const [convertAmount, setConvertAmount] = useState(1);
  const [justConverted, setJustConverted] = useState<number | null>(null);
  const [isConverting, setIsConverting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeState = activeCourseId ? courseStates[activeCourseId] ?? null : null;
  const fuelBalance = activeState?.fuelCounter ?? 0;
  const fuelCap = activeState?.fuelCap ?? 7;
  const ichorBalance = activeState?.ichorBalance ?? 0;
  const fuelFragments = activeState?.fuelFragmentsToday ?? 0;
  const canConvert = fuelBalance > 0 && !isConverting;

  // Clamp convertAmount when fuelBalance changes
  useEffect(() => {
    if (fuelBalance > 0 && convertAmount > fuelBalance) {
      setConvertAmount(fuelBalance);
    }
  }, [fuelBalance, convertAmount]);

  const handleConvert = useCallback(async () => {
    if (!activeCourseId || !canConvert) return;
    const amount = Math.min(convertAmount, fuelBalance);
    setIsConverting(true);
    setError(null);
    try {
      await convertFuelForCourse(activeCourseId, amount, authToken);
      setJustConverted(amount * ICHOR_PER_FUEL);
      setTimeout(() => setJustConverted(null), 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Conversion failed');
    } finally {
      setIsConverting(false);
    }
  }, [activeCourseId, canConvert, convertAmount, fuelBalance, convertFuelForCourse, authToken]);

  const effectiveAmount = Math.min(convertAmount, Math.max(1, fuelBalance));
  const ichorOut = effectiveAmount * ICHOR_PER_FUEL;
  const sliderMax = Math.max(1, fuelBalance);

  // Runic glyphs around the perimeter
  const glyphs = ['⚯', '⚛', '✦', '✧', '✶', '✷', '✺', '❅'];

  // Steam particles — staggered start times + horizontal offsets
  const steamParticles = useMemo(
    () =>
      Array.from({ length: 8 }, (_, i) => ({
        id: i,
        delay: (i * 0.45).toFixed(2),
        duration: (3 + (i % 3) * 0.6).toFixed(2),
        offsetX: ((i - 3.5) * 8).toFixed(0),
        size: 6 + (i % 3) * 2,
      })),
    [],
  );

  // Quick-pick options: 1 / Half / All (deduped)
  const quickPicks = useMemo(() => {
    const picks: { value: number; label: string }[] = [];
    picks.push({ value: 1, label: '1' });
    if (fuelBalance > 2) picks.push({ value: Math.ceil(fuelBalance / 2), label: 'Half' });
    if (fuelBalance > 1) picks.push({ value: fuelBalance, label: 'All' });
    // dedupe by value
    const seen = new Set<number>();
    return picks.filter((p) => {
      if (seen.has(p.value)) return false;
      seen.add(p.value);
      return true;
    });
  }, [fuelBalance]);

  const sliderNotches = useMemo(() => {
    const arr: number[] = [];
    for (let i = 1; i <= sliderMax; i += 1) arr.push(i);
    return arr;
  }, [sliderMax]);

  const denom = Math.max(1, sliderMax - 1);

  return (
    <div className="min-h-screen relative" style={{ backgroundColor: T.bg }}>
      {/* Apothecary interior backdrop. */}
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

      <div className="relative z-10 max-w-[1100px] mx-auto px-[18px] pb-24">
        <div className="pt-20" />

        <h1
          className="text-3xl font-bold tracking-wide font-pixel"
          style={{ color: AMBER, textShadow: '0 1px 2px rgba(0,0,0,0.85)' }}
        >
          Brewery
        </h1>
        <p className="text-sm mt-1 mb-5" style={{ color: 'rgba(255,255,255,0.6)' }}>
          Brew fuel into ichor tokens
        </p>

        <div className="flex flex-col items-center gap-5">
          <CozyCard className="w-full max-w-[560px]" style={{ padding: 32 }}>
            <div className="flex flex-col items-center">
              {/* Hero — runic circle + steam + cauldron */}
              <div className="relative w-[260px] h-[260px] flex items-center justify-center mb-4">
                {/* Steam particles (rendered above cauldron) */}
                <div
                  className="absolute pointer-events-none"
                  style={{ inset: 0, zIndex: 3 }}
                >
                  {steamParticles.map((p) => (
                    <div
                      key={p.id}
                      className="brewery-steam absolute rounded-full"
                      style={{
                        width: p.size,
                        height: p.size,
                        left: `calc(50% + ${p.offsetX}px)`,
                        top: '52%',
                        animationDelay: `${p.delay}s`,
                        animationDuration: `${p.duration}s`,
                      }}
                    />
                  ))}
                </div>

                {/* Rotating runic circle */}
                <div
                  className="absolute inset-0"
                  style={{ animation: 'brewery-rune-spin 60s linear infinite' }}
                >
                  <svg
                    width="100%"
                    height="100%"
                    viewBox="0 0 260 260"
                    style={{
                      position: 'absolute',
                      inset: 0,
                      filter: 'drop-shadow(0 0 8px rgba(255,213,128,0.35))',
                    }}
                  >
                    <circle
                      cx="130"
                      cy="130"
                      r="115"
                      fill="none"
                      stroke={AMBER}
                      strokeOpacity="0.55"
                      strokeWidth="1"
                    />
                    <circle
                      cx="130"
                      cy="130"
                      r="100"
                      fill="none"
                      stroke={AMBER}
                      strokeOpacity="0.30"
                      strokeWidth="1"
                      strokeDasharray="3 6"
                    />
                    <circle
                      cx="130"
                      cy="130"
                      r="125"
                      fill="none"
                      stroke={AMBER}
                      strokeOpacity="0.20"
                      strokeWidth="1"
                    />
                    {glyphs.map((g, i) => {
                      const angle = (i / glyphs.length) * Math.PI * 2 - Math.PI / 2;
                      const r = 115;
                      const x = 130 + Math.cos(angle) * r;
                      const y = 130 + Math.sin(angle) * r;
                      return (
                        <text
                          key={i}
                          x={x}
                          y={y}
                          textAnchor="middle"
                          dominantBaseline="middle"
                          fontSize="14"
                          fill={AMBER}
                          opacity="0.85"
                          style={{ filter: 'drop-shadow(0 0 4px rgba(255,213,128,0.6))' }}
                        >
                          {g}
                        </text>
                      );
                    })}
                  </svg>
                </div>

                {/* Soft inner glow */}
                <div
                  className="absolute rounded-full"
                  style={{
                    inset: 50,
                    background:
                      'radial-gradient(circle, rgba(255,213,128,0.18) 0%, rgba(255,213,128,0) 70%)',
                  }}
                />

                {/* Central cauldron */}
                <FlaskConical
                  size={80}
                  color={AMBER}
                  strokeWidth={1.6}
                  style={{
                    position: 'relative',
                    zIndex: 2,
                    filter: 'drop-shadow(0 4px 14px rgba(255,213,128,0.45))',
                  }}
                />
              </div>

              <CozySectionLabel>Magic Cauldron</CozySectionLabel>

              {/* Horizontal lever slider */}
              <div className="w-full max-w-[420px] mt-3">
                <div className="relative h-12">
                  <div
                    className="absolute top-1/2 left-0 right-0 h-3 -translate-y-1/2 rounded-full"
                    style={{
                      background:
                        'linear-gradient(90deg, rgba(60,30,15,0.85) 0%, rgba(95,55,30,0.85) 50%, rgba(60,30,15,0.85) 100%)',
                      border: '1px solid rgba(58, 143, 168, 0.45)',
                      boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.6)',
                    }}
                  />
                  {sliderNotches.map((n) => (
                    <div
                      key={n}
                      className="absolute top-1/2 -translate-y-1/2 w-[2px] h-3.5"
                      style={{
                        left: `${((n - 1) / denom) * 100}%`,
                        backgroundColor: n <= effectiveAmount ? AMBER : 'rgba(255,213,128,0.25)',
                        boxShadow: n <= effectiveAmount ? '0 0 6px rgba(255,213,128,0.55)' : 'none',
                      }}
                    />
                  ))}
                  <input
                    type="range"
                    min={1}
                    max={sliderMax}
                    step={1}
                    value={effectiveAmount}
                    onChange={(e) => setConvertAmount(Number(e.target.value))}
                    disabled={fuelBalance <= 0}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
                    aria-label="Brew amount"
                  />
                  <div
                    className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-8 h-8 rounded-full pointer-events-none"
                    style={{
                      left: `${((effectiveAmount - 1) / denom) * 100}%`,
                      background: 'radial-gradient(circle at 35% 30%, #FFE9B3 0%, #FFD580 45%, #B7842D 100%)',
                      border: '2px solid #2a1810',
                      boxShadow: '0 2px 6px rgba(0,0,0,0.6), 0 0 12px rgba(255,213,128,0.55), inset 0 1px 0 rgba(255,255,255,0.3)',
                    }}
                  />
                </div>
                <div className="flex justify-between mt-1.5 px-0.5">
                  <span className="font-pixel-mono text-[10px]" style={{ color: T.textMuted }}>
                    1
                  </span>
                  <span className="font-pixel-mono text-[10px]" style={{ color: T.textMuted }}>
                    {sliderMax}
                  </span>
                </div>
              </div>

              {/* Quick-pick pills */}
              {quickPicks.length > 0 && (
                <div className="flex justify-center gap-2 mt-3">
                  {quickPicks.map((pick) => {
                    const active = effectiveAmount === pick.value;
                    return (
                      <button
                        key={pick.label}
                        type="button"
                        onClick={() => setConvertAmount(pick.value)}
                        disabled={fuelBalance <= 0}
                        className="px-3.5 py-1.5 rounded-lg text-[11px] font-pixel-mono font-bold border transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                        style={{
                          borderColor: active ? AMBER : 'rgba(58, 143, 168, 0.45)',
                          color: active ? AMBER : T.textSecondary,
                          backgroundColor: active ? 'rgba(255,213,128,0.10)' : 'transparent',
                        }}
                      >
                        {pick.label}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Live preview */}
              <div className="mt-5 text-center">
                <p
                  className="font-pixel-mono text-[18px]"
                  style={{ color: T.textSecondary, textShadow: '0 1px 2px rgba(0,0,0,0.85)' }}
                >
                  Brewing{' '}
                  <span style={{ color: AMBER, fontWeight: 'bold' }}>{effectiveAmount} Fuel</span>
                  {' → '}
                  <span style={{ color: T.green, fontWeight: 'bold' }}>{ichorOut} Ichor</span>
                </p>
              </div>

              {/* Brew CTA */}
              <button
                onClick={handleConvert}
                disabled={!canConvert}
                className="mt-5 px-10 py-4 rounded-lg text-center font-bold text-base uppercase tracking-[2px] transition-all font-pixel cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 hover:brightness-110"
                style={{
                  border: `1px solid ${AMBER}`,
                  background:
                    'linear-gradient(180deg, rgba(255,213,128,0.22) 0%, rgba(255,213,128,0.10) 100%)',
                  color: AMBER,
                  textShadow: '0 1px 2px rgba(0,0,0,0.85)',
                  boxShadow: '0 0 28px rgba(255,213,128,0.32), inset 0 1px 0 rgba(255,255,255,0.18)',
                }}
              >
                {isConverting
                  ? 'Brewing...'
                  : justConverted
                    ? `+${justConverted} Ichor!`
                    : fuelBalance <= 0
                      ? '◆ No Fuel ◆'
                      : '◆ Brew ◆'}
              </button>

              {error && (
                <p
                  className="text-[12px] text-center mt-3 font-pixel-mono"
                  style={{ color: T.crimson }}
                >
                  {error}
                </p>
              )}
            </div>
          </CozyCard>

          {/* 3-up stat row */}
          <div className="w-full grid grid-cols-3 gap-3">
            <CozyStatBox
              label="Available Fuel"
              value={`${fuelBalance}/${fuelCap}`}
              color={T.rust}
            />
            <CozyStatBox
              label="Ichor Balance"
              value={Math.floor(ichorBalance)}
              color={T.green}
            />
            <CozyCard style={{ padding: 12 }}>
              <p
                className="font-pixel-mono text-[9px] font-bold uppercase tracking-[1.5px] mb-1.5"
                style={{ color: T.textMuted }}
              >
                Today&apos;s Progress
              </p>
              <div className="flex items-center justify-between mb-1.5">
                <span
                  className="text-[18px] font-pixel-mono font-bold"
                  style={{
                    color: fuelFragments >= 1 ? T.green : AMBER,
                    textShadow: '0 1px 2px rgba(0,0,0,0.85)',
                  }}
                >
                  {Math.floor(fuelFragments * 100)}%
                </span>
                <span className="text-[10px] font-pixel-mono" style={{ color: T.textMuted }}>
                  {fuelFragments.toFixed(2)}/1.00
                </span>
              </div>
              <div
                className="w-full h-1.5 rounded-full overflow-hidden"
                style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}
              >
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.min(100, fuelFragments * 100)}%`,
                    backgroundColor: fuelFragments >= 1 ? T.green : AMBER,
                  }}
                />
              </div>
            </CozyCard>
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes brewery-rune-spin {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }
        @keyframes brewery-steam-rise {
          0% {
            transform: translate(-50%, 0) scale(0.6);
            opacity: 0;
          }
          15% {
            opacity: 0.7;
          }
          100% {
            transform: translate(-50%, -130px) scale(1.6);
            opacity: 0;
          }
        }
        :global(.brewery-steam) {
          background: radial-gradient(
            circle,
            rgba(255, 240, 210, 0.85) 0%,
            rgba(255, 240, 210, 0.25) 60%,
            rgba(255, 240, 210, 0) 100%
          );
          transform: translate(-50%, 0);
          animation-name: brewery-steam-rise;
          animation-iteration-count: infinite;
          animation-timing-function: ease-out;
          filter: blur(1px);
        }
      `}</style>
    </div>
  );
}
