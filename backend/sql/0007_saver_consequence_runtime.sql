-- Saver consequence runtime state and idempotent miss-event receipts.

alter table lesson.user_course_runtime_state
  add column if not exists saver_count integer not null default 0,
  add column if not exists current_yield_redirect_bps integer not null default 0,
  add column if not exists extension_days integer not null default 0,
  add column if not exists last_miss_day date;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_course_runtime_state_saver_count_check'
  ) then
    alter table lesson.user_course_runtime_state
      add constraint user_course_runtime_state_saver_count_check
        check (saver_count >= 0 and saver_count <= 3) not valid;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_course_runtime_state_current_yield_redirect_bps_check'
  ) then
    alter table lesson.user_course_runtime_state
      add constraint user_course_runtime_state_current_yield_redirect_bps_check
        check (current_yield_redirect_bps >= 0 and current_yield_redirect_bps <= 10000) not valid;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_course_runtime_state_extension_days_check'
  ) then
    alter table lesson.user_course_runtime_state
      add constraint user_course_runtime_state_extension_days_check
        check (extension_days >= 0) not valid;
  end if;
end $$;

create table if not exists lesson.miss_consequence_receipts (
  wallet_address text not null,
  course_id text not null references lesson.courses(id) on delete cascade,
  miss_event_id text not null,
  miss_day date not null,
  applied boolean not null,
  reason text not null,
  saver_count_before integer not null,
  saver_count_after integer not null,
  redirect_bps_before integer not null,
  redirect_bps_after integer not null,
  extension_days_before integer not null,
  extension_days_after integer not null,
  created_at timestamptz not null default now(),
  primary key (wallet_address, course_id, miss_event_id)
);

create index if not exists miss_consequence_receipts_miss_day_idx
  on lesson.miss_consequence_receipts (miss_day desc);
