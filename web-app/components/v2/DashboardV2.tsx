'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CozyCard, CozySectionLabel, COZY_TEXT, COZY_TEXT_SHADOW } from '@/components/cozy';
import { T } from '@/components/theme';
import { HubButton } from '@/components/HubButton';
import { LiveApyChip } from '@/components/LiveApyChip';
import { useCourseStore, useUserStore } from '@/stores';
import { useAuth } from '@/hooks/useAuth';
import { getLockPosition, getUserXp } from '@/services/api/progress/progressApi';
import { fetchWithAuth } from '@/services/api';
import { retryPendingEnrolls } from '@/services/enroll/pendingEnroll';
import { hasVaultV2Config } from '@/services/solana/vaultV2';
import { PositionCard, type PositionCardData } from './PositionCard';
import { ClosedPositionCard } from './ClosedPositionCard';
import { readClaimSuccessRecord } from '@/services/claim/claimReceipt';
import {
  ActivityHeatmap,
  JourneyStats,
  XpHero,
  LEVEL_NAMES,
} from './DashboardExtras';
import type { LockPositionResponse } from '@/services/api/types';

// v2 dashboard (spec §5): one PositionCard per enrolled course. Positions are
// fetched per course on mount, re-polled every 60s, paused while hidden.
// Renders an <h1> (existing dashboard e2e asserts one) and designed empty
// states — never a blank section.

const POSITION_POLL_MS = 60_000;

export function DashboardV2() {
  const router = useRouter();
  const { disconnect } = useAuth();
  const authToken = useUserStore((s) => s.authToken);
  const walletAddress = useUserStore((s) => s.walletAddress);
  const displayName = useUserStore((s) => s.displayName);
  const createdAt = useUserStore((s) => s.createdAt);
  const courses = useCourseStore((s) => s.courses);
  const lessons = useCourseStore((s) => s.lessons);
  const lessonProgress = useCourseStore((s) => s.lessonProgress);
  const enrolledCourseIds = useCourseStore((s) => s.enrolledCourseIds);
  const courseStates = useCourseStore((s) => s.courseStates);
  const refreshCourseRuntime = useCourseStore((s) => s.refreshCourseRuntime);

  const [xp, setXp] = useState<{ xpTotal: number; xpLevel: number; thresholds: number[] }>({
    xpTotal: 0,
    xpLevel: 1,
    thresholds: [0, 500, 1500, 3500, 7000, 12000, 20000],
  });
  const [positions, setPositions] = useState<Record<string, LockPositionResponse>>({});
  const [positionErrors, setPositionErrors] = useState<Record<string, boolean>>({});
  const [retryTick, setRetryTick] = useState(0);
  const [positionsTab, setPositionsTab] = useState<'active' | 'claimed'>('active');
  const claimEnabled = hasVaultV2Config();

  // Pending-enroll heal (ruling R13): deposits whose server-side enroll failed
  // left a localStorage record — retry them on every dashboard mount until the
  // server accepts (200) or terminally refuses (403/404). Fire-and-forget.
  useEffect(() => {
    if (!authToken || !walletAddress) return;
    void retryPendingEnrolls(walletAddress);
  }, [authToken, walletAddress]);

  // XP for the hero bar (carried over from the legacy dashboard).
  useEffect(() => {
    if (!authToken) return;
    // fetchWithAuth auto-refreshes an expired 15-min access token (getUserXp with
    // a raw token would just 401 when it lapses).
    fetchWithAuth((t) => getUserXp(t))
      .then((d) => {
        if (!d) return;
        setXp({
          xpTotal: d.xpTotal ?? 0,
          xpLevel: d.xpLevel ?? 1,
          thresholds: d.levelThresholds ?? [0, 500, 1500, 3500, 7000, 12000, 20000],
        });
      })
      .catch(() => {});
  }, [authToken]);

  // Fan out runtime refresh for EVERY enrolled course (not just the active one).
  // Re-runs with the position poll so completedToday/lapse state can't go stale
  // across UTC midnight while the card still reads "blazing".
  useEffect(() => {
    if (!authToken) return;
    for (const courseId of enrolledCourseIds) {
      void refreshCourseRuntime(courseId, authToken);
    }
  }, [authToken, enrolledCourseIds, refreshCourseRuntime, retryTick]);

  // Position polling: every 60s, paused when the tab is hidden.
  useEffect(() => {
    if (!authToken || enrolledCourseIds.length === 0) return;
    let cancelled = false;

    const fetchAll = async () => {
      if (document.visibilityState === 'hidden') return;
      // Also refresh runtime each poll so the flame gauge tracks day rollover.
      for (const courseId of enrolledCourseIds) void refreshCourseRuntime(courseId, authToken);
      await Promise.all(
        enrolledCourseIds.map(async (courseId) => {
          try {
            // fetchWithAuth refreshes the token on 401 (a raw-token call would
            // fail with "couldn't load position" once the access token expires).
            const position = await fetchWithAuth((t) => getLockPosition(courseId, t));
            if (cancelled) return;
            if (!position) {
              setPositionErrors((prev) => ({ ...prev, [courseId]: true }));
              return;
            }
            setPositions((prev) => ({ ...prev, [courseId]: position }));
            setPositionErrors((prev) => ({ ...prev, [courseId]: false }));
          } catch {
            // Surface the failure so the card offers a retry instead of a
            // permanent "Loading position…" dead state.
            if (!cancelled) setPositionErrors((prev) => ({ ...prev, [courseId]: true }));
          }
        }),
      );
    };

    void fetchAll();
    const id = setInterval(() => void fetchAll(), POSITION_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [authToken, enrolledCourseIds, refreshCourseRuntime, retryTick]);

  const cards: PositionCardData[] = useMemo(
    () =>
      enrolledCourseIds.map((courseId) => {
        const course = courses.find((c) => c.id === courseId);
        const courseLessons = lessons[courseId] ?? [];
        const completedCount = courseLessons.filter((l) => lessonProgress[l.id]?.completed).length;
        const nextLesson = courseLessons.find((l) => !lessonProgress[l.id]?.completed);
        const state = courseStates[courseId];
        return {
          courseId,
          title: course?.title ?? courseId,
          completedLessons: completedCount,
          totalLessons: courseLessons.length || course?.totalLessons || 0,
          nextLessonId: nextLesson?.id ?? null,
          nextLessonTitle: nextLesson?.title ?? 'Continue',
          currentStreak: state?.currentStreak ?? 0,
          shields: state?.shields ?? 3,
          lapseCount: state?.lapseCount ?? 0,
          lapseOpen: state?.lapseOpen ?? false,
          completedToday: state?.completedToday ?? false,
          dayEndsAtUtc: state?.dayEndsAtUtc ?? null,
          voucherAvailable: state?.voucherAvailable ?? false,
        };
      }),
    [enrolledCourseIds, courses, lessons, lessonProgress, courseStates],
  );

  // XP hero derivations.
  const level = Math.max(1, xp.xpLevel);
  const levelName = LEVEL_NAMES[level - 1] ?? `Level ${level}`;
  const xpFromLevel = xp.thresholds[level - 1] ?? 0;
  const xpToNext = xp.thresholds[level] ?? xpFromLevel + Math.max(1, xp.xpTotal - xpFromLevel) * 2;
  const xpInLevel = Math.max(0, xp.xpTotal - xpFromLevel);
  const xpRange = Math.max(1, xpToNext - xpFromLevel);
  const truncatedWallet = walletAddress
    ? `${walletAddress.slice(0, 4)}…${walletAddress.slice(-4)}`
    : '';
  const heroStreak = Math.max(0, ...cards.map((c) => c.currentStreak), 0);

  // Journey + heatmap derivations.
  const activeToday = cards.some((c) => c.completedToday);
  const completedAtList = useMemo(
    () => Object.values(lessonProgress).filter((p) => p.completed).map((p) => p.completedAt),
    [lessonProgress],
  );
  // Years the selector offers: contiguous from the earliest signal (account
  // creation or first completion) up to the current year, newest first —
  // GitHub-style. Always includes the current year even with zero activity.
  const availableYears = useMemo(() => {
    const currentYear = new Date().getFullYear();
    let earliest = currentYear;
    const createdYear = createdAt ? new Date(createdAt).getFullYear() : NaN;
    if (Number.isFinite(createdYear)) earliest = Math.min(earliest, createdYear);
    for (const iso of completedAtList) {
      if (!iso) continue;
      const t = Date.parse(iso);
      if (!Number.isNaN(t)) earliest = Math.min(earliest, new Date(t).getFullYear());
    }
    const out: number[] = [];
    for (let y = currentYear; y >= earliest; y -= 1) out.push(y);
    return out;
  }, [completedAtList, createdAt]);
  const lessonsCompleted = useMemo(
    () => Object.values(lessonProgress).filter((p) => p.completed).length,
    [lessonProgress],
  );
  const longestStreak = Math.max(0, ...Object.values(courseStates).map((s) => s?.longestStreak ?? 0), 0);
  const coursesEnrolled = enrolledCourseIds.length;
  const memberSince = createdAt
    ? new Date(createdAt).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    : '—';

  // Disconnect (mirrors the legacy dashboard's DisconnectFooter): confirm,
  // then useAuth.disconnect → privyLogout + full client-state wipe + reload.
  const handleDisconnect = () => {
    if (typeof window === 'undefined') return;
    if (window.confirm('Disconnect your wallet and sign out?')) {
      void disconnect();
    }
  };

  return (
    <div data-testid="v2-dashboard" className="min-h-screen relative" style={{ backgroundColor: T.bg }}>
      {/* Cottage interior backdrop, same treatment as the rest of the app. */}
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

      <div className="relative z-10 max-w-[720px] mx-auto px-[18px] pb-12">
        <div className="pt-20" />

        {/* Neither the pixel-font title nor the APY chip shrinks on its own —
            at 390px they overflowed the viewport by ~11px. Smaller title on
            mobile + a shrinkable chip wrapper keeps the row inside the page. */}
        <div className="flex items-center justify-between gap-3 mb-5">
          <h1
            className="text-2xl md:text-3xl font-bold tracking-wide font-pixel min-w-0"
            style={{ color: COZY_TEXT, textShadow: COZY_TEXT_SHADOW }}
          >
            Dashboard
          </h1>
          <div className="min-w-0 shrink">
            <LiveApyChip />
          </div>
        </div>

        {/* XP hero (carried from the legacy dashboard). */}
        <XpHero
          displayName={displayName ?? 'Learner'}
          truncatedWallet={truncatedWallet}
          level={level}
          levelName={levelName}
          xpInLevel={xpInLevel}
          xpRange={xpRange}
          currentStreak={heroStreak}
        />

        {cards.length === 0 ? (
          <CozyCard data-testid="v2-empty-state" className="text-center" style={{ padding: 28 }}>
            <p className="font-pixel text-lg mb-2" style={{ color: COZY_TEXT, textShadow: COZY_TEXT_SHADOW }}>
              No courses yet
            </p>
            <p
              className="font-pixel-mono text-[12px] mb-5"
              style={{ color: T.textMutedStrong, textShadow: '0 1px 2px rgba(0,0,0,0.7)' }}
            >
              Lock a small stake on a course. Learn daily, keep the flame lit, claim it back with yield.
            </p>
            <button
              onClick={() => router.push('/courses')}
              className="px-6 py-3 rounded-lg border font-pixel text-sm uppercase tracking-[2px] font-bold min-h-[44px]"
              style={{
                backgroundColor: 'rgba(255,213,128,0.12)',
                borderColor: 'rgba(255,213,128,0.4)',
                color: COZY_TEXT,
                textShadow: COZY_TEXT_SHADOW,
              }}
            >
              Browse courses
            </button>
          </CozyCard>
        ) : (
          (() => {
            // Settled positions move to the Claimed tab: the course is done
            // AND the position provably ended in a claim — status CLOSED
            // (claim_v2 marks the lock), or NONE with this session's claim
            // receipt. Bare NONE is NOT settled: it also means "never locked
            // in v2" (v1-carryover enrollments), and routing those to a card
            // that says "principal + yield returned" would be a false payout
            // statement. They stay on Active, where the practice-mode badge
            // makes no money claims. Loading/errored positions also stay on
            // Active so a live position can never hide behind the wrong tab.
            const isSettled = (card: PositionCardData) => {
              const pos = positions[card.courseId];
              const courseDone =
                card.totalLessons > 0 && card.completedLessons >= card.totalLessons;
              return (
                courseDone &&
                pos != null &&
                (pos.status === 'CLOSED' ||
                  (pos.status === 'NONE' && readClaimSuccessRecord(card.courseId) != null))
              );
            };
            const activeCards = cards.filter((c) => !isSettled(c));
            const claimedCards = cards.filter(isSettled);
            const shown = positionsTab === 'active' ? activeCards : claimedCards;

            const tabStyle = (selected: boolean) =>
              ({
                backgroundColor: selected ? 'rgba(255,213,128,0.14)' : 'rgba(255,255,255,0.03)',
                borderColor: selected ? 'rgba(255,213,128,0.5)' : T.borderDormant,
                color: selected ? COZY_TEXT : T.textMutedStrong,
                textShadow: COZY_TEXT_SHADOW,
              }) as const;

            return (
              <>
                <div className="flex items-center justify-between gap-3">
                  <CozySectionLabel>Your positions</CozySectionLabel>
                  <div className="flex items-center gap-1.5 mb-3" role="tablist" aria-label="Positions">
                    <button
                      data-testid="v2-positions-tab-active"
                      role="tab"
                      aria-selected={positionsTab === 'active'}
                      onClick={() => setPositionsTab('active')}
                      className="px-3 py-1.5 rounded-md border font-pixel-mono text-[10px] uppercase tracking-[1.5px] cursor-pointer"
                      style={tabStyle(positionsTab === 'active')}
                    >
                      Active{activeCards.length > 0 ? ` · ${activeCards.length}` : ''}
                    </button>
                    <button
                      data-testid="v2-positions-tab-claimed"
                      role="tab"
                      aria-selected={positionsTab === 'claimed'}
                      onClick={() => setPositionsTab('claimed')}
                      className="px-3 py-1.5 rounded-md border font-pixel-mono text-[10px] uppercase tracking-[1.5px] cursor-pointer"
                      style={tabStyle(positionsTab === 'claimed')}
                    >
                      Claimed{claimedCards.length > 0 ? ` · ${claimedCards.length}` : ''}
                    </button>
                  </div>
                </div>
                <div className="flex flex-col gap-4 mb-5">
                  {shown.length === 0 ? (
                    <CozyCard
                      data-testid="v2-positions-tab-empty"
                      className="text-center"
                      style={{ padding: 20 }}
                    >
                      <p className="font-pixel-mono text-[12px]" style={{ color: T.textMutedStrong }}>
                        {positionsTab === 'active'
                          ? 'No active positions — lock a stake on a new course to keep earning.'
                          : 'Nothing claimed yet — finish a course and claim your stake back.'}
                      </p>
                      {positionsTab === 'active' && (
                        <button
                          onClick={() => router.push('/courses')}
                          className="mt-3 px-5 py-2.5 rounded-lg border font-pixel-mono text-[11px] uppercase tracking-[1.5px] min-h-[40px]"
                          style={{
                            backgroundColor: 'rgba(255,213,128,0.12)',
                            borderColor: 'rgba(255,213,128,0.4)',
                            color: COZY_TEXT,
                          }}
                        >
                          Browse courses
                        </button>
                      )}
                    </CozyCard>
                  ) : positionsTab === 'active' ? (
                    activeCards.map((card) => (
                      <PositionCard
                        key={card.courseId}
                        data={card}
                        position={positions[card.courseId] ?? null}
                        positionError={Boolean(positionErrors[card.courseId])}
                        onRetryPosition={() => setRetryTick((t) => t + 1)}
                        claimEnabled={claimEnabled}
                      />
                    ))
                  ) : (
                    claimedCards.map((card) => (
                      <ClosedPositionCard
                        key={card.courseId}
                        courseId={card.courseId}
                        title={card.title}
                        receipt={readClaimSuccessRecord(card.courseId)}
                      />
                    ))
                  )}
                </div>
              </>
            );
          })()
        )}

        {/* Journey + activity (carried from the legacy dashboard). */}
        <JourneyStats
          lessonsCompleted={lessonsCompleted}
          longestStreak={longestStreak}
          coursesEnrolled={coursesEnrolled}
          memberSince={memberSince}
        />
        <ActivityHeatmap
          completedAtList={completedAtList}
          activeToday={activeToday}
          availableYears={availableYears}
          longestStreak={longestStreak}
        />

        {/* Footer disconnect — subtle muted-red bordered button so users can
            actually find logout (was previously only on the legacy dashboard). */}
        <div className="pt-6">
          <button
            type="button"
            data-testid="v2-disconnect"
            onClick={handleDisconnect}
            className="w-full min-h-[44px] px-6 py-3 rounded-lg border font-pixel text-sm uppercase tracking-[2px] font-bold transition-colors cursor-pointer"
            style={{
              backgroundColor: 'rgba(255,68,102,0.08)',
              borderColor: 'rgba(255,68,102,0.35)',
              color: 'rgba(255,68,102,0.80)',
              textShadow: '0 1px 2px rgba(0,0,0,0.7)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = T.crimson;
              e.currentTarget.style.borderColor = 'rgba(255,68,102,0.6)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'rgba(255,68,102,0.80)';
              e.currentTarget.style.borderColor = 'rgba(255,68,102,0.35)';
            }}
          >
            Disconnect Wallet
          </button>
        </div>
      </div>
    </div>
  );
}
