'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useDungeon } from '@/components/DungeonProvider';
import { useCourseStore } from '@/stores/courseStore';
import { useUserStore } from '@/stores/userStore';
import type { Viewpoint } from '@/types';
import { useSceneStore } from '@/stores/sceneStore';
import { T, ParchmentCard, ProgressBar } from '@/components/theme';
import { User, ArrowLeft } from 'lucide-react';

export default function DungeonPage() {
  const router = useRouter();
  const {
    show, hide, sendMessage, onMessage,
    sceneReady, loadProgress, iframeError,
  } = useDungeon();

  // Store subscriptions — derive flame from courseStore (matches dashboard)
  const activeGameState = useCourseStore((s) => {
    const id = s.activeCourseId;
    return id ? s.courseStates[id] ?? null : null;
  });
  const flameState = activeGameState?.flameState ?? 'COLD';
  const lightIntensity = activeGameState?.lightIntensity ?? 0.15;
  const currentViewpoint = useSceneStore((s) => s.currentViewpoint);
  const roomPhase = useSceneStore((s) => s.roomPhase);
  const currentStreak = useCourseStore((s) => {
    const active = s.activeCourseId;
    return active ? (s.courseStates[active]?.currentStreak ?? 0) : 0;
  });
  const activeCourseId = useCourseStore((s) => s.activeCourseId);
  const activeCourseIds = useCourseStore((s) => s.activeCourseIds);
  const courseStates = useCourseStore((s) => s.courseStates);
  const setActiveCourse = useCourseStore((s) => s.setActiveCourse);
  const refreshCourseRuntime = useCourseStore((s) => s.refreshCourseRuntime);
  const authToken = useUserStore((s) => s.authToken);

  const [bookModalVisible, setBookModalVisible] = useState(false);

  const lockedCourseIds = useMemo(
    () => activeCourseIds.filter(
      (courseId: string) => Boolean(courseStates[courseId]?.lockAccountAddress),
    ),
    [activeCourseIds, courseStates],
  );

  // Auto-select first locked course if none active
  useEffect(() => {
    if (!activeCourseId && lockedCourseIds.length > 0) {
      setActiveCourse(lockedCourseIds[0]);
    }
  }, [activeCourseId, lockedCourseIds, setActiveCourse]);

  // Guard: no locked courses → course browser
  useEffect(() => {
    if (lockedCourseIds.length === 0) {
      router.replace('/courses');
    }
  }, [lockedCourseIds.length, router]);

  // Show dungeon iframe on mount, hide on unmount
  useEffect(() => {
    show();
    sendMessage('cameraGoBack', {});
    return () => hide();
  }, [show, hide, sendMessage]);

  // Send initial state once scene is ready
  useEffect(() => {
    if (!sceneReady) return;
    sendMessage('initState', {
      flameState,
      lightIntensity,
      viewpoint: currentViewpoint,
      roomPhase,
      streak: currentStreak,
    });
    // Delay so dungeon lights are fully created before toggling mode
    setTimeout(() => {
      sendMessage('setLightingMode', { mode: 'normal' });
    }, 300);
  }, [sceneReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync flame state changes
  useEffect(() => {
    if (!sceneReady) return;
    sendMessage('flameState', { state: flameState, intensity: lightIntensity });
  }, [flameState, lightIntensity, sceneReady, sendMessage]);

  // Sync viewpoint
  useEffect(() => {
    if (!sceneReady) return;
    sendMessage('setViewpoint', { viewpoint: currentViewpoint });
  }, [currentViewpoint, sceneReady, sendMessage]);

  // Sync room phase
  useEffect(() => {
    if (!sceneReady) return;
    sendMessage('setRoomPhase', { phase: roomPhase });
  }, [roomPhase, sceneReady, sendMessage]);

  // Handle messages from dungeon scene (object taps, brew events, viewpoint changes)
  useEffect(() => {
    return onMessage((data: Record<string, unknown>) => {
      const type = data.type as string;
      const payload = data.payload as Record<string, unknown> | undefined;

      switch (type) {
        case 'objectTapped': {
          const objectId = payload?.objectId as string;
          switch (objectId) {
            case 'book':
            case 'bookshelf':
              setBookModalVisible(true);
              break;
            case 'alchemy':
            case 'alchemy_table':
            case 'alchemy_shelf':
            case 'alchemy_yield':
              router.push('/alchemy');
              break;
            case 'noticeboard':
              router.push('/leaderboard');
              break;
            case 'old_chest':
              router.push('/inventory');
              break;
            case 'oil_lamp_left':
            case 'oil_lamp_center':
            case 'oil_lamp_right':
              router.push('/dashboard');
              break;
          }
          break;
        }

        case 'brewConfirmed': {
          const { activeCourseId: acid, courseStates: cs } = useCourseStore.getState();
          if (acid) {
            const activeState = cs[acid];
            if (activeState?.fuelCounter > 0) {
              useCourseStore.getState().convertFuelForCourse(acid, 1);
            }
          }
          break;
        }

        case 'viewpointChanged':
          if (payload?.viewpoint) {
            useSceneStore.getState().setViewpoint(payload.viewpoint as Viewpoint);
          }
          break;
      }
    });
  }, [onMessage, router]);

  // Initialize content
  useEffect(() => {
    useCourseStore.getState().initializeContent().catch(() => {});
  }, []);

  // Refresh course runtime from backend and sync flame if real streak data exists
  useEffect(() => {
    if (!activeCourseId || !authToken) return;
    refreshCourseRuntime(activeCourseId, authToken).catch(() => {});
  }, [activeCourseId, authToken, refreshCourseRuntime]);

  // Error state — fixed z-[5] so it stacks above the dungeon iframe (z-0)
  if (iframeError) {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center" style={{ backgroundColor: T.bg }}>
        <div className="text-center space-y-4">
          <h2 className="text-xl font-bold" style={{ color: T.crimson }}>Dungeon Error</h2>
          <p style={{ color: T.textSecondary }}>{iframeError}</p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 rounded-lg text-sm"
            style={{ backgroundColor: T.amber, color: '#1A1000' }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // Loading state — fixed z-[5] so it stacks above the dungeon iframe (z-0)
  if (!sceneReady) {
    return (
      <div className="fixed inset-0 z-[5] flex items-center justify-center" style={{ backgroundColor: '#050508' }}>
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin mx-auto" style={{ borderColor: '#ff8c42', borderTopColor: 'transparent' }} />
          <p className="text-sm" style={{ color: '#888' }}>
            Loading dungeon... {Math.round(loadProgress * 100)}%
          </p>
        </div>
      </div>
    );
  }

  // Dungeon is rendering via iframe — show profile button + book modal overlay
  return (
    <>
      {/* Floating back button — mobile only, desktop has sidebar */}
      <button
        onClick={() => router.back()}
        className="fixed top-4 left-4 z-30 flex items-center justify-center md:hidden"
        style={{
          width: 40,
          height: 40,
          borderRadius: 22,
          backgroundColor: 'rgba(14,14,28,0.88)',
          border: `1px solid ${T.borderAlive}`,
        }}
      >
        <ArrowLeft size={18} color={T.amber} strokeWidth={2.5} />
      </button>

      {/* Floating profile button — matches Android UndergroundHubScreen overlay (mobile only, desktop has sidebar) */}
      <button
        onClick={() => router.push('/profile')}
        className="fixed top-4 right-4 z-30 flex items-center justify-center md:hidden"
        style={{
          width: 40,
          height: 40,
          borderRadius: 22,
          backgroundColor: 'rgba(14,14,28,0.88)',
          border: `1px solid ${T.borderAlive}`,
        }}
      >
        <User size={18} color={T.amber} strokeWidth={2.5} />
      </button>

      {/* Book modal — lesson browser overlay */}
      {bookModalVisible && (
        <BookModal
          onClose={() => {
            setBookModalVisible(false);
            sendMessage('cameraGoBack', {});
          }}
          onStartLesson={(lessonId) => {
            setBookModalVisible(false);
            router.push(`/lessons/${lessonId}`);
          }}
          onBrowseCourses={() => {
            setBookModalVisible(false);
            router.push('/courses');
          }}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Book Modal — lesson browser that opens when tapping bookshelf
// ---------------------------------------------------------------------------
function BookModal({
  onClose,
  onStartLesson,
  onBrowseCourses,
}: {
  onClose: () => void;
  onStartLesson: (lessonId: string) => void;
  onBrowseCourses: () => void;
}) {
  const activeCourseId = useCourseStore((s) => s.activeCourseId);
  const courses = useCourseStore((s) => s.courses);
  const lessons = useCourseStore((s) => s.lessons);
  const lessonProgress = useCourseStore((s) => s.lessonProgress);

  const course = activeCourseId
    ? courses.find((c: { id: string }) => c.id === activeCourseId) ?? null
    : courses[0] ?? null;
  const courseLessons = course
    ? (lessons[course.id] ?? []).sort((a: { order: number }, b: { order: number }) => a.order - b.order)
    : [];

  const nextLesson = courseLessons.find((l: { id: string }) => !lessonProgress[l.id]?.completed);
  const completedLessons = courseLessons.filter((l: { id: string }) => lessonProgress[l.id]?.completed);
  const lastCompleted = completedLessons.length > 0
    ? completedLessons[completedLessons.length - 1]
    : null;
  const lastScore = lastCompleted ? lessonProgress[lastCompleted.id]?.score : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      style={{ backgroundColor: 'rgba(3,3,6,0.82)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-t-3xl px-[22px] pt-0 pb-10 border-t overflow-y-auto max-h-[85vh]"
        style={{ backgroundColor: T.bg, borderColor: T.borderAlive }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Diamond decoration */}
        <div className="flex items-center justify-center gap-2 pt-4 pb-3.5">
          <div className="w-10 h-px" style={{ backgroundColor: `${T.amber}40` }} />
          <span className="text-[7px]" style={{ color: `${T.amber}60` }}>◆</span>
          <div className="w-10 h-px" style={{ backgroundColor: `${T.amber}40` }} />
        </div>

        {/* Course title */}
        <h2
          className="text-[22px] font-bold tracking-wide"
          style={{ fontFamily: 'Georgia, serif', color: T.textPrimary }}
        >
          {course?.title ?? 'No Course'}
        </h2>
        <p className="text-[13px] mt-1.5 leading-5" style={{ color: T.textSecondary }}>
          {course?.description ?? ''}
        </p>

        {/* Progress card */}
        <ParchmentCard className="mt-3.5 p-4">
          <p className="font-mono text-[10px] font-bold uppercase tracking-[2px] mb-1.5" style={{ color: T.textSecondary }}>
            Progress
          </p>
          <ProgressBar
            progress={courseLessons.length > 0 ? completedLessons.length / courseLessons.length : 0}
          />
          <p className="font-mono text-xs mt-1" style={{ color: T.textMuted }}>
            {completedLessons.length}/{courseLessons.length} lessons
          </p>
        </ParchmentCard>

        {/* Last Learned card */}
        <ParchmentCard className="mt-3.5 p-4">
          <p className="font-mono text-[10px] font-bold uppercase tracking-[2px] mb-1.5" style={{ color: T.textSecondary }}>
            Last Learned
          </p>
          {lastCompleted ? (
            <>
              <p className="text-base font-semibold mt-0.5" style={{ color: T.textPrimary }}>
                {lastCompleted.title}
              </p>
              <p className="font-mono text-xs mt-1" style={{ color: T.textMuted }}>
                Score: {lastScore ?? 0}%
              </p>
            </>
          ) : (
            <p className="font-mono text-xs" style={{ color: T.textMuted }}>
              No lessons completed yet
            </p>
          )}
        </ParchmentCard>

        {/* Action grid */}
        <div className="grid grid-cols-4 gap-2.5 mt-4">
          {[
            { icon: '⚗️', label: 'Practice', soon: true },
            { icon: '🧩', label: 'Puzzle', soon: true },
            { icon: '📜', label: 'Dictionary', soon: true },
            { icon: '📚', label: 'Courses', action: onBrowseCourses },
          ].map((item) => (
            <button
              key={item.label}
              onClick={item.action}
              disabled={item.soon}
              className={`flex flex-col items-center gap-1.5 py-3.5 rounded-[10px] border transition-all duration-150 ${item.soon ? 'opacity-40' : 'hover:border-[rgba(212,160,74,0.18)] hover:bg-[rgba(255,255,255,0.06)]'}`}
              style={{ backgroundColor: T.bgCard, borderColor: T.borderDormant }}
            >
              <span className="text-xl">{item.icon}</span>
              <span className="font-mono text-[10px] font-semibold tracking-wide" style={{ color: T.textSecondary }}>
                {item.label}
              </span>
              {item.soon && (
                <span className="font-mono text-[8px] uppercase tracking-[1px]" style={{ color: T.textMuted }}>
                  Soon
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Start lesson / All complete button */}
        {nextLesson ? (
          <button
            onClick={() => onStartLesson(nextLesson.id)}
            className="w-full flex items-center justify-center gap-2 py-[15px] mt-4 rounded-[10px] border"
            style={{
              backgroundColor: T.amber,
              borderColor: '#E8B860',
              fontFamily: 'Georgia, serif',
            }}
          >
            <span className="text-base">📖</span>
            <span
              className="text-[13px] font-extrabold uppercase tracking-[1.5px]"
              style={{ color: '#1A1000' }}
            >
              Lesson {nextLesson.order}: {nextLesson.title}
            </span>
          </button>
        ) : (
          <div
            className="w-full text-center py-[15px] mt-4 rounded-[10px] border"
            style={{
              backgroundColor: 'rgba(62,230,138,0.12)',
              borderColor: 'rgba(62,230,138,0.25)',
            }}
          >
            <span
              className="text-[13px] font-extrabold uppercase tracking-[1.5px]"
              style={{ color: T.green, fontFamily: 'Georgia, serif' }}
            >
              All Lessons Complete!
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
