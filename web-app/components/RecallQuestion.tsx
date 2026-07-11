'use client';

import { useState } from 'react';
import type { Question } from '@/types';
import { T } from './theme';

const AMBER = '#FFD580';
const GREEN = '#3EE68A';
const CRIMSON = '#FF4466';
const COZY_BORDER = 'rgba(58, 143, 168, 0.5)';

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

interface RecallQuestionProps {
  question: Question;
  lessonTitle: string;
  onComplete: () => void;
}

/**
 * Spaced-retrieval recall shown before a new lesson. Not graded (doesn't affect
 * the lesson score). We DO give a right/wrong read when the answer key is
 * present in the payload — reinforcement lands better with feedback. In prod
 * the backend omits the key, so we fall back to "you picked X, continue".
 */
export function RecallQuestion({ question, lessonTitle, onComplete }: RecallQuestionProps) {
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [textAnswer, setTextAnswer] = useState('');
  const [revealed, setRevealed] = useState(false);

  const isMcq = question.type === 'mcq';
  const correct = (question as { correctAnswer?: string }).correctAnswer ?? null;
  const hasKey = Boolean(correct);

  const isOptionCorrect = (optId: string, optText: string) =>
    hasKey && (normalize(optId) === normalize(correct!) || normalize(optText) === normalize(correct!));

  const answeredCorrectly =
    hasKey && selectedOption != null
      ? // reveal uses the option currently selected
        (question.options ?? []).some((o) => {
          const id = typeof o === 'string' ? o : o.id;
          const text = typeof o === 'string' ? o : o.text;
          return id === selectedOption && isOptionCorrect(id, text);
        })
      : false;

  const hasSelection =
    (isMcq && Boolean(selectedOption)) || (!isMcq && textAnswer.trim().length > 0);

  const pickMcq = (optId: string) => {
    if (revealed) return; // lock after reveal
    setSelectedOption(optId);
    if (hasKey) setRevealed(true);
  };

  return (
    <div className="min-h-[70vh] flex flex-col items-center justify-center px-4 py-10">
      {/* Solid backdrop so the content reads over the dark library art. */}
      <div
        className="w-full max-w-xl rounded-2xl border"
        style={{
          backgroundColor: 'rgba(10,10,20,0.9)',
          borderColor: COZY_BORDER,
          boxShadow: '0 24px 60px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,213,128,0.08)',
          padding: 28,
        }}
      >
        {/* Header */}
        <div className="flex items-center gap-2 mb-1.5">
          <span aria-hidden style={{ fontSize: 16 }}>🧠</span>
          <span
            className="font-pixel-mono text-[12px] uppercase tracking-[2.5px] font-bold"
            style={{ color: AMBER, textShadow: '0 1px 2px rgba(0,0,0,0.85)' }}
          >
            Quick Recall
          </span>
        </div>
        <p className="text-[13px] font-pixel-mono mb-6" style={{ color: T.textMutedStrong }}>
          A quick refresher from <span style={{ color: AMBER }}>{lessonTitle}</span> — not graded.
        </p>

        {/* Prompt — larger, high-contrast */}
        <p
          className="font-pixel leading-[26px] mb-5"
          style={{ color: T.textPrimary, fontSize: 19, textShadow: '0 1px 2px rgba(0,0,0,0.7)' }}
        >
          {question.prompt}
        </p>

        {/* MCQ options */}
        {isMcq && question.options && (
          <div className="flex flex-col gap-3">
            {question.options.map((opt) => {
              const optText = typeof opt === 'string' ? opt : opt.text;
              const optId = typeof opt === 'string' ? opt : opt.id;
              const isSelected = selectedOption === optId;
              const optCorrect = isOptionCorrect(optId, optText);

              let borderColor = isSelected ? AMBER : COZY_BORDER;
              let bgColor = isSelected ? 'rgba(255,213,128,0.12)' : 'rgba(20,20,36,0.7)';
              let mark = '';
              if (revealed) {
                if (optCorrect) {
                  borderColor = GREEN;
                  bgColor = 'rgba(62,230,138,0.14)';
                  mark = '✓';
                } else if (isSelected) {
                  borderColor = CRIMSON;
                  bgColor = 'rgba(255,68,102,0.14)';
                  mark = '✕';
                }
              }

              return (
                <button
                  key={optId}
                  onClick={() => pickMcq(optId)}
                  disabled={revealed}
                  aria-label={optText}
                  className="w-full text-left px-4 py-3.5 rounded-xl border font-pixel transition-colors flex items-center justify-between gap-3"
                  style={{
                    borderColor,
                    backgroundColor: bgColor,
                    color: T.textPrimary,
                    fontSize: 15,
                    cursor: revealed ? 'default' : 'pointer',
                  }}
                >
                  <span>{optText}</span>
                  {mark && (
                    <span style={{ color: mark === '✓' ? GREEN : CRIMSON, fontSize: 16, fontWeight: 700 }}>
                      {mark}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Short text */}
        {!isMcq && (
          <textarea
            value={textAnswer}
            onChange={(e) => setTextAnswer(e.target.value)}
            placeholder="Type your answer…"
            rows={3}
            className="w-full px-4 py-3 rounded-xl border font-pixel-mono outline-none resize-none"
            style={{
              backgroundColor: 'rgba(0,0,0,0.35)',
              borderColor: textAnswer.trim().length > 0 ? AMBER : COZY_BORDER,
              color: T.textPrimary,
              fontSize: 14,
            }}
          />
        )}

        {/* Feedback line (only when we have the key) */}
        {revealed && hasKey && (
          <p
            className="mt-4 font-pixel-mono text-[13px]"
            style={{ color: answeredCorrectly ? GREEN : CRIMSON }}
          >
            {answeredCorrectly ? '✓ Correct — nice recall.' : `✕ Not quite. The answer is: ${correct}`}
          </p>
        )}

        {/* Continue */}
        <button
          type="button"
          onClick={onComplete}
          disabled={!hasSelection}
          className="mt-6 w-full py-3.5 rounded-xl text-center font-bold uppercase tracking-[1.5px] font-pixel text-[13px] transition-colors"
          style={{
            border: `1px solid ${hasSelection ? AMBER : COZY_BORDER}`,
            background: hasSelection ? 'rgba(255,213,128,0.14)' : 'transparent',
            color: hasSelection ? AMBER : T.textMuted,
            boxShadow: hasSelection ? `0 0 14px ${AMBER}55` : 'none',
            opacity: hasSelection ? 1 : 0.45,
            cursor: hasSelection ? 'pointer' : 'not-allowed',
          }}
        >
          Continue to Lesson
        </button>
      </div>
    </div>
  );
}
