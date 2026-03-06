-- Off-chain runtime state used until the on-chain LockAccount becomes the source of truth.

create table if not exists lesson.user_course_runtime_state (
  wallet_address text not null,
  course_id text not null references lesson.courses(id) on delete cascade,
  current_streak integer not null default 0,
  longest_streak integer not null default 0,
  gauntlet_active boolean not null default true,
  gauntlet_day integer not null default 1,
  saver_recovery_mode boolean not null default false,
  fuel_counter integer not null default 0,
  fuel_cap integer not null default 7,
  last_completed_day date,
  last_fuel_credit_day date,
  last_brewer_burn_ts timestamptz,
  updated_at timestamptz not null default now(),
  primary key (wallet_address, course_id),
  check (current_streak >= 0),
  check (longest_streak >= 0),
  check (gauntlet_day >= 1 and gauntlet_day <= 8),
  check (fuel_counter >= 0),
  check (fuel_cap >= 7 and fuel_cap <= 14)
);

create index if not exists user_course_runtime_state_course_idx
  on lesson.user_course_runtime_state (course_id, updated_at desc);

alter table lesson.user_course_runtime_state enable row level security;
alter table lesson.user_course_runtime_state force row level security;

create policy user_course_runtime_state_wallet_policy
  on lesson.user_course_runtime_state
  using ((current_setting('request.jwt.claim.wallet_address', true)) = wallet_address)
  with check ((current_setting('request.jwt.claim.wallet_address', true)) = wallet_address);
