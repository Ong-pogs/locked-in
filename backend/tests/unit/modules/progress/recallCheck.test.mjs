import { describe, expect, it } from 'vitest';
import { gradeRecallAnswer } from '../../../../src/modules/progress/repository.mjs';

// Stateless recall grading (pre-lesson "Quick Recall"). Prod payloads strip
// the answer key (integrity fix), so the client can't grade locally — the
// recall-check endpoint grades server-side WITHOUT creating/locking any
// attempt state. MCQ only; matching mirrors checkQuestionAnswer's
// normalizeAnswerText semantics (trim, collapse whitespace, lowercase).

const mcq = {
  questionType: 'mcq',
  correctAnswer: 'A shared record book maintained by thousands of computers',
};

describe('gradeRecallAnswer', () => {
  it('accepts the exact correct answer', () => {
    const verdict = gradeRecallAnswer(mcq, 'A shared record book maintained by thousands of computers');
    expect(verdict.isCorrect).toBe(true);
    expect(verdict.correctAnswer).toBe(mcq.correctAnswer);
  });

  it('normalizes case and whitespace before comparing', () => {
    const verdict = gradeRecallAnswer(mcq, '  a SHARED record  book maintained by thousands of computers ');
    expect(verdict.isCorrect).toBe(true);
  });

  it('rejects a wrong answer and still reveals the correct one', () => {
    const verdict = gradeRecallAnswer(mcq, 'A company that stores your money online');
    expect(verdict.isCorrect).toBe(false);
    expect(verdict.correctAnswer).toBe(mcq.correctAnswer);
  });

  it('rejects empty/whitespace answers', () => {
    expect(gradeRecallAnswer(mcq, '   ').isCorrect).toBe(false);
  });

  it('refuses non-MCQ questions (unsupported: null verdict, no key leak)', () => {
    const shortText = { questionType: 'short_text', correctAnswer: 'secret rubric anchor' };
    const verdict = gradeRecallAnswer(shortText, 'anything');
    expect(verdict).toBeNull();
  });

  it('refuses an MCQ with no stored key rather than guessing', () => {
    expect(gradeRecallAnswer({ questionType: 'mcq', correctAnswer: null }, 'x')).toBeNull();
  });
});
