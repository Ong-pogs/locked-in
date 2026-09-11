-- 0063: the Arena — a 1v1 async quiz ladder.
--
-- Spec: docs/superpowers/specs/2026-09-11-arena-1v1-design.md
--
-- WHY A SEPARATE SCHEMA
--
-- The arena must never touch principal, yield, shields, lapses, streak, the
-- community pot, leaderboard weight or completion vouchers. It writes to
-- arena.* and to lesson.user_xp / lesson.user_xp_events, and nothing else.
--
-- Putting it in its own schema makes that boundary structural rather than a
-- convention someone has to remember: a stray `update lesson.…` inside the
-- arena module is visible in review instead of blending into 5k lines of
-- neighbouring money code. The contract is also enforced by an executable
-- test (tests/integration/api/arenaIsolation.test.mjs), not just this comment.
--
-- Nothing here is convertible into money. Rating buys nothing; XP is defined
-- as cosmetic by 0029. That is what keeps a PvP game mode out of reach of the
-- collusion economics that rule out staking shields or pot share.

create extension if not exists pgcrypto;
create schema if not exists arena;

-- ---------- Question bank ----------
-- Authored only for the arena and never shown in a lesson. Lesson questions
-- are unusable here: the lesson submit path returns correctAnswer to the
-- client (progress/repository.mjs:1390), so anyone who completed the lesson
-- has already been handed the key, and cross-course pairings would expose
-- content the opponent has not unlocked.
create table if not exists arena.questions (
  id                text primary key,
  topic             text not null,
  difficulty        text not null check (difficulty in ('easy', 'medium', 'hard')),
  prompt            text not null,
  options           jsonb not null,
  correct_option_id text not null,
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  check (jsonb_array_length(options) = 3)
);

create index if not exists arena_questions_active_idx
  on arena.questions (active, topic) where active;

-- ---------- Matches ----------
create table if not exists arena.matches (
  id           uuid primary key default gen_random_uuid(),
  join_code    text unique,
  origin       text not null check (origin in ('link', 'queue')),
  status       text not null check (status in ('OPEN', 'ACTIVE', 'COMPLETE', 'EXPIRED')),
  creator      text not null,
  opponent     text,
  -- Fixed at creation so both players provably get the identical set. A text[]
  -- cannot carry a foreign key; integrity is enforced at draw time (only
  -- active rows) and by match_answers.question_id's real FK below.
  question_ids text[] not null,
  season       integer not null default 1,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  resolved_at  timestamptz,
  check (opponent is null or opponent <> creator)
);

create index if not exists arena_matches_join_code_idx
  on arena.matches (join_code) where join_code is not null;
create index if not exists arena_matches_open_idx
  on arena.matches (status, expires_at);
create index if not exists arena_matches_creator_idx
  on arena.matches (creator, created_at desc);
create index if not exists arena_matches_opponent_idx
  on arena.matches (opponent, created_at desc);

-- ---------- Per-player attempt ----------
-- The primary key is the "one attempt per player" rule.
create table if not exists arena.match_players (
  match_id       uuid not null references arena.matches(id) on delete cascade,
  wallet_address text not null,
  joined_at      timestamptz not null default now(),
  started_at     timestamptz,
  submitted_at   timestamptz,
  correct_count  integer,
  total_ms       integer,
  forfeited      boolean not null default false,
  primary key (match_id, wallet_address)
);

-- ---------- Per-question answers ----------
-- A row is inserted when the question is SERVED (stamping served_at), then
-- updated when answered. That is what makes the 20s timeout measurable, and
-- what keeps timing server-authoritative.
create table if not exists arena.match_answers (
  match_id         uuid not null references arena.matches(id) on delete cascade,
  wallet_address   text not null,
  question_id      text not null references arena.questions(id) on delete restrict,
  question_order   integer not null,
  served_at        timestamptz not null,
  answered_at      timestamptz,
  chosen_option_id text,
  is_correct       boolean not null default false,
  elapsed_ms       integer not null default 0,
  primary key (match_id, wallet_address, question_id)
);

create index if not exists arena_match_answers_player_idx
  on arena.match_answers (match_id, wallet_address, question_order);

-- ---------- Ladder ----------
create table if not exists arena.ratings (
  wallet_address text not null,
  season         integer not null default 1,
  rating         integer not null default 1200,
  games          integer not null default 0,
  wins           integer not null default 0,
  losses         integer not null default 0,
  draws          integer not null default 0,
  updated_at     timestamptz not null default now(),
  primary key (wallet_address, season)
);

create index if not exists arena_ratings_ladder_idx
  on arena.ratings (season, rating desc);

-- Audit log AND the idempotency mechanism: the unique key below is what makes
-- "a match settles exactly once" true under concurrency, the same way 0044's
-- partial unique index does for XP. A second settle raises and rolls back.
create table if not exists arena.rating_events (
  id             uuid primary key default gen_random_uuid(),
  match_id       uuid not null references arena.matches(id) on delete cascade,
  wallet_address text not null,
  rating_before  integer not null,
  rating_after   integer not null,
  delta          integer not null,
  created_at     timestamptz not null default now(),
  unique (match_id, wallet_address)
);

-- ---------- Open matchmaking queue ----------
create table if not exists arena.queue (
  wallet_address text primary key,
  season         integer not null default 1,
  enqueued_at    timestamptz not null default now()
);

create index if not exists arena_queue_fifo_idx on arena.queue (enqueued_at);
