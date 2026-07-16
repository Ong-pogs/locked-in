import { createHash } from 'node:crypto';
import { appConfig } from '../config.mjs';

const LLM_ACCEPTANCE_THRESHOLD = 70;
const LLM_VALIDATOR_VERSION = 'llm-v1';

function getResponseText(payload) {
  if (typeof payload?.output_text === 'string' && payload.output_text.length > 0) {
    return payload.output_text;
  }

  if (!Array.isArray(payload?.output)) {
    return null;
  }

  for (const item of payload.output) {
    if (!Array.isArray(item?.content)) {
      continue;
    }

    for (const content of item.content) {
      if (content?.type === 'output_text' && typeof content?.text === 'string') {
        return content.text;
      }
    }
  }

  return null;
}

function hasLlmGraderConfig() {
  return Boolean(
    appConfig.openaiApiKey &&
      appConfig.openaiResponsesBaseUrl &&
      appConfig.openaiValidatorModel,
  );
}

function getAcceptThreshold(question) {
  const threshold = Number(question.metadata?.validator?.acceptThreshold);
  return Number.isFinite(threshold) ? threshold : LLM_ACCEPTANCE_THRESHOLD;
}

function buildIntegrityFlags(answerText, startedAt, completedAt) {
  const flags = [];
  const trimmed = answerText.trim();

  if (trimmed.length > 1000) {
    flags.push({
      code: 'ANSWER_TOO_LONG',
      severity: 'block',
      message: 'Answer exceeded the allowed validator length.',
    });
  }

  if (startedAt && completedAt) {
    const started = new Date(startedAt).getTime();
    const completed = new Date(completedAt).getTime();
    const durationMs = completed - started;
    // durationMs === 0 means the attempt was CREATED at submit time (its
    // /start never landed, so startedAt was stamped equal to completedAt) —
    // the duration is unmeasurable, not "impossibly fast". Guard with `> 0`
    // so a legitimate no-prior-start submit of a long answer isn't auto-failed.
    if (Number.isFinite(durationMs) && durationMs > 0 && durationMs < 2000 && trimmed.length > 40) {
      flags.push({
        code: 'IMPOSSIBLE_SPEED',
        severity: 'block',
        message: 'Answer arrived too quickly for its length.',
      });
    }
  }

  return flags;
}

function buildRubricSnapshot(question) {
  return {
    mode: 'llm_v1',
    acceptThreshold: getAcceptThreshold(question),
    prompt: question.prompt,
    expectedAnswer: question.correctAnswer,
    validator: question.metadata?.validator ?? null,
  };
}

function buildValidatorDecisionHash(questionId, answerText, validatorResult) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        questionId,
        answerText,
        accepted: validatorResult.accepted,
        score: validatorResult.score,
        validatorMode: validatorResult.validatorMode,
        validatorVersion: validatorResult.validatorVersion,
        criteriaBreakdown: validatorResult.criteriaBreakdown,
        integrityFlags: validatorResult.integrityFlags,
        feedbackSummary: validatorResult.feedbackSummary,
        confidence: validatorResult.confidence,
      }),
    )
    .digest('hex');
}

function failClosedDecision(question, answerText, reason, integrityFlags = []) {
  const validatorResult = {
    accepted: false,
    score: 0,
    criteriaBreakdown: [],
    feedbackSummary: reason,
    validatorVersion: `${LLM_VALIDATOR_VERSION}:unavailable`,
    validatorMode: 'llm_unavailable',
    rubricSnapshot: buildRubricSnapshot(question),
    integrityFlags,
    confidence: 0,
  };

  return {
    ...validatorResult,
    decisionHash: buildValidatorDecisionHash(question.id, answerText, validatorResult),
  };
}

function coerceCriteriaBreakdown(value) {
  if (!Array.isArray(value)) return [];
  return value.map((criterion, index) => ({
    criterionId:
      typeof criterion?.criterionId === 'string'
        ? criterion.criterionId
        : `criterion-${index + 1}`,
    label: typeof criterion?.label === 'string' ? criterion.label : `Criterion ${index + 1}`,
    passed: criterion?.passed === true,
    score: Number.isFinite(Number(criterion?.score)) ? Number(criterion.score) : 0,
    reason: typeof criterion?.reason === 'string' ? criterion.reason : '',
  }));
}

export async function gradeSubjectiveAnswerWithLlm({
  question,
  answerText,
  startedAt = null,
  completedAt = null,
}) {
  const trimmedAnswer = typeof answerText === 'string' ? answerText.trim() : '';
  const integrityFlags = buildIntegrityFlags(trimmedAnswer, startedAt, completedAt);
  const blockingIntegrityFlag = integrityFlags.some((flag) => flag.severity === 'block');

  if (!trimmedAnswer) {
    return failClosedDecision(
      question,
      trimmedAnswer,
      'Answer was empty. Please answer the question before submitting.',
      integrityFlags,
    );
  }

  if (blockingIntegrityFlag) {
    return failClosedDecision(
      question,
      trimmedAnswer,
      `AI grader blocked this answer: ${integrityFlags.map((flag) => flag.message).join(' ')}`,
      integrityFlags,
    );
  }

  if (!hasLlmGraderConfig()) {
    return failClosedDecision(
      question,
      trimmedAnswer,
      'AI grader is unavailable. Please try again after grading is restored.',
      integrityFlags,
    );
  }

  const acceptThreshold = getAcceptThreshold(question);
  const rubricSnapshot = buildRubricSnapshot(question);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), appConfig.openaiValidatorTimeoutMs);

  try {
    const response = await fetch(`${appConfig.openaiResponsesBaseUrl}/responses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${appConfig.openaiApiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: appConfig.openaiValidatorModel,
        reasoning: { effort: 'minimal' },
        input: [
          {
            role: 'system',
            content: [
              {
                type: 'input_text',
                text:
                  'You are a strict but fair lesson grader. Grade only against the supplied question, expected answer, and rubric. Accept equivalent wording when the learner demonstrates the same concept. Reject empty, irrelevant, or hallucinated answers. Return JSON only.',
              },
            ],
          },
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: JSON.stringify({
                  questionId: question.id,
                  questionType: question.questionType,
                  prompt: question.prompt,
                  expectedAnswer: question.correctAnswer,
                  rubric: question.metadata?.validator ?? null,
                  learnerAnswer: trimmedAnswer,
                  acceptThreshold,
                  gradingRules: [
                    'Score from 0 to 100.',
                    'Accepted should be true only when the answer meets or exceeds the threshold.',
                    'Do not require exact phrasing when the concept is correct.',
                    'Do not award credit for vague answers that omit the key concept.',
                  ],
                }),
              },
            ],
          },
        ],
        max_output_tokens: 1000,
        text: {
          format: {
            type: 'json_schema',
            name: 'subjective_answer_grade',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              required: [
                'accepted',
                'score',
                'criteriaBreakdown',
                'feedbackSummary',
                'confidence',
              ],
              properties: {
                accepted: { type: 'boolean' },
                score: { type: 'integer', minimum: 0, maximum: 100 },
                criteriaBreakdown: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['criterionId', 'label', 'passed', 'score', 'reason'],
                    properties: {
                      criterionId: { type: 'string' },
                      label: { type: 'string' },
                      passed: { type: 'boolean' },
                      score: { type: 'integer', minimum: 0, maximum: 100 },
                      reason: { type: 'string' },
                    },
                  },
                },
                feedbackSummary: { type: 'string' },
                confidence: { type: 'number', minimum: 0, maximum: 1 },
              },
            },
          },
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI grader request failed with status ${response.status}`);
    }

    const payload = await response.json();
    const outputText = getResponseText(payload);
    if (!outputText) {
      throw new Error('OpenAI grader returned no output text');
    }

    const parsed = JSON.parse(outputText);
    const numericScore = Number(parsed.score);
    if (!Number.isFinite(numericScore)) {
      throw new Error('OpenAI grader returned an invalid score');
    }
    const score = Math.min(100, Math.max(0, numericScore));
    const criteriaBreakdown = coerceCriteriaBreakdown(parsed.criteriaBreakdown);
    const feedbackSummary =
      typeof parsed.feedbackSummary === 'string' && parsed.feedbackSummary.trim().length > 0
        ? parsed.feedbackSummary.trim()
        : 'AI grader returned no feedback.';
    const numericConfidence = Number(parsed.confidence ?? 0);
    const confidence = Number.isFinite(numericConfidence)
      ? Math.min(1, Math.max(0, numericConfidence))
      : 0;
    // Server enforces the threshold even if the model's boolean disagrees.
    const accepted = parsed.accepted === true && score >= acceptThreshold;
    const validatorResult = {
      accepted,
      score,
      criteriaBreakdown,
      feedbackSummary,
      validatorVersion: `${LLM_VALIDATOR_VERSION}:${appConfig.openaiValidatorModel}`,
      validatorMode: 'llm_v1',
      rubricSnapshot,
      integrityFlags,
      confidence,
    };

    return {
      ...validatorResult,
      decisionHash: buildValidatorDecisionHash(question.id, trimmedAnswer, validatorResult),
    };
  } catch {
    return failClosedDecision(
      question,
      trimmedAnswer,
      'AI grader is unavailable. Please try again after grading is restored.',
      integrityFlags,
    );
  } finally {
    clearTimeout(timeout);
  }
}

export function hasHybridValidatorConfig() {
  return Boolean(
    appConfig.answerValidatorHybridEnabled &&
      appConfig.openaiApiKey &&
      appConfig.openaiValidatorModel,
  );
}

export async function enhanceValidatorFeedback({
  prompt,
  learnerAnswer,
  criteriaBreakdown,
  integrityFlags,
  accepted,
  rubricMode,
}) {
  if (!hasHybridValidatorConfig()) {
    return null;
  }

  // Hybrid mode never decides acceptance. It only upgrades the explanation text.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), appConfig.openaiValidatorTimeoutMs);

  try {
    const response = await fetch(`${appConfig.openaiResponsesBaseUrl}/responses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${appConfig.openaiApiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: appConfig.openaiValidatorModel,
        input: [
          {
            role: 'system',
            content: [
              {
                type: 'input_text',
                text:
                  'You improve lesson-answer feedback. Do not change acceptance. Return concise educational feedback as JSON.',
              },
            ],
          },
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: JSON.stringify({
                  prompt,
                  learnerAnswer,
                  accepted,
                  rubricMode,
                  criteriaBreakdown,
                  integrityFlags,
                }),
              },
            ],
          },
        ],
        max_output_tokens: 160,
        text: {
          format: {
            type: 'json_schema',
            name: 'validator_feedback',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              required: ['feedbackSummary'],
              properties: {
                feedbackSummary: {
                  type: 'string',
                  description:
                    'One short paragraph covering what was correct, what was missing, and how to improve.',
                },
              },
            },
          },
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI validator request failed with status ${response.status}`);
    }

    const payload = await response.json();
    const outputText = getResponseText(payload);
    if (!outputText) {
      return null;
    }

    const parsed = JSON.parse(outputText);
    if (typeof parsed?.feedbackSummary !== 'string' || parsed.feedbackSummary.trim().length === 0) {
      return null;
    }

    return {
      feedbackSummary: parsed.feedbackSummary.trim(),
      validatorMode: 'hybrid_v1',
      validatorVersion: `hybrid-v1:${appConfig.openaiValidatorModel}`,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
