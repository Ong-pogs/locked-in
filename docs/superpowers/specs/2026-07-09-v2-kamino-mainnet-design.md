# Locked In v2 — Real Yield (Kamino) + Mainnet Beta — Design Spec

> Status: approved in design session 2026-07-09 (Ong + Claude). Rev 2 (expanded).
> Supersedes: simulated-yield model, ichor economy, fuel/feeding, duration presets,
> per-harvest redirect tiers (0/10/15/20), and all v3 remnants (gauntlet, fragments).
> Posture: **real product**, launching as a capped, unaudited, honestly-disclosed mainnet beta.

## 1. Summary

Users deposit USDC ($10–50) into a per-course lock; the program CPIs the principal into
Kamino Lend's USDC reserve where it earns real, compounding yield. Finishing every lesson in
the course unlocks CLAIM: principal + yield × (100% − penalty) in one user-signed
transaction. Daily learning keeps a flame alive; three auto-burning shields absorb missed
days and regenerate one per lesson-day; exhausting shields and going dark is a "lapse"
(first lapse forfeits 50% of yield, second forfeits 100% — forfeits fund the community pot).
Quitting entirely triggers a permissionless auto-return of principal after 90 days of
inactivity. Total value at risk is hard-capped on-chain ($1k global) until an audit unlocks
higher tiers. No platform fee in beta (`platform_fee_bps = 0`, rails reserved).

## 2. Product decision ledger

| # | Area | Decision |
|---|------|----------|
| 1 | Scope | Full model on mainnet: real Kamino yield + real funded pot |
| 2 | Posture | Real product; capped unaudited beta; professional audit = first major expense post-launch |
| 3 | Yield venue | Kamino Lend (klend) main-market USDC reserve only. Rationale: existing SDK integration, deepest Solana USDC lending liquidity (withdrawal-crunch tail risk), multiple audits, simple cToken exchange-rate accounting |
| 4 | Yield mechanics | Deposited at lock via CPI; compounds in-position; visible live on dashboard (RPC read); paid once at settlement |
| 5 | Claim gate | ALL lessons in course passed (each score ≥ 70) → backend attests on-chain (one-shot) → owner-signed CLAIM |
| 6 | Penalty | Lapse-based, one-mercy: 1st lapse −50% of total yield, 2nd −100%. Applied to total yield at settlement (Model A accounting) |
| 7 | Lapse definition | An unprotected missed day (shields empty). Consecutive dark days coalesce into ONE lapse; a subsequent lapse requires ≥1 lesson-day in between |
| 8 | Shields (savers) | Start 3, +1 per lesson-day, cap 3, auto-burn on missed day. Shield-covered day: streak PAUSED (not grown, not reset) |
| 9 | Streak | ≥1 passed lesson per UTC day, per course. Unprotected miss → streak dies |
| 10 | Multi-course | Per-course locks/streaks/shields; PDA `[b"lock", owner, course_id_hash]`; one live lock per (wallet, course) |
| 11 | Quit path | Weekly on-chain heartbeat for active locks; `force_return` permissionless once `now ≥ last_heartbeat + 90d` (uncompleted locks only): principal → owner, all yield → pot; platform sponsors gas |
| 12 | Unclaimed positions | Attested-but-unclaimed keep earning at frozen `user_yield_bps`; uncompleted past-deadline positions accrue to pot until swept by `force_return` |
| 13 | Pot | Funded ONLY by real forfeited yield at settlements. Monthly windows (YYYYMM), weight = principal × current streak, active streaks only, pro-rata |
| 14 | Caps | On-chain: `min_principal` $10, `max_principal_per_lock` $50, `global_tvl_cap` $1,000 with live counter. Authority `set_caps`; caps constrain new locks only |
| 15 | Platform fee | **0 for beta.** `platform_fee_bps` field on `VaultConfig`, default 0, max hard-capped (e.g. ≤ 2000) — enabling later = config, not upgrade. Fee (when enabled) comes from YIELD ONLY, never principal |
| 16 | Lessons | Unlimited retries, pass ≥ 70%, no lives/hearts |
| 17 | Flame | Auto health gauge (no feeding): BLAZING (streak alive, 3 shields) → FLICKERING (shields burning; countdown banner) → DARK (1 lapse, −50%) → EXTINGUISHED (2 lapses, −100%). Fuel currency + manual feeding DELETED |
| 18 | Ichor + shop | DELETED entirely |
| 19 | XP | Kept; leaderboard ranks by CURRENT STREAK |
| 20 | Dashboard | Course-card layout: per lock — live position value, flame, shields, streak, progress bar, next-lesson CTA, CLAIM state. Alchemy/inventory/shop pages die into modals |
| 21 | Access | Deposit-gated progression; lesson text stays publicly readable; NO demo course; no free tier |
| 22 | Re-lock | Completed course can never be re-locked. Completed users get PRACTICE MODE (free replay; no XP/streak/shield writes) |
| 23 | Gas UX | Platform fee-payer co-signs deposit/claim for embedded wallets; per-wallet rate limit |
| 24 | Onramp | Privy built-in funding (MoonPay/Coinbase) + "fund your wallet" guide modal |
| 25 | Courses | 2 polished at launch (Blockchain & Wallets, DeFi); placeholders hidden; +2–3 new courses authored weeks 3–4 |
| 26 | Hub | Pixel village = main hub (3D dungeon retired); no /menu page; fireplace renders the flame gauge |
| 27 | Cluster safety | Explicit `CLUSTER=devnet|mainnet` env + genesis-hash verification at boot, fail-closed; every `rpcUrl.includes('devnet')` check deleted |
| 28 | Keys | 3 distinct keys: upgrade authority (cold/offline), attestor+pot authority (hot, low-power), deployer. Fallback chain deleted; boot fails on missing/identical keys |
| 29 | Disclosure | In-app + ToS: unaudited, caps, "exits: finish the course, or stop for 90 days", Kamino pass-through risk, authority powers and their hard limits |

## 3. On-chain program v2 (`programs/locked_in`)

Fresh program ID for mainnet (new keypair; custody ceremony documented in HANDOFF v2).
Current devnet deployment (`3RC9XkPZ…kBav`) remains as staging.

### 3.1 State

**`VaultConfig`** — PDA `[b"vault-protocol"]`
```
authority: Pubkey            // attestor/ops key (hot, low-power)
usdc_mint: Pubkey
kamino_market: Pubkey        // pinned at init
kamino_reserve: Pubkey       // pinned at init
min_principal: u64           // 10_000_000 (=$10, 6dp)
max_principal_per_lock: u64  // 50_000_000
global_tvl_cap: u64          // 1_000_000_000
current_tvl: u64             // live counter (principal units)
platform_fee_bps: u16        // 0 in beta; hard max enforced ≤ 2000
paused: bool
bump: u8
```

**`LockAccount`** — PDA `[b"lock", owner, course_id_hash]`
```
owner, course_id_hash, stable_mint
principal_amount: u64
ctoken_amount: u64           // Kamino collateral held by this lock
lock_start_ts: i64
last_heartbeat_ts: i64       // exit clock anchor
completion_attested: bool
user_yield_bps: u16          // 10000 | 5000 | 0, frozen at attestation
status: u8                   // ACTIVE | CLOSED
bump: u8
```
Each lock owns a cToken ATA (authority = lock PDA). Pot accounts (`PotConfig`, `PotWindow`,
`DistributionWindow`, receipts) keep their v1 shapes; standalone `record_redirect` retires on
mainnet — pot funding + window accounting happen inside settlement instructions so
`Σ window accounting ≤ pot_vault.amount` holds by construction.

### 3.2 Instructions

| Ix | Signer | Behavior |
|----|--------|----------|
| `initialize_vault(params)` / `initialize_pot(...)` | **program upgrade authority only** (programdata check) | Writes config incl. pinned Kamino market/reserve + caps. Kills init front-running |
| `lock_funds(course_id_hash, amount)` | owner | Require `!paused`; `min ≤ amount ≤ max`; `current_tvl + amount ≤ cap`; USDC owner→temp; CPI klend `deposit_reserve_liquidity`; cTokens → lock's ATA; `current_tvl += amount`; `last_heartbeat_ts = now` |
| `heartbeat(locks[])` | authority | Weekly batch: `last_heartbeat_ts = now` for locks with that week's learning activity. Clamped to `now` (no future-dating). Backend death ⇒ heartbeats stop ⇒ universal exit opens 90d later |
| `attest_completion(user_yield_bps)` | authority | One-shot: require `!completion_attested`; `user_yield_bps ∈ {10000, 5000, 0}`; set flag + bps. Immutable afterwards |
| `claim` | owner | Require `completion_attested && status == ACTIVE`. CPI klend `redeem_reserve_collateral` (full `ctoken_amount`); let `total = redeemed`, `yield = total − principal` (floor 0); pay owner `principal + yield × user_yield_bps/10000 − fee`; fee = `yield × platform_fee_bps/10000` → fee vault (0 in beta); remainder of yield → `pot_vault` + window accounting same-ix; `current_tvl −= principal`; close lock + ATAs, rent → owner. **Never blocked by pause** |
| `force_return` | **anyone** | Require `!completion_attested && now ≥ last_heartbeat_ts + 7_776_000 (90d) && status == ACTIVE`. Full redeem; principal → owner ATA (init_if_needed); ALL yield − fee → `pot_vault` + accounting; `current_tvl −= principal`; close lock. **Never blocked by pause.** Platform runs sponsored crank; user or any third party can equally call |
| `set_caps(min, max, global, fee_bps)` / `set_pause(bool)` | authority | Fee_bps ≤ hard max. Caps affect new locks only. Pause blocks `lock_funds`, `heartbeat`, `attest_completion` — never `claim`/`force_return` |
| `close_distribution_window` / `distribute_window` | authority | v1 semantics + payout double-floored by `min(remaining_amount, pot_vault.amount)` |

### 3.3 Invariants (every one is a test)

1. **Exit needs no backend:** every ACTIVE lock is exitable by owner (claim if attested) or by
   anyone (`force_return` 90d after last heartbeat). No authority signature on either path.
2. **Pot backing:** `pot_vault.amount ≥ Σ distribution-window remaining` at all times.
3. **TVL conservation:** `current_tvl == Σ principal of ACTIVE locks` across all flows.
4. **Pause never traps funds.**
5. **No double-settlement:** claim/force_return close the lock account; distribution receipts
   block double pot payouts.
6. **Bounded authority blast radius:** a compromised authority key can attest generously,
   pause deposits, mis-distribute the pot (≤ pot balance), and bump heartbeats (delaying
   force_return eligibility but never blocking owner claim). It can NOT move principal,
   block exits, raise fee above hard max, or mint state that exceeds caps.
7. **Yield floor:** if Kamino redemption returns < principal (extreme), user absorbs
   shortfall pro-rata (pass-through), pot gets 0 — no negative-yield claims on the pot.

### 3.4 Kamino notes

- Mainnet klend main market, USDC reserve (`7u3He…5PfF` per existing backend config).
- No devnet klend ⇒ pre-mainnet testing on **surfpool mainnet fork** (existing rig).
- Live position value = `ctoken_amount × exchange_rate` (backend read, ~60s cache).
- Redemption failure (reserve illiquid/paused) ⇒ settlement ix fails atomically; retry later;
  disclosed pass-through risk.

## 4. Backend (`backend/`)

### 4.1 Deletions
Ichor (columns, awards, shop buy-saver), brewery claim endpoint + treasury USDC payout path,
simulated harvest recorder + `fixed_apy_dev` as prod default, fuel counters + feed endpoints +
`consumeDailyFuel`, gauntlet columns/counters/gates, duration presets, `record_redirect`
publisher, key fallback chain, `includes('devnet')` guards, XP-less v3 leftovers.

### 4.2 New/changed engines
- **Shield/lapse engine:** shields +1/lesson-day (cap 3); miss ⇒ auto-burn newest shield,
  streak paused; miss at 0 shields ⇒ lapse event (streak → 0; consecutive dark days coalesce);
  lapse_count → bps {0:10000, 1:5000, ≥2:0}.
- **Completion watcher:** all lessons passed ⇒ enqueue `attest_completion(bps)` (idempotent,
  retried, alerted on repeated failure).
- **Heartbeat crank (weekly):** batch-bump locks with activity.
- **Force-return crank (daily):** scan uncompleted locks `now − last_heartbeat ≥ 90d`, fire
  sponsored `force_return`.
- **Pot cycle (monthly):** snapshot weights (principal × streak, active only) → close window →
  distribute batch.
- **Position reader:** GET per-lock live value (ctoken × exchange rate, cached 60s).
- **Fee-payer service:** co-sign deposit/claim for embedded wallets; per-wallet + per-IP rate
  limits; signs ONLY known instruction shapes to our program (transaction introspection).
- **Boot guards:** `CLUSTER` enum + genesis-hash check; ≥32-byte secret floor; worker keys
  present + pairwise distinct; refuse boot otherwise.
- **Practice mode:** completed course ⇒ content replay, no XP/streak/shield writes.

### 4.3 API surface changes
- Removed: `/v1/progress/brewery/*` (claim/feed), shop buy-saver, internal fuel/harvest
  publish routes.
- Added: `GET /v1/locks/:courseId/position` (live value), `POST /v1/locks/:courseId/claim-tx`
  (build + co-sign claim), `GET /v1/progress/shields/:courseId`, completion status in runtime
  snapshot; capacity endpoint (`current_tvl`, cap) for the deposit meter.
- Changed: runtime snapshot drops fuel/ichor/gauntlet fields, adds shields, lapse_count,
  flame_state, attested, claimable breakdown.

### 4.4 Migrations
Apply pending 0038, 0039; new 0040+ series: drop ichor/fuel/gauntlet columns; add
`shields`, `lapse_count`, `last_lapse_started_day`, heartbeat bookkeeping, attestation queue
table, practice-mode flag. Each idempotent; applied to Supabase prod by hand (runner remains
roadmap).

## 5. Frontend (`web-app/`)

- **Dashboard:** course cards (live value ticking, flame gauge, 🛡×N, streak, progress bar,
  next-lesson CTA, CLAIM button when attested, penalty banner when lapsed). Modals: shields,
  pot, history. Capacity meter on deposit entry ("$X / $1,000 locked").
- **CLAIM flow (new — no unlock UI exists today):** tx build + Privy sign + confirm; success
  screen with breakdown (principal / yield kept / forfeited to pot).
- **Deposit flow:** amount $10–50 (no duration picker); empty-wallet path → Privy funding +
  guide modal; fee-payer co-sign for embedded wallets.
- **Flame states:** blazing / flickering (+"🛡N left — flame dies in D days" banner + push
  hook) / dark (−50% badge) / extinguished (−100% badge, "finish for principal + pot rank").
- **Copy purge:** all ichor→USDC redemption claims, coin pouches, card-on-ramp promises,
  fuel/feeding references. New canon: "Mistakes are free — quitting for a day is not." /
  "Exits: finish the course, or stop for 90 days."
- **Pages:** delete /alchemy /inventory /shop (→modals) and /menu (village = hub);
  leaderboard = current streak; practice badge on completed courses; devnet faucet UI hidden
  when `CLUSTER=mainnet`; `CLUSTER` read from `NEXT_PUBLIC_SOLANA_CLUSTER` (kill hardcode).

## 6. Ops, safety, incident playbook

- **Key ceremony:** upgrade authority generated offline, cold storage (paper + hardware),
  never in any env; attestor/pot hot key on Render (low-power by invariant 6); deployer
  separate. Documented in HANDOFF v2.
- **Capital needs:** 2–5 SOL deploy rent + ~0.5 SOL fee-payer/crank float. Only requirement.
- **Monitoring:** Sentry (FE+BE) free tier; alerts: /health fail, crank missed schedule,
  5xx spike, any pot outflow > $100, attestation queue stuck.
- **Incident playbook:** (1) `set_pause`; (2) status post ≤ 1h; (3) platform bug losing user
  funds ≤ caps ⇒ 100% reimbursement from personal funds; Kamino systemic event ⇒
  pass-through, communicate; (4) public post-mortem ≤ 72h; (5) unpause only with fix +
  regression test.
- **Cap ladder:** beta $50/$1k → post-audit $100–500/lock + per-course difficulty-scaled caps
  (`courseLockPolicy` already supports) → mature $1k+ tiers. Audit gates each raise.

## 7. Testing

- **Surfpool mainnet-fork suite (primary):** every §3.3 invariant; lock→deposit; claim at bps
  10000/5000/0 with pot-funding assertions; force_return (incl. third-party caller, incl.
  attested-lock rejection); double-settlement rejection; caps + TVL counter conservation;
  pause semantics; init front-run rejection; fee_bps hard-max; Kamino redeem-failure path;
  yield-floor (invariant 7).
- **DB integration tests:** shield regen/burn/pause; lapse coalescing + one-mercy mapping;
  completion detection incl. re-grade edge; practice-mode no-ops; heartbeat eligibility;
  monthly pot weights + payout invariants (sum == total, zero-weight, dust remainder).
- **E2E (Playwright):** full browser flows against devnet staging — signup (Privy) → deposit →
  lesson pass/fail → shield burn banner → claim (devnet uses a mock-yield adapter for
  determinism) → leaderboard/pot pages. Runs in CI against staging; a **funded devnet wallet
  (USDC + SOL, provided by Ong)** powers the wallet fixtures. Mainnet-fork E2E smoke (deposit
  → claim happy path) before launch.
- **Boot guards:** cluster/genesis mismatch and identical-keys refuse to start.

## 8. Four-week plan (summary — detailed steps in implementation plan doc)

- **W1 — Program v2 on surfpool:** state + all instructions + fork test suite green.
- **W2 — Backend surgery:** deletions, engines, cranks, fee-payer, guards, migrations, DB
  tests.
- **W3 — Frontend:** cards, claim flow, flame, modals, copy purge, cluster fix, Privy
  funding, practice mode; Playwright E2E on devnet staging; +2–3 courses authored.
- **W4 — Launch:** key ceremony, mainnet deploy/init/caps, monitoring, disclosures, staged
  beta (own deposits → open), fork E2E smoke, marketing material.

## 9. Post-beta roadmap

Professional audit → cap raises + difficulty-scaled stakes; Squads multisig (upgrade + pot);
merkle-committed pot eligibility in `distribute_window`; tier-recovery mechanic; platform fee
activation (bps > 0) with disclosure; demo course / free-preview funnel; migration runner +
IaC; mobile PWA polish.

## 10. Accepted risks (disclosed)

1. Unaudited custody code holding ≤ $1k — mitigated by caps/tests/pause/playbook.
2. Single hot authority key — bounded by invariant 6; multisig on roadmap.
3. Kamino pass-through risk incl. rare negative-redemption (invariant 7) — disclosed.
4. Authority mis-attestation/mis-distribution — bounded by pot balance + caps; on-chain
   visible.
5. Active-but-never-finishing users stay locked while active — disclosed at deposit.
6. Model A retroactivity (lapse taxes pre-lapse yield) — accepted for simplicity; softened by
   one-mercy + shield regen (only 4+ consecutive dark days can ever lapse).
7. Heartbeat-bumping by a compromised authority delays quitter auto-return (never blocks an
   attested claim) — accepted; bounded by key rotation runbook.
