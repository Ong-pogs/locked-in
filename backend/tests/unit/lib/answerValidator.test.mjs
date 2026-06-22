import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadValidatorWithEnv(overrides = {}) {
  vi.resetModules();
  const previous = { ...process.env };
  Object.assign(process.env, {
    ANSWER_VALIDATOR_HYBRID_ENABLED: 'true',
    OPENAI_API_KEY: 'test-key',
    OPENAI_RESPONSES_BASE_URL: 'https://api.openai.test/v1',
    OPENAI_VALIDATOR_MODEL: 'gpt-5-nano',
    OPENAI_VALIDATOR_TIMEOUT_MS: '4000',
    ...overrides,
  });
  const module = await import('../../../src/lib/answerValidator.mjs');
  process.env = previous;
  return module;
}

describe('gradeSubjectiveAnswerWithLlm', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('accepts a non-MCQ answer when the LLM grader returns a passing structured decision', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        output_text: JSON.stringify({
          accepted: true,
          score: 90,
          criteriaBreakdown: [
            {
              criterionId: 'core-concept',
              label: 'Core concept',
              passed: true,
              score: 90,
              reason: 'Explains that a PDA is controlled by a program, not a private key.',
            },
          ],
          feedbackSummary: 'Good answer. It captures program-owned address derivation.',
          confidence: 0.92,
        }),
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { gradeSubjectiveAnswerWithLlm } = await loadValidatorWithEnv();
    const result = await gradeSubjectiveAnswerWithLlm({
      question: {
        id: 'q1',
        questionType: 'short_text',
        prompt: 'What does PDA stand for on Solana?',
        correctAnswer: 'Program Derived Address',
        metadata: {},
      },
      answerText: 'A program derived address controlled by a Solana program.',
      startedAt: '2026-06-23T00:00:00.000Z',
      completedAt: '2026-06-23T00:00:05.000Z',
    });

    expect(result.accepted).toBe(true);
    expect(result.score).toBe(90);
    expect(result.validatorMode).toBe('llm_v1');
    expect(result.validatorVersion).toBe('llm-v1:gpt-5-nano');
    expect(result.decisionHash).toMatch(/^[a-f0-9]{64}$/);
    expect(fetchMock).toHaveBeenCalledOnce();
    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(requestBody.reasoning).toEqual({ effort: 'minimal' });
    expect(requestBody.max_output_tokens).toBeGreaterThanOrEqual(1000);
  });

  it('fails closed when LLM grading is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn());

    const { gradeSubjectiveAnswerWithLlm } = await loadValidatorWithEnv({
      OPENAI_API_KEY: '',
    });
    const result = await gradeSubjectiveAnswerWithLlm({
      question: {
        id: 'q1',
        questionType: 'short_text',
        prompt: 'What does PDA stand for on Solana?',
        correctAnswer: 'Program Derived Address',
        metadata: {},
      },
      answerText: 'Program derived address.',
      startedAt: '2026-06-23T00:00:00.000Z',
      completedAt: '2026-06-23T00:00:05.000Z',
    });

    expect(result.accepted).toBe(false);
    expect(result.score).toBe(0);
    expect(result.validatorMode).toBe('llm_unavailable');
    expect(result.feedbackSummary).toContain('AI grader is unavailable');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fails closed when the LLM grader returns malformed structured output', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        output_text: JSON.stringify({
          accepted: true,
          score: 'high',
          criteriaBreakdown: [],
          feedbackSummary: 'Looks fine.',
          confidence: 0.9,
        }),
      }),
    })));

    const { gradeSubjectiveAnswerWithLlm } = await loadValidatorWithEnv();
    const result = await gradeSubjectiveAnswerWithLlm({
      question: {
        id: 'q1',
        questionType: 'short_text',
        prompt: 'What does PDA stand for on Solana?',
        correctAnswer: 'Program Derived Address',
        metadata: {},
      },
      answerText: 'Program derived address.',
      startedAt: '2026-06-23T00:00:00.000Z',
      completedAt: '2026-06-23T00:00:05.000Z',
    });

    expect(result.accepted).toBe(false);
    expect(result.score).toBe(0);
    expect(result.validatorMode).toBe('llm_unavailable');
  });
});
