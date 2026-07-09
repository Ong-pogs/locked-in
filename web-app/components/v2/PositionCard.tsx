'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CozyCard, COZY_TEXT, COZY_TEXT_SHADOW } from '@/components/cozy';
import { T } from '@/components/theme';
import { FlameGauge } from './FlameGauge';
import { ShieldPips } from './ShieldPips';
import { PenaltyBanner } from './PenaltyBanner';
import { deriveFlameState } from '@/services/flame/deriveFlameState';
import type { LockPositionResponse } from '@/services/api/types';

// v2 course card (spec §5): live position value, flame gauge, shields, streak,
// progress bar, next-lesson CTA, CLAIM when armed, penalty banner when lapsed.
// Reads ONLY v2 + streak + day fields — zero fuel/ichor/saver references, so
// the upcoming legacy column drops can't churn this card.

export interface PositionCardData {
  courseId: string;
  title: string;
  completedLessons: number;
  totalLessons: number;
  nextLessonId: string | null;
  nextLessonTitle: string;
  currentStreak: number;
  shields: number;
  lapseCount: number;
  lapseOpen: boolean;
  completedToday: boolean;
  dayEndsAtUtc: string | null;
  voucherAvailable: boolean;
}

interface Props {
  data: PositionCardData;
  position: LockPositionResponse | null; // null = still loading
  claimEnabled: boolean; // hasVaultV2Config() — passed down so the card stays pure
}

// Ticking yield line: pure function of Date.now() (rAF-driven) so Playwright's
// clock API freezes it; static under prefers-reduced-motion.
function useTickingYield(position: LockPositionResponse | null): string | null {
  const [display, setDisplay] = useState<string | null>(null);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    if (!position?.liveValueUi || !position?.principalUi) {
      setDisplay(null);
      return;
    }
    const live = Number(position.liveValueUi);
    const principal = Number(position.principalUi);
    if (!Number.isFinite(live) || !Number.isFinite(principal)) {
      setDisplay(null);
      return;
    }
    const baseYield = Math.max(0, live - principal);
    const asOfMs = Date.parse(position.asOf);
    // ~5% APY drift between 60s polls — cosmetic accrual, resynced every poll.
    const perMs = (live * 0.05) / (365 * 24 * 3600 * 1000);

    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    const compute = () =>
      (baseYield + Math.max(0, Date.now() - asOfMs) * perMs).toFixed(7);

    if (reduced) {
      setDisplay(baseYield.toFixed(7));
      return;
    }
    const loop = () => {
      setDisplay(compute());
      frame.current = requestAnimationFrame(loop);
    };
    frame.current = requestAnimationFrame(loop);
    return () => {
      if (frame.current != null) cancelAnimationFrame(frame.current);
    };
  }, [position]);

  return display;
}

function countdownTo(iso: string | null, now: number): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso) - now;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function PositionCard({ data, position, claimEnabled }: Props) {
  const router = useRouter();
  const flame = deriveFlameState(data);
  const tickingYield = useTickingYield(position);

  // Countdown refreshes every 30s (Date.now-driven — clock-fakeable).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const countdown = flame === 'flickering' ? countdownTo(data.dayEndsAtUtc, now) : null;

  const progress = data.totalLessons > 0 ? data.completedLessons / data.totalLessons : 0;
  const courseComplete = data.totalLessons > 0 && data.completedLessons >= data.totalLessons;

  const claimArmed = claimEnabled && data.voucherAvailable && position?.status === 'ACTIVE';
  const practiceMode =
    courseComplete && position != null && (position.status === 'NONE' || position.status === 'CLOSED');

  const headlineValue = position?.liveValueUi ?? position?.principalUi ?? null;

  return (
    <CozyCard
      data-testid="v2-position-card"
      data-course-id={data.courseId}
      className="w-full"
      style={{ padding: 16 }}
    >
      {/* Header: title + flame */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3
            className="font-pixel text-lg leading-tight truncate"
            style={{ color: COZY_TEXT, textShadow: COZY_TEXT_SHADOW }}
          >
            {data.title}
          </h3>
          {/* Position value */}
          <div data-testid="v2-position-value" className="mt-1.5">
            {position == null ? (
              <span className="font-pixel-mono text-sm" style={{ color: T.textMuted }}>
                Loading position…
              </span>
            ) : headlineValue != null ? (
              <>
                <span
                  className="font-pixel-mono text-2xl font-bold"
                  style={{ color: '#3EE68A', textShadow: COZY_TEXT_SHADOW }}
                >
                  ${headlineValue}
                </span>
                {tickingYield != null && (
                  <span className="font-pixel-mono text-[11px] ml-2" style={{ color: '#3EE68A', opacity: 0.75 }}>
                    +${tickingYield} yield
                  </span>
                )}
              </>
            ) : (
              <span className="font-pixel-mono text-sm" style={{ color: T.textMuted }}>
                No position
              </span>
            )}
          </div>
        </div>
        <FlameGauge state={flame} />
      </div>

      {/* Countdown urgency line (flickering only) */}
      {countdown && (
        <p
          data-testid="v2-day-countdown"
          className="font-pixel-mono text-[11px] mt-2"
          style={{ color: '#E8A24A', textShadow: COZY_TEXT_SHADOW }}
        >
          ⏳ {countdown} left to keep the flame — finish a lesson
        </p>
      )}

      {/* Penalty banner (lapsed only) */}
      <PenaltyBanner lapseCount={data.lapseCount} className="mt-2" />

      {/* Stats row: shields + streak */}
      <div className="flex items-center justify-between mt-3">
        <ShieldPips shields={data.shields} />
        <span
          data-testid="v2-streak"
          className="font-pixel-mono text-[12px]"
          style={{ color: COZY_TEXT, textShadow: COZY_TEXT_SHADOW }}
        >
          ⚡ {data.currentStreak}-day streak
        </span>
      </div>

      {/* Progress */}
      <div className="mt-3">
        <div className="flex justify-between mb-1">
          <span className="font-pixel-mono text-[10px] uppercase tracking-[1px]" style={{ color: T.textMuted }}>
            Progress
          </span>
          <span className="font-pixel-mono text-[10px]" style={{ color: COZY_TEXT, opacity: 0.8 }}>
            {data.completedLessons}/{data.totalLessons}
          </span>
        </div>
        <div
          data-testid="v2-progress-bar"
          className="h-1.5 rounded-[3px] overflow-hidden"
          style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}
        >
          <div
            className="h-full rounded-[3px]"
            style={{ width: `${Math.min(100, progress * 100)}%`, backgroundColor: COZY_TEXT }}
          />
        </div>
      </div>

      {/* CTA row */}
      <div className="mt-4 flex flex-col gap-2">
        {claimArmed ? (
          <button
            data-testid="v2-claim-cta"
            onClick={() => router.push(`/claim/${data.courseId}`)}
            className="w-full py-3 rounded-lg border font-pixel text-sm uppercase tracking-[2px] font-bold min-h-[44px]"
            style={{
              backgroundColor: 'rgba(62,230,138,0.15)',
              borderColor: 'rgba(62,230,138,0.6)',
              color: '#3EE68A',
              textShadow: COZY_TEXT_SHADOW,
            }}
          >
            Claim principal + yield
          </button>
        ) : practiceMode ? (
          <span
            data-testid="v2-practice-badge"
            className="w-full py-2 rounded-lg border text-center font-pixel-mono text-[11px] uppercase tracking-[1.5px]"
            style={{
              backgroundColor: 'rgba(153,69,255,0.10)',
              borderColor: 'rgba(153,69,255,0.4)',
              color: '#B98AFF',
            }}
          >
            Course complete — practice mode
          </span>
        ) : null}
        {!courseComplete && data.nextLessonId && (
          <button
            data-testid="v2-next-lesson-cta"
            onClick={() => router.push(`/lessons/${data.nextLessonId}`)}
            className="w-full py-3 rounded-lg border font-pixel-mono text-[12px] min-h-[44px] truncate px-3"
            style={{
              backgroundColor: 'rgba(255,213,128,0.10)',
              borderColor: 'rgba(255,213,128,0.35)',
              color: COZY_TEXT,
              textShadow: COZY_TEXT_SHADOW,
            }}
          >
            ▶ {data.nextLessonTitle}
          </button>
        )}
      </div>
    </CozyCard>
  );
}
