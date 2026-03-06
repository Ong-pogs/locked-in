import { createHash } from 'node:crypto';
import { hasDatabase, query } from '../../lib/db.mjs';

function withContentHash(payload) {
  const serialized = JSON.stringify(payload);
  return {
    ...payload,
    contentHash: createHash('sha256').update(serialized).digest('hex'),
  };
}

function sanitizeLessonPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return payload;
  }

  const sanitizedQuestions = Array.isArray(payload.questions)
    ? payload.questions.map((question) => {
        const { correctAnswer, ...rest } = question;
        void correctAnswer;
        return rest;
      })
    : [];

  return withContentHash({
    ...payload,
    questions: sanitizedQuestions,
  });
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
        r.created_at as "publishedAt"
      from lesson.courses c
      join lesson.publish_releases r on r.id::text = $1
      left join lesson.published_modules pm
        on pm.course_id = c.id and pm.release_id::text = $1
      left join lesson.published_lessons pl
        on pl.module_id = pm.module_id and pl.release_id::text = $1
      group by c.id, c.slug, c.title, c.description, c.difficulty, c.category, c.image_url, r.created_at
      order by c.title asc
    `,
    [releaseId],
  );

  return result.rows;
}

export async function listCourseModules(courseId, releaseId) {
  if (!hasDatabase()) {
    return [];
  }

  const result = await query(
    `
      select
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
        and pm.release_id::text = $2
      order by pm.module_order asc
    `,
    [courseId, releaseId],
  );

  return result.rows;
}

export async function listModuleLessons(moduleId, releaseId) {
  if (!hasDatabase()) {
    return [];
  }

  const result = await query(
    `
      select payload
      from lesson.published_lessons
      where module_id = $1
        and release_id::text = $2
      order by lesson_order asc
    `,
    [moduleId, releaseId],
  );

  return result.rows.map((row) => sanitizeLessonPayload(row.payload));
}

export async function getLessonPayload(lessonId, releaseId) {
  if (!hasDatabase()) {
    return null;
  }

  const result = await query(
    `
      select payload
      from lesson.published_lesson_payloads
      where lesson_id = $1
        and release_id::text = $2
      limit 1
    `,
    [lessonId, releaseId],
  );

  if (result.rowCount === 0) {
    return null;
  }

  return sanitizeLessonPayload(result.rows[0].payload);
}
