import { createHash } from 'node:crypto';
import { badRequest, notFound } from '../../lib/errors.mjs';
import { appConfig } from '../../config.mjs';
import {
  hasDatabase,
  query,
  queryAsWallet,
  withTransaction,
  withTransactionAsWallet,
} from '../../lib/db.mjs';
import {
  hasLockVaultReadConfig,
  hasLockVaultRelayConfig,
  publishFuelBurnToLockVault,
  publishHarvestToLockVault,
  publishMissConsequenceToLockVault,
  publishVerifiedCompletionToLockVault,
  readLockAccountSnapshot,
  readLockAccountTiming,
  verifyUnlockTransaction,
} from '../../lib/lockVault.mjs';
import {
  hasYieldSplitterRelayConfig,
  publishHarvestSplitToYieldSplitter,
} from '../../lib/yieldSplitter.mjs';
import {
  closeCommunityPotDistributionWindow,
  deriveCommunityPotWindowId,
  distributeCommunityPotWindow,
  hasCommunityPotRelayConfig,
  publishRedirectToCommunityPot,
  readCommunityPotVaultBalance,
  readCommunityPotDistributionWindow,
  readCommunityPotWindow,
} from '../../lib/communityPot.mjs';
import { enhanceValidatorFeedback } from '../../lib/answerValidator.mjs';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FUEL_DAILY_REWARD = 1;
const DEFAULT_FUEL_CAP = 7;
const SAVER_REDIRECT_BPS_BY_COUNT = {
  0: 0,
  1: 1000,
  2: 2000,
  3: 2000,
};
const SUBJECTIVE_VALIDATOR_VERSION = 'rubric-v1';
const LESSON_ACCEPTANCE_THRESHOLD = 70;

function assertAttemptId(attemptId) {
  if (!attemptId || typeof attemptId !== 'string' || !UUID_RE.test(attemptId)) {
    throw badRequest('attemptId must be a valid UUID', 'INVALID_ATTEMPT_ID');
  }
  return attemptId;
}

function normalizeAnswerText(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizeKeyword(value) {
  return normalizeAnswerText(value).replace(/[^a-z0-9 ]/g, '').trim();
}

function tokenizeNormalized(value) {
  return normalizeKeyword(value)
    .split(' ')
    .map((token) => token.trim())
    .filter(Boolean);
}

function diffDays(fromDay, toDay) {
  const from = new Date(`${fromDay}T00:00:00.000Z`).getTime();
  const to = new Date(`${toDay}T00:00:00.000Z`).getTime();
  return Math.round((to - from) / (24 * 60 * 60 * 1000));
}

const DAY_MS = 24 * 60 * 60 * 1000;

function getSaverRedirectBps(saverCount) {
  return SAVER_REDIRECT_BPS_BY_COUNT[saverCount] ?? 10000;
}

function percentageOfAmount(amount, bps) {
  return Math.floor((Number(amount) * Number(bps)) / 10_000);
}

function epochDayToIsoDate(epochDay) {
  if (epochDay == null || Number(epochDay) < 0) {
    return null;
  }

  return new Date(Number(epochDay) * DAY_MS).toISOString().slice(0, 10);
}

function unixTimestampSecondsToIso(value) {
  if (value == null || Number(value) <= 0) {
    return null;
  }

  return new Date(Number(value) * 1000).toISOString();
}

function formatAtomicUsdcUi(value) {
  const amount = BigInt(value ?? 0);
  const whole = amount / 1_000_000n;
  const fraction = (amount % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return fraction ? `${whole.toString()}.${fraction}` : whole.toString();
}

function formatCommunityPotWindowLabel(windowId) {
  const numeric = Number(windowId);
  const year = Math.floor(numeric / 100);
  const monthIndex = (numeric % 100) - 1;
  if (monthIndex < 0 || monthIndex > 11) {
    return String(windowId);
  }

  return new Date(Date.UTC(year, monthIndex, 1)).toLocaleString('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function mapDistributionWindowStatus(rawStatus) {
  if (Number(rawStatus) === 2) return 'DISTRIBUTED';
  if (Number(rawStatus) === 1) return 'CLOSED';
  return 'OPEN';
}

function mapRecipientStatus(rawStatus) {
  if (rawStatus === 'distributed') return 'DISTRIBUTED';
  if (rawStatus === 'failed') return 'FAILED';
  if (rawStatus === 'publishing') return 'PUBLISHING';
  if (rawStatus === 'pending') return 'PENDING';
  return 'NONE';
}

function assertAnswers(answers) {
  if (!Array.isArray(answers)) {
    throw badRequest('answers must be an array', 'INVALID_ANSWERS');
  }

  const answerMap = new Map();

  for (const answer of answers) {
    if (!answer || typeof answer !== 'object') {
      throw badRequest('Each answer must be an object', 'INVALID_ANSWER_ITEM');
    }

    const questionId = answer.questionId;
    const answerText = answer.answerText;

    if (!questionId || typeof questionId !== 'string') {
      throw badRequest('Each answer requires questionId', 'MISSING_QUESTION_ID');
    }

    if (typeof answerText !== 'string') {
      throw badRequest('Each answer requires answerText', 'MISSING_ANSWER_TEXT');
    }

    if (answerMap.has(questionId)) {
      throw badRequest(
        `Duplicate answer for question ${questionId}`,
        'DUPLICATE_QUESTION_ANSWER',
      );
    }

    answerMap.set(questionId, answerText);
  }

  return answerMap;
}

async function getPublishedLessonVersion(client, lessonId) {
  const result = await client.query(
    `
      select id::text as "lessonVersionId"
      from lesson.lesson_versions
      where lesson_id = $1
        and state = 'published'
      order by published_at desc nulls last
      limit 1
    `,
    [lessonId],
  );

  if (result.rowCount === 0) {
    throw notFound('Lesson not found', 'LESSON_NOT_FOUND');
  }

  return result.rows[0];
}

async function readAttempt(client, walletAddress, lessonId, attemptId) {
  const result = await client.query(
    `
      select
        id::text as "attemptId",
        wallet_address as "walletAddress",
        lesson_id as "lessonId",
        lesson_version_id::text as "lessonVersionId",
        started_at as "startedAt",
        submitted_at as "submittedAt",
        score,
        accepted
      from lesson.user_lesson_attempts
      where id = $1::uuid
    `,
    [attemptId],
  );

  if (result.rowCount === 0) {
    return null;
  }

  const attempt = result.rows[0];
  if (attempt.walletAddress !== walletAddress || attempt.lessonId !== lessonId) {
    throw badRequest('attemptId is already bound to a different lesson', 'ATTEMPT_ID_CONFLICT');
  }

  return attempt;
}

async function ensureAttempt(
  client,
  walletAddress,
  lessonId,
  attemptId,
  lessonVersionId,
  startedAt = null,
) {
  await client.query(
    `
      insert into lesson.user_lesson_attempts (
        id,
        wallet_address,
        lesson_id,
        lesson_version_id,
        started_at
      )
      values (
        $1::uuid,
        $2,
        $3,
        $4::uuid,
        coalesce($5::timestamptz, now())
      )
      on conflict (id) do nothing
    `,
    [attemptId, walletAddress, lessonId, lessonVersionId, startedAt],
  );

  const attempt = await readAttempt(client, walletAddress, lessonId, attemptId);
  if (!attempt) {
    throw notFound('Lesson attempt not found', 'ATTEMPT_NOT_FOUND');
  }

  return attempt;
}

async function listLessonQuestions(client, lessonVersionId) {
  const result = await client.query(
    `
      select
        q.id,
        q.question_type as "questionType",
        q.prompt,
        q.correct_answer as "correctAnswer",
        q.metadata,
        coalesce(
          json_agg(
            jsonb_build_object(
              'id', qo.id::text,
              'text', qo.option_text
            )
            order by qo.option_order
          ) filter (where qo.id is not null),
          '[]'::json
        ) as options
      from lesson.questions q
      left join lesson.question_options qo on qo.question_id = q.id
      where q.lesson_version_id = $1::uuid
      group by q.id, q.question_type, q.prompt, q.correct_answer, q.metadata, q.question_order
      order by q.question_order asc
    `,
    [lessonVersionId],
  );

  return result.rows;
}

async function getCourseIdForPublishedLesson(client, lessonId, lessonVersionId) {
  const result = await client.query(
    `
      select (payload->>'courseId') as "courseId"
      from lesson.published_lessons
      where lesson_id = $1
        and lesson_version_id = $2::uuid
      limit 1
    `,
    [lessonId, lessonVersionId],
  );

  if (result.rowCount === 0 || !result.rows[0].courseId) {
    throw notFound('Published lesson context not found', 'LESSON_CONTEXT_NOT_FOUND');
  }

  return result.rows[0].courseId;
}

async function ensureCourseRuntimeState(client, walletAddress, courseId) {
  await client.query(
    `
      insert into lesson.user_course_runtime_state (
        wallet_address,
        course_id,
        fuel_cap
      )
      values ($1, $2, $3)
      on conflict (wallet_address, course_id) do nothing
    `,
    [walletAddress, courseId, DEFAULT_FUEL_CAP],
  );

  const result = await client.query(
    `
      select
        wallet_address as "walletAddress",
        course_id as "courseId",
        current_streak as "currentStreak",
        longest_streak as "longestStreak",
        gauntlet_active as "gauntletActive",
        gauntlet_day as "gauntletDay",
        saver_count as "saverCount",
        saver_recovery_mode as "saverRecoveryMode",
        current_yield_redirect_bps as "currentYieldRedirectBps",
        extension_days as "extensionDays",
        fuel_counter as "fuelCounter",
        fuel_cap as "fuelCap",
        last_completed_day::text as "lastCompletedDay",
        last_miss_day::text as "lastMissDay",
        last_fuel_credit_day::text as "lastFuelCreditDay",
        last_brewer_burn_ts as "lastBrewerBurnTs"
      from lesson.user_course_runtime_state
      where wallet_address = $1
        and course_id = $2
      limit 1
    `,
    [walletAddress, courseId],
  );

  return result.rows[0];
}

function deriveFuelEarnStatus(state, completionDay) {
  if (state.saverRecoveryMode) return 'PAUSED_RECOVERY';
  if (state.fuelCounter >= state.fuelCap) return 'AT_CAP';
  if (state.lastFuelCreditDay === completionDay) return 'EARNED_TODAY';
  return 'AVAILABLE';
}

async function applyVerifiedCompletionToCourseRuntime(
  client,
  walletAddress,
  courseId,
  completionDay,
  rewardUnits,
) {
  const state = await ensureCourseRuntimeState(client, walletAddress, courseId);
  const sameDay = state.lastCompletedDay === completionDay;

  let currentStreak = state.currentStreak;
  let longestStreak = state.longestStreak;
  let gauntletActive = state.gauntletActive;
  let gauntletDay = state.gauntletDay;
  let saverCount = state.saverCount;
  let saverRecoveryMode = state.saverRecoveryMode;
  let currentYieldRedirectBps = state.currentYieldRedirectBps;

  if (!sameDay) {
    const consecutive =
      state.lastCompletedDay != null && diffDays(state.lastCompletedDay, completionDay) === 1;
    currentStreak = state.lastCompletedDay == null ? 1 : consecutive ? state.currentStreak + 1 : 1;
    longestStreak = Math.max(state.longestStreak, currentStreak);

    if (state.gauntletActive) {
      gauntletDay = Math.min(state.gauntletDay + 1, 8);
      gauntletActive = state.gauntletDay < 7;
    }
  }

  if (saverRecoveryMode && saverCount > 0) {
    saverCount = Math.max(0, saverCount - 1);
    saverRecoveryMode = saverCount > 0;
    currentYieldRedirectBps = getSaverRedirectBps(saverCount);
  }

  let fuelCounter = state.fuelCounter;
  let lastFuelCreditDay = state.lastFuelCreditDay;
  let fuelAwarded = 0;

  if (
    rewardUnits > 0 &&
    !saverRecoveryMode &&
    fuelCounter < state.fuelCap &&
    lastFuelCreditDay !== completionDay
  ) {
    fuelCounter = Math.min(state.fuelCap, fuelCounter + FUEL_DAILY_REWARD);
    lastFuelCreditDay = completionDay;
    fuelAwarded = fuelCounter > state.fuelCounter ? FUEL_DAILY_REWARD : 0;
  }

  await client.query(
    `
      update lesson.user_course_runtime_state
      set current_streak = $3,
          longest_streak = $4,
          gauntlet_active = $5,
          gauntlet_day = $6,
          saver_count = $7,
          saver_recovery_mode = $8,
          current_yield_redirect_bps = $9,
          fuel_counter = $10,
          last_completed_day = $11::date,
          last_fuel_credit_day = $12::date,
          updated_at = now()
      where wallet_address = $1
        and course_id = $2
    `,
    [
      walletAddress,
      courseId,
      currentStreak,
      longestStreak,
      gauntletActive,
      gauntletDay,
      saverCount,
      saverRecoveryMode,
      currentYieldRedirectBps,
      fuelCounter,
      completionDay,
      lastFuelCreditDay,
    ],
  );

  return {
    courseId,
    currentStreak,
    longestStreak,
    gauntletActive,
    gauntletDay,
    saverCount,
    saverRecoveryMode,
    currentYieldRedirectBps,
    extensionDays: state.extensionDays,
    fuelCounter,
    fuelCap: state.fuelCap,
    lastFuelCreditDay,
    lastBrewerBurnTs: state.lastBrewerBurnTs,
    fuelAwarded,
    fuelEarnStatus: deriveFuelEarnStatus(
      {
        ...state,
        saverCount,
        saverRecoveryMode,
        currentYieldRedirectBps,
        fuelCounter,
        lastFuelCreditDay,
      },
      completionDay,
    ),
  };
}

function extractRubricConfig(question) {
  const validator = question.metadata?.validator;
  if (
    validator &&
    validator.mode === 'rubric_v1' &&
    Array.isArray(validator.criteria) &&
    validator.criteria.length > 0
  ) {
    return {
      mode: 'rubric_v1',
      acceptThreshold: Number(validator.acceptThreshold ?? 70),
      criteria: validator.criteria.map((criterion, index) => ({
        id: criterion.id ?? `criterion-${index + 1}`,
        label: criterion.label ?? `Criterion ${index + 1}`,
        kind: criterion.kind === 'exact' ? 'exact' : 'keywords',
        keywords: Array.isArray(criterion.keywords) ? criterion.keywords : [],
        expected: typeof criterion.expected === 'string' ? criterion.expected : null,
        weight: Number(criterion.weight ?? 0),
        required: criterion.required !== false,
        feedbackPass:
          typeof criterion.feedbackPass === 'string' ? criterion.feedbackPass : null,
        feedbackMiss:
          typeof criterion.feedbackMiss === 'string' ? criterion.feedbackMiss : null,
      })),
    };
  }

  const tokens = tokenizeNormalized(question.correctAnswer);
  if (tokens.length <= 1) {
    return {
      mode: 'rubric_v1',
      acceptThreshold: 100,
      criteria: [
        {
          id: 'exact-answer',
          label: 'Exact answer match',
          kind: 'exact',
          expected: question.correctAnswer,
          keywords: [],
          weight: 100,
          required: true,
          feedbackPass: 'Matched the expected answer.',
          feedbackMiss: `Use the exact expected answer: ${question.correctAnswer}.`,
        },
      ],
    };
  }

  return {
    mode: 'rubric_v1',
    acceptThreshold: 100,
    criteria: [
      {
        id: 'key-concepts',
        label: 'Includes all key concepts',
        kind: 'keywords',
        expected: null,
        keywords: tokens,
        weight: 100,
        required: true,
        feedbackPass: 'Covered the expected key concepts.',
        feedbackMiss: `Include these key concepts: ${tokens.join(', ')}.`,
      },
    ],
  };
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
    if (Number.isFinite(durationMs) && durationMs >= 0 && durationMs < 2000 && trimmed.length > 40) {
      flags.push({
        code: 'IMPOSSIBLE_SPEED',
        severity: 'block',
        message: 'Answer arrived too quickly for its length.',
      });
    }
  }

  return flags;
}

function evaluateRubricCriterion(criterion, answerText) {
  const normalizedAnswer = normalizeKeyword(answerText);
  if (criterion.kind === 'exact') {
    const expected = normalizeKeyword(criterion.expected ?? '');
    const passed = expected.length > 0 && normalizedAnswer === expected;
    return {
      criterionId: criterion.id,
      label: criterion.label,
      weight: criterion.weight,
      passed,
      matched: passed ? [criterion.expected] : [],
      feedback:
        passed
          ? criterion.feedbackPass ?? `Correctly satisfied ${criterion.label}.`
          : criterion.feedbackMiss ?? `Missing ${criterion.label}.`,
    };
  }

  const answerTokens = new Set(tokenizeNormalized(answerText));
  const matched = criterion.keywords.filter((keyword) => answerTokens.has(normalizeKeyword(keyword)));
  const passed =
    criterion.keywords.length > 0 &&
    matched.length === criterion.keywords.length;
  return {
    criterionId: criterion.id,
    label: criterion.label,
    weight: criterion.weight,
    passed,
    matched,
    feedback:
      passed
        ? criterion.feedbackPass ?? `Correctly satisfied ${criterion.label}.`
        : criterion.feedbackMiss ?? `Missing ${criterion.label}.`,
  };
}

function buildFeedbackSummary(criteriaBreakdown, accepted, integrityFlags) {
  const passed = criteriaBreakdown.filter((criterion) => criterion.passed).map((criterion) => criterion.label);
  const missed = criteriaBreakdown.filter((criterion) => !criterion.passed).map((criterion) => criterion.label);

  const parts = [];
  if (passed.length > 0) {
    parts.push(`What was correct: ${passed.join(', ')}.`);
  }
  if (missed.length > 0) {
    parts.push(`Key concept missing: ${missed.join(', ')}.`);
  }
  if (integrityFlags.length > 0) {
    parts.push(`Integrity flag: ${integrityFlags.map((flag) => flag.message).join(' ')}`);
  }
  if (accepted) {
    parts.push('How to improve: keep the same core concept coverage and add one precise example next time.');
  } else {
    parts.push('How to improve: answer in one short sentence using the missing key concept words.');
  }

  return parts.join(' ');
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
      }),
    )
    .digest('hex');
}

async function evaluateSubjectiveAnswer(question, answerText, startedAt, completedAt) {
  const rubric = extractRubricConfig(question);
  const integrityFlags = buildIntegrityFlags(answerText, startedAt, completedAt);
  const criteriaBreakdown = rubric.criteria.map((criterion) =>
    evaluateRubricCriterion(criterion, answerText),
  );
  const totalWeight = rubric.criteria.reduce((sum, criterion) => sum + criterion.weight, 0);
  const achievedWeight = criteriaBreakdown.reduce(
    (sum, criterion) => sum + (criterion.passed ? criterion.weight : 0),
    0,
  );
  const score = totalWeight > 0 ? Math.round((achievedWeight / totalWeight) * 100) : 0;
  const requiredCriteriaMet = rubric.criteria
    .filter((criterion) => criterion.required)
    .every((criterion) =>
      criteriaBreakdown.find((result) => result.criterionId === criterion.id)?.passed === true,
    );
  const hasBlockingIntegrityFlag = integrityFlags.some((flag) => flag.severity === 'block');
  const accepted =
    answerText.trim().length > 0 &&
    !hasBlockingIntegrityFlag &&
    requiredCriteriaMet &&
    score >= rubric.acceptThreshold;
  const baseResult = {
    accepted,
    score,
    criteriaBreakdown,
    feedbackSummary: buildFeedbackSummary(criteriaBreakdown, accepted, integrityFlags),
    validatorVersion: SUBJECTIVE_VALIDATOR_VERSION,
    validatorMode: rubric.mode,
    rubricSnapshot: rubric,
    integrityFlags,
  };
  // Feedback can be upgraded by the model, but acceptance must stay rubric-deterministic.
  const enhancedFeedback = await enhanceValidatorFeedback({
    prompt: question.prompt,
    learnerAnswer: answerText,
    criteriaBreakdown,
    integrityFlags,
    accepted,
    rubricMode: rubric.mode,
  });
  const validatorResult = enhancedFeedback
    ? {
        ...baseResult,
        feedbackSummary: enhancedFeedback.feedbackSummary,
        validatorVersion: enhancedFeedback.validatorVersion,
        validatorMode: enhancedFeedback.validatorMode,
      }
    : baseResult;

  return {
    ...validatorResult,
    decisionHash: buildValidatorDecisionHash(question.id, answerText, validatorResult),
  };
}

async function gradeAnswers(questions, submittedAnswers, startedAt = null, completedAt = null) {
  const questionIds = new Set(questions.map((question) => question.id));
  for (const questionId of submittedAnswers.keys()) {
    if (!questionIds.has(questionId)) {
      throw badRequest(
        `Answer was provided for an unknown question: ${questionId}`,
        'UNKNOWN_QUESTION_ID',
      );
    }
  }

  const attempts = await Promise.all(questions.map(async (question) => {
    const answerText = submittedAnswers.get(question.id) ?? '';
    let validatorResult = null;
    let isCorrect = false;

    if (question.questionType === 'short_text') {
      validatorResult = await evaluateSubjectiveAnswer(
        question,
        answerText,
        startedAt,
        completedAt,
      );
      isCorrect = validatorResult.accepted;
    } else {
      const normalizedAnswer = normalizeAnswerText(answerText);
      const normalizedCorrectAnswer = normalizeAnswerText(question.correctAnswer);
      isCorrect =
        normalizedAnswer.length > 0 && normalizedAnswer === normalizedCorrectAnswer;
    }

    return {
      questionId: question.id,
      prompt: question.prompt,
      answerText: answerText.trim().length > 0 ? answerText.trim() : null,
      isCorrect,
      validatorResult,
    };
  }));

  const correctAnswers = attempts.filter((attempt) => attempt.isCorrect).length;
  const totalQuestions = questions.length;
  const score =
    totalQuestions === 0 ? 0 : Math.round((correctAnswers / totalQuestions) * 100);

  return {
    attempts,
    correctAnswers,
    totalQuestions,
    score,
  };
}

async function persistAnswerValidationDecisions(client, attemptId, questionAttempts) {
  for (const attempt of questionAttempts) {
    if (!attempt.validatorResult) {
      continue;
    }

    await client.query(
      `
        insert into lesson.answer_validation_decisions (
          lesson_attempt_id,
          question_id,
          validator_mode,
          validator_version,
          accepted,
          score,
          prompt_snapshot,
          learner_answer,
          rubric_snapshot,
          criteria_breakdown,
          integrity_flags,
          feedback_summary,
          decision_hash,
          updated_at
        )
        values (
          $1::uuid,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          $9::jsonb,
          $10::jsonb,
          $11::jsonb,
          $12,
          $13,
          now()
        )
        on conflict (lesson_attempt_id, question_id)
        do update set
          validator_mode = excluded.validator_mode,
          validator_version = excluded.validator_version,
          accepted = excluded.accepted,
          score = excluded.score,
          prompt_snapshot = excluded.prompt_snapshot,
          learner_answer = excluded.learner_answer,
          rubric_snapshot = excluded.rubric_snapshot,
          criteria_breakdown = excluded.criteria_breakdown,
          integrity_flags = excluded.integrity_flags,
          feedback_summary = excluded.feedback_summary,
          decision_hash = excluded.decision_hash,
          updated_at = now()
      `,
      [
        attemptId,
        attempt.questionId,
        attempt.validatorResult.validatorMode,
        attempt.validatorResult.validatorVersion,
        attempt.validatorResult.accepted,
        attempt.validatorResult.score,
        attempt.prompt,
        attempt.answerText,
        JSON.stringify(attempt.validatorResult.rubricSnapshot),
        JSON.stringify(attempt.validatorResult.criteriaBreakdown),
        JSON.stringify(attempt.validatorResult.integrityFlags),
        attempt.validatorResult.feedbackSummary,
        attempt.validatorResult.decisionHash,
      ],
    );
  }
}

async function readAnswerValidationDecisions(client, attemptId) {
  const result = await client.query(
    `
      select
        question_id as "questionId",
        accepted,
        score,
        prompt_snapshot as "prompt",
        feedback_summary as "feedbackSummary",
        validator_version as "validatorVersion",
        decision_hash as "decisionHash"
      from lesson.answer_validation_decisions
      where lesson_attempt_id = $1::uuid
      order by question_id asc
    `,
    [attemptId],
  );

  return result.rows;
}

async function persistQuestionAttempts(client, attemptId, questionAttempts) {
  for (const attempt of questionAttempts) {
    await client.query(
      `
        insert into lesson.user_question_attempts (
          lesson_attempt_id,
          question_id,
          answer_text,
          is_correct
        )
        values (
          $1::uuid,
          $2,
          $3,
          $4
        )
        on conflict (lesson_attempt_id, question_id)
        do update set
          answer_text = excluded.answer_text,
          is_correct = excluded.is_correct
      `,
      [attemptId, attempt.questionId, attempt.answerText, attempt.isCorrect],
    );
  }
}

async function persistLessonProgress(
  client,
  walletAddress,
  lessonId,
  score,
  completedAt,
) {
  await client.query(
    `
      insert into lesson.user_lesson_progress (
        wallet_address,
        lesson_id,
        completed,
        score,
        completed_at,
        updated_at
      )
      values ($1, $2, true, $3, $4::timestamptz, now())
      on conflict (wallet_address, lesson_id)
      do update set
        completed = true,
        score = greatest(coalesce(lesson.user_lesson_progress.score, 0), excluded.score),
        completed_at = greatest(
          coalesce(lesson.user_lesson_progress.completed_at, excluded.completed_at),
          excluded.completed_at
        ),
        updated_at = now()
    `,
    [walletAddress, lessonId, score, completedAt],
  );
}

function toCompletionDay(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

async function persistVerifiedCompletionEvent(
  client,
  walletAddress,
  lessonId,
  lessonVersionId,
  lessonAttemptId,
  grading,
  completedAt,
) {
  const courseId = await getCourseIdForPublishedLesson(
    client,
    lessonId,
    lessonVersionId,
  );
  const completionDay = toCompletionDay(completedAt);
  const rewardUnits = grading.score > 0 ? 100 : 0;
  const payload = {
    eventType: 'verified_completion.accepted',
    walletAddress,
    courseId,
    lessonId,
    lessonVersionId,
    lessonAttemptId,
    completionDay,
    rewardUnits,
    score: grading.score,
    correctAnswers: grading.correctAnswers,
    totalQuestions: grading.totalQuestions,
    completedAt,
  };

  await client.query(
    `
      insert into lesson.verified_completion_events (
        event_id,
        wallet_address,
        course_id,
        lesson_id,
        lesson_version_id,
        lesson_attempt_id,
        completion_day,
        reward_units,
        score,
        correct_answers,
        total_questions,
        payload
      )
      values (
        $1::uuid,
        $2,
        $3,
        $4,
        $5::uuid,
        $6::uuid,
        $7::date,
        $8,
        $9,
        $10,
        $11,
        $12::jsonb
      )
      on conflict (event_id) do update set
        payload = excluded.payload,
        reward_units = excluded.reward_units,
        score = excluded.score,
        correct_answers = excluded.correct_answers,
        total_questions = excluded.total_questions
    `,
    [
      lessonAttemptId,
      walletAddress,
      courseId,
      lessonId,
      lessonVersionId,
      lessonAttemptId,
      completionDay,
      rewardUnits,
      grading.score,
      grading.correctAnswers,
      grading.totalQuestions,
      JSON.stringify(payload),
    ],
  );

  return {
    eventId: lessonAttemptId,
    courseId,
    completionDay,
    rewardUnits,
  };
}

async function readVerifiedCompletionEvent(client, lessonAttemptId) {
  const result = await client.query(
    `
      select
        event_id::text as "eventId",
        course_id as "courseId",
        completion_day::text as "completionDay",
        reward_units as "rewardUnits"
      from lesson.verified_completion_events
      where lesson_attempt_id = $1::uuid
      limit 1
    `,
    [lessonAttemptId],
  );

  return result.rows[0] ?? null;
}

async function claimVerifiedCompletionEvent(eventId = null, retryFailed = false) {
  const claimableStatuses = retryFailed ? ['pending', 'failed'] : ['pending'];
  const selectionArgs = [claimableStatuses];
  let result;

  if (eventId) {
    selectionArgs.push(eventId);
    result = await query(
      `
        update lesson.verified_completion_events
        set status = 'publishing',
            last_error = null
        where event_id = $2::uuid
          and status = any($1::text[])
        returning
          event_id::text as "eventId",
          wallet_address as "walletAddress",
          course_id as "courseId",
          completion_day::text as "completionDay",
          reward_units as "rewardUnits",
          payload->>'completedAt' as "completedAt",
          status
      `,
      selectionArgs,
    );
  } else {
    result = await query(
      `
        with next_event as (
          select event_id
          from lesson.verified_completion_events
          where status = any($1::text[])
          order by created_at asc
          for update skip locked
          limit 1
        )
        update lesson.verified_completion_events events
        set status = 'publishing',
            last_error = null
        from next_event
        where events.event_id = next_event.event_id
        returning
          events.event_id::text as "eventId",
          events.wallet_address as "walletAddress",
          events.course_id as "courseId",
          events.completion_day::text as "completionDay",
          events.reward_units as "rewardUnits",
          events.payload->>'completedAt' as "completedAt",
          events.status
      `,
      selectionArgs,
    );
  }

  if (result.rowCount > 0) {
    return {
      event: result.rows[0],
      reason: 'CLAIMED',
    };
  }

  if (!eventId) {
    return {
      event: null,
      reason: 'NO_PENDING_EVENT',
    };
  }

  const current = await query(
    `
      select
        event_id::text as "eventId",
        status,
        payload->>'completedAt' as "completedAt",
        last_error as "lastError",
        published_at as "publishedAt",
        transaction_signature as "transactionSignature"
      from lesson.verified_completion_events
      where event_id = $1::uuid
      limit 1
    `,
    [eventId],
  );

  if (current.rowCount === 0) {
    return {
      event: null,
      reason: 'EVENT_NOT_FOUND',
    };
  }

  const existing = current.rows[0];
  if (existing.status === 'published') {
    return {
      event: existing,
      reason: 'ALREADY_PUBLISHED',
    };
  }

  if (existing.status === 'publishing') {
    return {
      event: existing,
      reason: 'ALREADY_PUBLISHING',
    };
  }

  return {
    event: existing,
    reason: 'RETRY_REQUIRED',
  };
}

async function markVerifiedCompletionEventPublished(eventId, signature) {
  await query(
    `
      update lesson.verified_completion_events
      set status = 'published',
          published_at = now(),
          last_error = null,
          transaction_signature = $2
      where event_id = $1::uuid
    `,
    [eventId, signature],
  );
}

async function markVerifiedCompletionEventFailed(eventId, error) {
  await query(
    `
      update lesson.verified_completion_events
      set status = 'failed',
          last_error = $2
      where event_id = $1::uuid
    `,
    [eventId, error],
  );
}

function toUnixTimestampSeconds(value) {
  const milliseconds = new Date(value).getTime();
  if (!Number.isFinite(milliseconds)) {
    throw badRequest('completedAt is invalid', 'INVALID_COMPLETED_AT');
  }

  return Math.floor(milliseconds / 1000);
}

export async function readCourseRuntimeState(client, walletAddress, courseId) {
  const state = await ensureCourseRuntimeState(client, walletAddress, courseId);
  const referenceDay =
    state.lastFuelCreditDay ??
    state.lastCompletedDay ??
    new Date().toISOString().slice(0, 10);

  return {
    courseId,
    currentStreak: state.currentStreak,
    longestStreak: state.longestStreak,
    gauntletActive: state.gauntletActive,
    gauntletDay: state.gauntletDay,
    saverCount: state.saverCount,
    saverRecoveryMode: state.saverRecoveryMode,
    currentYieldRedirectBps: state.currentYieldRedirectBps,
    extensionDays: state.extensionDays,
    fuelCounter: state.fuelCounter,
    fuelCap: state.fuelCap,
    lastFuelCreditDay: state.lastFuelCreditDay,
    lastBrewerBurnTs: state.lastBrewerBurnTs,
    fuelAwarded: 0,
    fuelEarnStatus: deriveFuelEarnStatus(state, referenceDay),
  };
}

export async function syncCourseRuntimeStateWithLockSnapshot(
  walletAddress,
  courseId,
  lockSnapshot = null,
) {
  if (!hasDatabase()) {
    return null;
  }

  const snapshot = lockSnapshot ?? (await readLockAccountSnapshot(walletAddress, courseId));
  const extensionDays = Math.floor(snapshot.extensionSecondsTotal / 86_400);
  const saverCount = snapshot.gauntletComplete ? Math.max(0, 3 - snapshot.saversRemaining) : 0;

  return withTransactionAsWallet(walletAddress, async (client) => {
    await ensureCourseRuntimeState(client, walletAddress, courseId);
    await client.query(
      `
        update lesson.user_course_runtime_state
        set current_streak = $3,
            longest_streak = $4,
            gauntlet_active = $5,
            gauntlet_day = $6,
            saver_count = $7,
            saver_recovery_mode = $8,
            current_yield_redirect_bps = $9,
            extension_days = $10,
            fuel_counter = $11,
            fuel_cap = $12,
            last_completed_day = $13::date,
            last_fuel_credit_day = $14::date,
            last_brewer_burn_ts = $15::timestamptz,
            updated_at = now()
        where wallet_address = $1
          and course_id = $2
      `,
      [
        walletAddress,
        courseId,
        snapshot.currentStreak,
        snapshot.longestStreak,
        !snapshot.gauntletComplete,
        snapshot.gauntletDay,
        saverCount,
        snapshot.saverRecoveryMode,
        snapshot.currentYieldRedirectBps,
        extensionDays,
        snapshot.fuelCounter,
        snapshot.fuelCap,
        epochDayToIsoDate(snapshot.lastCompletionDay),
        epochDayToIsoDate(snapshot.lastFuelCreditDay),
        unixTimestampSecondsToIso(snapshot.lastBrewerBurnTs),
      ],
    );

    return readCourseRuntimeState(client, walletAddress, courseId);
  });
}

export async function listRuntimeSchedulerCandidates(limit = 10) {
  if (!hasDatabase()) {
    return [];
  }

  const result = await query(
    `
      select
        runtime.wallet_address as "walletAddress",
        runtime.course_id as "courseId",
        runtime.current_streak as "currentStreak",
        runtime.gauntlet_active as "gauntletActive",
        runtime.fuel_counter as "fuelCounter",
        runtime.last_completed_day::text as "lastCompletedDay",
        runtime.last_miss_day::text as "lastMissDay",
        runtime.last_brewer_burn_ts as "lastBrewerBurnTs",
        runtime.updated_at as "updatedAt",
        latest_harvest.harvested_at as "lastHarvestedAt"
      from lesson.user_course_runtime_state runtime
      left join lateral (
        select harvested_at
        from lesson.harvest_result_receipts receipts
        where receipts.wallet_address = runtime.wallet_address
          and receipts.course_id = runtime.course_id
          and receipts.harvested_at <= now()
        order by harvested_at desc
        limit 1
      ) latest_harvest on true
      order by updated_at asc
      limit $1
    `,
    [limit],
  );

  return result.rows;
}

export async function getCourseRuntimeSnapshot(walletAddress, courseId) {
  if (!hasDatabase()) {
    return {
      courseId,
      currentStreak: 0,
      longestStreak: 0,
      gauntletActive: true,
      gauntletDay: 1,
      saverCount: 0,
      saverRecoveryMode: false,
      currentYieldRedirectBps: 0,
      extensionDays: 0,
      fuelCounter: 0,
      fuelCap: DEFAULT_FUEL_CAP,
      lastFuelCreditDay: null,
      lastBrewerBurnTs: null,
      fuelAwarded: 0,
      fuelEarnStatus: 'AVAILABLE',
    };
  }

  return withTransactionAsWallet(walletAddress, async (client) =>
    readCourseRuntimeState(client, walletAddress, courseId),
  );
}

function mapRelayLifecycleStatus(rawStatus) {
  if (rawStatus === 'published') return 'published';
  if (rawStatus === 'publishing') return 'publishing';
  if (rawStatus === 'failed') return 'failed';
  return 'pending';
}

export async function getCourseRuntimeHistory(walletAddress, courseId, limit = 12) {
  if (!hasDatabase()) {
    return {
      courseId,
      burnCount: 0,
      missCount: 0,
      extensionDaysAdded: 0,
      events: [],
    };
  }

  const [summaryResult, eventsResult] = await Promise.all([
    query(
      `
        select
          (
            select count(*)::int
            from lesson.fuel_burn_cycle_receipts
            where wallet_address = $1
              and course_id = $2
              and applied = true
              and reason = 'BURNED'
          ) as "burnCount",
          (
            select count(*)::int
            from lesson.miss_consequence_receipts
            where wallet_address = $1
              and course_id = $2
              and applied = true
          ) as "missCount",
          (
            select coalesce(sum(greatest(extension_days_after - extension_days_before, 0)), 0)::int
            from lesson.miss_consequence_receipts
            where wallet_address = $1
              and course_id = $2
          ) as "extensionDaysAdded"
      `,
      [walletAddress, courseId],
    ),
    query(
      `
        select *
        from (
          select
            'FUEL_BURN'::text as "eventType",
            cycle_id as "eventId",
            burned_at as "occurredAt",
            null::text as "eventDay",
            applied,
            reason,
            fuel_before as "fuelBefore",
            fuel_after as "fuelAfter",
            null::int as "saverCountBefore",
            null::int as "saverCountAfter",
            null::int as "redirectBpsBefore",
            null::int as "redirectBpsAfter",
            null::int as "extensionDaysBefore",
            null::int as "extensionDaysAfter",
            lock_vault_status as "lockVaultStatus",
            lock_vault_transaction_signature as "lockVaultTransactionSignature",
            lock_vault_last_error as "lockVaultLastError",
            created_at as "createdAt"
          from lesson.fuel_burn_cycle_receipts
          where wallet_address = $1
            and course_id = $2

          union all

          select
            'MISS'::text as "eventType",
            miss_event_id as "eventId",
            created_at as "occurredAt",
            miss_day::text as "eventDay",
            applied,
            reason,
            null::int as "fuelBefore",
            null::int as "fuelAfter",
            saver_count_before as "saverCountBefore",
            saver_count_after as "saverCountAfter",
            redirect_bps_before as "redirectBpsBefore",
            redirect_bps_after as "redirectBpsAfter",
            extension_days_before as "extensionDaysBefore",
            extension_days_after as "extensionDaysAfter",
            lock_vault_status as "lockVaultStatus",
            lock_vault_transaction_signature as "lockVaultTransactionSignature",
            lock_vault_last_error as "lockVaultLastError",
            created_at as "createdAt"
          from lesson.miss_consequence_receipts
          where wallet_address = $1
            and course_id = $2
        ) events
        order by "occurredAt" desc, "createdAt" desc
        limit $3
      `,
      [walletAddress, courseId, limit],
    ),
  ]);

  const summary = summaryResult.rows[0] ?? {
    burnCount: 0,
    missCount: 0,
    extensionDaysAdded: 0,
  };

  return {
    courseId,
    burnCount: Number(summary.burnCount ?? 0),
    missCount: Number(summary.missCount ?? 0),
    extensionDaysAdded: Number(summary.extensionDaysAdded ?? 0),
    events: eventsResult.rows.map((row) => ({
      eventType: row.eventType,
      eventId: row.eventId,
      occurredAt: row.occurredAt,
      eventDay: row.eventDay ?? null,
      applied: Boolean(row.applied),
      reason: row.reason ?? null,
      fuelBefore: row.fuelBefore == null ? null : Number(row.fuelBefore),
      fuelAfter: row.fuelAfter == null ? null : Number(row.fuelAfter),
      saverCountBefore:
        row.saverCountBefore == null ? null : Number(row.saverCountBefore),
      saverCountAfter: row.saverCountAfter == null ? null : Number(row.saverCountAfter),
      redirectBpsBefore:
        row.redirectBpsBefore == null ? null : Number(row.redirectBpsBefore),
      redirectBpsAfter:
        row.redirectBpsAfter == null ? null : Number(row.redirectBpsAfter),
      extensionDaysBefore:
        row.extensionDaysBefore == null ? null : Number(row.extensionDaysBefore),
      extensionDaysAfter:
        row.extensionDaysAfter == null ? null : Number(row.extensionDaysAfter),
      lockVaultStatus: mapRelayLifecycleStatus(row.lockVaultStatus),
      lockVaultTransactionSignature: row.lockVaultTransactionSignature ?? null,
      lockVaultLastError: row.lockVaultLastError ?? null,
    })),
  };
}

async function readUnlockReceipt(client, walletAddress, unlockTxSignature) {
  const result = await client.query(
    `
      select
        unlock_tx_signature as "unlockTxSignature",
        wallet_address as "walletAddress",
        course_id as "courseId",
        lock_account_address as "lockAccountAddress",
        principal_amount_ui as "principalAmountUi",
        skr_locked_amount_ui as "skrLockedAmountUi",
        lock_end_at as "lockEndAt",
        unlocked_at as "unlockedAt",
        verified_slot as "verifiedSlot",
        verified_block_time as "verifiedBlockTime",
        created_at as "createdAt"
      from lesson.unlock_receipts
      where wallet_address = $1
        and unlock_tx_signature = $2
      limit 1
    `,
    [walletAddress, unlockTxSignature],
  );

  return result.rows[0] ?? null;
}

export async function recordUnlockReceipt(walletAddress, payload) {
  if (!payload?.unlockTxSignature || typeof payload.unlockTxSignature !== 'string') {
    throw badRequest('unlockTxSignature is required', 'MISSING_UNLOCK_TX_SIGNATURE');
  }
  if (!payload?.courseId || typeof payload.courseId !== 'string') {
    throw badRequest('courseId is required', 'MISSING_COURSE_ID');
  }
  if (!payload?.lockAccountAddress || typeof payload.lockAccountAddress !== 'string') {
    throw badRequest('lockAccountAddress is required', 'MISSING_LOCK_ACCOUNT_ADDRESS');
  }
  if (!payload?.principalAmountUi || typeof payload.principalAmountUi !== 'string') {
    throw badRequest('principalAmountUi is required', 'MISSING_PRINCIPAL_AMOUNT_UI');
  }
  if (typeof payload?.skrLockedAmountUi !== 'string') {
    throw badRequest('skrLockedAmountUi is required', 'MISSING_SKR_LOCKED_AMOUNT_UI');
  }
  if (!payload?.lockEndDate || typeof payload.lockEndDate !== 'string') {
    throw badRequest('lockEndDate is required', 'MISSING_LOCK_END_DATE');
  }

  const unlockedAt =
    typeof payload.unlockedAt === 'string' && payload.unlockedAt
      ? payload.unlockedAt
      : new Date().toISOString();

  if (!hasDatabase()) {
    return {
      unlockTxSignature: payload.unlockTxSignature,
      walletAddress,
      courseId: payload.courseId,
      lockAccountAddress: payload.lockAccountAddress,
      principalAmountUi: payload.principalAmountUi,
      skrLockedAmountUi: payload.skrLockedAmountUi,
      lockEndAt: payload.lockEndDate,
      unlockedAt,
      verifiedSlot: null,
      verifiedBlockTime: null,
    };
  }

  if (!hasLockVaultReadConfig()) {
    throw badRequest('LockVault read config is incomplete', 'LOCK_VAULT_READ_DISABLED');
  }

  const verification = await verifyUnlockTransaction({
    unlockTxSignature: payload.unlockTxSignature,
    walletAddress,
    lockAccountAddress: payload.lockAccountAddress,
  });
  if (!verification.valid) {
    throw badRequest('Unlock transaction could not be verified', verification.reason);
  }

  return withTransactionAsWallet(walletAddress, async (client) => {
    const existing = await readUnlockReceipt(client, walletAddress, payload.unlockTxSignature);
    if (existing) {
      return existing;
    }

    await client.query(
      `
        insert into lesson.unlock_receipts (
          unlock_tx_signature,
          wallet_address,
          course_id,
          lock_account_address,
          principal_amount_ui,
          skr_locked_amount_ui,
          lock_end_at,
          unlocked_at,
          verified_slot,
          verified_block_time
        )
        values ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8::timestamptz, $9::bigint, $10::timestamptz)
        on conflict (unlock_tx_signature) do nothing
      `,
      [
        payload.unlockTxSignature,
        walletAddress,
        payload.courseId,
        verification.lockAccountAddress ?? payload.lockAccountAddress,
        payload.principalAmountUi,
        payload.skrLockedAmountUi,
        payload.lockEndDate,
        unlockedAt,
        verification.slot,
        verification.blockTime,
      ],
    );

    return readUnlockReceipt(client, walletAddress, payload.unlockTxSignature);
  });
}

export async function getUnlockReceipts(walletAddress, limit = 20) {
  if (!hasDatabase()) {
    return {
      receipts: [],
    };
  }

  const result = await queryAsWallet(
    walletAddress,
    `
      select
        unlock_tx_signature as "unlockTxSignature",
        wallet_address as "walletAddress",
        course_id as "courseId",
        lock_account_address as "lockAccountAddress",
        principal_amount_ui as "principalAmountUi",
        skr_locked_amount_ui as "skrLockedAmountUi",
        lock_end_at as "lockEndAt",
        unlocked_at as "unlockedAt",
        verified_slot as "verifiedSlot",
        verified_block_time as "verifiedBlockTime",
        created_at as "createdAt"
      from lesson.unlock_receipts
      where wallet_address = $1
      order by unlocked_at desc
      limit $2
    `,
    [walletAddress, limit],
  );

  return {
    receipts: result.rows,
  };
}

export async function publishVerifiedCompletionEvent(
  eventId = null,
  retryFailed = false,
) {
  if (!hasDatabase()) {
    return {
      processed: false,
      reason: 'NO_DATABASE',
    };
  }

  if (!hasLockVaultRelayConfig()) {
    return {
      processed: false,
      reason: 'LOCK_VAULT_RELAY_DISABLED',
    };
  }

  const claim = await claimVerifiedCompletionEvent(eventId, retryFailed);
  if (!claim.event) {
    return {
      processed: false,
      reason: claim.reason,
    };
  }

  if (claim.reason !== 'CLAIMED') {
    return {
      processed: false,
      reason: claim.reason,
      event: claim.event,
    };
  }

  try {
    const lockTiming = await readLockAccountTiming(
      claim.event.walletAddress,
      claim.event.courseId,
    );
    const completedAtTs = toUnixTimestampSeconds(claim.event.completedAt);

    if (completedAtTs < lockTiming.lockStartTs) {
      const error =
        'Completion predates the on-chain lock start and cannot be published.';
      await markVerifiedCompletionEventFailed(claim.event.eventId, error);
      return {
        processed: false,
        reason: 'PREDATES_LOCK',
        eventId: claim.event.eventId,
        courseId: claim.event.courseId,
        walletAddress: claim.event.walletAddress,
        error,
        lockAccount: lockTiming.lockAccount,
      };
    }

    const publishResult = await publishVerifiedCompletionToLockVault(claim.event);
    await markVerifiedCompletionEventPublished(
      claim.event.eventId,
      publishResult.signature,
    );

    return {
      processed: true,
      reason: 'PUBLISHED',
      eventId: claim.event.eventId,
      courseId: claim.event.courseId,
      walletAddress: claim.event.walletAddress,
      completionDay: claim.event.completionDay,
      rewardUnits: claim.event.rewardUnits,
      signature: publishResult.signature,
      authority: publishResult.authority,
      lockAccount: publishResult.lockAccount,
      receiptAccount: publishResult.receiptAccount,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markVerifiedCompletionEventFailed(claim.event.eventId, message);

    return {
      processed: false,
      reason: 'PUBLISH_FAILED',
      eventId: claim.event.eventId,
      courseId: claim.event.courseId,
      walletAddress: claim.event.walletAddress,
      error: message,
    };
  }
}

export async function publishFuelBurnReceipt(
  walletAddress,
  courseId,
  cycleId,
  retryFailed = false,
) {
  if (!hasDatabase()) {
    return {
      processed: false,
      reason: 'NO_DATABASE',
    };
  }

  if (!hasLockVaultRelayConfig()) {
    return {
      processed: false,
      reason: 'LOCK_VAULT_RELAY_DISABLED',
    };
  }

  const claim = await claimFuelBurnReceipt(
    walletAddress,
    courseId,
    cycleId,
    retryFailed,
  );
  if (!claim.receipt) {
    return {
      processed: false,
      reason: claim.reason,
    };
  }

  if (claim.reason !== 'CLAIMED') {
    return {
      processed: false,
      reason: claim.reason,
      receipt: claim.receipt,
    };
  }

  if (!['BURNED', 'GAUNTLET_LOCKED', 'NO_FUEL'].includes(claim.receipt.reason ?? '')) {
    const error = `Fuel burn receipt reason is not publishable: ${claim.receipt.reason ?? 'UNKNOWN'}`;
    await markFuelBurnReceiptFailed(walletAddress, courseId, cycleId, error);
    return {
      processed: false,
      reason: 'UNPUBLISHABLE_RECEIPT',
      walletAddress,
      courseId,
      cycleId,
      error,
    };
  }

  try {
    const publishResult = await publishFuelBurnToLockVault(claim.receipt);
    await markFuelBurnReceiptPublished(
      walletAddress,
      courseId,
      cycleId,
      publishResult.signature,
    );

    return {
      processed: true,
      reason: 'PUBLISHED',
      walletAddress,
      courseId,
      cycleId,
      burnedAt: claim.receipt.burnedAt,
      signature: publishResult.signature,
      authority: publishResult.authority,
      lockAccount: publishResult.lockAccount,
      receiptAccount: publishResult.receiptAccount,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markFuelBurnReceiptFailed(walletAddress, courseId, cycleId, message);

    return {
      processed: false,
      reason: 'PUBLISH_FAILED',
      walletAddress,
      courseId,
      cycleId,
      error: message,
    };
  }
}

export async function publishMissConsequenceReceipt(
  walletAddress,
  courseId,
  missEventId,
  retryFailed = false,
) {
  if (!hasDatabase()) {
    return {
      processed: false,
      reason: 'NO_DATABASE',
    };
  }

  if (!hasLockVaultRelayConfig()) {
    return {
      processed: false,
      reason: 'LOCK_VAULT_RELAY_DISABLED',
    };
  }

  const claim = await claimMissConsequenceReceipt(
    walletAddress,
    courseId,
    missEventId,
    retryFailed,
  );
  if (!claim.receipt) {
    return {
      processed: false,
      reason: claim.reason,
    };
  }

  if (claim.reason !== 'CLAIMED') {
    return {
      processed: false,
      reason: claim.reason,
      receipt: claim.receipt,
    };
  }

  if (!['SAVER_CONSUMED', 'FULL_CONSEQUENCE', 'GAUNTLET_LOCKED'].includes(claim.receipt.reason ?? '')) {
    const error =
      `Miss consequence receipt reason is not publishable: ${claim.receipt.reason ?? 'UNKNOWN'}`;
    await markMissConsequenceReceiptFailed(walletAddress, courseId, missEventId, error);
    return {
      processed: false,
      reason: 'UNPUBLISHABLE_RECEIPT',
      walletAddress,
      courseId,
      missEventId,
      error,
    };
  }

  try {
    const publishResult = await publishMissConsequenceToLockVault(claim.receipt);
    await markMissConsequenceReceiptPublished(
      walletAddress,
      courseId,
      missEventId,
      publishResult.signature,
    );

    return {
      processed: true,
      reason: 'PUBLISHED',
      walletAddress,
      courseId,
      missEventId,
      missDay: claim.receipt.missDay,
      signature: publishResult.signature,
      authority: publishResult.authority,
      lockAccount: publishResult.lockAccount,
      receiptAccount: publishResult.receiptAccount,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markMissConsequenceReceiptFailed(
      walletAddress,
      courseId,
      missEventId,
      message,
    );

    return {
      processed: false,
      reason: 'PUBLISH_FAILED',
      walletAddress,
      courseId,
      missEventId,
      error: message,
    };
  }
}

async function readHarvestResultReceipt(client, walletAddress, courseId, harvestId) {
  const result = await client.query(
    `
      select
        wallet_address as "walletAddress",
        course_id as "courseId",
        harvest_id as "harvestId",
        harvested_at as "harvestedAt",
        gross_yield_amount as "grossYieldAmount",
        applied,
        reason,
        platform_fee_amount as "platformFeeAmount",
        redirected_amount as "redirectedAmount",
        ichor_awarded as "ichorAwarded",
        yield_splitter_status as "yieldSplitterStatus",
        yield_splitter_published_at as "yieldSplitterPublishedAt",
        yield_splitter_last_error as "yieldSplitterLastError",
        yield_splitter_transaction_signature as "yieldSplitterTransactionSignature",
        yield_splitter_receipt_account as "yieldSplitterReceiptAccount",
        lock_vault_status as "lockVaultStatus",
        lock_vault_published_at as "lockVaultPublishedAt",
        lock_vault_last_error as "lockVaultLastError",
        lock_vault_transaction_signature as "lockVaultTransactionSignature",
        community_pot_status as "communityPotStatus",
        community_pot_published_at as "communityPotPublishedAt",
        community_pot_last_error as "communityPotLastError",
        community_pot_transaction_signature as "communityPotTransactionSignature",
        community_pot_window_id as "communityPotWindowId"
      from lesson.harvest_result_receipts
      where wallet_address = $1
        and course_id = $2
        and harvest_id = $3
      limit 1
    `,
    [walletAddress, courseId, harvestId],
  );

  return result.rows[0] ?? null;
}

export async function recordHarvestResult(
  walletAddress,
  courseId,
  harvestId,
  grossYieldAmount,
  harvestedAt = null,
) {
  if (!harvestId || typeof harvestId !== 'string') {
    throw badRequest('harvestId is required', 'MISSING_HARVEST_ID');
  }

  const amount =
    typeof grossYieldAmount === 'string' || typeof grossYieldAmount === 'number'
      ? BigInt(grossYieldAmount)
      : null;
  if (amount == null || amount < 0n) {
    throw badRequest('grossYieldAmount must be a non-negative integer', 'INVALID_GROSS_YIELD');
  }

  const harvestedAtValue = harvestedAt ?? new Date().toISOString();

  if (!hasDatabase()) {
    return {
      harvestId,
      harvestedAt: harvestedAtValue,
      grossYieldAmount: amount.toString(),
      yieldSplitterStatus: 'pending',
      lockVaultStatus: 'pending',
      communityPotStatus: 'pending',
    };
  }

  return withTransactionAsWallet(walletAddress, async (client) => {
    const existingReceipt = await readHarvestResultReceipt(
      client,
      walletAddress,
      courseId,
      harvestId,
    );

    if (existingReceipt) {
      return existingReceipt;
    }

    await client.query(
      `
        insert into lesson.harvest_result_receipts (
          wallet_address,
          course_id,
          harvest_id,
          harvested_at,
          gross_yield_amount
        )
        values ($1, $2, $3, $4::timestamptz, $5::bigint)
      `,
      [walletAddress, courseId, harvestId, harvestedAtValue, amount.toString()],
    );

    return readHarvestResultReceipt(client, walletAddress, courseId, harvestId);
  });
}

async function claimHarvestSplitReceipt(
  walletAddress,
  courseId,
  harvestId,
  retryFailed = false,
) {
  const claimableStatuses = retryFailed ? ['pending', 'failed'] : ['pending'];
  const result = await query(
    `
      update lesson.harvest_result_receipts
      set yield_splitter_status = 'publishing',
          yield_splitter_last_error = null
      where wallet_address = $1
        and course_id = $2
        and harvest_id = $3
        and yield_splitter_status = any($4::text[])
      returning
        wallet_address as "walletAddress",
        course_id as "courseId",
        harvest_id as "harvestId",
        harvested_at as "harvestedAt",
        gross_yield_amount as "grossYieldAmount",
        applied,
        reason,
        platform_fee_amount as "platformFeeAmount",
        redirected_amount as "redirectedAmount",
        ichor_awarded as "ichorAwarded",
        yield_splitter_status as "yieldSplitterStatus",
        yield_splitter_transaction_signature as "yieldSplitterTransactionSignature",
        yield_splitter_receipt_account as "yieldSplitterReceiptAccount"
    `,
    [walletAddress, courseId, harvestId, claimableStatuses],
  );

  if (result.rowCount > 0) {
    return { receipt: result.rows[0], reason: 'CLAIMED' };
  }

  const current = await readHarvestResultReceipt(
    { query: (...args) => query(...args) },
    walletAddress,
    courseId,
    harvestId,
  );

  if (!current) {
    return { receipt: null, reason: 'RECEIPT_NOT_FOUND' };
  }

  if (current.yieldSplitterStatus === 'published') {
    return { receipt: current, reason: 'ALREADY_PUBLISHED' };
  }

  if (current.yieldSplitterStatus === 'publishing') {
    return { receipt: current, reason: 'ALREADY_PUBLISHING' };
  }

  return { receipt: current, reason: 'RETRY_REQUIRED' };
}

async function markHarvestSplitReceiptPublished(
  walletAddress,
  courseId,
  harvestId,
  values,
) {
  await query(
    `
      update lesson.harvest_result_receipts
      set yield_splitter_status = 'published',
          yield_splitter_published_at = now(),
          yield_splitter_last_error = null,
          yield_splitter_transaction_signature = $4,
          yield_splitter_receipt_account = $5,
          applied = $6,
          reason = $7,
          platform_fee_amount = $8::bigint,
          redirected_amount = $9::bigint,
          ichor_awarded = $10::bigint
      where wallet_address = $1
        and course_id = $2
        and harvest_id = $3
    `,
    [
      walletAddress,
      courseId,
      harvestId,
      values.signature,
      values.receiptAccount,
      values.applied,
      values.reason,
      values.platformFeeAmount,
      values.redirectedAmount,
      values.ichorAwarded,
    ],
  );
}

async function markHarvestSplitReceiptFailed(walletAddress, courseId, harvestId, error) {
  await query(
    `
      update lesson.harvest_result_receipts
      set yield_splitter_status = 'failed',
          yield_splitter_last_error = $4
      where wallet_address = $1
        and course_id = $2
        and harvest_id = $3
    `,
    [walletAddress, courseId, harvestId, error],
  );
}

export async function publishHarvestSplitReceipt(
  walletAddress,
  courseId,
  harvestId,
  retryFailed = false,
) {
  if (!hasDatabase()) {
    return {
      processed: false,
      reason: 'NO_DATABASE',
    };
  }

  if (!hasYieldSplitterRelayConfig()) {
    return {
      processed: false,
      reason: 'YIELD_SPLITTER_RELAY_DISABLED',
    };
  }

  const claim = await claimHarvestSplitReceipt(walletAddress, courseId, harvestId, retryFailed);
  if (!claim.receipt) {
    return {
      processed: false,
      reason: claim.reason,
    };
  }

  if (claim.reason !== 'CLAIMED') {
    return {
      processed: false,
      reason: claim.reason,
      receipt: claim.receipt,
    };
  }

  try {
    const snapshotBefore = await readLockAccountSnapshot(walletAddress, courseId);
    const publishResult = await publishHarvestSplitToYieldSplitter({
      walletAddress,
      courseId,
      harvestId,
      grossYieldAmount: claim.receipt.grossYieldAmount,
      redirectBps: snapshotBefore.currentYieldRedirectBps,
      brewerActive: snapshotBefore.gauntletComplete && snapshotBefore.fuelCounter > 0,
      skrTier: snapshotBefore.skrTier,
      processedAt: claim.receipt.harvestedAt,
    });

    const applied = BigInt(publishResult.receipt.ichorAwarded) > 0n;
    const reason = applied ? 'HARVEST_APPLIED' : 'HARVEST_SKIPPED';

    await markHarvestSplitReceiptPublished(walletAddress, courseId, harvestId, {
      signature: publishResult.signature,
      receiptAccount: publishResult.receiptAccount,
      applied,
      reason,
      platformFeeAmount: publishResult.receipt.platformFeeAmount,
      redirectedAmount: publishResult.receipt.redirectedAmount,
      ichorAwarded: publishResult.receipt.ichorAwarded,
    });

    return {
      processed: true,
      reason: 'PUBLISHED',
      walletAddress,
      courseId,
      harvestId,
      grossYieldAmount: claim.receipt.grossYieldAmount,
      applied,
      harvestReason: reason,
      platformFeeAmount: publishResult.receipt.platformFeeAmount,
      redirectedAmount: publishResult.receipt.redirectedAmount,
      ichorAwarded: publishResult.receipt.ichorAwarded,
      signature: publishResult.signature,
      authority: publishResult.authority,
      lockAccount: publishResult.lockAccount,
      receiptAccount: publishResult.receiptAccount,
      yieldSplitterReceipt: publishResult.receipt,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markHarvestSplitReceiptFailed(walletAddress, courseId, harvestId, message);

    return {
      processed: false,
      reason: 'PUBLISH_FAILED',
      walletAddress,
      courseId,
      harvestId,
      error: message,
    };
  }
}

async function claimHarvestResultReceipt(
  walletAddress,
  courseId,
  harvestId,
  retryFailed = false,
) {
  const claimableStatuses = retryFailed ? ['pending', 'failed'] : ['pending'];
  const result = await query(
    `
      update lesson.harvest_result_receipts
      set lock_vault_status = 'publishing',
          lock_vault_last_error = null
      where wallet_address = $1
        and course_id = $2
        and harvest_id = $3
        and yield_splitter_status = 'published'
        and lock_vault_status = any($4::text[])
      returning
        wallet_address as "walletAddress",
        course_id as "courseId",
        harvest_id as "harvestId",
        harvested_at as "harvestedAt",
        gross_yield_amount as "grossYieldAmount",
        applied,
        reason,
        platform_fee_amount as "platformFeeAmount",
        redirected_amount as "redirectedAmount",
        ichor_awarded as "ichorAwarded"
    `,
    [walletAddress, courseId, harvestId, claimableStatuses],
  );

  if (result.rowCount > 0) {
    return { receipt: result.rows[0], reason: 'CLAIMED' };
  }

  const current = await query(
    `
      select
        wallet_address as "walletAddress",
        course_id as "courseId",
        harvest_id as "harvestId",
        harvested_at as "harvestedAt",
        gross_yield_amount as "grossYieldAmount",
        applied,
        reason,
        yield_splitter_status as "yieldSplitterStatus",
        platform_fee_amount as "platformFeeAmount",
        redirected_amount as "redirectedAmount",
        ichor_awarded as "ichorAwarded",
        lock_vault_status as "lockVaultStatus",
        lock_vault_published_at as "lockVaultPublishedAt",
        lock_vault_last_error as "lockVaultLastError",
        lock_vault_transaction_signature as "lockVaultTransactionSignature"
      from lesson.harvest_result_receipts
      where wallet_address = $1
        and course_id = $2
        and harvest_id = $3
      limit 1
    `,
    [walletAddress, courseId, harvestId],
  );

  if (current.rowCount === 0) {
    return { receipt: null, reason: 'RECEIPT_NOT_FOUND' };
  }

  const existing = current.rows[0];
  if (existing.yieldSplitterStatus !== 'published') {
    return { receipt: existing, reason: 'YIELD_SPLITTER_NOT_PUBLISHED' };
  }

  if (existing.lockVaultStatus === 'published') {
    return { receipt: existing, reason: 'ALREADY_PUBLISHED' };
  }

  if (existing.lockVaultStatus === 'publishing') {
    return { receipt: existing, reason: 'ALREADY_PUBLISHING' };
  }

  return { receipt: existing, reason: 'RETRY_REQUIRED' };
}

async function markHarvestResultReceiptPublished(
  walletAddress,
  courseId,
  harvestId,
  values,
) {
  await query(
    `
      update lesson.harvest_result_receipts
      set lock_vault_status = 'published',
          lock_vault_published_at = now(),
          lock_vault_last_error = null,
          lock_vault_transaction_signature = $4,
          applied = $5,
          reason = $6,
          platform_fee_amount = $7::bigint,
          redirected_amount = $8::bigint,
          ichor_awarded = $9::bigint
      where wallet_address = $1
        and course_id = $2
        and harvest_id = $3
    `,
    [
      walletAddress,
      courseId,
      harvestId,
      values.signature,
      values.applied,
      values.reason,
      values.platformFeeAmount,
      values.redirectedAmount,
      values.ichorAwarded,
    ],
  );
}

async function markHarvestResultReceiptFailed(walletAddress, courseId, harvestId, error) {
  await query(
    `
      update lesson.harvest_result_receipts
      set lock_vault_status = 'failed',
          lock_vault_last_error = $4
      where wallet_address = $1
        and course_id = $2
        and harvest_id = $3
    `,
    [walletAddress, courseId, harvestId, error],
  );
}

export async function publishHarvestResultReceipt(
  walletAddress,
  courseId,
  harvestId,
  retryFailed = false,
) {
  if (!hasDatabase()) {
    return {
      processed: false,
      reason: 'NO_DATABASE',
    };
  }

  if (!hasLockVaultRelayConfig()) {
    return {
      processed: false,
      reason: 'LOCK_VAULT_RELAY_DISABLED',
    };
  }

  const yieldSplit = await publishHarvestSplitReceipt(
    walletAddress,
    courseId,
    harvestId,
    retryFailed,
  );
  if (!yieldSplit.processed && yieldSplit.reason !== 'ALREADY_PUBLISHED') {
    return {
      processed: false,
      reason: 'YIELD_SPLITTER_NOT_READY',
      walletAddress,
      courseId,
      harvestId,
      yieldSplitter: yieldSplit,
    };
  }

  const claim = await claimHarvestResultReceipt(
    walletAddress,
    courseId,
    harvestId,
    retryFailed,
  );
  if (!claim.receipt) {
    return {
      processed: false,
      reason: claim.reason,
    };
  }

  if (claim.reason !== 'CLAIMED') {
    return {
      processed: false,
      reason: claim.reason,
      receipt: claim.receipt,
    };
  }

  try {
    const snapshotBefore = await readLockAccountSnapshot(walletAddress, courseId);
    const publishResult = await publishHarvestToLockVault({
      walletAddress,
      courseId,
      harvestId,
      grossYieldAmount: claim.receipt.grossYieldAmount,
    });
    const snapshotAfter = await readLockAccountSnapshot(walletAddress, courseId);

    const applied =
      snapshotAfter.ichorCounter > snapshotBefore.ichorCounter ||
      snapshotAfter.ichorLifetimeTotal > snapshotBefore.ichorLifetimeTotal;
    const platformFeeAmount = String(claim.receipt.platformFeeAmount ?? 0);
    const redirectedAmount = String(claim.receipt.redirectedAmount ?? 0);
    const ichorAwarded = String(claim.receipt.ichorAwarded ?? 0);
    const reason = claim.receipt.reason ?? (applied ? 'HARVEST_APPLIED' : 'HARVEST_SKIPPED');

    await markHarvestResultReceiptPublished(walletAddress, courseId, harvestId, {
      signature: publishResult.signature,
      applied,
      reason,
      platformFeeAmount,
      redirectedAmount,
      ichorAwarded,
    });
    await syncCourseRuntimeStateWithLockSnapshot(walletAddress, courseId, snapshotAfter);

    return {
      processed: true,
      reason: 'PUBLISHED',
      walletAddress,
      courseId,
      harvestId,
      grossYieldAmount: claim.receipt.grossYieldAmount,
      applied,
      harvestReason: reason,
      platformFeeAmount,
      redirectedAmount,
      ichorAwarded,
      signature: publishResult.signature,
      authority: publishResult.authority,
      lockAccount: publishResult.lockAccount,
      receiptAccount: publishResult.receiptAccount,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markHarvestResultReceiptFailed(walletAddress, courseId, harvestId, message);

    return {
      processed: false,
      reason: 'PUBLISH_FAILED',
      walletAddress,
      courseId,
      harvestId,
      error: message,
    };
  }
}

async function claimHarvestRedirectReceipt(
  walletAddress,
  courseId,
  harvestId,
  retryFailed = false,
) {
  const claimableStatuses = retryFailed ? ['pending', 'failed'] : ['pending'];
  const result = await query(
    `
      update lesson.harvest_result_receipts
      set community_pot_status = 'publishing',
          community_pot_last_error = null
      where wallet_address = $1
        and course_id = $2
        and harvest_id = $3
        and lock_vault_status = 'published'
        and community_pot_status = any($4::text[])
      returning
        wallet_address as "walletAddress",
        course_id as "courseId",
        harvest_id as "harvestId",
        harvested_at as "harvestedAt",
        gross_yield_amount as "grossYieldAmount",
        redirected_amount as "redirectedAmount",
        lock_vault_status as "lockVaultStatus",
        community_pot_status as "communityPotStatus"
    `,
    [walletAddress, courseId, harvestId, claimableStatuses],
  );

  if (result.rowCount > 0) {
    return { receipt: result.rows[0], reason: 'CLAIMED' };
  }

  const current = await query(
    `
      select
        wallet_address as "walletAddress",
        course_id as "courseId",
        harvest_id as "harvestId",
        harvested_at as "harvestedAt",
        gross_yield_amount as "grossYieldAmount",
        redirected_amount as "redirectedAmount",
        lock_vault_status as "lockVaultStatus",
        community_pot_status as "communityPotStatus",
        community_pot_published_at as "communityPotPublishedAt",
        community_pot_last_error as "communityPotLastError",
        community_pot_transaction_signature as "communityPotTransactionSignature",
        community_pot_window_id as "communityPotWindowId"
      from lesson.harvest_result_receipts
      where wallet_address = $1
        and course_id = $2
        and harvest_id = $3
      limit 1
    `,
    [walletAddress, courseId, harvestId],
  );

  if (current.rowCount === 0) {
    return { receipt: null, reason: 'RECEIPT_NOT_FOUND' };
  }

  const existing = current.rows[0];
  if (existing.lockVaultStatus !== 'published') {
    return { receipt: existing, reason: 'LOCK_VAULT_NOT_PUBLISHED' };
  }

  if (existing.communityPotStatus === 'published') {
    return { receipt: existing, reason: 'ALREADY_PUBLISHED' };
  }

  if (existing.communityPotStatus === 'publishing') {
    return { receipt: existing, reason: 'ALREADY_PUBLISHING' };
  }

  return { receipt: existing, reason: 'RETRY_REQUIRED' };
}

async function markHarvestRedirectPublished(
  walletAddress,
  courseId,
  harvestId,
  values,
) {
  await query(
    `
      update lesson.harvest_result_receipts
      set community_pot_status = 'published',
          community_pot_published_at = now(),
          community_pot_last_error = null,
          community_pot_transaction_signature = $4,
          community_pot_window_id = $5::bigint
      where wallet_address = $1
        and course_id = $2
        and harvest_id = $3
    `,
    [
      walletAddress,
      courseId,
      harvestId,
      values.signature,
      values.windowId,
    ],
  );
}

async function markHarvestRedirectFailed(walletAddress, courseId, harvestId, error) {
  await query(
    `
      update lesson.harvest_result_receipts
      set community_pot_status = 'failed',
          community_pot_last_error = $4
      where wallet_address = $1
        and course_id = $2
        and harvest_id = $3
    `,
    [walletAddress, courseId, harvestId, error],
  );
}

function computeWeightedPayouts(totalAmount, entries) {
  if (entries.length === 0 || totalAmount <= 0n) {
    return entries.map((entry) => ({
      ...entry,
      payoutAmount: 0n,
      remainder: 0n,
    }));
  }

  const totalWeight = entries.reduce((sum, entry) => sum + entry.weight, 0n);
  if (totalWeight <= 0n) {
    return entries.map((entry) => ({
      ...entry,
      payoutAmount: 0n,
      remainder: 0n,
    }));
  }

  const provisional = entries.map((entry) => {
    const numerator = totalAmount * entry.weight;
    return {
      ...entry,
      payoutAmount: numerator / totalWeight,
      remainder: numerator % totalWeight,
    };
  });

  const allocated = provisional.reduce((sum, entry) => sum + entry.payoutAmount, 0n);
  let leftover = totalAmount - allocated;
  const ranked = [...provisional].sort((left, right) => {
    if (left.remainder === right.remainder) {
      return `${left.walletAddress}:${left.courseId}`.localeCompare(
        `${right.walletAddress}:${right.courseId}`,
      );
    }
    return left.remainder > right.remainder ? -1 : 1;
  });

  for (const entry of ranked) {
    if (leftover <= 0n) {
      break;
    }
    entry.payoutAmount += 1n;
    leftover -= 1n;
  }

  return provisional;
}

async function readDistributionSnapshotRows(windowId) {
  const result = await query(
    `
      select
        window_id as "windowId",
        wallet_address as "walletAddress",
        course_id as "courseId",
        current_streak as "currentStreak",
        principal_amount as "principalAmount",
        weight,
        payout_amount as "payoutAmount",
        status,
        distribution_transaction_signature as "distributionTransactionSignature",
        distribution_last_error as "distributionLastError",
        distributed_at as "distributedAt",
        created_at as "createdAt",
        updated_at as "updatedAt"
      from lesson.community_pot_distribution_snapshots
      where window_id = $1
      order by payout_amount desc, wallet_address asc, course_id asc
    `,
    [windowId],
  );

  return result.rows;
}

async function claimDistributionSnapshotRows(windowId, batchSize = 10, retryFailed = false) {
  const claimableStatuses = retryFailed ? ['pending', 'failed'] : ['pending'];
  const result = await query(
    `
      with next_rows as (
        select ctid
        from lesson.community_pot_distribution_snapshots
        where window_id = $1
          and status = any($2::text[])
        order by payout_amount desc, wallet_address asc, course_id asc
        limit $3
        for update skip locked
      )
      update lesson.community_pot_distribution_snapshots snapshots
      set status = 'publishing',
          distribution_last_error = null,
          updated_at = now()
      from next_rows
      where snapshots.ctid = next_rows.ctid
      returning
        window_id as "windowId",
        wallet_address as "walletAddress",
        course_id as "courseId",
        current_streak as "currentStreak",
        principal_amount as "principalAmount",
        weight,
        payout_amount as "payoutAmount",
        status
    `,
    [windowId, claimableStatuses, batchSize],
  );

  return result.rows;
}

async function markDistributionSnapshotDistributed(
  windowId,
  walletAddress,
  courseId,
  signature,
) {
  await query(
    `
      update lesson.community_pot_distribution_snapshots
      set status = 'distributed',
          distribution_transaction_signature = $4,
          distribution_last_error = null,
          distributed_at = now(),
          updated_at = now()
      where window_id = $1
        and wallet_address = $2
        and course_id = $3
    `,
    [windowId, walletAddress, courseId, signature],
  );
}

async function markDistributionSnapshotFailed(windowId, walletAddress, courseId, error) {
  await query(
    `
      update lesson.community_pot_distribution_snapshots
      set status = 'failed',
          distribution_last_error = $4,
          updated_at = now()
      where window_id = $1
        and wallet_address = $2
        and course_id = $3
    `,
    [windowId, walletAddress, courseId, error],
  );
}

async function seedDistributionSnapshotRows(windowId, entries) {
  if (entries.length === 0) {
    return [];
  }

  const values = [];
  const params = [];
  let index = 1;

  for (const entry of entries) {
    values.push(
      `($${index++}, $${index++}, $${index++}, $${index++}, $${index++}::bigint, $${index++}::bigint, $${index++}::bigint)`,
    );
    params.push(
      windowId,
      entry.walletAddress,
      entry.courseId,
      entry.currentStreak,
      entry.principalAmount.toString(),
      entry.weight.toString(),
      entry.payoutAmount.toString(),
    );
  }

  await query(
    `
      insert into lesson.community_pot_distribution_snapshots (
        window_id,
        wallet_address,
        course_id,
        current_streak,
        principal_amount,
        weight,
        payout_amount
      )
      values ${values.join(', ')}
      on conflict (window_id, wallet_address, course_id) do nothing
    `,
    params,
  );

  return readDistributionSnapshotRows(windowId);
}

export async function publishHarvestRedirectToCommunityPot(
  walletAddress,
  courseId,
  harvestId,
  retryFailed = false,
) {
  if (!hasDatabase()) {
    return {
      processed: false,
      reason: 'NO_DATABASE',
    };
  }

  if (!hasCommunityPotRelayConfig()) {
    return {
      processed: false,
      reason: 'COMMUNITY_POT_RELAY_DISABLED',
    };
  }

  const claim = await claimHarvestRedirectReceipt(
    walletAddress,
    courseId,
    harvestId,
    retryFailed,
  );
  if (!claim.receipt) {
    return {
      processed: false,
      reason: claim.reason,
    };
  }

  if (claim.reason !== 'CLAIMED') {
    return {
      processed: false,
      reason: claim.reason,
      receipt: claim.receipt,
    };
  }

  try {
    const redirectedAmount = BigInt(claim.receipt.redirectedAmount ?? 0);
    const windowId = deriveCommunityPotWindowId(claim.receipt.harvestedAt);

    if (redirectedAmount <= 0n) {
      await markHarvestRedirectPublished(walletAddress, courseId, harvestId, {
        signature: null,
        windowId,
      });

      return {
        processed: true,
        reason: 'SKIPPED_NO_REDIRECT',
        walletAddress,
        courseId,
        harvestId,
        redirectedAmount: redirectedAmount.toString(),
        windowId,
      };
    }

    const publishResult = await publishRedirectToCommunityPot({
      redirectEventId: harvestId,
      harvestedAt: claim.receipt.harvestedAt,
      redirectedAmount: redirectedAmount.toString(),
    });

    await markHarvestRedirectPublished(walletAddress, courseId, harvestId, {
      signature: publishResult.signature,
      windowId: publishResult.windowId,
    });

    return {
      processed: true,
      reason: 'PUBLISHED',
      walletAddress,
      courseId,
      harvestId,
      redirectedAmount: redirectedAmount.toString(),
      signature: publishResult.signature,
      authority: publishResult.authority,
      windowId: publishResult.windowId,
      windowAccount: publishResult.windowAccount,
      receiptAccount: publishResult.receiptAccount,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markHarvestRedirectFailed(walletAddress, courseId, harvestId, message);

    return {
      processed: false,
      reason: 'PUBLISH_FAILED',
      walletAddress,
      courseId,
      harvestId,
      error: message,
    };
  }
}

export async function closeCommunityPotWindowAndSnapshot(windowId, closedAt = null) {
  if (!hasDatabase()) {
    return {
      processed: false,
      reason: 'NO_DATABASE',
    };
  }

  if (!hasCommunityPotRelayConfig()) {
    return {
      processed: false,
      reason: 'COMMUNITY_POT_RELAY_DISABLED',
    };
  }

  const existingDistributionWindow = await readCommunityPotDistributionWindow(windowId);
  const existingRows = await readDistributionSnapshotRows(windowId);
  const repairableEmptyWindow =
    existingDistributionWindow &&
    Number(existingDistributionWindow.totalWeight) === 0 &&
    Number(existingDistributionWindow.eligibleRecipientCount) === 0 &&
    Number(existingDistributionWindow.distributionCount) === 0 &&
    existingRows.length === 0;

  if (existingDistributionWindow && !repairableEmptyWindow) {
    return {
      processed: false,
      reason: 'ALREADY_CLOSED',
      distributionWindow: existingDistributionWindow,
      recipients: existingRows,
    };
  }

  const potWindow = await readCommunityPotWindow(windowId);
  if (!potWindow) {
    return {
      processed: false,
      reason: 'WINDOW_NOT_FOUND',
    };
  }

  const runtimeResult = await query(
    `
      select
        wallet_address as "walletAddress",
        course_id as "courseId"
      from lesson.user_course_runtime_state
      order by wallet_address asc, course_id asc
    `,
  );

  const eligible = [];
  for (const row of runtimeResult.rows) {
    try {
      const snapshot = await readLockAccountSnapshot(row.walletAddress, row.courseId);
      if (snapshot.status !== 0) {
        continue;
      }

      const currentStreak = Number(snapshot.currentStreak ?? 0);
      if (currentStreak <= 0) {
        continue;
      }

      const principalAmount = BigInt(snapshot.principalAmount);
      const weight = principalAmount * BigInt(currentStreak);
      if (weight <= 0n) {
        continue;
      }

      eligible.push({
        walletAddress: row.walletAddress,
        courseId: row.courseId,
        currentStreak,
        principalAmount,
        weight,
      });
    } catch {
      // Skip locks that no longer exist or cannot be read.
    }
  }

  const payouts = computeWeightedPayouts(BigInt(potWindow.totalRedirectedAmount), eligible);
  const rows = await seedDistributionSnapshotRows(windowId, payouts);
  const totalWeight = payouts.reduce((sum, entry) => sum + entry.weight, 0n);
  const closedAtValue = closedAt ?? new Date().toISOString();
  const closeResult = await closeCommunityPotDistributionWindow({
    windowId,
    totalWeight: totalWeight.toString(),
    eligibleRecipientCount: payouts.length,
    closedAt: closedAtValue,
  });
  const distributionWindow = await readCommunityPotDistributionWindow(windowId);

  return {
    processed: true,
    reason: 'CLOSED',
    windowId,
    potWindow,
    distributionWindow,
    signature: closeResult.signature,
    recipients: rows,
  };
}

export async function distributeCommunityPotWindowBatch(
  windowId,
  batchSize = 10,
  retryFailed = false,
) {
  if (!hasDatabase()) {
    return {
      processed: false,
      reason: 'NO_DATABASE',
    };
  }

  if (!hasCommunityPotRelayConfig()) {
    return {
      processed: false,
      reason: 'COMMUNITY_POT_RELAY_DISABLED',
    };
  }

  const distributionWindow = await readCommunityPotDistributionWindow(windowId);
  if (!distributionWindow) {
    return {
      processed: false,
      reason: 'WINDOW_NOT_CLOSED',
    };
  }

  const claimedRows = await claimDistributionSnapshotRows(windowId, batchSize, retryFailed);
  if (claimedRows.length === 0) {
    return {
      processed: false,
      reason: 'NO_PENDING_RECIPIENTS',
      distributionWindow,
      recipients: await readDistributionSnapshotRows(windowId),
    };
  }

  const potVaultBefore = await readCommunityPotVaultBalance();
  const results = [];

  for (const row of claimedRows) {
    try {
      const publishResult = await distributeCommunityPotWindow({
        windowId,
        walletAddress: row.walletAddress,
        courseId: row.courseId,
        amount: row.payoutAmount,
        distributedAt: new Date().toISOString(),
      });

      await markDistributionSnapshotDistributed(
        windowId,
        row.walletAddress,
        row.courseId,
        publishResult.signature,
      );

      results.push({
        walletAddress: row.walletAddress,
        courseId: row.courseId,
        payoutAmount: row.payoutAmount,
        status: 'distributed',
        signature: publishResult.signature,
        recipientStableTokenAccount: publishResult.recipientStableTokenAccount,
        potVault: publishResult.potVault,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await markDistributionSnapshotFailed(windowId, row.walletAddress, row.courseId, message);
      results.push({
        walletAddress: row.walletAddress,
        courseId: row.courseId,
        payoutAmount: row.payoutAmount,
        status: 'failed',
        error: message,
      });
    }
  }

  return {
    processed: true,
    reason: 'DISTRIBUTION_BATCH_PROCESSED',
    windowId,
    potVaultBefore,
    potVaultAfter: await readCommunityPotVaultBalance(),
    distributionWindow: await readCommunityPotDistributionWindow(windowId),
    recipients: await readDistributionSnapshotRows(windowId),
    results,
  };
}

export async function getCommunityPotHistory(walletAddress, limit = 6) {
  if (!hasDatabase()) {
    return {
      windows: [],
    };
  }

  const idsResult = await query(
    `
      with window_ids as (
        select distinct community_pot_window_id as window_id
        from lesson.harvest_result_receipts
        where community_pot_window_id is not null
        union
        select distinct window_id
        from lesson.community_pot_distribution_snapshots
      )
      select window_id
      from window_ids
      where window_id is not null
      order by window_id desc
      limit $1
    `,
    [limit],
  );

  const walletRowsResult = await query(
    `
      select
        window_id as "windowId",
        wallet_address as "walletAddress",
        course_id as "courseId",
        current_streak as "currentStreak",
        principal_amount as "principalAmount",
        weight,
        payout_amount as "payoutAmount",
        status,
        distribution_transaction_signature as "distributionTransactionSignature",
        distribution_last_error as "distributionLastError",
        distributed_at as "distributedAt"
      from lesson.community_pot_distribution_snapshots
      where wallet_address = $1
    `,
    [walletAddress],
  );

  const walletRowsByWindow = new Map(
    walletRowsResult.rows.map((row) => [Number(row.windowId), row]),
  );

  const windows = await Promise.all(
    idsResult.rows.map(async (row) => {
      const windowId = Number(row.window_id);
      const [potWindow, distributionWindow] = await Promise.all([
        readCommunityPotWindow(windowId),
        readCommunityPotDistributionWindow(windowId),
      ]);
      const walletRow = walletRowsByWindow.get(windowId) ?? null;
      const totalRedirectedAmount = BigInt(potWindow?.totalRedirectedAmount ?? 0);
      const distributedAmount = BigInt(distributionWindow?.distributedAmount ?? 0);
      const remainingAmount = totalRedirectedAmount - distributedAmount;

      return {
        windowId,
        windowLabel: formatCommunityPotWindowLabel(windowId),
        totalRedirectedAmount: totalRedirectedAmount.toString(),
        totalRedirectedAmountUi: formatAtomicUsdcUi(totalRedirectedAmount),
        distributedAmount: distributedAmount.toString(),
        distributedAmountUi: formatAtomicUsdcUi(distributedAmount),
        remainingAmount: (remainingAmount > 0n ? remainingAmount : 0n).toString(),
        remainingAmountUi: formatAtomicUsdcUi(remainingAmount > 0n ? remainingAmount : 0n),
        redirectCount: Number(potWindow?.redirectCount ?? 0),
        eligibleRecipientCount: Number(distributionWindow?.eligibleRecipientCount ?? 0),
        distributionCount: Number(distributionWindow?.distributionCount ?? 0),
        status: mapDistributionWindowStatus(distributionWindow?.status ?? 0),
        closedAt: unixTimestampSecondsToIso(distributionWindow?.closedAtTs ?? null),
        userPayoutAmount:
          walletRow?.payoutAmount != null ? String(walletRow.payoutAmount) : null,
        userPayoutAmountUi:
          walletRow?.payoutAmount != null
            ? formatAtomicUsdcUi(walletRow.payoutAmount)
            : null,
        userStatus: mapRecipientStatus(walletRow?.status ?? null),
        userDistributedAt: walletRow?.distributedAt ?? null,
        userTransactionSignature: walletRow?.distributionTransactionSignature ?? null,
        userLastError: walletRow?.distributionLastError ?? null,
      };
    }),
  );

  return {
    windows,
  };
}

function mapHarvestRelayStatus(rawStatus) {
  if (rawStatus === 'published') return 'published';
  if (rawStatus === 'publishing') return 'publishing';
  if (rawStatus === 'failed') return 'failed';
  return 'pending';
}

function mapHarvestKind(harvestId) {
  if (typeof harvestId === 'string' && harvestId.startsWith('auto-harvest:')) {
    return 'AUTO';
  }
  return 'MANUAL';
}

export async function getYieldHistory(walletAddress, courseId, limit = 10) {
  if (!hasDatabase()) {
    return {
      courseId,
      totalHarvests: 0,
      totalGrossYield: '0',
      totalGrossYieldUi: '0',
      totalPlatformFee: '0',
      totalPlatformFeeUi: '0',
      totalRedirected: '0',
      totalRedirectedUi: '0',
      totalIchorAwarded: '0',
      entries: [],
    };
  }

  const [summaryResult, rowsResult] = await Promise.all([
    query(
      `
        select
          count(*)::int as "totalHarvests",
          coalesce(sum(gross_yield_amount), 0)::text as "totalGrossYield",
          coalesce(sum(platform_fee_amount), 0)::text as "totalPlatformFee",
          coalesce(sum(redirected_amount), 0)::text as "totalRedirected",
          coalesce(sum(ichor_awarded), 0)::text as "totalIchorAwarded"
        from lesson.harvest_result_receipts
        where wallet_address = $1
          and course_id = $2
      `,
      [walletAddress, courseId],
    ),
    query(
      `
        select
          harvest_id as "harvestId",
          harvested_at as "harvestedAt",
          gross_yield_amount::text as "grossYieldAmount",
          applied,
          reason,
          coalesce(platform_fee_amount, 0)::text as "platformFeeAmount",
          coalesce(redirected_amount, 0)::text as "redirectedAmount",
          coalesce(ichor_awarded, 0)::text as "ichorAwarded",
          yield_splitter_status as "yieldSplitterStatus",
          yield_splitter_transaction_signature as "yieldSplitterTransactionSignature",
          lock_vault_status as "lockVaultStatus",
          lock_vault_transaction_signature as "lockVaultTransactionSignature",
          community_pot_status as "communityPotStatus",
          community_pot_transaction_signature as "communityPotTransactionSignature"
        from lesson.harvest_result_receipts
        where wallet_address = $1
          and course_id = $2
        order by harvested_at desc
        limit $3
      `,
      [walletAddress, courseId, limit],
    ),
  ]);

  const summary = summaryResult.rows[0] ?? {
    totalHarvests: 0,
    totalGrossYield: '0',
    totalPlatformFee: '0',
    totalRedirected: '0',
    totalIchorAwarded: '0',
  };

  return {
    courseId,
    totalHarvests: Number(summary.totalHarvests ?? 0),
    totalGrossYield: String(summary.totalGrossYield ?? '0'),
    totalGrossYieldUi: formatAtomicUsdcUi(summary.totalGrossYield ?? 0),
    totalPlatformFee: String(summary.totalPlatformFee ?? '0'),
    totalPlatformFeeUi: formatAtomicUsdcUi(summary.totalPlatformFee ?? 0),
    totalRedirected: String(summary.totalRedirected ?? '0'),
    totalRedirectedUi: formatAtomicUsdcUi(summary.totalRedirected ?? 0),
    totalIchorAwarded: String(summary.totalIchorAwarded ?? '0'),
    entries: rowsResult.rows.map((row) => ({
      harvestId: row.harvestId,
      kind: mapHarvestKind(row.harvestId),
      harvestedAt: row.harvestedAt,
      grossYieldAmount: row.grossYieldAmount,
      grossYieldAmountUi: formatAtomicUsdcUi(row.grossYieldAmount),
      applied: row.applied == null ? null : Boolean(row.applied),
      reason: row.reason ?? null,
      platformFeeAmount: row.platformFeeAmount,
      platformFeeAmountUi: formatAtomicUsdcUi(row.platformFeeAmount),
      redirectedAmount: row.redirectedAmount,
      redirectedAmountUi: formatAtomicUsdcUi(row.redirectedAmount),
      ichorAwarded: row.ichorAwarded,
      yieldSplitterStatus: mapHarvestRelayStatus(row.yieldSplitterStatus),
      yieldSplitterTransactionSignature: row.yieldSplitterTransactionSignature ?? null,
      lockVaultStatus: mapHarvestRelayStatus(row.lockVaultStatus),
      lockVaultTransactionSignature: row.lockVaultTransactionSignature ?? null,
      communityPotStatus: mapHarvestRelayStatus(row.communityPotStatus),
      communityPotTransactionSignature: row.communityPotTransactionSignature ?? null,
    })),
  };
}

function truncateWalletAddress(value) {
  if (!value || value.length <= 10) {
    return value;
  }
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

export async function getCommunityPotWindowDetail(walletAddress, windowId) {
  if (!hasDatabase()) {
    return {
      windowId,
      recipients: [],
      userEntry: null,
    };
  }

  const [potWindow, distributionWindow, recipientRows] = await Promise.all([
    readCommunityPotWindow(windowId),
    readCommunityPotDistributionWindow(windowId),
    readDistributionSnapshotRows(windowId),
  ]);

  if (!potWindow && !distributionWindow && recipientRows.length === 0) {
    throw notFound('Community Pot window not found', 'COMMUNITY_POT_WINDOW_NOT_FOUND');
  }

  const totalRedirectedAmount = BigInt(potWindow?.totalRedirectedAmount ?? 0);
  const distributedAmount = BigInt(distributionWindow?.distributedAmount ?? 0);
  const remainingAmount = totalRedirectedAmount - distributedAmount;

  const recipients = recipientRows.map((row) => ({
    walletAddress: row.walletAddress,
    displayIdentity: truncateWalletAddress(row.walletAddress),
    courseId: row.courseId,
    currentStreak: Number(row.currentStreak),
    principalAmount: String(row.principalAmount),
    principalAmountUi: formatAtomicUsdcUi(row.principalAmount),
    weight: String(row.weight),
    payoutAmount: String(row.payoutAmount),
    payoutAmountUi: formatAtomicUsdcUi(row.payoutAmount),
    status: mapRecipientStatus(row.status),
    distributedAt: row.distributedAt ?? null,
    transactionSignature: row.distributionTransactionSignature ?? null,
    lastError: row.distributionLastError ?? null,
    isCurrentUser: row.walletAddress === walletAddress,
  }));

  const userEntry = recipients.find((row) => row.isCurrentUser) ?? null;

  return {
    windowId,
    windowLabel: formatCommunityPotWindowLabel(windowId),
    totalRedirectedAmount: totalRedirectedAmount.toString(),
    totalRedirectedAmountUi: formatAtomicUsdcUi(totalRedirectedAmount),
    distributedAmount: distributedAmount.toString(),
    distributedAmountUi: formatAtomicUsdcUi(distributedAmount),
    remainingAmount: (remainingAmount > 0n ? remainingAmount : 0n).toString(),
    remainingAmountUi: formatAtomicUsdcUi(remainingAmount > 0n ? remainingAmount : 0n),
    redirectCount: Number(potWindow?.redirectCount ?? 0),
    eligibleRecipientCount: Number(distributionWindow?.eligibleRecipientCount ?? 0),
    distributionCount: Number(distributionWindow?.distributionCount ?? 0),
    status: mapDistributionWindowStatus(distributionWindow?.status ?? potWindow?.status ?? 0),
    closedAt: unixTimestampSecondsToIso(distributionWindow?.closedAtTs ?? null),
    recipients,
    userEntry,
  };
}

async function computeLeaderboardRows() {
  const runtimeWallets = await query(
    `
      select distinct wallet_address
      from lesson.user_course_runtime_state
      order by wallet_address asc
    `,
  );

  const latestClosedWindowIdResult = await query(
    `
      select window_id
      from lesson.community_pot_distribution_snapshots
      group by window_id
      order by window_id desc
      limit 1
    `,
  );

  const latestClosedWindowId =
    latestClosedWindowIdResult.rowCount > 0
      ? Number(latestClosedWindowIdResult.rows[0].window_id)
      : null;
  const latestClosedWindow =
    latestClosedWindowId != null
      ? await readCommunityPotDistributionWindow(latestClosedWindowId)
      : null;
  const latestClosedRows =
    latestClosedWindowId != null ? await readDistributionSnapshotRows(latestClosedWindowId) : [];

  const entries = [];
  for (const row of runtimeWallets.rows) {
    const wallet = row.wallet_address;
    const courseIdsResult = await query(
      `
        select course_id as "courseId"
        from lesson.user_course_runtime_state
        where wallet_address = $1
        order by course_id asc
      `,
      [wallet],
    );

    let streakLength = 0;
    let activeCourseCount = 0;
    let lockedPrincipal = 0n;
    let recentActivityDate = null;

    for (const course of courseIdsResult.rows) {
      try {
        const snapshot = await readLockAccountSnapshot(wallet, course.courseId);
        if (snapshot.status !== 0) {
          continue;
        }

        const currentStreak = Number(snapshot.currentStreak ?? 0);
        streakLength = Math.max(streakLength, currentStreak);
        if (currentStreak > 0) {
          activeCourseCount += 1;
        }

        lockedPrincipal += BigInt(snapshot.principalAmount ?? 0);
        const completionDate = epochDayToIsoDate(snapshot.lastCompletionDay);
        if (completionDate && (!recentActivityDate || completionDate > recentActivityDate)) {
          recentActivityDate = completionDate;
        }
      } catch {
        // Skip unreadable locks.
      }
    }

    const projectedRow =
      latestClosedWindowId != null
        ? latestClosedRows.find((entry) => entry.walletAddress === wallet)
        : null;

    entries.push({
      walletAddress: wallet,
      displayIdentity: truncateWalletAddress(wallet),
      streakLength,
      streakStatus: streakLength > 0 ? 'active' : 'broken',
      activeCourseCount,
      lockedPrincipalAmount: lockedPrincipal.toString(),
      lockedPrincipalAmountUi: formatAtomicUsdcUi(lockedPrincipal),
      projectedCommunityPotShare:
        projectedRow?.payoutAmount != null ? String(projectedRow.payoutAmount) : '0',
      projectedCommunityPotShareUi:
        projectedRow?.payoutAmount != null
          ? formatAtomicUsdcUi(projectedRow.payoutAmount)
          : '0',
      recentActivityDate,
    });
  }

  entries.sort((left, right) => {
    if (left.streakLength !== right.streakLength) {
      return right.streakLength - left.streakLength;
    }
    const leftPrincipal = BigInt(left.lockedPrincipalAmount);
    const rightPrincipal = BigInt(right.lockedPrincipalAmount);
    if (leftPrincipal !== rightPrincipal) {
      return rightPrincipal > leftPrincipal ? 1 : -1;
    }
    return left.walletAddress.localeCompare(right.walletAddress);
  });

  const rankedEntries = entries.map((entry, index) => ({
    rank: index + 1,
    ...entry,
  }));

  return {
    currentPotAmount:
      latestClosedWindow?.totalRedirectedAmount != null
        ? String(latestClosedWindow.totalRedirectedAmount)
        : '0',
    nextDistributionWindowLabel:
      latestClosedWindowId != null
        ? formatCommunityPotWindowLabel(latestClosedWindowId + 1)
        : null,
    entries: rankedEntries,
  };
}

function mapLeaderboardSnapshotRow(row, walletAddress) {
  return {
    rank: Number(row.rank),
    walletAddress: row.walletAddress,
    displayIdentity: row.displayIdentity,
    streakLength: Number(row.streakLength),
    streakStatus: row.streakStatus,
    activeCourseCount: Number(row.activeCourseCount),
    lockedPrincipalAmount: String(row.lockedPrincipalAmount),
    lockedPrincipalAmountUi: formatAtomicUsdcUi(row.lockedPrincipalAmount),
    projectedCommunityPotShare: String(row.projectedCommunityPotShare),
    projectedCommunityPotShareUi: formatAtomicUsdcUi(row.projectedCommunityPotShare),
    recentActivityDate: row.recentActivityDate ?? null,
    isCurrentUser: row.walletAddress === walletAddress,
  };
}

async function readLatestLeaderboardSnapshot(walletAddress, page = 1, pageSize = 25) {
  const snapshotResult = await query(
    `
      select
        snapshot_id as "snapshotId",
        snapshot_at as "snapshotAt",
        current_pot_amount as "currentPotAmount",
        next_distribution_window_label as "nextDistributionWindowLabel",
        entry_count as "entryCount"
      from lesson.leaderboard_snapshots
      order by snapshot_id desc
      limit 1
    `,
  );

  const snapshot = snapshotResult.rows[0] ?? null;
  if (!snapshot) {
    return null;
  }

  const safePageSize = Math.max(1, Number(pageSize) || 25);
  const totalEntries = Number(snapshot.entryCount ?? 0);
  const totalPages = Math.max(1, Math.ceil(totalEntries / safePageSize));
  const safePage = Math.min(Math.max(1, Number(page) || 1), totalPages);
  const offset = (safePage - 1) * safePageSize;

  const [entriesResult, currentUserResult] = await Promise.all([
    query(
      `
        select
          rank,
          wallet_address as "walletAddress",
          display_identity as "displayIdentity",
          streak_length as "streakLength",
          streak_status as "streakStatus",
          active_course_count as "activeCourseCount",
          locked_principal_amount as "lockedPrincipalAmount",
          projected_community_pot_share as "projectedCommunityPotShare",
          recent_activity_date as "recentActivityDate"
        from lesson.leaderboard_snapshot_rows
        where snapshot_id = $1
        order by rank asc
        limit $2
        offset $3
      `,
      [snapshot.snapshotId, safePageSize, offset],
    ),
    walletAddress
      ? query(
          `
            select
              rank,
              wallet_address as "walletAddress",
              display_identity as "displayIdentity",
              streak_length as "streakLength",
              streak_status as "streakStatus",
              active_course_count as "activeCourseCount",
              locked_principal_amount as "lockedPrincipalAmount",
              projected_community_pot_share as "projectedCommunityPotShare",
              recent_activity_date as "recentActivityDate"
            from lesson.leaderboard_snapshot_rows
            where snapshot_id = $1
              and wallet_address = $2
            limit 1
          `,
          [snapshot.snapshotId, walletAddress],
        )
      : Promise.resolve({ rows: [] }),
  ]);

  return {
    source: 'materialized',
    snapshotAt: snapshot.snapshotAt,
    page: safePage,
    pageSize: safePageSize,
    totalEntries,
    totalPages,
    currentPotSizeUi: formatAtomicUsdcUi(snapshot.currentPotAmount),
    nextDistributionWindowLabel: snapshot.nextDistributionWindowLabel ?? null,
    currentUser:
      currentUserResult.rows[0] != null
        ? mapLeaderboardSnapshotRow(currentUserResult.rows[0], walletAddress)
        : null,
    entries: entriesResult.rows.map((row) => mapLeaderboardSnapshotRow(row, walletAddress)),
  };
}

export async function refreshLeaderboardSnapshot(limit = 25) {
  if (!hasDatabase()) {
    return {
      processed: false,
      reason: 'NO_DATABASE',
    };
  }

  const live = await computeLeaderboardRows();

  return withTransaction(async (client) => {
    const snapshotInsert = await client.query(
      `
        insert into lesson.leaderboard_snapshots (
          current_pot_amount,
          next_distribution_window_label,
          entry_count
        )
        values ($1::bigint, $2, $3)
        returning
          snapshot_id as "snapshotId",
          snapshot_at as "snapshotAt",
          current_pot_amount as "currentPotAmount",
          next_distribution_window_label as "nextDistributionWindowLabel",
          entry_count as "entryCount"
      `,
      [live.currentPotAmount, live.nextDistributionWindowLabel, live.entries.length],
    );

    const snapshot = snapshotInsert.rows[0];

    for (const entry of live.entries) {
      await client.query(
        `
          insert into lesson.leaderboard_snapshot_rows (
            snapshot_id,
            rank,
            wallet_address,
            display_identity,
            streak_length,
            streak_status,
            active_course_count,
            locked_principal_amount,
            projected_community_pot_share,
            recent_activity_date
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8::bigint, $9::bigint, $10::date)
        `,
        [
          snapshot.snapshotId,
          entry.rank,
          entry.walletAddress,
          entry.displayIdentity,
          entry.streakLength,
          entry.streakStatus,
          entry.activeCourseCount,
          entry.lockedPrincipalAmount,
          entry.projectedCommunityPotShare,
          entry.recentActivityDate,
        ],
      );
    }

    await client.query(
      `
        delete from lesson.leaderboard_snapshots
        where snapshot_id not in (
          select snapshot_id
          from lesson.leaderboard_snapshots
          order by snapshot_id desc
          limit 20
        )
      `,
    );

    return {
      processed: true,
      reason: 'SNAPSHOT_CREATED',
      source: 'materialized',
      snapshotAt: snapshot.snapshotAt,
      page: 1,
      pageSize: limit,
      totalEntries: live.entries.length,
      totalPages: Math.max(1, Math.ceil(live.entries.length / limit)),
      currentPotSizeUi: formatAtomicUsdcUi(snapshot.currentPotAmount),
      nextDistributionWindowLabel: snapshot.nextDistributionWindowLabel ?? null,
      currentUser: null,
      entries: live.entries.slice(0, limit).map((entry) => ({
        ...entry,
        isCurrentUser: false,
      })),
    };
  });
}

export async function getLeaderboardSnapshot(walletAddress, page = 1, pageSize = 25) {
  if (!hasDatabase()) {
    return {
      source: 'live',
      snapshotAt: null,
      page: 1,
      pageSize,
      totalEntries: 0,
      totalPages: 1,
      currentPotSizeUi: '0',
      nextDistributionWindowLabel: null,
      currentUser: null,
      entries: [],
    };
  }

  const materialized = await readLatestLeaderboardSnapshot(walletAddress, page, pageSize);
  if (materialized) {
    return materialized;
  }

  const live = await computeLeaderboardRows();
  const safePageSize = Math.max(1, Number(pageSize) || 25);
  const totalEntries = live.entries.length;
  const totalPages = Math.max(1, Math.ceil(totalEntries / safePageSize));
  const safePage = Math.min(Math.max(1, Number(page) || 1), totalPages);
  const startIndex = (safePage - 1) * safePageSize;
  const liveCurrentUser =
    live.entries.find((entry) => entry.walletAddress === walletAddress) ?? null;

  return {
    source: 'live',
    snapshotAt: null,
    page: safePage,
    pageSize: safePageSize,
    totalEntries,
    totalPages,
    currentPotSizeUi: formatAtomicUsdcUi(live.currentPotAmount),
    nextDistributionWindowLabel: live.nextDistributionWindowLabel,
    currentUser: liveCurrentUser ? { ...liveCurrentUser, isCurrentUser: true } : null,
    entries: live.entries.slice(startIndex, startIndex + safePageSize).map((entry) => ({
      ...entry,
      isCurrentUser: entry.walletAddress === walletAddress,
    })),
  };
}

async function readFuelBurnReceipt(client, walletAddress, courseId, cycleId) {
  const result = await client.query(
    `
      select
        wallet_address as "walletAddress",
        course_id as "courseId",
        cycle_id as "cycleId",
        burned_at as "burnedAt",
        applied,
        fuel_before as "fuelBefore",
        fuel_after as "fuelAfter",
        reason,
        lock_vault_status as "lockVaultStatus",
        lock_vault_published_at as "lockVaultPublishedAt",
        lock_vault_last_error as "lockVaultLastError",
        lock_vault_transaction_signature as "lockVaultTransactionSignature"
      from lesson.fuel_burn_cycle_receipts
      where wallet_address = $1
        and course_id = $2
        and cycle_id = $3
      limit 1
    `,
    [walletAddress, courseId, cycleId],
  );

  return result.rows[0] ?? null;
}

async function claimFuelBurnReceipt(walletAddress, courseId, cycleId, retryFailed = false) {
  const claimableStatuses = retryFailed ? ['pending', 'failed'] : ['pending'];
  const result = await query(
    `
      update lesson.fuel_burn_cycle_receipts
      set lock_vault_status = 'publishing',
          lock_vault_last_error = null
      where wallet_address = $1
        and course_id = $2
        and cycle_id = $3
        and lock_vault_status = any($4::text[])
      returning
        wallet_address as "walletAddress",
        course_id as "courseId",
        cycle_id as "cycleId",
        burned_at as "burnedAt",
        applied,
        reason
    `,
    [walletAddress, courseId, cycleId, claimableStatuses],
  );

  if (result.rowCount > 0) {
    return { receipt: result.rows[0], reason: 'CLAIMED' };
  }

  const current = await query(
    `
      select
        wallet_address as "walletAddress",
        course_id as "courseId",
        cycle_id as "cycleId",
        burned_at as "burnedAt",
        applied,
        reason,
        lock_vault_status as "lockVaultStatus",
        lock_vault_published_at as "lockVaultPublishedAt",
        lock_vault_last_error as "lockVaultLastError",
        lock_vault_transaction_signature as "lockVaultTransactionSignature"
      from lesson.fuel_burn_cycle_receipts
      where wallet_address = $1
        and course_id = $2
        and cycle_id = $3
      limit 1
    `,
    [walletAddress, courseId, cycleId],
  );

  if (current.rowCount === 0) {
    return { receipt: null, reason: 'RECEIPT_NOT_FOUND' };
  }

  const existing = current.rows[0];
  if (existing.lockVaultStatus === 'published') {
    return { receipt: existing, reason: 'ALREADY_PUBLISHED' };
  }

  if (existing.lockVaultStatus === 'publishing') {
    return { receipt: existing, reason: 'ALREADY_PUBLISHING' };
  }

  return { receipt: existing, reason: 'RETRY_REQUIRED' };
}

async function markFuelBurnReceiptPublished(walletAddress, courseId, cycleId, signature) {
  await query(
    `
      update lesson.fuel_burn_cycle_receipts
      set lock_vault_status = 'published',
          lock_vault_published_at = now(),
          lock_vault_last_error = null,
          lock_vault_transaction_signature = $4
      where wallet_address = $1
        and course_id = $2
        and cycle_id = $3
    `,
    [walletAddress, courseId, cycleId, signature],
  );
}

async function markFuelBurnReceiptFailed(walletAddress, courseId, cycleId, error) {
  await query(
    `
      update lesson.fuel_burn_cycle_receipts
      set lock_vault_status = 'failed',
          lock_vault_last_error = $4
      where wallet_address = $1
        and course_id = $2
        and cycle_id = $3
    `,
    [walletAddress, courseId, cycleId, error],
  );
}

async function readMissConsequenceReceipt(client, walletAddress, courseId, missEventId) {
  const result = await client.query(
    `
      select
        wallet_address as "walletAddress",
        course_id as "courseId",
        miss_event_id as "missEventId",
        miss_day::text as "missDay",
        applied,
        reason,
        saver_count_before as "saverCountBefore",
        saver_count_after as "saverCountAfter",
        redirect_bps_before as "redirectBpsBefore",
        redirect_bps_after as "redirectBpsAfter",
        extension_days_before as "extensionDaysBefore",
        extension_days_after as "extensionDaysAfter",
        lock_vault_status as "lockVaultStatus",
        lock_vault_published_at as "lockVaultPublishedAt",
        lock_vault_last_error as "lockVaultLastError",
        lock_vault_transaction_signature as "lockVaultTransactionSignature"
      from lesson.miss_consequence_receipts
      where wallet_address = $1
        and course_id = $2
        and miss_event_id = $3
      limit 1
    `,
    [walletAddress, courseId, missEventId],
  );

  return result.rows[0] ?? null;
}

async function claimMissConsequenceReceipt(
  walletAddress,
  courseId,
  missEventId,
  retryFailed = false,
) {
  const claimableStatuses = retryFailed ? ['pending', 'failed'] : ['pending'];
  const result = await query(
    `
      update lesson.miss_consequence_receipts
      set lock_vault_status = 'publishing',
          lock_vault_last_error = null
      where wallet_address = $1
        and course_id = $2
        and miss_event_id = $3
        and lock_vault_status = any($4::text[])
      returning
        wallet_address as "walletAddress",
        course_id as "courseId",
        miss_event_id as "missEventId",
        miss_day::text as "missDay",
        applied,
        reason
    `,
    [walletAddress, courseId, missEventId, claimableStatuses],
  );

  if (result.rowCount > 0) {
    return { receipt: result.rows[0], reason: 'CLAIMED' };
  }

  const current = await query(
    `
      select
        wallet_address as "walletAddress",
        course_id as "courseId",
        miss_event_id as "missEventId",
        miss_day::text as "missDay",
        applied,
        reason,
        lock_vault_status as "lockVaultStatus",
        lock_vault_published_at as "lockVaultPublishedAt",
        lock_vault_last_error as "lockVaultLastError",
        lock_vault_transaction_signature as "lockVaultTransactionSignature"
      from lesson.miss_consequence_receipts
      where wallet_address = $1
        and course_id = $2
        and miss_event_id = $3
      limit 1
    `,
    [walletAddress, courseId, missEventId],
  );

  if (current.rowCount === 0) {
    return { receipt: null, reason: 'RECEIPT_NOT_FOUND' };
  }

  const existing = current.rows[0];
  if (existing.lockVaultStatus === 'published') {
    return { receipt: existing, reason: 'ALREADY_PUBLISHED' };
  }

  if (existing.lockVaultStatus === 'publishing') {
    return { receipt: existing, reason: 'ALREADY_PUBLISHING' };
  }

  return { receipt: existing, reason: 'RETRY_REQUIRED' };
}

async function markMissConsequenceReceiptPublished(
  walletAddress,
  courseId,
  missEventId,
  signature,
) {
  await query(
    `
      update lesson.miss_consequence_receipts
      set lock_vault_status = 'published',
          lock_vault_published_at = now(),
          lock_vault_last_error = null,
          lock_vault_transaction_signature = $4
      where wallet_address = $1
        and course_id = $2
        and miss_event_id = $3
    `,
    [walletAddress, courseId, missEventId, signature],
  );
}

async function markMissConsequenceReceiptFailed(walletAddress, courseId, missEventId, error) {
  await query(
    `
      update lesson.miss_consequence_receipts
      set lock_vault_status = 'failed',
          lock_vault_last_error = $4
      where wallet_address = $1
        and course_id = $2
        and miss_event_id = $3
    `,
    [walletAddress, courseId, missEventId, error],
  );
}

export async function consumeSaverOrApplyFullConsequence(
  walletAddress,
  courseId,
  missEventId,
  missDay = null,
) {
  if (!missEventId || typeof missEventId !== 'string') {
    throw badRequest('missEventId is required', 'MISSING_MISS_EVENT_ID');
  }

  const missDayValue = missDay ?? new Date().toISOString().slice(0, 10);

  if (!hasDatabase()) {
    return {
      missEventId,
      applied: false,
      reason: 'NO_DATABASE',
    };
  }

  return withTransactionAsWallet(walletAddress, async (client) => {
    const existingReceipt = await readMissConsequenceReceipt(
      client,
      walletAddress,
      courseId,
      missEventId,
    );

    if (existingReceipt) {
      const courseRuntime = await readCourseRuntimeState(client, walletAddress, courseId);
      return {
        missEventId,
        applied: existingReceipt.applied,
        reason: existingReceipt.reason,
        courseRuntime,
      };
    }

    const state = await ensureCourseRuntimeState(client, walletAddress, courseId);
    const saverCountBefore = state.saverCount;
    const redirectBpsBefore = state.currentYieldRedirectBps;
    const extensionDaysBefore = state.extensionDays;

    let applied = false;
    let reason = 'GAUNTLET_LOCKED';
    let saverCountAfter = saverCountBefore;
    let redirectBpsAfter = redirectBpsBefore;
    let extensionDaysAfter = extensionDaysBefore;
    let saverRecoveryMode = state.saverRecoveryMode;
    let currentStreak = state.currentStreak;

    if (!state.gauntletActive) {
      applied = true;
      currentStreak = 0;

      if (state.saverCount < 3) {
        saverCountAfter = state.saverCount + 1;
        redirectBpsAfter = getSaverRedirectBps(saverCountAfter);
        saverRecoveryMode = true;
        reason = 'SAVER_CONSUMED';
      } else {
        redirectBpsAfter = 10000;
        extensionDaysAfter = state.extensionDays + appConfig.missExtensionDays;
        saverRecoveryMode = true;
        reason = 'FULL_CONSEQUENCE';
      }

      await client.query(
        `
          update lesson.user_course_runtime_state
          set current_streak = $3,
              saver_count = $4,
              saver_recovery_mode = $5,
              current_yield_redirect_bps = $6,
              extension_days = $7,
              last_miss_day = $8::date,
              updated_at = now()
          where wallet_address = $1
            and course_id = $2
        `,
        [
          walletAddress,
          courseId,
          currentStreak,
          saverCountAfter,
          saverRecoveryMode,
          redirectBpsAfter,
          extensionDaysAfter,
          missDayValue,
        ],
      );
    }

    await client.query(
      `
        insert into lesson.miss_consequence_receipts (
          wallet_address,
          course_id,
          miss_event_id,
          miss_day,
          applied,
          reason,
          saver_count_before,
          saver_count_after,
          redirect_bps_before,
          redirect_bps_after,
          extension_days_before,
          extension_days_after
        )
        values (
          $1,
          $2,
          $3,
          $4::date,
          $5,
          $6,
          $7,
          $8,
          $9,
          $10,
          $11,
          $12
        )
      `,
      [
        walletAddress,
        courseId,
        missEventId,
        missDayValue,
        applied,
        reason,
        saverCountBefore,
        saverCountAfter,
        redirectBpsBefore,
        redirectBpsAfter,
        extensionDaysBefore,
        extensionDaysAfter,
      ],
    );

    const courseRuntime = await readCourseRuntimeState(client, walletAddress, courseId);

    return {
      missEventId,
      applied,
      reason,
      courseRuntime,
    };
  });
}

export async function consumeDailyFuel(
  walletAddress,
  courseId,
  cycleId,
  burnedAt = null,
) {
  if (!cycleId || typeof cycleId !== 'string') {
    throw badRequest('cycleId is required', 'MISSING_CYCLE_ID');
  }

  const timestamp = burnedAt ?? new Date().toISOString();

  if (!hasDatabase()) {
    return {
      cycleId,
      applied: false,
      fuelBurned: 0,
      burnedAt: timestamp,
      reason: 'NO_DATABASE',
    };
  }

  return withTransactionAsWallet(walletAddress, async (client) => {
    const existingReceipt = await readFuelBurnReceipt(
      client,
      walletAddress,
      courseId,
      cycleId,
    );

    if (existingReceipt) {
      const courseRuntime = await readCourseRuntimeState(client, walletAddress, courseId);
      return {
        cycleId,
        applied: existingReceipt.applied,
        fuelBurned: existingReceipt.applied ? 1 : 0,
        burnedAt: existingReceipt.burnedAt,
        reason: existingReceipt.reason ?? 'ALREADY_PROCESSED',
        courseRuntime,
      };
    }

    const state = await ensureCourseRuntimeState(client, walletAddress, courseId);
    const burnedAtDate = new Date(timestamp);
    const lastBurnAt = state.lastBrewerBurnTs
      ? new Date(state.lastBrewerBurnTs)
      : null;
    const enoughTimeElapsed =
      !lastBurnAt ||
      burnedAtDate.getTime() - lastBurnAt.getTime() >= 24 * 60 * 60 * 1000;

    let applied = false;
    let fuelAfter = state.fuelCounter;
    let reason = 'NO_FUEL';

    if (state.gauntletActive) {
      reason = 'GAUNTLET_LOCKED';
    } else if (!enoughTimeElapsed) {
      reason = 'TOO_EARLY';
    } else if (state.fuelCounter > 0) {
      applied = true;
      fuelAfter = state.fuelCounter - 1;
      reason = 'BURNED';

      await client.query(
        `
          update lesson.user_course_runtime_state
          set fuel_counter = $3,
              last_brewer_burn_ts = $4::timestamptz,
              updated_at = now()
          where wallet_address = $1
            and course_id = $2
        `,
        [walletAddress, courseId, fuelAfter, timestamp],
      );
    }

    await client.query(
      `
        insert into lesson.fuel_burn_cycle_receipts (
          wallet_address,
          course_id,
          cycle_id,
          burned_at,
          applied,
          fuel_before,
          fuel_after,
          reason
        )
        values (
          $1,
          $2,
          $3,
          $4::timestamptz,
          $5,
          $6,
          $7,
          $8
        )
      `,
      [
        walletAddress,
        courseId,
        cycleId,
        timestamp,
        applied,
        state.fuelCounter,
        fuelAfter,
        reason,
      ],
    );

    const courseRuntime = await readCourseRuntimeState(client, walletAddress, courseId);

    return {
      cycleId,
      applied,
      fuelBurned: applied ? 1 : 0,
      burnedAt: timestamp,
      reason,
      courseRuntime,
    };
  });
}

export async function startLessonAttempt(
  walletAddress,
  lessonId,
  attemptId,
  startedAt = null,
) {
  const normalizedAttemptId = assertAttemptId(attemptId);
  const timestamp = startedAt ?? new Date().toISOString();

  if (!hasDatabase()) {
    return {
      lessonId,
      attemptId: normalizedAttemptId,
      startedAt: timestamp,
    };
  }

  return withTransactionAsWallet(walletAddress, async (client) => {
    const lessonVersion = await getPublishedLessonVersion(client, lessonId);
    const attempt = await ensureAttempt(
      client,
      walletAddress,
      lessonId,
      normalizedAttemptId,
      lessonVersion.lessonVersionId,
      timestamp,
    );

    return {
      lessonId,
      attemptId: attempt.attemptId,
      startedAt: attempt.startedAt,
    };
  });
}

export async function submitLessonAttempt(
  walletAddress,
  lessonId,
  attemptId,
  answers,
  startedAt = null,
  completedAt = null,
) {
  const normalizedAttemptId = assertAttemptId(attemptId);
  const submittedAnswers = assertAnswers(answers);
  const timestamp = completedAt ?? new Date().toISOString();

  if (!hasDatabase()) {
    const totalQuestions = submittedAnswers.size;
    return {
      lessonId,
      attemptId: normalizedAttemptId,
      accepted: true,
      score: 100,
      correctAnswers: totalQuestions,
      totalQuestions,
      completedAt: timestamp,
      completionEventId: normalizedAttemptId,
    };
  }

  return withTransactionAsWallet(walletAddress, async (client) => {
    const lessonVersion = await getPublishedLessonVersion(client, lessonId);
    const attempt = await ensureAttempt(
      client,
      walletAddress,
      lessonId,
      normalizedAttemptId,
      lessonVersion.lessonVersionId,
      startedAt,
    );

    if (attempt.submittedAt) {
      const questions = await listLessonQuestions(client, attempt.lessonVersionId);
      const totalQuestions = questions.length;
      const correctAnswers = Math.round(
        ((attempt.score ?? 0) / 100) * Math.max(totalQuestions, 0),
      );
      const completionEvent = await readVerifiedCompletionEvent(
        client,
        attempt.attemptId,
      );
      const courseId =
        completionEvent?.courseId ??
        (await getCourseIdForPublishedLesson(
          client,
          lessonId,
          attempt.lessonVersionId,
        ));
      const courseRuntime = await readCourseRuntimeState(
        client,
        walletAddress,
        courseId,
      );
      const questionResults = await readAnswerValidationDecisions(client, attempt.attemptId);

      return {
        lessonId,
        attemptId: attempt.attemptId,
        accepted: attempt.accepted ?? true,
        score: attempt.score ?? 0,
        correctAnswers,
        totalQuestions,
        completedAt: attempt.submittedAt,
        completionEventId: completionEvent?.eventId ?? attempt.attemptId,
        courseRuntime,
        questionResults,
      };
    }

    const questions = await listLessonQuestions(client, attempt.lessonVersionId);
    const grading = await gradeAnswers(
      questions,
      submittedAnswers,
      attempt.startedAt,
      timestamp,
    );

    await persistQuestionAttempts(client, normalizedAttemptId, grading.attempts);
    await persistAnswerValidationDecisions(client, normalizedAttemptId, grading.attempts);

    const accepted = grading.score >= LESSON_ACCEPTANCE_THRESHOLD;

    await client.query(
      `
        update lesson.user_lesson_attempts
        set submitted_at = $2::timestamptz,
            score = $3,
            accepted = $4
        where id = $1::uuid
      `,
      [normalizedAttemptId, timestamp, grading.score, accepted],
    );

    let completionEvent = null;
    let courseRuntime = null;
    if (accepted) {
      await persistLessonProgress(
        client,
        walletAddress,
        lessonId,
        grading.score,
        timestamp,
      );

      completionEvent = await persistVerifiedCompletionEvent(
        client,
        walletAddress,
        lessonId,
        attempt.lessonVersionId,
        normalizedAttemptId,
        grading,
        timestamp,
      );
      courseRuntime = await applyVerifiedCompletionToCourseRuntime(
        client,
        walletAddress,
        completionEvent.courseId,
        completionEvent.completionDay,
        completionEvent.rewardUnits,
      );
    }

    const questionResults = grading.attempts
      .filter((attemptResult) => attemptResult.validatorResult)
      .map((attemptResult) => ({
        questionId: attemptResult.questionId,
        prompt: attemptResult.prompt,
        accepted: attemptResult.validatorResult.accepted,
        score: attemptResult.validatorResult.score,
        feedbackSummary: attemptResult.validatorResult.feedbackSummary,
        validatorVersion: attemptResult.validatorResult.validatorVersion,
        decisionHash: attemptResult.validatorResult.decisionHash,
      }));

    return {
      lessonId,
      attemptId: normalizedAttemptId,
      accepted,
      score: grading.score,
      correctAnswers: grading.correctAnswers,
      totalQuestions: grading.totalQuestions,
      completedAt: timestamp,
      completionEventId: completionEvent?.eventId,
      courseRuntime,
      questionResults,
    };
  });
}

export async function getCourseProgress(walletAddress, courseId) {
  if (!hasDatabase()) {
    return {
      courseId,
      completedLessons: 0,
      totalLessons: 0,
      completionRate: 0,
    };
  }

  const result = await queryAsWallet(
    walletAddress,
    `
      with totals as (
        select count(*)::int as total_lessons
        from lesson.course_modules cm
        join lesson.module_lessons ml on ml.module_id = cm.module_id
        where cm.course_id = $2
      ),
      completed as (
        select count(*)::int as completed_lessons
        from lesson.user_lesson_progress ulp
        join lesson.module_lessons ml on ml.lesson_id = ulp.lesson_id
        join lesson.course_modules cm on cm.module_id = ml.module_id
        where ulp.wallet_address = $1
          and cm.course_id = $2
          and ulp.completed = true
      )
      select
        $2::text as "courseId",
        completed.completed_lessons as "completedLessons",
        totals.total_lessons as "totalLessons",
        case
          when totals.total_lessons = 0 then 0
          else round((completed.completed_lessons::numeric / totals.total_lessons::numeric), 4)
        end as "completionRate"
      from totals, completed
    `,
    [walletAddress, courseId],
  );

  return result.rows[0];
}

export async function getModuleProgress(walletAddress, moduleId) {
  if (!hasDatabase()) {
    return {
      moduleId,
      completedLessons: 0,
      totalLessons: 0,
      completionRate: 0,
    };
  }

  const result = await queryAsWallet(
    walletAddress,
    `
      with totals as (
        select count(*)::int as total_lessons
        from lesson.module_lessons ml
        where ml.module_id = $2
      ),
      completed as (
        select count(*)::int as completed_lessons
        from lesson.user_lesson_progress ulp
        join lesson.module_lessons ml on ml.lesson_id = ulp.lesson_id
        where ulp.wallet_address = $1
          and ml.module_id = $2
          and ulp.completed = true
      )
      select
        $2::text as "moduleId",
        completed.completed_lessons as "completedLessons",
        totals.total_lessons as "totalLessons",
        case
          when totals.total_lessons = 0 then 0
          else round((completed.completed_lessons::numeric / totals.total_lessons::numeric), 4)
        end as "completionRate"
      from totals, completed
    `,
    [walletAddress, moduleId],
  );

  return result.rows[0];
}
