'use client';

import { useState } from 'react';
import type { Question } from '@/types';
import { T } from './theme';
import { CozyCard } from './cozy';

const AMBER = '#FFD580';
const COZY_BORDER = 'rgba(58, 143, 168, 0.45)';

function CozyPrimary({
  children,
  onClick,
  disabled,
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
      className="w-full py-3 rounded-lg text-center font-bold uppercase tracking-[1.5px] font-pixel text-[12px] transition-colors"
      style={{
        border: `1px solid ${disabled ? COZY_BORDER : AMBER}`,
        background: disabled ? 'transparent' : 'rgba(255,213,128,0.12)',
        color: disabled ? T.textMuted : AMBER,
        boxShadow: disabled ? 'none' : `0 0 12px ${AMBER}55`,
        opacity: disabled ? 0.4 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {children}
    </button>
  );
}

interface RecallQuestionProps {
  question: Question;
  lessonTitle: string;
  onComplete: () => void;
}

/**
 * Spaced-retrieval recall question shown before starting a new lesson.
 * Tests the user on a random question from a previously completed lesson.
 * Not graded — purely for retention reinforcement.
 */
export function RecallQuestion({ question, lessonTitle, onComplete }: RecallQuestionProps) {
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [textAnswer, setTextAnswer] = useState('');
  const [hasChecked, setHasChecked] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);

  const isMcq = question.type === 'mcq';

  // Recall questions aren't graded — they're spaced-retrieval reminders,
  // explicitly not scored. The cached lesson payload omits `correctAnswer`
  // (security: don't ship the answer key to the client), so when it's
  // missing we just treat any submission as "you engaged, well done" and
  // move on. When it IS present, we still show correct/incorrect feedback
  // so the learner gets useful confirmation.
  const hasAnswerKey = typeof question.correctAnswer === 'string' && question.correctAnswer.length > 0;

  const handleCheck = () => {
    if (!hasAnswerKey) {
      // No grading possible — answer key isn't shipped to the client.
      // Don't claim correct or wrong; just acknowledge and continue.
      setHasChecked(true);
      return;
    }
    if (isMcq) {
      // correctAnswer may be option text OR option id — check both
      const selected = question.options?.find((opt) => {
        const id = typeof opt === 'string' ? opt : opt.id;
        return id === selectedOption;
      });
      const selectedId = selected ? (typeof selected === 'string' ? selected : selected.id) : '';
      const selectedText = selected ? (typeof selected === 'string' ? selected : selected.text) : '';
      const correct = selectedText === question.correctAnswer || selectedId === question.correctAnswer;
      setIsCorrect(correct);
    } else {
      // Simple keyword check for short_text (client-side approximation)
      const answer = textAnswer.trim().toLowerCase();
      const keywords = (question.correctAnswer ?? '').toLowerCase().split(/\s+/);
      const matchCount = keywords.filter((kw) => answer.includes(kw)).length;
      setIsCorrect(matchCount >= Math.ceil(keywords.length * 0.5));
    }
    setHasChecked(true);
  };

  const canCheck =
    (isMcq && Boolean(selectedOption)) ||
    (!isMcq && textAnswer.trim().length > 0);

  return (
    <div className="min-h-[60vh] md:min-h-[80vh] flex flex-col items-center justify-center px-6">
      {/* Header */}
      <div className="text-center mb-6">
        <div className="flex items-center justify-center gap-2 mb-3">
          <svg viewBox="0 0 20 20" width={18} height={18} fill="none">
            <path
              d="M10 2C5.58 2 2 5.58 2 10s3.58 8 8 8 8-3.58 8-8-3.58-8-8-8zm0 14.4A6.4 6.4 0 1110 3.6a6.4 6.4 0 010 12.8z"
              fill="rgba(212,160,74,0.3)"
            />
            <path
              d="M9 7h2v2H9V7zm0 4h2v4H9v-4z"
              fill="#D4A04A"
            />
          </svg>
          <span
            className="font-pixel-mono text-[10px] uppercase tracking-[2px] font-bold"
            style={{ color: AMBER, textShadow: '0 1px 2px rgba(0,0,0,0.85)' }}
          >
            Quick Recall
          </span>
        </div>
        <p className="text-[13px] font-pixel" style={{ color: T.textSecondary }}>
          Before we continue, let&apos;s revisit something from{' '}
          <span style={{ color: AMBER, textShadow: '0 1px 2px rgba(0,0,0,0.85)' }}>{lessonTitle}</span>
        </p>
      </div>

      {/* Question card */}
      <div className="w-full max-w-lg">
        <CozyCard style={{ padding: 20 }}>
          {/* Prompt */}
          <p
            className="text-[15px] font-semibold font-pixel leading-[22px] mb-4"
            style={{ color: T.textPrimary }}
          >
            {question.prompt}
          </p>

          {/* MCQ Options */}
          {isMcq && question.options && (
            <div className="flex flex-col gap-2.5">
              {question.options.map((opt) => {
                const optText = typeof opt === 'string' ? opt : opt.text;
                const optId = typeof opt === 'string' ? opt : opt.id;
                const isSelected = selectedOption === optId;
                const showResult = hasChecked;
                const isCorrectOption = optText === question.correctAnswer || optId === question.correctAnswer;

                let borderColor = COZY_BORDER;
                let bgColor = 'rgba(14,14,28,0.30)';
                let glow = 'none';
                // Only color-code correct/incorrect when we actually have an
                // answer key. Otherwise just keep amber selection styling.
                if (showResult && hasAnswerKey && isCorrectOption) {
                  borderColor = T.green;
                  bgColor = `${T.green}10`;
                  glow = `0 0 12px ${T.green}55`;
                } else if (showResult && hasAnswerKey && isSelected && !isCorrectOption) {
                  borderColor = T.crimson;
                  bgColor = `${T.crimson}10`;
                  glow = `0 0 12px ${T.crimson}55`;
                } else if (isSelected) {
                  borderColor = AMBER;
                  bgColor = 'rgba(255,213,128,0.10)';
                  glow = `0 0 10px ${AMBER}55`;
                }

                return (
                  <button
                    key={optId}
                    onClick={() => !hasChecked && setSelectedOption(optId)}
                    disabled={hasChecked}
                    aria-label={optText}
                    className="w-full text-left px-4 py-3 rounded-lg border text-[13px] font-pixel transition-colors"
                    style={{
                      borderColor,
                      backgroundColor: bgColor,
                      boxShadow: glow,
                      color: T.textPrimary,
                      opacity: hasChecked && !isSelected && !isCorrectOption ? 0.4 : 1,
                    }}
                  >
                    {optText}
                  </button>
                );
              })}
            </div>
          )}

          {/* Short text input */}
          {!isMcq && (
            <textarea
              value={textAnswer}
              onChange={(e) => !hasChecked && setTextAnswer(e.target.value)}
              disabled={hasChecked}
              placeholder="Type your answer..."
              rows={3}
              className="w-full px-4 py-3 rounded-lg border text-[13px] font-pixel-mono outline-none resize-none"
              style={{
                backgroundColor: 'rgba(0,0,0,0.30)',
                borderColor: hasChecked
                  ? isCorrect ? T.green : T.crimson
                  : COZY_BORDER,
                color: T.textPrimary,
              }}
            />
          )}

          {/* Result feedback */}
          {hasChecked && (
            <div
              className="mt-3 px-4 py-2.5 rounded-lg text-[12px] font-semibold font-pixel"
              style={{
                backgroundColor: !hasAnswerKey
                  ? 'rgba(255,213,128,0.08)'
                  : isCorrect
                    ? `${T.green}10`
                    : `${T.crimson}10`,
                border: `1px solid ${
                  !hasAnswerKey ? AMBER : isCorrect ? T.green : T.crimson
                }55`,
                color: !hasAnswerKey ? AMBER : isCorrect ? T.green : T.crimson,
                textShadow: '0 1px 2px rgba(0,0,0,0.85)',
              }}
            >
              {hasAnswerKey
                ? isCorrect
                  ? 'Correct! Great recall.'
                  : "Not quite — but that's okay, that's why we review."
                : "Recall locked in. The lesson will refresh the answer for you."}
            </div>
          )}
        </CozyCard>

        {/* Action button */}
        <div className="mt-4">
          {!hasChecked ? (
            <CozyPrimary onClick={handleCheck} disabled={!canCheck}>
              Check Answer
            </CozyPrimary>
          ) : (
            <CozyPrimary onClick={onComplete}>
              Continue to Lesson
            </CozyPrimary>
          )}
        </div>

        <p className="text-center text-[10px] mt-2 font-pixel-mono" style={{ color: T.textMuted }}>
          Recall questions help strengthen your memory — they don&apos;t affect your score.
        </p>
      </div>
    </div>
  );
}
