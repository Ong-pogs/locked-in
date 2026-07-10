-- v2 course-completion freeze (practice-mode ruling R4, 2026-07-10).
--
-- course_completed_at freezes the shield/lapse engine for a (wallet, course):
-- once set, the miss writer (consumeSaverOrApplyFullConsequence) refuses to
-- advance lapse_count, so a user who finishes a course and claims days later
-- keeps the voucher bps they earned at completion. Backfilled for every
-- wallet that already completed every published lesson of a course.

ALTER TABLE lesson.user_course_runtime_state
  ADD COLUMN IF NOT EXISTS course_completed_at timestamptz;

WITH totals AS (
  SELECT pm.course_id, count(DISTINCT pl.lesson_id) AS total_lessons
  FROM lesson.published_modules pm
  JOIN lesson.published_lessons pl
    ON pl.module_id = pm.module_id AND pl.release_id = pm.release_id
  GROUP BY pm.course_id
), done AS (
  SELECT ulp.wallet_address, pm.course_id,
         count(DISTINCT pl.lesson_id) AS completed_lessons,
         max(ulp.completed_at) AS last_completed_at
  FROM lesson.published_modules pm
  JOIN lesson.published_lessons pl
    ON pl.module_id = pm.module_id AND pl.release_id = pm.release_id
  JOIN lesson.user_lesson_progress ulp
    ON ulp.lesson_id = pl.lesson_id AND ulp.completed
  GROUP BY ulp.wallet_address, pm.course_id
)
UPDATE lesson.user_course_runtime_state rs
SET course_completed_at = done.last_completed_at
FROM done, totals
WHERE totals.course_id = done.course_id
  AND rs.wallet_address = done.wallet_address
  AND rs.course_id = done.course_id
  AND totals.total_lessons > 0
  AND done.completed_lessons >= totals.total_lessons
  AND rs.course_completed_at IS NULL;
