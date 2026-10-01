# Simulated Learners: Design

Status: proposal (docs only, nothing implemented)
Date: 2026-10-02
Owner: Marcus

## 1. Goal

Run about 100 automated "simulated learners" against the live mainnet app so we can show, with
real numbers, that the system and our automation hold up at roughly 30x today's usage.

Simulated learners behave like real learners in every way that matters for the demo:

- they sign in through the real API, lock real USDC on mainnet, take daily lessons, build and
  lose streaks, burn shields, lapse, play Arena, finish courses and claim;
- they run on their own staggered schedules, not all at once;
- their deposits, streaks and payouts are real on-chain and in the database.

The one difference: **every simulated learner is labeled as simulated**, everywhere it shows up.

## 2. Principles

1. **Same flows as real users.** Simulated learners call the same public API routes and send the
   same on-chain instructions as the web app. No backdoor endpoints, no direct DB writes for
   learning activity.
2. **Always labeled.** A simulated learner is tagged in the database, flagged in API responses,
   shown with a "Simulated" badge in the UI, and counted separately in every metric we publish.
3. **Never at a real user's expense.** Real users keep all of their deposit capacity, all of
   the community pot, all of the gas stipend budget, and cannot lose yield to a bot in Arena.
4. **Transparent funding.** All simulated wallets are funded from one published simulation
   treasury wallet. The wallet list and treasury address are published in this repo.

### Non-goals

- Making simulated learners indistinguishable from real ones.
- Spreading funding across sources or randomizing anything to hide the link to the treasury.
- Bypassing rate limits with extra IPs.
- Reporting simulated numbers as user growth (see section 11).

## 3. Overview

```
 Simulation treasury wallet (published address, holds SOL + USDC)
        |  funds each simulated wallet once (SOL for fees, USDC for the deposit)
        v
 Simulator service (new Render background worker, SIMULATION_ENABLED kill switch)
   - 100 keypairs derived from one seed (one secret)
   - persona per wallet: timezone, active hours, consistency, accuracy, Arena appetite
   - scheduler: each wallet wakes on its own clock and runs one "session"
        |
        |  same public API + same on-chain instructions as the web app
        v
 Backend (Fastify)  ----->  Postgres: lesson.simulated_wallets registry (labels)
        |                    leaderboard / pot / arena / metrics read the registry
        v
 Solana mainnet: same vault_v2 program, same Kamino reserve, separate pot windows for sims
```

## 4. Identity and labeling

There is no users table; identity is the wallet address (`lesson.user_course_enrollments` PK is
`(wallet_address, course_id)`, `backend/sql/0001_lesson_platform.sql`). So the label lives in a
registry table.

**Migration 0067 `lesson.simulated_wallets`:**

| Column | Purpose |
|---|---|
| `wallet_address` (PK) | the simulated wallet |
| `cohort` | for example `sim-2026-10` (lets us run, pause or retire a batch) |
| `persona` (jsonb) | schedule and behaviour parameters (section 6) |
| `created_at`, `retired_at` | lifecycle |

A small helper `isSimulatedWallet(wallet)` (cached) and a SQL view or join are used by every
surface below. Only the backend writes to this table, through an ops script, never through a
public route.

**Where the label shows up**

| Surface | Code today | Change |
|---|---|---|
| Leaderboard | `computeLeaderboardRows`, `refreshLeaderboardSnapshot`, `readLatestLeaderboardSnapshot` in `backend/src/modules/progress/repository.mjs`; table `lesson.leaderboard_snapshot_rows` (`0018`) | add `is_simulated` to snapshot rows and API rows; UI shows a "Simulated" badge; optional filter "Real only / All" |
| Arena ladder | `getLadder` in `backend/src/modules/arena/repository.mjs` | add `isSimulated` to each ladder row; badge in UI |
| Community pot history | `getCommunityPotHistory`, `getCommunityPotWindowDetail` | show real and simulated windows separately (section 8) |
| Deposit meter | `DepositFormV2.tsx` shows on-chain `current_tvl` against `BETA_GLOBAL_TVL_CAP_USDC` | show real-user capacity (section 7) |
| Metrics | none public today | new internal metrics endpoint and dashboard, always split real vs simulated (section 10) |

## 5. Authentication

Simulated learners use the existing wallet-signature login, exactly like the web app's fallback
path (`backend/src/modules/auth/routes.mjs`, `web-app/hooks/useAuth.ts`):

1. `POST /v1/auth/challenge {walletAddress}` returns `{challengeId, message}` (valid 5 minutes).
2. Sign `message` with the wallet keypair (detached ed25519).
3. `POST /v1/auth/verify {walletAddress, challengeId, signature}` returns access (15m) and
   refresh (30d) tokens.
4. `POST /v1/auth/refresh` before expiry. Refresh tokens are single use, so each wallet keeps
   exactly one token chain.

**Rate limits** are per IP (30/min for challenge and verify, `trustProxy: true`), and all
simulated learners run from one worker. Because each wallet signs in once and then refreshes for
up to 30 days, steady-state login traffic is tiny. The scheduler also spreads sessions so the
worker stays well under the limits. We do not route around the limits.

## 6. Personas and scheduling (realistic, staggered activity)

Each simulated wallet gets a persona, stored in `simulated_wallets.persona`:

| Parameter | Example range | Effect |
|---|---|---|
| `timezone` | UTC-8 to UTC+9 | when "their day" is |
| `activeWindow` | for example 07:00 to 09:00 or 20:00 to 23:30 local | when sessions happen |
| `dailyConsistency` | 0.55 to 0.97 | chance they show up on a given day |
| `streakFatigue` | small daily drop | consistency decays over weeks, like real churn |
| `lessonsPerSession` | 1 to 3 | how much they do when they show up |
| `accuracy` | 0.6 to 0.95 | chance of picking the right multiple-choice option |
| `readingSpeed` | seconds per question | pacing between `start`, `check` and `submit` |
| `arenaAppetite` | 0 to 0.4 | chance of queueing for a match after a session |
| `depositUsdc` | 10 to 50 | deposit size (within the on-chain per-lock limits) |
| `cohortJoinDay` | day 0 to 21 | staggered onboarding, not all on day one |

**Scheduler:** a single worker loop. Every minute it picks the wallets whose next session time
has arrived, runs each session with jittered pacing, then schedules that wallet's next session
from its persona. Sessions run with bounded concurrency (for example 3 at a time).

Realistic pacing also matters for correctness: the backend rejects answers over 40 characters
that arrive less than 2 seconds after `start` (`repository.mjs` around L1267), so personas
always "read" before answering.

## 7. Deposits and capacity

**Flow (same as `web-app/app/onboarding/deposit/DepositV2.tsx` and
`web-app/services/solana/vaultV2.ts`):**

1. `GET /v1/locks/:courseId/eligibility`
2. `POST /v1/locks/consent {termsVersion, acceptedAt}`
3. `open_lock_v2` (only if the lock PDA `["lock-v2", owner, sha256(courseId)]` does not exist)
4. `lock_funds_v2` with compute budget, priority fee and Kamino `refresh_reserve`, depositing
   real USDC into the real Kamino reserve
5. `POST /v1/locks/:courseId/enroll {lockAddress}`, retrying on 409 `ENROLL_RETRY`

The simulator reuses the web app's transaction builders (extracted into a shared module or
called from a Node build) so the instructions are byte-for-byte the same.

**Gas:** simulated wallets never call `POST /v1/wallet/gas-stipend`. That budget (200 drips
total, paid by the vault worker key, `backend/src/lib/solDrip.mjs`) is for real users. The
simulation treasury sends each simulated wallet its SOL directly, and the stipend route returns
an error for any registered simulated wallet as a guard.

**Capacity (additive, so real users keep their $1,000):**

- On-chain, all locks share `VaultV2Config.global_tvl_cap` (`programs/locked_in/src/vault_v2.rs`).
  If bots used the existing 1,000 USDC cap, real Founding 100 visitors could not deposit.
- So we raise the on-chain cap by the simulation budget with `set_config_v2` (signed by the
  config authority), for example to 1,000 + 2,500 = 3,500 USDC, keeping min 10 and max 50 per
  lock.
- The backend then enforces two sub-caps in the eligibility endpoint (it has no capacity check
  today; `assertCourseLockable` only checks the course):
  - real users: sum of active real principal stays at or under 1,000 USDC;
  - simulated: sum of active simulated principal stays at or under the simulation budget.
- The deposit meter shows the real-user capacity (real TVL vs 1,000), not raw `current_tvl`.
- Update `config/mainnet-production.json` (`beta.globalTvlCapUsdc`) and the canary so they
  check the real-user cap and the on-chain total separately.

Raising the on-chain cap raises total exposure in an unaudited program. The extra exposure is
our own simulation money, but note it in the risk review before doing it.

## 8. Streaks, lapses and the community pot

**Streaks and lapses** work exactly as for real users: the first passing lesson on a new UTC
day runs `applyLessonDay` (`backend/src/lib/shieldLapseEngine.mjs`), and the nightly lapse sweep
(`runLapseSweepBatch`, `backend/src/lib/lapseSweep.mjs`) burns shields and records lapses for
simulated wallets too. No change needed.

**Community pot: same mechanics, separate money.** The real pot is funded by real learners'
forfeited yield. If simulated learners with steady streaks shared that pot, real learners'
money would flow to wallets we control. So simulated learners get their own pot, run by the
same code:

- When a lock is claimed, `claim_v2` sends the forfeited share to the shared on-chain
  `pot_vault`, and the backend indexes `LockV2Settled` events (`backend/src/lib/potCycle.mjs`).
- The pot cycle splits indexed events by owner: events from registered simulated wallets go to
  a **simulated window** (for example window id `90_000_000 + YYYYMM`), all others to the real
  window `YYYYMM`.
- `closeCommunityPotWindowAndSnapshotV2` runs once per window:
  - the real window counts only non-simulated eligible locks;
  - the simulated window counts only simulated eligible locks.
- Each window's payout is capped by its own redirected total, so the simulated window can only
  ever pay out simulated forfeits. Real learners keep 100% of the real pot.
- Payout weights, receipts and history work as they do today, per window. The pot history page
  shows the two windows separately and labeled.

## 9. Lessons, Arena and claims

**Lessons** (`/v1/progress/lessons/:id/start`, `/check`, `/submit`, `backend/src/modules/progress/routes.mjs`):
simulated learners pick multiple-choice options with their persona's accuracy, so some lessons
fail and get retried, exactly like people. A lesson passes at a score of 55 or more. The
simulator keeps to multiple-choice questions so it never triggers the OpenAI grader (no extra
cost) and never uses `recall-check` shortcuts.

**Arena:** simulated learners queue, accept proposals, play and settle through the normal Arena
routes. One rule: **the matchmaker pairs simulated wallets only with simulated wallets.** Today
the queue pairs any staked wallets (`backend/src/modules/arena/repository.mjs` around L347),
and a season forfeit lowers voucher bps (`readArenaPenaltyTiers`), so a bot match could cost a
real learner yield. Real learners never see a simulated opponent; ladder rows are labeled.

**Claims:** when a simulated learner finishes a course, it fetches its voucher
(`POST /v1/progress/courses/:id/voucher`), sends `claim_v2`, and reports `claim-result`, the
same as the claim page. Its principal and kept yield return to its wallet, and the simulator
then sweeps funds back to the treasury (section 12).

## 10. Metrics and dashboard

- New internal endpoint (scheduler-secret protected) returning, for real and simulated
  separately: active learners (7-day), lessons completed per day, current streaks, locked
  principal, Arena matches, claims, pot redirected and paid.
- A dashboard page (internal, or a docs page) with real and simulated shown side by side.
- Optional public line on the leaderboard: "Includes N simulated learners run by the LockedIn
  team to test the system, marked Simulated."

## 11. Disclosure and communication rules

- Every public chart, post or deck that shows simulated activity labels it as simulated.
- Growth numbers (followers, signups, TVL from users) always use real-only figures.
- The growth plan's copy rules get one more line: never cite simulated numbers as users or TVL.
- The simulation treasury address and the simulated wallet list are published in this repo.

## 12. Operations

**Keys:** 100 simulated keypairs derived from one seed (one Render secret on the simulator
service only), plus the simulation treasury key. Never in the web app, never in crons.

**Kill switch:** `SIMULATION_ENABLED=false` stops new sessions immediately.

**Wind-down:** a `retire-cohort` script stops scheduling a cohort, lets each wallet finish its
course and claim (or uses `force_return_v2` after 180 days), and sweeps remaining USDC and SOL
back to the treasury. `retired_at` is stamped; labels stay, so history stays honest.

**Rough budget (100 learners):**

| Item | Estimate |
|---|---|
| USDC locked | 100 x 10 to 50, so 1,000 to 5,000 (returned on claim, plus Kamino yield) |
| SOL | rent for lock and collateral accounts, plus fees and priority fees, about 1 to 2 SOL total |
| RPC | position polling and transactions on the backend Helius key; watch credits |
| OpenAI | none (multiple choice only) |

**Monitoring:** simulator health in the metrics endpoint; alerts if a session error rate spikes;
the existing hourly canary stays real-only.

## 13. Rollout

1. **Phase 0, labels and guards (no bots yet):** migration 0067, `isSimulatedWallet` helper,
   leaderboard and ladder labels, pot window split, Arena sim-only matching, stipend guard,
   eligibility sub-caps, metrics endpoint. Full test coverage, including "a simulated wallet
   never appears in a real pot window" and "a real wallet is never matched with a simulated
   one".
2. **Phase 1, devnet rehearsal:** 10 simulated learners on devnet for 7 days.
3. **Phase 2, mainnet pilot:** raise the on-chain cap by a small amount, 10 simulated learners
   for 7 days, review the dashboard and costs.
4. **Phase 3, scale:** cap to the full simulation budget, 100 learners joining over about 3
   weeks.

## 14. Open questions

- Simulation budget: how much USDC (sets the on-chain cap increase)?
- Leaderboard: simulated learners ranked alongside real ones with a badge, or on a separate tab?
- How long does the cohort run, and do we retire it before raising real-user capacity?
- Should the public line in section 10 be shown from day one?
