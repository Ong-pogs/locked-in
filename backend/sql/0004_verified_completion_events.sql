-- Store verified lesson completion events for downstream Fuel / on-chain workers.

create table if not exists lesson.verified_completion_events (
  event_id uuid primary key,
  wallet_address text not null,
  course_id text not null references lesson.courses(id) on delete cascade,
  lesson_id text not null references lesson.lessons(id) on delete cascade,
  lesson_version_id uuid not null references lesson.lesson_versions(id) on delete restrict,
  lesson_attempt_id uuid not null unique references lesson.user_lesson_attempts(id) on delete cascade,
  completion_day date not null,
  reward_units integer not null,
  score integer not null,
  correct_answers integer not null,
  total_questions integer not null,
  payload jsonb not null,
  status text not null default 'pending',
  published_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  check (reward_units >= 0),
  check (score >= 0 and score <= 100),
  check (correct_answers >= 0),
  check (total_questions >= 0),
  check (status in ('pending', 'published', 'failed'))
);

create index if not exists verified_completion_events_status_idx
  on lesson.verified_completion_events (status, created_at);

create index if not exists verified_completion_events_wallet_day_idx
  on lesson.verified_completion_events (wallet_address, completion_day desc);
