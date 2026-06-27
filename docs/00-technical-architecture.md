# Locked In Technical Architecture v4.0 (Canonical)

## Purpose

This document is the canonical technical specification for Locked In v4.0.
All docs in `docs/` must match this file.

Design goals:

1. Habit formation with real economic consequence (yield routing, never principal).
2. Principal safety for user deposits.
3. Minimal on-chain complexity: the chain is custody-only; game counters live off-chain.
4. Clear separation between on-chain financial state and off-chain learning delivery + game state.

## System Topology

| Layer | Components | Responsibility |
| --- | --- | --- |
| Web app | Next.js, Privy auth, wallet integration, brewery/pot UI | User onboarding, lesson UX, fire-timer/brewer/pot views, transaction signing |
| Backend | Fastify (`.mjs`), lesson API, progress verification, scheduler workers, Postgres, Alchemy RPC reads | Course content, lesson verification, off-chain Fuel/Ichor counters, yield harvest/routing, job orchestration |
| On-chain (Solana) | One `locked_in` Anchor program (`vault` + `pot` modules) | Custody escrow of USDC principal, clock-gated unlock, community pot accumulation/distribution |
| DeFi yield substrate | Kamino USDC supply rate (read live from mainnet) | Real-rate yield simulation on locked stablecoin capital |

## Canonical Program Topology

Locked In v4.0 uses **one** on-chain Anchor program named `locked_in`
(program ID `3RC9XkPZNSgXksp9Fb7J4LE7cQNYUUQdxkaaQnz6kBav`, deployed on
devnet). It contains two domains separated only by PDA seeds:

1. `vault` module (seed `b"vault-protocol"`) — pure custody escrow.
2. `pot` module (seed `b"pot-protocol"`) — community-pot redirect
   accumulator + monthly payout.

The former separate programs are gone: `yield_splitter` was fully removed
(program + backend + API + web-app + tests); `lock_vault` and
`community_pot` were merged into this single `locked_in` program (the
custody logic was copied verbatim — only the names/seeds that would
collide under one program ID were renamed). The merge plus the
`yield_splitter` removal, a `lock_vault` strip, and release build flags
cut the default deploy cost from ~15.27 SOL to ~2.51 SOL.

`Ichor` and `Fuel` are not SPL tokens and are not on-chain. In v4 they
are **off-chain Postgres counters** owned by the backend (see Off-chain
Game State below).

## Canonical Account Model

Each active course lock is represented by one `LockAccount` (vault domain).
A user with multiple active courses has multiple independent `LockAccount`s.

`LockAccount` is a lean custody record — **8 fields, 130 bytes** (see
`programs/locked_in/src/vault.rs`):

- `owner: Pubkey`
- `course_id_hash: [u8; 32]`
- `stable_mint: Pubkey` (`USDC`)
- `principal_amount: u64`
- `lock_start_ts: i64`
- `lock_end_ts: i64` (written exactly once at funding; never mutated —
  missed days are yield-only and never extend the lock)
- `status: u8` (`0 = active`, `2 = closed`)
- `bump: u8`

All v3 game fields (`extension_seconds_total`, `gauntlet_complete`,
`savers_remaining`, `saver_recovery_mode`, `fuel_counter`, `fuel_cap`,
`last_fuel_credit_day`, `last_brewer_burn_ts`, `ichor_counter`,
`ichor_lifetime_total`, `skr_tier`, `current_yield_redirect_bps`) were
**removed from chain** and now live off-chain (see Off-chain Game State).

Global/config accounts (program-level):

- `VaultConfig` (seed `b"vault-protocol"`): authority, USDC mint.
- `PotConfig` (seed `b"pot-protocol"`): authority, stable mint.
- `PotWindow` / `DistributionWindow` / `RedirectReceipt` /
  `DistributionReceipt`: per-window pot accounting + idempotency receipts.

No on-chain protocol-fee schedule, saver penalty table, ichor conversion
tier table, or extension policy exists anymore — those were v3 concepts.

Token vault accounts:

- stablecoin vault ATA per lock (authority = the `LockAccount` PDA)
- community pot vault ATA (authority = the `PotConfig` PDA)

## Off-chain Game State

Fuel, Ichor, savers, streak, and the fire timer are off-chain Postgres
counters (e.g. `lesson.user_course_runtime_state`; Ichor in migration
`0037`). They are authoritative in the current dev phase. None of them
are SPL tokens; there is no mint, no token account, no secondary market.
The authoritative economic specs are `docs/04-tokenomics.md`,
`docs/08-timer-yield-product.md`, and `docs/05-yield-calculator.md` — this section only
summarizes; do not contradict them.

### Fuel + the fire (see 08-timer-yield-product)

- `+1` fuel per verified lesson completion, capped at `fuel_cap`
  (default 7). No daily cap.
- Feeding the fire consumes `1` fuel and extends `fire_lit_until` by
  `+24h` (stacks additively). The fire is "lit" while `now <
  fire_lit_until`.

### Ichor (see 04-tokenomics)

- random `20-50` awarded per lesson completion (slot-machine reward).
- a pure in-game **shop currency** — e.g. buy a Streak Saver for `500`
  ichor. **No Ichor → USDC redemption** (removed in v4): no redemption
  rate, no conversion tier table.

### Yield routing by saver tier (see 04/05)

At each hourly harvest of a locked course:

| Fire / savers used (banked) | → pot | → user |
| --- | --- | --- |
| fire OUT | 100% | 0% |
| fire LIT, 0 used (3 banked) | 0% | 100% |
| fire LIT, 1 used (2 banked) | 10% | 90% |
| fire LIT, 2 used (1 banked) | 15% | 85% |
| fire LIT, 3 used (0 banked) | 20% | 80% |

A missed day consumes one saver (streak preserved, redirect tier bumps
up). Once all 3 are used, a further miss resets the streak to 0 and the
redirect stays capped at 20% — it **never** extends the principal lock.
`current_yield_redirect_bps` lives off-chain; in the active path it is
effectively 0 bps (100% to wallet) while the fire is lit and savers are
banked.

## Lifecycle State Machine

No gauntlet in v4 — all mechanics fire from day 1.

1. **Onboarding lock**
   - User locks stablecoin principal (USDC).
   - `lock_end_ts` is fixed at funding and never moves.
   - 3 savers are banked off-chain; fire starts out.
2. **Active course (from day 1)**
   - Each verified lesson: `+1` fuel (cap 7) and `20-50` ichor.
   - User feeds the fire from the Brewery (−1 fuel, +24h).
   - Hourly harvest routes yield: fire LIT → user (per saver tier);
     fire OUT → community pot.
   - A missed day consumes a saver (streak preserved); after 3, a miss
     resets the streak. Penalties touch yield routing only.
3. **Claim**
   - User claims accrued user-side yield to their wallet from the
     Brewery (devnet: a real USDC transfer from the treasury wallet).
4. **Resurface (unlock)**
   - Triggered when `lock_end_ts` is reached (`now >= lock_end_ts`).
   - `unlock_funds` asserts the vault still holds the full principal,
     returns it in full via PDA-signed transfer, and closes the lock.
   - User may continue with a new lock cycle.

## On-chain Invariants

1. Principal is never slashed by streak logic.
2. `unlock_funds` only succeeds at/after `lock_end_ts` and asserts the
   vault holds the full escrowed principal before payout.
3. Mint binding: `unlock_funds` rejects a substituted stable mint
   (`InvalidMint`), blocking a fake-mint unlock.
4. Each course lock is isolated; no shared state across courses.
5. The pot's `record_redirect` / `distribute_window` are idempotent via
   per-key receipt PDAs; a payout is bounded by the window's remaining
   amount.

Fuel, Ichor, and savers are off-chain only (no SPL mint/token account);
their consequences route yield and never touch principal. There is no
on-chain ichor counter and no `redeem_ichor` instruction in v4.

## Scheduler and Idempotency

Required recurring jobs:

- daily course-day rollover / streak + saver validation (off-chain)
- hourly yield harvest + routing (writes `harvest_result_receipts`)
- monthly community pot distribution (`YYYYMM` window)
- leaderboard snapshot refresh (`leaderboardSnapshotWorker` periodically
  rebuilds `lesson.leaderboard_snapshots`)

There is **no** automatic fuel-burn cycle: feeding the fire is an explicit
user action in the Brewery (−1 fuel, +24h). On-chain pot instructions are
idempotent via per-key receipt PDAs (`RedirectReceipt`,
`DistributionReceipt`); off-chain jobs use deterministic keys/event IDs to
prevent double application.

## Security and Compliance Boundaries

- Solana program authority controls are strict and role-scoped (pot
  worker instructions require the configured authority signer).
- Wallet signatures gate all user-initiated lock/unlock actions.
- The backend uses a dedicated Alchemy RPC configured **server-side only**
  (`SOLANA_RPC_URL`); the frontend stays on the public RPC. The Alchemy
  key is never exposed in a `NEXT_PUBLIC_` / `EXPO_PUBLIC_` var (it would
  ship to the browser). Two cluster profiles (devnet/mainnet) switch via
  `scripts/use-cluster.sh`; all `.env*` files are gitignored. See
  `docs/superpowers/specs/2026-06-22-rpc-env-profiles-design.md`.
- Locked In discloses that user principal is protected while yield is
  conditional.
- Jurisdiction-specific legal review is required before mainnet launch.

### Leaderboard data path

The leaderboard is served from a **materialized snapshot**
(`lesson.leaderboard_snapshots`, refreshed by
`leaderboardSnapshotWorker`). Streak + recent activity come from DB
runtime state; lock status + principal come from the on-chain custody
snapshot. (Follow-up: the live fallback `computeLeaderboardRows` does one
`getAccountInfo` per lock and is pending a `getMultipleAccountsInfo` batch
fix for mainnet scale.)
