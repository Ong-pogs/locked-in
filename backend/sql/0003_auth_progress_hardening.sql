-- Harden auth/session persistence and make lesson attempts idempotent.

create schema if not exists lesson_auth;

create table if not exists lesson_auth.wallet_challenges (
  id uuid primary key,
  wallet_address text not null,
  message text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists wallet_challenges_wallet_idx
  on lesson_auth.wallet_challenges (wallet_address, expires_at desc);

create index if not exists wallet_challenges_open_idx
  on lesson_auth.wallet_challenges (expires_at)
  where consumed_at is null;

create table if not exists lesson_auth.refresh_sessions (
  token_id uuid primary key,
  wallet_address text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  consumed_at timestamptz,
  revoked_at timestamptz,
  replaced_by uuid references lesson_auth.refresh_sessions(token_id)
);

create index if not exists refresh_sessions_wallet_idx
  on lesson_auth.refresh_sessions (wallet_address, created_at desc);

create index if not exists refresh_sessions_open_idx
  on lesson_auth.refresh_sessions (expires_at)
  where consumed_at is null and revoked_at is null;

create unique index if not exists user_question_attempts_attempt_question_idx
  on lesson.user_question_attempts (lesson_attempt_id, question_id);

alter table lesson.user_course_enrollments force row level security;
alter table lesson.user_lesson_progress force row level security;
alter table lesson.user_lesson_attempts force row level security;
alter table lesson.user_question_attempts force row level security;
