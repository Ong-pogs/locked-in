'use client';

import { useState, useCallback, useEffect } from 'react';
import { useCourseStore, useUserStore } from '@/stores';
import { T } from '@/components/theme';
import { CozyCard, CozyStatBox } from '@/components/cozy';
import { HubButton } from '@/components/HubButton';

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

  // Clamp convertAmount when fuelBalance changes
  useEffect(() => {
    if (fuelBalance > 0 && convertAmount > fuelBalance) {
      setConvertAmount(fuelBalance);
    }
  }, [fuelBalance, convertAmount]);
  const fuelCap = activeState?.fuelCap ?? 7;
  const ichorBalance = activeState?.ichorBalance ?? 0;
  const fuelFragments = activeState?.fuelFragmentsToday ?? 0;
  const canConvert = fuelBalance > 0 && !isConverting;

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

  const effectiveAmount = Math.min(convertAmount, fuelBalance || 1);

  return (
    <div className="min-h-screen relative" style={{ backgroundColor: T.bg }}>
      {/* Apothecary interior backdrop slot — drop apothecarybackground.png in
          /public/images/apothecary/ to activate. Falls back to flat dark bg. */}
      <div aria-hidden className="fixed inset-0 z-0 pointer-events-none">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/images/apothecary/apothecarybackground.png"
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
          style={{
            color: '#FFD580',
            textShadow: '0 1px 2px rgba(0,0,0,0.85)',
          }}
        >
          Alchemy
        </h1>
        <p className="text-sm mt-1 mb-5" style={{ color: 'rgba(255,255,255,0.6)' }}>
          Brew fuel into ichor tokens
        </p>

        {/* 2-column layout on desktop */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Left: Conversion UI */}
          <CozyCard style={{ padding: 24 }}>
            <p
              className="font-pixel-mono text-[10px] font-bold uppercase tracking-[2px] text-center mb-2"
              style={{ color: T.textMuted }}
            >
              Brew Fuel into Ichor
            </p>
            <p
              className="text-[13px] text-center mb-5"
              style={{ color: T.textSecondary }}
            >
              1 Fuel = {ICHOR_PER_FUEL} Ichor
            </p>

            {/* Amount selector */}
            <div className="flex items-center justify-center gap-4 mb-5">
              <button
                onClick={() => setConvertAmount(Math.max(1, convertAmount - 1))}
                disabled={convertAmount <= 1}
                className="w-10 h-10 rounded-lg border flex items-center justify-center text-lg font-bold transition-colors"
                style={{
                  borderColor: 'rgba(58, 143, 168, 0.45)',
                  color: convertAmount <= 1 ? T.textMuted : '#FFD580',
                  backgroundColor: 'transparent',
                }}
              >
                -
              </button>
              <div className="text-center">
                <p
                  className="text-[42px] font-bold font-pixel-mono"
                  style={{
                    color: '#FFD580',
                    textShadow: '0 1px 2px rgba(0,0,0,0.85)',
                  }}
                >
                  {effectiveAmount}
                </p>
                <p
                  className="font-pixel-mono text-[9px] uppercase tracking-[1px]"
                  style={{ color: T.textMuted }}
                >
                  Fuel
                </p>
              </div>
              <button
                onClick={() => setConvertAmount(Math.min(fuelBalance, convertAmount + 1))}
                disabled={convertAmount >= fuelBalance}
                className="w-10 h-10 rounded-lg border flex items-center justify-center text-lg font-bold transition-colors"
                style={{
                  borderColor: 'rgba(58, 143, 168, 0.45)',
                  color: convertAmount >= fuelBalance ? T.textMuted : '#FFD580',
                  backgroundColor: 'transparent',
                }}
              >
                +
              </button>
            </div>

            {/* Quick select pills */}
            <div className="flex justify-center gap-2 mb-5">
              {[1, ...(fuelBalance > 2 ? [Math.ceil(fuelBalance / 2)] : []), ...(fuelBalance > 1 ? [fuelBalance] : [])].filter((v, i, a) => a.indexOf(v) === i).map((amount) => (
                <button
                  key={amount}
                  onClick={() => setConvertAmount(amount)}
                  className="px-3.5 py-1.5 rounded-lg text-[11px] font-pixel-mono font-bold border transition-colors"
                  style={{
                    borderColor: convertAmount === amount ? '#FFD580' : 'rgba(58, 143, 168, 0.45)',
                    color: convertAmount === amount ? '#FFD580' : T.textSecondary,
                    backgroundColor: convertAmount === amount ? 'rgba(255,213,128,0.10)' : 'transparent',
                  }}
                >
                  {amount === fuelBalance ? 'All' : amount}
                </button>
              ))}
            </div>

            {/* Output preview */}
            <div
              className="rounded-lg p-3.5 text-center mb-5"
              style={{
                background: 'rgba(62,230,138,0.04)',
                border: '1px solid rgba(62,230,138,0.15)',
              }}
            >
              <p
                className="font-pixel-mono text-[10px] uppercase tracking-[1px]"
                style={{ color: T.textMuted }}
              >
                You&apos;ll receive
              </p>
              <p
                className="text-[28px] font-bold font-pixel-mono mt-1"
                style={{ color: T.green, textShadow: '0 1px 2px rgba(0,0,0,0.85)' }}
              >
                {effectiveAmount * ICHOR_PER_FUEL} Ichor
              </p>
            </div>

            {/* Convert button */}
            <button
              onClick={handleConvert}
              disabled={!canConvert}
              className="w-full py-3 rounded-lg text-center font-bold text-sm uppercase tracking-[1px] transition-colors font-pixel"
              style={{
                border: `1px solid ${canConvert ? '#FFD580' : 'rgba(58, 143, 168, 0.45)'}`,
                background: canConvert ? 'rgba(255,213,128,0.12)' : 'transparent',
                color: canConvert ? '#FFD580' : T.textMuted,
                opacity: canConvert ? 1 : 0.4,
                cursor: canConvert ? 'pointer' : 'not-allowed',
              }}
            >
              {isConverting
                ? 'Converting...'
                : justConverted
                  ? `+${justConverted} Ichor!`
                  : fuelBalance <= 0
                    ? 'No Fuel to Convert'
                    : '◆ Convert ◆'}
            </button>

            {error && (
              <p className="text-[12px] text-center mt-2" style={{ color: T.crimson }}>
                {error}
              </p>
            )}
          </CozyCard>

          {/* Right: Stats + Daily Fuel */}
          <div className="flex flex-col gap-3">
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
            <CozyCard style={{ padding: 16 }}>
              <p
                className="font-pixel-mono text-[10px] font-bold uppercase tracking-[2px] mb-3"
                style={{ color: T.textMuted }}
              >
                Daily Fuel Progress
              </p>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-pixel-mono" style={{ color: T.textMuted }}>
                  Fragments earned today
                </span>
                <span
                  className="text-[12px] font-pixel-mono font-bold"
                  style={{ color: fuelFragments >= 1 ? T.green : '#FFD580' }}
                >
                  {fuelFragments.toFixed(2)} / 1.00
                </span>
              </div>
              <div className="w-full h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}>
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.min(100, fuelFragments * 100)}%`,
                    backgroundColor: fuelFragments >= 1 ? T.green : '#FFD580',
                  }}
                />
              </div>
            </CozyCard>
          </div>
        </div>
      </div>
    </div>
  );
}
