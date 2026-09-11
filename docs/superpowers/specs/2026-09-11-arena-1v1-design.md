# The Arena — 1v1 Quiz Ladder — Design

**Date:** 2026-09-11
**Status:** approved-pending-user-review
**Scope owner:** backend (new `arena` schema + module) + web-app (new routes) + one targeted lib extraction

## Problem

Locked In's thesis is "loss aversion + real stakes + streaks + **social rewards**".
Three of those four legs are built. The social leg is a single ranked list on
the Noticeboard — you can see that someone has a longer streak than you, and
that is the entire social surface.

There is also a retention cliff. Practice Mode explicitly "writes nothing: no
streak, no XP, no progress records" (`docs-site/content/game-systems/practice-mode.mdx`),
so a user who finishes a course has no mechanical reason to open the app again
until they lock a new one. That is exactly the moment the product loses people.

The Arena is a head-to-head quiz ladder that gives finished learners a daily
reason to return, and gives the social leg something to actually do.

## Decisions (from brainstorming, 2026-09-11)

| Decision | Choice | Why |
|---|---|---|
| Stakes | **Arena rating + XP. No money.** | See "Why no money" below — the money options are all exploitable or regulated. |
| Format | **Async**, same question set, 24h window | No realtime infra exists; async works across timezones and on a PWA. |
| Opponent | **Link challenge + open queue** | Link works at any population; queue is layered on for later scale. |
| Questions | **Dedicated arena bank** | Only option that survives arbitrary pairings without leaking locked content. |
| Engine | **Standalone `arena` schema/module** | The lesson engine gates real funds; a game mode must not be entangled with it. |

## Why no money — the options that were rejected

These were each considered and rejected on evidence, not taste. Recording them
so they are not relitigated later.

- **USDC ante.** Breaks the platform's core promise that principal is never
  slashed, and a real-money wager on a skill contest is regulated gambling in
  many jurisdictions regardless of skill content.
- **Winner takes a Shield.** Thematically the strongest option and the most
  dangerous one. `docs-site/content/game-systems/streak-shields-lapses.mdx`
  states "Can you buy Shields? **No.** Shields are only earned by learning."
  More importantly shields protect *yield*: two colluding accounts trading
  wins farm shields, never lapse, and keep 100% of yield permanently. A
  cosmetic-looking reward that is convertible into money.
- **Pot-funded prize.** `docs-site/content/your-money/community-pot.mdx` says
  the pot is funded "only by redirected yield — never by principal, and never
  topped up with house money that could distort incentives", and pays out to
  streak-keepers. Diverting it to arena winners changes who the pot serves.
  Not impossible, but a public values change, not an implementation detail.
- **Winner takes leaderboard weight.** Same collusion-farming shape as
  shields, against a real payout.

XP is safe because `backend/sql/0029_user_xp.sql` defines it as "cosmetic
progression". Rating is safe because it buys nothing.

## Explicit non-goals

- **No real-time play.** No WebSocket/SSE server. Confirmed absent from the
  backend today; adding it is its own spec.
- **No money, in any direction.** No ante, no prize, no pot interaction, no
  effect on yield, shields, lapses, streak, vouchers, or leaderboard weight.
- **No short-text questions.** They route through the LLM grader
  (`gradeSubjectiveAnswerWithLlm`) — too slow, too costly and non-deterministic
  for a timed race. Arena is MCQ-only.
- **No season resets in v1.** Ship the `season` column, no reset job.
- **No ghost replay in v1.** Store per-question timings so it is later a
  client-only addition; do not build the UI now.
- **No on-chain component.** Nothing here touches Solana.

## The isolation contract

This is the single most important property of the feature and it gets an
enforcing test, not a comment.

> A completed arena match writes rows to `arena.*` and to
> `lesson.user_xp` / `lesson.user_xp_events`. **Nothing else.**

In particular it must never write `lesson.user_course_runtime_state`,
`lesson.user_lesson_progress`, `lesson.user_lesson_attempts`,
`lesson.completion_vouchers`, `lesson.claim_attempts`,
`lesson.unlock_receipts`, `lesson.miss_consequence_receipts`, or
`lesson.harvest_result_receipts`.

## Verified facts this design depends on

Checked against the repo on 2026-09-11:

1. **The lesson engine hands the answer key to the client after submit.**
   `backend/src/modules/progress/repository.mjs:1390` returns
   `correctAnswer` in the graded submit response, and `:4622` does the same on
   `/check`. The arena must NOT copy this — see Anti-cheat.
2. **`awardXp` is module-private.** `repository.mjs:82`,
   `async function awardXp(client, walletAddress, amount, source, sourceId)`
   with no `export`. It takes a client so it joins the caller's transaction.
3. **XP double-award is already solved.** `backend/sql/0044_xp_events_unique.sql`
   adds the partial unique index on `(wallet_address, source, source_id)` that
   `awardXp`'s `ON CONFLICT` targets. Passing `source_id = match_id` makes
   arena XP idempotent for free.
4. **No realtime infrastructure exists** in `backend/src` or `web-app`.
5. **`migrate.mjs` is the only sanctioned SQL executor** (ruling R22). Highest
   applied migration is `0062`; arena starts at `0063`.
6. **Current production scale is ~4 enrolled users** (audit, 2026-09-11:
   `user_course_enrollments = 4`, `user_lesson_progress = 12`,
   `completion_vouchers = 1`). The open queue will effectively never fill at
   this size — hence the link-first design and the queue's degradation path.
7. **Working copy is CRLF** (`core.autocrlf=true`) while the migration tracker
   records LF checksums from CI. New migration files must be written with **LF
   endings** or they record hashes that permanently disagree with CI.

## Data model — new `arena` schema

A separate schema makes the isolation contract structural rather than a
convention someone has to remember. `migrate.mjs` already does
`create schema if not exists lesson`; the first arena migration does the same
for `arena`.

```sql
create schema if not exists arena;

create table arena.questions (
  id            text primary key,
  topic         text not null,
  difficulty    text not null check (difficulty in ('easy','medium','hard')),
  prompt        text not null,
  options       jsonb not null,          -- [{id, text}] exactly 3
  correct_option_id text not null,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

create table arena.matches (
  id            uuid primary key default gen_random_uuid(),
  join_code     text unique,             -- null for queue-made matches
  origin        text not null check (origin in ('link','queue')),
  status        text not null check (status in ('OPEN','ACTIVE','COMPLETE','EXPIRED')),
  creator       text not null,
  opponent      text,
  question_ids  text[] not null,         -- fixed at creation, ordered
  season        integer not null default 1,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  resolved_at   timestamptz
);

create table arena.match_players (
  match_id      uuid not null references arena.matches(id) on delete cascade,
  wallet_address text not null,
  joined_at     timestamptz not null default now(),
  started_at    timestamptz,
  submitted_at  timestamptz,
  correct_count integer,
  total_ms      integer,
  forfeited     boolean not null default false,
  primary key (match_id, wallet_address)   -- one attempt per player, enforced
);

create table arena.match_answers (
  match_id      uuid not null references arena.matches(id) on delete cascade,
  wallet_address text not null,
  question_id   text not null references arena.questions(id) on delete restrict,
  question_order integer not null,
  served_at     timestamptz not null,      -- server-stamped
  chosen_option_id text,                   -- null = timed out
  is_correct    boolean not null,
  elapsed_ms    integer not null,
  primary key (match_id, wallet_address, question_id)
);

create table arena.ratings (
  wallet_address text not null,
  season        integer not null default 1,
  rating        integer not null default 1200,
  games         integer not null default 0,
  wins          integer not null default 0,
  losses        integer not null default 0,
  draws         integer not null default 0,
  updated_at    timestamptz not null default now(),
  primary key (wallet_address, season)
);

create table arena.rating_events (
  id            uuid primary key default gen_random_uuid(),
  match_id      uuid not null references arena.matches(id) on delete cascade,
  wallet_address text not null,
  rating_before integer not null,
  rating_after  integer not null,
  delta         integer not null,
  created_at    timestamptz not null default now(),
  unique (match_id, wallet_address)        -- rating applied at most once
);

create table arena.queue (
  wallet_address text primary key,
  season        integer not null default 1,
  enqueued_at   timestamptz not null default now()
);
```

The `unique (match_id, wallet_address)` on `rating_events` is the correctness
mechanism for "a match settles exactly once", mirroring how `0044` made XP
idempotent. Resolution is wrapped in a transaction that inserts rating events
first; a duplicate settle hits the constraint and rolls back.

`matches.question_ids` is a `text[]` and therefore **cannot carry a foreign
key** to `arena.questions`. Referential integrity there is application-enforced
at match creation (draw only `active` rows), and `arena.match_answers.question_id`
*does* carry a real FK with `on delete restrict` — so a question that has ever
been played cannot be deleted. Retiring a question means setting
`active = false`, never deleting it.

## Match lifecycle

```
        create (link)                     join / queue-pair
OPEN ─────────────────────────> ACTIVE ──────────────────────> COMPLETE
  │                                 │   (both submitted)
  │ 24h, nobody joined              │ 24h, one or both silent
  └──────────> EXPIRED              └──────────────> COMPLETE (forfeit)
```

- **Create.** Creator picks nothing; the server draws 7 active questions
  (difficulty-mixed, no repeats) and fixes `question_ids` at creation so both
  players provably get the identical set. Link matches get a `join_code`.
- **Join.** By code, or by queue pairing. Self-join is rejected.
- **Play.** Each player independently, once, any time before `expires_at`.
- **Resolve.** When both `submitted_at` are set, or at expiry via a sweep.
  A player who never started is `forfeited = true`, scored 0 correct /
  max time.
- **Both sides silent.** If neither player ever started, the match ends
  `EXPIRED` with **no rating change and no XP** for either side. The scoring
  comparator would otherwise read two forfeits as a legitimate draw and move
  the Elo of two people who never played. A match where exactly one side
  played resolves `COMPLETE` as a normal forfeit win.
- **Nobody joined.** A link challenge that expires unclaimed ends `EXPIRED`,
  no rating change; the creator is not penalised for an unanswered invite.

**Queue degradation.** `POST /arena/queue` returns immediately with a ticket;
the client polls. If no pairing within ~30s the response offers to convert to
a link challenge. At current scale this is the normal path, not an edge case,
and the UI should say so plainly rather than spinning.

**Expiry sweep.** A cron in the existing `render.yaml` style (the repo already
runs `cron:lapse-sweep`, `cron:pot-cycle`, `cron:leaderboard-refresh`).
Idempotent and advisory-locked, matching those.

## API surface

All under `/v1/arena`, all JWT-authed, following `modules/content` +
`modules/progress` route conventions.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/matches` | Create a link challenge → `{matchId, joinCode}` |
| `POST` | `/matches/:id/join` | Join by id |
| `POST` | `/join/:code` | Join by challenge code |
| `POST` | `/matches/:id/start` | Begin your attempt; returns question 1 only |
| `GET`  | `/matches/:id/question` | Serve the next unanswered question |
| `POST` | `/matches/:id/answer` | Submit one answer → correct/incorrect + next |
| `GET`  | `/matches/:id` | Match state; full results only once resolved |
| `POST` | `/queue` / `DELETE` `/queue` | Enter / leave the open queue |
| `GET`  | `/ladder` | Top 100 by rating for the season (matches the existing leaderboard's page size) |
| `GET`  | `/me` | Your rating, record, recent matches |

## Scoring and rating

**Score.** `correct_count` descending, then `total_ms` ascending. Equal on
both ⇒ draw. Per-question cap **20s**; a timeout scores incorrect with
`elapsed_ms = 20000`. Match is **7 questions** (~2 minutes, mobile-appropriate).

**Rating.** Standard Elo, start **1200**, **K = 32**, draw `S = 0.5`:

```
E_a       = 1 / (1 + 10^((R_b - R_a) / 400))
R_a_new   = R_a + K * (S_a - E_a)
```

Forfeit is a loss. Both players' deltas are written to `arena.rating_events`
in the settling transaction.

**Anti-farming.** Rating delta is damped for repeat opponents: the *n*th rated
match against the same opponent within a rolling 24h window scales K by
`1/n` (so 32, 16, 10, 8...). Two accounts trading wins converge to ~0 gain
without punishing genuine rivalries.

**XP.** Win **50**, draw **25**, loss **10**, via the extracted `awardXp` with
`source = 'arena_win' | 'arena_draw' | 'arena_loss'` and
`source_id = match_id`. Capped at **5 XP-earning matches per UTC day** per
wallet; matches beyond that are still rated but award 0 XP.

## Anti-cheat

The lesson engine's post-submit key reveal (fact 1) is the exact thing to
avoid here, because arena questions are reused across many matches.

1. **Questions are served one at a time.** `question_ids` is never sent to the
   client; `GET /question` returns the next unanswered one. The client cannot
   dump the set and look it up.
2. **`correct_option_id` never leaves the server** until that player's match is
   `COMPLETE`. The per-answer response says correct/incorrect only.
3. **Timing is server-authoritative.** `served_at` is stamped server-side;
   `elapsed_ms` is computed from it, and the client's claim is ignored.
   Clamped to the 20s cap.
4. **One attempt per player** by the `match_players` primary key; a second
   `start` or a second `answer` for the same question is rejected.
5. **Rate limits** on match creation and queue entry, using the existing
   `@fastify/rate-limit` already in `backend/package.json`.

Accepted residual risk: two humans can still collude by sharing answers out of
band. The rating damper makes it worthless and XP is cosmetic, so the payoff
is bounded at zero. Worth stating rather than pretending it is solved.

## Content — the arena bank

~100 questions at launch, `topic` aligned to the live catalog (wallets, keys,
explorers, tokens/NFTs/staking, DeFi lending, swaps/DEXs, stablecoins),
`difficulty` mixed. Prompt + exactly 3 options + one key — no prose blocks, so
far cheaper to author than lesson content.

Seeded by migration in the style established by `0060`/`0061`: a single
authoritative spec value with in-migration guards that **fail the migration**
if any `correct_option_id` is not one of that question's own option ids, or if
any question does not have exactly 3 options. Written with **LF endings**
(fact 7).

## Frontend surface

New village location — **The Arena** — alongside the Practice Hall and Tavern.

| Route | Purpose |
|---|---|
| `/arena` | Ladder, your record, "Challenge a friend" / "Find opponent" |
| `/arena/[matchId]` | Play: one question, countdown ring, then result |
| `/arena/join/[code]` | Invite landing — the signup funnel for non-users |

`/arena/join/[code]` is the growth loop: it must render something meaningful
to a logged-out visitor (who challenged them, the topic) before asking them to
sign in.

## Testing

- **Unit:** Elo math including draws and the repeat-opponent damper; scoring
  comparator including the time tiebreak and the exact-draw case; the 20s
  timeout path.
- **Integration (api project):** full lifecycle create → join → play → resolve;
  forfeit-by-expiry; double-submit rejection; self-join rejection; joining a
  full match; playing an expired match.
- **Answer-key non-exposure:** assert no arena HTTP response contains
  `correct_option_id` before resolution — the mirror of the check already
  written for lesson payloads.
- **Isolation guard:** run a complete match, then assert row counts in every
  `lesson.*` table listed in "The isolation contract" are unchanged, and that
  only `lesson.user_xp*` moved. This test is the contract.
- **Idempotent settle:** settle the same match twice, assert one set of
  `rating_events` and one XP award.

## Migration plan

| File | Contents |
|---|---|
| `0063_arena_schema.sql` | `arena` schema + all seven tables + indexes |
| `0064_seed_arena_question_bank.sql` | ~100 questions with in-migration guards |

Both LF-terminated. Verified before apply the same way `0060`–`0062` were: full
chain replay into a throwaway Postgres, then the real content/arena repository
run against it, then production audit → dry-run → apply.

## Risks and open questions

1. **Population.** At ~4 users the queue cannot fill and the ladder is thin.
   Mitigated by link-first design, but the ladder will look empty for a while.
   Accepted.
2. **Bank exhaustion.** With 100 questions and 7 per match, a heavy player
   sees repeats quickly, and repeats favour whoever has played more. Mitigate
   by tracking per-wallet recently-seen question ids and preferring unseen
   ones; revisit bank size once there is usage.
3. **`awardXp` extraction touches the money path.** Moving it out of
   `repository.mjs` (5,306 lines, 4 call sites) is behaviour-preserving but
   edits a file that gates funds. Do it as an isolated first commit with the
   existing progress tests green before any arena code lands.
