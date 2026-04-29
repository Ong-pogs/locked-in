'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLogin } from '@privy-io/react-auth';
import { useAuth } from '@/hooks/useAuth';
import { useFlameStore } from '@/stores/flameStore';
import { getUserEnrollments, getUserXp } from '@/services/api/progress/progressApi';
import { useCourseStore, useUserStore } from '@/stores';
import type { Course, CourseDifficulty } from '@/types';
import {
  ParchmentCard,
  SectionLabel,
  CornerMarks,
  PrimaryButton,
  T,
} from '@/components/theme';

const DIFFICULTY_COLORS: Record<CourseDifficulty, string> = {
  beginner: T.green,
  intermediate: T.teal,
  advanced: T.crimson,
};

const CATEGORY_COLORS: Record<string, string> = {
  solana: T.violet,
  web3: T.teal,
  defi: T.teal,
  security: T.crimson,
  rust: T.rust,
};

function Tag({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="px-2 py-[3px] rounded text-[9px] font-bold uppercase tracking-[1px] font-mono"
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
  return (
    <div className="flex items-center gap-2 pt-3" style={{ borderTop: `1px solid ${T.borderDormant}` }}>
      <span className="font-mono text-[10px]" style={{ color: T.textMuted }}>{course.totalModules ?? 1} mod</span>
      <span className="text-[10px]" style={{ color: 'rgba(255,255,255,0.08)' }}>&middot;</span>
      <span className="font-mono text-[10px]" style={{ color: T.textMuted }}>{course.totalLessons} lessons</span>
      <span className="text-[10px]" style={{ color: 'rgba(255,255,255,0.08)' }}>&middot;</span>
      <span className="font-mono text-[10px]" style={{ color: T.textMuted }}>{course.difficulty}</span>
      <span className="flex-1" />
      <span className="font-mono text-[9px]" style={{ color: `${accentColor}70` }}>{course.category}</span>
    </div>
  );
}

/* Course card — used in both onboarding and available sections */
function CourseCard({
  course,
  actualLessonCount,
  selected,
  onSelect,
  showEnrollButton,
  onEnroll,
}: {
  course: Course;
  actualLessonCount: number;
  selected?: boolean;
  onSelect: () => void;
  showEnrollButton?: boolean;
  onEnroll?: () => void;
}) {
  const difficultyLevel =
    course.difficulty === 'beginner' ? 1 : course.difficulty === 'intermediate' ? 2 : 3;
  const accentColor = DIFFICULTY_COLORS[course.difficulty];
  const catColor = CATEGORY_COLORS[course.category] ?? T.teal;
  const isComingSoon = actualLessonCount === 0 && course.totalLessons === 0;

  return (
    <div
      className={`w-full text-left transition-all duration-150 will-change-transform ${isComingSoon ? 'opacity-40 pointer-events-none' : 'cursor-pointer hover:scale-[1.01] hover:brightness-110'}`}
      onClick={isComingSoon ? undefined : onSelect}
      role={isComingSoon ? undefined : 'button'}
      tabIndex={isComingSoon ? undefined : 0}
    >
      <ParchmentCard
        style={{
          backgroundColor: selected ? T.bgCardActive : T.bgCard,
          borderColor: selected ? `${accentColor}35` : T.borderDormant,
        }}
      >
        {selected && <CornerMarks />}

        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <Tag label={course.difficulty} color={accentColor} />
          <Tag label={course.category} color={catColor} />
          <div className="flex-1" />
          <DifficultyFlasks level={difficultyLevel} />
        </div>

        <h3
          className="text-[17px] font-bold tracking-wide leading-[22px] mb-[5px] line-clamp-2"
          style={{ color: selected ? T.textPrimary : '#B8B0A4', fontFamily: 'Georgia, serif' }}
        >
          {course.title}
        </h3>

        <p className="text-xs leading-[18px] mb-3.5 line-clamp-3" style={{ color: T.textSecondary }}>
          {course.description}
        </p>

        {isComingSoon && (
          <div
            className="mb-3.5 py-3 rounded-[10px] border text-center"
            style={{ backgroundColor: 'rgba(255,255,255,0.03)', borderColor: T.borderDormant }}
          >
            <span
              className="text-[12px] font-bold uppercase tracking-[2px]"
              style={{ color: T.textMuted, fontFamily: 'Georgia, serif' }}
            >
              Coming Soon
            </span>
          </div>
        )}

        {/* Inline enroll button (post-onboarding available courses) */}
        {showEnrollButton && !isComingSoon && (
          <div className="mt-3.5 mb-3.5" onClick={(e) => e.stopPropagation()}>
            <PrimaryButton onClick={onEnroll ?? onSelect}>
              ◆  LOCK & START  ◆
            </PrimaryButton>
          </div>
        )}

        <StatsRow course={course} accentColor={accentColor} />
      </ParchmentCard>
    </div>
  );
}

/* Active course card */
function ActiveCourseCard({ course, streak, lessonCount, onPress }: { course: Course; streak: number; lessonCount: number; onPress: () => void }) {
  return (
    <button onClick={onPress} className="w-full text-left transition-opacity hover:opacity-[0.85]">
      <ParchmentCard style={{ borderColor: `${T.violet}35` }}>
        <CornerMarks />
        <div
          className="absolute inset-[-1px] rounded-[10px] pointer-events-none animate-pulse"
          style={{ border: `1px solid ${T.violet}25`, opacity: 0.5 }}
        />
        <div className="flex items-center">
          <div className="flex-1">
            <h3
              className="text-[17px] font-bold tracking-wide leading-[22px] mb-1.5"
              style={{ color: T.textPrimary, fontFamily: 'Georgia, serif' }}
            >
              {course.title}
            </h3>
            <div className="flex items-center gap-3">
              <span className="font-mono text-[11px]" style={{ color: T.amber }}>✹ {streak} streak</span>
              <span className="font-mono text-[11px]" style={{ color: T.textMuted }}>
                {course.completedLessons}/{lessonCount || course.totalLessons} lessons
              </span>
            </div>
          </div>
          <span className="text-lg" style={{ color: T.textMuted }}>›</span>
        </div>
      </ParchmentCard>
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
  const [xp, setXp] = useState({ xpTotal: 0, xpLevel: 1, levelThresholds: [0, 500, 1500, 3500, 7000, 12000, 20000] });

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

  return (
    <div
      className="min-h-screen relative"
      style={{
        backgroundColor: T.bg,
        backgroundImage: "url('/images/wood.png')",
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundAttachment: 'fixed',
      }}
    >
      <div className="fixed inset-0" style={{ backgroundColor: 'rgba(6,6,12,0.4)' }} />
      <div className={`relative max-w-[1100px] mx-auto px-[18px] ${isOnboardingMode ? 'pb-32' : 'pb-10'}`}>

        {/* Header — adapts to mode */}
        <div className="text-center pt-14 pb-7">
          <div className="flex items-center justify-center gap-2 mb-3.5">
            <div className="w-[30px] h-px" style={{ backgroundColor: `${T.amber}30` }} />
            <span className="text-[7px]" style={{ color: `${T.amber}50` }}>{'\u25C6'}</span>
            <div className="w-[30px] h-px" style={{ backgroundColor: `${T.amber}30` }} />
          </div>
          {isOnboardingMode ? (
            <>
              <h1
                className="text-[26px] font-bold tracking-wide leading-tight mb-2"
                style={{ color: T.textPrimary, fontFamily: 'Georgia, serif' }}
              >
                Choose Your {'\n'}<span style={{ color: T.amber }}>Path</span>
              </h1>
              <p className="text-xs leading-[18px] mb-3" style={{ color: T.textSecondary }}>
                Mastering your craft through proof of effort.
              </p>
              {isAuthenticated ? (
                <button
                  onClick={disconnect}
                  className="mt-3 px-5 py-2 rounded-lg border text-[11px] font-mono font-bold uppercase tracking-[1.5px] transition-opacity hover:opacity-80"
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
                  className="mt-3 px-5 py-2 rounded-lg border text-[11px] font-mono font-bold uppercase tracking-[1.5px] transition-opacity hover:opacity-80"
                  style={{
                    color: T.amber,
                    borderColor: `${T.amber}30`,
                    backgroundColor: `${T.amber}0a`,
                  }}
                >
                  Sign In
                </button>
              )}
            </>
          ) : (
            <>
              <h1
                className="text-[26px] font-bold tracking-wide leading-tight mb-2"
                style={{ color: T.textPrimary, fontFamily: 'Georgia, serif' }}
              >
                Your <span style={{ color: T.amber }}>Courses</span>
              </h1>
              <p className="text-sm leading-[20px] mb-4" style={{ color: 'rgba(255,255,255,0.6)' }}>
                Continue your journey or start a new path.
              </p>
              {/* XP Bar */}
              {(() => {
                const currentThreshold = xp.levelThresholds?.[xp.xpLevel - 1] ?? 0;
                const nextThreshold = xp.levelThresholds?.[xp.xpLevel] ?? currentThreshold + 1000;
                const progress = Math.min(1, Math.max(0, (xp.xpTotal - currentThreshold) / (nextThreshold - currentThreshold)));
                const LEVEL_NAMES = ['Novice', 'Apprentice', 'Scholar', 'Adept', 'Master', 'Sage', 'Legend'];
                const levelName = LEVEL_NAMES[xp.xpLevel - 1] ?? `Level ${xp.xpLevel}`;
                return (
                  <div className="max-w-xs mx-auto">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-mono font-bold uppercase tracking-[1px]" style={{ color: T.amber }}>
                        Lv.{xp.xpLevel} {levelName}
                      </span>
                      <span className="text-[10px] font-mono" style={{ color: T.textMuted }}>
                        {xp.xpTotal} / {nextThreshold} XP
                      </span>
                    </div>
                    <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}>
                      <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{ width: `${Math.min(100, Math.max(0, progress * 100))}%`, backgroundColor: T.amber }}
                      />
                    </div>
                  </div>
                );
              })()}
            </>
          )}
        </div>

        {/* Loading */}
        {contentLoading && courses.length === 0 && (
          <div
            className="p-4 rounded-lg border mb-4"
            style={{ borderColor: T.borderDormant, backgroundColor: 'rgba(14,14,28,0.6)' }}
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
            style={{ borderColor: 'rgba(255,68,102,0.15)', backgroundColor: 'rgba(14,14,28,0.6)' }}
          >
            <p className="text-xs text-center" style={{ color: 'rgba(255,68,102,0.6)' }}>{contentError}</p>
            <button
              onClick={() => void initializeContent(true)}
              className="mt-3 mx-auto block px-4 py-2 rounded-md border text-[11px] font-semibold uppercase tracking-wide"
              style={{ borderColor: `${T.amber}30`, backgroundColor: 'rgba(212,160,74,0.08)', color: T.amber }}
            >
              Retry
            </button>
          </div>
        )}

        {/* Active courses (post-onboarding only) */}
        {activeCourses.length > 0 && (
          <div className="mb-5">
            <SectionLabel>Active Courses</SectionLabel>
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

        {/* Split available courses into ready vs coming soon */}
        {(() => {
          const readyCourses = availableCourses.filter(
            (c) => (lessons[c.id] ?? []).length > 0 || c.totalLessons > 0,
          );
          const comingSoonCourses = availableCourses.filter(
            (c) => (lessons[c.id] ?? []).length === 0 && c.totalLessons === 0,
          );

          return (
            <>
              {readyCourses.length > 0 && (
                <>
                  {(activeCourses.length > 0 || comingSoonCourses.length > 0) && (
                    <SectionLabel>Available Courses</SectionLabel>
                  )}
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
                </>
              )}

              {comingSoonCourses.length > 0 && (
                <div className="mt-5">
                  <SectionLabel>Coming Soon</SectionLabel>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {comingSoonCourses.map((course) => (
                      <CourseCard
                        key={course.id}
                        course={course}
                        actualLessonCount={0}
                        onSelect={() => {}}
                      />
                    ))}
                  </div>
                </div>
              )}
            </>
          );
        })()}

        {/* Empty */}
        {courses.length === 0 && !contentLoading && !contentError && contentInitialized && (
          <div className="text-center py-16">
            <p className="text-sm" style={{ color: T.textMuted }}>No courses available yet.</p>
          </div>
        )}
      </div>

      {/* Fixed CTA — onboarding mode only */}
      {isOnboardingMode && selectedCourse && (
        <div
          className="fixed bottom-0 left-0 right-0 px-[18px] pb-8 pt-4"
          style={{ backgroundColor: `${T.bg}F5`, paddingBottom: 'calc(2rem + env(safe-area-inset-bottom, 0px))' }}
        >
          <div className="max-w-[1100px] mx-auto">
            <button
              onClick={() => handleEnroll(selectedCourse.id)}
              className="w-full py-4 rounded-[10px] text-center"
              style={{
                backgroundColor: T.amber,
                border: `1px solid ${T.amber}50`,
                boxShadow: '0 0 16px rgba(212,160,74,0.2)',
              }}
            >
              <span
                className="text-[13px] font-bold uppercase tracking-[3px]"
                style={{ color: T.bg, fontFamily: 'Georgia, serif' }}
              >
                {'\u25C6'}  BEGIN DESCENT  {'\u25C6'}
              </span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
