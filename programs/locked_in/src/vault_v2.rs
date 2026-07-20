//! v2 custody: lock USDC into Kamino (or the devnet mock), settle at claim.
//!
//! Coexists with the v1 `vault` module (distinct PDA seeds and struct names) so
//! the current devnet custody keeps working while v2 is validated. Wires
//! together `caps` (deposit limits + absolute exit deadline), `kamino` (deposit
//! / redeem CPI), `voucher` (Ed25519 completion proof), and `settle` (one-mercy
//! yield split).
//!
//! Money flow:
//!   lock   : open_lock creates the lock + collateral ATA; lock_funds CPIs the
//!            user USDC into the reserve, cToken shares -> lock collateral ATA.
//!   claim  : voucher proves completion + tier; CPI redeem the live share
//!            balance; split principal + yield*bps to owner, the rest to the pot;
//!            zero and close both ATAs and the lock.
//!   return : permissionless after lock_start + 180d; principal to owner, all
//!            yield to the pot.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::instructions::ID as INSTRUCTIONS_SYSVAR_ID;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked, CloseAccount},
};

use crate::caps::{self, Caps, FORCE_RETURN_AFTER_SECS};
use crate::kamino::{deposit_reserve_liquidity, redeem_reserve_collateral, KaminoDeposit, KaminoRedeem};
use crate::settle::{settle, SettleAmounts};
use crate::voucher::verify_voucher;

const ACTIVE: u8 = 0;
const PENDING: u8 = 1;
const CLOSED: u8 = 2;

// MUST stay "vault-v2b": the live devnet binary (EUAB…GucsN) and every client
// (web-app vaultV2.ts, backend lockPosition.mjs, all scripts) derive the config
// PDA from "vault-v2b". A rebuild from a different seed here flips the seeds
// constraint, breaks every existing deposit/claim (ConstraintSeeds), and can
// strand principal in a stale-TVL config. Source was "vault-v2" while the
// deployed binary was "vault-v2b" — realigned so source reproduces the deploy.
pub const CONFIG_SEED: &[u8] = b"vault-v2b";
pub const LOCK_SEED: &[u8] = b"lock-v2";

// ── init ────────────────────────────────────────────────────────────────

pub fn initialize_vault_v2(ctx: Context<InitializeVaultV2>, p: InitV2Params) -> Result<()> {
    let caps = Caps { min_principal: p.min_principal, max_principal_per_lock: p.max_principal_per_lock, global_tvl_cap: p.global_tvl_cap };
    caps.validate()?;
    require!(p.platform_fee_bps <= crate::settle::MAX_PLATFORM_FEE_BPS, VaultV2Error::FeeAboveHardMax);
    // Mainnet builds pin the CPI target to the real klend program; devnet builds
    // (feature = "devnet") allow the mock reserve.
    #[cfg(not(feature = "devnet"))]
    require!(p.kamino_program == crate::kamino::KLEND_PROGRAM_ID, VaultV2Error::NotKlendProgram);

    let c = &mut ctx.accounts.config;
    c.authority = p.authority;
    c.usdc_mint = ctx.accounts.usdc_mint.key();
    c.kamino_program = p.kamino_program;
    c.kamino_reserve = p.kamino_reserve;
    c.kamino_market = p.kamino_market;
    c.kamino_lma = p.kamino_lma;
    c.kamino_liquidity_supply = p.kamino_liquidity_supply;
    c.kamino_collateral_mint = ctx.accounts.collateral_mint.key();
    c.pot_vault = ctx.accounts.pot_vault.key();
    c.fee_vault = p.fee_vault;
    c.min_principal = p.min_principal;
    c.max_principal_per_lock = p.max_principal_per_lock;
    c.global_tvl_cap = p.global_tvl_cap;
    c.current_tvl = 0;
    c.platform_fee_bps = p.platform_fee_bps;
    c.paused = false;
    c.bump = ctx.bumps.config;
    Ok(())
}

// ── lock ────────────────────────────────────────────────────────────────
//
// Locking is two instructions: `open_lock_v2` creates the lock account + its
// collateral ATA (init-heavy, no CPI), then `lock_funds_v2` does the Kamino
// deposit CPI (CPI-heavy, no init). Splitting keeps each instruction's stack
// frame well under the 4KB BPF limit — a single instruction doing both the
// account inits and the 13-account deposit CPI overflows it.

pub fn open_lock_v2(ctx: Context<OpenLockV2>, course_id_hash: [u8; 32]) -> Result<()> {
    let lock = &mut ctx.accounts.lock;
    lock.owner = ctx.accounts.owner.key();
    lock.course_id_hash = course_id_hash;
    lock.principal_amount = 0;
    lock.lock_start_ts = Clock::get()?.unix_timestamp;
    lock.status = PENDING;
    lock.bump = ctx.bumps.lock;
    Ok(())
}

pub fn lock_funds_v2(ctx: Context<LockFundsV2>, _course_id_hash: [u8; 32], amount: u64) -> Result<()> {
    require!(ctx.accounts.lock.status == PENDING, VaultV2Error::LockNotPending);
    let caps = Caps {
        min_principal: ctx.accounts.config.min_principal,
        max_principal_per_lock: ctx.accounts.config.max_principal_per_lock,
        global_tvl_cap: ctx.accounts.config.global_tvl_cap,
    };
    caps.assert_lock_allowed(amount, ctx.accounts.config.current_tvl, ctx.accounts.config.paused)?;

    // Deposit straight from the user: their USDC -> reserve, cToken shares -> the
    // lock's collateral ATA (custodied by the lock PDA). The user signs the outer
    // tx so their signature propagates to klend — no PDA seeds for deposit.
    deposit_reserve_liquidity(
        &KaminoDeposit {
            klend_program: ctx.accounts.kamino_program.to_account_info(),
            owner: ctx.accounts.owner.to_account_info(),
            reserve: ctx.accounts.reserve.to_account_info(),
            lending_market: ctx.accounts.lending_market.to_account_info(),
            lending_market_authority: ctx.accounts.lending_market_authority.to_account_info(),
            reserve_liquidity_mint: ctx.accounts.usdc_mint.to_account_info(),
            reserve_liquidity_supply: ctx.accounts.reserve_liquidity_supply.to_account_info(),
            reserve_collateral_mint: ctx.accounts.reserve_collateral_mint.to_account_info(),
            user_source_liquidity: ctx.accounts.owner_usdc.to_account_info(),
            user_destination_collateral: ctx.accounts.lock_collateral.to_account_info(),
            collateral_token_program: ctx.accounts.token_program.to_account_info(),
            liquidity_token_program: ctx.accounts.token_program.to_account_info(),
            instruction_sysvar: ctx.accounts.instruction_sysvar.to_account_info(),
        },
        amount,
        &[],
    )?;

    let c = &mut ctx.accounts.config;
    c.current_tvl = caps::tvl_add(c.current_tvl, amount)?;

    let lock = &mut ctx.accounts.lock;
    lock.principal_amount = amount;
    lock.lock_start_ts = Clock::get()?.unix_timestamp;
    lock.status = ACTIVE;

    emit!(LockV2Created { lock: lock.key(), owner: lock.owner, principal_amount: amount, lock_start_ts: lock.lock_start_ts });
    Ok(())
}

// ── settlement shared by claim + force_return ─────────────────────────────

#[allow(clippy::too_many_arguments)]
#[inline(never)]
fn redeem_and_split<'info>(
    lock_liquidity: &mut InterfaceAccount<'info, TokenAccount>,
    lock_collateral: &mut InterfaceAccount<'info, TokenAccount>,
    ai: &SettleAis<'info>,
    principal: u64,
    usdc_decimals: u8,
    course_id_hash: [u8; 32],
    lock_bump: u8,
    user_yield_bps: u16,
    fee_bps: u16,
) -> Result<SettleAmounts> {
    let bump_arr = [lock_bump];
    let seeds: &[&[&[u8]]] = &[&[LOCK_SEED, ai.owner_key.as_ref(), &course_id_hash, &bump_arr]];

    lock_collateral.reload()?;
    let shares = lock_collateral.amount;
    redeem_reserve_collateral(
        &KaminoRedeem {
            klend_program: ai.kamino_program.clone(),
            owner: ai.lock.clone(),
            lending_market: ai.lending_market.clone(),
            reserve: ai.reserve.clone(),
            lending_market_authority: ai.lending_market_authority.clone(),
            reserve_liquidity_mint: ai.usdc_mint.clone(),
            reserve_collateral_mint: ai.reserve_collateral_mint.clone(),
            reserve_liquidity_supply: ai.reserve_liquidity_supply.clone(),
            user_source_collateral: lock_collateral.to_account_info(),
            user_destination_liquidity: lock_liquidity.to_account_info(),
            collateral_token_program: ai.token_program.clone(),
            liquidity_token_program: ai.token_program.clone(),
            instruction_sysvar: ai.instruction_sysvar.clone(),
        },
        shares,
        seeds,
    )?;

    lock_liquidity.reload()?;
    let redeemed = lock_liquidity.amount;
    let s = settle(redeemed, principal, user_yield_bps, fee_bps)?;

    let liq = lock_liquidity.to_account_info();
    if s.to_owner > 0 {
        pda_transfer(&ai.token_program, &liq, &ai.usdc_mint, &ai.owner_usdc, &ai.lock, seeds, s.to_owner, usdc_decimals)?;
    }
    if s.to_pot > 0 {
        pda_transfer(&ai.token_program, &liq, &ai.usdc_mint, &ai.pot_vault, &ai.lock, seeds, s.to_pot, usdc_decimals)?;
    }
    if s.fee > 0 {
        pda_transfer(&ai.token_program, &liq, &ai.usdc_mint, &ai.fee_vault, &ai.lock, seeds, s.fee, usdc_decimals)?;
    }

    lock_liquidity.reload()?;
    require!(lock_liquidity.amount == 0, VaultV2Error::NonZeroBalance);
    close_ata(&ai.token_program, &lock_liquidity.to_account_info(), &ai.owner_rent_dest, &ai.lock, seeds)?;
    close_ata(&ai.token_program, &lock_collateral.to_account_info(), &ai.owner_rent_dest, &ai.lock, seeds)?;
    Ok(s)
}

#[allow(clippy::too_many_arguments)]
fn pda_transfer<'info>(
    token_program: &AccountInfo<'info>, from: &AccountInfo<'info>, mint: &AccountInfo<'info>,
    to: &AccountInfo<'info>, authority: &AccountInfo<'info>, seeds: &[&[&[u8]]], amount: u64, decimals: u8,
) -> Result<()> {
    token_interface::transfer_checked(
        CpiContext::new_with_signer(token_program.clone(), TransferChecked {
            from: from.clone(), mint: mint.clone(), to: to.clone(), authority: authority.clone(),
        }, seeds),
        amount, decimals,
    )
}

fn close_ata<'info>(
    token_program: &AccountInfo<'info>, account: &AccountInfo<'info>, dest: &AccountInfo<'info>,
    authority: &AccountInfo<'info>, seeds: &[&[&[u8]]],
) -> Result<()> {
    token_interface::close_account(CpiContext::new_with_signer(token_program.clone(), CloseAccount {
        account: account.clone(), destination: dest.clone(), authority: authority.clone(),
    }, seeds))
}

// A flat bag of AccountInfos (which are cheap to clone) so redeem_and_split can
// be shared by claim + force_return without duplicating the CPI logic. The two
// lock ATAs are passed separately by &mut reference so they can be reloaded.
struct SettleAis<'info> {
    owner_key: Pubkey,
    lock: AccountInfo<'info>,
    owner_usdc: AccountInfo<'info>,
    owner_rent_dest: AccountInfo<'info>,
    pot_vault: AccountInfo<'info>,
    fee_vault: AccountInfo<'info>,
    kamino_program: AccountInfo<'info>,
    reserve: AccountInfo<'info>,
    lending_market: AccountInfo<'info>,
    lending_market_authority: AccountInfo<'info>,
    usdc_mint: AccountInfo<'info>,
    reserve_liquidity_supply: AccountInfo<'info>,
    reserve_collateral_mint: AccountInfo<'info>,
    token_program: AccountInfo<'info>,
    instruction_sysvar: AccountInfo<'info>,
}

// ── claim ─────────────────────────────────────────────────────────────────

pub fn claim_v2(ctx: Context<ClaimV2>, user_yield_bps: u16, expiry: i64) -> Result<()> {
    require!(ctx.accounts.lock.status == ACTIVE, VaultV2Error::LockNotActive);
    verify_voucher(
        &ctx.accounts.instruction_sysvar,
        &ctx.accounts.config.authority,
        &crate::ID,
        &ctx.accounts.lock.key(),
        user_yield_bps,
        expiry,
        Clock::get()?.unix_timestamp,
    )?;

    let course_id_hash = ctx.accounts.lock.course_id_hash;
    let lock_bump = ctx.accounts.lock.bump;
    let principal = ctx.accounts.lock.principal_amount;
    let fee_bps = ctx.accounts.config.platform_fee_bps;

    let usdc_decimals = ctx.accounts.usdc_mint.decimals;
    let ai = SettleAis {
        owner_key: ctx.accounts.owner.key(),
        lock: ctx.accounts.lock.to_account_info(),
        owner_usdc: ctx.accounts.owner_usdc.to_account_info(),
        owner_rent_dest: ctx.accounts.owner.to_account_info(),
        pot_vault: ctx.accounts.pot_vault.to_account_info(),
        fee_vault: ctx.accounts.fee_vault.to_account_info(),
        kamino_program: ctx.accounts.kamino_program.to_account_info(),
        reserve: ctx.accounts.reserve.to_account_info(),
        lending_market: ctx.accounts.lending_market.to_account_info(),
        lending_market_authority: ctx.accounts.lending_market_authority.to_account_info(),
        usdc_mint: ctx.accounts.usdc_mint.to_account_info(),
        reserve_liquidity_supply: ctx.accounts.reserve_liquidity_supply.to_account_info(),
        reserve_collateral_mint: ctx.accounts.reserve_collateral_mint.to_account_info(),
        token_program: ctx.accounts.token_program.to_account_info(),
        instruction_sysvar: ctx.accounts.instruction_sysvar.to_account_info(),
    };
    let s = redeem_and_split(
        &mut ctx.accounts.lock_liquidity, &mut ctx.accounts.lock_collateral,
        &ai, principal, usdc_decimals, course_id_hash, lock_bump, user_yield_bps, fee_bps,
    )?;

    let c = &mut ctx.accounts.config;
    c.current_tvl = caps::tvl_sub(c.current_tvl, principal)?;
    ctx.accounts.lock.status = CLOSED;
    emit!(LockV2Settled { lock: ctx.accounts.lock.key(), to_owner: s.to_owner, to_pot: s.to_pot, fee: s.fee, forced: false });
    Ok(())
}

// ── force_return ──────────────────────────────────────────────────────────

pub fn force_return_v2(ctx: Context<ForceReturnV2>) -> Result<()> {
    caps::force_returnable(ctx.accounts.lock.lock_start_ts, ctx.accounts.lock.status == ACTIVE, Clock::get()?.unix_timestamp)?;

    let course_id_hash = ctx.accounts.lock.course_id_hash;
    let lock_bump = ctx.accounts.lock.bump;
    let principal = ctx.accounts.lock.principal_amount;
    let fee_bps = ctx.accounts.config.platform_fee_bps;

    let usdc_decimals = ctx.accounts.usdc_mint.decimals;
    let ai = SettleAis {
        owner_key: ctx.accounts.owner.key(),
        lock: ctx.accounts.lock.to_account_info(),
        owner_usdc: ctx.accounts.owner_usdc.to_account_info(),
        owner_rent_dest: ctx.accounts.owner.to_account_info(),
        pot_vault: ctx.accounts.pot_vault.to_account_info(),
        fee_vault: ctx.accounts.fee_vault.to_account_info(),
        kamino_program: ctx.accounts.kamino_program.to_account_info(),
        reserve: ctx.accounts.reserve.to_account_info(),
        lending_market: ctx.accounts.lending_market.to_account_info(),
        lending_market_authority: ctx.accounts.lending_market_authority.to_account_info(),
        usdc_mint: ctx.accounts.usdc_mint.to_account_info(),
        reserve_liquidity_supply: ctx.accounts.reserve_liquidity_supply.to_account_info(),
        reserve_collateral_mint: ctx.accounts.reserve_collateral_mint.to_account_info(),
        token_program: ctx.accounts.token_program.to_account_info(),
        instruction_sysvar: ctx.accounts.instruction_sysvar.to_account_info(),
    };
    let s = redeem_and_split(
        &mut ctx.accounts.lock_liquidity, &mut ctx.accounts.lock_collateral,
        &ai, principal, usdc_decimals, course_id_hash, lock_bump, 0, fee_bps, // bps 0: all yield -> pot
    )?;

    let c = &mut ctx.accounts.config;
    c.current_tvl = caps::tvl_sub(c.current_tvl, principal)?;
    ctx.accounts.lock.status = CLOSED;
    emit!(LockV2Settled { lock: ctx.accounts.lock.key(), to_owner: s.to_owner, to_pot: s.to_pot, fee: s.fee, forced: true });
    Ok(())
}

// ── admin ─────────────────────────────────────────────────────────────────

/// Ops-key controls: pause deposits and adjust caps. Cannot touch principal,
/// authority, the pinned accounts, or any exit path (claim/force_return never
/// read `paused`). Caps affect only NEW locks.
pub fn set_config_v2(ctx: Context<SetConfigV2>, min: u64, max: u64, global: u64, fee_bps: u16, paused: bool) -> Result<()> {
    Caps { min_principal: min, max_principal_per_lock: max, global_tvl_cap: global }.validate()?;
    require!(fee_bps <= crate::settle::MAX_PLATFORM_FEE_BPS, VaultV2Error::FeeAboveHardMax);
    let c = &mut ctx.accounts.config;
    c.min_principal = min;
    c.max_principal_per_lock = max;
    c.global_tvl_cap = global;
    c.platform_fee_bps = fee_bps;
    c.paused = paused;
    Ok(())
}

/// Rotate the voucher/ops authority. Gated on the program upgrade authority
/// (the cold key), so a compromised hot ops key cannot rotate itself away.
pub fn set_authority_v2(ctx: Context<SetAuthorityV2>, new_authority: Pubkey) -> Result<()> {
    ctx.accounts.config.authority = new_authority;
    Ok(())
}

// ── state ─────────────────────────────────────────────────────────────────

#[account]
#[derive(InitSpace)]
pub struct VaultV2Config {
    pub authority: Pubkey,
    pub usdc_mint: Pubkey,
    pub kamino_program: Pubkey,
    pub kamino_reserve: Pubkey,
    pub kamino_market: Pubkey,
    pub kamino_lma: Pubkey,
    pub kamino_liquidity_supply: Pubkey,
    pub kamino_collateral_mint: Pubkey,
    pub pot_vault: Pubkey,
    pub fee_vault: Pubkey,
    pub min_principal: u64,
    pub max_principal_per_lock: u64,
    pub global_tvl_cap: u64,
    pub current_tvl: u64,
    pub platform_fee_bps: u16,
    pub paused: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct LockV2 {
    pub owner: Pubkey,
    pub course_id_hash: [u8; 32],
    pub principal_amount: u64,
    pub lock_start_ts: i64,
    pub status: u8,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitV2Params {
    pub authority: Pubkey,
    pub kamino_program: Pubkey,
    pub kamino_reserve: Pubkey,
    pub kamino_market: Pubkey,
    pub kamino_lma: Pubkey,
    pub kamino_liquidity_supply: Pubkey,
    pub fee_vault: Pubkey,
    pub min_principal: u64,
    pub max_principal_per_lock: u64,
    pub global_tvl_cap: u64,
    pub platform_fee_bps: u16,
}

// ── account contexts ──────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct InitializeVaultV2<'info> {
    #[account(init, payer = payer, space = 8 + VaultV2Config::INIT_SPACE, seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, VaultV2Config>,
    pub usdc_mint: InterfaceAccount<'info, Mint>,
    pub collateral_mint: InterfaceAccount<'info, Mint>,
    // Pot vault must hold USDC — else settlement transfers to it revert and, once
    // any lock accrues yield, force_return reverts too, trapping principal.
    #[account(token::mint = usdc_mint)]
    pub pot_vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut)]
    pub payer: Signer<'info>,
    // Front-run gate: only the program's upgrade authority may initialize the
    // singleton config (else the first caller owns the voucher key + CPI pins).
    #[account(constraint = program.programdata_address()? == Some(program_data.key()) @ VaultV2Error::NotUpgradeAuthority)]
    pub program: Program<'info, crate::program::LockedIn>,
    #[account(constraint = program_data.upgrade_authority_address == Some(payer.key()) @ VaultV2Error::NotUpgradeAuthority)]
    pub program_data: Account<'info, ProgramData>,
    pub system_program: Program<'info, System>,
}

// Init-only: create the lock account + its collateral ATA. No CPI.
#[derive(Accounts)]
#[instruction(course_id_hash: [u8; 32])]
pub struct OpenLockV2<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, VaultV2Config>,
    #[account(init, payer = owner, space = 8 + LockV2::INIT_SPACE, seeds = [LOCK_SEED, owner.key().as_ref(), &course_id_hash], bump)]
    pub lock: Account<'info, LockV2>,
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(address = config.kamino_collateral_mint)]
    pub reserve_collateral_mint: InterfaceAccount<'info, Mint>,
    // init_if_needed, NOT init: the address is purely derived (lock PDA +
    // public collateral mint) and the SPL ATA program lets anyone create an
    // ATA for any wallet, so plain `init` let an attacker pre-create this
    // account and permanently brick open_lock_v2 for that (owner, course).
    // Safe here because the ATA's mint+authority are constrained, so a
    // pre-created account can only be exactly the one we would have made.
    #[account(init_if_needed, payer = owner, associated_token::mint = reserve_collateral_mint, associated_token::authority = lock)]
    pub lock_collateral: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

// CPI-only: deposit into the reserve. The lock + collateral ATA already exist.
// The large Account/InterfaceAccount structs are Boxed onto the heap — deserialized
// on the stack they stack with the 13-account deposit CPI and blow the 4KB BPF
// frame, which corrupted adjacent reads (config.paused) and faulted in the CPI.
#[derive(Accounts)]
pub struct LockFundsV2<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, VaultV2Config>>,
    #[account(mut, has_one = owner, seeds = [LOCK_SEED, owner.key().as_ref(), &lock.course_id_hash], bump = lock.bump)]
    pub lock: Box<Account<'info, LockV2>>,
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(address = config.usdc_mint)]
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, associated_token::mint = usdc_mint, associated_token::authority = owner)]
    pub owner_usdc: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, associated_token::mint = reserve_collateral_mint, associated_token::authority = lock)]
    pub lock_collateral: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: pinned CPI target.
    #[account(address = config.kamino_program)]
    pub kamino_program: UncheckedAccount<'info>,
    /// CHECK: pinned reserve.
    #[account(mut, address = config.kamino_reserve)]
    pub reserve: UncheckedAccount<'info>,
    /// CHECK: pinned market marker.
    #[account(address = config.kamino_market)]
    pub lending_market: UncheckedAccount<'info>,
    /// CHECK: pinned market authority.
    #[account(address = config.kamino_lma)]
    pub lending_market_authority: UncheckedAccount<'info>,
    /// CHECK: pinned reserve liquidity supply vault.
    #[account(mut, address = config.kamino_liquidity_supply)]
    pub reserve_liquidity_supply: UncheckedAccount<'info>,
    #[account(mut, address = config.kamino_collateral_mint)]
    pub reserve_collateral_mint: Box<InterfaceAccount<'info, Mint>>,
    pub token_program: Interface<'info, TokenInterface>,
    /// CHECK: instructions sysvar for the reserve refresh.
    #[account(address = INSTRUCTIONS_SYSVAR_ID)]
    pub instruction_sysvar: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct ClaimV2<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, VaultV2Config>>,
    #[account(mut, has_one = owner, close = owner, seeds = [LOCK_SEED, owner.key().as_ref(), &lock.course_id_hash], bump = lock.bump)]
    pub lock: Box<Account<'info, LockV2>>,
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(address = config.usdc_mint)]
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, associated_token::mint = usdc_mint, associated_token::authority = owner)]
    pub owner_usdc: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(init_if_needed, payer = owner, associated_token::mint = usdc_mint, associated_token::authority = lock)]
    pub lock_liquidity: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, associated_token::mint = reserve_collateral_mint, associated_token::authority = lock)]
    pub lock_collateral: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, address = config.pot_vault)]
    pub pot_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: pinned fee vault (unused while fee_bps == 0).
    #[account(mut, address = config.fee_vault)]
    pub fee_vault: UncheckedAccount<'info>,
    /// CHECK: pinned CPI target.
    #[account(address = config.kamino_program)]
    pub kamino_program: UncheckedAccount<'info>,
    /// CHECK: pinned reserve.
    #[account(mut, address = config.kamino_reserve)]
    pub reserve: UncheckedAccount<'info>,
    /// CHECK: pinned market marker.
    #[account(address = config.kamino_market)]
    pub lending_market: UncheckedAccount<'info>,
    /// CHECK: pinned market authority.
    #[account(address = config.kamino_lma)]
    pub lending_market_authority: UncheckedAccount<'info>,
    /// CHECK: pinned reserve liquidity supply.
    #[account(mut, address = config.kamino_liquidity_supply)]
    pub reserve_liquidity_supply: UncheckedAccount<'info>,
    #[account(mut, address = config.kamino_collateral_mint)]
    pub reserve_collateral_mint: Box<InterfaceAccount<'info, Mint>>,
    pub token_program: Interface<'info, TokenInterface>,
    /// CHECK: instructions sysvar (voucher + refresh live here).
    #[account(address = INSTRUCTIONS_SYSVAR_ID)]
    pub instruction_sysvar: UncheckedAccount<'info>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ForceReturnV2<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, VaultV2Config>>,
    #[account(mut, has_one = owner, close = owner, seeds = [LOCK_SEED, owner.key().as_ref(), &lock.course_id_hash], bump = lock.bump)]
    pub lock: Box<Account<'info, LockV2>>,
    /// CHECK: the lock's owner receives principal + rent; validated by has_one.
    #[account(mut)]
    pub owner: UncheckedAccount<'info>,
    #[account(mut)]
    pub caller: Signer<'info>,
    #[account(address = config.usdc_mint)]
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, associated_token::mint = usdc_mint, associated_token::authority = owner)]
    pub owner_usdc: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(init_if_needed, payer = caller, associated_token::mint = usdc_mint, associated_token::authority = lock)]
    pub lock_liquidity: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, associated_token::mint = reserve_collateral_mint, associated_token::authority = lock)]
    pub lock_collateral: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, address = config.pot_vault)]
    pub pot_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: pinned fee vault.
    #[account(mut, address = config.fee_vault)]
    pub fee_vault: UncheckedAccount<'info>,
    /// CHECK: pinned CPI target.
    #[account(address = config.kamino_program)]
    pub kamino_program: UncheckedAccount<'info>,
    /// CHECK: pinned reserve.
    #[account(mut, address = config.kamino_reserve)]
    pub reserve: UncheckedAccount<'info>,
    /// CHECK: pinned market marker.
    #[account(address = config.kamino_market)]
    pub lending_market: UncheckedAccount<'info>,
    /// CHECK: pinned market authority.
    #[account(address = config.kamino_lma)]
    pub lending_market_authority: UncheckedAccount<'info>,
    /// CHECK: pinned reserve liquidity supply.
    #[account(mut, address = config.kamino_liquidity_supply)]
    pub reserve_liquidity_supply: UncheckedAccount<'info>,
    #[account(mut, address = config.kamino_collateral_mint)]
    pub reserve_collateral_mint: Box<InterfaceAccount<'info, Mint>>,
    pub token_program: Interface<'info, TokenInterface>,
    /// CHECK: instructions sysvar.
    #[account(address = INSTRUCTIONS_SYSVAR_ID)]
    pub instruction_sysvar: UncheckedAccount<'info>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetConfigV2<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = authority @ VaultV2Error::NotAuthority)]
    pub config: Account<'info, VaultV2Config>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct SetAuthorityV2<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, VaultV2Config>,
    // Rotation is gated on the UPGRADE authority (cold key), not the hot ops key.
    pub payer: Signer<'info>,
    #[account(constraint = program.programdata_address()? == Some(program_data.key()) @ VaultV2Error::NotUpgradeAuthority)]
    pub program: Program<'info, crate::program::LockedIn>,
    #[account(constraint = program_data.upgrade_authority_address == Some(payer.key()) @ VaultV2Error::NotUpgradeAuthority)]
    pub program_data: Account<'info, ProgramData>,
}

#[event]
pub struct LockV2Created { pub lock: Pubkey, pub owner: Pubkey, pub principal_amount: u64, pub lock_start_ts: i64 }
#[event]
pub struct LockV2Settled { pub lock: Pubkey, pub to_owner: u64, pub to_pot: u64, pub fee: u64, pub forced: bool }

#[error_code]
pub enum VaultV2Error {
    #[msg("Platform fee exceeds the hard maximum.")]
    FeeAboveHardMax,
    #[msg("Lock is not active.")]
    LockNotActive,
    #[msg("Lock is not pending a deposit.")]
    LockNotPending,
    #[msg("A lock token account was not fully drained before close.")]
    NonZeroBalance,
    #[msg("initialize_vault_v2 must be signed by the program upgrade authority.")]
    NotUpgradeAuthority,
    #[msg("kamino_program must be the canonical Kamino klend program on mainnet.")]
    NotKlendProgram,
    #[msg("Only the vault authority may call this instruction.")]
    NotAuthority,
}
