# Locked In v2 — Real Yield (Kamino) + Mainnet Beta — Design Spec

> **Rev 3.** Approved in design session 2026-07-09 (Ong + Claude), then rewritten after an
> adversarial audit (three independent reviewers) falsified two of rev 2's safety invariants.
> Supersedes: simulated yield, ichor economy, fuel/feeding, duration presets, per-harvest
> redirect tiers, heartbeat exit clock, `attest_completion`, and all v3 remnants.
> Posture: **real product**, launching as a capped, unaudited, honestly-disclosed mainnet beta.

## 0. What changed in rev 3 (and why)

Rev 2 claimed two invariants that did not survive adversarial review:

- **"Exit needs no backend"** was false. The exit clock was anchored to an authority-signed
  `heartbeat`, so a hostile or compromised key could bump it weekly and trap a quitter's
  principal forever. Rev 2's own accepted-risk §10.7 contradicted its invariant §3.3.1.
- **"Bounded blast radius"** understated the leak. A leaked key could `attest_completion(bps=0)`
  on every lock (one-shot, irreversible), funnel all users' yield into the pot, then distribute
  it to itself.

Plus one critical custody bug: settlement redeemed the **stored** `ctoken_amount` and then
closed the token accounts. Anyone could transfer 1 lamport of cUSDC into a lock's cToken ATA
(a deterministic, permissionless address); the redeem would leave the dust behind, `close_account`
would fail on a non-zero balance, and **the lock could never be claimed or force-returned.** A
few dollars of cUSDC bricks every lock in the beta and permanently inflates `current_tvl` until
the global cap locks out all deposits.

Rev 3's structural answers:

| Rev 2 | Rev 3 | Kills |
|---|---|---|
| `heartbeat` + 90d inactivity clock | Fixed `lock_start + 180d` deadline | Authority traps principal; heartbeat-definition ambiguity |
| `attest_completion` instruction + async queue | **Ed25519 voucher** verified inside `claim` | Stuck-queue sweeps a finished user's yield (H4); pause-blocks-attestation (HIGH-4) |
| Redeem stored `ctoken_amount`, close ATAs | Redeem **live ATA balance**, pay out **full** post-redeem balance, assert zero, then close | Dust-donation DoS (CRIT-1) |
| Kamino accounts "pinned at init" (stored, unenforced) | `address = config.*` constraints + hardcoded klend program id | Account substitution (HIGH-2) |
| `window_id` a caller argument | Derived in-program from `Clock` | Permissionless scatter of forfeits into undistributable windows (MED-5) |
| `record_redirect` (authority credits pot with no transfer) | Deleted; `credit_window` is a private fn callable only from settlement | Unbacked pot accounting (LOW-9) |
| Fee-payer co-signing service | One-time ~0.005 SOL drip per wallet | Priority-fee drain, appended-instruction drain, rate-limit bypass (H3) |
| +1 shield per lesson-day | **+1 shield per 3 consecutive lesson-days** | 50%-density immunity: 1 lesson every other day never lapsed (M1) |
| Any lesson completion counts | **First-time completions only** | Replay one lesson forever = permanent BLAZING (C3) |
| No `set_authority` | `set_authority`, gated on the **cold** upgrade authority | Rotation was a runbook sentence, not code |

Three bugs were also live in production and are already fixed on branch
`fix/lesson-integrity-hotfix` (commit `89867bb`): client-supplied lesson timestamps (forgeable
streaks), the answer key shipped to the browser, and `!hasDatabase()` returning
`accepted: true, score: 100`.

## 1. Summary

Users deposit USDC ($10–50) into a per-course lock; the program CPIs the principal into Kamino
Lend's USDC reserve, where it earns real, compounding yield. Passing every lesson in the course
earns a backend-signed voucher; the user presents it to `claim` and receives principal + yield ×
(100% − penalty) in one owner-signed transaction. Daily learning keeps a flame alive; three
shields absorb missed days and regenerate one per three *consecutive* lesson-days; exhausting
them and going dark is a **lapse** (first lapse forfeits 50% of yield, second forfeits 100%).
Forfeits are transferred as real USDC into the community pot in the same instruction that
records them, and are redistributed monthly to active streak-holders. Abandoned locks are
returned to their owner by a **permissionless** instruction 180 days after the lock started.
Total value at risk is capped on-chain at $1,000 until an audit unlocks higher tiers.

## 2. Product decision ledger

| # | Area | Decision |
|---|------|----------|
| 1 | Scope | Full model on mainnet: real Kamino yield + real funded, distributing pot |
| 2 | Posture | Real product; capped unaudited beta; professional audit is the first major expense post-launch and the gate for every cap raise |
| 3 | Yield venue | Kamino Lend (klend) main-market USDC reserve. Chosen over Jupiter Lend: formal verification (Certora) + zero bad debt through 2026 + no rehypothecation + **deterministic withdrawals**. Jupiter throttles withdrawals via Fluid's automated debt ceiling ("dynamic withdrawal limits"), which would land non-deterministic failure on `claim` — the single most important transaction in the product |
| 4 | Yield mechanics | Deposited at lock via CPI; compounds in-position; live value shown on the dashboard (RPC read); settled once at claim |
| 5 | Claim gate | ALL lessons passed (each ≥ 70, first-time) → backend issues an Ed25519 voucher → owner-signed `claim` verifies it in-program |
| 6 | Penalty | Lapse-based, one-mercy: 1st lapse → `user_yield_bps = 5000`, 2nd → `0`. Applied to total yield at settlement |
| 7 | Lapse | A missed day with zero shields. Consecutive dark days coalesce into ONE lapse; a further lapse requires ≥1 lesson-day in between |
| 8 | Shields | Start 3, cap 3, **+1 per 3 consecutive lesson-days** (a miss resets the run), auto-burn on a missed day. A shielded day **pauses** the streak: not grown, not reset |
| 9 | Streak | ≥1 **first-time** lesson passed per UTC day, per course. Lapse → streak = 0 |
| 10 | Multi-course | Per-course locks/streaks/shields; PDA `[b"lock", owner, course_id_hash]`; one live lock per (wallet, course) |
| 11 | Quit path | `force_return`, **permissionless**, eligible at `lock_start_ts + 180d` for any unclaimed lock: principal → owner, all yield → pot. Platform runs it sponsored; anyone (incl. the owner) may call it |
| 12 | Pot | Funded ONLY by real forfeited yield, transferred in the same instruction that records it. Monthly windows (UTC `YYYYMM`, derived on-chain from `Clock`), weight = principal × current streak, active streaks only, pro-rata |
| 13 | Caps | On-chain: `min_principal` $10, `max_principal_per_lock` $50, `global_tvl_cap` $1,000 with a live counter. Authority `set_config`; caps constrain new locks only |
| 14 | Platform fee | **0 for beta.** `platform_fee_bps` on `VaultConfig`, default 0, in-program hard max 2000. Fee comes from YIELD ONLY, never principal. Enabling later is a config tx, not an upgrade |
| 15 | Lessons | Unlimited retries, pass ≥ 70%, no lives/hearts. Answer key never leaves the server |
| 16 | Flame | Auto health gauge (no feeding): BLAZING → FLICKERING (shields burning, countdown) → DARK (1 lapse, −50%) → EXTINGUISHED (2 lapses, −100%). Fuel currency + manual feeding DELETED |
| 17 | Ichor + shop | DELETED |
| 18 | XP | Kept; leaderboard ranks by CURRENT STREAK |
| 19 | Dashboard | Course-card layout: per lock — live position value, flame, shields, streak, progress bar, next-lesson CTA, CLAIM state. Alchemy/inventory/shop pages become modals |
| 20 | Access | Deposit-gated progression; lesson text stays publicly readable; NO demo course; no free tier |
| 21 | Re-lock | Completed courses cannot be re-locked (enforced off-chain; see §10.6). Completed users get PRACTICE MODE: replay lessons, no XP/streak/shield writes |
| 22 | Gas UX | One-time ~0.005 SOL drip to a wallet at first deposit. **No fee-payer co-signing service** |
| 23 | Onramp | Privy built-in funding (MoonPay/Coinbase) + a "fund your wallet" guide modal |
| 24 | Sybil | Soft gate: max 2 concurrent locks per Privy identity, enforced at tx-build time. Acknowledged as bypassable by direct program calls (§10.5); hard on-chain gate deferred (reuses the voucher machinery) |
| 25 | Courses | 2 polished at launch (Blockchain & Wallets, DeFi); placeholders hidden; +2–3 authored during weeks 3–4 |
| 26 | Hub | Pixel village = main hub (3D dungeon retired); no /menu page; fireplace renders the flame gauge |
| 27 | Cluster safety | Explicit `CLUSTER=devnet\|mainnet` env + genesis-hash verification at boot, fail-closed; every `rpcUrl.includes('devnet')` check deleted |
| 28 | Keys | Upgrade authority = **Squads 2-of-3, all three signers held by Ong** (Ledger + laptop + offline backup). Separate hot ops key (vouchers, caps, pause). Separate deployer. Fallback chain deleted; boot fails on missing or identical keys |
| 29 | Disclosure | In-app + ToS: unaudited, capped, "exits: finish the course, or wait 180 days", Kamino pass-through risk incl. possible inaccessibility, and the authority's exact powers and limits |

## 3. On-chain program v2 (`programs/locked_in`)

Fresh program ID for mainnet, deployed with the Squads multisig as upgrade authority. The current
devnet deployment (`3RC9XkPZ…kBav`) remains staging. **9 instructions** (rev 2 had 11): `heartbeat`,
`attest_completion`, and `record_redirect` are deleted; `set_authority` is added; `set_caps` +
`set_pause` merge into `set_config`.

### 3.1 State

**`VaultConfig`** — PDA `[b"vault-protocol"]`
```rust
authority: Pubkey,              // hot ops key: vouchers, caps, pause. Cannot move funds.
usdc_mint: Pubkey,
kamino_market: Pubkey,          // enforced via `address =` on every klend CPI
kamino_reserve: Pubkey,
kamino_collateral_mint: Pubkey,
fee_vault: Pubkey,              // pinned; unused while platform_fee_bps == 0
min_principal: u64,             // 10_000_000  ($10, 6dp)
max_principal_per_lock: u64,    // 50_000_000  ($50)
global_tvl_cap: u64,            // 1_000_000_000 ($1,000)
current_tvl: u64,               // live; == Σ principal of ACTIVE locks
platform_fee_bps: u16,          // 0 in beta; require!(<= MAX_PLATFORM_FEE_BPS)
paused: bool,
bump: u8,
```

**`LockAccount`** — PDA `[b"lock", owner, course_id_hash]`
```rust
owner: Pubkey,
course_id_hash: [u8; 32],
stable_mint: Pubkey,
kamino_reserve: Pubkey,         // re-asserted at settlement; lock and vault can never diverge
principal_amount: u64,
lock_start_ts: i64,             // the ONLY exit-clock anchor. Nothing can move it.
status: u8,                     // ACTIVE | CLOSED
bump: u8,
```
Note there is no `ctoken_amount` and no `completion_attested`. Collateral is read live from the
lock's cToken ATA at settlement (fixes CRIT-1); completion arrives as a voucher (fixes H4).

**Pot** — `PotConfig` PDA `[b"pot-protocol"]` (authority, stable_mint, bump);
`PotWindow` PDA `[b"window", window_id_le]`; `DistributionWindow` PDA `[b"distribution", window_id_le]`;
`DistributionReceipt` PDA `[b"distribution-receipt", distribution_window, recipient_key]`.
`pot_vault` = ATA(stable_mint, authority = `PotConfig` PDA), enforced by `associated_token::authority`.

### 3.2 The completion voucher

`claim` takes no on-chain attestation. Instead the backend signs, with the **ops key**:

```
msg = b"lockedin:claim:v1"
   || program_id            (32)
   || lock_account_pubkey   (32)
   || user_yield_bps        (u16 LE)   // 10000 | 5000 | 0
   || expiry_unix_ts        (i64 LE)
```

The client submits a transaction whose **first instruction** is the Ed25519 precompile
(`Ed25519SigVerify111111111111111111111111111`) carrying `(authority_pubkey, msg, signature)`,
followed by `claim`. `claim` loads instruction 0 via `sysvar::instructions::load_instruction_at_checked`
and verifies, in this order:

1. `ix.program_id == ED25519_PROGRAM_ID`
2. `data[0] == 1` (exactly one signature) and `data[1] == 0` (padding)
3. every offset in the `Ed25519SignatureOffsets` header has `*_instruction_index == u16::MAX`
   (i.e. all data lives inside the precompile instruction itself) and lies within `data.len()`
4. the public key at `public_key_offset` equals `vault_config.authority`
5. the message at `message_data_offset .. + message_data_size` equals `msg` **rebuilt in-program**
   from `program_id`, `lock.key()`, the instruction's `user_yield_bps` arg, and its `expiry` arg
6. `user_yield_bps ∈ {10000, 5000, 0}`
7. `clock.unix_timestamp <= expiry`

Binding to `program_id` and `lock.key()` prevents cross-program and cross-lock replay; the lock
account is closed by `claim`, so a voucher cannot be replayed against the same lock.

**Why this is safe.** The voucher is *user-favorable*: it only ever lets a user take yield they
earned. A hostile authority cannot forge a voucher that steals principal (principal is paid
unconditionally), and refusing to issue vouchers only delays a user to `force_return`, where
principal still returns in full.

### 3.3 Instructions

| Ix | Signer | Behavior |
|----|--------|----------|
| `initialize_vault(params)` | **upgrade authority only** (programdata check) | Writes config incl. pinned Kamino market/reserve/collateral mint and caps. Kills init front-running |
| `initialize_pot(stable_mint)` | **upgrade authority only** | Same gate |
| `lock_funds(course_id_hash, amount)` | owner | `require!(!paused)`; `min ≤ amount ≤ max`; `current_tvl + amount ≤ cap`; transfer USDC owner → lock's liquidity ATA; CPI klend `deposit_reserve_liquidity` (cTokens → lock's collateral ATA); `current_tvl += amount`; `lock_start_ts = clock.now`; store `kamino_reserve` |
| `claim(user_yield_bps, expiry)` | owner | Verify voucher (§3.2). Redeem the **live** collateral-ATA balance via klend `redeem_reserve_collateral`. `redeemed := liquidity ATA balance after redeem` (absolute, not a delta). Split per §3.4. Pay owner; transfer forfeit → `pot_vault` and `credit_window` in the same instruction; fee → pinned fee vault (0 in beta). Assert both ATAs are zero, close them and the lock, rent → owner. `current_tvl -= principal`. **Never blocked by pause** |
| `force_return()` | **anyone** | `require!(status == ACTIVE && clock.now >= lock_start_ts + 180d)`. Same redeem/zero-out flow; principal → owner's ATA (`init_if_needed`, payer = caller); **all** yield − fee → `pot_vault` + `credit_window`. **Never blocked by pause** |
| `close_distribution_window(window_id, total_weight, eligible_count)` | authority | `require!(window_id < current_window_id_from_clock)` so an open month can never be closed underneath in-flight settlements. Snapshots the pot window |
| `distribute_window(recipient_key, window_id, amount)` | authority | Pays `pot_vault` → recipient ATA. `require!(amount <= min(distribution_window.remaining_amount(), pot_vault.amount))`. Recipient ATA constrained `associated_token::authority = recipient`. Receipt PDA blocks double-pay |
| `set_config(min, max, global, fee_bps, paused)` | authority | `fee_bps ≤ MAX_PLATFORM_FEE_BPS`. Caps affect new locks only. Pause blocks `lock_funds` only — never `claim`/`force_return` |
| `set_authority(new_authority)` | **upgrade authority only** | Rotation. The hot key cannot rotate itself |

`credit_window` is a **private fn**, not an instruction: it derives `window_id` from `Clock`
(`year*100 + month`, UTC), `init_if_needed`s the `PotWindow`, and increments
`total_redirected_amount`. It is unreachable except from `claim` / `force_return`, each of which
transfers the matching USDC in the same instruction — so the pot is backed by construction.

### 3.4 Settlement math

```rust
// redeemed = full liquidity-ATA balance after redeeming the full live collateral balance
let gross_yield   = redeemed.saturating_sub(principal);     // 0 if Kamino returned < principal
let fee           = gross_yield * fee_bps / 10_000;         // 0 in beta
let user_yield    = (gross_yield - fee) * user_yield_bps / 10_000;
let to_owner      = min(redeemed, principal) + user_yield;
let to_pot        = gross_yield - fee - user_yield;          // subtractive: rounding dust → pot
// force_return: user_yield_bps := 0
```
If `redeemed < principal` (Kamino socialized loss): `to_owner = redeemed`, `to_pot = 0`, `fee = 0`.
The owner absorbs the shortfall pro-rata; the pot never funds a loss. `to_owner + to_pot + fee == redeemed`
exactly, so both ATAs reach zero and `close_account` always succeeds.

### 3.5 Invariants (each maps to ≥1 test)

1. **Exit never requires the backend or the authority.** Any ACTIVE lock is exitable by its owner
   (with a voucher, any time) or by *anyone* (`force_return`, at `lock_start + 180d`). No authority
   signature appears on either path, and no authority action can postpone `lock_start_ts`.
2. **Pot backing.** `pot_vault.amount ≥ Σ (window.total_redirected − window.distributed)` always,
   because every credit is atomic with its transfer.
3. **TVL conservation.** `current_tvl == Σ principal of ACTIVE locks` across every flow.
4. **Pause traps nothing.** Pause gates `lock_funds` alone.
5. **No double settlement.** `claim`/`force_return` close the lock; distribution receipts block double payouts.
6. **Bounded authority.** A compromised hot key can: pause deposits, change caps within the hard
   fee max, sign vouchers, and distribute the pot (≤ `pot_vault.amount`, ≈ $25 at beta caps). It
   **cannot** move principal, block or delay any exit, rotate itself, exceed the fee hard max, or
   touch a lock's `lock_start_ts`.
7. **Yield floor.** `redeemed < principal` passes through to the owner; the pot receives 0.
8. **Settlement is donation-proof.** Redeeming the live collateral balance and paying out the full
   liquidity balance means an attacker's token donation is split like yield and can never strand a
   lock or block `close_account`.

### 3.6 Kamino integration

- Mainnet klend main market, USDC reserve. Program id pinned as a `const` and asserted on every CPI.
- **`refresh_reserve` is mandatory** before `deposit_reserve_liquidity` and
  `redeem_reserve_collateral`; klend rejects a stale reserve. It takes oracle accounts
  (`pythOracle`, `switchboardPriceOracle`, `switchboardTwapOracle`, `scopePrices` — some optional).
  It is prepended **client-side** in the same transaction; the program does not CPI it. Every
  transaction builder (deposit, claim, force_return crank) must include it.
- **The deposit and redeem account orders differ** (`reserve` and `lendingMarket` are swapped
  between them in the klend IDL). This is a silent footgun; both orders are pinned by the fixture
  in the program plan.
- Live position value = `collateral_balance × exchange_rate`, read off-chain (cached ~60 s).
- No devnet klend deployment. Program tests run against a **surfpool mainnet fork**; browser E2E
  runs on devnet against a **mock reserve program** exposing the same discriminators and account
  order, pinned by a boot guard to `CLUSTER=devnet`.

## 4. Backend (`backend/`)

### 4.1 Deletions
Ichor (columns, awards, shop buy-saver); brewery claim endpoint + treasury USDC payout
(`transferUsdcAtomic` yield path — the insolvency blocker); simulated harvest recorder and
`fixed_apy_dev` as a production default; fuel counters, feed endpoints, `consumeDailyFuel`;
gauntlet columns/counters/gates; duration presets; the `record_redirect` publisher; the
client-callable miss route (`consumeSaverOrApplyFullConsequence`); the key fallback chain; every
`includes('devnet')` guard.

### 4.2 Engines
- **Shield/lapse engine** (server cron, never client-triggered). Per active lock, per UTC day:
  - a *lesson-day* = ≥1 **first-time** lesson passed (a lesson not already in
    `user_lesson_progress` as completed). Replays and practice write nothing.
  - lesson-day → `streak += 1`; `consecutive_lesson_days += 1`; at 3 → `shields = min(shields+1, 3)`,
    `consecutive_lesson_days = 0`; clears `lapse_open`.
  - miss-day with `shields > 0` → `shields -= 1`; streak **paused** (unchanged);
    `consecutive_lesson_days = 0`.
  - miss-day with `shields == 0` → if `!lapse_open` then `lapse_count = min(lapse_count+1, 2)` and
    `lapse_open = true`; `streak = 0`; `consecutive_lesson_days = 0`.
  - `user_yield_bps = [10000, 5000, 0][min(lapse_count, 2)]`.
  - This unifies the two continuity paths that produced the known streak-reset bug (a shielded day
    previously wrote `last_miss_day` but not `last_completed_day`, so the next completion reset the
    streak).
- **Voucher service.** When every lesson in a course is passed first-time, sign
  `msg` (§3.2) with the ops key, `expiry = now + 90d`, store it, and expose it on the lock's
  status endpoint. Re-issuable and idempotent — there is no queue that can stick.
- **Force-return crank** (daily): scan ACTIVE locks past `lock_start + 180d`, submit sponsored
  `force_return` (with `refresh_reserve` prepended).
- **Pot cycle** (monthly): snapshot weights (principal × streak, active streaks only) → close the
  previous month's window → distribute in batches.
- **Position reader:** `GET /v1/locks/:courseId/position` → live value (collateral × exchange rate, cached 60 s).
- **SOL drip:** one-time ~0.005 SOL to a wallet at first deposit, per-identity, idempotent, capped.
- **Boot guards:** `CLUSTER` enum + genesis-hash check; ≥32-byte secret floor; ops/deployer keys
  present and pairwise distinct; refuse to boot otherwise. On `CLUSTER=mainnet`, refuse any
  mock-yield adapter.
- **Practice mode:** enforced server-side from course-completion state, not a client flag.

### 4.3 Migrations
Apply pending `0038`, `0039`. New `0040+`: drop ichor/fuel/gauntlet columns (two-phase — stop
writing first, drop after launch stabilizes); add `shields`, `lapse_count`, `lapse_open`,
`consecutive_lesson_days`, `privy_user_id`, voucher storage. **Before any of it: a
`schema_migrations` tracking table + an apply script that records what ran** (half a day; the
current process is hand-applied SQL against prod Supabase with no ordering guarantee).

## 5. Frontend (`web-app/`)

- **Dashboard:** course cards — live position value (ticking), flame gauge, 🛡×N, streak, progress
  bar, next-lesson CTA, CLAIM when a voucher exists, penalty banner when lapsed. Modals: shields,
  pot, history. Capacity meter on deposit ("$X / $1,000 locked").
- **CLAIM flow (new — the unlock builder exists today but has zero call sites):** fetch voucher →
  build tx `[refresh_reserve, ed25519_verify, claim]` → Privy sign → success screen with the
  breakdown (principal / yield kept / forfeited to pot).
- **Deposit:** $10–50, no duration picker; empty-wallet path → Privy funding + guide modal.
- **Flame states:** blazing / flickering (+ "🛡N left — flame dies in D days" banner + push hook) /
  dark (−50% badge) / extinguished (−100% badge).
- **Lesson feedback:** the answer key no longer ships (hotfix `89867bb`), so instant per-question
  checking needs a server endpoint: `POST /v1/progress/lessons/:id/check` grading one question and
  returning correct/incorrect plus the answer *after* the user commits.
- **Copy purge:** ichor→USDC redemption claims, coin pouches, card-on-ramp promises,
  fuel/feeding. New canon: "Mistakes are free — quitting for a day is not." /
  "Exits: finish the course, or wait 180 days."
- **Pages:** delete /alchemy, /inventory, /shop (→ modals) and /menu (village is the hub);
  leaderboard ranks by current streak; practice badge on completed courses; devnet faucet UI
  hidden when `CLUSTER=mainnet`; `CLUSTER` read from `NEXT_PUBLIC_SOLANA_CLUSTER` (kill the
  hardcode in `services/solana/connection.ts:5`).

## 6. Ops, safety, incident playbook

- **Key ceremony.** Upgrade authority = Squads 2-of-3, all signers held by Ong (Ledger + laptop +
  offline backup) — chosen because this repo has **already lost program keypairs once**
  (`target/deploy` keys no longer match the live devnet program IDs, which are now
  un-upgradeable). Mandatory dress rehearsal: a full deploy → init → upgrade cycle on
  devnet/fork with the real hardware, and HANDOFF v2 written *from that rehearsal*. Verify with
  `solana program show <id>` post-deploy. Ops key lives on Render and is low-power by invariant 6.
- **Capital.** 2–5 SOL deploy rent, ~0.5 SOL crank/drip float, and a paid RPC (Helius/Triton —
  the public endpoint is not mainnet-viable). Budget it; "~$0 capital" was wrong.
- **Monitoring.** Sentry (FE + BE). Alerts: `/health` failure, crank missed schedule, 5xx spike,
  **any pot outflow**, voucher-signing failures, Kamino reserve utilization > 95% (pause deposits).
- **Incident playbook.** (1) `set_config(paused = true)` — deposits stop, exits keep working.
  (2) Status post within 1h. (3) Platform bug losing user funds ≤ caps → 100% reimbursement from
  personal funds; Kamino systemic event → pass-through, communicate, no reimbursement. Keep that
  line bright in user-facing copy. (4) Public post-mortem ≤ 72h. (5) Unpause only with a fix plus
  a regression test. **The personal-guarantee promise expires at the first cap raise** — write its
  sunset into the playbook now.
- **Cap ladder.** Beta $50/$1k → post-audit $100–500/lock and per-course difficulty-scaled caps
  (`courseLockPolicy` already supports them) → mature $1k+ expert tiers. The audit gates each raise.

## 7. Testing

- **Surfpool mainnet-fork suite (primary).** Every §3.5 invariant. Lock → Kamino deposit. Claim at
  bps 10000/5000/0 with pot-funding assertions. Voucher negatives: wrong signer, wrong lock, wrong
  program id, expired, malformed precompile header, `instruction_index != u16::MAX`, bps ∉ {10000,5000,0}.
  `force_return` before/after the deadline, by a third party, on an already-claimed lock.
  **Donation attack:** transfer cUSDC and USDC into a lock's ATAs, then assert both `claim` and
  `force_return` still succeed and both ATAs close. Caps + TVL conservation across interleaved
  flows. Pause leaves exits open. Init front-run rejected. `fee_bps` hard max. `window_id` cannot
  be supplied by a caller. `distribute_window` over-claim rejected. Kamino redeem-failure path.
  Yield floor (invariant 7).
- **DB integration tests.** Shield regen at exactly 3 consecutive lesson-days; a miss resetting the
  run; alternate-day play **must lapse** (the M1 regression); shielded day preserves the streak
  (complete D1, shield-miss D2, complete D3 → streak 3 — the known bug); lapse coalescing;
  one-mercy bps mapping; first-time-only completion (replay writes nothing); practice-mode no-ops;
  monthly pot weights and payout invariants (sum == total, zero weight, dust remainder).
- **E2E (Playwright — already configured in `web-app`).** Devnet staging against the mock reserve
  program: signup → deposit → lesson pass/fail → shield-burn banner → voucher → claim →
  leaderboard/pot. Wallet fixtures use a funded devnet wallet (USDC + SOL, provided by Ong).
  Mainnet-fork smoke (deposit → claim) before launch.
- **Regression guards, blocking.** Lesson payload must not contain `correctAnswer` or
  `expectedTokens`; request-body timestamps must be ignored; `!hasDatabase()` must fail closed.
  (All three shipped in `89867bb`.)
- **Boot guards.** Cluster/genesis mismatch and identical keys refuse to start.

## 8. Six-week plan

Rev 2 claimed four weeks. That was fiction: the "existing" program test rig is one file with two
tests, `refresh_reserve` was missing from the design entirely, and week 3 bundled a frontend
rebuild, a claim flow that does not exist, a Playwright suite, and authoring 2–3 courses.

- **W1–2 — Program v2 on the surfpool fork.** Test rig + klend fixture; state and settlement math;
  voucher verification; CPI wrapper; the 9 instructions; the invariant matrix green.
- **W2–3 — Backend.** Migration tracker first. Deletions; shield/lapse engine; voucher service;
  cranks; SOL drip; position reader; boot guards; DB tests.
- **W3–5 — Frontend.** Course cards, claim flow, flame gauge, modals, per-question check endpoint,
  copy purge, cluster fix, Privy funding, practice mode. Playwright E2E on devnet. Courses authored
  in parallel.
- **W6 — Launch.** Squads ceremony + rehearsal; mainnet deploy, init, caps; monitoring;
  disclosures page; own-money soak including at least one real mainnet claim; then open the beta.

## 9. Post-beta roadmap

Professional audit → cap raises + difficulty-scaled stakes. Merkle-committed pot eligibility with
proofs in `distribute_window`. Timelocked distributions. Hard on-chain sybil gate (a deposit
permit reusing the voucher machinery). Tier recovery (a clean streak steps the penalty back down).
Platform fee activation. Demo course / free-preview funnel. IaC for the web service + database.

## 10. Accepted risks (disclosed, not hidden)

1. **Unaudited custody code** holding ≤ $1,000 — mitigated by on-chain caps, the invariant suite,
   pause, and a pre-written playbook.
2. **Single hot ops key**, no multisig on the ops role — bounded by invariant 6: it can pause
   deposits, sign vouchers, and distribute the pot (≈$25 ceiling at beta caps). It cannot touch
   principal or any exit. Upgrade authority *is* multisig.
3. **Kamino pass-through risk.** A reserve pause or illiquidity blocks **both** exit paths
   simultaneously — `claim` and `force_return` both redeem. Disclose in plain words: *"If Kamino
   freezes or fails, your funds may be inaccessible or partially lost; we cannot override this."*
   A cUSDC socialized loss is passed to the owner (invariant 7).
4. **Kamino market/reserve are pinned at init with no update instruction.** A Kamino market
   migration would require a program upgrade — acceptable only because the upgrade authority is
   retained and its ceremony is rehearsed.
5. **Sybil is soft-gated only.** Max 2 locks per Privy identity at tx-build time; a direct program
   call bypasses it. Accepted because with server-authoritative timestamps and first-time-only
   completions, pot weight now requires genuinely completing real lessons on each account daily,
   and filling the TVL cap costs the attacker their own $1,000 locked for 180 days. Revisit before
   any cap raise.
6. **Re-lock of a completed course is blocked off-chain only.** `claim` closes the lock PDA, so a
   direct program call could re-lock. Harmless today (no first-time lessons remain, so no streak,
   no yield advantage). An on-chain tombstone PDA is the fix if it ever matters.
7. **Model A retroactivity.** A lapse taxes yield earned before it. Accepted for simplicity;
   softened by one-mercy and shield regen. Note the user-facing copy must not claim "only 4+
   consecutive dark days can lapse" — that is only true starting from full shields.
8. **An active-but-never-finishing user stays locked until day 180.** Disclosed at deposit.
9. **A permanently dead backend costs a finished user their yield** (no voucher → `force_return` at
   day 180 sends yield to the pot). Principal always returns. Vouchers are issued the moment a
   course completes and are valid 90 days, so the exposure window is small.
