import { describe, expect, it } from 'vitest';
import { buildQuestionResults } from '../../../src/modules/progress/repository.mjs';

// Regression for the hotfix follow-up: once correctAnswer stopped shipping in
// the lesson payload, the result page relied on the submit response's
// questionResults — which previously filtered to subjective (validatorResult)
// questions only, dropping every MCQ. buildQuestionResults must include ALL
// questions with isCorrect and the revealed correctAnswer.

const mcq = {
  questionId: 'q-mcq',
  prompt: 'What is a keypair?',
  answerText: 'A public and private key',
  isCorrect: true,
  correctAnswer: 'A public and private key',
  validatorResult: null,
};

const subjective = {
  questionId: 'q-text',
  prompt: 'Explain custody.',
  answerText: 'I hold the key',
  isCorrect: false,
  correctAnswer: 'You control the private key',
  validatorResult: {
    accepted: false,
    score: 40,
    feedbackSummary: 'Close, mention the private key.',
    validatorVersion: 'v1',
    decisionHash: 'abc',
  },
};

describe('buildQuestionResults', () => {
  it('includes MCQ questions (the ones the old filter dropped)', () => {
    const results = buildQuestionResults([mcq, subjective]);
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.questionId)).toContain('q-mcq');
  });

  it('carries isCorrect and the revealed correctAnswer for MCQ', () => {
    const [mcqResult] = buildQuestionResults([mcq]);
    expect(mcqResult.isCorrect).toBe(true);
    expect(mcqResult.correctAnswer).toBe('A public and private key');
    expect(mcqResult.accepted).toBe(true); // falls back to isCorrect
    expect(mcqResult.score).toBeNull();
  });

  it('preserves the subjective validator fields', () => {
    const [textResult] = buildQuestionResults([subjective]);
    expect(textResult.isCorrect).toBe(false);
    expect(textResult.accepted).toBe(false);
    expect(textResult.score).toBe(40);
    expect(textResult.feedbackSummary).toBe('Close, mention the private key.');
    expect(textResult.correctAnswer).toBe('You control the private key');
  });

  it('tolerates a missing correctAnswer', () => {
    const [r] = buildQuestionResults([{ ...mcq, correctAnswer: undefined }]);
    expect(r.correctAnswer).toBeNull();
  });
});
