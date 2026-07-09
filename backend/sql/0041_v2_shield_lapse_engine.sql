-- v2 shield/lapse engine columns (spec §4.2).
--
-- Shields absorb missed days (start 3, cap 3, +1 per 3 consecutive lesson-days).
-- When shields are gone, a missed day opens a lapse; consecutive dark days
-- coalesce into ONE lapse via lapse_open (a further lapse needs a lesson-day in
-- between). lapse_count (added in 0040) drives the completion voucher's
-- yield-kept bps: [10000, 5000, 0][min(lapse_count, 2)].
alter table lesson.user_course_runtime_state
  add column if not exists shields integer not null default 3,
  add column if not exists lapse_open boolean not null default false,
  add column if not exists consecutive_lesson_days integer not null default 0;
