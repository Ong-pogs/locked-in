# Locked In v2 — Real Yield (Kamino) + Mainnet Beta — Design Spec

> Status: approved in design session 2026-07-09 (Ong + Claude).
> Supersedes: simulated-yield model, ichor economy, fuel/feeding, duration presets,
> per-harvest redirect tiers (0/10/15/20), and the v3 remnants (gauntlet, fragments).
> Posture: **real product**, launching as a capped, unaudited, honestly-disclosed mainnet beta.

## 1. One-paragraph summary

Users deposit USDC ($10–50) into a per-course lock; the program CPIs the principal into
Kamino's USDC reserve where it earns real, compounding yield. Finishing every lesson in the
course unlocks CLAIM: principal + yield × (100% − penalty) in one user-signed transaction.
Daily learning keeps a flame alive; 3 auto-burning shields (savers) absorb missed days and
regenerate 1 per lesson-day; running out of shields and going dark = a "lapse" (1st lapse
forfeits 50% of yield, 2nd forfeits 100% — forfeits fund the community pot). Quitting entirely
triggers a permissionless auto-return of principal after 90 days of inactivity. Total value at
risk is hard-capped on-chain ($1k global) until an audit unlocks higher tiers.

## 2. Product decision ledger (all locked)

| # | Area | Decision |
|---|------|----------|
| 1 | Scope | Full model on mainnet: real Kamino yield + real funded pot |
| 2 | Posture | Real product; capped unaudited beta first; audit = first major expense later |
| 3 | Yield | Principal deposited to Kamino USDC reserve at lock; compounds in-position; paid once at claim |
| 4 | Claim gate | ALL lessons in course passed (score ≥ 70 each) → backend attests on-chain → owner-signed CLAIM |
| 5 | Penalty | Lapse-based, one-mercy: 1st lapse −50% of total yield, 2nd lapse −100%. Applied to total yield at settlement (Model A) |
| 6 | Lapse | An unprotected miss day (shields empty). Consecutive dark days = ONE lapse event; a new lapse requires activity in between |
| 7 | Savers ("shields") | Start 3, +1 per lesson-day, cap 3, auto-burn on missed day. Shield-covered day: streak PAUSED (not grown, not reset) |
| 8 | Streak | 1 passed lesson per UTC day, per course. Unprotected miss → streak dies + flame state worsens |
| 9 | Multi-course | Per-course locks/streaks/shields (PDA `[b"lock", owner, course_id_hash]`), unchanged |
| 10 | Quit path | Weekly on-chain heartbeat while active; `force_return` permissionless once `now ≥ last_heartbeat + 90d`: principal → owner, yield → pot; platform sponsors gas |
| 11 | Unclaimed | Completed-but-unclaimed positions keep earning at the user's ratio; post-force-return-eligible positions accrue to pot until swept |
| 12 | Pot | Funded ONLY by real forfeited yield at settlements. Monthly windows (YYYYMM), weight = principal × current streak, active streaks only |
| 13 | Caps | On-chain: min $10, max $50/lock, $1,000 global TVL (live counter). `set_caps` authority ix; caps only constrain new locks |
| 14 | Lessons | Unlimited retries, pass ≥ 70%, no lives/hearts system |
| 15 | Flame | Auto "commitment health gauge": BLAZING (streak alive, 3 shields) → FLICKERING (shields burning, countdown shown) → DARK (1 lapse, −50%) → EXTINGUISHED (2 lapses, −100%). Fuel currency + manual feeding DELETED |
| 16 | Ichor + shop | DELETED (columns, awards, buy-saver, drop animations) |
| 17 | XP | Kept, but leaderboard ranks by CURRENT STREAK |
| 18 | Dashboard | Course-card layout (option B): each lock = self-contained card (live position value, flame, shields, progress bar, next-lesson CTA, CLAIM state). Alchemy + inventory pages die into modals (shields, pot, history) |
| 19 | Access | Deposit-gated progression. Lesson text remains publicly readable (marketing). NO demo course. No free tier |
| 20 | Re-lock | Completed course cannot be re-locked. Completed users get free PRACTICE MODE (replay lessons; no XP/streak/shield effects) |
| 21 | Gas UX | Platform fee-payer co-signs deposit/claim for embedded-wallet users; rate-limited per wallet |
| 22 | Onramp | Privy built-in funding (MoonPay/Coinbase) + "fund your wallet" guide modal |
| 23 | Courses | 2 polished at launch (Blockchain & Wallets, DeFi), placeholders hidden, +2–3 new courses authored during weeks 3–4 |
| 24 | Village | Pixel village = main hub (3D dungeon retired). No separate /menu. Fireplace renders the health-gauge flame |
| 25 | Cluster safety | Explicit `CLUSTER=devnet|mainnet` env + genesis-hash verification at boot, fail-closed; all `rpcUrl.includes('devnet')` checks deleted |
| 26 | Keys | 3 distinct keys: program upgrade authority (cold, offline), attestor/pot authority (hot, low-power), deployer. `?? DEPLOYER_PRIVATE_KEY` fallback chain deleted; boot fails if keys missing or identical |
| 27 | Beta disclosure | In-app + ToS: unaudited, capped, Kamino pass-through risk, "exits: finish the course, or stop for 90 days" |

## 3. On-chain program v2 (`programs/locked_in`)

Fresh program ID for mainnet (new keypair, custody documented). Devnet keeps current
deployment as staging.

### 3.1 Accounts

**`VaultConfig`** (PDA `[b"vault-protocol"]`) — gains fields:
`min_principal`, `max_principal_per_lock`, `global_tvl_cap`, `current_tvl`, `paused: bool`,
`kamino_market`, `kamino_reserve`. `authority` becomes meaningful (attestor/ops key).

**`LockAccount`** (PDA `[b"lock", owner, course_id_hash]`) — gains fields:
`last_heartbeat_ts: i64`, `completion_attested: bool`, `user_yield_bps: u16` (10000/5000/0,
set at attestation), `ctoken_amount: u64` (Kamino collateral held). Drops nothing user-visible;
`lock_end_ts` semantics replaced by heartbeat + completion model.

**Pot accounts** — unchanged shapes (`PotConfig`, `PotWindow`, `DistributionWindow`,
receipts). `record_redirect` as a standalone authority-bookkeeping ix is retired on mainnet;
pot funding happens inside settlement instructions (below) so
`total_redirected_amount ≤ pot_vault.amount` holds structurally.

### 3.2 Instructions

| Ix | Signer | What it does |
|----|--------|--------------|
| `initialize_vault` / `initialize_pot` | upgrade authority only (programdata check) | As today + new config fields. Kills init front-run |
| `lock_funds(course_id_hash, amount)` | owner | Checks `!paused`, `min ≤ amount ≤ max`, `current_tvl + amount ≤ cap`; transfers USDC owner→vault ATA; CPI `deposit_reserve_liquidity` into Kamino USDC reserve; stores `ctoken_amount`; `current_tvl += amount`; `last_heartbeat_ts = now` |
| `heartbeat(batch)` | authority | Weekly, batched: bumps `last_heartbeat_ts = now` for locks with learning activity that week. Cannot set future values. Stops forever if backend dies → everyone force-returnable 90d later |
| `attest_completion(user_yield_bps)` | authority | Requires all-lessons-passed off-chain; sets `completion_attested = true`, `user_yield_bps ∈ {10000, 5000, 0}`. One-shot, immutable after set |
| `claim` | owner | Requires `completion_attested`. CPI `redeem_reserve_collateral` (full position); principal + yield×bps/10000 → owner ATA; remainder → `pot_vault` + pot window accounting in same ix; `current_tvl −= principal`; closes lock. NOT blockable by pause |
| `force_return` | ANYONE (permissionless) | Requires `!completion_attested && now ≥ last_heartbeat_ts + 90d`. CPI full redeem; principal → owner ATA; ALL yield → `pot_vault` + accounting; closes lock. NOT blockable by pause. Platform runs it sponsored; users/anyone can too |
| `set_caps` / `set_pause` | authority | Caps affect new locks only; pause blocks `lock_funds` + `heartbeat` + `attest_completion`, NEVER `claim`/`force_return` |
| `close_distribution_window` / `distribute_window` | authority | As today + payout double-floored by `min(remaining_amount, pot_vault.amount)` |

### 3.3 Invariants (test targets)

1. Principal exit never requires the backend: any lock is claimable (if attested) or
   force-returnable (90d after last heartbeat) with no authority signature.
2. `pot_vault.amount ≥ Σ window accounting` at all times (funding atomic with accounting).
3. `current_tvl` conservation: Σ open lock principals == `current_tvl`.
4. Pause never traps funds.
5. Double-claim / double-return impossible (account closed; receipts for pot payouts).
6. A compromised authority key can: attest generously, pause deposits, distribute the pot to
   wrong recipients (bounded by pot balance). It can NOT: touch principal, block exits, or
   exceed caps. This bounded-blast-radius property is the design's core safety claim.

### 3.4 Kamino integration notes

- Mainnet: klend main market USDC reserve (`7u3He…5PfF` per existing config).
- No devnet klend → all pre-mainnet testing on **surfpool mainnet fork** (existing
  `kamino_surfpool` profile rig).
- Position value read = ctoken_amount × exchange rate (backend RPC read, cached ~60s) —
  powers the live dashboard number; no tx needed.
- Failure mode: Kamino reserve illiquid/paused at redeem → claim/force_return fails loudly,
  retryable; no partial state (single atomic ix). Disclosed as pass-through risk.

## 4. Backend changes (`backend/`)

**Deleted:** ichor columns/awards/shop, brewery claim endpoint + treasury USDC yield payout
(`transferUsdcAtomic` yield path — the insolvency blocker), simulated harvest recording +
`fixed_apy_dev` as prod default, fuel counters/feeding endpoints, gauntlet columns/counters,
duration presets, `record_redirect` publisher, `?? DEPLOYER_PRIVATE_KEY` fallbacks, all
`includes('devnet')` guards.

**Changed/new:**
- Miss/lapse engine: shields regen +1/lesson-day (cap 3); shield-covered day pauses streak
  (fixes the known saver/streak bug by design); unprotected miss = lapse event (consecutive
  dark days coalesce); lapse count → `user_yield_bps` {0→10000, 1→5000, 2+→0}.
- Completion watcher: all lessons passed → queue `attest_completion` (idempotent, retried).
- Heartbeat crank: weekly batch bump for active locks.
- Force-return crank: daily scan, fire sponsored `force_return` for eligible locks.
- Position reader: per-lock live value endpoint (ctoken × exchange rate, cached).
- Fee-payer service: co-sign deposit/claim for embedded wallets; per-wallet rate limit.
- Pot cycle: monthly close + distribute cranks (weights = principal × streak from DB snapshot).
- Boot guards: `CLUSTER` enum + genesis-hash check; secrets entropy floor; distinct-key check.
- Practice mode: completed course → content replay allowed, no XP/streak/shield writes.

**DB migrations:** drop ichor/fuel/gauntlet columns; add lapse_count, shield regen fields,
heartbeat bookkeeping, attestation queue. Ship 0038+0039 (already pending) plus new 0040+.

## 5. Frontend changes (`web-app/`)

- Dashboard: course-card layout (B) — per card: live position value (ticking), flame gauge,
  shields (🛡×N), streak, progress bar, next-lesson CTA, CLAIM button when attested,
  capacity-aware deposit CTA. Modals: shields, pot, history.
- CLAIM flow (new — unlock UI currently has ZERO call sites): build+sign claim tx, success
  screen with yield breakdown (kept vs forfeited-to-pot).
- Deposit flow: no duration picker; $10–50 amount; capacity meter ($X/$1,000 locked);
  Privy funding + guide modal for empty wallets.
- Flame states: blazing/flickering(+countdown banner "🛡2 left — flame dies in N days")/
  dark(−50% shown)/extinguished(−100% shown). Push-notification hooks on shield burns.
- Copy purge: VillageTour ichor→USDC claims, coin pouches, card on-ramp promises, tutorial
  yield copy → new one-liners: "Mistakes are free — quitting for a day is not." /
  "Exits: finish the course, or stop for 90 days."
- Pages: alchemy + inventory + shop deleted (→ modals); village = hub (no /menu); leaderboard
  ranks by current streak; practice-mode badge on completed courses.
- Cluster: `CLUSTER` from `NEXT_PUBLIC_SOLANA_CLUSTER` (kill the hardcode), devnet faucet UI
  hidden on mainnet.

## 6. Ops, safety, incident playbook

- **Keys:** upgrade authority generated offline, stored cold (paper + hardware), never in env.
  Attestor/pot authority = hot key on Render, low-power by design (see invariant 6). Deployer
  separate. Key ceremony documented in HANDOFF v2.
- **Budget:** ~2–5 SOL program deploy rent + fee-payer float (~0.5 SOL) — the only capital
  requirement.
- **Monitoring:** Sentry (frontend+backend) free tier; alerts on /health fail, crank
  non-execution, 5xx spike, outflow anomaly (any tx moving > $100 from pot).
- **Incident playbook (pre-written):** (1) `set_pause` — deposits stop, exits keep working;
  (2) status post in app + socials within 1h; (3) assess: if platform bug lost user funds ≤
  caps → reimburse 100% from personal funds; if Kamino systemic event → pass-through,
  communicate; (4) post-mortem public within 72h; (5) unpause only with fix + regression test.
- **Cap ladder (roadmap):** beta $50/$1k → post-audit $100–500/lock + per-course
  difficulty-scaled caps (courseLockPolicy already supports) → mature $1k+ expert tiers.
  Audit is the gate for every raise.
- **Disclosures page:** unaudited beta, caps, exits, Kamino risk, authority powers + limits.

## 7. Testing

- **Surfpool mainnet-fork suite (primary):** lock→Kamino deposit; claim at bps 10000/5000/0
  with pot funding assertions; force_return after heartbeat gap (incl. permissionless caller);
  double-claim/double-return rejection; caps (min/max/global/counter conservation); pause
  semantics (exits unblocked); init gating (front-run rejected); pot close/distribute floors;
  Kamino redeem-failure path.
- **DB integration tests:** shield regen/burn/pause-streak transitions; lapse coalescing;
  one-mercy bps mapping; completion detection; practice-mode no-op writes; heartbeat
  eligibility; monthly pot weights.
- **E2E on fork:** deposit → learn → miss patterns → attest → claim, full wallet flow.
- **Boot guards:** CLUSTER/genesis mismatch refuses to start; identical keys refuse to start.

## 8. Four-week plan

- **W1 — Program v2 on surfpool:** Kamino CPI lock/claim/force_return, heartbeat, caps,
  pause, gated init, attestation; fork test suite green.
- **W2 — Backend surgery:** deletions (ichor/fuel/gauntlet/simulated yield), lapse+shield
  engine, completion watcher, cranks, fee-payer, position reads, boot guards, migrations,
  DB tests.
- **W3 — Frontend:** course cards, claim flow, flame gauge, modals, copy purge, cluster fix,
  Privy funding, practice mode; E2E on fork; +2–3 new courses authored (parallel).
- **W4 — Launch:** key ceremony, mainnet deploy + init + caps, monitoring, disclosures page,
  staged beta (own deposits first), then open; submission/marketing material.

## 9. Post-beta roadmap (not this month)

Professional audit → cap raises + difficulty-scaled stakes; Squads multisig for upgrade + pot
authority; merkle-committed pot eligibility proofs in `distribute_window`; tier-recovery
mechanic (clean streak steps penalty back down); saver-earn variants; demo course / free
preview funnel; card on-ramp beyond Privy defaults; migration runner + IaC completion.

## 10. Known accepted risks (disclosed, not hidden)

1. Unaudited custody code holding ≤ $1k total — mitigated by caps, tests, pause, playbook.
2. Single hot authority key (no multisig yet) — bounded by invariant 6; multisig on roadmap.
3. Kamino pass-through risk (reserve illiquidity/exploit) — disclosed; principal exposure is
   real.
4. Authority can attest/pot-distribute wrongly — bounded by pot balance + caps; visible
   on-chain.
5. Active-but-never-finishing users stay locked while active — disclosed at deposit ("exits:
   finish, or stop for 90 days").
6. Model A retroactivity: a lapse taxes yield earned before it — accepted for simplicity;
   softened by one-mercy + easy shield regen (only 4+ consecutive dark days ever lapse).
