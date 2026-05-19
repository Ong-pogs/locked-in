-- Off-chain ichor balance. Originally we read ichor from the on-chain
-- lock_vault snapshot, but the lock-vault relay for ichor mutations
-- isn't wired up in this dev phase. Pulling ichor into the DB so the
-- backend owns it: lessons add 20-50 (random), the shop spends it on
-- streak savers.

alter table lesson.user_course_runtime_state
  add column if not exists ichor_counter bigint not null default 0,
  add column if not exists ichor_lifetime_total bigint not null default 0;
