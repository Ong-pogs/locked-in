'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CozyCard, CozySectionLabel, COZY_TEXT, COZY_TEXT_SHADOW } from '@/components/cozy';
import { T } from '@/components/theme';
import { HubButton } from '@/components/HubButton';
import { LiveApyChip } from '@/components/LiveApyChip';
import { useCourseStore, useUserStore } from '@/stores';
import { getLockPosition, getUserXp } from '@/services/api/progress/progressApi';
import { retryPendingEnrolls } from '@/services/enroll/pendingEnroll';
import { hasVaultV2Config } from '@/services/solana/vaultV2';
import { PositionCard, type PositionCardData } from './PositionCard';
import {
  ActivityHeatmap,
  JourneyStats,
  XpHero,
  LEVEL_NAMES,
  buildYearActivity,
} from './DashboardExtras';
import type { LockPositionResponse } from '@/services/api/types';

// v2 dashboard (spec §5): one PositionCard per enrolled course. Positions are
// fetched per course on mount, re-polled every 60s, paused while hidden.
// Renders an <h1> (existing dashboard e2e asserts one) and designed empty
// states — never a blank section.

const POSITION_POLL_MS = 60_000;

export function DashboardV2() {
  const router = useRouter();
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
    getUserXp(authToken)
      .then((d) =>
        setXp({
          xpTotal: d.xpTotal ?? 0,
          xpLevel: d.xpLevel ?? 1,
          thresholds: d.levelThresholds ?? [0, 500, 1500, 3500, 7000, 12000, 20000],
        }),
      )
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
            const position = await getLockPosition(courseId, authToken);
            if (cancelled) return;
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
  const yearActivity = useMemo(
    () =>
      buildYearActivity(
        Object.values(lessonProgress).filter((p) => p.completed).map((p) => p.completedAt),
        activeToday,
      ),
    [lessonProgress, activeToday],
  );
  const lessonsCompleted = useMemo(
    () => Object.values(lessonProgress).filter((p) => p.completed).length,
    [lessonProgress],
  );
  const longestStreak = Math.max(0, ...Object.values(courseStates).map((s) => s?.longestStreak ?? 0), 0);
  const coursesEnrolled = enrolledCourseIds.length;
  const memberSince = createdAt
    ? new Date(createdAt).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    : '—';

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

        <div className="flex items-center justify-between mb-5">
          <h1
            className="text-3xl font-bold tracking-wide font-pixel"
            style={{ color: COZY_TEXT, textShadow: COZY_TEXT_SHADOW }}
          >
            Dashboard
          </h1>
          <LiveApyChip />
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
          <>
            <CozySectionLabel>Your positions</CozySectionLabel>
            <div className="flex flex-col gap-4 mb-5">
              {cards.map((card) => (
                <PositionCard
                  key={card.courseId}
                  data={card}
                  position={positions[card.courseId] ?? null}
                  positionError={Boolean(positionErrors[card.courseId])}
                  onRetryPosition={() => setRetryTick((t) => t + 1)}
                  claimEnabled={claimEnabled}
                />
              ))}
            </div>
          </>
        )}

        {/* Journey + activity (carried from the legacy dashboard). */}
        <JourneyStats
          lessonsCompleted={lessonsCompleted}
          longestStreak={longestStreak}
          coursesEnrolled={coursesEnrolled}
          memberSince={memberSince}
        />
        <ActivityHeatmap yearActivity={yearActivity} longestStreak={longestStreak} />
      </div>
    </div>
  );
}
