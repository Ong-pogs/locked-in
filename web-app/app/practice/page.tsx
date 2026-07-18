'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Swords, ChevronRight, BookOpen, Lock } from 'lucide-react';
import { useCourseStore } from '@/stores';
import { CozyCard, CozySectionLabel, COZY_TEXT, COZY_TEXT_SHADOW } from '@/components/cozy';
import { HubButton } from '@/components/HubButton';
import { T } from '@/components/theme';

// Practice Hall (the village chapel). Replay any lesson you've already
// PASSED. Replaying a completed lesson is a server-side practice attempt
// (practice ruling R2/R10): it grades and shows results but never writes
// streak/flame/shield/yield state — pure review, zero stakes.
//
// Only completed lessons are listed. Unreached lessons stay gated behind the
// normal course progression so graded content ahead is never spoiled.

const AMBER = '#F0A878';

export default function PracticePage() {
  const router = useRouter();
  const courses = useCourseStore((s) => s.courses);
  const lessons = useCourseStore((s) => s.lessons);
  const lessonProgress = useCourseStore((s) => s.lessonProgress);
  const enrolledCourseIds = useCourseStore((s) => s.enrolledCourseIds);

  // Practice unlocks per COURSE: only a fully-completed course opens its
  // lessons for replay. Courses still in progress show as locked rows so the
  // player knows practice exists and what earns it. Enrolled courses first,
  // then any other course with progress (e.g. finished + claimed courses that
  // were since un-enrolled).
  const groups = useMemo(() => {
    const courseIds = [
      ...enrolledCourseIds,
      ...courses.map((c) => c.id).filter((id) => !enrolledCourseIds.includes(id)),
    ];
    return courseIds
      .map((courseId) => {
        const course = courses.find((c) => c.id === courseId);
        const courseLessons = [...(lessons[courseId] ?? [])].sort((a, b) => a.order - b.order);
        const completed = courseLessons.filter((l) => lessonProgress[l.id]?.completed);
        // Prefer the loaded lesson list; fall back to the catalog counts when
        // the course's lessons aren't hydrated locally.
        const totalCount = courseLessons.length > 0 ? courseLessons.length : course?.totalLessons ?? 0;
        const completedCount =
          courseLessons.length > 0 ? completed.length : course?.completedLessons ?? 0;
        const unlocked = totalCount > 0 && completedCount >= totalCount;
        return {
          courseId,
          title: course?.title ?? courseId,
          completed,
          completedCount,
          totalCount,
          unlocked,
        };
      })
      .filter((g) => g.completedCount > 0);
  }, [courses, lessons, lessonProgress, enrolledCourseIds]);

  return (
    <div className="min-h-screen relative" style={{ backgroundColor: T.bg }}>
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
              'linear-gradient(180deg, rgba(14,14,28,0.35) 0%, rgba(14,14,28,0.6) 60%, rgba(14,14,28,0.8) 100%)',
          }}
        />
      </div>
      <HubButton />

      <div className="relative z-10 max-w-[760px] mx-auto px-[18px] pb-12 pt-20">
        <div className="flex items-center gap-3">
          <div
            className="flex items-center justify-center rounded-xl shrink-0"
            style={{ width: 44, height: 44, backgroundColor: `${AMBER}1F`, border: `1px solid ${AMBER}55` }}
          >
            <Swords size={20} color={AMBER} strokeWidth={2.4} />
          </div>
          <div>
            <h1
              className="font-pixel text-2xl md:text-3xl font-bold tracking-wide"
              style={{ color: COZY_TEXT, textShadow: COZY_TEXT_SHADOW }}
            >
              Practice Hall
            </h1>
            <p className="font-pixel-mono text-[11px] mt-0.5" style={{ color: T.textMutedStrong }}>
              Finish a course to unlock its practice. Streak, flame and yield stay untouched.
            </p>
          </div>
        </div>

        {groups.length === 0 ? (
          <CozyCard className="mt-8" style={{ padding: 24 }}>
            <div className="flex flex-col items-center text-center gap-3 py-6">
              <BookOpen size={28} color={T.textMuted} />
              <p className="font-pixel text-[15px]" style={{ color: COZY_TEXT, textShadow: COZY_TEXT_SHADOW }}>
                Nothing to practice yet
              </p>
              <p className="font-pixel-mono text-[12px] max-w-[380px]" style={{ color: T.textMutedStrong }}>
                Finish a course and its lessons appear here for stakes-free review.
              </p>
              <button
                onClick={() => router.push('/courses')}
                className="mt-2 px-5 py-3 rounded-lg border font-pixel-mono text-[12px] uppercase tracking-[1.5px] min-h-[44px]"
                style={{
                  borderColor: 'rgba(255,213,128,0.4)',
                  backgroundColor: 'rgba(255,213,128,0.12)',
                  color: COZY_TEXT,
                }}
              >
                Go to courses
              </button>
            </div>
          </CozyCard>
        ) : (
          groups.map((g) => (
            <div key={g.courseId} className="mt-7">
              <CozySectionLabel>{g.title}</CozySectionLabel>
              {!g.unlocked ? (
                <CozyCard className="w-full" style={{ padding: 14, opacity: 0.75 }}>
                  <div className="flex items-center gap-3">
                    <Lock size={16} color={T.textMuted} className="shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p
                        className="font-pixel text-[13px]"
                        style={{ color: T.textMutedStrong, textShadow: COZY_TEXT_SHADOW }}
                      >
                        Finish the course to unlock practice
                      </p>
                      <p className="font-pixel-mono text-[10px] mt-0.5" style={{ color: T.textMuted }}>
                        {g.completedCount}/{g.totalCount} lessons done
                      </p>
                    </div>
                  </div>
                </CozyCard>
              ) : (
              <div className="flex flex-col gap-2.5">
                {g.completed.map((l) => {
                  const score = lessonProgress[l.id]?.score;
                  return (
                    <button
                      key={l.id}
                      onClick={() => router.push(`/lessons/${l.id}`)}
                      className="w-full text-left"
                      aria-label={`Practice ${l.title}`}
                    >
                      <CozyCard className="w-full" style={{ padding: 14 }}>
                        <div className="flex items-center gap-3">
                          <span
                            className="font-pixel-mono text-[11px] shrink-0"
                            style={{ color: T.textMutedStrong }}
                          >
                            {String(l.order).padStart(2, '0')}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p
                              className="font-pixel text-[14px] truncate"
                              style={{ color: COZY_TEXT, textShadow: COZY_TEXT_SHADOW }}
                            >
                              {l.title}
                            </p>
                            {typeof score === 'number' && (
                              <p className="font-pixel-mono text-[10px] mt-0.5" style={{ color: T.textMutedStrong }}>
                                best {score}%
                              </p>
                            )}
                          </div>
                          <span
                            className="font-pixel-mono text-[10px] uppercase tracking-[1px] shrink-0"
                            style={{ color: AMBER }}
                          >
                            Practice
                          </span>
                          <ChevronRight size={18} color={T.textMuted} />
                        </div>
                      </CozyCard>
                    </button>
                  );
                })}
              </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
