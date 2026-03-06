import { badRequest, notFound } from '../../lib/errors.mjs';
import { appConfig } from '../../config.mjs';
import {
  hasDatabase,
  queryAsWallet,
  withTransactionAsWallet,
} from '../../lib/db.mjs';

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

function diffDays(fromDay, toDay) {
  const from = new Date(`${fromDay}T00:00:00.000Z`).getTime();
  const to = new Date(`${toDay}T00:00:00.000Z`).getTime();
  return Math.round((to - from) / (24 * 60 * 60 * 1000));
}

function getSaverRedirectBps(saverCount) {
  return SAVER_REDIRECT_BPS_BY_COUNT[saverCount] ?? 10000;
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
        q.correct_answer as "correctAnswer",
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
      group by q.id, q.question_type, q.correct_answer, q.question_order
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

function gradeAnswers(questions, submittedAnswers) {
  const questionIds = new Set(questions.map((question) => question.id));
  for (const questionId of submittedAnswers.keys()) {
    if (!questionIds.has(questionId)) {
      throw badRequest(
        `Answer was provided for an unknown question: ${questionId}`,
        'UNKNOWN_QUESTION_ID',
      );
    }
  }

  const attempts = questions.map((question) => {
    const answerText = submittedAnswers.get(question.id) ?? '';
    const normalizedAnswer = normalizeAnswerText(answerText);
    const normalizedCorrectAnswer = normalizeAnswerText(question.correctAnswer);
    const isCorrect =
      normalizedAnswer.length > 0 && normalizedAnswer === normalizedCorrectAnswer;

    return {
      questionId: question.id,
      answerText: answerText.trim().length > 0 ? answerText.trim() : null,
      isCorrect,
    };
  });

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

async function readFuelBurnReceipt(client, walletAddress, courseId, cycleId) {
  const result = await client.query(
    `
      select
        cycle_id as "cycleId",
        burned_at as "burnedAt",
        applied,
        fuel_before as "fuelBefore",
        fuel_after as "fuelAfter",
        reason
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

async function readMissConsequenceReceipt(client, walletAddress, courseId, missEventId) {
  const result = await client.query(
    `
      select
        miss_event_id as "missEventId",
        miss_day::text as "missDay",
        applied,
        reason,
        saver_count_before as "saverCountBefore",
        saver_count_after as "saverCountAfter",
        redirect_bps_before as "redirectBpsBefore",
        redirect_bps_after as "redirectBpsAfter",
        extension_days_before as "extensionDaysBefore",
        extension_days_after as "extensionDaysAfter"
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
      };
    }

    const questions = await listLessonQuestions(client, attempt.lessonVersionId);
    const grading = gradeAnswers(questions, submittedAnswers);

    await persistQuestionAttempts(client, normalizedAttemptId, grading.attempts);

    await client.query(
      `
        update lesson.user_lesson_attempts
        set submitted_at = $2::timestamptz,
            score = $3,
            accepted = true
        where id = $1::uuid
      `,
      [normalizedAttemptId, timestamp, grading.score],
    );

    await persistLessonProgress(
      client,
      walletAddress,
      lessonId,
      grading.score,
      timestamp,
    );

    const completionEvent = await persistVerifiedCompletionEvent(
      client,
      walletAddress,
      lessonId,
      attempt.lessonVersionId,
      normalizedAttemptId,
      grading,
      timestamp,
    );
    const courseRuntime = await applyVerifiedCompletionToCourseRuntime(
      client,
      walletAddress,
      completionEvent.courseId,
      completionEvent.completionDay,
      completionEvent.rewardUnits,
    );

    return {
      lessonId,
      attemptId: normalizedAttemptId,
      accepted: true,
      score: grading.score,
      correctAnswers: grading.correctAnswers,
      totalQuestions: grading.totalQuestions,
      completedAt: timestamp,
      completionEventId: completionEvent.eventId,
      courseRuntime,
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
