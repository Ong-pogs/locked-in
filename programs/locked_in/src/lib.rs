#![allow(deprecated)]
#![allow(unexpected_cfgs)]

//! Merged Locked In on-chain program (v4 cost-reduction).
//!
//! This crate folds the former `lock_vault` (custody escrow) and
//! `community_pot` (yield-redirect accumulator + payout) programs into ONE
//! deployable program so we pay a single Anchor baseline instead of two.
//!
//! Custody logic is copied VERBATIM from the two source programs; only the
//! NAMES that would collide under one program ID were changed:
//!   * config PDA seeds  : `b"protocol"`  -> `b"vault-protocol"` / `b"pot-protocol"`
//!   * config struct name: `ProtocolConfig` -> `VaultConfig` / `PotConfig`
//!     (Anchor's 8-byte account discriminator hashes the struct name)
//!   * `initialize_protocol` -> `initialize_vault` / `initialize_pot`
//!     (Anchor's instruction discriminator hashes the global name)
//!
//! All other seeds (`b"lock"`, `b"window"`, `b"distribution"`, `b"redirect"`,
//! `b"distribution-receipt"`) are already unique across the two domains.

use anchor_lang::prelude::*;

mod caps;
mod kamino;
// Dev-only test probe for the klend CPI wrappers — excluded from the mainnet
// build to shrink the program (smaller .so = less rent).
#[cfg(feature = "devnet")]
mod kamino_probe;
mod pot;
mod settle;
// v1 custody escrow (fixed-duration lock, no yield). Superseded by vault_v2;
// kept only for the devnet legacy path and excluded from mainnet.
#[cfg(feature = "devnet")]
mod vault;
mod vault_v2;
mod voucher;

#[cfg(feature = "devnet")]
pub use kamino_probe::*;
pub use vault_v2::*;

// Re-export domain items so the generated #[program] module and the IDL can
// see the Accounts structs / args without fully-qualified paths.
//
// `ambiguous_glob_reexports` fires only because each module also defines a
// handler fn (e.g. `record_redirect`) whose name matches a fn the #[program]
// macro generates at crate root. That collision is harmless: the program
// module calls handlers via the `vault::` / `pot::` qualified paths, and the
// re-exports exist purely to surface the Accounts structs + event/error types.
#[allow(ambiguous_glob_reexports)]
pub use pot::*;
#[cfg(feature = "devnet")]
#[allow(ambiguous_glob_reexports)]
pub use vault::*;

declare_id!("3RC9XkPZNSgXksp9Fb7J4LE7cQNYUUQdxkaaQnz6kBav");

#[program]
pub mod locked_in {
    use super::*;

    // ── Vault domain (v1 custody escrow — devnet-only, excluded from mainnet) ─

    /// Initialize the vault custody config (was `lock_vault::initialize_protocol`).
    #[cfg(feature = "devnet")]
    pub fn initialize_vault(ctx: Context<InitializeVault>, usdc_mint: Pubkey) -> Result<()> {
        vault::initialize_vault(ctx, usdc_mint)
    }

    #[cfg(feature = "devnet")]
    pub fn lock_funds(
        ctx: Context<LockFunds>,
        course_id_hash: [u8; 32],
        lock_duration_days: u16,
        stable_amount: u64,
    ) -> Result<()> {
        vault::lock_funds(ctx, course_id_hash, lock_duration_days, stable_amount)
    }

    #[cfg(feature = "devnet")]
    pub fn unlock_funds(ctx: Context<UnlockFunds>) -> Result<()> {
        vault::unlock_funds(ctx)
    }

    /// Dev-only: prove the kamino CPI wrappers deposit into and redeem from the
    /// real klend reserve. Not part of the product surface — devnet-only.
    #[cfg(feature = "devnet")]
    pub fn kamino_roundtrip(ctx: Context<KaminoRoundtrip>, amount: u64) -> Result<()> {
        kamino_probe::kamino_roundtrip(ctx, amount)
    }

    // ── v2 custody (Kamino yield + voucher claim) ─────────────────────────

    pub fn initialize_vault_v2(ctx: Context<InitializeVaultV2>, params: InitV2Params) -> Result<()> {
        vault_v2::initialize_vault_v2(ctx, params)
    }

    pub fn open_lock_v2(ctx: Context<OpenLockV2>, course_id_hash: [u8; 32]) -> Result<()> {
        vault_v2::open_lock_v2(ctx, course_id_hash)
    }

    pub fn lock_funds_v2(ctx: Context<LockFundsV2>, course_id_hash: [u8; 32], amount: u64) -> Result<()> {
        vault_v2::lock_funds_v2(ctx, course_id_hash, amount)
    }

    pub fn claim_v2(ctx: Context<ClaimV2>, user_yield_bps: u16, expiry: i64) -> Result<()> {
        vault_v2::claim_v2(ctx, user_yield_bps, expiry)
    }

    pub fn force_return_v2(ctx: Context<ForceReturnV2>) -> Result<()> {
        vault_v2::force_return_v2(ctx)
    }

    pub fn set_config_v2(ctx: Context<SetConfigV2>, min: u64, max: u64, global: u64, fee_bps: u16, paused: bool) -> Result<()> {
        vault_v2::set_config_v2(ctx, min, max, global, fee_bps, paused)
    }

    pub fn set_authority_v2(ctx: Context<SetAuthorityV2>, new_authority: Pubkey) -> Result<()> {
        vault_v2::set_authority_v2(ctx, new_authority)
    }

    // ── Pot domain (yield-redirect accumulator + payout) ─────────────────

    /// Initialize the community-pot config (was `community_pot::initialize_protocol`).
    pub fn initialize_pot(
        ctx: Context<InitializePot>,
        stable_mint: Pubkey,
        authority: Pubkey,
    ) -> Result<()> {
        pot::initialize_pot(ctx, stable_mint, authority)
    }

    pub fn set_pot_authority(
        ctx: Context<SetPotAuthority>,
        new_authority: Pubkey,
    ) -> Result<()> {
        pot::set_pot_authority(ctx, new_authority)
    }

    pub fn record_redirect(
        ctx: Context<RecordRedirect>,
        receipt_key: [u8; 32],
        window_id: i64,
        amount: u64,
        recorded_at_ts: i64,
    ) -> Result<()> {
        pot::record_redirect(ctx, receipt_key, window_id, amount, recorded_at_ts)
    }

    pub fn close_distribution_window(
        ctx: Context<CloseDistributionWindow>,
        window_id: i64,
        total_weight: u64,
        eligible_recipient_count: u32,
        closed_at_ts: i64,
    ) -> Result<()> {
        pot::close_distribution_window(
            ctx,
            window_id,
            total_weight,
            eligible_recipient_count,
            closed_at_ts,
        )
    }

    pub fn distribute_window(
        ctx: Context<DistributeWindow>,
        recipient_key: [u8; 32],
        window_id: i64,
        amount: u64,
        distributed_at_ts: i64,
    ) -> Result<()> {
        pot::distribute_window(ctx, recipient_key, window_id, amount, distributed_at_ts)
    }
}

// Exercises the v1 VaultConfig ↔ PotConfig seed separation, so it only builds
// when the v1 vault module is present (devnet).
#[cfg(all(test, feature = "devnet"))]
mod merge_tests {
    use super::*;

    // Proves the seed-collision fix: under ONE program ID the vault config PDA
    // (b"vault-protocol") and the pot config PDA (b"pot-protocol") must resolve
    // to DIFFERENT addresses. If both still used b"protocol" these would be the
    // same PDA over two different struct layouts — silent state corruption.
    #[test]
    fn vault_and_pot_config_pdas_are_distinct() {
        let program_id = crate::ID;
        let (vault_pda, _) = Pubkey::find_program_address(&[VaultConfig::SEED], &program_id);
        let (pot_pda, _) = Pubkey::find_program_address(&[PotConfig::SEED], &program_id);

        assert_ne!(
            vault_pda, pot_pda,
            "vault + pot config PDAs collided — the seed-separation pin regressed"
        );
        // Belt-and-suspenders: the seeds themselves must differ.
        assert_ne!(VaultConfig::SEED, PotConfig::SEED);
    }
}
