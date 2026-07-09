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
mod pot;
mod settle;
mod vault;
mod voucher;
mod window;

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
#[allow(ambiguous_glob_reexports)]
pub use vault::*;

declare_id!("3RC9XkPZNSgXksp9Fb7J4LE7cQNYUUQdxkaaQnz6kBav");

#[program]
pub mod locked_in {
    use super::*;

    // ── Vault domain (custody escrow) ────────────────────────────────────

    /// Initialize the vault custody config (was `lock_vault::initialize_protocol`).
    pub fn initialize_vault(ctx: Context<InitializeVault>, usdc_mint: Pubkey) -> Result<()> {
        vault::initialize_vault(ctx, usdc_mint)
    }

    pub fn lock_funds(
        ctx: Context<LockFunds>,
        course_id_hash: [u8; 32],
        lock_duration_days: u16,
        stable_amount: u64,
    ) -> Result<()> {
        vault::lock_funds(ctx, course_id_hash, lock_duration_days, stable_amount)
    }

    pub fn unlock_funds(ctx: Context<UnlockFunds>) -> Result<()> {
        vault::unlock_funds(ctx)
    }

    // ── Pot domain (yield-redirect accumulator + payout) ─────────────────

    /// Initialize the community-pot config (was `community_pot::initialize_protocol`).
    pub fn initialize_pot(ctx: Context<InitializePot>, stable_mint: Pubkey) -> Result<()> {
        pot::initialize_pot(ctx, stable_mint)
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

#[cfg(test)]
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
