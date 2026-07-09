#![allow(unexpected_cfgs)]
#![allow(deprecated)]

//! Devnet-only mock of Kamino klend.
//!
//! Exposes `deposit_reserve_liquidity` / `redeem_reserve_collateral` /
//! `refresh_reserve` with the SAME instruction discriminators (Anchor derives
//! them from the names) and the SAME account order that
//! `locked_in::kamino` sends, so the real CPI wrapper drives this unchanged on
//! devnet where klend is not deployed.
//!
//! Yield is a share model, like klend: collateral (cToken) is a share of the
//! pool, and the exchange rate grows linearly with slots at a fixed APY. A
//! deposit mints `amount / rate` shares; a redeem returns `shares * rate`. The
//! extra USDC paid as yield comes from a buffer anyone can transfer into the
//! vault (permissionless), mirroring how a real reserve's interest is funded by
//! borrowers.
//!
//! NEVER deploy to mainnet: it mints its own cToken and pays "yield" from an
//! unbacked buffer.

use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{self, Mint, MintTo, TokenAccount, TokenInterface, TransferChecked},
};

declare_id!("3kqzsQV7Ab8aakkNugM9aXBqQrgwnshF6a47HxJcfLtp");

const RATE_SCALE: u128 = 1_000_000_000_000; // 1e12 fixed point
const SLOTS_PER_YEAR: u128 = 63_072_000; // ~2 slots/sec

/// Exchange rate (scaled by RATE_SCALE): 1 + apy_bps * elapsed / (10000 * year).
fn exchange_rate(apy_bps: u16, genesis_slot: u64, now: u64) -> u128 {
    let elapsed = now.saturating_sub(genesis_slot) as u128;
    RATE_SCALE + (apy_bps as u128 * elapsed * RATE_SCALE) / (10_000u128 * SLOTS_PER_YEAR)
}

#[program]
pub mod mock_reserve {
    use super::*;

    pub fn init_reserve(ctx: Context<InitReserve>, apy_bps: u16) -> Result<()> {
        let r = &mut ctx.accounts.reserve;
        r.liquidity_mint = ctx.accounts.liquidity_mint.key();
        r.collateral_mint = ctx.accounts.collateral_mint.key();
        r.liquidity_supply = ctx.accounts.liquidity_supply.key();
        r.apy_bps = apy_bps;
        r.genesis_slot = Clock::get()?.slot;
        r.authority_bump = ctx.bumps.authority;
        r.bump = ctx.bumps.reserve;
        Ok(())
    }

    /// No-op — exists only so clients can prepend it and keep the tx shape
    /// identical to a real klend transaction.
    pub fn refresh_reserve(_ctx: Context<RefreshReserve>) -> Result<()> {
        Ok(())
    }

    pub fn deposit_reserve_liquidity(ctx: Context<DepositReserveLiquidity>, liquidity_amount: u64) -> Result<()> {
        require!(liquidity_amount > 0, MockError::ZeroAmount);
        let reserve = &ctx.accounts.reserve;
        let now = Clock::get()?.slot;
        let rate = exchange_rate(reserve.apy_bps, reserve.genesis_slot, now);
        let shares = (liquidity_amount as u128 * RATE_SCALE / rate) as u64;
        require!(shares > 0, MockError::ZeroShares);

        // USDC in: user -> vault (user/owner signs, directly or via CPI seeds).
        token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.liquidity_token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.user_source_liquidity.to_account_info(),
                    mint: ctx.accounts.reserve_liquidity_mint.to_account_info(),
                    to: ctx.accounts.reserve_liquidity_supply.to_account_info(),
                    authority: ctx.accounts.owner.to_account_info(),
                },
            ),
            liquidity_amount,
            ctx.accounts.reserve_liquidity_mint.decimals,
        )?;

        // cToken out: mint shares to user, signed by the reserve authority PDA.
        let mint_key = reserve.liquidity_mint;
        let seeds: &[&[&[u8]]] = &[&[b"authority", mint_key.as_ref(), &[reserve.authority_bump]]];
        token_interface::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.collateral_token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.reserve_collateral_mint.to_account_info(),
                    to: ctx.accounts.user_destination_collateral.to_account_info(),
                    authority: ctx.accounts.lending_market_authority.to_account_info(),
                },
                seeds,
            ),
            shares,
        )?;
        Ok(())
    }

    pub fn redeem_reserve_collateral(ctx: Context<RedeemReserveCollateral>, collateral_amount: u64) -> Result<()> {
        require!(collateral_amount > 0, MockError::ZeroAmount);
        let reserve = &ctx.accounts.reserve;
        let now = Clock::get()?.slot;
        let rate = exchange_rate(reserve.apy_bps, reserve.genesis_slot, now);
        let liquidity = (collateral_amount as u128 * rate / RATE_SCALE) as u64;
        require!(liquidity > 0, MockError::ZeroAmount);

        // Burn the shares from the user.
        token_interface::burn(
            CpiContext::new(
                ctx.accounts.collateral_token_program.to_account_info(),
                token_interface::Burn {
                    mint: ctx.accounts.reserve_collateral_mint.to_account_info(),
                    from: ctx.accounts.user_source_collateral.to_account_info(),
                    authority: ctx.accounts.owner.to_account_info(),
                },
            ),
            collateral_amount,
        )?;

        // USDC out: vault -> user, signed by the reserve authority PDA.
        let mint_key = reserve.liquidity_mint;
        let seeds: &[&[&[u8]]] = &[&[b"authority", mint_key.as_ref(), &[reserve.authority_bump]]];
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.liquidity_token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.reserve_liquidity_supply.to_account_info(),
                    mint: ctx.accounts.reserve_liquidity_mint.to_account_info(),
                    to: ctx.accounts.user_destination_liquidity.to_account_info(),
                    authority: ctx.accounts.lending_market_authority.to_account_info(),
                },
                seeds,
            ),
            liquidity,
            ctx.accounts.reserve_liquidity_mint.decimals,
        )?;
        Ok(())
    }
}

#[account]
#[derive(InitSpace)]
pub struct MockReserveState {
    pub liquidity_mint: Pubkey,
    pub collateral_mint: Pubkey,
    pub liquidity_supply: Pubkey,
    pub apy_bps: u16,
    pub genesis_slot: u64,
    pub authority_bump: u8,
    pub bump: u8,
}

#[derive(Accounts)]
pub struct InitReserve<'info> {
    #[account(
        init, payer = payer, space = 8 + MockReserveState::INIT_SPACE,
        seeds = [b"reserve", liquidity_mint.key().as_ref()], bump,
    )]
    pub reserve: Account<'info, MockReserveState>,
    /// CHECK: PDA authority that owns the vault + cToken mint.
    #[account(seeds = [b"authority", liquidity_mint.key().as_ref()], bump)]
    pub authority: UncheckedAccount<'info>,
    pub liquidity_mint: InterfaceAccount<'info, Mint>,
    #[account(
        init, payer = payer, mint::decimals = liquidity_mint.decimals,
        mint::authority = authority, seeds = [b"ctoken", liquidity_mint.key().as_ref()], bump,
    )]
    pub collateral_mint: InterfaceAccount<'info, Mint>,
    #[account(
        init, payer = payer,
        associated_token::mint = liquidity_mint, associated_token::authority = authority,
    )]
    pub liquidity_supply: InterfaceAccount<'info, TokenAccount>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

// Account orders below MUST match locked_in::kamino::Kamino{Deposit,Redeem}.
#[derive(Accounts)]
pub struct RefreshReserve<'info> {
    #[account(mut)]
    pub reserve: Account<'info, MockReserveState>,
    /// CHECK: marker, unused by the mock.
    pub lending_market: UncheckedAccount<'info>,
    /// CHECK: None oracle (klend program id sentinel on mainnet).
    pub pyth: UncheckedAccount<'info>,
    /// CHECK: None oracle.
    pub switchboard_price: UncheckedAccount<'info>,
    /// CHECK: None oracle.
    pub switchboard_twap: UncheckedAccount<'info>,
    /// CHECK: scope prices.
    pub scope: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct DepositReserveLiquidity<'info> {
    pub owner: Signer<'info>,
    #[account(mut)]
    pub reserve: Account<'info, MockReserveState>,
    /// CHECK: marker.
    pub lending_market: UncheckedAccount<'info>,
    /// CHECK: reserve authority PDA (mint + vault authority).
    #[account(seeds = [b"authority", reserve.liquidity_mint.as_ref()], bump = reserve.authority_bump)]
    pub lending_market_authority: UncheckedAccount<'info>,
    #[account(address = reserve.liquidity_mint @ MockError::WrongAccount)]
    pub reserve_liquidity_mint: InterfaceAccount<'info, Mint>,
    #[account(mut, address = reserve.liquidity_supply @ MockError::WrongAccount)]
    pub reserve_liquidity_supply: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, address = reserve.collateral_mint @ MockError::WrongAccount)]
    pub reserve_collateral_mint: InterfaceAccount<'info, Mint>,
    #[account(mut)]
    pub user_source_liquidity: InterfaceAccount<'info, TokenAccount>,
    #[account(mut)]
    pub user_destination_collateral: InterfaceAccount<'info, TokenAccount>,
    pub collateral_token_program: Interface<'info, TokenInterface>,
    pub liquidity_token_program: Interface<'info, TokenInterface>,
    /// CHECK: sysvar marker, unused by the mock.
    pub instruction_sysvar: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct RedeemReserveCollateral<'info> {
    pub owner: Signer<'info>,
    /// CHECK: marker (klend puts lending_market before reserve on redeem).
    pub lending_market: UncheckedAccount<'info>,
    #[account(mut)]
    pub reserve: Account<'info, MockReserveState>,
    /// CHECK: reserve authority PDA.
    #[account(seeds = [b"authority", reserve.liquidity_mint.as_ref()], bump = reserve.authority_bump)]
    pub lending_market_authority: UncheckedAccount<'info>,
    #[account(address = reserve.liquidity_mint @ MockError::WrongAccount)]
    pub reserve_liquidity_mint: InterfaceAccount<'info, Mint>,
    #[account(mut, address = reserve.collateral_mint @ MockError::WrongAccount)]
    pub reserve_collateral_mint: InterfaceAccount<'info, Mint>,
    #[account(mut, address = reserve.liquidity_supply @ MockError::WrongAccount)]
    pub reserve_liquidity_supply: InterfaceAccount<'info, TokenAccount>,
    #[account(mut)]
    pub user_source_collateral: InterfaceAccount<'info, TokenAccount>,
    #[account(mut)]
    pub user_destination_liquidity: InterfaceAccount<'info, TokenAccount>,
    pub collateral_token_program: Interface<'info, TokenInterface>,
    pub liquidity_token_program: Interface<'info, TokenInterface>,
    /// CHECK: sysvar marker.
    pub instruction_sysvar: UncheckedAccount<'info>,
}

#[error_code]
pub enum MockError {
    #[msg("Amount must be greater than zero.")]
    ZeroAmount,
    #[msg("Deposit too small to mint any shares.")]
    ZeroShares,
    #[msg("A supplied account does not match the reserve configuration.")]
    WrongAccount,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rate_starts_at_one_and_grows() {
        assert_eq!(exchange_rate(800, 100, 100), RATE_SCALE); // no elapsed = 1.0
        assert!(exchange_rate(800, 100, 100 + SLOTS_PER_YEAR as u64) > RATE_SCALE);
    }

    #[test]
    fn full_year_at_8pct_is_about_8pct() {
        let rate = exchange_rate(800, 0, SLOTS_PER_YEAR as u64);
        // 1 share -> ~1.08 liquidity after a year at 8%.
        let liquidity = (1_000_000u128 * rate / RATE_SCALE) as u64;
        assert!(liquidity >= 1_079_000 && liquidity <= 1_081_000, "got {liquidity}");
    }

    #[test]
    fn shares_then_redeem_round_trips_at_flat_rate() {
        // Same slot for deposit and redeem => no yield => principal back.
        let rate = exchange_rate(800, 500, 500);
        let shares = (25_000_000u128 * RATE_SCALE / rate) as u64;
        let back = (shares as u128 * rate / RATE_SCALE) as u64;
        assert_eq!(back, 25_000_000);
    }
}
