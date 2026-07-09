-- v2 one-mercy lapse tracking.
--
-- The completion voucher's yield-kept bps is a function of lapse_count:
--   0 lapses  -> 100% (bps 10000)
--   1 lapse   -> 50%  (bps 5000)
--   2+ lapses -> 0%   (bps 0)
-- The v2 lapse engine (miss handler) increments this counter; the completion
-- voucher endpoint reads it to decide the bps it signs. Defaults to 0 so a
-- freshly-completed course with no recorded lapses keeps full yield.
alter table lesson.user_course_runtime_state
  add column if not exists lapse_count integer not null default 0;
