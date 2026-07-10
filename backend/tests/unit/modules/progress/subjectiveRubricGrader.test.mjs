import { describe, expect, it } from 'vitest';
import { evaluateSubjectiveAnswer } from '../../../../src/modules/progress/repository.mjs';

// When the LLM grader is off (default on prod), short-text answers must still
// grade via the deterministic rubric (keyword match built from the answer
// key) — NOT hard-fail with "grader unavailable". This is the grader
// gradeAnswers() falls back to.

const q = (correctAnswer, prompt = 'Q') => ({
  id: 'q1',
  questionType: 'short_text',
  prompt,
  correctAnswer,
  metadata: {},
});

describe('evaluateSubjectiveAnswer (rubric fallback, no LLM)', () => {
  it('accepts an answer that covers the key concepts', async () => {
    const r = await evaluateSubjectiveAnswer(
      q('SOL is the fuel that pays gas transaction fees and fluctuates while USDC is a stable dollar always one'),
      'SOL is the gas token whose price fluctuates and pays transaction fees; USDC is a stable dollar that is always one',
      null,
      null,
    );
    expect(r.accepted).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(70);
  });

  it('rejects gibberish (the JJJJ case that blocked testing)', async () => {
    const r = await evaluateSubjectiveAnswer(q('Program Derived Address'), 'JJJJJJJ', null, null);
    expect(r.accepted).toBe(false);
  });

  it('rejects an empty answer', async () => {
    const r = await evaluateSubjectiveAnswer(q('Program Derived Address'), '   ', null, null);
    expect(r.accepted).toBe(false);
  });

  it('short exact-answer questions accept the exact match', async () => {
    const r = await evaluateSubjectiveAnswer(q('CPI'), 'CPI', null, null);
    expect(r.accepted).toBe(true);
  });

  it('never returns the "grader unavailable" message (that is the LLM path)', async () => {
    const r = await evaluateSubjectiveAnswer(q('Program Derived Address'), 'a program derived address', null, null);
    expect(JSON.stringify(r)).not.toContain('grader is unavailable');
  });

  it('gives PARTIAL credit for a half-right answer (chill grading)', async () => {
    // Answer key has ~7 key concepts; an answer covering roughly half should
    // score partial (not 0, not 100) so it contributes to the lesson total.
    const r = await evaluateSubjectiveAnswer(
      q('SOL is the fuel token whose price fluctuates while USDC is a stable dollar pegged to one'),
      'SOL is the fuel token and its price fluctuates',
      null,
      null,
    );
    expect(r.score).toBeGreaterThan(0);
    expect(r.score).toBeLessThan(100);
  });
});
