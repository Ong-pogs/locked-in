# Locked In Program v2 (Kamino CPI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite `programs/locked_in` so locked USDC earns real Kamino yield, settlement is completion-gated with lapse penalties, quitters auto-return after 90d inactivity, and total exposure is hard-capped on-chain.

**Architecture:** Anchor program, two modules (`vault`, `pot`). Vault gains Kamino klend CPI (deposit at lock, redeem at settlement), a heartbeat-based exit clock, one-shot completion attestation, and cap/pause config. Pot keeps v1 payout rails; funding+accounting move inside settlement instructions. All Kamino interaction isolated in one `kamino.rs` wrapper module.

**Tech Stack:** Rust / Anchor 0.31.1, anchor-spl, Kamino klend (mainnet program `KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD`), surfpool mainnet fork for tests, TypeScript test harness (`programs-tests/`, vitest + @solana/web3.js).

## Global Constraints

- Program ID: NEW keypair for mainnet; devnet keeps `3RC9XkPZNSgXksp9Fb7J4LE7cQNYUUQdxkaaQnz6kBav` as staging (spec §3).
- USDC 6 decimals. `min_principal = 10_000_000`, `max_principal_per_lock = 50_000_000`, `global_tvl_cap = 1_000_000_000` (spec §2#14).
- `platform_fee_bps = 0` in beta; hard max `2000` enforced in-program (spec §2#15).
- `user_yield_bps ∈ {10000, 5000, 0}` only (spec §2#6).
- Inactivity window: `FORCE_RETURN_AFTER_SECS = 7_776_000` (90 days) (spec §2#11).
- `claim` and `force_return` must NEVER be blocked by pause (spec §3.3 inv. 4).
- Fee (when nonzero) comes from yield only, never principal (spec §2#15).
- `overflow-checks = true` stays on; all money math checked (existing repo rule).
- Existing v1 instructions `record_redirect`, legacy `unlock_funds` are DELETED (mainnet program is fresh; devnet unaffected).
- Every §3.3 invariant in the spec must map to at least one test in Task 10's matrix.

---

### Task 0: Surfpool test rig + klend account-map fixture

Kamino has no devnet deployment and its CPIs need ~12 live accounts (market, reserve, vault ATAs, mint authorities). We do NOT hand-write those addresses: we derive them from the official `@kamino-finance/klend-sdk` against a surfpool mainnet fork and snapshot them into a fixture consumed by all later tests.

**Files:**
- Create: `programs-tests/surfpool.config.json`
- Create: `programs-tests/scripts/derive-klend-accounts.mts`
- Create: `programs-tests/fixtures/klend-usdc-accounts.json`
- Modify: `programs-tests/package.json` (scripts)
- Test: this task's deliverable IS test infrastructure; verified by the script emitting a valid fixture

**Interfaces:**
- Produces: `fixtures/klend-usdc-accounts.json` with shape:
```json
{
  "klendProgram": "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD",
  "lendingMarket": "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF",
  "lendingMarketAuthority": "<derived>",
  "reserve": "<usdc reserve>",
  "reserveLiquiditySupply": "<derived>",
  "reserveCollateralMint": "<cUSDC mint>",
  "usdcMint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
}
```
- Produces: npm scripts `surfpool:start`, `fixtures:klend` used by every later task's test run.

- [ ] **Step 1: Add surfpool start script + config**

`programs-tests/surfpool.config.json`:
```json
{ "rpcUrl": "https://api.mainnet-beta.solana.com", "port": 8899, "clonePrograms": ["KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD"] }
```
`programs-tests/package.json` scripts:
```json
"surfpool:start": "surfpool start --config surfpool.config.json",
"fixtures:klend": "tsx scripts/derive-klend-accounts.mts"
```

- [ ] **Step 2: Write the derivation script**

`programs-tests/scripts/derive-klend-accounts.mts`:
```ts
import { Connection, PublicKey } from '@solana/web3.js';
import { KaminoMarket, DEFAULT_RECENT_SLOT_DURATION_MS, PROGRAM_ID } from '@kamino-finance/klend-sdk';
import { writeFileSync } from 'fs';

const RPC = process.env.SURFPOOL_RPC ?? 'http://127.0.0.1:8899';
const MAIN_MARKET = new PublicKey('7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF');

const conn = new Connection(RPC, 'confirmed');
const market = await KaminoMarket.load(conn, MAIN_MARKET, DEFAULT_RECENT_SLOT_DURATION_MS, PROGRAM_ID, true);
if (!market) throw new Error('market load failed — is surfpool running?');
const reserve = market.getReserveBySymbol('USDC');
if (!reserve) throw new Error('USDC reserve not found');

const fixture = {
  klendProgram: PROGRAM_ID.toBase58(),
  lendingMarket: MAIN_MARKET.toBase58(),
  lendingMarketAuthority: market.getLendingMarketAuthority().toBase58(),
  reserve: reserve.address.toBase58(),
  reserveLiquiditySupply: reserve.state.liquidity.supplyVault.toBase58(),
  reserveCollateralMint: reserve.state.collateral.mintPubkey.toBase58(),
  usdcMint: reserve.getLiquidityMint().toBase58(),
};
writeFileSync(new URL('../fixtures/klend-usdc-accounts.json', import.meta.url), JSON.stringify(fixture, null, 2));
console.log('fixture written', fixture);
```

- [ ] **Step 3: Run and verify**

Run: `npm run surfpool:start` (separate terminal), then `npm run fixtures:klend`
Expected: `fixture written { klendProgram: 'KLend2…', … }` and file exists with all 7 keys non-empty.

- [ ] **Step 4: Commit**

```bash
git add programs-tests/surfpool.config.json programs-tests/scripts/derive-klend-accounts.mts programs-tests/fixtures/klend-usdc-accounts.json programs-tests/package.json
git commit -m "test(rig): surfpool fork config + klend USDC account fixture derivation"
```

---

### Task 1: New state — VaultConfig v2 + LockAccount v2 (pure Rust unit tests)

**Files:**
- Modify: `programs/locked_in/src/vault.rs` (state section)
- Test: co-located `#[cfg(test)]` in `vault.rs`

**Interfaces:**
- Produces (consumed by every later task):
```rust
pub struct VaultConfig { pub authority: Pubkey, pub usdc_mint: Pubkey,
  pub kamino_market: Pubkey, pub kamino_reserve: Pubkey,
  pub min_principal: u64, pub max_principal_per_lock: u64,
  pub global_tvl_cap: u64, pub current_tvl: u64,
  pub platform_fee_bps: u16, pub paused: bool, pub bump: u8 }
pub struct LockAccount { pub owner: Pubkey, pub course_id_hash: [u8;32],
  pub stable_mint: Pubkey, pub principal_amount: u64, pub ctoken_amount: u64,
  pub lock_start_ts: i64, pub last_heartbeat_ts: i64,
  pub completion_attested: bool, pub user_yield_bps: u16,
  pub status: u8, pub bump: u8 }
pub const MAX_PLATFORM_FEE_BPS: u16 = 2000;
pub const FORCE_RETURN_AFTER_SECS: i64 = 7_776_000;
pub const VALID_YIELD_BPS: [u16; 3] = [10000, 5000, 0];
impl VaultConfig {
  pub fn assert_lock_allowed(&self, amount: u64) -> Result<()>;   // paused/min/max/cap
  pub fn tvl_add(&mut self, amount: u64) -> Result<()>;
  pub fn tvl_sub(&mut self, amount: u64) -> Result<()>;
}
impl LockAccount {
  pub fn assert_claimable(&self) -> Result<()>;                   // attested && ACTIVE
  pub fn assert_force_returnable(&self, now: i64) -> Result<()>;  // !attested && ACTIVE && now >= hb+90d
  pub fn settle_amounts(&self, redeemed: u64, fee_bps: u16) -> SettleAmounts;
}
pub struct SettleAmounts { pub to_owner: u64, pub to_pot: u64, pub fee: u64 }
```
- `settle_amounts` math (invariant 7 lives here): `yield = redeemed.saturating_sub(principal)`; `fee = yield * fee_bps / 10000`; `user_yield = (yield - fee) * user_yield_bps / 10000`; `to_owner = min(redeemed, principal) + user_yield`; `to_pot = yield - fee - user_yield`. If `redeemed < principal`: `to_owner = redeemed`, `to_pot = 0`, `fee = 0`.

- [ ] **Step 1: Write failing unit tests** (in `vault.rs` `#[cfg(test)]`)

```rust
#[test]
fn settle_full_yield_no_lapse() {
    let lock = test_lock(50_000_000, 10000);           // $50, bps 10000
    let s = lock.settle_amounts(51_200_000, 0);        // +$1.20 yield, no fee
    assert_eq!(s.to_owner, 51_200_000); assert_eq!(s.to_pot, 0); assert_eq!(s.fee, 0);
}
#[test]
fn settle_one_mercy_half_to_pot() {
    let lock = test_lock(50_000_000, 5000);
    let s = lock.settle_amounts(51_200_000, 0);
    assert_eq!(s.to_owner, 50_600_000); assert_eq!(s.to_pot, 600_000);
}
#[test]
fn settle_two_lapses_all_yield_to_pot() {
    let lock = test_lock(50_000_000, 0);
    let s = lock.settle_amounts(51_200_000, 0);
    assert_eq!(s.to_owner, 50_000_000); assert_eq!(s.to_pot, 1_200_000);
}
#[test]
fn settle_negative_yield_passthrough() {              // invariant 7
    let lock = test_lock(50_000_000, 10000);
    let s = lock.settle_amounts(49_000_000, 500);
    assert_eq!(s.to_owner, 49_000_000); assert_eq!(s.to_pot, 0); assert_eq!(s.fee, 0);
}
#[test]
fn settle_fee_comes_from_yield_only() {
    let lock = test_lock(50_000_000, 10000);
    let s = lock.settle_amounts(51_000_000, 1000);     // 10% fee on $1 yield
    assert_eq!(s.fee, 100_000);
    assert_eq!(s.to_owner, 50_900_000); assert_eq!(s.to_pot, 0);
}
#[test]
fn tvl_cap_enforced_and_conserved() {
    let mut cfg = test_config();                       // cap 1_000_000_000
    cfg.current_tvl = 990_000_000;
    assert!(cfg.assert_lock_allowed(10_000_000).is_ok());
    assert!(cfg.assert_lock_allowed(10_000_001).is_err());
    cfg.tvl_add(10_000_000).unwrap(); cfg.tvl_sub(10_000_000).unwrap();
    assert_eq!(cfg.current_tvl, 990_000_000);
}
#[test]
fn force_return_window() {
    let mut lock = test_lock(50_000_000, 10000);
    lock.completion_attested = false; lock.last_heartbeat_ts = 1_000;
    assert!(lock.assert_force_returnable(1_000 + 7_776_000 - 1).is_err());
    assert!(lock.assert_force_returnable(1_000 + 7_776_000).is_ok());
    lock.completion_attested = true;
    assert!(lock.assert_force_returnable(i64::MAX).is_err());  // attested never force-returned
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cargo test -p locked_in settle_ 2>&1 | tail -5`
Expected: compile errors (types/methods not defined).

- [ ] **Step 3: Implement state structs + helpers exactly per the Interfaces block** (checked math via `checked_add/checked_sub/checked_mul/checked_div`, errors added to `LockVaultError`: `VaultPaused`, `BelowMinPrincipal`, `AboveMaxPrincipal`, `GlobalTvlCapExceeded`, `NotAttested`, `AlreadyAttested`, `InvalidYieldBps`, `FeeAboveHardMax`, `NotForceReturnable`, `LockNotActive`)

- [ ] **Step 4: Run tests to verify pass**

Run: `cargo test -p locked_in 2>&1 | tail -5` → all green incl. existing v1 unit tests that still compile.

- [ ] **Step 5: Commit**

```bash
git add programs/locked_in/src/vault.rs
git commit -m "feat(program): v2 vault state — caps, heartbeat, attestation, settlement math"
```

---

### Task 2: kamino.rs CPI wrapper module

**Files:**
- Create: `programs/locked_in/src/kamino.rs`
- Modify: `programs/locked_in/src/lib.rs` (mod decl)
- Modify: `programs/locked_in/Cargo.toml` (no new deps — CPI built with raw `solana_program::instruction::Instruction`; klend account order documented from Task 0 fixture + klend IDL)

**Interfaces:**
- Produces:
```rust
pub fn deposit_reserve_liquidity<'info>(accts: KaminoDepositAccounts<'_, 'info>, liquidity_amount: u64, signer_seeds: &[&[&[u8]]]) -> Result<()>;
pub fn redeem_reserve_collateral<'info>(accts: KaminoRedeemAccounts<'_, 'info>, collateral_amount: u64, signer_seeds: &[&[&[u8]]]) -> Result<()>;
// Account structs carry: klend_program, lending_market, lending_market_authority,
// reserve, reserve_liquidity_supply, reserve_collateral_mint,
// user_source/destination_liquidity, user_destination/source_collateral,
// owner (the lock PDA), token_program, sysvar_instructions
```
- Instruction data: anchor discriminators `sha256("global:deposit_reserve_liquidity")[..8]` / `sha256("global:redeem_reserve_collateral")[..8]` + `u64` LE amount (same scheme backend already uses in `communityPot.mjs`).
- NOTE for implementer: exact account ORDER must be copied from the klend IDL (`@kamino-finance/klend-sdk` `.json` idl, instructions `depositReserveLiquidity` / `redeemReserveCollateral`). Task 4's fork test is the ground truth — if order is wrong the CPI fails there, fix here.

- [ ] **Step 1:** Write the module with both builders returning `Instruction` + `invoke_signed` wrappers (no test yet — exercised by Task 4's fork test; unit test only the discriminator bytes):
```rust
#[test]
fn discriminators_match_anchor_scheme() {
    assert_eq!(deposit_discriminator(), [169, 201, 30, 126, 6, 205, 102, 68]);
}
```
(compute expected bytes once via `sha256`, pin them)

- [ ] **Step 2:** `cargo test -p locked_in discriminators` → PASS; `cargo build-sbf` (or `anchor build -p locked_in`) compiles.

- [ ] **Step 3: Commit** — `git commit -m "feat(program): kamino CPI wrapper (deposit/redeem reserve liquidity)"`

---

### Task 3: initialize_vault v2 with upgrade-authority gating

**Files:**
- Modify: `programs/locked_in/src/vault.rs` (InitializeVault accounts + handler)
- Test: `programs-tests/tests/v2-init.test.ts`

**Interfaces:**
- Consumes: Task 1 state.
- Produces: `initialize_vault(params: InitVaultParams)` where
```rust
pub struct InitVaultParams { pub usdc_mint: Pubkey, pub kamino_market: Pubkey,
  pub kamino_reserve: Pubkey, pub min_principal: u64, pub max_principal_per_lock: u64,
  pub global_tvl_cap: u64, pub platform_fee_bps: u16 }
```
Accounts add: `program_data: Account<'info, ProgramData>` with constraints
`program.programdata_address()? == Some(program_data.key())` and
`program_data.upgrade_authority_address == Some(payer.key())` (`payer` = signer);
plus `authority: Pubkey` param for the ops key stored in config. `initialize_pot` gets the
identical gate.

- [ ] **Step 1: Failing fork test** (`v2-init.test.ts`): random keypair calls `initialize_vault` → expect custom error `UnauthorizedInitializer`; upgrade-authority keypair (the test deployer) succeeds; second init fails (account exists); `platform_fee_bps: 2001` → `FeeAboveHardMax`.
- [ ] **Step 2:** Run: `npx vitest run tests/v2-init.test.ts` → FAIL (ix doesn't exist yet under new shape).
- [ ] **Step 3:** Implement accounts struct + handler (validate mint nonzero — reuse `validate_supported_mints`; validate fee ≤ MAX; store all params; `current_tvl = 0`).
- [ ] **Step 4:** Test → PASS (requires surfpool up + program deployed via `anchor deploy --provider.cluster http://127.0.0.1:8899`).
- [ ] **Step 5: Commit** — `git commit -m "feat(program): gated initialize_vault/initialize_pot v2 with caps + kamino pins"`

---

### Task 4: lock_funds v2 — escrow + Kamino deposit + caps

**Files:**
- Modify: `programs/locked_in/src/vault.rs` (LockFunds accounts + handler; drop `lock_duration_days` arg + validation)
- Test: `programs-tests/tests/v2-lock.test.ts`

**Interfaces:**
- Consumes: Task 1 `assert_lock_allowed`/`tvl_add`, Task 2 `deposit_reserve_liquidity`, Task 0 fixture.
- Produces: `lock_funds(course_id_hash: [u8;32], stable_amount: u64)`; LockAccount initialized with `ctoken_amount` = cToken balance delta of the lock's collateral ATA (read before/after CPI), `last_heartbeat_ts = clock.now`.

- [ ] **Step 1: Failing fork test:** fund a user with USDC on the fork (surfpool `setAccount` token helper or transfer from a whale account); call `lock_funds($25)`; assert: user USDC −25e6; lock's cToken ATA > 0; `config.current_tvl == 25e6`; lock fields (owner, principal, heartbeat≈now, attested=false, bps=0). Negative cases: $5 → `BelowMinPrincipal`; $60 → `AboveMaxPrincipal`; pause set (via Task 7 stub or direct account write) → `VaultPaused`; 21st lock pushing past cap → `GlobalTvlCapExceeded`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement: USDC owner→lock's liquidity ATA; CPI deposit (signer = lock PDA seeds); record ctoken delta; tvl_add; emit `LockCreated{principal, ctoken_amount}`.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(program): lock_funds v2 — caps + kamino deposit CPI"`

---

### Task 5: heartbeat + attest_completion

**Files:**
- Modify: `programs/locked_in/src/vault.rs`
- Test: `programs-tests/tests/v2-heartbeat-attest.test.ts`

**Interfaces:**
- Produces: `heartbeat()` (per-lock ix; batching = multiple ix per tx client-side; accounts: config `has_one authority`, lock mut, authority signer; sets `last_heartbeat_ts = clock.now`); `attest_completion(user_yield_bps: u16)` (require `!attested`, bps ∈ {10000,5000,0}; sets flag+bps; emits `CompletionAttested`).

- [ ] **Step 1: Failing test:** non-authority heartbeat → `UnauthorizedWorker`; authority heartbeat updates ts; attest with 7000 → `InvalidYieldBps`; attest 5000 ok; second attest → `AlreadyAttested`; heartbeat still allowed after attest (harmless).
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(program): heartbeat + one-shot completion attestation"`

---

### Task 6: claim — redeem, split, fund pot (the money instruction)

**Files:**
- Modify: `programs/locked_in/src/vault.rs` (Claim accounts + handler)
- Modify: `programs/locked_in/src/pot.rs` (pub window-accounting helper `credit_window(window, amount, now)` extracted from record_redirect body)
- Test: `programs-tests/tests/v2-claim.test.ts`

**Interfaces:**
- Consumes: Task 1 `assert_claimable`/`settle_amounts`, Task 2 redeem, pot `credit_window`.
- Produces: `claim()` accounts: config(mut), lock(mut, `has_one owner`, close=owner), owner(signer), lock ctoken ATA + liquidity ATA, owner USDC ATA (init_if_needed), pot_config, pot window (init_if_needed, current YYYYMM passed as arg `window_id: i64`), pot_vault ATA (init_if_needed, authority=pot_config), kamino account set, token programs. Flow: redeem full `ctoken_amount` → liquidity ATA; compute `SettleAmounts`; transfer to_owner → owner; to_pot → pot_vault + `credit_window`; fee stays 0 in beta (fee>0 path still implemented + tested); `tvl_sub(principal)`; close ATAs + lock (rent→owner). Works while paused.

- [ ] **Step 1: Failing fork test matrix:**
  - attested bps=10000 → owner receives ≥ principal (yield ≥ 0 on fork), pot_vault delta 0
  - bps=5000 → pot_vault delta == owner-yield delta (±1 rounding), window.total_redirected == pot delta
  - bps=0 → all yield to pot
  - unattested claim → `NotAttested`
  - double claim → account-closed failure
  - paused=true → claim still succeeds
  - `current_tvl` returns to pre-lock value
  - (yield>0 on fork: advance fork time/slots via surfpool `timeTravel`/`warp`; if unavailable, deposit a whale borrow to push utilization — implementer picks; assert with tolerance)
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(program): claim — kamino redeem + one-mercy split + atomic pot funding"`

---

### Task 7: force_return (permissionless) + set_caps/set_pause

**Files:**
- Modify: `programs/locked_in/src/vault.rs`
- Test: `programs-tests/tests/v2-force-return.test.ts`

**Interfaces:**
- Produces: `force_return()` — accounts like claim but signer = ANY `payer: Signer` (not owner, not authority); owner is `UncheckedAccount` validated `lock.owner == owner.key()`; all funds routed: principal→owner ATA (init_if_needed payer=caller), ALL yield−fee→pot; requires `assert_force_returnable(now)`. `set_caps(min,max,global,fee_bps)` + `set_pause(flag)` authority-gated; fee hard max; caps don't touch existing locks.

- [ ] **Step 1: Failing test:** lock unattested; force_return before 90d → `NotForceReturnable`; warp +90d (surfpool time travel — same mechanism as Task 6): random third-party keypair calls force_return → owner USDC == principal, pot gets all yield, tvl decremented, lock closed; attested lock never force-returnable even at +1000d; paused=true → force_return still works; set_caps by non-authority → `UnauthorizedWorker`; set_caps fee 2001 → `FeeAboveHardMax`; lower cap below current_tvl → existing locks unaffected, new lock rejected.
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(program): permissionless force_return + caps/pause admin"`

---

### Task 8: pot v2 trims — retire record_redirect, double-floor distribute

**Files:**
- Modify: `programs/locked_in/src/pot.rs`, `programs/locked_in/src/lib.rs`
- Test: `programs-tests/tests/v2-pot.test.ts`

**Interfaces:**
- Removes `record_redirect` from `#[program]` (keep `credit_window` helper). `distribute_window` gains constraint: `amount ≤ min(distribution_window.remaining_amount(), pot_vault.amount)` → else `InsufficientPotBalance`. `close_distribution_window` unchanged.

- [ ] **Step 1: Failing test:** fund pot via a Task 6 claim; close window; distribute more than pot_vault holds → `InsufficientPotBalance`; distribute valid amount → recipient delta + receipt; double distribute same recipient → no-op/receipt exists; `record_redirect` ix absent from IDL.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(program): pot v2 — settlement-funded only, double-floored payouts"`

---

### Task 9: delete legacy unlock_funds + lib.rs surface cleanup

**Files:**
- Modify: `programs/locked_in/src/lib.rs`, `programs/locked_in/src/vault.rs`
- Test: existing suites re-run

- [ ] **Step 1:** Remove `unlock_funds`, `lock_duration_days` validation, dead `VaultConfig.authority`-unused comment (authority now used). Update module docs to v2 semantics.
- [ ] **Step 2:** `cargo test -p locked_in && anchor build -p locked_in` clean; grep IDL for `unlockFunds` → absent.
- [ ] **Step 3: Commit** — `git commit -m "refactor(program): remove v1 unlock path; v2 surface final"`

---

### Task 10: invariant test matrix (spec §3.3 → tests, gate for phase exit)

**Files:**
- Create: `programs-tests/tests/v2-invariants.test.ts`
- Create: `docs/superpowers/plans/artifacts/invariant-map.md`

- [ ] **Step 1:** Write `invariant-map.md`: table spec-invariant → test file::name (all 7). Any invariant without an existing test gets one here: notably **inv 1** (exit-without-backend: kill all authority usage, assert claim + force_return still succeed), **inv 3** (TVL conservation across lock/claim/force_return interleavings ×5 locks), **inv 6** (authority-compromise bound: authority CANNOT move principal — attempt principal-touching flows with authority signer, expect constraint failures).
- [ ] **Step 2:** Run full suite: `npm run surfpool:start` + `npx vitest run` → all green.
- [ ] **Step 3: Commit** — `git commit -m "test(program): full §3.3 invariant matrix green on mainnet fork"`

---

## Self-review (done at authoring)
- Spec coverage: §3.1→T1, §3.2 rows→T3–T8, §3.3→T10 map, §3.4→T0/T4/T6. Gaps: none in program scope; backend/frontend/ops = plans 2–4.
- Placeholders: Task 2 delegates exact klend account ORDER to the IDL + Task 4 ground truth — explicit, testable, not a TBD.
- Type consistency: `SettleAmounts`, bps set, `FORCE_RETURN_AFTER_SECS` used identically across tasks.
