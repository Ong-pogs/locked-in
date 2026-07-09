//! Kamino klend CPI wrappers: deposit USDC into the reserve, redeem it back.
//!
//! The program pins the klend program id, market, reserve, and collateral mint
//! in `VaultConfig`; these wrappers do the raw instruction build + `invoke_signed`
//! under the lock PDA. Account ORDER is copied verbatim from the klend IDL
//! (v1.13.0) and differs between deposit and redeem — see the flagged swap
//! below. Discriminators are `sha256("global:<name>")[..8]`, pinned in tests.
//!
//! `refresh_reserve` is NOT built here: it is prepended client-side to the same
//! transaction (klend rejects a stale reserve), so the program never CPIs it.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
};

/// Kamino Lend (klend) mainnet program — the value `VaultConfig.kamino_program`
/// is pinned to at init on mainnet. On devnet it is pinned to the mock reserve
/// program instead, so the CPI target is taken from the passed account (which
/// the caller constrains via `address = config.kamino_program`) rather than a
/// hardcoded const. The const remains the documented mainnet default.
pub const KLEND_PROGRAM_ID: Pubkey =
    anchor_lang::solana_program::pubkey!("KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD");

fn deposit_discriminator() -> [u8; 8] {
    anchor_discriminator(b"global:deposit_reserve_liquidity")
}

fn redeem_discriminator() -> [u8; 8] {
    anchor_discriminator(b"global:redeem_reserve_collateral")
}

fn anchor_discriminator(preimage: &[u8]) -> [u8; 8] {
    let hash = anchor_lang::solana_program::hash::hash(preimage);
    let mut out = [0u8; 8];
    out.copy_from_slice(&hash.to_bytes()[..8]);
    out
}

/// Accounts for `deposit_reserve_liquidity`, in klend IDL order.
pub struct KaminoDeposit<'info> {
    pub klend_program: AccountInfo<'info>,
    pub owner: AccountInfo<'info>, // the lock PDA (signs via seeds)
    pub reserve: AccountInfo<'info>,
    pub lending_market: AccountInfo<'info>,
    pub lending_market_authority: AccountInfo<'info>,
    pub reserve_liquidity_mint: AccountInfo<'info>,
    pub reserve_liquidity_supply: AccountInfo<'info>,
    pub reserve_collateral_mint: AccountInfo<'info>,
    pub user_source_liquidity: AccountInfo<'info>,
    pub user_destination_collateral: AccountInfo<'info>,
    pub collateral_token_program: AccountInfo<'info>,
    pub liquidity_token_program: AccountInfo<'info>,
    pub instruction_sysvar: AccountInfo<'info>,
}

/// Accounts for `redeem_reserve_collateral`, in klend IDL order.
/// NOTE the order differs from deposit: `lending_market` comes BEFORE `reserve`.
pub struct KaminoRedeem<'info> {
    pub klend_program: AccountInfo<'info>,
    pub owner: AccountInfo<'info>, // the lock PDA (signs via seeds)
    pub lending_market: AccountInfo<'info>,
    pub reserve: AccountInfo<'info>,
    pub lending_market_authority: AccountInfo<'info>,
    pub reserve_liquidity_mint: AccountInfo<'info>,
    pub reserve_collateral_mint: AccountInfo<'info>,
    pub reserve_liquidity_supply: AccountInfo<'info>,
    pub user_source_collateral: AccountInfo<'info>,
    pub user_destination_liquidity: AccountInfo<'info>,
    pub collateral_token_program: AccountInfo<'info>,
    pub liquidity_token_program: AccountInfo<'info>,
    pub instruction_sysvar: AccountInfo<'info>,
}

pub fn deposit_reserve_liquidity(a: KaminoDeposit, liquidity_amount: u64, seeds: &[&[&[u8]]]) -> Result<()> {
    let program_id = *a.klend_program.key;

    let mut data = Vec::with_capacity(16);
    data.extend_from_slice(&deposit_discriminator());
    data.extend_from_slice(&liquidity_amount.to_le_bytes());

    let metas = vec![
        AccountMeta::new_readonly(*a.owner.key, true),
        AccountMeta::new(*a.reserve.key, false),
        AccountMeta::new_readonly(*a.lending_market.key, false),
        AccountMeta::new_readonly(*a.lending_market_authority.key, false),
        AccountMeta::new_readonly(*a.reserve_liquidity_mint.key, false),
        AccountMeta::new(*a.reserve_liquidity_supply.key, false),
        AccountMeta::new(*a.reserve_collateral_mint.key, false),
        AccountMeta::new(*a.user_source_liquidity.key, false),
        AccountMeta::new(*a.user_destination_collateral.key, false),
        AccountMeta::new_readonly(*a.collateral_token_program.key, false),
        AccountMeta::new_readonly(*a.liquidity_token_program.key, false),
        AccountMeta::new_readonly(*a.instruction_sysvar.key, false),
    ];

    let ix = Instruction { program_id, accounts: metas, data };
    invoke_signed(
        &ix,
        &[
            a.owner, a.reserve, a.lending_market, a.lending_market_authority,
            a.reserve_liquidity_mint, a.reserve_liquidity_supply, a.reserve_collateral_mint,
            a.user_source_liquidity, a.user_destination_collateral,
            a.collateral_token_program, a.liquidity_token_program, a.instruction_sysvar,
        ],
        seeds,
    )
    .map_err(|_| KaminoError::DepositFailed.into())
}

pub fn redeem_reserve_collateral(a: KaminoRedeem, collateral_amount: u64, seeds: &[&[&[u8]]]) -> Result<()> {
    let program_id = *a.klend_program.key;

    let mut data = Vec::with_capacity(16);
    data.extend_from_slice(&redeem_discriminator());
    data.extend_from_slice(&collateral_amount.to_le_bytes());

    let metas = vec![
        AccountMeta::new_readonly(*a.owner.key, true),
        AccountMeta::new_readonly(*a.lending_market.key, false),
        AccountMeta::new(*a.reserve.key, false),
        AccountMeta::new_readonly(*a.lending_market_authority.key, false),
        AccountMeta::new_readonly(*a.reserve_liquidity_mint.key, false),
        AccountMeta::new(*a.reserve_collateral_mint.key, false),
        AccountMeta::new(*a.reserve_liquidity_supply.key, false),
        AccountMeta::new(*a.user_source_collateral.key, false),
        AccountMeta::new(*a.user_destination_liquidity.key, false),
        AccountMeta::new_readonly(*a.collateral_token_program.key, false),
        AccountMeta::new_readonly(*a.liquidity_token_program.key, false),
        AccountMeta::new_readonly(*a.instruction_sysvar.key, false),
    ];

    let ix = Instruction { program_id, accounts: metas, data };
    invoke_signed(
        &ix,
        &[
            a.owner, a.lending_market, a.reserve, a.lending_market_authority,
            a.reserve_liquidity_mint, a.reserve_collateral_mint, a.reserve_liquidity_supply,
            a.user_source_collateral, a.user_destination_liquidity,
            a.collateral_token_program, a.liquidity_token_program, a.instruction_sysvar,
        ],
        seeds,
    )
    .map_err(|_| KaminoError::RedeemFailed.into())
}

#[error_code]
pub enum KaminoError {
    #[msg("CPI target is not the pinned Kamino klend program.")]
    WrongProgram,
    #[msg("Kamino deposit CPI failed.")]
    DepositFailed,
    #[msg("Kamino redeem CPI failed.")]
    RedeemFailed,
}

#[cfg(test)]
mod tests {
    use super::*;

    // Pinned against the klend IDL (verified 2026-07-09). A typo in either
    // constant fails here rather than at runtime on the fork.
    #[test]
    fn deposit_discriminator_matches_idl() {
        assert_eq!(deposit_discriminator(), [169, 201, 30, 126, 6, 205, 102, 68]);
    }

    #[test]
    fn redeem_discriminator_matches_idl() {
        assert_eq!(redeem_discriminator(), [234, 117, 181, 125, 185, 142, 220, 29]);
    }

    #[test]
    fn klend_program_id_is_canonical() {
        assert_eq!(
            KLEND_PROGRAM_ID.to_string(),
            "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD"
        );
    }
}
