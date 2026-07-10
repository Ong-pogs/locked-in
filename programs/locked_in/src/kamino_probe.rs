//! Dev-only proof that the `kamino` CPI wrappers actually deposit into and
//! redeem from the real Kamino klend reserve. Not part of the product surface —
//! it exists so a fork test can validate account order, `refresh_reserve`
//! sequencing, and PDA signing before the real `lock_funds`/`claim` are wired.
//!
//! The owner/authority is a program PDA (`[b"kamino-probe"]`), so only this
//! program can move the probe's token accounts. A caller pre-funds the probe's
//! USDC ATA; the instruction deposits `amount`, then redeems the collateral it
//! received back to the same USDC ATA. Net effect: a round-trip through klend.

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{TokenAccount, TokenInterface};

use crate::kamino::{
    redeem_reserve_collateral, deposit_reserve_liquidity, KaminoDeposit, KaminoRedeem,
};

pub const PROBE_SEED: &[u8] = b"kamino-probe";

pub fn kamino_roundtrip(ctx: Context<KaminoRoundtrip>, amount: u64) -> Result<()> {
    let bump = ctx.bumps.probe_authority;
    let seeds: &[&[&[u8]]] = &[&[PROBE_SEED, &[bump]]];

    deposit_reserve_liquidity(
        &KaminoDeposit {
            klend_program: ctx.accounts.klend_program.to_account_info(),
            owner: ctx.accounts.probe_authority.to_account_info(),
            reserve: ctx.accounts.reserve.to_account_info(),
            lending_market: ctx.accounts.lending_market.to_account_info(),
            lending_market_authority: ctx.accounts.lending_market_authority.to_account_info(),
            reserve_liquidity_mint: ctx.accounts.reserve_liquidity_mint.to_account_info(),
            reserve_liquidity_supply: ctx.accounts.reserve_liquidity_supply.to_account_info(),
            reserve_collateral_mint: ctx.accounts.reserve_collateral_mint.to_account_info(),
            user_source_liquidity: ctx.accounts.probe_liquidity.to_account_info(),
            user_destination_collateral: ctx.accounts.probe_collateral.to_account_info(),
            collateral_token_program: ctx.accounts.collateral_token_program.to_account_info(),
            liquidity_token_program: ctx.accounts.liquidity_token_program.to_account_info(),
            instruction_sysvar: ctx.accounts.instruction_sysvar.to_account_info(),
        },
        amount,
        seeds,
    )?;

    ctx.accounts.probe_collateral.reload()?;
    let collateral = ctx.accounts.probe_collateral.amount;

    redeem_reserve_collateral(
        &KaminoRedeem {
            klend_program: ctx.accounts.klend_program.to_account_info(),
            owner: ctx.accounts.probe_authority.to_account_info(),
            lending_market: ctx.accounts.lending_market.to_account_info(),
            reserve: ctx.accounts.reserve.to_account_info(),
            lending_market_authority: ctx.accounts.lending_market_authority.to_account_info(),
            reserve_liquidity_mint: ctx.accounts.reserve_liquidity_mint.to_account_info(),
            reserve_collateral_mint: ctx.accounts.reserve_collateral_mint.to_account_info(),
            reserve_liquidity_supply: ctx.accounts.reserve_liquidity_supply.to_account_info(),
            user_source_collateral: ctx.accounts.probe_collateral.to_account_info(),
            user_destination_liquidity: ctx.accounts.probe_liquidity.to_account_info(),
            collateral_token_program: ctx.accounts.collateral_token_program.to_account_info(),
            liquidity_token_program: ctx.accounts.liquidity_token_program.to_account_info(),
            instruction_sysvar: ctx.accounts.instruction_sysvar.to_account_info(),
        },
        collateral,
        seeds,
    )?;

    ctx.accounts.probe_liquidity.reload()?;
    emit!(RoundtripDone {
        deposited: amount,
        collateral_received: collateral,
        liquidity_after: ctx.accounts.probe_liquidity.amount,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct KaminoRoundtrip<'info> {
    /// CHECK: klend program id is asserted inside the CPI wrapper.
    pub klend_program: UncheckedAccount<'info>,
    #[account(seeds = [PROBE_SEED], bump)]
    /// CHECK: PDA authority that owns the probe token accounts and signs the CPI.
    pub probe_authority: UncheckedAccount<'info>,
    #[account(mut)]
    pub probe_liquidity: InterfaceAccount<'info, TokenAccount>,
    #[account(mut)]
    pub probe_collateral: InterfaceAccount<'info, TokenAccount>,
    /// CHECK: validated by klend.
    #[account(mut)]
    pub reserve: UncheckedAccount<'info>,
    /// CHECK: validated by klend.
    pub lending_market: UncheckedAccount<'info>,
    /// CHECK: validated by klend.
    pub lending_market_authority: UncheckedAccount<'info>,
    /// CHECK: validated by klend.
    pub reserve_liquidity_mint: UncheckedAccount<'info>,
    /// CHECK: validated by klend.
    #[account(mut)]
    pub reserve_liquidity_supply: UncheckedAccount<'info>,
    /// CHECK: validated by klend.
    #[account(mut)]
    pub reserve_collateral_mint: UncheckedAccount<'info>,
    pub collateral_token_program: Interface<'info, TokenInterface>,
    pub liquidity_token_program: Interface<'info, TokenInterface>,
    /// CHECK: instructions sysvar, read by klend.
    pub instruction_sysvar: UncheckedAccount<'info>,
}

#[event]
pub struct RoundtripDone {
    pub deposited: u64,
    pub collateral_received: u64,
    pub liquidity_after: u64,
}
