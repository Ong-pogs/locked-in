'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLogin } from '@privy-io/react-auth';
import { Flame, ChevronRight } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useFlameStore } from '@/stores/flameStore';
import { getUserEnrollments, getUserXp } from '@/services/api/progress/progressApi';
import { useCourseStore, useUserStore } from '@/stores';
import type { Course, CourseCategory, CourseDifficulty } from '@/types';
import {
  CornerMarks,
  PrimaryButton,
  T,
} from '@/components/theme';
import { CozyCard, CozySectionLabel } from '@/components/cozy';
import { HubButton } from '@/components/HubButton';

// ── Constants ─────────────────────────────────────────────────────────────
const AMBER = '#FFD580';

// ── Helpers ───────────────────────────────────────────────────────────────
const DIFFICULTY_COLORS: Record<CourseDifficulty, string> = {
  beginner: T.green,
  intermediate: T.teal,
  advanced: T.crimson,
};

const CATEGORY_COLORS: Record<CourseCategory, string> = {
  solana: T.violet,
  web3: T.teal,
  defi: T.teal,
  security: T.crimson,
  rust: T.rust,
};

const CATEGORY_LABELS: Record<CourseCategory, string> = {
  solana: 'Solana',
  web3: 'Web3',
  defi: 'DeFi',
  security: 'Security',
  rust: 'Rust',
};

function Tag({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="px-2 py-[3px] rounded text-[9px] font-bold uppercase tracking-[1px] font-pixel-mono"
      style={{ color, backgroundColor: `${color}14`, border: `1px solid ${color}30` }}
    >
      {label}
    </span>
  );
}

function DifficultyFlasks({ level }: { level: number }) {
  const fills = [T.green, T.teal, T.crimson];
  return (
    <div className="flex gap-[3px] items-center">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="relative rounded-[3px]"
          style={{
            width: 8, height: 14,
            backgroundColor: i < level ? fills[i] : 'rgba(255,255,255,0.06)',
            opacity: i < level ? 1 : 0.3,
            border: `0.5px solid ${i < level ? `${fills[i]}40` : 'rgba(255,255,255,0.04)'}`,
          }}
        >
          {i < level && (
            <div
              className="absolute rounded-sm"
              style={{ bottom: 2, left: 1, right: 1, height: 4, backgroundColor: 'rgba(255,255,255,0.15)' }}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function StatsRow({ course, accentColor }: { course: Course; accentColor: string }) {
  const catLabel = CATEGORY_LABELS[course.category] ?? course.category;
  return (
    <div
      className="flex items-center gap-2 pt-3 mt-3"
      style={{ borderTop: `1px solid ${T.borderDormant}` }}
    >
      <span className="font-pixel-mono text-[10px]" style={{ color: T.textMuted }}>
        {course.totalModules ?? 1} mod
      </span>
      <span className="text-[10px]" style={{ color: 'rgba(255,255,255,0.08)' }}>&middot;</span>
      <span className="font-pixel-mono text-[10px]" style={{ color: T.textMuted }}>
        {course.totalLessons} lessons
      </span>
      <span className="flex-1" />
      <span
        className="font-pixel-mono text-[9px] uppercase tracking-[1px]"
        style={{ color: `${accentColor}90` }}
      >
        {catLabel}
      </span>
    </div>
  );
}

/* Course card — Library variant layout, wired for both onboarding (select) and post-onboarding (enroll) flows */
function CourseCard({
  course,
  actualLessonCount,
  selected,
  onSelect,
  showEnrollButton,
  onEnroll,
  forceComingSoon,
}: {
  course: Course;
  actualLessonCount: number;
  selected?: boolean;
  onSelect: () => void;
  showEnrollButton?: boolean;
  onEnroll?: () => void;
  forceComingSoon?: boolean;
}) {
  const difficultyLevel =
    course.difficulty === 'beginner' ? 1 : course.difficulty === 'intermediate' ? 2 : 3;
  const accentColor = DIFFICULTY_COLORS[course.difficulty];
  const catColor = CATEGORY_COLORS[course.category] ?? T.teal;
  const isComingSoon =
    forceComingSoon ?? (actualLessonCount === 0 && course.totalLessons === 0);

  return (
    <div
      className={`w-full text-left transition-all duration-150 will-change-transform ${
        isComingSoon
          ? 'opacity-40 pointer-events-none'
          : 'cursor-pointer hover:scale-[1.01] hover:brightness-110'
      }`}
      onClick={isComingSoon ? undefined : onSelect}
      role={isComingSoon ? undefined : 'button'}
      tabIndex={isComingSoon ? undefined : 0}
    >
      <CozyCard
        style={{
          borderColor: isComingSoon
            ? T.borderDormant
            : selected
              ? `${accentColor}55`
              : `${accentColor}35`,
        }}
      >
        {selected && <CornerMarks />}

        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <Tag label={course.difficulty} color={accentColor} />
          <Tag
            label={CATEGORY_LABELS[course.category] ?? course.category}
            color={catColor}
          />
          <div className="flex-1" />
          <DifficultyFlasks level={difficultyLevel} />
        </div>

        <h3
          className="text-[17px] font-bold tracking-wide leading-[22px] mb-[5px] line-clamp-2"
          style={{
            color: isComingSoon ? '#B8B0A4' : T.textPrimary,
            fontFamily: 'var(--font-pixel), Georgia, serif',
          }}
        >
          {course.title}
        </h3>

        <p
          className="text-xs leading-[18px] mb-3.5 line-clamp-3"
          style={{ color: T.textSecondary }}
        >
          {course.description}
        </p>

        {isComingSoon ? (
          <div
            className="mb-1 py-3 rounded-[10px] border text-center"
            style={{
              backgroundColor: 'rgba(255,255,255,0.03)',
              borderColor: T.borderDormant,
            }}
          >
            <span
              className="text-[12px] font-bold uppercase tracking-[2px]"
              style={{ color: T.textMuted, fontFamily: 'var(--font-pixel), Georgia, serif' }}
            >
              Coming Soon
            </span>
          </div>
        ) : (
          showEnrollButton && (
            <div onClick={(e) => e.stopPropagation()}>
              <PrimaryButton onClick={onEnroll ?? onSelect}>
                {'◆'}  LOCK & START  {'◆'}
              </PrimaryButton>
            </div>
          )
        )}

        <StatsRow course={course} accentColor={accentColor} />
      </CozyCard>
    </div>
  );
}

/* Active course card — Library variant layout with progress bar + Continue chevron */
function ActiveCourseCard({
  course,
  streak,
  lessonCount,
  onPress,
}: {
  course: Course;
  streak: number;
  lessonCount: number;
  onPress: () => void;
}) {
  const total = lessonCount || course.totalLessons || 1;
  const completed = course.completedLessons ?? 0;
  const progress = Math.min(1, Math.max(0, completed / total));

  return (
    <button
      type="button"
      onClick={onPress}
      className="w-full text-left transition-opacity hover:opacity-[0.85] cursor-pointer"
    >
      <CozyCard style={{ borderColor: `${T.violet}35` }}>
        <CornerMarks />
        <div
          className="absolute inset-[-1px] rounded-[10px] pointer-events-none animate-pulse"
          style={{ border: `1px solid ${T.violet}25`, opacity: 0.5 }}
        />
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <h3
              className="text-[17px] font-bold tracking-wide leading-[22px] mb-1.5 truncate"
              style={{
                color: T.textPrimary,
                fontFamily: 'var(--font-pixel), Georgia, serif',
              }}
            >
              {course.title}
            </h3>
            <div className="flex items-center gap-3 mb-2.5">
              <span className="font-pixel-mono text-[11px]" style={{ color: AMBER }}>
                <Flame
                  size={11}
                  color={AMBER}
                  strokeWidth={2.5}
                  style={{ display: 'inline', marginRight: 3, marginBottom: -1 }}
                />
                {streak} streak
              </span>
              <span className="font-pixel-mono text-[11px]" style={{ color: T.textMuted }}>
                {completed}/{total} lessons
              </span>
            </div>
            {/* Progress bar */}
            <div
              className="w-full h-1.5 rounded-full overflow-hidden"
              style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}
            >
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${progress * 100}%`,
                  backgroundColor: T.violet,
                }}
              />
            </div>
          </div>
          <span
            className="font-pixel-mono text-[11px] font-bold uppercase tracking-[1px] flex items-center gap-1"
            style={{ color: T.textPrimary }}
          >
            Continue
            <ChevronRight size={14} color={T.textPrimary} strokeWidth={2.5} />
          </span>
        </div>
      </CozyCard>
    </button>
  );
}

/* ── Main page — adapts between onboarding and post-onboarding ── */
export default function CoursesPage() {
  const router = useRouter();
  const { isAuthenticated, markFreshLogin, ensureFreshSession, disconnect } = useAuth();

  const { login } = useLogin({
    onComplete: async () => {
      const waitForToken = () =>
        new Promise<string | null>((resolve) => {
          const token = useUserStore.getState().authToken;
          if (token) { resolve(token); return; }
          const timeout = setTimeout(() => { unsub(); resolve(null); }, 5000);
          const unsub = useUserStore.subscribe((state) => {
            if (state.authToken) {
              clearTimeout(timeout);
              unsub();
              resolve(state.authToken);
            }
          });
        });
      const token = await waitForToken();
      if (!token) return;
      try {
        const data = await getUserEnrollments(token);
        useCourseStore.getState().restoreFromBackend(data);
        const bestStreak = Math.max(
          ...data.enrollments.map((e) => e.runtime?.currentStreak ?? 0),
          0,
        );
        if (bestStreak > 0) {
          useFlameStore.getState().updateFromStreak(bestStreak);
        }
      } catch { /* Fail silently */ }
    },
  });

  const courses = useCourseStore((s) => s.courses);
  const contentLoading = useCourseStore((s) => s.contentLoading);
  const contentError = useCourseStore((s) => s.contentError);
  const contentInitialized = useCourseStore((s) => s.contentInitialized);
  const initializeContent = useCourseStore((s) => s.initializeContent);
  const syncOnChainEnrollments = useCourseStore((s) => s.syncOnChainEnrollments);
  const enrolledCourseIds = useCourseStore((s) => s.enrolledCourseIds);
  const courseStates = useCourseStore((s) => s.courseStates);
  const lessons = useCourseStore((s) => s.lessons);
  const walletAddress = useUserStore((s) => s.walletAddress);

  const authToken = useUserStore((s) => s.authToken);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [xp, setXp] = useState({
    xpTotal: 0,
    xpLevel: 1,
    levelThresholds: [0, 500, 1500, 3500, 7000, 12000, 20000],
  });

  useEffect(() => {
    void initializeContent();
  }, [initializeContent]);

  // Fetch XP
  useEffect(() => {
    if (authToken) {
      getUserXp(authToken).then((data) => setXp((prev) => ({ ...prev, ...data }))).catch(() => {});
    }
  }, [authToken]);

  useEffect(() => {
    if (walletAddress && courses.length > 0) {
      void syncOnChainEnrollments(walletAddress);
    }
  }, [walletAddress, courses.length, syncOnChainEnrollments]);

  // Only show active/enrolled courses when authenticated — prevents stale
  // enrollment state from leaking into the disconnected view.
  const activeCourseIds = isAuthenticated
    ? enrolledCourseIds.filter((courseId) =>
        Boolean(courseStates[courseId]?.lockAccountAddress),
      )
    : [];
  const activeCourses = courses.filter((c) => activeCourseIds.includes(c.id));
  const availableCourses = courses.filter((c) => !activeCourseIds.includes(c.id));

  const isOnboardingMode = activeCourses.length === 0;
  const selectedCourse = selectedId ? courses.find((c) => c.id === selectedId) : null;

  const handleActiveCoursePress = (courseId: string) => {
    useCourseStore.getState().setActiveCourse(courseId);
    router.push('/village');
  };

  const handleSignIn = async () => {
    // If Privy still has a stale session from a previous disconnect,
    // this clears it so login() shows wallet selection instead of
    // auto-signing with the previously used wallet.
    await ensureFreshSession();
    markFreshLogin();
    login({ loginMethods: ['google', 'wallet'] });
  };

  const handleEnroll = (courseId: string) => {
    if (!isAuthenticated) {
      handleSignIn();
      return;
    }
    router.push(`/onboarding/deposit?courseId=${courseId}`);
  };

  // Split available into ready vs coming-soon
  const readyCourses = availableCourses.filter(
    (c) => (lessons[c.id] ?? []).length > 0 || c.totalLessons > 0,
  );
  const comingSoonCourses = availableCourses.filter(
    (c) => (lessons[c.id] ?? []).length === 0 && c.totalLessons === 0,
  );

  // XP bar math (real values from store)
  const currentThreshold = xp.levelThresholds?.[xp.xpLevel - 1] ?? 0;
  const nextThreshold = xp.levelThresholds?.[xp.xpLevel] ?? currentThreshold + 1000;
  const xpProgress = Math.min(
    1,
    Math.max(0, (xp.xpTotal - currentThreshold) / (nextThreshold - currentThreshold)),
  );
  const LEVEL_NAMES = ['Novice', 'Apprentice', 'Scholar', 'Adept', 'Master', 'Sage', 'Legend'];
  const levelName = LEVEL_NAMES[xp.xpLevel - 1] ?? `Level ${xp.xpLevel}`;

  return (
    <div className="min-h-screen relative" style={{ backgroundColor: T.bg }}>
      {/* Academy interior backdrop. */}
      <div aria-hidden className="fixed inset-0 z-0 pointer-events-none">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/images/academy/course.png"
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

      <div
        className={`relative z-10 max-w-[1100px] mx-auto px-[18px] ${
          isOnboardingMode ? 'pb-32' : 'pb-10'
        }`}
      >
        <div className="pt-20" />

        {/* Hero — Library variant header */}
        <div className="text-center pb-6">
          <div className="flex items-center justify-center gap-2 mb-3.5">
            <div className="w-[30px] h-px" style={{ backgroundColor: `${AMBER}30` }} />
            <span className="text-[7px]" style={{ color: `${AMBER}50` }}>
              {'◆'}
            </span>
            <div className="w-[30px] h-px" style={{ backgroundColor: `${AMBER}30` }} />
          </div>
          <h1
            className="text-3xl font-bold tracking-wide font-pixel"
            style={{ color: AMBER, textShadow: '0 1px 2px rgba(0,0,0,0.85)' }}
          >
            Courses
          </h1>
          <p
            className="text-sm mt-1 mb-4"
            style={{
              color: 'rgba(255,255,255,0.7)',
              textShadow: '0 1px 2px rgba(0,0,0,0.85)',
            }}
          >
            Continue your journey or start a new path
          </p>

          {/* XP bar (real values from store) */}
          <div className="max-w-xs mx-auto">
            <div className="flex items-center justify-between mb-1">
              <span
                className="text-[10px] font-pixel-mono font-bold uppercase tracking-[1px]"
                style={{ color: AMBER, textShadow: '0 1px 2px rgba(0,0,0,0.85)' }}
              >
                Lv.{xp.xpLevel} {levelName}
              </span>
              <span
                className="text-[10px] font-pixel-mono"
                style={{ color: T.textMuted, textShadow: '0 1px 2px rgba(0,0,0,0.85)' }}
              >
                {xp.xpTotal} / {nextThreshold} XP
              </span>
            </div>
            <div
              className="w-full h-1.5 rounded-full overflow-hidden"
              style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}
            >
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${Math.min(100, Math.max(0, xpProgress * 100))}%`,
                  backgroundColor: AMBER,
                }}
              />
            </div>
          </div>

          {/* Auth toggle in onboarding mode */}
          {isOnboardingMode && (
            <div className="mt-4">
              {isAuthenticated ? (
                <button
                  onClick={disconnect}
                  className="px-5 py-2 rounded-lg border text-[11px] font-pixel-mono font-bold uppercase tracking-[1.5px] transition-opacity hover:opacity-80 cursor-pointer"
                  style={{
                    color: T.crimson,
                    borderColor: `${T.crimson}30`,
                    backgroundColor: `${T.crimson}0a`,
                  }}
                >
                  Disconnect Wallet
                </button>
              ) : (
                <button
                  onClick={handleSignIn}
                  className="px-5 py-2 rounded-lg border text-[11px] font-pixel-mono font-bold uppercase tracking-[1.5px] transition-opacity hover:opacity-80 cursor-pointer"
                  style={{
                    color: T.amber,
                    borderColor: `${T.amber}30`,
                    backgroundColor: `${T.amber}0a`,
                  }}
                >
                  Sign In
                </button>
              )}
            </div>
          )}
        </div>

        {/* Loading */}
        {contentLoading && courses.length === 0 && (
          <div
            className="p-4 rounded-lg border mb-4"
            style={{
              borderColor: T.borderDormant,
              backgroundColor: 'rgba(14,14,28,0.6)',
            }}
          >
            <p className="text-xs text-center" style={{ color: T.textSecondary }}>
              Syncing course catalog...
            </p>
          </div>
        )}

        {/* Error */}
        {contentError && (
          <div
            className="p-4 rounded-lg border mb-4"
            style={{
              borderColor: 'rgba(255,68,102,0.15)',
              backgroundColor: 'rgba(14,14,28,0.6)',
            }}
          >
            <p className="text-xs text-center" style={{ color: 'rgba(255,68,102,0.6)' }}>
              {contentError}
            </p>
            <button
              onClick={() => void initializeContent(true)}
              className="mt-3 mx-auto block px-4 py-2 rounded-md border text-[11px] font-semibold uppercase tracking-wide cursor-pointer"
              style={{
                borderColor: `${T.amber}30`,
                backgroundColor: 'rgba(212,160,74,0.08)',
                color: T.amber,
              }}
            >
              Retry
            </button>
          </div>
        )}

        {/* Active courses */}
        {activeCourses.length > 0 && (
          <div className="mb-5">
            <CozySectionLabel>Active Courses</CozySectionLabel>
            <div className="flex flex-col gap-2.5">
              {activeCourses.map((course) => (
                <ActiveCourseCard
                  key={course.id}
                  course={course}
                  streak={courseStates[course.id]?.currentStreak ?? 0}
                  lessonCount={(lessons[course.id] ?? []).length}
                  onPress={() => handleActiveCoursePress(course.id)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Available courses */}
        {readyCourses.length > 0 && (
          <div className="mb-5">
            <CozySectionLabel>Available Courses</CozySectionLabel>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {readyCourses.map((course) => (
                <CourseCard
                  key={course.id}
                  course={course}
                  actualLessonCount={(lessons[course.id] ?? []).length}
                  selected={isOnboardingMode && selectedId === course.id}
                  onSelect={() =>
                    isOnboardingMode
                      ? setSelectedId(selectedId === course.id ? null : course.id)
                      : handleEnroll(course.id)
                  }
                  showEnrollButton={!isOnboardingMode}
                  onEnroll={() => handleEnroll(course.id)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Coming soon */}
        {comingSoonCourses.length > 0 && (
          <div className="mt-5">
            <CozySectionLabel>Coming Soon</CozySectionLabel>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {comingSoonCourses.map((course) => (
                <CourseCard
                  key={course.id}
                  course={course}
                  actualLessonCount={0}
                  onSelect={() => {}}
                  forceComingSoon
                />
              ))}
            </div>
          </div>
        )}

        {/* Empty */}
        {courses.length === 0 && !contentLoading && !contentError && contentInitialized && (
          <div className="text-center py-16">
            <p className="text-sm" style={{ color: T.textMuted }}>
              No courses available yet.
            </p>
          </div>
        )}
      </div>

      {/* Fixed CTA — onboarding mode only */}
      {isOnboardingMode && selectedCourse && (
        <div
          className="fixed bottom-0 left-0 right-0 px-[18px] pb-8 pt-4"
          style={{
            backgroundColor: `${T.bg}F5`,
            paddingBottom: 'calc(2rem + env(safe-area-inset-bottom, 0px))',
          }}
        >
          <div className="max-w-[1100px] mx-auto">
            <button
              onClick={() => handleEnroll(selectedCourse.id)}
              className="w-full py-4 rounded-[10px] text-center cursor-pointer"
              style={{
                backgroundColor: T.amber,
                border: `1px solid ${T.amber}50`,
                boxShadow: '0 0 16px rgba(212,160,74,0.2)',
              }}
            >
              <span
                className="text-[13px] font-bold uppercase tracking-[3px]"
                style={{ color: T.bg, fontFamily: 'var(--font-pixel), Georgia, serif' }}
              >
                {'◆'}  BEGIN DESCENT  {'◆'}
              </span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
