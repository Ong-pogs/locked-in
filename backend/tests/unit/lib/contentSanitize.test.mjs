import { describe, expect, it } from 'vitest';
import { sanitizeLessonPayload } from '../../../src/modules/content/repository.mjs';

const lessonWithAnswers = {
  id: 'lesson-1',
  title: 'Wallets',
  questions: [
    {
      id: 'q1',
      questionType: 'mcq',
      prompt: 'What is a keypair?',
      correctAnswer: 'A public and private key',
      options: [{ id: 'o1', text: 'A public and private key' }],
    },
    {
      id: 'q2',
      questionType: 'short_text',
      prompt: 'Explain custody.',
      correctAnswer: 'You control the private key',
      metadata: { expectedTokens: ['private', 'key'] },
    },
  ],
};

describe('sanitizeLessonPayload', () => {
  it('strips correctAnswer from every question', () => {
    const sanitized = sanitizeLessonPayload(lessonWithAnswers);
    for (const question of sanitized.questions) {
      expect(question).not.toHaveProperty('correctAnswer');
    }
  });

  it('strips grader hints (expectedTokens) from question metadata', () => {
    const sanitized = sanitizeLessonPayload(lessonWithAnswers);
    const shortText = sanitized.questions.find((q) => q.id === 'q2');
    expect(shortText.metadata).not.toHaveProperty('expectedTokens');
  });

  it('preserves prompt, options, and question identity', () => {
    const sanitized = sanitizeLessonPayload(lessonWithAnswers);
    const mcq = sanitized.questions.find((q) => q.id === 'q1');
    expect(mcq.prompt).toBe('What is a keypair?');
    expect(mcq.options).toEqual([{ id: 'o1', text: 'A public and private key' }]);
    expect(sanitized.title).toBe('Wallets');
  });

  it('does not mutate the source payload', () => {
    sanitizeLessonPayload(lessonWithAnswers);
    expect(lessonWithAnswers.questions[0].correctAnswer).toBe('A public and private key');
  });

  it('hashes the sanitized payload, not the raw one', () => {
    const sanitized = sanitizeLessonPayload(lessonWithAnswers);
    expect(sanitized.contentHash).toEqual(expect.any(String));

    // MCQ option text may legitimately match the answer — what must never ship
    // is the key naming *which* option is correct, or the grader's hint tokens.
    const serialized = JSON.stringify(sanitized);
    expect(serialized).not.toContain('correctAnswer');
    expect(serialized).not.toContain('expectedTokens');
    expect(serialized).not.toContain('You control the private key');
  });

  it('passes through non-object payloads untouched', () => {
    expect(sanitizeLessonPayload(null)).toBeNull();
    expect(sanitizeLessonPayload('nope')).toBe('nope');
  });

  it('handles payloads with no questions array', () => {
    const sanitized = sanitizeLessonPayload({ id: 'l2', title: 'Intro' });
    expect(sanitized.title).toBe('Intro');
    expect(sanitized.contentHash).toEqual(expect.any(String));
  });
});
