import { badRequest, notFound } from '../../lib/errors.mjs';
import {
  hasDatabase,
  queryAsWallet,
  withTransactionAsWallet,
} from '../../lib/db.mjs';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

      return {
        lessonId,
        attemptId: attempt.attemptId,
        accepted: attempt.accepted ?? true,
        score: attempt.score ?? 0,
        correctAnswers,
        totalQuestions,
        completedAt: attempt.submittedAt,
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

    return {
      lessonId,
      attemptId: normalizedAttemptId,
      accepted: true,
      score: grading.score,
      correctAnswers: grading.correctAnswers,
      totalQuestions: grading.totalQuestions,
      completedAt: timestamp,
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
