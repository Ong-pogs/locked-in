'use client';

import { useCallback, useEffect, useMemo, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import { useCourseStore, useUserStore, useFlameStore } from '@/stores';
import { hasRemoteLessonApi, startLesson, submitLesson, fetchWithAuth } from '@/services/api';
import type { Question, Lesson } from '@/types';
import { T } from '@/components/theme';
import { CozyCard } from '@/components/cozy';
import { HubButton } from '@/components/HubButton';
import { RecallQuestion } from '@/components/RecallQuestion';
import { LessonBlockRenderer } from '@/components/LessonBlocks';

type Phase = 'recall' | 'reading' | 'questions';

// crypto.randomUUID is missing on iOS Safari < 15.4, which crashes the lesson
// page outright. Fall back to an RFC4122 v4 implementation built on getRandomValues.
function safeRandomUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex: string[] = [];
  for (let i = 0; i < bytes.length; i += 1) hex.push(bytes[i].toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
}

// ── Cozy palette constants (mirror /courses, /dashboard) ──
const AMBER = '#FFD580';
const COZY_BORDER = 'rgba(58, 143, 168, 0.45)';
const COZY_TEXT_SHADOW = '0 1px 2px rgba(0,0,0,0.85)';

// ── Shared layout shell — academy backdrop + indigo gradient + Hub ──
function CozyLessonShell({ children }: { children: React.ReactNode }) {
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

// ── Cozy progress bar — amber gradient + glow ──
function CozyProgressBar({ progress, color }: { progress: number; color?: string }) {
  const pct = Math.min(100, Math.max(0, progress * 100));
  const fill = color ?? AMBER;
  return (
    <div
      className="h-2 rounded-full overflow-hidden"
      style={{
        backgroundColor: 'rgba(255,255,255,0.06)',
        border: `1px solid ${COZY_BORDER}`,
      }}
    >
      <div
        className="h-full rounded-full transition-all duration-300"
        style={{
          width: `${pct}%`,
          background: `linear-gradient(90deg, ${fill}aa 0%, ${fill} 100%)`,
          boxShadow: pct > 0 ? `0 0 10px ${fill}80` : 'none',
        }}
      />
    </div>
  );
}

// ── Cozy primary CTA (amber) — replaces wood-textured PrimaryButton on these pages ──
function CozyPrimary({
  children,
  onClick,
  disabled = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`w-full py-3.5 rounded-[10px] text-center transition-all duration-150 cursor-pointer ${
        disabled ? 'opacity-40 cursor-not-allowed' : 'hover:brightness-110'
      }`}
      style={{
        backgroundColor: AMBER,
        border: `1px solid ${AMBER}80`,
        boxShadow: disabled ? 'none' : `0 0 16px ${AMBER}33`,
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

export default function LessonPage(props: {
  params: Promise<{ id: string }>;
}) {
  const { id: lessonId } = use(props.params);
  const router = useRouter();

  // Store selectors
  const lesson = useCourseStore((s) => s.getLesson(lessonId));
  const walletAddress = useUserStore((s) => s.walletAddress);

  // Recall: pick a random question from completed previous lessons.
  // Memoized so the random pick is stable per lesson — without this, the
  // IIFE re-ran on every render and Math.random() swapped the recall
  // question mid-attempt whenever React re-rendered.
  const lessonProgress = useCourseStore((s) => s.lessonProgress);
  const allLessons = useCourseStore((s) => s.getLessonsForCourse(lesson?.courseId ?? ''));
  const recallData = useMemo(() => {
    if (!lesson) return null;
    const previousLessons = allLessons
      .filter((l: Lesson) => l.order < lesson.order && lessonProgress[l.id]?.completed);
    if (previousLessons.length === 0) return null;
    const pool: Array<{ question: Question; lessonTitle: string }> = [];
    for (const prev of previousLessons) {
      for (const q of prev.questions ?? []) {
        pool.push({ question: q, lessonTitle: prev.title });
      }
    }
    if (pool.length === 0) return null;
    return pool[Math.floor(Math.random() * pool.length)];
    // Intentionally key on lessonId only — we want a fresh pick per lesson
    // visit, but stable within that visit. Re-running on every progress
    // update would swap the question while the user is mid-recall.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessonId]);

  const shouldShowRecall = recallData !== null;

  // Persist the current attempt to sessionStorage so a page reload mid-quiz
  // doesn't regenerate attemptId — without this, the backend (which only
  // knows the original attemptId from startLesson) would reject the submit.
  const ATTEMPT_STORAGE_KEY = `lesson-attempt::${lessonId}`;
  type StoredAttempt = {
    attemptId: string;
    startedAt: string;
    phase: 'reading' | 'questions';
    currentQuestionIndex: number;
    submittedAnswers: Record<string, string>;
    correctCount: number;
  };
  const restored: StoredAttempt | null = (() => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = window.sessionStorage.getItem(ATTEMPT_STORAGE_KEY);
      return raw ? (JSON.parse(raw) as StoredAttempt) : null;
    } catch {
      return null;
    }
  })();

  // Local state — initialized from sessionStorage when an attempt was in
  // flight at refresh time.
  const [phase, setPhase] = useState<Phase>(() => {
    if (restored) return restored.phase;
    return shouldShowRecall ? 'recall' : 'reading';
  });
  // Once an attempt is restored we've already called startLesson — record
  // that so we don't re-sync, which would 409 against the existing attempt.
  const [startSynced, setStartSynced] = useState<boolean>(restored !== null);
  const [attemptId, setAttemptId] = useState<string | null>(restored?.attemptId ?? null);
  const [attemptStartedAt, setAttemptStartedAt] = useState<string | null>(
    restored?.startedAt ?? null,
  );
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(
    restored?.currentQuestionIndex ?? 0,
  );
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [textAnswer, setTextAnswer] = useState('');
  const [submittedAnswers, setSubmittedAnswers] = useState<Record<string, string>>(
    restored?.submittedAnswers ?? {},
  );
  const [hasChecked, setHasChecked] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);
  const [correctCount, setCorrectCount] = useState(restored?.correctCount ?? 0);

  // Persist the attempt state to sessionStorage whenever it changes. Cleared
  // on successful lesson completion (in applyLessonCompletion). Scoped to
  // sessionStorage (not local) so it auto-clears when the tab closes.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!attemptId || !attemptStartedAt) return;
    if (phase !== 'reading' && phase !== 'questions') return;
    try {
      const payload: StoredAttempt = {
        attemptId,
        startedAt: attemptStartedAt,
        phase,
        currentQuestionIndex,
        submittedAnswers,
        correctCount,
      };
      window.sessionStorage.setItem(ATTEMPT_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      /* sessionStorage may be unavailable */
    }
  }, [
    ATTEMPT_STORAGE_KEY,
    attemptId,
    attemptStartedAt,
    phase,
    currentQuestionIndex,
    submittedAnswers,
    correctCount,
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inputFocused, setInputFocused] = useState(false);

  // Derived values
  const questions = useMemo(() => lesson?.questions ?? [], [lesson?.questions]);
  const currentQuestion: Question | undefined = questions[currentQuestionIndex];
  const totalQuestions = questions.length;
  const isLastQuestion = currentQuestionIndex === totalQuestions - 1;
  const courseId = lesson?.courseId ?? '';

  const usesRemoteVerification =
    hasRemoteLessonApi() &&
    lesson?.releaseId !== 'local-mock-release' &&
    !!walletAddress;

  const supportsLocalChecking = Boolean(currentQuestion?.correctAnswer);

  const canContinue =
    (currentQuestion?.type === 'mcq' && Boolean(selectedOption)) ||
    (currentQuestion?.type === 'short_text' && textAnswer.trim().length > 0);

  // Get sorted lesson blocks
  const sortedBlocks = lesson?.blocks?.sort((a, b) => a.order - b.order) ?? [];
  const hasBlocks = sortedBlocks.length > 0;
  // Reading-section progress is persisted per-lesson so a user who reads
  // through 3/5 sections, bails to the hub, and comes back resumes where
  // they left off instead of restarting at section 1.
  const READING_SECTION_KEY = `locked-in:reading-section::${lessonId}`;
  const [sectionIndex, setSectionIndex] = useState<number>(() => {
    if (typeof window === 'undefined') return 0;
    try {
      const raw = window.localStorage.getItem(READING_SECTION_KEY);
      const parsed = raw ? Number.parseInt(raw, 10) : 0;
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    } catch {
      return 0;
    }
  });
  const totalSections = sortedBlocks.length || 1;
  // Clamp out-of-range restored values (content may have shrunk since the
  // last visit). Runs once after totalSections is known.
  useEffect(() => {
    if (sectionIndex >= totalSections) setSectionIndex(0);
  }, [sectionIndex, totalSections]);
  // Persist on every change.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(READING_SECTION_KEY, String(sectionIndex));
    } catch {
      /* localStorage may be unavailable in private mode */
    }
  }, [READING_SECTION_KEY, sectionIndex]);
  const isLastSection = sectionIndex >= totalSections - 1;
  // Fallback for legacy lessons without blocks
  const legacyContent = lesson?.content ?? '';

  // Lesson position
  const courseLessons = useCourseStore((s) => s.getLessonsForCourse(courseId));
  const lessonOrder = lesson?.order ?? 0;
  const totalLessonsInCourse = courseLessons.length;

  // Lesson completion. `serverHandled` tells us whether the backend already
  // applied today's streak increment via syncCourseRuntime — in that case
  // we skip completeDayForCourse to avoid double-incrementing (server says
  // streak=5, local sync writes 5, completeDayForCourse would push it to 6
  // because it doesn't read syncCourseRuntime's date stamp).
  const applyLessonCompletion = useCallback(
    (score: number, serverHandled = false) => {
      useCourseStore.getState().completeLesson(lessonId, courseId, score);
      if (!serverHandled) {
        useCourseStore.getState().completeDayForCourse(courseId);
      }
      const newStreak = useCourseStore.getState().courseStates[courseId]?.currentStreak ?? 0;
      useFlameStore.getState().updateFromStreak(newStreak);
      // Lesson is done — clear the persisted section index AND the
      // in-flight attempt cache so a future revisit (e.g., review) starts
      // at section 1 with a fresh attempt instead of resuming the just-
      // completed one.
      try {
        window.localStorage.removeItem(`locked-in:reading-section::${lessonId}`);
        window.sessionStorage.removeItem(`lesson-attempt::${lessonId}`);
      } catch {
        /* ignore */
      }
    },
    [courseId, lessonId],
  );

  const syncLessonStart = useCallback(
    (nextAttemptId: string, startedAt: string) => {
      if (startSynced || !usesRemoteVerification) return;
      setStartSynced(true);
      fetchWithAuth((token) =>
        startLesson(lessonId, { attemptId: nextAttemptId, startedAt }, token),
      ).catch(() => {
        setStartSynced(false);
      });
    },
    [lessonId, startSynced, usesRemoteVerification],
  );

  const gradeCurrentAnswer = useCallback(() => {
    if (!currentQuestion?.correctAnswer) return false;
    if (currentQuestion.type === 'mcq') {
      return selectedOption === currentQuestion.correctAnswer;
    }
    return (
      textAnswer.trim().replace(/\s+/g, ' ').toLowerCase() ===
      currentQuestion.correctAnswer.trim().replace(/\s+/g, ' ').toLowerCase()
    );
  }, [currentQuestion, selectedOption, textAnswer]);

  const buildAnswerMapWithCurrent = useCallback(() => {
    if (!currentQuestion) return submittedAnswers;
    const answerText =
      currentQuestion.type === 'mcq' ? selectedOption ?? '' : textAnswer.trim();
    return { ...submittedAnswers, [currentQuestion.id]: answerText };
  }, [currentQuestion, selectedOption, submittedAnswers, textAnswer]);

  const submitRemoteLesson = useCallback(
    async (answerMap: Record<string, string>) => {
      if (!attemptId || !attemptStartedAt) {
        throw new Error('Lesson attempt was not initialized.');
      }
      // If the initial start sync failed, the backend doesn't know about this
      // attempt and will reject the submit. Retry the start first.
      if (!startSynced) {
        await fetchWithAuth((token) =>
          startLesson(lessonId, { attemptId, startedAt: attemptStartedAt }, token),
        );
        setStartSynced(true);
      }
      const response = await fetchWithAuth((token) =>
        submitLesson(
          lessonId,
          {
            attemptId,
            startedAt: attemptStartedAt,
            completedAt: new Date().toISOString(),
            answers: questions.map((q) => ({
              questionId: q.id,
              answerText: answerMap[q.id] ?? '',
            })),
          },
          token,
        ),
      );
      if (!response) throw new Error('Backend session expired.');
      return response;
    },
    [attemptId, attemptStartedAt, lessonId, questions, startSynced],
  );

  const finalizeLesson = useCallback(
    async (answerMap: Record<string, string>) => {
      if (usesRemoteVerification) {
        setSubmitting(true);
        try {
          const result = await submitRemoteLesson(answerMap);
          if (result.courseRuntime) {
            useCourseStore.getState().syncCourseRuntime(courseId, result.courseRuntime);
          }
          if (result.accepted) {
            // Server already incremented today's streak — pass serverHandled
            // so we don't double-count locally.
            applyLessonCompletion(result.score, Boolean(result.courseRuntime));
          }
          const params = new URLSearchParams({
            score: String(result.score),
            total: String(result.totalQuestions),
            accepted: String(result.accepted),
          });
          if (result.courseRuntime?.fuelFragmentAwarded) {
            params.set('fuel', String(result.courseRuntime.fuelFragmentAwarded));
            params.set('fuelTotal', String(result.courseRuntime.fuelFragmentsToday ?? 0));
          }
          if (result.xp?.xpAwarded) {
            params.set('xp', String(result.xp.xpAwarded));
            params.set('xpTotal', String(result.xp.xpTotal));
            params.set('xpLevel', String(result.xp.xpLevel));
          }
          // Store question review data for result page (lesson-specific, persists across revisits)
          try {
            localStorage.setItem(`quizReview::${lessonId}`, JSON.stringify({
              questions: questions.map(q => ({
                id: q.id,
                prompt: q.prompt,
                type: q.type,
                options: q.options,
                correctAnswer: q.correctAnswer,
              })),
              userAnswers: answerMap,
              questionResults: result.questionResults ?? [],
            }));
          } catch { /* localStorage may be unavailable */ }
          router.push(`/lessons/${lessonId}/result?${params.toString()}`);
        } catch {
          setError('Submit failed. Please try again.');
        } finally {
          setSubmitting(false);
        }
        return;
      }

      // Local scoring
      const score = Math.round((correctCount / Math.max(totalQuestions, 1)) * 100);
      applyLessonCompletion(score);
      const params = new URLSearchParams({
        score: String(score),
        total: String(totalQuestions),
        accepted: 'true',
      });
      // Store question review data for result page (lesson-specific, persists across revisits)
      try {
        localStorage.setItem(`quizReview::${lessonId}`, JSON.stringify({
          questions: questions.map(q => ({
            id: q.id,
            prompt: q.prompt,
            type: q.type,
            options: q.options,
            correctAnswer: q.correctAnswer,
          })),
          userAnswers: answerMap,
          questionResults: [],
        }));
      } catch { /* localStorage may be unavailable */ }
      router.push(`/lessons/${lessonId}/result?${params.toString()}`);
    },
    [
      applyLessonCompletion,
      correctCount,
      courseId,
      lessonId,
      questions,
      router,
      submitRemoteLesson,
      totalQuestions,
      usesRemoteVerification,
    ],
  );

  const handleCheck = useCallback(() => {
    if (!currentQuestion || !supportsLocalChecking) return;
    const correct = gradeCurrentAnswer();
    setIsCorrect(correct);
    setHasChecked(true);
    if (correct) setCorrectCount((c) => c + 1);
  }, [currentQuestion, gradeCurrentAnswer, supportsLocalChecking]);

  const handleAdvance = useCallback(async () => {
    if (!currentQuestion) return;
    const nextAnswers = buildAnswerMapWithCurrent();
    setSubmittedAnswers(nextAnswers);

    if (isLastQuestion) {
      await finalizeLesson(nextAnswers);
      return;
    }

    setCurrentQuestionIndex((i) => i + 1);
    setSelectedOption(null);
    setTextAnswer('');
    setHasChecked(false);
    setIsCorrect(false);
  }, [buildAnswerMapWithCurrent, currentQuestion, finalizeLesson, isLastQuestion]);

  const handleStartQuestions = useCallback(() => {
    const nextAttemptId = safeRandomUUID();
    const startedAt = new Date().toISOString();
    setAttemptId(nextAttemptId);
    setAttemptStartedAt(startedAt);
    setPhase('questions');
    syncLessonStart(nextAttemptId, startedAt);
  }, [syncLessonStart]);

  // Not found
  if (!lesson) {
    return (
      <CozyLessonShell>
        <div className="flex items-center justify-center min-h-[60vh]">
          <p
            className="text-sm font-pixel"
            style={{ color: T.textSecondary, textShadow: COZY_TEXT_SHADOW }}
          >
            Lesson not found
          </p>
        </div>
      </CozyLessonShell>
    );
  }

  // Recall phase — spaced retrieval before new lesson (delegated component)
  if (phase === 'recall' && recallData) {
    return (
      <CozyLessonShell>
        <RecallQuestion
          question={recallData.question}
          lessonTitle={recallData.lessonTitle}
          onComplete={() => setPhase('reading')}
        />
      </CozyLessonShell>
    );
  }

  // Reading phase — paginated sections
  if (phase === 'reading') {
    const currentBlock = hasBlocks ? sortedBlocks[sectionIndex] : null;

    return (
      <CozyLessonShell>
        {/* Lesson + section counter */}
        <div className="flex items-center justify-between mt-1">
          <p
            className="text-[11px] font-pixel-mono uppercase tracking-[1.5px]"
            style={{ color: T.textMuted, textShadow: COZY_TEXT_SHADOW }}
          >
            Lesson {lessonOrder} of {totalLessonsInCourse}
          </p>
          {hasBlocks && totalSections > 1 && (
            <p
              className="text-[11px] font-pixel-mono"
              style={{ color: AMBER, textShadow: COZY_TEXT_SHADOW }}
            >
              {sectionIndex + 1} / {totalSections}
            </p>
          )}
        </div>

        {/* Section progress bar */}
        {hasBlocks && totalSections > 1 && (
          <div className="mt-2">
            <CozyProgressBar progress={(sectionIndex + 1) / totalSections} />
          </div>
        )}

        {/* Title */}
        <h1
          className="text-2xl md:text-3xl font-bold tracking-wide mt-4 mb-0 font-pixel"
          style={{ color: AMBER, textShadow: COZY_TEXT_SHADOW }}
        >
          {lesson.title}
        </h1>

        {/* Single section content */}
        <div className="mt-4">
          <CozyCard>
            <div className="space-y-5 min-h-[40vh]">
              {hasBlocks && currentBlock ? (
                <LessonBlockRenderer block={currentBlock} />
              ) : (
                legacyContent.split('\n\n').map((paragraph, i) => (
                  <p
                    key={i}
                    className="text-[15px] leading-[22px] font-pixel"
                    style={{ color: T.textPrimary }}
                  >
                    {paragraph}
                  </p>
                ))
              )}
            </div>
          </CozyCard>
        </div>

        {/* Navigation */}
        <div className="mt-6 mb-8 flex gap-3 flex-wrap">
          {sectionIndex > 0 && hasBlocks && (
            <button
              type="button"
              onClick={() => setSectionIndex(sectionIndex - 1)}
              className="px-5 py-3 rounded-[10px] border text-[12px] font-pixel-mono font-bold uppercase tracking-[1.5px] transition-opacity hover:opacity-80 cursor-pointer"
              style={{
                color: AMBER,
                borderColor: COZY_BORDER,
                backgroundColor: 'rgba(14,14,28,0.5)',
                textShadow: COZY_TEXT_SHADOW,
              }}
            >
              Back
            </button>
          )}
          {/* Skip to Quiz — returning users / fast readers can bypass the
              remaining sections and go straight to the graded questions.
              Only shown when there's content left AND questions to skip to. */}
          {hasBlocks && !isLastSection && questions.length > 0 && (
            <button
              type="button"
              onClick={handleStartQuestions}
              className="px-5 py-3 rounded-[10px] border text-[12px] font-pixel-mono font-bold uppercase tracking-[1.5px] transition-opacity hover:opacity-80 cursor-pointer"
              style={{
                color: AMBER,
                borderColor: COZY_BORDER,
                backgroundColor: 'rgba(14,14,28,0.5)',
                textShadow: COZY_TEXT_SHADOW,
              }}
            >
              Skip to Quiz
            </button>
          )}
          <div className="flex-1 min-w-[140px]">
            {hasBlocks && !isLastSection ? (
              <CozyPrimary onClick={() => setSectionIndex(sectionIndex + 1)}>
                Next
              </CozyPrimary>
            ) : questions.length > 0 ? (
              <CozyPrimary onClick={handleStartQuestions}>
                Start Questions
              </CozyPrimary>
            ) : (
              <CozyPrimary
                onClick={() => {
                  applyLessonCompletion(100);
                  const params = new URLSearchParams({
                    score: '100',
                    total: '0',
                    accepted: 'true',
                  });
                  router.push(`/lessons/${lessonId}/result?${params.toString()}`);
                }}
              >
                Complete Lesson
              </CozyPrimary>
            )}
          </div>
        </div>
      </CozyLessonShell>
    );
  }

  // Questions phase
  const progressPercent =
    ((currentQuestionIndex + 1) / Math.max(totalQuestions, 1)) * 100;

  const isActionEnabled =
    supportsLocalChecking && !hasChecked
      ? canContinue
      : canContinue || (supportsLocalChecking && hasChecked);

  const isAdvanceDisabled =
    submitting || (!supportsLocalChecking && !canContinue);

  return (
    <CozyLessonShell>
      {/* Question header */}
      <div className="flex items-center gap-3 mt-2">
        {/* Exit button — diegetic X to bail on attempt (Hub button still in top-left) */}
        <button
          onClick={() => {
            if (confirm('Leave lesson? Your progress on this attempt will be lost.')) {
              router.back();
            }
          }}
          className="w-9 h-9 rounded-full flex items-center justify-center border transition-opacity hover:opacity-80 cursor-pointer"
          style={{
            backgroundColor: 'rgba(14,14,28,0.6)',
            borderColor: COZY_BORDER,
          }}
          aria-label="Exit lesson"
        >
          <span
            className="text-base font-pixel-mono font-bold"
            style={{ color: AMBER, textShadow: COZY_TEXT_SHADOW }}
          >
            {'✕'}
          </span>
        </button>

        <div className="flex-1 flex items-center justify-between">
          <span
            className="text-[11px] font-pixel-mono uppercase tracking-[1.5px]"
            style={{ color: AMBER, textShadow: COZY_TEXT_SHADOW }}
          >
            Question {currentQuestionIndex + 1} of {totalQuestions}
          </span>
          {usesRemoteVerification && (
            <span
              className="text-[10px] font-pixel-mono"
              style={{ color: T.textMuted, textShadow: COZY_TEXT_SHADOW }}
            >
              Scored on submit
            </span>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="mt-2">
        <CozyProgressBar progress={progressPercent / 100} />
      </div>

      {/* Question card */}
      <div className="mt-5">
        <CozyCard>
          {/* Prompt */}
          <h2
            className="text-[18px] md:text-xl font-bold leading-[26px] font-pixel"
            style={{ color: AMBER, textShadow: COZY_TEXT_SHADOW }}
          >
            {currentQuestion?.prompt}
          </h2>

          {/* MCQ options */}
          {currentQuestion?.type === 'mcq' && (
            <div className="mt-5 flex flex-col gap-3">
              {currentQuestion.options?.map((option) => {
                const optionId = typeof option === 'string' ? option : option.id;
                const optionText = typeof option === 'string' ? option : option.text;

                let borderColor = COZY_BORDER;
                let bgColor = 'rgba(14,14,28,0.55)';
                let glow = 'none';

                if (supportsLocalChecking && hasChecked && currentQuestion.correctAnswer) {
                  if (optionText === currentQuestion.correctAnswer) {
                    borderColor = T.green;
                    bgColor = 'rgba(62,230,138,0.10)';
                    glow = `0 0 12px ${T.green}40`;
                  } else if (
                    optionText === selectedOption &&
                    optionText !== currentQuestion.correctAnswer
                  ) {
                    borderColor = T.crimson;
                    bgColor = 'rgba(255,68,102,0.10)';
                    glow = `0 0 12px ${T.crimson}40`;
                  }
                } else if (optionText === selectedOption) {
                  borderColor = AMBER;
                  bgColor = `${AMBER}14`;
                  glow = `0 0 14px ${AMBER}40`;
                }

                return (
                  <button
                    key={optionId}
                    type="button"
                    onClick={() => {
                      if (!hasChecked || !supportsLocalChecking) {
                        setSelectedOption(optionText);
                      }
                    }}
                    disabled={supportsLocalChecking && hasChecked}
                    className="w-full text-left p-4 rounded-[10px] border transition-all duration-150 cursor-pointer hover:brightness-110"
                    style={{
                      borderColor,
                      backgroundColor: bgColor,
                      boxShadow: glow,
                    }}
                  >
                    <span
                      className="text-[14px] font-pixel"
                      style={{
                        color: T.textPrimary,
                        textShadow: COZY_TEXT_SHADOW,
                      }}
                    >
                      {optionText}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Short text input */}
          {currentQuestion?.type === 'short_text' && (
            <div className="mt-5">
              <input
                type="text"
                placeholder="Type your answer..."
                value={textAnswer}
                onChange={(e) => {
                  if (!hasChecked || !supportsLocalChecking) {
                    setTextAnswer(e.target.value);
                  }
                }}
                onFocus={() => setInputFocused(true)}
                onBlur={() => setInputFocused(false)}
                readOnly={supportsLocalChecking && hasChecked}
                className="w-full p-4 rounded-[10px] border text-[14px] outline-none transition-all duration-150"
                style={{
                  backgroundColor: 'rgba(0,0,0,0.30)',
                  borderColor:
                    supportsLocalChecking && hasChecked
                      ? isCorrect
                        ? T.green
                        : T.crimson
                      : inputFocused
                        ? AMBER
                        : COZY_BORDER,
                  color: T.textPrimary,
                  fontFamily: 'var(--font-pixel-mono), monospace',
                  boxShadow: inputFocused ? `0 0 14px ${AMBER}33` : 'none',
                }}
              />
              {supportsLocalChecking && hasChecked && !isCorrect && currentQuestion.correctAnswer && (
                <p className="mt-2 text-[12px] font-pixel" style={{ color: T.textSecondary }}>
                  Correct answer:{' '}
                  <span className="font-bold" style={{ color: T.green }}>
                    {currentQuestion.correctAnswer}
                  </span>
                </p>
              )}
            </div>
          )}

          {/* Local check feedback */}
          {supportsLocalChecking && hasChecked && (
            <p
              className="mt-4 text-[14px] font-bold font-pixel"
              style={{
                color: isCorrect ? T.green : T.crimson,
                textShadow: COZY_TEXT_SHADOW,
              }}
            >
              {isCorrect ? 'Correct!' : 'Incorrect'}
            </p>
          )}

          {/* Remote verification info */}
          {usesRemoteVerification && (
            <p
              className="mt-4 text-[11px] font-pixel-mono"
              style={{ color: T.textMuted }}
            >
              Answers are verified by the lesson API after you finish the lesson.
            </p>
          )}
        </CozyCard>
      </div>

      {/* Error message */}
      {error && (
        <p
          className="mt-3 text-[13px] font-pixel"
          style={{ color: T.crimson, textShadow: COZY_TEXT_SHADOW }}
        >
          {error}
        </p>
      )}

      {/* Action button */}
      <div className="mt-5 mb-8">
        {supportsLocalChecking && !hasChecked ? (
          <CozyPrimary onClick={handleCheck} disabled={!canContinue}>
            {currentQuestion?.type === 'mcq' ? 'Check Answer' : 'Submit'}
          </CozyPrimary>
        ) : (
          <CozyPrimary
            onClick={() => void handleAdvance()}
            disabled={isAdvanceDisabled || !isActionEnabled}
          >
            {submitting
              ? 'Submitting...'
              : isLastQuestion
                ? 'See Results'
                : 'Next Question'}
          </CozyPrimary>
        )}
      </div>
    </CozyLessonShell>
  );
}
