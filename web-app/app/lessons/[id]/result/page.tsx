'use client';

import { Suspense, use, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCourseStore } from '@/stores';
import { T } from '@/components/theme';
import { CozyCard } from '@/components/cozy';
import { HubButton } from '@/components/HubButton';

// ── Cozy palette constants (mirror /courses, /dashboard, lesson player) ──
const AMBER = '#FFD580';
const COZY_BORDER = 'rgba(58, 143, 168, 0.45)';
const COZY_TEXT_SHADOW = '0 1px 2px rgba(0,0,0,0.85)';

interface QuizReviewData {
  questions: {
    id: string;
    prompt: string;
    type: string;
    options?: { id: string; text: string }[] | string[];
    correctAnswer?: string;
  }[];
  userAnswers: Record<string, string>;
  questionResults: {
    questionId: string;
    prompt: string;
    accepted: boolean;
    score: number | null;
    feedbackSummary: string | null;
    // Present for every question (MCQ + subjective) since the answer key stopped
    // shipping in the lesson payload; revealed only here, in the post-submit
    // response. `isCorrect` mirrors `accepted` for MCQs.
    isCorrect?: boolean;
    correctAnswer?: string | null;
  }[];
}

// ── Shared cozy shell — academy backdrop + indigo gradient + Hub ──
function CozyResultShell({ children }: { children: React.ReactNode }) {
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
              'linear-gradient(180deg, rgba(14,14,28,0.30) 0%, rgba(14,14,28,0.55) 60%, rgba(14,14,28,0.78) 100%)',
          }}
        />
      </div>
      <HubButton />
      <div className="relative z-10 max-w-[760px] mx-auto px-[18px] pb-10 pt-20">
        {children}
      </div>
    </div>
  );
}

// ── Cozy primary CTA — same treatment as lesson player ──
function CozyPrimary({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full py-3.5 rounded-[10px] text-center transition-all duration-150 cursor-pointer hover:brightness-110"
      style={{
        backgroundColor: AMBER,
        border: `1px solid ${AMBER}80`,
        boxShadow: `0 0 16px ${AMBER}33`,
        fontFamily: 'var(--font-pixel), Georgia, serif',
        fontSize: 13,
        fontWeight: 800,
        color: '#1A1000',
        letterSpacing: 2.5,
        textTransform: 'uppercase',
      }}
    >
      {children}
    </button>
  );
}

export default function LessonResultPage(props: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense
      fallback={
        <CozyResultShell>
          <div className="flex items-center justify-center min-h-[60vh]">
            <p
              className="text-sm font-pixel"
              style={{ color: T.textSecondary, textShadow: COZY_TEXT_SHADOW }}
            >
              Loading...
            </p>
          </div>
        </CozyResultShell>
      }
    >
      <ResultContent params={props.params} />
    </Suspense>
  );
}

function ResultContent({ params }: { params: Promise<{ id: string }> }) {
  const { id: _lessonId } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();

  const score = Number(searchParams.get('score') ?? 0);
  const totalQuestions = Number(searchParams.get('total') ?? 0);
  const accepted = searchParams.get('accepted') !== 'false';
  // Practice-mode ruling R10: replays / post-completion attempts are graded
  // but write nothing server-side — say so instead of implying rewards.
  const practice = searchParams.get('practice') === 'true';
  const fuelAwarded = Number(searchParams.get('fuel') ?? 0);
  const fuelTotal = Number(searchParams.get('fuelTotal') ?? 0);
  const xpAwarded = Number(searchParams.get('xp') ?? 0);
  const xpTotal = Number(searchParams.get('xpTotal') ?? 0);
  const xpLevel = Number(searchParams.get('xpLevel') ?? 0);

  const activeState = useCourseStore((s) => {
    const courseId = s.activeCourseId;
    return courseId ? s.courseStates[courseId] : null;
  });
  const streak = activeState?.currentStreak ?? 0;
  const correctCount = Math.round((score / 100) * totalQuestions);

  // Find the next incomplete lesson in the same course so we can offer
  // a direct "Next Lesson" CTA instead of bouncing back to /courses.
  const nextLessonId = useCourseStore((s) => {
    const finishedLesson = s.getLesson(_lessonId);
    const courseId = finishedLesson?.courseId;
    if (!courseId) return null;
    const lessons = s.getLessonsForCourse(courseId);
    const justFinishedOrder = finishedLesson?.order ?? 0;
    // First lesson at a higher order that isn't yet completed.
    const next = lessons.find(
      (l) => l.order > justFinishedOrder && !s.lessonProgress[l.id]?.completed,
    );
    return next?.id ?? null;
  });

  const scoreColor = score >= 80 ? T.green : score >= 50 ? AMBER : T.crimson;

  const LEVEL_NAMES = ['Novice', 'Apprentice', 'Scholar', 'Adept', 'Master', 'Sage', 'Legend'];
  const levelName = xpLevel > 0 ? (LEVEL_NAMES[xpLevel - 1] ?? `Level ${xpLevel}`) : '';

  // Load question review from localStorage (lesson-specific key, persists across revisits)
  const [reviewData] = useState<QuizReviewData | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = localStorage.getItem(`quizReview::${_lessonId}`);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  });
  const [showReview, setShowReview] = useState(false);

  return (
    <CozyResultShell>
      <div className="flex flex-col items-center w-full">
        {/* Page label / title */}
        <div className="flex items-center justify-center gap-2 mb-3 mt-1">
          <div className="w-[30px] h-px" style={{ backgroundColor: `${AMBER}30` }} />
          <span className="text-[7px]" style={{ color: `${AMBER}50` }}>{'◆'}</span>
          <div className="w-[30px] h-px" style={{ backgroundColor: `${AMBER}30` }} />
        </div>
        <h1
          className="text-2xl font-bold tracking-wide font-pixel"
          style={{ color: AMBER, textShadow: COZY_TEXT_SHADOW }}
        >
          Lesson Result
        </h1>

        {/* Hero score */}
        <p
          className="mt-6 text-[64px] font-bold leading-none font-pixel-mono"
          style={{
            color: scoreColor,
            textShadow: `${COZY_TEXT_SHADOW}, 0 0 24px ${scoreColor}55`,
          }}
        >
          {score}%
        </p>
        <p
          className="mt-2 text-[13px] font-pixel-mono uppercase tracking-[1.5px]"
          style={{ color: T.textSecondary, textShadow: COZY_TEXT_SHADOW }}
        >
          {correctCount}/{totalQuestions} Questions Correct
        </p>

        {/* Practice notice (ruling R10) — themed like the dashboard's
            practice badge; streak/shields/rewards were NOT touched. */}
        {practice && (
          <div
            data-testid="practice-notice"
            className="mt-5 w-full py-2.5 px-3 rounded-lg border text-center font-pixel-mono text-[11px] uppercase tracking-[1.5px]"
            style={{
              backgroundColor: 'rgba(153,69,255,0.10)',
              borderColor: 'rgba(153,69,255,0.4)',
              color: '#B98AFF',
              textShadow: COZY_TEXT_SHADOW,
            }}
          >
            Practice — streak, shields and rewards unchanged
          </div>
        )}

        {/* Reward cards */}
        <div className="mt-7 w-full flex flex-col gap-3">
          {/* Status */}
          <CozyCard>
            <p
              className="font-pixel-mono text-[10px] uppercase tracking-[1.5px]"
              style={{ color: AMBER, opacity: 0.75, textShadow: COZY_TEXT_SHADOW }}
            >
              Lesson Status
            </p>
            <p
              className="text-[22px] font-bold mt-1 font-pixel"
              style={{
                color: accepted ? T.green : AMBER,
                textShadow: COZY_TEXT_SHADOW,
              }}
            >
              {accepted ? 'Verified' : 'Needs Improvement'}
            </p>
          </CozyCard>

          {/* Rewards row */}
          <div className="flex gap-3">
            {/* Streak */}
            <div className="flex-1">
              <CozyCard>
                <p
                  className="font-pixel-mono text-[10px] uppercase tracking-[1.5px]"
                  style={{ color: AMBER, opacity: 0.75, textShadow: COZY_TEXT_SHADOW }}
                >
                  Streak
                </p>
                <p
                  className="text-[20px] font-bold mt-1 font-pixel-mono"
                  style={{ color: AMBER, textShadow: COZY_TEXT_SHADOW }}
                >
                  {streak} day{streak !== 1 ? 's' : ''}
                </p>
              </CozyCard>
            </div>

            {/* Fuel earned */}
            {fuelAwarded > 0 && (
              <div className="flex-1">
                <CozyCard>
                  <p
                    className="font-pixel-mono text-[10px] uppercase tracking-[1.5px]"
                    style={{ color: AMBER, opacity: 0.75, textShadow: COZY_TEXT_SHADOW }}
                  >
                    Fuel Earned
                  </p>
                  <p
                    className="text-[20px] font-bold mt-1 font-pixel-mono"
                    style={{ color: T.rust, textShadow: COZY_TEXT_SHADOW }}
                  >
                    +{fuelAwarded.toFixed(2)}
                  </p>
                  <div
                    className="mt-2 w-full h-1.5 rounded-full overflow-hidden"
                    style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}
                  >
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.min(100, fuelTotal * 100)}%`,
                        backgroundColor: fuelTotal >= 1 ? T.green : AMBER,
                      }}
                    />
                  </div>
                  <p
                    className="text-[9px] font-pixel-mono mt-1"
                    style={{ color: T.textMuted }}
                  >
                    {fuelTotal.toFixed(2)} / 1.00 today
                  </p>
                </CozyCard>
              </div>
            )}
          </div>

          {/* XP earned */}
          {xpAwarded > 0 && (
            <CozyCard>
              <div className="flex items-center justify-between">
                <div>
                  <p
                    className="font-pixel-mono text-[10px] uppercase tracking-[1.5px]"
                    style={{ color: AMBER, opacity: 0.75, textShadow: COZY_TEXT_SHADOW }}
                  >
                    XP Earned
                  </p>
                  <p
                    className="text-[20px] font-bold mt-1 font-pixel-mono"
                    style={{ color: T.violet, textShadow: COZY_TEXT_SHADOW }}
                  >
                    +{xpAwarded} XP
                  </p>
                </div>
                <div className="text-right">
                  <p
                    className="text-[11px] font-pixel-mono font-bold"
                    style={{ color: AMBER, textShadow: COZY_TEXT_SHADOW }}
                  >
                    Lv.{xpLevel} {levelName}
                  </p>
                  <p
                    className="text-[10px] font-pixel-mono"
                    style={{ color: T.textMuted }}
                  >
                    {xpTotal} XP total
                  </p>
                </div>
              </div>
            </CozyCard>
          )}
        </div>

        {/* Question Review toggle */}
        {reviewData && reviewData.questions.length > 0 && (
          <div className="mt-5 w-full">
            <button
              onClick={() => setShowReview(!showReview)}
              className="w-full py-3 rounded-[10px] border text-center font-pixel-mono text-[11px] font-bold uppercase tracking-[1.5px] transition-all duration-150 cursor-pointer hover:brightness-110"
              style={{
                backgroundColor: 'rgba(14,14,28,0.5)',
                borderColor: COZY_BORDER,
                color: AMBER,
                textShadow: COZY_TEXT_SHADOW,
              }}
            >
              {showReview ? 'Hide Review' : 'Review Answers'}
            </button>

            {showReview && (
              <div className="mt-3 flex flex-col gap-3">
                {reviewData.questions.map((q, idx) => {
                  const userAnswer = reviewData.userAnswers[q.id] ?? '';
                  const backendResult = reviewData.questionResults.find(r => r.questionId === q.id);
                  const isCorrect = backendResult
                    ? backendResult.accepted
                    : q.correctAnswer
                      ? userAnswer === q.correctAnswer
                      : null;
                  // The answer key no longer ships in the lesson payload; the
                  // graded (post-submit) response reveals it instead.
                  const revealAnswer = backendResult?.correctAnswer ?? q.correctAnswer ?? null;

                  const accentColor =
                    isCorrect === null ? AMBER : isCorrect ? T.green : T.crimson;

                  return (
                    <CozyCard
                      key={q.id}
                      style={{
                        borderColor: `${accentColor}55`,
                      }}
                    >
                      <div className="flex items-start gap-2 mb-2">
                        <span
                          className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0 mt-0.5 font-pixel-mono"
                          style={{
                            backgroundColor: `${accentColor}22`,
                            color: accentColor,
                            border: `1px solid ${accentColor}55`,
                            textShadow: COZY_TEXT_SHADOW,
                          }}
                        >
                          {idx + 1}
                        </span>
                        <p
                          className="text-[14px] font-bold leading-[20px] font-pixel"
                          style={{ color: T.textPrimary, textShadow: COZY_TEXT_SHADOW }}
                        >
                          {q.prompt}
                        </p>
                      </div>

                      {/* User's answer */}
                      <div className="ml-8">
                        <p
                          className="text-[10px] font-pixel-mono uppercase tracking-[1.5px] mb-1"
                          style={{ color: T.textMuted }}
                        >
                          Your answer
                        </p>
                        <p
                          className="text-[13px] mb-2 font-pixel"
                          style={{
                            color:
                              isCorrect === false
                                ? T.crimson
                                : isCorrect === true
                                  ? T.green
                                  : T.textPrimary,
                            textShadow: COZY_TEXT_SHADOW,
                          }}
                        >
                          {userAnswer || '(no answer)'}
                        </p>

                        {/* Correct answer if wrong */}
                        {isCorrect === false && revealAnswer && (
                          <>
                            <p
                              className="text-[10px] font-pixel-mono uppercase tracking-[1.5px] mb-1"
                              style={{ color: T.textMuted }}
                            >
                              Correct answer
                            </p>
                            <p
                              className="text-[13px] font-pixel"
                              style={{ color: T.green, textShadow: COZY_TEXT_SHADOW }}
                            >
                              {revealAnswer}
                            </p>
                          </>
                        )}

                        {/* Backend feedback */}
                        {backendResult?.feedbackSummary && (
                          <p
                            className="text-[12px] mt-2 leading-[17px] font-pixel"
                            style={{ color: T.textSecondary }}
                          >
                            {backendResult.feedbackSummary}
                          </p>
                        )}
                      </div>
                    </CozyCard>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Continue CTAs — Next Lesson is the primary if there is one. */}
        <div className="mt-6 w-full flex flex-col gap-3">
          {nextLessonId ? (
            <>
              <CozyPrimary onClick={() => router.push(`/lessons/${nextLessonId}`)}>
                Next Lesson
              </CozyPrimary>
              <button
                type="button"
                onClick={() => router.push('/courses')}
                className="w-full py-3 rounded-[10px] text-center transition-opacity hover:opacity-80 cursor-pointer font-pixel-mono font-bold uppercase tracking-[1.5px] text-[11px]"
                style={{
                  color: AMBER,
                  border: `1px solid ${COZY_BORDER}`,
                  backgroundColor: 'rgba(14,14,28,0.5)',
                  textShadow: COZY_TEXT_SHADOW,
                }}
              >
                Back to Courses
              </button>
            </>
          ) : (
            <CozyPrimary onClick={() => router.push('/courses')}>
              {/* No next lesson found — either course complete or already
                  all done. */}
              Back to Courses
            </CozyPrimary>
          )}
        </div>
      </div>
    </CozyResultShell>
  );
}
