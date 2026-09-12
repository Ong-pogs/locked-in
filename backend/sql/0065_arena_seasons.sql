-- 0065: arena stake seasons — the loser side.
--
-- Spec: docs/superpowers/specs/2026-09-12-arena-staking-design.md
--
-- WHAT THIS CHANGES ABOUT 0063
--
-- 0063's header says "Nothing here is convertible into money. Rating buys
-- nothing." That is no longer true, and the sentence is amended at the end of
-- this file rather than left to mislead the next reader. A player may now
-- stake one course lock on a season; losing it costs that lock exactly one
-- yield tier. Principal is untouched either way.
--
-- WHICH "SEASON"
--
-- arena.matches.season / arena.ratings.season / arena.queue.season are the
-- RATING LADDER generation. They are permanently 1 and nothing advances them —
-- arena.ratings is keyed (wallet_address, season), so bumping that integer
-- would reset every ladder. The stake season is a SEPARATE axis and is always
-- spelled stake_season_id.
--
-- WHO WRITES THE PENALTY
--
-- Nothing in the arena module does. arena.season_entries.outcome is written by
-- the season cron; the progress/voucher path READS it when it signs. The
-- dependency points one way on purpose, which is what keeps the isolation
-- contract in tests/integration/api/arenaIsolation.test.mjs true.

-- ---------- Seasons ----------
create table if not exists arena.seasons (
  id         integer primary key,
  starts_at  timestamptz not null,
  ends_at    timestamptz not null,
  status     text not null check (status in ('OPEN', 'CLOSED', 'SETTLED')),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

-- At most one season may be OPEN at a time. This is the mechanism, not a
-- convention: opt-in resolves "the current season" by selecting where
-- status = 'OPEN', and two open seasons would make that ambiguous.
create unique index if not exists arena_seasons_single_open_idx
  on arena.seasons ((status)) where status = 'OPEN';

-- ---------- Entries ----------
-- Keyed (stake_season_id, wallet_address, course_id) and NOT by wallet alone:
-- the tier is signed per (wallet, course) because lesson.completion_vouchers
-- is keyed that way and the lock PDA is [lock-v2, owner, course_id_hash]. A
-- wallet may hold several concurrent locks; only the staked one is penalised.
create table if not exists arena.season_entries (
  stake_season_id integer not null references arena.seasons(id),
  wallet_address  text not null,
  course_id       text not null,
  lock_address    text not null,
  -- The lock PDA is [lock-v2, owner, course_id_hash], so lock_address is
  -- IDENTICAL for every lock a wallet ever opens on a course — it identifies
  -- the slot, not the position in it. lock_start_ts is what distinguishes one
  -- lock instance from its replacement, and without it a forfeit would follow
  -- a user into a brand-new lock that never entered the Arena.
  lock_start_ts   bigint not null default 0,
  opted_in_at     timestamptz not null default now(),
  consent_version text not null,
  rating_at_start integer not null,
  rating_at_end   integer,
  -- The value that decides the outcome: the sum of this wallet's rating
  -- deltas over COUNTED staked matches. rating_at_* are display only.
  staked_delta    integer,
  outcome         text not null default 'PENDING'
                  check (outcome in ('PENDING', 'KEPT', 'FORFEIT', 'VOID')),
  voided_reason   text,
  settled_at      timestamptz,
  primary key (stake_season_id, wallet_address, course_id)
);

create index if not exists arena_season_entries_pending_idx
  on arena.season_entries (stake_season_id, outcome);

-- ONE staked course per wallet per season. The primary key is per-course so a
-- wallet's other locks are provably untouched, but the season's outcome is a
-- single summed delta for that wallet — so allowing two entries would take a
-- tier off two locks for one lost match, and disclose only one of them.
create unique index if not exists arena_season_entries_one_per_wallet_idx
  on arena.season_entries (stake_season_id, wallet_address);
-- The lookup the voucher signer makes on every issue.
create index if not exists arena_season_entries_lookup_idx
  on arena.season_entries (wallet_address, course_id, lock_address, outcome);

-- ---------- Which matches counted ----------
create table if not exists arena.season_match_links (
  stake_season_id integer not null references arena.seasons(id),
  match_id        uuid not null references arena.matches(id) on delete cascade,
  wallet_address  text not null,
  -- false once this pair has already met twice in this season, so a colluding
  -- pair cannot grind a season outcome between themselves.
  counted         boolean not null default true,
  created_at      timestamptz not null default now(),
  primary key (stake_season_id, match_id, wallet_address)
);

create index if not exists arena_season_links_wallet_idx
  on arena.season_match_links (stake_season_id, wallet_address, counted);

-- ---------- RLS ----------
-- Both tables now carry a wallet's money consequence, so they get the same
-- treatment as lesson.completion_vouchers (0047:22-28). arena.seasons itself
-- is public calendar data and is deliberately left open.
alter table arena.season_entries enable row level security;
alter table arena.season_entries force row level security;
drop policy if exists season_entries_wallet_policy on arena.season_entries;
create policy season_entries_wallet_policy
  on arena.season_entries
  using ((current_setting('request.jwt.claim.wallet_address', true)) = wallet_address)
  with check ((current_setting('request.jwt.claim.wallet_address', true)) = wallet_address);

alter table arena.season_match_links enable row level security;
alter table arena.season_match_links force row level security;
drop policy if exists season_match_links_wallet_policy on arena.season_match_links;
create policy season_match_links_wallet_policy
  on arena.season_match_links
  using ((current_setting('request.jwt.claim.wallet_address', true)) = wallet_address)
  with check ((current_setting('request.jwt.claim.wallet_address', true)) = wallet_address);

-- ---------- The tier travels with the voucher ----------
-- A voucher is signed at course completion with a 90-day TTL, against a 30-day
-- season, so a learner who finishes mid-season gets a voucher signed BEFORE
-- their season settles. Storing the tier here is what lets a re-issue replay
-- the bps the user was actually given instead of recomputing a different one.
--
-- The stored value is not the last word: a season that settles FORFEIT after
-- the voucher was signed raises the resolved tier, and the read path re-signs
-- once to match. That correction is one-directional — a captured penalty is
-- never lifted — so the bps a user sees only ever moves toward the tier they
-- consented to when they staked.
alter table lesson.completion_vouchers
  add column if not exists arena_penalty_tiers integer not null default 0;

alter table lesson.completion_vouchers
  drop constraint if exists completion_vouchers_arena_penalty_tiers_check;
alter table lesson.completion_vouchers
  add constraint completion_vouchers_arena_penalty_tiers_check
  check (arena_penalty_tiers >= 0 and arena_penalty_tiers <= 1);

-- ---------- Amend the 0063 claim this change makes false ----------
comment on schema arena is
  'The Arena. Rating is no longer purely cosmetic: as of 0065 a player may '
  'stake ONE course lock on a 30-day season, and a losing season costs that '
  'lock exactly one yield tier (10000 -> 5000 -> 0 bps). Principal is never '
  'at risk. The arena module still writes only arena.* and lesson.user_xp / '
  'lesson.user_xp_events — the voucher signer READS arena.season_entries; '
  'nothing in arena writes a lesson.* money table.';
