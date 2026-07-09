# Locked In Program v2 (Kamino CPI) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite `programs/locked_in` so locked USDC earns real Kamino yield, settlement is voucher-gated with one-mercy lapse penalties, abandoned locks are returned permissionlessly after 180 days, forfeits atomically fund a distributing community pot, and total exposure is capped on-chain.

**Architecture:** Anchor program with three modules — `vault` (custody, caps, settlement), `pot` (windows, distribution), `voucher` (Ed25519 precompile verification). All Kamino interaction is isolated in `kamino.rs`. Nothing about a lock's exit depends on the authority: `claim` needs only an owner signature plus a voucher, and `force_return` is permissionless after a deadline no instruction can move.

**Tech Stack:** Rust / Anchor 0.31.1, anchor-spl, Kamino klend (mainnet program `KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD`), surfpool mainnet fork, TypeScript harness in `programs-tests/` (vitest + @solana/web3.js).

**Spec:** `docs/superpowers/specs/2026-07-09-v2-kamino-mainnet-design.md` (rev 3). Every §3.5 invariant must map to a test in Task 11.

## Global Constraints

- New program keypair for mainnet; devnet `3RC9XkPZNSgXksp9Fb7J4LE7cQNYUUQdxkaaQnz6kBav` stays staging.
- USDC has 6 decimals. `min_principal = 10_000_000`; `max_principal_per_lock = 50_000_000`; `global_tvl_cap = 1_000_000_000`.
- `MAX_PLATFORM_FEE_BPS = 2000`; `platform_fee_bps = 0` in beta. Fee comes from yield only, never principal.
- `VALID_YIELD_BPS = [10000, 5000, 0]` — reject anything else.
- `FORCE_RETURN_AFTER_SECS: i64 = 15_552_000` (180 days), measured from `lock_start_ts`, which no instruction may modify.
- `claim` and `force_return` must NEVER check `paused` (spec §3.5.4).
- **Never** redeem a stored collateral amount, and **never** pay out a computed delta: redeem the live collateral-ATA balance and pay out the full liquidity-ATA balance, so both reach zero before `close_account` (spec §3.5.8).
- Every klend CPI asserts `klend_program.key() == KLEND_PROGRAM_ID` (a `const`) and constrains reserve / market / collateral mint with `address = config.*`.
- `refresh_reserve` is prepended **client-side** to every transaction containing a klend deposit or redeem. The program does not CPI it.
- `overflow-checks = true` stays on. All money math uses `checked_*`.
- Deleted from v1: `unlock_funds`, `record_redirect`. Never introduced: `heartbeat`, `attest_completion`.

---

### Task 0: Surfpool rig + klend account fixture

Kamino has no devnet deployment and its CPI account order is easy to get wrong (deposit and redeem swap `reserve`/`lendingMarket`). Derive the addresses from the installed SDK against a mainnet fork rather than hand-copying them.

**Files:**
- Create: `programs-tests/surfpool.config.json`
- Create: `programs-tests/scripts/derive-klend-accounts.mts`
- Create: `programs-tests/fixtures/klend-usdc-accounts.json`
- Modify: `programs-tests/package.json`

**Interfaces:**
- Produces `fixtures/klend-usdc-accounts.json`:
```json
{
  "klendProgram": "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD",
  "lendingMarket": "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF",
  "lendingMarketAuthority": "...", "reserve": "...",
  "reserveLiquiditySupply": "...", "reserveCollateralMint": "...",
  "usdcMint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "refreshReserveAccounts": { "pythOracle": "...", "switchboardPriceOracle": "...", "switchboardTwapOracle": "...", "scopePrices": "..." }
}
```
- Produces npm scripts `surfpool:start`, `fixtures:klend`.
- **Account order is authoritative and differs per instruction.** From the klend IDL (`@kamino-finance/klend-sdk/src/idl/klend.json`), verified:
  - `depositReserveLiquidity`: `owner, reserve, lendingMarket, lendingMarketAuthority, reserveLiquidityMint, reserveLiquiditySupply, reserveCollateralMint, userSourceLiquidity, userDestinationCollateral, collateralTokenProgram, liquidityTokenProgram, instructionSysvarAccount`
  - `redeemReserveCollateral`: `owner, lendingMarket, reserve, lendingMarketAuthority, reserveLiquidityMint, reserveCollateralMint, reserveLiquiditySupply, userSourceCollateral, userDestinationLiquidity, collateralTokenProgram, liquidityTokenProgram, instructionSysvarAccount`
  - `refreshReserve`: `reserve, lendingMarket, pythOracle, switchboardPriceOracle, switchboardTwapOracle, scopePrices` (oracles may be optional; emit `null` → pass the klend program id as the `None` placeholder per klend convention)

- [ ] **Step 1: Add surfpool config + scripts**

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
const s = reserve.state;

const fixture = {
  klendProgram: PROGRAM_ID.toBase58(),
  lendingMarket: MAIN_MARKET.toBase58(),
  lendingMarketAuthority: market.getLendingMarketAuthority().toBase58(),
  reserve: reserve.address.toBase58(),
  reserveLiquiditySupply: s.liquidity.supplyVault.toBase58(),
  reserveCollateralMint: s.collateral.mintPubkey.toBase58(),
  usdcMint: reserve.getLiquidityMint().toBase58(),
  refreshReserveAccounts: {
    pythOracle: s.config.tokenInfo.pythConfiguration.price.toBase58(),
    switchboardPriceOracle: s.config.tokenInfo.switchboardConfiguration.priceAggregator.toBase58(),
    switchboardTwapOracle: s.config.tokenInfo.switchboardConfiguration.twapAggregator.toBase58(),
    scopePrices: s.config.tokenInfo.scopeConfiguration.priceFeed.toBase58(),
  },
};
writeFileSync(new URL('../fixtures/klend-usdc-accounts.json', import.meta.url), JSON.stringify(fixture, null, 2));
console.log('fixture written', fixture);
```

- [ ] **Step 3: Run and verify**

Run: `npm run surfpool:start` (separate terminal), then `npm run fixtures:klend`
Expected: `fixture written {...}` and every key non-empty. If an oracle field is all-`1`s (`11111…`), klend treats it as `None` — record it verbatim, do not "fix" it.

- [ ] **Step 4: Commit**

```bash
git add programs-tests/surfpool.config.json programs-tests/scripts/derive-klend-accounts.mts programs-tests/fixtures/klend-usdc-accounts.json programs-tests/package.json
git commit -m "test(rig): surfpool fork config + klend USDC account fixture"
```

---

### Task 1: VaultConfig / LockAccount state + settlement math

**Files:**
- Modify: `programs/locked_in/src/vault.rs`
- Test: co-located `#[cfg(test)]` in `vault.rs`

**Interfaces (consumed by every later task):**
```rust
pub const MAX_PLATFORM_FEE_BPS: u16 = 2000;
pub const FORCE_RETURN_AFTER_SECS: i64 = 15_552_000;
pub const VALID_YIELD_BPS: [u16; 3] = [10_000, 5_000, 0];
pub const STATUS_ACTIVE: u8 = 0;
pub const STATUS_CLOSED: u8 = 2;

#[account] #[derive(InitSpace)]
pub struct VaultConfig { pub authority: Pubkey, pub usdc_mint: Pubkey,
  pub kamino_market: Pubkey, pub kamino_reserve: Pubkey, pub kamino_collateral_mint: Pubkey,
  pub fee_vault: Pubkey,   // pinned destination; unused while platform_fee_bps == 0
  pub min_principal: u64, pub max_principal_per_lock: u64, pub global_tvl_cap: u64,
  pub current_tvl: u64, pub platform_fee_bps: u16, pub paused: bool, pub bump: u8 }

#[account] #[derive(InitSpace)]
pub struct LockAccount { pub owner: Pubkey, pub course_id_hash: [u8; 32], pub stable_mint: Pubkey,
  pub kamino_reserve: Pubkey, pub principal_amount: u64, pub lock_start_ts: i64,
  pub status: u8, pub bump: u8 }

pub struct SettleAmounts { pub to_owner: u64, pub to_pot: u64, pub fee: u64 }

impl VaultConfig {
  pub fn assert_lock_allowed(&self, amount: u64) -> Result<()>;
  pub fn tvl_add(&mut self, amount: u64) -> Result<()>;
  pub fn tvl_sub(&mut self, amount: u64) -> Result<()>;
}
impl LockAccount {
  pub fn assert_active(&self) -> Result<()>;
  pub fn assert_force_returnable(&self, now: i64) -> Result<()>;
  pub fn settle(&self, redeemed: u64, user_yield_bps: u16, fee_bps: u16) -> Result<SettleAmounts>;
}
```
`settle` must satisfy `to_owner + to_pot + fee == redeemed` exactly (spec §3.4):
`gross = redeemed.saturating_sub(principal)`; `fee = gross*fee_bps/10000`;
`user_yield = (gross-fee)*user_yield_bps/10000`; `to_owner = min(redeemed, principal) + user_yield`;
`to_pot = gross - fee - user_yield`. When `redeemed < principal`: `to_owner = redeemed`, others 0.

New errors on `LockVaultError`: `VaultPaused`, `BelowMinPrincipal`, `AboveMaxPrincipal`,
`GlobalTvlCapExceeded`, `InvalidYieldBps`, `FeeAboveHardMax`, `NotForceReturnable`,
`LockNotActive`, `UnauthorizedInitializer`, `ReserveMismatch`, `NonZeroTokenBalance`.

- [ ] **Step 1: Write the failing unit tests**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    fn cfg() -> VaultConfig { VaultConfig { authority: Pubkey::new_unique(), usdc_mint: Pubkey::new_unique(),
        kamino_market: Pubkey::new_unique(), kamino_reserve: Pubkey::new_unique(),
        kamino_collateral_mint: Pubkey::new_unique(), min_principal: 10_000_000,
        max_principal_per_lock: 50_000_000, global_tvl_cap: 1_000_000_000, current_tvl: 0,
        platform_fee_bps: 0, paused: false, bump: 255 } }
    fn lock(principal: u64) -> LockAccount { LockAccount { owner: Pubkey::new_unique(),
        course_id_hash: [7u8; 32], stable_mint: Pubkey::new_unique(), kamino_reserve: Pubkey::new_unique(),
        principal_amount: principal, lock_start_ts: 1_000, status: STATUS_ACTIVE, bump: 255 } }

    #[test] fn settle_conserves_value_at_every_bps() {
        for bps in VALID_YIELD_BPS { for fee in [0u16, 1000, 2000] {
            let s = lock(50_000_000).settle(51_200_000, bps, fee).unwrap();
            assert_eq!(s.to_owner + s.to_pot + s.fee, 51_200_000, "bps={bps} fee={fee}");
        }}
    }
    #[test] fn settle_no_lapse_keeps_all_yield() {
        let s = lock(50_000_000).settle(51_200_000, 10_000, 0).unwrap();
        assert_eq!((s.to_owner, s.to_pot, s.fee), (51_200_000, 0, 0));
    }
    #[test] fn settle_one_mercy_halves_yield() {
        let s = lock(50_000_000).settle(51_200_000, 5_000, 0).unwrap();
        assert_eq!((s.to_owner, s.to_pot), (50_600_000, 600_000));
    }
    #[test] fn settle_two_lapses_forfeit_all_yield() {
        let s = lock(50_000_000).settle(51_200_000, 0, 0).unwrap();
        assert_eq!((s.to_owner, s.to_pot), (50_000_000, 1_200_000));
    }
    #[test] fn settle_negative_yield_passes_through_to_owner() {   // invariant 7
        let s = lock(50_000_000).settle(49_000_000, 10_000, 500).unwrap();
        assert_eq!((s.to_owner, s.to_pot, s.fee), (49_000_000, 0, 0));
    }
    #[test] fn settle_fee_only_touches_yield() {
        let s = lock(50_000_000).settle(51_000_000, 10_000, 1_000).unwrap();
        assert_eq!(s.fee, 100_000);
        assert_eq!(s.to_owner, 50_900_000);
    }
    #[test] fn settle_rejects_invalid_bps() {
        assert!(lock(50_000_000).settle(51_000_000, 7_000, 0).is_err());
    }
    #[test] fn settle_donation_is_split_not_stranded() {           // invariant 8
        let s = lock(50_000_000).settle(60_000_000, 0, 0).unwrap(); // 10 USDC donated
        assert_eq!(s.to_owner, 50_000_000);
        assert_eq!(s.to_pot, 10_000_000);
        assert_eq!(s.to_owner + s.to_pot + s.fee, 60_000_000);
    }
    #[test] fn caps_enforced_and_tvl_conserved() {
        let mut c = cfg(); c.current_tvl = 990_000_000;
        assert!(c.assert_lock_allowed(10_000_000).is_ok());
        assert!(c.assert_lock_allowed(10_000_001).is_err());  // cap
        assert!(c.assert_lock_allowed(9_000_000).is_err());   // below min
        assert!(c.assert_lock_allowed(60_000_000).is_err());  // above max
        c.paused = true;
        assert!(c.assert_lock_allowed(10_000_000).is_err());
        c.paused = false;
        c.tvl_add(10_000_000).unwrap(); c.tvl_sub(10_000_000).unwrap();
        assert_eq!(c.current_tvl, 990_000_000);
    }
    #[test] fn force_return_deadline_is_absolute() {   // invariant 1
        let l = lock(50_000_000);                       // lock_start_ts = 1_000
        assert!(l.assert_force_returnable(1_000 + FORCE_RETURN_AFTER_SECS - 1).is_err());
        assert!(l.assert_force_returnable(1_000 + FORCE_RETURN_AFTER_SECS).is_ok());
        let mut closed = lock(50_000_000); closed.status = STATUS_CLOSED;
        assert!(closed.assert_force_returnable(i64::MAX).is_err());
    }
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cargo test -p locked_in 2>&1 | tail -5`
Expected: compile errors — `settle` / `assert_force_returnable` not defined.

- [ ] **Step 3: Implement state + helpers exactly per the Interfaces block**, all arithmetic via `checked_add/checked_sub/checked_mul/checked_div`, `settle` returning `InvalidYieldBps` for bps ∉ `VALID_YIELD_BPS`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test -p locked_in 2>&1 | tail -5` → all green.

- [ ] **Step 5: Commit**

```bash
git add programs/locked_in/src/vault.rs
git commit -m "feat(program): v2 vault state — caps, absolute exit deadline, donation-proof settlement"
```

---

### Task 2: voucher.rs — Ed25519 precompile verification

The single most security-sensitive helper. A partial check (skipping offsets or the instruction index) lets an attacker forge a "verified" signature by crafting their own instruction data.

**Files:**
- Create: `programs/locked_in/src/voucher.rs`
- Modify: `programs/locked_in/src/lib.rs` (`mod voucher;`)
- Test: co-located `#[cfg(test)]`

**Interfaces:**
```rust
pub const ED25519_PROGRAM_ID: Pubkey = pubkey!("Ed25519SigVerify111111111111111111111111111");
pub const VOUCHER_DOMAIN: &[u8] = b"lockedin:claim:v1";

pub fn build_message(program_id: &Pubkey, lock: &Pubkey, user_yield_bps: u16, expiry: i64) -> Vec<u8>;

/// Verifies instruction 0 is an Ed25519 precompile ix signing exactly `build_message(..)`
/// with `expected_signer`. Errors otherwise.
pub fn verify_voucher(
    instructions_sysvar: &AccountInfo,
    expected_signer: &Pubkey,
    program_id: &Pubkey,
    lock: &Pubkey,
    user_yield_bps: u16,
    expiry: i64,
    now: i64,
) -> Result<()>;
```
`build_message` = `VOUCHER_DOMAIN || program_id(32) || lock(32) || bps.to_le_bytes()(2) || expiry.to_le_bytes()(8)` = 17+74 = 91 bytes.

`verify_voucher` MUST check, in order (each a distinct error):
1. `bps ∈ VALID_YIELD_BPS` → `InvalidYieldBps`
2. `now <= expiry` → `VoucherExpired`
3. `load_instruction_at_checked(0, sysvar)?.program_id == ED25519_PROGRAM_ID` → `VoucherNotEd25519`
4. `data[0] == 1 && data[1] == 0` → `VoucherBadHeader`
5. parse `Ed25519SignatureOffsets` (LE u16s at data[2..16]); require
   `signature_instruction_index == public_key_instruction_index == message_instruction_index == u16::MAX`
   → `VoucherIndirectData` (this is the forgery vector: a non-`MAX` index points at *another*
   instruction the attacker controls)
6. every offset+len is within `data.len()` → `VoucherBadOffsets`
7. `data[public_key_offset .. +32] == expected_signer` → `VoucherWrongSigner`
8. `message_data_size as usize == expected_msg.len()` and the bytes match → `VoucherWrongMessage`

New errors: `VoucherExpired`, `VoucherNotEd25519`, `VoucherBadHeader`, `VoucherIndirectData`,
`VoucherBadOffsets`, `VoucherWrongSigner`, `VoucherWrongMessage`.

- [ ] **Step 1: Write the failing unit tests** (message construction is pure; offset parsing is pure)

```rust
#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn message_is_domain_separated_and_bound() {
        let p = Pubkey::new_unique(); let l = Pubkey::new_unique();
        let m = build_message(&p, &l, 5_000, 1_800_000_000);
        assert_eq!(m.len(), 91);
        assert!(m.starts_with(VOUCHER_DOMAIN));
        assert_eq!(&m[17..49], p.as_ref());
        assert_eq!(&m[49..81], l.as_ref());
        assert_eq!(&m[81..83], &5_000u16.to_le_bytes());
        assert_eq!(&m[83..91], &1_800_000_000i64.to_le_bytes());
    }
    #[test] fn message_differs_per_lock_and_per_bps() {
        let p = Pubkey::new_unique();
        let (a, b) = (Pubkey::new_unique(), Pubkey::new_unique());
        assert_ne!(build_message(&p, &a, 10_000, 1), build_message(&p, &b, 10_000, 1));
        assert_ne!(build_message(&p, &a, 10_000, 1), build_message(&p, &a, 5_000, 1));
    }
}
```

- [ ] **Step 2:** Run: `cargo test -p locked_in voucher 2>&1 | tail -5` → FAIL (module missing).

- [ ] **Step 3:** Implement `voucher.rs`. Use
  `anchor_lang::solana_program::sysvar::instructions::load_instruction_at_checked`. Parse offsets
  with `u16::from_le_bytes`. Do not use `get_instruction_relative`.

- [ ] **Step 4:** Run: `cargo test -p locked_in voucher` → PASS; `anchor build -p locked_in` compiles.

- [ ] **Step 5: Commit** — `git commit -m "feat(program): ed25519 completion-voucher verification"`

> The negative cases (wrong signer, indirect data, expired, tampered message) cannot be exercised
> without a runtime; they are Task 11's job. Do not skip them there.

---

### Task 3: kamino.rs — CPI wrapper

**Files:**
- Create: `programs/locked_in/src/kamino.rs`
- Modify: `programs/locked_in/src/lib.rs`

**Interfaces:**
```rust
pub const KLEND_PROGRAM_ID: Pubkey = pubkey!("KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD");

pub struct KaminoDepositAccounts<'a, 'info> { /* owner(lock PDA), reserve, lending_market,
  lending_market_authority, reserve_liquidity_mint, reserve_liquidity_supply,
  reserve_collateral_mint, user_source_liquidity, user_destination_collateral,
  collateral_token_program, liquidity_token_program, instruction_sysvar, klend_program */ }

pub struct KaminoRedeemAccounts<'a, 'info> { /* owner(lock PDA), lending_market, reserve,
  lending_market_authority, reserve_liquidity_mint, reserve_collateral_mint,
  reserve_liquidity_supply, user_source_collateral, user_destination_liquidity,
  collateral_token_program, liquidity_token_program, instruction_sysvar, klend_program */ }

pub fn deposit_reserve_liquidity(a: KaminoDepositAccounts, liquidity_amount: u64, seeds: &[&[&[u8]]]) -> Result<()>;
pub fn redeem_reserve_collateral(a: KaminoRedeemAccounts, collateral_amount: u64, seeds: &[&[&[u8]]]) -> Result<()>;
```
Discriminators are `sha256("global:<name>")[..8]`; instruction data = discriminator + `u64` LE amount.
**Account order must match Task 0's fixture note exactly — deposit and redeem differ.** Both wrappers
`require!(klend_program.key() == KLEND_PROGRAM_ID, ReserveMismatch)` before invoking, and use
`invoke_signed` with the lock PDA seeds.

- [ ] **Step 1:** Write the module. Add a unit test pinning both discriminators:
```rust
#[test] fn discriminators_are_anchor_global_hashes() {
    assert_eq!(deposit_discriminator(), anchor_disc(b"global:deposit_reserve_liquidity"));
    assert_eq!(redeem_discriminator(), anchor_disc(b"global:redeem_reserve_collateral"));
}
```
(compute `anchor_disc` with `solana_program::hash::hash` in the test itself, so a typo in the
constant fails loudly)

- [ ] **Step 2:** Run: `cargo test -p locked_in kamino` → PASS. `anchor build -p locked_in` compiles.

- [ ] **Step 3: Commit** — `git commit -m "feat(program): kamino klend CPI wrapper (deposit/redeem)"`

> Account ORDER is proven only by Task 5's fork test. If the deposit CPI fails there with a
> klend account-mismatch error, fix the order here, not there.

---

### Task 4: initialize_vault / initialize_pot, gated on the upgrade authority

**Files:** Modify `programs/locked_in/src/vault.rs`, `pot.rs`, `lib.rs`. Test: `programs-tests/tests/v2-init.test.ts`

**Interfaces:**
```rust
pub struct InitVaultParams { pub authority: Pubkey, pub usdc_mint: Pubkey,
  pub kamino_market: Pubkey, pub kamino_reserve: Pubkey, pub kamino_collateral_mint: Pubkey,
  pub fee_vault: Pubkey,
  pub min_principal: u64, pub max_principal_per_lock: u64, pub global_tvl_cap: u64,
  pub platform_fee_bps: u16 }
```
Accounts gain `program: Program<'info, LockedIn>` and `program_data: Account<'info, ProgramData>` with
`constraint = program.programdata_address()? == Some(program_data.key())` and
`constraint = program_data.upgrade_authority_address == Some(payer.key()) @ UnauthorizedInitializer`.
`initialize_pot` carries the identical gate. Validate `usdc_mint != Pubkey::default()`,
`fee_vault != Pubkey::default()`, `platform_fee_bps <= MAX_PLATFORM_FEE_BPS`, and
`min_principal <= max_principal_per_lock <= global_tvl_cap`.

- [ ] **Step 1: Failing fork test** (`v2-init.test.ts`): a random keypair calling `initialize_vault`
      fails with `UnauthorizedInitializer`; the deployer (fork upgrade authority) succeeds; a second
      init fails (account exists); `platform_fee_bps: 2001` fails `FeeAboveHardMax`; `min > max` fails.
- [ ] **Step 2:** `npm run surfpool:start`, `anchor deploy --provider.cluster http://127.0.0.1:8899`, `npx vitest run tests/v2-init.test.ts` → FAIL.
- [ ] **Step 3:** Implement both handlers + accounts.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(program): upgrade-authority-gated init with caps + kamino pins"`

---

### Task 5: lock_funds — caps + Kamino deposit

**Files:** Modify `programs/locked_in/src/vault.rs`. Test: `programs-tests/tests/v2-lock.test.ts`

**Interfaces:** `lock_funds(course_id_hash: [u8;32], stable_amount: u64)`. No duration argument.
Accounts: `config`(mut), `lock`(init, PDA), `stable_mint`(`address = config.usdc_mint`),
`owner`(signer, payer), `owner_stable_ata`, `lock_liquidity_ata`(init, authority = lock),
`lock_collateral_ata`(init, mint = `config.kamino_collateral_mint`, authority = lock),
klend account set with `reserve` = `address = config.kamino_reserve`,
`lending_market` = `address = config.kamino_market`, `instruction_sysvar`, token/ATA/system programs.

Flow: `config.assert_lock_allowed(amount)?` → `transfer_checked` owner → `lock_liquidity_ata` →
`kamino::deposit_reserve_liquidity(.., amount, lock_seeds)` → `config.tvl_add(amount)?` →
`lock.lock_start_ts = Clock::get()?.unix_timestamp` → `lock.kamino_reserve = config.kamino_reserve`.
Emits `LockCreated { owner, principal_amount, lock_start_ts }`. No collateral amount is stored.

- [ ] **Step 1: Failing fork test.** Fund a user with USDC on the fork (transfer from a whale
      account discovered via `getTokenLargestAccounts`). Prepend `refresh_reserve`. Assert: user USDC
      −25e6; `lock_collateral_ata.amount > 0`; `config.current_tvl == 25e6`; `lock.lock_start_ts ≈ now`;
      `lock.kamino_reserve == config.kamino_reserve`. Negatives: $5 → `BelowMinPrincipal`;
      $60 → `AboveMaxPrincipal`; paused → `VaultPaused`; a lock that would exceed the global cap →
      `GlobalTvlCapExceeded`; passing a foreign `reserve` → constraint failure.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS. If klend rejects the CPI, the account order in Task 3 is wrong — fix it there.
- [ ] **Step 5: Commit** — `git commit -m "feat(program): lock_funds v2 — caps + kamino deposit CPI"`

---

### Task 6: claim — voucher, redeem, split, fund pot, zero-out, close

The money instruction. Every constraint below is load-bearing; omitting any one is a direct fund-loss bug.

**Files:** Modify `vault.rs`; add `pub(crate) fn credit_window(..)` to `pot.rs`. Test: `programs-tests/tests/v2-claim.test.ts`

**Interfaces:** `claim(user_yield_bps: u16, expiry: i64)`.

Accounts, with the constraints spelled out because the audit found each of these missing:
- `config`(mut), `lock`(mut, `has_one = owner`, `close = owner`), `owner`(signer, mut)
- `lock_collateral_ata`(mut, `token::authority = lock`, `token::mint = config.kamino_collateral_mint`)
- `lock_liquidity_ata`(mut, `token::authority = lock`, `token::mint = config.usdc_mint`)
- `owner_stable_ata`(`init_if_needed`, `associated_token::authority = owner`, `associated_token::mint = config.usdc_mint`)
- `pot_config`, `pot_window`(`init_if_needed`, seeds `[b"window", current_window_id_le]`, payer = owner)
- `pot_vault`(mut, `associated_token::authority = pot_config`, `associated_token::mint = config.usdc_mint`) ← **without this an attacker substitutes their own ATA and the forfeit is paid to them**
- `fee_vault`(mut, `address = config.fee_vault`) — only touched when `fee_bps > 0`
- klend redeem set: `reserve` = `address = config.kamino_reserve` **and** `address = lock.kamino_reserve`; `lending_market` = `address = config.kamino_market`
- `instructions_sysvar`(`address = sysvar::instructions::ID`), token/ATA/system programs

Flow:
1. `lock.assert_active()?`
2. `voucher::verify_voucher(&instructions_sysvar, &config.authority, &crate::ID, &lock.key(), user_yield_bps, expiry, clock.now)?`
3. `lock_collateral_ata.reload()?`; `let collateral = lock_collateral_ata.amount;`
4. `kamino::redeem_reserve_collateral(.., collateral, lock_seeds)?`
5. `lock_liquidity_ata.reload()?`; `let redeemed = lock_liquidity_ata.amount;` ← **absolute, not a delta**
6. `let s = lock.settle(redeemed, user_yield_bps, config.platform_fee_bps)?;`
7. transfer `s.to_owner` → `owner_stable_ata`; `s.to_pot` → `pot_vault` (skip if 0); `s.fee` → `fee_vault` (skip if 0)
8. `pot::credit_window(&mut pot_window, &pot_config, s.to_pot, clock)?` — window id derived from `Clock`
9. `lock_liquidity_ata.reload()?; require!(lock_liquidity_ata.amount == 0, NonZeroTokenBalance);`
   same for collateral. Then `close_account` both (rent → owner).
10. `config.tvl_sub(lock.principal_amount)?`; `lock.status = STATUS_CLOSED` (the account is closed by Anchor).

`claim` **must not** read `config.paused`.

- [ ] **Step 1: Failing fork test matrix.**
  - bps 10000 → owner receives ≥ principal; `pot_vault` delta 0
  - bps 5000 → `pot_vault` delta == owner's yield delta (±1); `pot_window.total_redirected_amount` == pot delta
  - bps 0 → all yield to pot; owner receives exactly principal
  - **donation attack**: transfer 1 lamport cUSDC into `lock_collateral_ata` and 1 USDC into
    `lock_liquidity_ata` before claiming → claim still succeeds, both ATAs close, and the donated
    value is split (never stranded). This is the CRIT-1 regression test.
  - no voucher (plain claim) → `VoucherNotEd25519`
  - voucher signed by a random key → `VoucherWrongSigner`
  - voucher for a *different lock* → `VoucherWrongMessage`
  - voucher with `expiry` in the past → `VoucherExpired`
  - precompile ix with `message_instruction_index = 1` pointing at attacker data → `VoucherIndirectData`
  - `user_yield_bps = 7000` → `InvalidYieldBps`
  - double claim → account-closed failure
  - `paused = true` → claim still succeeds (invariant 4)
  - `config.current_tvl` returns to its pre-lock value (invariant 3)
  - For a nonzero yield on the fork, warp slots/time (surfpool `timeTravel`) and prepend
    `refresh_reserve`; assert with tolerance. Resolve the warp mechanism in Task 0, not here.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(program): claim — voucher-gated redeem, one-mercy split, atomic pot funding"`

---

### Task 7: force_return — permissionless, absolute deadline

**Files:** Modify `vault.rs`. Test: `programs-tests/tests/v2-force-return.test.ts`

**Interfaces:** `force_return()`. Signer is `payer: Signer` — **any** account, not the owner and not
the authority. `owner` is `UncheckedAccount` constrained `address = lock.owner`. `owner_stable_ata`
is `init_if_needed` with `associated_token::authority = owner` (payer = caller) — **without this
constraint the caller redirects the principal to themselves**. Requires
`lock.assert_force_returnable(clock.now)?`. Same redeem/zero-out/close flow as `claim` with
`user_yield_bps = 0`, so all yield − fee → `pot_vault` + `credit_window`. Never reads `paused`.

- [ ] **Step 1: Failing test.** Before the deadline → `NotForceReturnable`. Warp to
      `lock_start + 180d`: a random third-party keypair calls it → owner's USDC increases by exactly
      `principal`, `pot_vault` gains all yield, `current_tvl` decremented, lock closed, and the
      caller's balance is unchanged except for fees. Substituting the caller's ATA as
      `owner_stable_ata` → constraint failure. Calling on an already-closed lock → failure.
      `paused = true` → still succeeds. Donation attack (as Task 6) → still succeeds.
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(program): permissionless force_return at absolute 180d deadline"`

---

### Task 8: pot v2 — clock-derived windows, no unbacked credit

**Files:** Modify `pot.rs`, `lib.rs`. Test: `programs-tests/tests/v2-pot.test.ts`

**Interfaces:**
- Delete `record_redirect` from `#[program]`. `credit_window` becomes `pub(crate) fn`, callable only
  from `claim`/`force_return`. It derives `window_id` from `Clock` (UTC `year*100 + month`) — **never
  a caller argument** (audit MED-5).
- `close_distribution_window(window_id, total_weight, eligible_recipient_count)` gains
  `require!(window_id < current_window_id(clock), WindowStillOpen)`.
- `distribute_window(recipient_key, window_id, amount)` gains
  `require!(amount <= min(distribution_window.remaining_amount(), pot_vault.amount), InsufficientPotBalance)`
  and `recipient_stable_ata` constrained `associated_token::authority = recipient`.

- [ ] **Step 1: Failing test.** Fund the pot via a Task 6 claim at bps 0. Assert `recordRedirect` is
      absent from the IDL. Closing the *current* month → `WindowStillOpen`. Close a past month, then:
      distribute more than `pot_vault.amount` → `InsufficientPotBalance`; distribute a valid amount →
      recipient ATA credited + receipt written; repeat for the same recipient → no double-pay;
      substituting a foreign `recipient_stable_ata` → constraint failure; substituting a foreign
      `pot_vault` → constraint failure.
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(program): pot v2 — clock-derived windows, backed credit, floored payouts"`

---

### Task 9: set_config + set_authority

**Files:** Modify `vault.rs`, `lib.rs`. Test: `programs-tests/tests/v2-admin.test.ts`

**Interfaces:**
- `set_config(min_principal, max_principal_per_lock, global_tvl_cap, platform_fee_bps, paused)` —
  signer = `config.authority` (hot key). `require!(platform_fee_bps <= MAX_PLATFORM_FEE_BPS)`.
  Must not touch `current_tvl`.
- `set_authority(new_authority)` — signer = **upgrade authority**, via the same programdata check as
  Task 4. The hot key cannot rotate itself (audit: rotation was previously undefined).

- [ ] **Step 1: Failing test.** Non-authority `set_config` → `UnauthorizedWorker`; `fee_bps = 2001` →
      `FeeAboveHardMax`; lowering `global_tvl_cap` below `current_tvl` leaves existing locks claimable
      and rejects new ones; `set_config` never changes `current_tvl`. `set_authority` by the hot key →
      `UnauthorizedInitializer`; by the upgrade authority → succeeds, and the old key's `set_config`
      then fails.
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(program): set_config (hot) + set_authority (cold)"`

---

### Task 10: delete the v1 surface

**Files:** Modify `lib.rs`, `vault.rs`.

- [ ] **Step 1:** Remove `unlock_funds`, `lock_duration_days` and its validation, and the
      `VaultConfig.authority`-is-dead comment (it is live now). Rewrite the module docs to v2 semantics.
      Rename `transfer_checked_from_lock_vault` → `transfer_checked_from_lock` and
      `CommunityPotError` → `PotError` (cosmetic residue from the pre-merge split).
- [ ] **Step 2:** `cargo test -p locked_in && anchor build -p locked_in` clean. Assert `unlockFunds`
      and `recordRedirect` are absent from the generated IDL.
- [ ] **Step 3: Commit** — `git commit -m "refactor(program): remove v1 unlock path; v2 surface final"`

---

### Task 11: invariant matrix — the phase gate

**Files:**
- Create: `programs-tests/tests/v2-invariants.test.ts`
- Create: `docs/superpowers/plans/artifacts/invariant-map.md`

- [ ] **Step 1:** Write `invariant-map.md` mapping each of spec §3.5's eight invariants to
      `file::test_name`. Add the tests that no earlier task covers:
  - **inv 1 (exit needs nobody):** with the authority keypair *deleted from the test context*,
    assert `claim` (with a pre-signed voucher) and `force_return` both still succeed.
  - **inv 3 (TVL conservation):** interleave 5 locks / 2 claims / 2 force_returns / 1 donation and
    assert `current_tvl == Σ principal of remaining ACTIVE locks` after every step.
  - **inv 6 (bounded authority):** with the authority as signer, attempt to move principal, to close
    a lock, to change `lock_start_ts`, to rotate itself, and to set `fee_bps = 5000`. All must fail.
  - **inv 2 (pot backing):** after any mix of settlements, `pot_vault.amount >= Σ (window.total_redirected − window.distributed)`.
- [ ] **Step 2:** Run the whole suite: `npm run surfpool:start` + `npx vitest run` → all green.
- [ ] **Step 3: Commit** — `git commit -m "test(program): §3.5 invariant matrix green on mainnet fork"`

---

### Task 12: devnet mock reserve program (unblocks browser E2E)

klend has no devnet deployment, so Playwright cannot drive a real deposit/claim on devnet. Because
`VaultConfig` pins the market/reserve at init and `kamino.rs` builds raw instructions, a mock that
mimics klend's discriminators and account order is a drop-in for devnet only.

**Files:**
- Create: `programs/mock_reserve/` (Anchor program: `deposit_reserve_liquidity`, `redeem_reserve_collateral`, `refresh_reserve` no-op)
- Modify: root `Cargo.toml` workspace members, `Anchor.toml`
- Test: `programs-tests/tests/mock-reserve.test.ts`

**Interfaces:** Same two discriminators and identical account orders as Task 0's fixture note. Mints a
collateral token 1:1 on deposit; on redeem, returns `collateral * exchange_rate` where
`exchange_rate` grows with slot height at a fixed rate, so E2E sees a nonzero, deterministic yield.

- [ ] **Step 1: Failing test:** deposit 25 USDC → collateral minted; warp slots; redeem → more USDC
      back than deposited; `refresh_reserve` accepted and ignored.
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** PASS.
- [ ] **Step 5:** Backend boot guard: refuse to start if `CLUSTER=mainnet` and the configured reserve
      is the mock program id. (Test lives in the backend plan.)
- [ ] **Step 6: Commit** — `git commit -m "feat(test): devnet mock klend reserve for browser E2E"`

---

## Self-review (performed at authoring)

- **Spec coverage.** §3.1 → T1; §3.2 voucher → T2 + T6; §3.3 rows → T4–T9; §3.4 → T1; §3.5 → T11
  (explicit map); §3.6 klend + refresh + mock → T0, T3, T5, T12. Backend, frontend and launch are
  separate plans and are out of scope here.
- **Placeholders.** Task 3 defers the *proof* of klend account order to Task 5's fork test, and Task 0
  defers the fork time-warp mechanism to its own step. Both are named, testable, and assigned — not TBDs.
- **Type consistency.** `SettleAmounts`, `VALID_YIELD_BPS`, `FORCE_RETURN_AFTER_SECS`, `STATUS_*`,
  `build_message`/`verify_voucher` signatures, and `credit_window` are used identically in every task.
- **Gap found and fixed inline.** Task 6 constrains `fee_vault` with `address = config.fee_vault`,
  but the field was missing from Task 1's `VaultConfig`. Added there, and to `InitVaultParams`
  (Task 4), which must also `require!(fee_vault != Pubkey::default())`. Without a pinned destination,
  a permissionless `force_return` caller could pass their own account as the fee vault and skim the
  fee once `fee_bps > 0`.
