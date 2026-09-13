-- 0066: queue pairings become a proposal both players must accept.
--
-- Until now enterQueue created a live match the instant it paired two people,
-- and the pair were dropped straight into it. There was no way to decline, and
-- no way to tell whether the person you were paired with was still at their
-- desk — a queue match against someone who had wandered off looked exactly
-- like a real one until the 24h window expired.
--
-- A pairing is now PROPOSED. Both players accept within a few seconds or the
-- proposal dies; whoever did accept goes back in the queue rather than being
-- punished for the other's silence.
--
-- WHY REUSE expires_at RATHER THAN A NEW COLUMN
--
-- arena.matches.expires_at already drives the sweep, and a proposal is just a
-- match with a very short window. Reusing it means a proposal nobody answers
-- is cleaned up by machinery that already exists and is already tested, and it
-- keeps the "one place decides when a match is over" property. On acceptance
-- the column is pushed back out to the normal 24h play window.

-- ---------- PROPOSED joins the status set ----------
-- The constraint is the inline one from 0063, which Postgres named for us.
alter table arena.matches
  drop constraint if exists matches_status_check;
alter table arena.matches
  add constraint matches_status_check
  check (status in ('PROPOSED', 'OPEN', 'ACTIVE', 'COMPLETE', 'EXPIRED'));

-- ---------- Per-player acceptance ----------
-- Null means "has not answered the proposal yet". A match goes ACTIVE only
-- once every row for it is stamped, which is also what makes accepting twice
-- harmless.
alter table arena.match_players
  add column if not exists accepted_at timestamptz;

-- The lookup the proposal poll makes every couple of seconds.
create index if not exists arena_matches_proposed_idx
  on arena.matches (status, expires_at) where status = 'PROPOSED';

comment on column arena.match_players.accepted_at is
  'When this player accepted the queue proposal. Null until they answer; a '
  'match leaves PROPOSED only when no row for it is still null. Link matches '
  'never enter PROPOSED, so their rows stay null for the life of the match.';
