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

  const isMcq = question.type === 'mcq';

  // Recall is spaced-retrieval, not graded. Backend deliberately omits the
  // answer key from the cached lesson payload, so we can't verify locally.
  // The interaction is therefore: pick an answer (engages memory), then
  // continue. No fake "Check Answer" step, no green/red theater. If the
  // payload does ship correctAnswer (local dev / mocks), we still don't
  // grade — keeping the flow consistent everywhere.
  const hasSelection =
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
                const borderColor = isSelected ? AMBER : COZY_BORDER;
                const bgColor = isSelected
                  ? 'rgba(255,213,128,0.10)'
                  : 'rgba(14,14,28,0.30)';
                const glow = isSelected ? `0 0 10px ${AMBER}55` : 'none';

                return (
                  <button
                    key={optId}
                    onClick={() => setSelectedOption(optId)}
                    aria-label={optText}
                    className="w-full text-left px-4 py-3 rounded-lg border text-[13px] font-pixel transition-colors cursor-pointer"
                    style={{
                      borderColor,
                      backgroundColor: bgColor,
                      boxShadow: glow,
                      color: T.textPrimary,
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
              onChange={(e) => setTextAnswer(e.target.value)}
              placeholder="Type your answer..."
              rows={3}
              className="w-full px-4 py-3 rounded-lg border text-[13px] font-pixel-mono outline-none resize-none"
              style={{
                backgroundColor: 'rgba(0,0,0,0.30)',
                borderColor: textAnswer.trim().length > 0 ? AMBER : COZY_BORDER,
                color: T.textPrimary,
              }}
            />
          )}
        </CozyCard>

        {/* Action button — always Continue. Disabled until an answer is
            selected. Recall isn't graded, so there's no Check step. */}
        <div className="mt-4">
          <CozyPrimary onClick={onComplete} disabled={!hasSelection}>
            Continue to Lesson
          </CozyPrimary>
        </div>

        <p className="text-center text-[10px] mt-2 font-pixel-mono" style={{ color: T.textMuted }}>
          Recall questions help strengthen your memory — they don&apos;t affect your score.
        </p>
      </div>
    </div>
  );
}
