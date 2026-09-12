# Arena Staking — Season Yield Stake — Design

**Date:** 2026-09-12 (rev 2, after adversarial audit)
**Status:** approved-pending-user-review
**Scope owner:** backend (arena + progress) + web-app. **No on-chain change. No program upgrade.**

## Problem

The Arena plays for rating and XP only. The owner wants real stakes: players lock USDC, play,
and losers forfeit yield while winners gain — principal never at risk, settlement server-signed.

The literal proposal — *"winner takes the loser's yield, both principals stay locked,
server-signed"* — was investigated against the code and is **not implementable as stated**.
This spec records why, then specifies the version that delivers the intent with no on-chain risk.

## Why the literal design is impossible (investigated 2026-09-12)

1. **The server cannot settle; the loser must sign.** `vault_v2.rs:502` — `ClaimV2` requires
   `owner: Signer`. The only signer-free exit is `force_return_v2`, gated 180 days out and
   hardcoding `bps 0` so *all* yield goes to the pot (`vault_v2.rs:322`).
2. **Yield is not a movable quantity.** It exists only as `redeemed - principal` when the entire
   Kamino position is redeemed. `redeem_and_split` always redeems the full share balance, closes
   both ATAs and closes the lock (`vault_v2.rs:156-197`). No partial redeem exists.
3. **No path pays one lock's yield to another user.** All destinations are address-pinned.
   `voucher.rs:12-16` documents the voucher as *user-favourable by construction*.
4. **The stake is often zero and unknowable at bet time.** `settle.rs:49-52` returns everything to
   the owner when `redeemed <= principal` — the normal outcome for a young lock.

**Economics, recorded.** At beta caps (`caps.rs`: $10–$50 per lock, $1,000 global TVL) the platform
generates **$43.90 of yield per year**. Today: $40 TVL, 4.39% APY, ~$0.20 lifetime yield.
**A forfeited tier is worth roughly $0.03.** No per-match on-chain settlement can pay for itself.

## Decision reversal (explicit)

`2026-09-11-arena-1v1-design.md` rejected money in the Arena and recorded it "so they are not
relitigated later". **Reversed for yield only**, on the owner's explicit instruction (2026-09-12):

- **Principal is still never at risk.** Only yield is forfeitable.
- **The gambling objection is narrowed, not removed.** Closer to a no-loss prize draw than a wager.
  The owner accepted this knowingly. **This is not legal advice.**
- **The collusion objection is answered by fix 5 below**, which scores only staked matches.

## The design: a season yield stake

The lever exists and the server already owns it. `claimVoucher.mjs:22` —
`VALID_YIELD_BPS = [10_000, 5_000, 0]`, mirrored by `settle.rs`. `vault_v2.rs:13` routes
"principal + yield × bps to owner, **the rest to the pot**".

**A lost Arena season costs the backing lock one tier.** The forfeited half flows to the pot
through the path a lapse already uses.

### Season model

| Rule | Value |
|---|---|
| Season length | 30 days, platform-fixed, no early exit |
| Entry | explicit opt-in naming **one course lock**; requires ACTIVE on-chain lock, principal > 0 |
| **Stake binds** | **at opt-in** |
| **Losing condition** | **summed staked rating delta < 0** |
| Penalty | **exactly one tier**, never more (100%→50%, or 50%→0%) |
| Winner reward (phase 2) | weighted pot share |

**Binding at opt-in is load-bearing.** A threshold like "3 matches before it counts" is under the
losing player's control: current rating is readable any time via `GET /v1/arena/me`
(`arena/repository.mjs:427-452`), so the dominant strategy is play two, check, and stop if behind.
`FORFEIT` would fire only by accident. Binding at opt-in also dissolves the unreachable
3-distinct-opponent requirement, which needs 4+ staked wallets at a 3-wallet population.
A player who plays nothing has a zero staked delta and forfeits nothing — opt-in stays safe.

**Scoring on the summed staked delta is also load-bearing.** `maybeSettleMatch` applies Elo to
*every* COMPLETE match regardless of `origin` (`settle.mjs:85-120`), and the repeat-opponent damper
resets every 24h (`settle.mjs:30-37`). Scoring on global rating would let an accomplice pump a
staked wallet with one link loss a day at full K. So:

> Season outcome = `sum(arena.rating_events.delta)` over matches joined to
> `arena.season_match_links` with `counted = true`. **FORFEIT iff that sum is negative.**
> `rating_at_start` / `rating_at_end` are recorded for display and decide nothing.

`arenaRating.mjs:3-5` states the damper suffices "because rating buys nothing". **This spec removes
that precondition; that comment must be rewritten in the same change.**

### The signing path — corrected

The audit established that `shieldLapseEngine.userYieldBps` is **not** on the signing path. The
signed bps comes from `claimVoucher.yieldBpsForLapses` (`claimVoucher.mjs:78`) via `issueVoucher`.
There are three derivation sites today.

- **`claimVoucher.yieldBpsForLapses` becomes `effectiveYieldBps({ lapseCount, arenaPenaltyTiers })`
  and is the single owner of the money tier.** `issueVoucher` takes `arenaPenaltyTiers` and passes
  it through; `issueCourseCompletionVoucher` (`repository.mjs:269-286`) reads and passes it.
- `repository.mjs:410` (drift check) calls the owner with the voucher row's **stored** inputs.
- `repository.mjs:4247` keeps lapse-only redirect bookkeeping, and
  **`shieldLapseEngine.userYieldBps` is renamed `lapseRedirectBps`** so it can never be mistaken
  for the money tier.

```
tierIndex = min(MAX_LAPSE, lapseCount + arenaPenaltyTiers)
effectiveYieldBps = [10_000, 5_000, 0][tierIndex]
```

- **`arenaPenaltyTiers` is 0 or 1 and never more.** It is 1 iff the most recent SETTLED entry for
  `(wallet_address, course_id, lock_address)` is `FORFEIT`. `PENDING`, `NO_BIND`, `KEPT` and `VOID`
  all resolve to 0. **Penalties never accumulate across seasons on one lock** — a 180-day lock
  spanning six seasons cannot reach 0 bps.
- **The arena never writes `lapse_count`.** That column drives streak, shields and the flame.
- The result is always one of `VALID_YIELD_BPS`; anything else is rejected before the nacl call.

### The voucher lifecycle — corrected

"At claim time" does not exist in this codebase. The voucher is signed post-commit at course
completion (`repository.mjs:4946-4949`) with a 90-day TTL (`config.mjs:276`) against a 30-day
season, served unchanged while unexpired (`repository.mjs:406-423`), and re-signed unconditionally
by `POST /v1/progress/courses/:courseId/voucher` (`routes.mjs:503-527`). A voucher is a bare
Ed25519 signature with no nonce or revocation (`voucher.rs:122-159`).

1. Add `arena_penalty_tiers integer not null default 0` to `lesson.completion_vouchers`. The tier
   is captured at **first** issue; every re-issue, expiry-reissue and lazy heal **replays the
   stored value** rather than recomputing, so a reissued voucher reproduces the original bps
   byte-for-byte.
2. **`POST /voucher` becomes read-through** — it serves a stored unexpired voucher instead of
   re-signing.
3. **Opt-in rejects a backing course that is already complete or already has a stored voucher row**
   (`ARENA_STAKE_COURSE_SETTLED`).
4. While a wallet holds a PENDING entry, any voucher signed for the backing course uses
   `expiry = min(now + VOUCHER_TTL_SECONDS, season.ends_at + grace)`. After settle it is re-signed
   once at the settled tier.

> **Accepted escape, recorded.** Any voucher outstanding at settle time is unrecoverable — the
> program cannot invalidate a signature without an upgrade, which this spec forbids. A player who
> completes their course and claims before settlement escapes the penalty. That escape is accepted;
> the void-on-close rule is a consequence of it, not a designed exit.

### Eligibility and liveness

- Opt-in checks the chain, not the database: `lockPosition.readLockV2AccountFresh` (uncached,
  fail-closed) must report an ACTIVE lock with principal > 0. Rejects with `ARENA_STAKE_NO_LOCK`.
- **A lock that closes mid-season voids that entry.** Nobody is penalised retroactively.
- **The Arena never blocks a claim.** No freeze flag, no new on-chain state. A user's own money is
  never held hostage by a game.

### Forfeit and void rules

| Situation | Outcome |
|---|---|
| Opted in, played nothing | staked delta 0 → `KEPT`, no penalty |
| Staked delta ≥ 0 | `KEPT` |
| Staked delta < 0 | `FORFEIT`, one tier |
| Lock closed mid-season | `VOID`, forfeits nothing |
| 3rd+ meeting with same opponent | match written `counted = false`, contributes 0 |
| `VOID` match (both absent) | no rating event, so contributes 0 |

### Collusion controls

At three wallets a colluding pair *is* the population, so the honest controls are narrow:

- **Only staked matches score the season.** An accomplice's link-match losses move global rating
  but contribute nothing.
- **Per-pair cap:** the 3rd+ staked meeting with the same opponent in a season is written
  `counted = false`.
- **The repeat-opponent Elo damper widens from 24h to the whole season for staked pairs.**
- Staked matches are queue-only. *This is not claimed as a control* — `enterQueue` is deterministic
  FIFO whose only filter is `wallet_address <> $1` (`arena/repository.mjs:336-376`), and at this
  population rating bands or recency exclusions would simply stop all matches.

### Phase split

**Phase 1 — the loser side.** Everything above except pot payouts. Complete and real on its own.
**Phase 2 — the winner side.** Weighted pot share via `computeWeightedPayouts`, gated on
3 distinct opponents (where failing costs nothing). **Phase-1 gate:** at least one season settles
with every entry reaching a terminal outcome and no drift-check firing — not "a FORFEIT occurred",
which honest play may never produce at three wallets.

## Data model — migration `0065_arena_seasons.sql`

`arena.seasons.id` is a **new axis and is NOT `arena.matches.season`.** Those columns
(`0063:57,110,140`) all default to 1 and every reader hardcodes 1; `arena.ratings` is keyed
`(wallet_address, season)`, so advancing that integer would reset every ladder. The rating ladder
stays on season 1 forever.

```sql
create table arena.seasons (
  id          integer primary key,
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,          -- a UTC day boundary
  status      text not null check (status in ('OPEN','CLOSED','SETTLED')),
  created_at  timestamptz not null default now()
);

create table arena.season_entries (
  stake_season_id    integer not null references arena.seasons(id),
  wallet_address     text not null,
  course_id          text not null,
  lock_address       text not null,
  opted_in_at        timestamptz not null default now(),
  consent_version    text not null,
  rating_at_start    integer not null,       -- display only
  rating_at_end      integer,                -- display only
  staked_delta       integer,                -- the value that decides the outcome
  outcome            text not null default 'PENDING'
                     check (outcome in ('PENDING','KEPT','FORFEIT','VOID')),
  voided_reason      text,
  settled_at         timestamptz,
  primary key (stake_season_id, wallet_address, course_id)
);

create table arena.season_match_links (
  stake_season_id integer not null references arena.seasons(id),
  match_id        uuid    not null references arena.matches(id) on delete cascade,
  wallet_address  text    not null,
  counted         boolean not null default true,
  primary key (stake_season_id, match_id, wallet_address)
);
```

**Both new tables carry RLS**, copied from `lesson.completion_vouchers` (`0047:22-28`):
`enable row level security`, `force row level security`, and the wallet-scoped JWT policy.
`0063:16-19` states "Nothing here is convertible into money. Rating buys nothing" — **the same
migration amends that header, which this change makes false.**

**Who writes the links:** rows are inserted inside `maybeSettleMatch`'s existing transaction, one
per player, for any match whose *both* players hold an OPEN entry in the currently-OPEN season.
`counted` is false when the pair cap is already met.

**Penalty resolution is per (wallet, course, lock).** `lesson.completion_vouchers` is keyed
`(wallet_address, course_id)` (`0047:17`) and the lock PDA is `[lock-v2, owner, course_id_hash]`.
Nothing caps a wallet to one lock — `assertCourseLockable` only blocks relocking a COMPLETED course.
A wallet may hold several concurrent locks; **only the staked one is ever penalised.**

## Operations

A `cron:arena-season` script plus a scheduler-gated endpoint, following `arenaSweep.mjs` exactly:

- Its **own advisory lock key**, distinct from `ARENA_SWEEP_LOCK_KEY` (727274002).
- Runs after **00:30 UTC** so the UTC day has closed, as `run-lapse-sweep.mjs` does.
- Opens the next season, closes an expired one, settles entries.
- **Each entry settles in its own transaction**, because settlement needs a fresh RPC per entry via
  `readLockV2AccountFresh` and the backend is us-east while Supabase is ap-southeast-1 (~230ms per
  query). A mid-run RPC failure leaves settled entries settled and retries only `PENDING` ones.
- A settle that cannot read the chain **fails closed**: the entry stays `PENDING`. It never guesses.

## Disclosure

Nothing today tells a player they are staked. Required:

- A standing "staked this season" indicator with days remaining and current staked delta.
- An at-settlement notice stating the outcome and, on `FORFEIT`, that a tier was taken.
- An at-claim notice showing the tier actually signed.
- Copy states plainly that the amount is currently **cents**, per Risk 2.

`consent_version` reuses `lesson.user_consents` versioning (`0055:42-47`).

## Error handling

- Opt-in without a verifiable live lock → `ARENA_STAKE_NO_LOCK`.
- Opt-in on a completed/vouchered course → `ARENA_STAKE_COURSE_SETTLED`.
- Opt-in twice → idempotent, returns the existing entry.
- Settle is exactly-once per `(stake_season_id, wallet_address, course_id)`.
- Voucher signing rejects any bps outside `VALID_YIELD_BPS` before the nacl call.

## Testing

- Unit: `effectiveYieldBps` across the full `lapseCount × arenaPenaltyTiers` matrix — always in
  `VALID_YIELD_BPS`, never worse than tier 2, and `arenaPenaltyTiers` clamped to 0/1.
- Unit: staked-delta scoring, per-pair `counted` cap, VOID handling.
- Integration: opt-in requires a live lock; rejects a settled course; idempotent; settle
  exactly-once; a voided entry forfeits nothing; **a re-issued voucher reproduces the stored tier
  byte-for-byte**; a wallet's *other* course lock is unaffected by a FORFEIT.
- Integration: redrawn isolation test — the arena may write `arena.*`, `lesson.user_xp`,
  `lesson.user_xp_events`, and may influence `user_yield_bps` **only** via
  `arena.season_entries.outcome`.
- E2E: a season played through two browser contexts, settled, with the resulting signed bps asserted.

## Risks

1. **One three-valued field, two inputs.** Mitigated by a single owner function and an exhaustive
   matrix test. This is where a bug would cost a user money.
2. **The prize is pennies** — about $0.03 today. The UI must say so.
3. **The outstanding-voucher escape** is real and accepted (above).
4. **Regulatory** — narrowed, not eliminated. Accepted by the owner. Not legal advice.
5. **Sybils.** Only staked matches scoring raises the cost; proof-of-uniqueness is out of scope and
   remains the only real answer.
6. **Question-draw asymmetry.** `enterQueue` draws from the *waiting* player's unseen set
   (`arena/repository.mjs:~360`), and the joiner role is self-selected. Staked matches should draw
   from the union of both players' unseen sets — deferred, recorded.
