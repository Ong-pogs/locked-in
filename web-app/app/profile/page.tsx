'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useUserStore, useCourseStore } from '@/stores';
import { getUserXp } from '@/services/api/progress/progressApi';
import { fetchWithAuth } from '@/services/api/httpClient';
import { T, ProgressBar } from '@/components/theme';
import { CozyCard, CozySectionLabel } from '@/components/cozy';
import { HubButton } from '@/components/HubButton';

const LEVEL_NAMES = ['Novice', 'Apprentice', 'Scholar', 'Adept', 'Master', 'Sage', 'Legend'];

const AMBER = '#FFD580';
const COZY_BORDER = 'rgba(58, 143, 168, 0.45)';

// Two profile layouts the user can toggle between. Default is the original
// "Cottage" feel; "Codex" is the minimal redesign.
type ProfileVariant = 'cottage' | 'codex';
const VARIANT_STORAGE_KEY = 'locked-in:profile-variant';

export default function ProfilePage() {
  const router = useRouter();

  // ── Variant toggle (persisted to localStorage so it survives refresh) ──
  const [variant, setVariant] = useState<ProfileVariant>('cottage');
  useEffect(() => {
    const saved = window.localStorage.getItem(VARIANT_STORAGE_KEY);
    if (saved === 'codex' || saved === 'cottage') setVariant(saved);
  }, []);
  const handleVariantChange = (next: ProfileVariant) => {
    setVariant(next);
    window.localStorage.setItem(VARIANT_STORAGE_KEY, next);
  };

  // User state
  const walletAddress = useUserStore((s) => s.walletAddress);
  const displayName = useUserStore((s) => s.displayName);
  const disconnect = useUserStore((s) => s.disconnect);

  // Course state
  const activeCourseId = useCourseStore((s) => s.activeCourseId);
  const activeCourseIds = useCourseStore((s) => s.activeCourseIds);
  const courseStates = useCourseStore((s) => s.courseStates);
  const courses = useCourseStore((s) => s.courses);
  const setActiveCourse = useCourseStore((s) => s.setActiveCourse);
  const lessonProgress = useCourseStore((s) => s.lessonProgress);
  const enrolledCourseIds = useCourseStore((s) => s.enrolledCourseIds);
  const lessons = useCourseStore((s) => s.lessons);

  const activeCourse = activeCourseId
    ? courses.find((c) => c.id === activeCourseId)
    : null;

  // XP state
  const [xp, setXp] = useState({ xpTotal: 0, xpLevel: 1 });
  const [xpLoading, setXpLoading] = useState(true);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setXpLoading(true);
    fetchWithAuth(getUserXp)
      .then((data) => {
        if (data) setXp({ xpTotal: data.xpTotal, xpLevel: data.xpLevel });
      })
      .finally(() => setXpLoading(false));
  }, []);

  // Derived stats
  const lessonsCompleted = Object.values(lessonProgress).filter((lp) => lp.completed).length;
  const longestStreak = Math.max(
    ...Object.values(courseStates).map((s) => s?.longestStreak ?? 0),
    0,
  );
  const coursesEnrolled = enrolledCourseIds.length;

  // Active course lesson progress
  const activeLessons = activeCourseId ? (lessons[activeCourseId] ?? []) : [];
  const activeLessonsCompleted = activeLessons.filter(
    (l) => lessonProgress[l.id]?.completed,
  ).length;
  const activeLessonsTotal = activeLessons.length;
  const progressFraction = activeLessonsTotal > 0 ? activeLessonsCompleted / activeLessonsTotal : 0;

  // Courses with active locks
  const lockedCourseIds = activeCourseIds.filter((id) =>
    Boolean(courseStates[id]?.lockAccountAddress),
  );

  // Truncated wallet
  const truncatedWallet = walletAddress
    ? `${walletAddress.slice(0, 4)}...${walletAddress.slice(-4)}`
    : 'Not connected';

  const levelName = LEVEL_NAMES[Math.min(xp.xpLevel - 1, LEVEL_NAMES.length - 1)] ?? 'Novice';

  const handleDisconnect = () => {
    if (confirm('Disconnect wallet? This clears your local session.')) {
      disconnect();
      router.push('/');
    }
  };

  const sharedProps = {
    displayName,
    truncatedWallet,
    xp,
    xpLoading,
    levelName,
    lessonsCompleted,
    longestStreak,
    coursesEnrolled,
    activeCourse,
    activeLessonsCompleted,
    activeLessonsTotal,
    progressFraction,
    lockedCourseIds,
    activeCourseId,
    courses,
    setActiveCourse,
    router,
    handleDisconnect,
  };

  return (
    <div className="min-h-screen relative" style={{ backgroundColor: T.bg }}>
      {/* Cottage interior backdrop. */}
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
      <VariantToggle variant={variant} onChange={handleVariantChange} />

      <div className="relative z-10 max-w-[1100px] mx-auto px-[18px] pb-10">
        <div className="pt-20" />
        {variant === 'cottage' ? (
          <CottageLayout {...sharedProps} />
        ) : (
          <CodexLayout {...sharedProps} />
        )}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────── */
/* Variant toggle — fixed top-right, simple two-state pill.              */
/* ────────────────────────────────────────────────────────────────────── */

function VariantToggle({
  variant,
  onChange,
}: {
  variant: ProfileVariant;
  onChange: (next: ProfileVariant) => void;
}) {
  return (
    <div
      className="fixed top-4 right-4 z-40 flex items-center gap-1 rounded-full px-1 py-1"
      style={{
        backgroundColor: 'rgba(14, 14, 28, 0.78)',
        border: `1px solid ${COZY_BORDER}`,
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
      }}
    >
      <ToggleButton active={variant === 'cottage'} onClick={() => onChange('cottage')}>
        Cottage
      </ToggleButton>
      <ToggleButton active={variant === 'codex'} onClick={() => onChange('codex')}>
        Codex
      </ToggleButton>
    </div>
  );
}

function ToggleButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-[11px] font-bold tracking-[1px] uppercase px-3 py-1.5 rounded-full transition-colors font-pixel-mono cursor-pointer"
      style={{
        color: active ? '#1A1000' : AMBER,
        backgroundColor: active ? AMBER : 'transparent',
      }}
    >
      {children}
    </button>
  );
}

/* ────────────────────────────────────────────────────────────────────── */
/* SHARED HELPERS                                                         */
/* ────────────────────────────────────────────────────────────────────── */

type Props = {
  displayName: string | null;
  truncatedWallet: string;
  xp: { xpTotal: number; xpLevel: number };
  xpLoading: boolean;
  levelName: string;
  lessonsCompleted: number;
  longestStreak: number;
  coursesEnrolled: number;
  activeCourse: ReturnType<typeof useCourseStore.getState>['courses'][number] | null | undefined;
  activeLessonsCompleted: number;
  activeLessonsTotal: number;
  progressFraction: number;
  lockedCourseIds: string[];
  activeCourseId: string | null;
  courses: ReturnType<typeof useCourseStore.getState>['courses'];
  setActiveCourse: (id: string) => void;
  router: ReturnType<typeof useRouter>;
  handleDisconnect: () => void;
};

function JourneyRow({ label, value, accent = false }: { label: string; value: string | number; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[12px] font-pixel" style={{ color: T.textSecondary }}>
        {label}
      </span>
      <span
        className="text-[13px] font-semibold font-pixel-mono"
        style={{
          color: accent ? AMBER : T.textPrimary,
          textShadow: accent ? '0 1px 2px rgba(0,0,0,0.85)' : undefined,
        }}
      >
        {value}
      </span>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────── */
/* VARIANT A — "Cottage" (the original cozy redesign)                    */
/*   - Combined identity + journey in one big left card with header bar  */
/*   - Active Course on the right                                        */
/*   - Switch Course lists all locked courses including active           */
/*   - Browse Courses + Disconnect as full-width action rows             */
/* ────────────────────────────────────────────────────────────────────── */

function CottageLayout(props: Props) {
  const {
    displayName,
    truncatedWallet,
    xp,
    xpLoading,
    levelName,
    lessonsCompleted,
    longestStreak,
    coursesEnrolled,
    activeCourse,
    activeLessonsCompleted,
    activeLessonsTotal,
    progressFraction,
    lockedCourseIds,
    activeCourseId,
    courses,
    setActiveCourse,
    router,
    handleDisconnect,
  } = props;

  return (
    <>
      {/* Page title */}
      <h1
        className="text-3xl font-bold tracking-wide mb-1 font-pixel"
        style={{ color: AMBER, textShadow: '0 1px 2px rgba(0,0,0,0.85)' }}
      >
        Your Cottage
      </h1>
      <p className="text-sm leading-[18px] mb-5" style={{ color: 'rgba(255,255,255,0.6)' }}>
        Your private quarters in the village
      </p>

      {/* Two-column grid */}
      <div className="grid md:grid-cols-2 gap-5">
        {/* ── Left column: Identity + Journey combined ── */}
        <CozyCard style={{ padding: 0, overflow: 'hidden' }}>
          {/* Header bar */}
          <div
            className="flex items-center justify-between px-5 py-3"
            style={{
              borderBottom: `1px solid ${COZY_BORDER}`,
              background: 'rgba(255,213,128,0.06)',
            }}
          >
            <span
              className="font-pixel-mono text-[11px] font-bold uppercase tracking-[2px]"
              style={{ color: AMBER, textShadow: '0 1px 2px rgba(0,0,0,0.85)' }}
            >
              Adventurer
            </span>
            <span
              className="text-[10px] font-bold uppercase tracking-[1px] px-2.5 py-1 rounded-full font-pixel-mono"
              style={{
                color: T.green,
                backgroundColor: 'rgba(62,230,138,0.10)',
                border: '1px solid rgba(62,230,138,0.25)',
              }}
            >
              Active
            </span>
          </div>

          {/* Avatar + Identity */}
          <div className="px-5 pt-5 pb-4">
            <div className="flex items-center gap-4">
              <div
                className="w-20 h-20 rounded-xl flex items-center justify-center shrink-0"
                style={{
                  background: 'rgba(255,213,128,0.08)',
                  border: `1px solid ${COZY_BORDER}`,
                }}
              >
                <span className="text-3xl" style={{ color: AMBER, opacity: 0.55 }}>
                  ✦
                </span>
              </div>
              <div className="min-w-0">
                <p
                  className="text-lg font-bold truncate font-pixel"
                  style={{ color: AMBER, textShadow: '0 1px 2px rgba(0,0,0,0.85)' }}
                >
                  {displayName || 'Adventurer'}
                </p>
                <p className="font-pixel-mono text-[11px] mt-0.5" style={{ color: T.textSecondary }}>
                  {truncatedWallet}
                </p>
                <div className="flex items-center gap-2 mt-2.5">
                  {xpLoading ? (
                    <span
                      className="text-[10px] px-2.5 py-1 rounded-full animate-pulse font-pixel-mono"
                      style={{
                        color: 'transparent',
                        backgroundColor: 'rgba(255,213,128,0.08)',
                        border: '1px solid rgba(255,213,128,0.10)',
                        minWidth: 90,
                      }}
                    >
                      Loading
                    </span>
                  ) : (
                    <>
                      <span
                        className="text-[10px] font-bold uppercase tracking-[1px] px-2.5 py-1 rounded-full font-pixel-mono"
                        style={{
                          color: AMBER,
                          backgroundColor: 'rgba(255,213,128,0.10)',
                          border: '1px solid rgba(255,213,128,0.30)',
                        }}
                      >
                        Lv.{xp.xpLevel} {levelName}
                      </span>
                      <span
                        className="text-[10px] font-bold tracking-[0.5px] px-2.5 py-1 rounded-full font-pixel-mono"
                        style={{
                          color: T.teal,
                          backgroundColor: 'rgba(42,232,212,0.10)',
                          border: '1px solid rgba(42,232,212,0.30)',
                        }}
                      >
                        {xp.xpTotal} XP
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Journey section */}
          <div className="px-5 pb-5">
            <div className="flex items-center gap-3 my-3">
              <div className="flex-1 h-px" style={{ backgroundColor: COZY_BORDER }} />
              <span
                className="text-[10px] font-pixel-mono tracking-[1.5px]"
                style={{ color: T.textMuted }}
              >
                ~ Journey ~
              </span>
              <div className="flex-1 h-px" style={{ backgroundColor: COZY_BORDER }} />
            </div>

            <div className="space-y-2.5">
              <JourneyRow label="Lessons Completed" value={lessonsCompleted} />
              <JourneyRow label="Longest Streak (all courses)" value={`${longestStreak} days`} />
              <JourneyRow label="Courses Enrolled" value={coursesEnrolled} />
              <JourneyRow label="Member Since" value="Mar 2026" />
            </div>
          </div>
        </CozyCard>

        {/* ── Right column ── */}
        <div className="flex flex-col gap-5">
          {/* Active Course */}
          {activeCourse && (
            <div>
              <CozySectionLabel>Active Course</CozySectionLabel>
              <CozyCard>
                <p
                  className="text-sm font-bold mb-1 font-pixel"
                  style={{ color: AMBER, textShadow: '0 1px 2px rgba(0,0,0,0.85)' }}
                >
                  {activeCourse.title}
                </p>
                <p className="text-[12px] mb-3 font-pixel-mono" style={{ color: T.textSecondary }}>
                  {activeLessonsCompleted} / {activeLessonsTotal} lessons
                </p>
                <ProgressBar progress={progressFraction} />
              </CozyCard>
            </div>
          )}

          {/* Course switcher (only when multiple locked courses) */}
          {lockedCourseIds.length > 1 && (
            <div>
              <CozySectionLabel>Switch Course</CozySectionLabel>
              {lockedCourseIds.map((courseId) => {
                const course = courses.find((c) => c.id === courseId);
                if (!course) return null;
                const isActive = courseId === activeCourseId;
                return (
                  <button
                    key={courseId}
                    onClick={() => {
                      setActiveCourse(courseId);
                      router.back();
                    }}
                    className="w-full text-left mb-2"
                  >
                    <CozyCard
                      style={{
                        padding: 14,
                        borderColor: isActive ? AMBER : COZY_BORDER,
                      }}
                    >
                      <span
                        className="text-sm font-semibold font-pixel"
                        style={{ color: isActive ? AMBER : T.textPrimary }}
                      >
                        {course.title}
                        {isActive ? ' (active)' : ''}
                      </span>
                    </CozyCard>
                  </button>
                );
              })}
            </div>
          )}

          {/* Account actions */}
          <div>
            <CozySectionLabel>Account</CozySectionLabel>
            <div className="space-y-2.5">
              <button
                onClick={() => router.push('/courses')}
                className="flex items-center gap-3.5 py-3.5 px-4 rounded-xl border w-full text-left transition-all"
                style={{
                  backgroundColor: 'rgba(14,14,28,0.50)',
                  borderColor: COZY_BORDER,
                  backdropFilter: 'blur(20px) saturate(1.4)',
                  WebkitBackdropFilter: 'blur(20px) saturate(1.4)',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = AMBER; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = COZY_BORDER; }}
              >
                <div
                  className="w-9 h-9 rounded-lg flex items-center justify-center"
                  style={{ backgroundColor: 'rgba(255,213,128,0.08)' }}
                >
                  <span className="text-base" style={{ color: AMBER }}>☷</span>
                </div>
                <div className="flex-1">
                  <span className="text-sm font-semibold block font-pixel" style={{ color: T.textPrimary }}>
                    Browse Courses
                  </span>
                  <span className="text-[11px] font-pixel-mono" style={{ color: T.textSecondary }}>
                    Explore available learning paths
                  </span>
                </div>
                <span className="text-lg" style={{ color: T.textMuted }}>›</span>
              </button>

              <button
                onClick={handleDisconnect}
                className="flex items-center gap-3.5 py-3.5 px-4 rounded-xl border w-full text-left transition-all"
                style={{
                  backgroundColor: 'rgba(255,68,102,0.06)',
                  borderColor: 'rgba(255,68,102,0.20)',
                  backdropFilter: 'blur(20px) saturate(1.4)',
                  WebkitBackdropFilter: 'blur(20px) saturate(1.4)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = 'rgba(255,68,102,0.45)';
                  e.currentTarget.style.backgroundColor = 'rgba(255,68,102,0.10)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'rgba(255,68,102,0.20)';
                  e.currentTarget.style.backgroundColor = 'rgba(255,68,102,0.06)';
                }}
              >
                <div
                  className="w-9 h-9 rounded-lg flex items-center justify-center"
                  style={{ backgroundColor: 'rgba(255,68,102,0.10)' }}
                >
                  <span className="text-base" style={{ color: T.crimson }}>✕</span>
                </div>
                <div className="flex-1">
                  <span className="text-sm font-semibold block font-pixel" style={{ color: T.crimson }}>
                    Disconnect Wallet
                  </span>
                  <span className="text-[11px] font-pixel-mono" style={{ color: T.textSecondary }}>
                    Clear local session data
                  </span>
                </div>
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/* ────────────────────────────────────────────────────────────────────── */
/* VARIANT B — "Codex" (minimal redesign)                                */
/*   - Identity card + Journey card separated                            */
/*   - Switch To excludes the active course                              */
/*   - Single Browse Courses CTA + quiet disconnect text button          */
/* ────────────────────────────────────────────────────────────────────── */

function CodexLayout(props: Props) {
  const {
    displayName,
    truncatedWallet,
    xp,
    xpLoading,
    levelName,
    lessonsCompleted,
    longestStreak,
    coursesEnrolled,
    activeCourse,
    activeLessonsCompleted,
    activeLessonsTotal,
    progressFraction,
    lockedCourseIds,
    activeCourseId,
    courses,
    setActiveCourse,
    router,
    handleDisconnect,
  } = props;

  const otherLockedCourses = lockedCourseIds.filter((id) => id !== activeCourseId);

  return (
    <>
      {/* Page title */}
      <h1
        className="text-3xl font-bold tracking-wide mb-1 font-pixel"
        style={{ color: AMBER, textShadow: '0 1px 2px rgba(0,0,0,0.85)' }}
      >
        Adventurer&apos;s Codex
      </h1>
      <p className="text-sm leading-[18px] mb-5" style={{ color: 'rgba(255,255,255,0.6)' }}>
        Who you are in the village
      </p>

      <div className="grid md:grid-cols-2 gap-5">
        {/* ── Left column: Identity + Journey (separated) ── */}
        <div className="flex flex-col gap-5">
          <CozyCard style={{ padding: 20 }}>
            <div className="flex items-center gap-4">
              <div
                className="w-20 h-20 rounded-xl flex items-center justify-center shrink-0"
                style={{
                  background: 'rgba(255,213,128,0.08)',
                  border: `1px solid ${COZY_BORDER}`,
                }}
              >
                <span className="text-3xl" style={{ color: AMBER, opacity: 0.55 }}>
                  ✦
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <p
                  className="text-lg font-bold truncate font-pixel"
                  style={{ color: AMBER, textShadow: '0 1px 2px rgba(0,0,0,0.85)' }}
                >
                  {displayName || 'Unnamed Adventurer'}
                </p>
                <p className="font-pixel-mono text-[11px] mt-0.5" style={{ color: T.textSecondary }}>
                  {truncatedWallet}
                </p>
                <div className="flex items-center gap-2 mt-2.5 flex-wrap">
                  {xpLoading ? (
                    <span
                      className="text-[10px] px-2.5 py-1 rounded-full animate-pulse font-pixel-mono"
                      style={{
                        color: 'transparent',
                        backgroundColor: 'rgba(255,213,128,0.08)',
                        border: '1px solid rgba(255,213,128,0.10)',
                        minWidth: 90,
                      }}
                    >
                      Loading
                    </span>
                  ) : (
                    <>
                      <span
                        className="text-[10px] font-bold uppercase tracking-[1px] px-2.5 py-1 rounded-full font-pixel-mono"
                        style={{
                          color: AMBER,
                          backgroundColor: 'rgba(255,213,128,0.10)',
                          border: '1px solid rgba(255,213,128,0.30)',
                        }}
                      >
                        Lv.{xp.xpLevel} {levelName}
                      </span>
                      <span
                        className="text-[10px] font-bold tracking-[0.5px] px-2.5 py-1 rounded-full font-pixel-mono"
                        style={{
                          color: T.teal,
                          backgroundColor: 'rgba(42,232,212,0.10)',
                          border: '1px solid rgba(42,232,212,0.30)',
                        }}
                      >
                        {xp.xpTotal} XP
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>
          </CozyCard>

          <div>
            <CozySectionLabel>Journey</CozySectionLabel>
            <CozyCard>
              <div className="space-y-2.5">
                <JourneyRow label="Lessons Completed" value={lessonsCompleted} accent />
                <JourneyRow label="Longest Streak" value={`${longestStreak} days`} accent />
                <JourneyRow label="Courses Enrolled" value={coursesEnrolled} accent />
              </div>
            </CozyCard>
          </div>
        </div>

        {/* ── Right column ── */}
        <div className="flex flex-col gap-5">
          {activeCourse && (
            <div>
              <CozySectionLabel>Active Course</CozySectionLabel>
              <CozyCard>
                <p
                  className="text-sm font-bold mb-1 font-pixel"
                  style={{ color: AMBER, textShadow: '0 1px 2px rgba(0,0,0,0.85)' }}
                >
                  {activeCourse.title}
                </p>
                <p className="text-[12px] mb-3 font-pixel-mono" style={{ color: T.textSecondary }}>
                  {activeLessonsCompleted} / {activeLessonsTotal} lessons
                </p>
                <ProgressBar progress={progressFraction} />
              </CozyCard>
            </div>
          )}

          {otherLockedCourses.length > 0 && (
            <div>
              <CozySectionLabel>Switch To</CozySectionLabel>
              {otherLockedCourses.map((courseId) => {
                const course = courses.find((c) => c.id === courseId);
                if (!course) return null;
                return (
                  <button
                    key={courseId}
                    onClick={() => {
                      setActiveCourse(courseId);
                      router.back();
                    }}
                    className="w-full text-left mb-2 transition-opacity hover:opacity-80"
                  >
                    <CozyCard style={{ padding: 14 }}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold font-pixel" style={{ color: T.textPrimary }}>
                          {course.title}
                        </span>
                        <span className="text-lg" style={{ color: T.textMuted }}>›</span>
                      </div>
                    </CozyCard>
                  </button>
                );
              })}
            </div>
          )}

          {/* Browse Courses — single primary CTA */}
          <button
            onClick={() => router.push('/courses')}
            className="flex items-center gap-3 py-3 px-4 rounded-xl border w-full text-left transition-all"
            style={{
              backgroundColor: 'rgba(14,14,28,0.50)',
              borderColor: COZY_BORDER,
              backdropFilter: 'blur(20px) saturate(1.4)',
              WebkitBackdropFilter: 'blur(20px) saturate(1.4)',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = AMBER; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = COZY_BORDER; }}
          >
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: 'rgba(255,213,128,0.10)' }}
            >
              <span className="text-base" style={{ color: AMBER }}>☷</span>
            </div>
            <span className="flex-1 text-sm font-semibold font-pixel" style={{ color: T.textPrimary }}>
              Browse all courses
            </span>
            <span className="text-lg" style={{ color: T.textMuted }}>›</span>
          </button>

          {/* Disconnect — quiet text button */}
          <button
            onClick={handleDisconnect}
            className="self-start text-[11px] font-pixel-mono uppercase tracking-[1.5px] py-1.5 px-3 rounded transition-colors"
            style={{
              color: 'rgba(255,68,102,0.70)',
              backgroundColor: 'transparent',
              border: 'none',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = T.crimson; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(255,68,102,0.70)'; }}
          >
            Disconnect Wallet
          </button>
        </div>
      </div>
    </>
  );
}
