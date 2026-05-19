-- Fire-timer model: 1 fuel = 24h of yield routing to the user. Replaces the
-- fuel -> ichor -> USDC conversion pipeline. fire_lit_until is the future
-- timestamp at which the fire goes out; when null or in the past, yield
-- harvested for this row routes to the community pot instead of the user.

alter table lesson.user_course_runtime_state
  add column if not exists fire_lit_until timestamptz;

create index if not exists user_course_runtime_state_fire_lit_until_idx
  on lesson.user_course_runtime_state (fire_lit_until);
