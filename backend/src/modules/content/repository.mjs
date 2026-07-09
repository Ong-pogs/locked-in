import { createHash } from 'node:crypto';
import { hasDatabase, query } from '../../lib/db.mjs';

function withContentHash(payload) {
  const serialized = JSON.stringify(payload);
  return {
    ...payload,
    contentHash: createHash('sha256').update(serialized).digest('hex'),
  };
}

// Lesson completion gates real funds, so the answer key must never reach the
// client: grading reads `correct_answer` straight from the DB (see
// `listLessonQuestions`), and the browser learns the answer only in the graded
// submit response.
export function sanitizeLessonPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return payload;
  }

  if (!Array.isArray(payload.questions)) {
    return withContentHash(payload);
  }

  const questions = payload.questions.map((question) => {
    if (!question || typeof question !== 'object') {
      return question;
    }

    const { correctAnswer, metadata, ...safeQuestion } = question;

    if (metadata && typeof metadata === 'object') {
      const { expectedTokens, ...safeMetadata } = metadata;
      safeQuestion.metadata = safeMetadata;
    } else if (metadata !== undefined) {
      safeQuestion.metadata = metadata;
    }

    return safeQuestion;
  });

  return withContentHash({ ...payload, questions });
}

export async function getLatestRelease() {
  if (!hasDatabase()) {
    return {
      releaseId: 'local-dev-release',
      publishedAt: new Date().toISOString(),
    };
  }

  const result = await query(
    `
      select id::text as "releaseId", created_at as "publishedAt"
      from lesson.publish_releases
      order by created_at desc
      limit 1
    `,
  );

  if (result.rowCount === 0) {
    return null;
  }

  return result.rows[0];
}

export async function listCourses(releaseId) {
  if (!hasDatabase()) {
    return [];
  }

  const result = await query(
    `
      select
        c.id,
        c.slug,
        c.title,
        c.description,
        c.difficulty,
        c.category,
        c.image_url as "imageUrl",
        count(distinct pm.module_id)::int as "totalModules",
        count(distinct pl.lesson_id)::int as "totalLessons",
        jsonb_build_object(
          'minPrincipalAmountUi', c.min_principal_amount_usdc::text,
          'maxPrincipalAmountUi', case
            when c.max_principal_amount_usdc is null then null
            else c.max_principal_amount_usdc::text
          end,
          'demoPrincipalAmountUi', case
            when c.demo_principal_amount_usdc is null then null
            else c.demo_principal_amount_usdc::text
          end,
          'minLockDurationDays', c.min_lock_duration_days,
          'maxLockDurationDays', c.max_lock_duration_days
        ) as "lockPolicy",
        r.created_at as "publishedAt"
      from lesson.courses c
      join lesson.publish_releases r on r.id::text = $1
      left join lesson.published_modules pm
        on pm.course_id = c.id
      left join lesson.published_lessons pl
        on pl.module_id = pm.module_id
      group by
        c.id,
        c.slug,
        c.title,
        c.description,
        c.difficulty,
        c.category,
        c.image_url,
        c.min_principal_amount_usdc,
        c.max_principal_amount_usdc,
        c.demo_principal_amount_usdc,
        c.min_lock_duration_days,
        c.max_lock_duration_days,
        r.created_at
      order by c.title asc
    `,
    [releaseId],
  );

  return result.rows;
}

export async function listCourseModules(courseId, _releaseId) {
  if (!hasDatabase()) {
    return [];
  }

  const result = await query(
    `
      select distinct on (pm.module_id)
        coalesce((pm.payload->>'id'), m.id) as id,
        $1::text as "courseId",
        coalesce((pm.payload->>'slug'), m.slug) as slug,
        coalesce((pm.payload->>'title'), m.title) as title,
        coalesce((pm.payload->>'description'), m.description) as description,
        pm.module_order as "order",
        coalesce((pm.payload->>'difficulty'), m.difficulty) as difficulty,
        coalesce((pm.payload->>'totalLessons')::int, 0) as "totalLessons",
        coalesce((pm.payload->>'estimatedMinutes')::int, 0) as "estimatedMinutes"
      from lesson.published_modules pm
      join lesson.modules m on m.id = pm.module_id
      where pm.course_id = $1
      order by pm.module_id, pm.release_id desc
    `,
    [courseId],
  );

  // Re-sort by module_order since DISTINCT ON requires its own ordering
  result.rows.sort((a, b) => a.order - b.order);
  return result.rows;
}

export async function listModuleLessons(moduleId, _releaseId) {
  if (!hasDatabase()) {
    return [];
  }

  const result = await query(
    `
      select distinct on (pl.lesson_id) payload, pl.lesson_order
      from lesson.published_lessons pl
      where pl.module_id = $1
      order by pl.lesson_id, pl.release_id desc
    `,
    [moduleId],
  );

  // Re-sort by lesson_order since DISTINCT ON requires its own ordering
  result.rows.sort((a, b) => a.lesson_order - b.lesson_order);
  return result.rows.map((row) => sanitizeLessonPayload(row.payload));
}

export async function getLessonPayload(lessonId, _releaseId) {
  if (!hasDatabase()) {
    return null;
  }

  const result = await query(
    `
      select payload
      from lesson.published_lesson_payloads
      where lesson_id = $1
      order by release_id desc
      limit 1
    `,
    [lessonId],
  );

  if (result.rowCount === 0) {
    return null;
  }

  return sanitizeLessonPayload(result.rows[0].payload);
}
